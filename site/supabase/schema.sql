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
