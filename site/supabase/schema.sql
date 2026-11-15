-- Tech na Pesa community database. Paste this whole file into Supabase: SQL Editor, New query, Run.
-- Readers can only add content as "pending"; nothing goes live until the review robot (or an editor) approves it.

create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  display_name text not null check (char_length(display_name) between 3 and 40),
  county text,
  created_at timestamptz not null default now()
);

create table if not exists public.stories (
  id uuid primary key default gen_random_uuid(),
  author uuid not null references auth.users(id) on delete cascade,
  title text not null check (char_length(title) between 10 and 110),
  body text not null check (char_length(body) between 300 and 12000),
  category text not null check (category in ('money','hustles','scams','tech','howto')),
  county text,
  image_path text,
  status text not null default 'pending' check (status in ('pending','approved','rejected','removal_requested','removed')),
  reason text,
  slug text unique,
  created_at timestamptz not null default now(),
  reviewed_at timestamptz
);

create table if not exists public.scam_reports (
  id uuid primary key default gen_random_uuid(),
  reporter uuid not null references auth.users(id) on delete cascade,
  message text not null check (char_length(message) between 10 and 2000),
  signals text[],
  kind text,
  public_text text,
  status text not null default 'pending' check (status in ('pending','approved','rejected')),
  created_at timestamptz not null default now()
);

alter table public.profiles enable row level security;
alter table public.stories enable row level security;
alter table public.scam_reports enable row level security;

-- profiles: anyone can read display names; you can only create or edit your own
drop policy if exists "profiles read" on public.profiles;
create policy "profiles read" on public.profiles for select using (true);
drop policy if exists "profiles own insert" on public.profiles;
create policy "profiles own insert" on public.profiles for insert with check (auth.uid() = id);
drop policy if exists "profiles own update" on public.profiles;
create policy "profiles own update" on public.profiles for update using (auth.uid() = id) with check (auth.uid() = id);

-- stories: public sees approved; writers see their own; writers can only submit as pending, at most 5 a day
drop policy if exists "stories public read" on public.stories;
create policy "stories public read" on public.stories for select using (status = 'approved' or auth.uid() = author);
drop policy if exists "stories submit" on public.stories;
create policy "stories submit" on public.stories for insert with check (
  auth.uid() = author and status = 'pending' and slug is null and reason is null
  and (select count(*) from public.stories s where s.author = auth.uid() and s.created_at > now() - interval '1 day') < 5);
drop policy if exists "stories ask removal" on public.stories;
create policy "stories ask removal" on public.stories for update using (auth.uid() = author) with check (auth.uid() = author and status = 'removal_requested');

-- scam reports: public sees approved (cleaned text only is shown by the site); reporters can add pending reports, at most 10 a day
drop policy if exists "reports public read" on public.scam_reports;
create policy "reports public read" on public.scam_reports for select using (status = 'approved' or auth.uid() = reporter);
drop policy if exists "reports submit" on public.scam_reports;
create policy "reports submit" on public.scam_reports for insert with check (
  auth.uid() = reporter and status = 'pending' and public_text is null
  and (select count(*) from public.scam_reports r where r.reporter = auth.uid() and r.created_at > now() - interval '1 day') < 10);

-- photos: anyone can view; signed in readers upload only into their own folder
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('story-images', 'story-images', true, 4194304, array['image/jpeg','image/png','image/webp'])
on conflict (id) do nothing;
drop policy if exists "images read" on storage.objects;
create policy "images read" on storage.objects for select using (bucket_id = 'story-images');
drop policy if exists "images own upload" on storage.objects;
create policy "images own upload" on storage.objects for insert to authenticated with check (bucket_id = 'story-images' and (storage.foldername(name))[1] = auth.uid()::text);

-- profile photos (checked by the review robot before they appear with a published story)
alter table public.profiles add column if not exists avatar_path text;
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('avatars', 'avatars', true, 2097152, array['image/jpeg','image/png','image/webp'])
on conflict (id) do nothing;
drop policy if exists "avatars read" on storage.objects;
create policy "avatars read" on storage.objects for select using (bucket_id = 'avatars');
drop policy if exists "avatars own upload" on storage.objects;
create policy "avatars own upload" on storage.objects for insert to authenticated with check (bucket_id = 'avatars' and (storage.foldername(name))[1] = auth.uid()::text);

