-- TECH na PESA community: reader stories (Facebook style feed), likes, comments, reports, Story of the Month,
-- and sponsored challenges (free entry, judges score, public votes count for part of the result).
-- Every table has row level security; browsers change data only through the functions below.

-- ---------------------------------------------------------------------------------------------
-- Permissions, roles and settings
-- ---------------------------------------------------------------------------------------------
insert into public.permissions (key, description) values
  ('challenges.manage', 'Create and run challenges, publish results'),
  ('challenges.judge',  'Score challenge entries')
on conflict (key) do nothing;

insert into public.roles (key, name, description, is_staff, self_service, sort) values
  ('judge', 'Challenge judge', 'Scores entries in challenges', true, false, 115)
on conflict (key) do nothing;

insert into public.role_permissions (role, permission) values
  ('administrator', 'challenges.manage'), ('administrator', 'challenges.judge'),
  ('editor', 'moderation.manage'), ('editor', 'challenges.manage'), ('editor', 'challenges.judge'),
  ('judge', 'challenges.judge')
on conflict do nothing;

insert into public.site_settings (key, value, is_public) values
  ('community.auto_publish_trusted', 'true', true),   -- authors with an approved story publish straight away
  ('community.stories_per_day', '5', false),
  ('community.comments_per_hour', '20', false)
on conflict (key) do nothing;

-- ---------------------------------------------------------------------------------------------
-- Challenges
-- ---------------------------------------------------------------------------------------------
create table public.challenges (
  id smallint generated always as identity primary key,
  number smallint not null unique check (number between 1 and 999),
  slug text not null unique check (slug ~ '^[0-9]{2,3}$'),
  title text not null check (char_length(title) between 5 and 120),
  brief text not null check (char_length(brief) between 20 and 3000),
  rules text not null default '' check (char_length(rules) <= 6000),
  prize text not null check (char_length(prize) between 3 and 200),
  sponsor_name text check (sponsor_name is null or char_length(sponsor_name) <= 120),
  sponsor_url text check (sponsor_url is null or sponsor_url ~ '^https://'),
  sponsor_logo_path text,
  opens_at timestamptz not null,
  entries_close_at timestamptz not null,
  voting_close_at timestamptz not null,
  judge_weight smallint not null default 70 check (judge_weight between 0 and 100),   -- the rest comes from public votes
  published boolean not null default false,
  winner_story_id uuid,
  winner_note text check (winner_note is null or char_length(winner_note) <= 600),
  results_at timestamptz,
  created_at timestamptz not null default now(),
  check (opens_at < entries_close_at and entries_close_at <= voting_close_at)
);

-- ---------------------------------------------------------------------------------------------
-- Stories
-- ---------------------------------------------------------------------------------------------
create table public.stories (
  id uuid primary key default gen_random_uuid(),
  slug text not null unique check (slug ~ '^[a-z0-9-]{3,90}$'),
  author_id uuid not null references auth.users(id) on delete cascade,
  title text not null check (char_length(title) between 5 and 140),
  body text not null check (char_length(body) between 80 and 20000),
  category text not null check (category in ('tech', 'money', 'hustle', 'opportunities', 'life')),
  cover_path text,
  link text check (link is null or link ~ '^https?://'),
  challenge_id smallint references public.challenges(id),
  status text not null default 'pending' check (status in ('pending', 'published', 'rejected', 'removed', 'deleted')),
  status_reason text check (status_reason is null or char_length(status_reason) <= 500),
  like_count int not null default 0,
  comment_count int not null default 0,
  featured_label text check (featured_label is null or char_length(featured_label) <= 60),   -- e.g. "Story of the Month, November 2026"
  featured_at timestamptz,
  published_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index stories_feed on public.stories (status, published_at desc);
create index stories_author on public.stories (author_id, created_at desc);
create unique index stories_one_entry on public.stories (challenge_id, author_id) where challenge_id is not null and status <> 'deleted';
alter table public.challenges add constraint challenges_winner foreign key (winner_story_id) references public.stories(id) on delete set null;

create table public.story_likes (
  story_id uuid not null references public.stories(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (story_id, user_id)
);

create table public.story_comments (
  id bigint generated always as identity primary key,
  story_id uuid not null references public.stories(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  body text not null check (char_length(body) between 1 and 1000),
  status text not null default 'visible' check (status in ('visible', 'removed', 'deleted')),
  created_at timestamptz not null default now()
);
create index story_comments_story on public.story_comments (story_id, created_at);

create table public.content_reports (
  id bigint generated always as identity primary key,
  kind text not null check (kind in ('story', 'comment')),
  story_id uuid references public.stories(id) on delete cascade,
  comment_id bigint references public.story_comments(id) on delete cascade,
  reporter_id uuid not null references auth.users(id) on delete cascade,
  reason text not null check (char_length(reason) between 3 and 500),
  status text not null default 'open' check (status in ('open', 'actioned', 'dismissed')),
  handled_by uuid references auth.users(id),
  created_at timestamptz not null default now()
);

create table public.challenge_votes (
  challenge_id smallint not null references public.challenges(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  story_id uuid not null references public.stories(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (challenge_id, user_id)
);

create table public.challenge_scores (
  story_id uuid not null references public.stories(id) on delete cascade,
  judge_id uuid not null references auth.users(id) on delete cascade,
  score smallint not null check (score between 1 and 10),
  note text check (note is null or char_length(note) <= 500),
  updated_at timestamptz not null default now(),
  primary key (story_id, judge_id)
);

-- ---------------------------------------------------------------------------------------------
-- Helpers
-- ---------------------------------------------------------------------------------------------
create or replace function public.author_name(p_user uuid) returns text
language sql stable security definer set search_path = public as $$
  select coalesce(nullif(trim(display_name), ''), nullif(trim(full_name), ''), 'TECH na PESA reader') from public.profiles where id = p_user;
$$;

create or replace function public.challenge_phase(c public.challenges) returns text language sql stable as $$
  select case when not c.published then 'draft'
              when c.results_at is not null then 'results'
              when now() < c.opens_at then 'upcoming'
              when now() < c.entries_close_at then 'open'
              when now() < c.voting_close_at then 'voting'
              else 'judging' end;
$$;

-- story counters are kept by triggers so the feed never counts rows
create or replace function public.story_counts() returns trigger language plpgsql security definer set search_path = public as $$
begin
  if tg_table_name = 'story_likes' then
    update public.stories set like_count = (select count(*) from public.story_likes where story_id = coalesce(new.story_id, old.story_id))
    where id = coalesce(new.story_id, old.story_id);
  else
    update public.stories set comment_count = (select count(*) from public.story_comments where story_id = coalesce(new.story_id, old.story_id) and status = 'visible')
    where id = coalesce(new.story_id, old.story_id);
  end if;
  return null;
end $$;
create trigger story_likes_count after insert or delete on public.story_likes for each row execute function public.story_counts();
create trigger story_comments_count after insert or update or delete on public.story_comments for each row execute function public.story_counts();

-- community media: story covers and profile photos, in a folder named after the uploader's account
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('community-media', 'community-media', true, 3145728, array['image/jpeg', 'image/png', 'image/webp'])
on conflict (id) do nothing;
create policy "community media readable" on storage.objects for select using (bucket_id = 'community-media');
create policy "community media upload own" on storage.objects for insert to authenticated with check (bucket_id = 'community-media' and split_part(name, '/', 1) = auth.uid()::text);
create policy "community media remove own" on storage.objects for delete to authenticated using (bucket_id = 'community-media' and split_part(name, '/', 1) = auth.uid()::text);

-- ---------------------------------------------------------------------------------------------
-- Writer actions
-- ---------------------------------------------------------------------------------------------
create or replace function public.story_save(p_id uuid, p_title text, p_body text, p_category text, p_cover_path text default null,
  p_link text default null, p_challenge smallint default null) returns uuid
language plpgsql security definer set search_path = public as $$
declare s public.stories; c public.challenges; v_id uuid; v_slug text; v_trusted boolean; v_status text;
  v_max int := coalesce((select value::int from public.site_settings where key = 'community.stories_per_day'), 5);
begin
  if auth.uid() is null then raise exception 'sign in to publish a story'; end if;
  if not exists (select 1 from public.profiles where id = auth.uid() and status = 'active') then raise exception 'account is not active'; end if;
  p_title := trim(regexp_replace(coalesce(p_title, ''), '\s+', ' ', 'g')); p_body := trim(coalesce(p_body, ''));
  if char_length(p_title) < 5 then raise exception 'give your story a title of at least 5 characters'; end if;
  if char_length(p_body) < 80 then raise exception 'your story is too short; write at least a few sentences (80 characters)'; end if;
  if p_cover_path is not null and split_part(p_cover_path, '/', 1) <> auth.uid()::text then raise exception 'that photo does not belong to your account'; end if;
  p_link := nullif(trim(coalesce(p_link, '')), '');
  if p_link is not null and p_link !~ '^https?://' then p_link := 'https://' || p_link; end if;
  v_trusted := coalesce((select value::boolean from public.site_settings where key = 'community.auto_publish_trusted'), true)
               and exists (select 1 from public.stories where author_id = auth.uid() and status = 'published' and published_at is not null)
               or public.has_permission('moderation.manage');

  if p_id is null then
    if (select count(*) from public.stories where author_id = auth.uid() and created_at > now() - interval '1 day') >= v_max then
      raise exception 'you have shared % stories today; please come back tomorrow', v_max;
    end if;
    if p_challenge is not null then
      select * into c from public.challenges where id = p_challenge;
      if not found or public.challenge_phase(c) <> 'open' then raise exception 'this challenge is not taking entries right now'; end if;
      if exists (select 1 from public.stories where challenge_id = p_challenge and author_id = auth.uid() and status <> 'deleted') then
        raise exception 'you have already entered this challenge; you can edit your entry instead';
      end if;
    end if;
    v_slug := left(public.slugify(p_title), 70);
    if char_length(v_slug) < 3 then v_slug := 'story'; end if;
    v_slug := v_slug || '-' || substr(md5(random()::text || clock_timestamp()::text), 1, 5);
    v_status := case when v_trusted then 'published' else 'pending' end;
    insert into public.stories (slug, author_id, title, body, category, cover_path, link, challenge_id, status, published_at)
    values (v_slug, auth.uid(), left(p_title, 140), left(p_body, 20000), p_category, p_cover_path, p_link, p_challenge, v_status,
            case when v_status = 'published' then now() end)
    returning id into v_id;
    return v_id;
  end if;

  select * into s from public.stories where id = p_id and author_id = auth.uid() and status <> 'deleted';
  if not found then raise exception 'story not found'; end if;
  if s.status = 'removed' then raise exception 'this story was removed by a moderator and cannot be edited'; end if;
  if s.challenge_id is not null and (select public.challenge_phase(x) from public.challenges x where x.id = s.challenge_id) <> 'open' then
    raise exception 'challenge entries cannot be changed after entries close';
  end if;
  v_status := case when s.status = 'published' and v_trusted then 'published' else 'pending' end;
  update public.stories set title = left(p_title, 140), body = left(p_body, 20000), category = p_category, cover_path = p_cover_path, link = p_link,
    status = v_status, status_reason = case when v_status = 'pending' then null else status_reason end,
    published_at = case when v_status = 'published' then coalesce(published_at, now()) else published_at end, updated_at = now()
  where id = p_id;
  return p_id;
end $$;

create or replace function public.story_delete(p_id uuid) returns void
language plpgsql security definer set search_path = public as $$
begin
  update public.stories set status = 'deleted', updated_at = now() where id = p_id and author_id = auth.uid() and status <> 'deleted';
  if not found then raise exception 'story not found'; end if;
end $$;

create or replace function public.story_like(p_story uuid) returns boolean
language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null then raise exception 'sign in to like stories'; end if;
  if not exists (select 1 from public.stories where id = p_story and status = 'published') then raise exception 'story not found'; end if;
  delete from public.story_likes where story_id = p_story and user_id = auth.uid();
  if found then return false; end if;
  insert into public.story_likes (story_id, user_id) values (p_story, auth.uid());
  return true;
end $$;

create or replace function public.comment_add(p_story uuid, p_body text) returns bigint
language plpgsql security definer set search_path = public as $$
declare v bigint; s public.stories; v_max int := coalesce((select value::int from public.site_settings where key = 'community.comments_per_hour'), 20);
begin
  if auth.uid() is null then raise exception 'sign in to comment'; end if;
  if not exists (select 1 from public.profiles where id = auth.uid() and status = 'active') then raise exception 'account is not active'; end if;
  select * into s from public.stories where id = p_story and status = 'published';
  if not found then raise exception 'story not found'; end if;
  p_body := trim(coalesce(p_body, ''));
  if p_body = '' then raise exception 'write a comment first'; end if;
  if (select count(*) from public.story_comments where user_id = auth.uid() and created_at > now() - interval '1 hour') >= v_max then
    raise exception 'too many comments; please wait a while';
  end if;
  insert into public.story_comments (story_id, user_id, body) values (p_story, auth.uid(), left(p_body, 1000)) returning id into v;
  if s.author_id <> auth.uid() then
    perform public.notify(s.author_id, 'content', public.author_name(auth.uid()) || ' commented on your story', left(p_body, 200), '/s/' || s.slug);
  end if;
  return v;
end $$;

create or replace function public.comment_delete(p_id bigint) returns void
language plpgsql security definer set search_path = public as $$
begin
  update public.story_comments set status = 'deleted' where id = p_id and user_id = auth.uid() and status = 'visible';
  if not found then raise exception 'comment not found'; end if;
end $$;

create or replace function public.report_content(p_kind text, p_id text, p_reason text) returns void
language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null then raise exception 'sign in to report'; end if;
  if char_length(trim(coalesce(p_reason, ''))) < 3 then raise exception 'tell us briefly what is wrong'; end if;
  if (select count(*) from public.content_reports where reporter_id = auth.uid() and created_at > now() - interval '1 day') >= 20 then
    raise exception 'too many reports today';
  end if;
  if p_kind = 'story' then
    insert into public.content_reports (kind, story_id, reporter_id, reason) values ('story', p_id::uuid, auth.uid(), left(trim(p_reason), 500));
  elsif p_kind = 'comment' then
    insert into public.content_reports (kind, comment_id, story_id, reporter_id, reason)
    select 'comment', id, story_id, auth.uid(), left(trim(p_reason), 500) from public.story_comments where id = p_id::bigint;
  else raise exception 'unknown report';
  end if;
end $$;

create or replace function public.challenge_vote(p_story uuid) returns void
language plpgsql security definer set search_path = public as $$
declare s public.stories; c public.challenges;
begin
  if auth.uid() is null then raise exception 'sign in to vote'; end if;
  if not exists (select 1 from public.profiles where id = auth.uid() and status = 'active') then raise exception 'account is not active'; end if;
  select * into s from public.stories where id = p_story and status = 'published' and challenge_id is not null;
  if not found then raise exception 'this entry is not in a challenge'; end if;
  select * into c from public.challenges where id = s.challenge_id;
  if public.challenge_phase(c) not in ('open', 'voting') then raise exception 'voting is closed for this challenge'; end if;
  if s.author_id = auth.uid() then raise exception 'you cannot vote for your own entry'; end if;
  insert into public.challenge_votes (challenge_id, user_id, story_id) values (c.id, auth.uid(), p_story)
  on conflict (challenge_id, user_id) do update set story_id = excluded.story_id, created_at = now();
end $$;

-- ---------------------------------------------------------------------------------------------
-- Staff actions (all audited)
-- ---------------------------------------------------------------------------------------------
create or replace function public.admin_review_story(p_id uuid, p_decision text, p_note text default null) returns void
language plpgsql security definer set search_path = public as $$
declare s public.stories; v text;
begin
  if not public.has_permission('moderation.manage') then raise exception 'not allowed'; end if;
  select * into s from public.stories where id = p_id and status <> 'deleted'; if not found then raise exception 'story not found'; end if;
  if p_decision in ('publish', 'restore') then
    v := 'published';
    update public.stories set status = 'published', status_reason = null, published_at = coalesce(published_at, now()) where id = p_id;
    perform public.notify(s.author_id, 'content', 'Your story is live', s.title, '/s/' || s.slug);
  elsif p_decision in ('reject', 'remove') then
    if coalesce(trim(p_note), '') = '' then raise exception 'a reason is required; the writer will see it'; end if;
    v := case when p_decision = 'reject' then 'rejected' else 'removed' end;
    update public.stories set status = v, status_reason = left(trim(p_note), 500), featured_label = null, featured_at = null where id = p_id;
    perform public.notify(s.author_id, 'content', case when v = 'rejected' then 'Your story needs changes' else 'Your story was removed' end,
      left(trim(p_note), 300), '/community/write/?id=' || s.id);
  else raise exception 'use publish, reject, remove or restore';
  end if;
  update public.content_reports set status = 'actioned', handled_by = auth.uid() where story_id = p_id and kind = 'story' and status = 'open';
  perform public.log_action('story.' || p_decision, 'story', p_id::text, to_jsonb(s.status), to_jsonb(v), left(p_note, 500));
end $$;

create or replace function public.admin_feature_story(p_id uuid, p_label text) returns void
language plpgsql security definer set search_path = public as $$
declare s public.stories;
begin
  if not public.has_permission('moderation.manage') then raise exception 'not allowed'; end if;
  select * into s from public.stories where id = p_id and status = 'published'; if not found then raise exception 'only a live story can be featured'; end if;
  p_label := nullif(trim(coalesce(p_label, '')), '');
  update public.stories set featured_label = left(p_label, 60), featured_at = case when p_label is null then null else now() end where id = p_id;
  if p_label is not null then perform public.notify(s.author_id, 'content', 'Your story is featured: ' || left(p_label, 60), s.title, '/s/' || s.slug); end if;
  perform public.log_action('story.featured', 'story', p_id::text, to_jsonb(s.featured_label), to_jsonb(p_label));
end $$;

create or replace function public.admin_comment_remove(p_id bigint, p_note text) returns void
language plpgsql security definer set search_path = public as $$
declare c public.story_comments;
begin
  if not public.has_permission('moderation.manage') then raise exception 'not allowed'; end if;
  select * into c from public.story_comments where id = p_id; if not found then raise exception 'comment not found'; end if;
  update public.story_comments set status = 'removed' where id = p_id;
  update public.content_reports set status = 'actioned', handled_by = auth.uid() where comment_id = p_id and status = 'open';
  perform public.log_action('comment.removed', 'story_comment', p_id::text, to_jsonb(c.body), null, left(p_note, 500));
end $$;

create or replace function public.admin_report_dismiss(p_id bigint) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not public.has_permission('moderation.manage') then raise exception 'not allowed'; end if;
  update public.content_reports set status = 'dismissed', handled_by = auth.uid() where id = p_id and status = 'open';
  perform public.log_action('report.dismissed', 'content_report', p_id::text, null, null);
end $$;

create or replace function public.admin_list_reports()
returns table (id bigint, kind text, story_id uuid, story_slug text, story_title text, comment_id bigint, comment_body text, reason text, reporter text, created_at timestamptz)
language plpgsql stable security definer set search_path = public as $$
begin
  if not public.has_permission('moderation.manage') then raise exception 'not allowed'; end if;
  return query select r.id, r.kind, r.story_id, s.slug, s.title, r.comment_id, c.body, r.reason, public.author_name(r.reporter_id), r.created_at
    from public.content_reports r left join public.stories s on s.id = r.story_id left join public.story_comments c on c.id = r.comment_id
    where r.status = 'open' order by r.created_at;
end $$;

create or replace function public.admin_challenge_save(p_id smallint, p jsonb) returns smallint
language plpgsql security definer set search_path = public as $$
declare v smallint; b jsonb;
begin
  if not public.has_permission('challenges.manage') then raise exception 'not allowed'; end if;
  if p_id is null then
    insert into public.challenges (number, slug, title, brief, rules, prize, sponsor_name, sponsor_url, opens_at, entries_close_at, voting_close_at, judge_weight, published)
    values ((p->>'number')::smallint, lpad(p->>'number', 2, '0'), p->>'title', p->>'brief', coalesce(p->>'rules', ''), p->>'prize',
            nullif(p->>'sponsor_name', ''), nullif(p->>'sponsor_url', ''), (p->>'opens_at')::timestamptz, (p->>'entries_close_at')::timestamptz,
            (p->>'voting_close_at')::timestamptz, coalesce((p->>'judge_weight')::smallint, 70), coalesce((p->>'published')::boolean, false))
    returning id into v;
  else
    select to_jsonb(c) into b from public.challenges c where id = p_id; if b is null then raise exception 'unknown challenge'; end if;
    update public.challenges set title = p->>'title', brief = p->>'brief', rules = coalesce(p->>'rules', ''), prize = p->>'prize',
      sponsor_name = nullif(p->>'sponsor_name', ''), sponsor_url = nullif(p->>'sponsor_url', ''),
      opens_at = (p->>'opens_at')::timestamptz, entries_close_at = (p->>'entries_close_at')::timestamptz, voting_close_at = (p->>'voting_close_at')::timestamptz,
      judge_weight = coalesce((p->>'judge_weight')::smallint, judge_weight), published = coalesce((p->>'published')::boolean, published)
    where id = p_id;
    v := p_id;
  end if;
  perform public.log_action('challenge.saved', 'challenge', v::text, b, (select to_jsonb(c) from public.challenges c where id = v));
  return v;
end $$;

create or replace function public.judge_score(p_story uuid, p_score int, p_note text default null) returns void
language plpgsql security definer set search_path = public as $$
declare s public.stories;
begin
  if not public.has_permission('challenges.judge') then raise exception 'not allowed'; end if;
  select * into s from public.stories where id = p_story and challenge_id is not null and status = 'published';
  if not found then raise exception 'not a challenge entry'; end if;
  if s.author_id = auth.uid() then raise exception 'you cannot score your own entry'; end if;
  if (select results_at from public.challenges where id = s.challenge_id) is not null then raise exception 'results are already published'; end if;
  insert into public.challenge_scores (story_id, judge_id, score, note) values (p_story, auth.uid(), p_score, nullif(trim(coalesce(p_note, '')), ''))
  on conflict (story_id, judge_id) do update set score = excluded.score, note = excluded.note, updated_at = now();
end $$;

-- Ranking: judges' average (out of 10) scaled to judge_weight, plus votes scaled against the most voted entry.
create or replace function public.challenge_results(p_challenge smallint)
returns table (story_id uuid, slug text, title text, author text, votes bigint, judges bigint, judge_avg numeric, my_score smallint, total numeric)
language plpgsql stable security definer set search_path = public as $$
declare c public.challenges;
begin
  select * into c from public.challenges where id = p_challenge;
  if not found then raise exception 'unknown challenge'; end if;
  if c.results_at is null and not (public.has_permission('challenges.manage') or public.has_permission('challenges.judge')) then raise exception 'not allowed'; end if;
  return query
  with e as (
    select s.id, s.slug, s.title, public.author_name(s.author_id) as author,
      (select count(*) from public.challenge_votes v where v.story_id = s.id) as votes,
      (select count(*) from public.challenge_scores x where x.story_id = s.id) as judges,
      (select round(avg(x.score)::numeric, 2) from public.challenge_scores x where x.story_id = s.id) as judge_avg,
      (select x.score from public.challenge_scores x where x.story_id = s.id and x.judge_id = auth.uid()) as my_score
    from public.stories s where s.challenge_id = p_challenge and s.status = 'published'
  ), m as (select greatest(max(e.votes), 1) as top from e)
  select e.id, e.slug, e.title, e.author, e.votes, e.judges, e.judge_avg, e.my_score,
    round(coalesce(e.judge_avg, 0) / 10 * c.judge_weight + e.votes::numeric / m.top * (100 - c.judge_weight), 1)
  from e, m order by 9 desc, e.votes desc;
end $$;

create or replace function public.admin_challenge_winner(p_challenge smallint, p_story uuid, p_note text default null) returns void
language plpgsql security definer set search_path = public as $$
declare c public.challenges; s public.stories;
begin
  if not public.has_permission('challenges.manage') then raise exception 'not allowed'; end if;
  select * into c from public.challenges where id = p_challenge; if not found then raise exception 'unknown challenge'; end if;
  if now() < c.voting_close_at then raise exception 'wait until voting closes before declaring a winner'; end if;
  select * into s from public.stories where id = p_story and challenge_id = p_challenge and status = 'published';
  if not found then raise exception 'that story is not an entry in this challenge'; end if;
  update public.challenges set winner_story_id = p_story, winner_note = nullif(trim(coalesce(p_note, '')), ''), results_at = now() where id = p_challenge;
  update public.stories set featured_label = 'Winner, Challenge ' || c.slug, featured_at = now() where id = p_story;
  perform public.notify(s.author_id, 'content', 'You won TECH na PESA Challenge ' || c.slug || '!',
    'Congratulations. Our team will contact you on the phone number in your profile to send your prize: ' || c.prize, '/challenge/' || c.slug);
  perform public.log_action('challenge.winner', 'challenge', p_challenge::text, null, to_jsonb(p_story), p_note);
end $$;

-- winner's contact for prize delivery (staff only)
create or replace function public.admin_challenge_contact(p_challenge smallint)
returns table (name text, phone text, email text) language plpgsql stable security definer set search_path = public as $$
begin
  if not public.has_permission('challenges.manage') then raise exception 'not allowed'; end if;
  return query select coalesce(p.full_name, p.display_name), p.phone, u.email::text
    from public.challenges c join public.stories s on s.id = c.winner_story_id join public.profiles p on p.id = s.author_id join auth.users u on u.id = s.author_id
    where c.id = p_challenge;
end $$;

-- ---------------------------------------------------------------------------------------------
-- Public views (only published content; author shown by name and photo, never email or phone)
-- ---------------------------------------------------------------------------------------------
create view public.community_feed with (security_barrier = true) as
  select s.id, s.slug, s.title, s.body, s.category, s.cover_path, s.link, s.challenge_id, ch.slug as challenge_slug,
         s.like_count, s.comment_count, s.featured_label, s.featured_at, s.published_at, s.updated_at,
         s.author_id, public.author_name(s.author_id) as author_name, p.avatar_path as author_avatar, co.name as author_county
  from public.stories s
  join public.profiles p on p.id = s.author_id and p.status = 'active'
  left join public.counties co on co.id = p.county_id
  left join public.challenges ch on ch.id = s.challenge_id
  where s.status = 'published';

create view public.community_comments with (security_barrier = true) as
  select c.id, c.story_id, c.body, c.created_at, c.user_id, public.author_name(c.user_id) as author_name, p.avatar_path as author_avatar
  from public.story_comments c
  join public.stories s on s.id = c.story_id and s.status = 'published'
  join public.profiles p on p.id = c.user_id and p.status = 'active'
  where c.status = 'visible';

create view public.challenge_list with (security_barrier = true) as
  select c.id, c.number, c.slug, c.title, c.brief, c.rules, c.prize, c.sponsor_name, c.sponsor_url, c.sponsor_logo_path,
         c.opens_at, c.entries_close_at, c.voting_close_at, c.judge_weight, public.challenge_phase(c) as phase,
         c.winner_story_id, c.winner_note, c.results_at,
         (select count(*) from public.stories s where s.challenge_id = c.id and s.status = 'published') as entries
  from public.challenges c where c.published;

create view public.author_profiles with (security_barrier = true) as
  select p.id, public.author_name(p.id) as name, p.avatar_path, co.name as county,
         (select count(*) from public.stories s where s.author_id = p.id and s.status = 'published') as stories
  from public.profiles p left join public.counties co on co.id = p.county_id
  where p.status = 'active' and exists (select 1 from public.stories s where s.author_id = p.id and s.status = 'published');

-- ---------------------------------------------------------------------------------------------
-- Row level security and grants
-- ---------------------------------------------------------------------------------------------
alter table public.challenges enable row level security;
alter table public.stories enable row level security;
alter table public.story_likes enable row level security;
alter table public.story_comments enable row level security;
alter table public.content_reports enable row level security;
alter table public.challenge_votes enable row level security;
alter table public.challenge_scores enable row level security;

create policy "challenges for managers" on public.challenges for select using (published or public.has_permission('challenges.manage'));
create policy "own or moderated stories" on public.stories for select using (author_id = auth.uid() or public.has_permission('moderation.manage') or (status = 'published' and public.has_permission('challenges.judge')));
create policy "own likes" on public.story_likes for select using (user_id = auth.uid());
create policy "own or moderated comments" on public.story_comments for select using (user_id = auth.uid() or public.has_permission('moderation.manage'));
create policy "own or moderated reports" on public.content_reports for select using (reporter_id = auth.uid() or public.has_permission('moderation.manage'));
create policy "own votes" on public.challenge_votes for select using (user_id = auth.uid() or public.has_permission('challenges.manage'));
create policy "own scores" on public.challenge_scores for select using (judge_id = auth.uid() or public.has_permission('challenges.manage'));

revoke all on public.challenges, public.stories, public.story_likes, public.story_comments, public.content_reports, public.challenge_votes,
  public.challenge_scores, public.community_feed, public.community_comments, public.challenge_list, public.author_profiles from anon, authenticated;
grant all on public.challenges, public.stories, public.story_likes, public.story_comments, public.content_reports, public.challenge_votes,
  public.challenge_scores, public.community_feed, public.community_comments, public.challenge_list, public.author_profiles to service_role;
grant select on public.community_feed, public.community_comments, public.challenge_list, public.author_profiles to anon, authenticated;
grant select on public.challenges, public.stories, public.story_likes, public.story_comments, public.content_reports, public.challenge_votes, public.challenge_scores to authenticated;

revoke execute on function public.author_name(uuid), public.challenge_phase(public.challenges), public.story_counts(),
  public.story_save(uuid, text, text, text, text, text, smallint), public.story_delete(uuid), public.story_like(uuid),
  public.comment_add(uuid, text), public.comment_delete(bigint), public.report_content(text, text, text), public.challenge_vote(uuid),
  public.admin_review_story(uuid, text, text), public.admin_feature_story(uuid, text), public.admin_comment_remove(bigint, text),
  public.admin_report_dismiss(bigint), public.admin_list_reports(), public.admin_challenge_save(smallint, jsonb), public.judge_score(uuid, int, text),
  public.challenge_results(smallint), public.admin_challenge_winner(smallint, uuid, text), public.admin_challenge_contact(smallint) from public, anon, authenticated;
grant execute on function public.challenge_results(smallint), public.author_name(uuid), public.challenge_phase(public.challenges) to anon, authenticated;
grant execute on function public.story_save(uuid, text, text, text, text, text, smallint), public.story_delete(uuid), public.story_like(uuid),
  public.comment_add(uuid, text), public.comment_delete(bigint), public.report_content(text, text, text), public.challenge_vote(uuid),
  public.admin_review_story(uuid, text, text), public.admin_feature_story(uuid, text), public.admin_comment_remove(bigint, text),
  public.admin_report_dismiss(bigint), public.admin_list_reports(), public.admin_challenge_save(smallint, jsonb), public.judge_score(uuid, int, text),
  public.challenge_results(smallint), public.admin_challenge_winner(smallint, uuid, text), public.admin_challenge_contact(smallint) to authenticated;
grant execute on all functions in schema public to service_role;

-- ---------------------------------------------------------------------------------------------
-- Challenge 01, sponsored by Kyandu Bright Academy (texts and dates can be changed in Admin, Challenges)
-- ---------------------------------------------------------------------------------------------
insert into public.challenges (number, slug, title, brief, rules, prize, sponsor_name, opens_at, entries_close_at, voting_close_at, judge_weight, published)
values (1, '01', 'My Tech na Pesa Story',
  'Tell us how technology helped you earn, save, learn or solve a problem. It could be your first M-PESA business, a skill you learnt on YouTube, a side hustle you run from your phone, a farm or shop you grew with WhatsApp, or a lesson about money you learnt the hard way. Write it in your own words, add a photo if you have one, and share it with your friends so they can vote.',
  E'Free to enter. There is no fee to enter or to vote, and nothing to buy.\n'
  'One entry per person. Your entry must be your own true story, written by you, in English or Kiswahili.\n'
  'Entries open now and close on Sunday 30 November 2026 at 11.59 pm. Public voting stays open until Saturday 6 December 2026 at 11.59 pm.\n'
  'Every signed in reader has one vote in this challenge and can move it to another entry until voting closes. You cannot vote for your own entry.\n'
  'The winner is decided by our judges, who score each entry for originality, usefulness to other readers and storytelling (70 percent of the result). Public votes make up the other 30 percent.\n'
  'Entries that copy someone else''s work, attack or mislead people, or break our terms of use are removed.\n'
  'The winner is announced on TECH na PESA and our Facebook Page. The prize of KSh 500 airtime is sent to the phone number in the winner''s profile, so add yours in My account.\n'
  'The judges'' decision is final.',
  'KSh 500 airtime', 'Kyandu Bright Academy',
  '2026-11-16 00:00:00+03', '2026-11-30 23:59:59+03', '2026-12-06 23:59:59+03', 70, true);