-- likes on published stories: one like per reader per story
create table if not exists public.likes (
  slug text not null,
  user_id uuid not null references auth.users(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (slug, user_id)
);
alter table public.likes enable row level security;
drop policy if exists "likes read" on public.likes;
create policy "likes read" on public.likes for select using (true);
drop policy if exists "likes own add" on public.likes;
create policy "likes own add" on public.likes for insert with check (auth.uid() = user_id and exists (select 1 from public.stories s where s.slug = likes.slug and s.status = 'approved'));
drop policy if exists "likes own remove" on public.likes;
create policy "likes own remove" on public.likes for delete using (auth.uid() = user_id);
create or replace view public.like_counts with (security_invoker = true) as select slug, count(*)::int as n from public.likes group by slug;

-- ===== Round 2: comments, star ratings, safe profile photos =====
-- profile photos only show once the review robot marks them safe; readers cannot mark their own
alter table public.profiles add column if not exists avatar_ok boolean;
create or replace function public.guard_avatar() returns trigger language plpgsql as $$
begin
  if coalesce(auth.role(), '') <> 'service_role' then
    if tg_op = 'INSERT' then new.avatar_ok := null;
    else new.avatar_ok := case when new.avatar_path is distinct from old.avatar_path then null else old.avatar_ok end;
    end if;
  end if;
  return new;
end $$;
drop trigger if exists guard_avatar on public.profiles;
create trigger guard_avatar before insert or update on public.profiles for each row execute function public.guard_avatar();

-- likes may be on newsroom or reader stories; the slug must look like one of ours
drop policy if exists "likes own add" on public.likes;
create policy "likes own add" on public.likes for insert with check (auth.uid() = user_id and slug ~ '^[a-z0-9-]{3,90}$');

-- star ratings: one rating per reader per story, 1 to 5; writers cannot rate their own story; accounts must be 3 days old
create table if not exists public.ratings (
  slug text not null,
  user_id uuid not null references auth.users(id) on delete cascade,
  stars smallint not null check (stars between 1 and 5),
  created_at timestamptz not null default now(),
  primary key (slug, user_id)
);
alter table public.ratings enable row level security;
drop policy if exists "ratings read" on public.ratings;
create policy "ratings read" on public.ratings for select using (true);
drop policy if exists "ratings own add" on public.ratings;
create policy "ratings own add" on public.ratings for insert with check (
  auth.uid() = user_id and slug ~ '^[a-z0-9-]{3,90}$'
  and not exists (select 1 from public.stories s where s.slug = ratings.slug and s.author = auth.uid())
  and exists (select 1 from public.profiles p where p.id = auth.uid() and p.created_at < now() - interval '3 days'));
drop policy if exists "ratings own change" on public.ratings;
create policy "ratings own change" on public.ratings for update using (auth.uid() = user_id) with check (auth.uid() = user_id);
create or replace view public.rating_stats with (security_invoker = true) as
  select slug, round(avg(stars)::numeric, 1) as avg, count(*)::int as n from public.ratings group by slug;

-- comments: go live at once but cannot hold links or phone numbers; the robot hides abuse; writers can delete their own
create table if not exists public.comments (
  id uuid primary key default gen_random_uuid(),
  slug text not null check (slug ~ '^[a-z0-9-]{3,90}$'),
  user_id uuid not null references auth.users(id) on delete cascade,
  parent uuid references public.comments(id) on delete cascade,
  body text not null check (char_length(body) between 2 and 1000 and body !~* '(https?://|www\.|\.com|\.co\.ke|bit\.ly)' and body !~ '[0-9][0-9 ]{6,}[0-9]'),
  status text not null default 'visible' check (status in ('visible','hidden','deleted')),
  checked boolean not null default false,
  created_at timestamptz not null default now()
);
alter table public.comments enable row level security;
drop policy if exists "comments read" on public.comments;
create policy "comments read" on public.comments for select using (status = 'visible');
drop policy if exists "comments own add" on public.comments;
create policy "comments own add" on public.comments for insert with check (
  auth.uid() = user_id and status = 'visible' and checked = false
  and exists (select 1 from public.profiles p where p.id = auth.uid())
  and (select count(*) from public.comments c where c.user_id = auth.uid() and c.created_at > now() - interval '1 hour') < 20);
drop policy if exists "comments own delete" on public.comments;
create policy "comments own delete" on public.comments for update using (auth.uid() = user_id) with check (auth.uid() = user_id and status = 'deleted');
create or replace view public.comment_counts with (security_invoker = true) as
  select slug, count(*)::int as n from public.comments where status = 'visible' group by slug;

-- ===== Round 3: sponsored challenges, entries and votes =====
-- challenge dates live here so the database itself refuses entries or votes outside the open window (the robot copies them from the website files)
create table if not exists public.challenges (
  slug text primary key,
  title text not null,
  opens timestamptz not null,
  entries_close timestamptz not null,
  voting_closes timestamptz not null
);
alter table public.challenges enable row level security;
drop policy if exists "challenges read" on public.challenges;
create policy "challenges read" on public.challenges for select using (true);

create table if not exists public.entries (
  id uuid primary key default gen_random_uuid(),
  challenge text not null references public.challenges(slug) on delete cascade,
  author uuid not null references auth.users(id) on delete cascade,
  title text not null check (char_length(title) between 5 and 90),
  description text not null check (char_length(description) between 40 and 3000),
  image_path text,
  status text not null default 'pending' check (status in ('pending','approved','rejected','withdrawn')),
  reason text,
  slug text unique,
  created_at timestamptz not null default now(),
  reviewed_at timestamptz,
  unique (challenge, author)
);
alter table public.entries enable row level security;
drop policy if exists "entries read" on public.entries;
create policy "entries read" on public.entries for select using (status = 'approved' or auth.uid() = author);
drop policy if exists "entries submit" on public.entries;
create policy "entries submit" on public.entries for insert with check (
  auth.uid() = author and status = 'pending' and slug is null and reason is null
  and exists (select 1 from public.profiles p where p.id = auth.uid())
  and exists (select 1 from public.challenges c where c.slug = entries.challenge and now() between c.opens and c.entries_close));
drop policy if exists "entries withdraw" on public.entries;
create policy "entries withdraw" on public.entries for update using (auth.uid() = author) with check (auth.uid() = author and status = 'withdrawn');

-- votes: one vote per account per challenge (you can move it), only while voting is open, never for your own entry
create table if not exists public.votes (
  challenge text not null references public.challenges(slug) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  entry_id uuid not null references public.entries(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (challenge, user_id)
);
alter table public.votes enable row level security;
drop policy if exists "votes read own" on public.votes;
create policy "votes read own" on public.votes for select using (auth.uid() = user_id);
drop policy if exists "votes cast" on public.votes;
create policy "votes cast" on public.votes for insert with check (
  auth.uid() = user_id
  and exists (select 1 from public.challenges c where c.slug = votes.challenge and now() between c.opens and c.voting_closes)
  and exists (select 1 from public.entries e where e.id = votes.entry_id and e.challenge = votes.challenge and e.status = 'approved' and e.author <> auth.uid()));
drop policy if exists "votes move" on public.votes;
create policy "votes move" on public.votes for delete using (auth.uid() = user_id and exists (select 1 from public.challenges c where c.slug = votes.challenge and now() < c.voting_closes));
-- public totals only (who voted for whom stays private)
create or replace view public.vote_counts as select challenge, entry_id, count(*)::int as n from public.votes group by challenge, entry_id;
grant select on public.vote_counts to anon, authenticated;

-- companies asking to sponsor a challenge (anyone can send; only the owner can read, through the robot)
create table if not exists public.sponsor_leads (
  id uuid primary key default gen_random_uuid(),
  company text not null check (char_length(company) between 2 and 120),
  contact_name text not null check (char_length(contact_name) between 2 and 80),
  phone_or_email text not null check (char_length(phone_or_email) between 5 and 120),
  message text check (char_length(message) <= 1500),
  notified boolean not null default false,
  created_at timestamptz not null default now()
);
alter table public.sponsor_leads enable row level security;
drop policy if exists "leads send" on public.sponsor_leads;
create policy "leads send" on public.sponsor_leads for insert with check (notified = false);
