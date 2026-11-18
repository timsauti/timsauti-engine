-- TnPVibe phase 2: communities, TnP Circles, stories, introductions, polls, events, Ask the Community,
-- Member Spotlight and reward points for taking part. Builds on the phase 1 tables and rules.

-- ---------------------------------------------------------------------------------------------
-- Communities
-- ---------------------------------------------------------------------------------------------
create table public.vibe_communities (
  id bigint generated always as identity primary key,
  slug text not null unique check (slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$' and char_length(slug) between 3 and 60),
  name text not null check (char_length(name) between 3 and 60),
  description text not null default '' check (char_length(description) <= 600),
  category text not null check (category in ('technology', 'entrepreneurship', 'education', 'business', 'careers', 'agriculture', 'entertainment', 'sports', 'creativity', 'personal-development', 'lifestyle', 'professional-networking', 'faith', 'health')),
  cover_path text,
  rules text not null default '' check (char_length(rules) <= 2000),
  visibility text not null default 'public' check (visibility in ('public', 'private')),
  created_by uuid not null references public.vibe_profiles(user_id) on delete cascade,
  members_count integer not null default 0,
  status text not null default 'active' check (status in ('active', 'removed')),
  created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);
create index vibe_communities_cat on public.vibe_communities (category, members_count desc) where status = 'active';
create table public.vibe_community_members (
  community_id bigint not null references public.vibe_communities(id) on delete cascade,
  user_id uuid not null references public.vibe_profiles(user_id) on delete cascade,
  role text not null default 'member' check (role in ('owner', 'admin', 'moderator', 'member')),
  status text not null default 'active' check (status in ('active', 'pending', 'banned')),
  created_at timestamptz not null default now(),
  primary key (community_id, user_id)
);
create index vibe_cm_user on public.vibe_community_members (user_id, status);

-- ---------------------------------------------------------------------------------------------
-- Circles: small invite only groups with a group chat and shared updates
-- ---------------------------------------------------------------------------------------------
create table public.vibe_circles (
  id uuid primary key default gen_random_uuid(),
  name text not null check (char_length(name) between 2 and 50),
  description text not null default '' check (char_length(description) <= 300),
  purpose text not null default 'friends' check (purpose in ('friends', 'colleagues', 'project', 'study', 'business', 'interest')),
  owner_id uuid not null references public.vibe_profiles(user_id) on delete cascade,
  conversation_id uuid not null unique references public.vibe_conversations(id) on delete cascade,
  created_at timestamptz not null default now()
);
create table public.vibe_circle_members (
  circle_id uuid not null references public.vibe_circles(id) on delete cascade,
  user_id uuid not null references public.vibe_profiles(user_id) on delete cascade,
  status text not null default 'invited' check (status in ('invited', 'active')),
  invited_by uuid references public.vibe_profiles(user_id) on delete set null,
  created_at timestamptz not null default now(),
  primary key (circle_id, user_id)
);
alter table public.vibe_conversations add column circle_id uuid;

-- ---------------------------------------------------------------------------------------------
-- Posts gain communities, circles, questions and polls
-- ---------------------------------------------------------------------------------------------
alter table public.vibe_posts
  add column community_id bigint references public.vibe_communities(id) on delete cascade,
  add column circle_id uuid references public.vibe_circles(id) on delete cascade,
  add column category text check (category is null or char_length(category) <= 40),
  add column accepted_comment_id bigint references public.vibe_comments(id) on delete set null,
  drop constraint vibe_posts_kind_check,
  add constraint vibe_posts_kind_check check (kind in ('post', 'question', 'announcement', 'experience', 'idea', 'achievement', 'update', 'introduction', 'poll'));
create index vibe_posts_community on public.vibe_posts (community_id, id desc) where community_id is not null;
create index vibe_posts_circle on public.vibe_posts (circle_id, id desc) where circle_id is not null;
create index vibe_posts_questions on public.vibe_posts (id desc) where kind = 'question' and removed_at is null;

create table public.vibe_comment_likes (
  comment_id bigint not null references public.vibe_comments(id) on delete cascade,
  user_id uuid not null references public.vibe_profiles(user_id) on delete cascade,
  primary key (comment_id, user_id)
);
alter table public.vibe_comments add column likes_count integer not null default 0;

create table public.vibe_polls (
  post_id bigint primary key references public.vibe_posts(id) on delete cascade,
  closes_at timestamptz,
  anonymous boolean not null default true,
  multiple boolean not null default false
);
create table public.vibe_poll_options (
  id bigint generated always as identity primary key,
  post_id bigint not null references public.vibe_polls(post_id) on delete cascade,
  label text not null check (char_length(trim(label)) between 1 and 80),
  position smallint not null,
  votes integer not null default 0
);
create table public.vibe_poll_votes (
  post_id bigint not null references public.vibe_polls(post_id) on delete cascade,
  option_id bigint not null references public.vibe_poll_options(id) on delete cascade,
  user_id uuid not null references public.vibe_profiles(user_id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (option_id, user_id)
);
create index vibe_poll_votes_post on public.vibe_poll_votes (post_id, user_id);

-- ---------------------------------------------------------------------------------------------
-- Stories (24 hours)
-- ---------------------------------------------------------------------------------------------
alter table public.vibe_profiles add column story_visibility text not null default 'followers' check (story_visibility in ('followers', 'members'));
create table public.vibe_stories (
  id bigint generated always as identity primary key,
  author_id uuid not null references public.vibe_profiles(user_id) on delete cascade,
  media_path text,
  body text not null default '' check (char_length(body) <= 300),
  background text not null default 'blue' check (background in ('blue', 'green', 'navy', 'sunset', 'purple')),
  created_at timestamptz not null default now(),
  expires_at timestamptz not null default now() + interval '24 hours',
  check (media_path is not null or char_length(trim(body)) > 0)
);
create index vibe_stories_live on public.vibe_stories (author_id, expires_at);
create table public.vibe_story_views (
  story_id bigint not null references public.vibe_stories(id) on delete cascade,
  viewer_id uuid not null references public.vibe_profiles(user_id) on delete cascade,
  viewed_at timestamptz not null default now(),
  primary key (story_id, viewer_id)
);

-- ---------------------------------------------------------------------------------------------
-- Events
-- ---------------------------------------------------------------------------------------------
create table public.vibe_events (
  id bigint generated always as identity primary key,
  organiser_id uuid not null references public.vibe_profiles(user_id) on delete cascade,
  community_id bigint references public.vibe_communities(id) on delete set null,
  title text not null check (char_length(title) between 5 and 100),
  description text not null default '' check (char_length(description) <= 3000),
  category text not null default 'meetup' check (category in ('meetup', 'training', 'webinar', 'networking', 'sports', 'faith', 'business', 'community', 'other')),
  mode text not null check (mode in ('online', 'physical')),
  venue text check (venue is null or char_length(venue) <= 160),
  online_link text check (online_link is null or online_link ~ '^https://'),
  starts_at timestamptz not null, ends_at timestamptz,
  cover_path text,
  capacity integer check (capacity is null or capacity between 2 and 100000),
  going_count integer not null default 0,
  status text not null default 'scheduled' check (status in ('scheduled', 'cancelled', 'removed')),
  reminded_at timestamptz,
  created_at timestamptz not null default now(),
  check (ends_at is null or ends_at > starts_at),
  check (mode = 'online' and online_link is not null or mode = 'physical' and venue is not null)
);
create index vibe_events_upcoming on public.vibe_events (starts_at) where status = 'scheduled';
create table public.vibe_event_rsvps (
  event_id bigint not null references public.vibe_events(id) on delete cascade,
  user_id uuid not null references public.vibe_profiles(user_id) on delete cascade,
  status text not null check (status in ('going', 'interested')),
  created_at timestamptz not null default now(),
  primary key (event_id, user_id)
);

-- ---------------------------------------------------------------------------------------------
-- Member Spotlight
-- ---------------------------------------------------------------------------------------------
create table public.vibe_spotlights (
  id bigint generated always as identity primary key,
  user_id uuid not null references public.vibe_profiles(user_id) on delete cascade,
  title text not null check (char_length(title) between 5 and 100),
  story text not null check (char_length(story) between 20 and 1500),
  featured_by uuid references auth.users(id) on delete set null,
  active boolean not null default true,
  created_at timestamptz not null default now()
);

alter table public.vibe_communities enable row level security;
alter table public.vibe_community_members enable row level security;
alter table public.vibe_circles enable row level security;
alter table public.vibe_circle_members enable row level security;
alter table public.vibe_comment_likes enable row level security;
alter table public.vibe_polls enable row level security;
alter table public.vibe_poll_options enable row level security;
alter table public.vibe_poll_votes enable row level security;
alter table public.vibe_stories enable row level security;
alter table public.vibe_story_views enable row level security;
alter table public.vibe_events enable row level security;
alter table public.vibe_event_rsvps enable row level security;
alter table public.vibe_spotlights enable row level security;

-- ---------------------------------------------------------------------------------------------
-- Access helpers
-- ---------------------------------------------------------------------------------------------
create or replace function public.vibe_cm_role(p_comm bigint, u uuid default auth.uid()) returns text language sql stable security definer set search_path = public as $$
  select role from public.vibe_community_members where community_id = p_comm and user_id = u and status = 'active';
$$;
create or replace function public.vibe_can_see_community(viewer uuid, p_comm bigint) returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.vibe_communities c where c.id = p_comm and c.status = 'active'
    and (c.visibility = 'public' or public.vibe_cm_role(c.id, viewer) is not null));
$$;
create or replace function public.vibe_in_circle(p_circle uuid, u uuid default auth.uid()) returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.vibe_circle_members where circle_id = p_circle and user_id = u and status = 'active');
$$;

-- A post is visible when its author is visible, it is not removed, and its community or circle allows the viewer.
create or replace function public.vibe_can_see_post(viewer uuid, p_id bigint) returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.vibe_posts p where p.id = p_id and p.removed_at is null and public.vibe_can_see(viewer, p.author_id)
    and (p.community_id is null or public.vibe_can_see_community(viewer, p.community_id))
    and (p.circle_id is null or public.vibe_in_circle(p.circle_id, viewer)));
$$;

create or replace function public.vibe_post_json(p public.vibe_posts, viewer uuid) returns jsonb language sql stable security definer set search_path = public as $$
  select jsonb_build_object('id', p.id, 'kind', p.kind, 'body', p.body, 'media', p.media, 'created_at', p.created_at, 'edited_at', p.edited_at,
    'likes', p.likes_count, 'comments', p.comments_count, 'liked', exists (select 1 from public.vibe_likes l where l.post_id = p.id and l.user_id = viewer),
    'mine', p.author_id = viewer, 'featured', p.featured_on_profile, 'author', public.vibe_card(p.author_id, viewer),
    'category', p.category, 'accepted_comment_id', p.accepted_comment_id,
    'community', (select jsonb_build_object('slug', c.slug, 'name', c.name) from public.vibe_communities c where c.id = p.community_id),
    'can_moderate', p.community_id is not null and public.vibe_cm_role(p.community_id, viewer) in ('owner', 'admin', 'moderator'),
    'circle_id', p.circle_id,
    'poll', (select jsonb_build_object('closes_at', pl.closes_at, 'anonymous', pl.anonymous, 'multiple', pl.multiple,
               'closed', pl.closes_at is not null and pl.closes_at < now(),
               'total', (select count(distinct user_id) from public.vibe_poll_votes v where v.post_id = p.id),
               'options', (select jsonb_agg(jsonb_build_object('id', o.id, 'label', o.label, 'votes', o.votes,
                  'mine', exists (select 1 from public.vibe_poll_votes v where v.option_id = o.id and v.user_id = viewer)) order by o.position) from public.vibe_poll_options o where o.post_id = p.id))
             from public.vibe_polls pl where pl.post_id = p.id));
$$;

-- ---------------------------------------------------------------------------------------------
-- Posts: one save function for every kind and place
-- ---------------------------------------------------------------------------------------------
drop function public.vibe_post_save(bigint, text, text, text[]);
create or replace function public.vibe_post_save(p_id bigint, p_kind text, p_body text, p_media text[] default '{}', p_community bigint default null, p_circle uuid default null,
  p_category text default null, p_poll jsonb default null) returns jsonb
language plpgsql security definer set search_path = public as $$
declare me uuid := public.vibe_need_me(); r public.vibe_posts; m text; opt text; i int := 0;
begin
  foreach m in array coalesce(p_media, '{}') loop
    if m !~ ('^' || me::text || '/[A-Za-z0-9._/-]+$') then raise exception 'photos must be uploaded from your own account'; end if;
  end loop;
  if (select status from public.vibe_profiles where user_id = me) = 'restricted' then raise exception 'your account cannot post right now'; end if;
  if p_id is null then
    if p_community is not null and public.vibe_cm_role(p_community, me) is null then raise exception 'join the community to post in it'; end if;
    if p_circle is not null and not public.vibe_in_circle(p_circle, me) then raise exception 'only circle members can post here'; end if;
    if p_kind = 'announcement' and p_community is not null and public.vibe_cm_role(p_community, me) not in ('owner', 'admin', 'moderator') then raise exception 'only community leaders can post announcements'; end if;
    perform public.vibe_rate('vibe_posts', 'author_id', 20, interval '1 hour', 'posts');
    if p_kind = 'poll' then
      if p_poll is null or jsonb_array_length(coalesce(p_poll->'options', '[]')) not between 2 and 6 then raise exception 'a poll needs 2 to 6 options'; end if;
      if char_length(trim(coalesce(p_body, ''))) < 5 then raise exception 'write the poll question'; end if;
    end if;
    insert into public.vibe_posts (author_id, kind, body, media, community_id, circle_id, category)
    values (me, coalesce(p_kind, 'post'), trim(coalesce(p_body, '')), coalesce(p_media, '{}'), p_community, p_circle, nullif(left(trim(coalesce(p_category, '')), 40), '')) returning * into r;
    if p_kind = 'poll' then
      insert into public.vibe_polls (post_id, closes_at, anonymous, multiple)
      values (r.id, case when (p_poll->>'days') is not null then now() + make_interval(days => least(greatest((p_poll->>'days')::int, 1), 30)) end,
              coalesce((p_poll->>'anonymous')::boolean, true), coalesce((p_poll->>'multiple')::boolean, false));
      for opt in select jsonb_array_elements_text(p_poll->'options') loop
        i := i + 1;
        if char_length(trim(opt)) > 0 then insert into public.vibe_poll_options (post_id, label, position) values (r.id, left(trim(opt), 80), i); end if;
      end loop;
      if (select count(*) from public.vibe_poll_options where post_id = r.id) < 2 then raise exception 'a poll needs at least 2 options'; end if;
    end if;
  else
    update public.vibe_posts set body = trim(coalesce(p_body, '')), media = coalesce(p_media, media), category = coalesce(nullif(trim(coalesce(p_category, '')), ''), category), edited_at = now()
    where id = p_id and author_id = me and removed_at is null returning * into r;
    if r.id is null then raise exception 'post not found'; end if;
  end if;
  return public.vibe_post_json(r, me);
end $$;

-- p_scope: following, all, user:<username>, community:<slug>, circle:<id>, questions
create or replace function public.vibe_feed(p_scope text default 'following', p_before bigint default null, p_kind text default null) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare me uuid := auth.uid(); owner uuid; comm bigint; circ uuid;
begin
  if p_scope like 'user:%' then
    owner := (select user_id from public.vibe_profiles where username = lower(substr(p_scope, 6)));
    if owner is null or not public.vibe_can_see(me, owner) then return '[]'; end if;
  elsif p_scope like 'community:%' then
    comm := (select id from public.vibe_communities where slug = substr(p_scope, 11));
    if comm is null or not public.vibe_can_see_community(me, comm) then return '[]'; end if;
  elsif p_scope like 'circle:%' then
    circ := nullif(substr(p_scope, 8), '')::uuid;
    if not public.vibe_in_circle(circ, me) then return '[]'; end if;
  end if;
  return coalesce((select jsonb_agg(public.vibe_post_json(p, me) order by p.id desc) from (
    select p.* from public.vibe_posts p join public.vibe_profiles v on v.user_id = p.author_id
    where p.removed_at is null and (p_before is null or p.id < p_before) and (p_kind is null or p.kind = p_kind)
      and (v.status = 'active' or p.author_id = me)
      and case
        when p_scope = 'following' then p.circle_id is null and (
             (p.community_id is null and (p.author_id = me or exists (select 1 from public.vibe_follows f where f.follower = me and f.followee = p.author_id)))
             or (p.community_id is not null and public.vibe_cm_role(p.community_id, me) is not null))
        when p_scope like 'user:%' then p.author_id = owner and p.circle_id is null and (p.community_id is null or public.vibe_can_see_community(me, p.community_id))
        when p_scope like 'community:%' then p.community_id = comm
        when p_scope like 'circle:%' then p.circle_id = circ
        when p_scope = 'questions' then p.kind = 'question' and p.circle_id is null and (p.community_id is null or public.vibe_can_see_community(me, p.community_id))
        else p.circle_id is null and (p.community_id is null or exists (select 1 from public.vibe_communities c where c.id = p.community_id and c.visibility = 'public' and c.status = 'active'))
      end
      and public.vibe_can_see(me, p.author_id)
      and not exists (select 1 from public.vibe_mutes mu where mu.muter = me and mu.muted = p.author_id and p_scope not like 'user:%')
    order by p.id desc limit 20) p), '[]');
end $$;

-- Questions search
create or replace function public.vibe_questions(p_q text default '', p_category text default '', p_before bigint default null) returns jsonb
language sql stable security definer set search_path = public as $$
  select coalesce(jsonb_agg(public.vibe_post_json(p, auth.uid()) order by p.id desc), '[]') from (
    select p.* from public.vibe_posts p
    where p.kind = 'question' and p.removed_at is null and p.circle_id is null and (p_before is null or p.id < p_before)
      and (coalesce(p_q, '') = '' or p.body ilike '%' || trim(p_q) || '%')
      and (coalesce(p_category, '') = '' or p.category = p_category)
      and (p.community_id is null or public.vibe_can_see_community(auth.uid(), p.community_id))
      and public.vibe_can_see(auth.uid(), p.author_id)
    order by p.id desc limit 20) p;
$$;

create or replace function public.vibe_comments_list(p_post bigint) returns jsonb
language sql stable security definer set search_path = public as $$
  select case when public.vibe_can_see_post(auth.uid(), p_post) then coalesce((select jsonb_agg(jsonb_build_object('id', c.id, 'body', c.body, 'parent_id', c.parent_id, 'created_at', c.created_at,
      'mine', c.author_id = auth.uid(),
      'can_delete', c.author_id = auth.uid() or po.author_id = auth.uid() or (po.community_id is not null and public.vibe_cm_role(po.community_id) in ('owner', 'admin', 'moderator')),
      'likes', c.likes_count, 'liked', exists (select 1 from public.vibe_comment_likes l where l.comment_id = c.id and l.user_id = auth.uid()),
      'accepted', po.accepted_comment_id = c.id,
      'author', public.vibe_card(c.author_id)) order by (po.accepted_comment_id = c.id) desc nulls last, coalesce(c.parent_id, c.id), c.id)
    from public.vibe_comments c join public.vibe_posts po on po.id = c.post_id
    where c.post_id = p_post and c.removed_at is null and public.vibe_can_see(auth.uid(), c.author_id)), '[]') else '[]' end;
$$;

create or replace function public.vibe_comment_delete(p_id bigint) returns void
language plpgsql security definer set search_path = public as $$
declare me uuid := public.vibe_need_me(); c public.vibe_comments; po public.vibe_posts; n int;
begin
  select * into c from public.vibe_comments where id = p_id;
  select * into po from public.vibe_posts where id = c.post_id;
  if c.id is null or not (c.author_id = me or po.author_id = me or (po.community_id is not null and public.vibe_cm_role(po.community_id, me) in ('owner', 'admin', 'moderator'))) then raise exception 'comment not found'; end if;
  select 1 + (select count(*) from public.vibe_comments where parent_id = c.id) into n;
  delete from public.vibe_comments where id = p_id;
  update public.vibe_posts set comments_count = greatest(comments_count - n, 0) where id = c.post_id;
end $$;

create or replace function public.vibe_comment_like(p_comment bigint, p_on boolean) returns integer
language plpgsql security definer set search_path = public as $$
declare me uuid := public.vibe_need_me(); n int; pid bigint;
begin
  select post_id into pid from public.vibe_comments where id = p_comment and removed_at is null;
  if pid is null or not public.vibe_can_see_post(me, pid) then raise exception 'comment not found'; end if;
  if p_on then insert into public.vibe_comment_likes values (p_comment, me) on conflict do nothing; get diagnostics n = row_count;
    if n > 0 then update public.vibe_comments set likes_count = likes_count + 1 where id = p_comment; end if;
  else delete from public.vibe_comment_likes where comment_id = p_comment and user_id = me; get diagnostics n = row_count;
    if n > 0 then update public.vibe_comments set likes_count = greatest(likes_count - 1, 0) where id = p_comment; end if;
  end if;
  return (select likes_count from public.vibe_comments where id = p_comment);
end $$;

-- The person who asked marks the most helpful answer.
create or replace function public.vibe_accept_answer(p_post bigint, p_comment bigint) returns void
language plpgsql security definer set search_path = public as $$
declare me uuid := public.vibe_need_me(); a uuid;
begin
  if not exists (select 1 from public.vibe_posts where id = p_post and author_id = me and kind = 'question') then raise exception 'only the person who asked can choose the helpful answer'; end if;
  if p_comment is not null then
    select author_id into a from public.vibe_comments where id = p_comment and post_id = p_post and removed_at is null;
    if a is null then raise exception 'answer not found'; end if;
  end if;
  update public.vibe_posts set accepted_comment_id = p_comment where id = p_post;
  if a is not null and a <> me then
    perform public.notify(a, 'social', public.vibe_name(me) || ' marked your answer as the most helpful', null, '/vibe/p/?id=' || p_post);
    perform public.reward_points(a, 'vibe_answer', p_post::text);
  end if;
end $$;

-- Community leaders can remove posts in their community.
create or replace function public.vibe_community_remove_post(p_post bigint, p_reason text default null) returns void
language plpgsql security definer set search_path = public as $$
declare me uuid := public.vibe_need_me(); po public.vibe_posts;
begin
  select * into po from public.vibe_posts where id = p_post;
  if po.community_id is null or public.vibe_cm_role(po.community_id, me) not in ('owner', 'admin', 'moderator') then raise exception 'not allowed'; end if;
  update public.vibe_posts set removed_at = now(), removed_reason = coalesce(nullif(trim(p_reason), ''), 'removed by community moderators') where id = p_post;
  if po.author_id <> me then perform public.notify(po.author_id, 'social', 'A community moderator removed your post', coalesce(p_reason, 'It did not follow the community rules.'), '/vibe/c/' || (select slug from public.vibe_communities where id = po.community_id)); end if;
  perform public.log_action('vibe.community.post_removed', 'vibe_post', p_post::text, null, null, p_reason);
end $$;

-- ---------------------------------------------------------------------------------------------
-- Polls
-- ---------------------------------------------------------------------------------------------
create or replace function public.vibe_poll_vote(p_post bigint, p_options bigint[]) returns jsonb
language plpgsql security definer set search_path = public as $$
declare me uuid := public.vibe_need_me(); pl public.vibe_polls;
begin
  select * into pl from public.vibe_polls where post_id = p_post;
  if pl.post_id is null or not public.vibe_can_see_post(me, p_post) then raise exception 'poll not found'; end if;
  if pl.closes_at is not null and pl.closes_at < now() then raise exception 'this poll has closed'; end if;
  if cardinality(coalesce(p_options, '{}')) = 0 then raise exception 'choose an option'; end if;
  if not pl.multiple and cardinality(p_options) > 1 then raise exception 'choose one option'; end if;
  if exists (select 1 from unnest(p_options) o where o not in (select id from public.vibe_poll_options where post_id = p_post)) then raise exception 'that option is not in this poll'; end if;
  -- changing a vote replaces it
  update public.vibe_poll_options o set votes = greatest(votes - 1, 0) from public.vibe_poll_votes v where v.option_id = o.id and v.post_id = p_post and v.user_id = me;
  delete from public.vibe_poll_votes where post_id = p_post and user_id = me;
  insert into public.vibe_poll_votes (post_id, option_id, user_id) select p_post, o, me from unnest(p_options) o;
  update public.vibe_poll_options set votes = votes + 1 where id = any (p_options);
  return public.vibe_post_json((select p from public.vibe_posts p where p.id = p_post), me)->'poll';
end $$;

-- ---------------------------------------------------------------------------------------------
-- Communities: create, join, leave, approve, roles
-- ---------------------------------------------------------------------------------------------
create or replace function public.vibe_community_json(c public.vibe_communities, viewer uuid) returns jsonb language sql stable security definer set search_path = public as $$
  select jsonb_build_object('id', c.id, 'slug', c.slug, 'name', c.name, 'description', c.description, 'category', c.category, 'cover', c.cover_path,
    'rules', c.rules, 'visibility', c.visibility, 'members', c.members_count, 'created_at', c.created_at,
    'my_role', public.vibe_cm_role(c.id, viewer),
    'my_status', (select status from public.vibe_community_members where community_id = c.id and user_id = viewer),
    'pending', case when public.vibe_cm_role(c.id, viewer) in ('owner', 'admin', 'moderator') then (select count(*) from public.vibe_community_members where community_id = c.id and status = 'pending') end,
    'creator', public.vibe_card(c.created_by, viewer));
$$;

create or replace function public.vibe_community_save(p jsonb) returns jsonb
language plpgsql security definer set search_path = public as $$
declare me uuid := public.vibe_need_me(); c public.vibe_communities; id_in bigint := nullif(p->>'id', '')::bigint; s text;
begin
  if (select status from public.vibe_profiles where user_id = me) = 'restricted' then raise exception 'your account cannot create communities right now'; end if;
  if nullif(p->>'cover_path', '') is not null and (p->>'cover_path') !~ ('^' || me::text || '/') then raise exception 'photos must be uploaded from your own account'; end if;
  if id_in is null then
    if (select count(*) from public.vibe_communities where created_by = me and created_at > now() - interval '1 day') >= 3 then raise exception 'you can create up to 3 communities a day'; end if;
    s := trim(both '-' from regexp_replace(lower(coalesce(p->>'name', '')), '[^a-z0-9]+', '-', 'g'));
    if char_length(s) < 3 then s := s || '-group'; end if;
    s := left(s, 50);
    if exists (select 1 from public.vibe_communities where slug = s) then s := left(s, 44) || '-' || substr(md5(random()::text), 1, 5); end if;
    insert into public.vibe_communities (slug, name, description, category, cover_path, rules, visibility, created_by)
    values (s, trim(p->>'name'), left(trim(coalesce(p->>'description', '')), 600), p->>'category', nullif(p->>'cover_path', ''), left(trim(coalesce(p->>'rules', '')), 2000), coalesce(p->>'visibility', 'public'), me)
    returning * into c;
    insert into public.vibe_community_members (community_id, user_id, role) values (c.id, me, 'owner');
  else
    if public.vibe_cm_role(id_in, me) not in ('owner', 'admin') then raise exception 'only community admins can change it'; end if;
    update public.vibe_communities set
      name = coalesce(nullif(trim(p->>'name'), ''), name), description = case when p ? 'description' then left(trim(p->>'description'), 600) else description end,
      category = coalesce(p->>'category', category), cover_path = case when p ? 'cover_path' then nullif(p->>'cover_path', '') else cover_path end,
      rules = case when p ? 'rules' then left(trim(p->>'rules'), 2000) else rules end, visibility = coalesce(p->>'visibility', visibility), updated_at = now()
    where id = id_in returning * into c;
  end if;
  return public.vibe_community_json(c, me);
end $$;

create or replace function public.vibe_community_counts() returns trigger language plpgsql security definer set search_path = public as $$
begin
  update public.vibe_communities set members_count = (select count(*) from public.vibe_community_members where community_id = coalesce(new.community_id, old.community_id) and status = 'active')
  where id = coalesce(new.community_id, old.community_id);
  return null;
end $$;
create trigger vibe_cm_count after insert or update or delete on public.vibe_community_members for each row execute function public.vibe_community_counts();

create or replace function public.vibe_community_join(p_slug text, p_on boolean) returns jsonb
language plpgsql security definer set search_path = public as $$
declare me uuid := public.vibe_need_me(); c public.vibe_communities; st text;
begin
  select * into c from public.vibe_communities where slug = p_slug and status = 'active';
  if c.id is null then raise exception 'community not found'; end if;
  select status into st from public.vibe_community_members where community_id = c.id and user_id = me;
  if p_on then
    if st = 'banned' then raise exception 'you cannot join this community'; end if;
    if st is null then
      insert into public.vibe_community_members (community_id, user_id, status) values (c.id, me, case when c.visibility = 'private' then 'pending' else 'active' end);
      if c.visibility = 'private' then
        perform public.notify(m.user_id, 'social', public.vibe_name(me) || ' asked to join ' || c.name, null, '/vibe/c/' || c.slug || '?tab=members')
        from public.vibe_community_members m where m.community_id = c.id and m.role in ('owner', 'admin') and m.status = 'active';
      end if;
    end if;
  else
    if (select role from public.vibe_community_members where community_id = c.id and user_id = me) = 'owner' and (select count(*) from public.vibe_community_members where community_id = c.id and role = 'owner' and status = 'active') = 1 then
      raise exception 'make another member an admin owner before you leave';
    end if;
    delete from public.vibe_community_members where community_id = c.id and user_id = me and status <> 'banned';
  end if;
  return public.vibe_community_json((select x from public.vibe_communities x where x.id = c.id), me);
end $$;

-- p_action: approve, decline, remove, ban, make_admin, make_moderator, make_member, make_owner
create or replace function public.vibe_community_member(p_comm bigint, p_user uuid, p_action text) returns void
language plpgsql security definer set search_path = public as $$
declare me uuid := public.vibe_need_me(); myrole text := public.vibe_cm_role(p_comm, me); target text; cname text;
begin
  select role into target from public.vibe_community_members where community_id = p_comm and user_id = p_user;
  select name into cname from public.vibe_communities where id = p_comm;
  if myrole is null or myrole = 'member' then raise exception 'not allowed'; end if;
  if p_user = me then raise exception 'you cannot change your own role here'; end if;
  if target = 'owner' and myrole <> 'owner' then raise exception 'only the owner can change another owner'; end if;
  if p_action in ('make_admin', 'make_owner', 'make_moderator', 'make_member') and myrole not in ('owner', 'admin') then raise exception 'only admins can change roles'; end if;
  if p_action = 'make_owner' and myrole <> 'owner' then raise exception 'only the owner can add an owner'; end if;
  if target in ('admin', 'owner') and myrole = 'moderator' then raise exception 'moderators cannot change admins'; end if;
  case p_action
    when 'approve' then update public.vibe_community_members set status = 'active' where community_id = p_comm and user_id = p_user and status = 'pending';
      perform public.notify(p_user, 'social', 'You are now a member of ' || cname, null, '/vibe/c/' || (select slug from public.vibe_communities where id = p_comm));
    when 'decline' then delete from public.vibe_community_members where community_id = p_comm and user_id = p_user and status = 'pending';
    when 'remove' then delete from public.vibe_community_members where community_id = p_comm and user_id = p_user;
    when 'ban' then insert into public.vibe_community_members (community_id, user_id, status, role) values (p_comm, p_user, 'banned', 'member')
      on conflict (community_id, user_id) do update set status = 'banned', role = 'member';
    when 'make_admin' then update public.vibe_community_members set role = 'admin' where community_id = p_comm and user_id = p_user and status = 'active';
    when 'make_moderator' then update public.vibe_community_members set role = 'moderator' where community_id = p_comm and user_id = p_user and status = 'active';
    when 'make_member' then update public.vibe_community_members set role = 'member' where community_id = p_comm and user_id = p_user and status = 'active';
    when 'make_owner' then update public.vibe_community_members set role = 'owner' where community_id = p_comm and user_id = p_user and status = 'active';
    else raise exception 'unknown action';
  end case;
  perform public.log_action('vibe.community.' || p_action, 'vibe_community', p_comm::text, null, jsonb_build_object('user', p_user), null);
end $$;

create or replace function public.vibe_communities_list(p_q text default '', p_category text default '', p_mine boolean default false) returns jsonb
language sql stable security definer set search_path = public as $$
  select coalesce(jsonb_agg(public.vibe_community_json(c, auth.uid()) order by c.members_count desc, c.created_at desc), '[]') from (
    select c.* from public.vibe_communities c
    where c.status = 'active'
      and (not p_mine or exists (select 1 from public.vibe_community_members m where m.community_id = c.id and m.user_id = auth.uid() and m.status in ('active', 'pending')))
      and (coalesce(p_category, '') = '' or c.category = p_category)
      and (coalesce(p_q, '') = '' or (c.name || ' ' || c.description) ilike '%' || trim(p_q) || '%')
    order by c.members_count desc, c.created_at desc limit 60) c;
$$;

create or replace function public.vibe_community(p_slug text) returns jsonb
language sql stable security definer set search_path = public as $$
  select public.vibe_community_json(c, auth.uid()) from public.vibe_communities c where c.slug = p_slug and c.status = 'active';
$$;

create or replace function public.vibe_community_members_list(p_comm bigint, p_status text default 'active') returns jsonb
language plpgsql stable security definer set search_path = public as $$
begin
  if p_status <> 'active' and coalesce(public.vibe_cm_role(p_comm), 'member') = 'member' then raise exception 'not allowed'; end if;
  if not public.vibe_can_see_community(auth.uid(), p_comm) then return '[]'; end if;
  return coalesce((select jsonb_agg(public.vibe_card(m.user_id) || jsonb_build_object('role', m.role, 'status', m.status) order by case m.role when 'owner' then 0 when 'admin' then 1 when 'moderator' then 2 else 3 end, m.created_at)
    from public.vibe_community_members m where m.community_id = p_comm and m.status = p_status and public.vibe_can_see(auth.uid(), m.user_id) limit 300), '[]');
end $$;

-- ---------------------------------------------------------------------------------------------
-- Circles
-- ---------------------------------------------------------------------------------------------
create or replace function public.vibe_circle_create(p_name text, p_description text default '', p_purpose text default 'friends') returns uuid
language plpgsql security definer set search_path = public as $$
declare me uuid := public.vibe_need_me(); conv uuid; c uuid;
begin
  if (select count(*) from public.vibe_circles where owner_id = me and created_at > now() - interval '1 day') >= 5 then raise exception 'you can create up to 5 circles a day'; end if;
  insert into public.vibe_conversations default values returning id into conv;
  insert into public.vibe_circles (name, description, purpose, owner_id, conversation_id) values (trim(p_name), left(trim(coalesce(p_description, '')), 300), coalesce(p_purpose, 'friends'), me, conv) returning id into c;
  update public.vibe_conversations set circle_id = c where id = conv;
  insert into public.vibe_circle_members (circle_id, user_id, status) values (c, me, 'active');
  insert into public.vibe_conversation_members (conversation_id, user_id) values (conv, me);
  return c;
end $$;

create or replace function public.vibe_circle_invite(p_circle uuid, p_user uuid) returns void
language plpgsql security definer set search_path = public as $$
declare me uuid := public.vibe_need_me(); cname text;
begin
  if not public.vibe_in_circle(p_circle, me) then raise exception 'circle not found'; end if;
  if (select count(*) from public.vibe_circle_members where circle_id = p_circle) >= 50 then raise exception 'a circle can have up to 50 members'; end if;
  if not public.vibe_can_message(me, p_user) then raise exception 'this member is not accepting invitations from you'; end if;
  insert into public.vibe_circle_members (circle_id, user_id, invited_by) values (p_circle, p_user, me) on conflict do nothing;
  if found then
    select name into cname from public.vibe_circles where id = p_circle;
    perform public.notify(p_user, 'social', public.vibe_name(me) || ' invited you to the circle ' || cname, null, '/vibe/circles/?id=' || p_circle);
  end if;
end $$;

create or replace function public.vibe_circle_respond(p_circle uuid, p_accept boolean) returns void
language plpgsql security definer set search_path = public as $$
declare me uuid := public.vibe_need_me(); conv uuid := (select conversation_id from public.vibe_circles where id = p_circle);
begin
  if not exists (select 1 from public.vibe_circle_members where circle_id = p_circle and user_id = me and status = 'invited') then raise exception 'invitation not found'; end if;
  if p_accept then
    update public.vibe_circle_members set status = 'active' where circle_id = p_circle and user_id = me;
    insert into public.vibe_conversation_members (conversation_id, user_id) values (conv, me) on conflict do nothing;
  else
    delete from public.vibe_circle_members where circle_id = p_circle and user_id = me;
  end if;
end $$;

create or replace function public.vibe_circle_leave(p_circle uuid, p_user uuid default null) returns void
language plpgsql security definer set search_path = public as $$
declare me uuid := public.vibe_need_me(); target uuid := coalesce(p_user, me); c public.vibe_circles;
begin
  select * into c from public.vibe_circles where id = p_circle;
  if c.id is null then raise exception 'circle not found'; end if;
  if target <> me and c.owner_id <> me then raise exception 'only the circle owner can remove members'; end if;
  if target = c.owner_id then
    -- the owner leaving hands the circle to the longest member, or closes it when nobody is left
    update public.vibe_circles set owner_id = (select user_id from public.vibe_circle_members where circle_id = p_circle and user_id <> me and status = 'active' order by created_at limit 1) where id = p_circle;
    if (select owner_id from public.vibe_circles where id = p_circle) is null then delete from public.vibe_conversations where id = c.conversation_id; return; end if;
  end if;
  delete from public.vibe_circle_members where circle_id = p_circle and user_id = target;
  delete from public.vibe_conversation_members where conversation_id = c.conversation_id and user_id = target;
end $$;

create or replace function public.vibe_circles_mine() returns jsonb
language sql stable security definer set search_path = public as $$
  select coalesce(jsonb_agg(jsonb_build_object('id', c.id, 'name', c.name, 'description', c.description, 'purpose', c.purpose, 'my_status', m.status,
    'is_owner', c.owner_id = auth.uid(), 'conversation_id', case when m.status = 'active' then c.conversation_id end,
    'members', (select count(*) from public.vibe_circle_members x where x.circle_id = c.id and x.status = 'active'),
    'invited_by', case when m.status = 'invited' then public.vibe_name(m.invited_by) end) order by m.status desc, c.created_at desc), '[]')
  from public.vibe_circle_members m join public.vibe_circles c on c.id = m.circle_id where m.user_id = auth.uid();
$$;

create or replace function public.vibe_circle(p_id uuid) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare c public.vibe_circles; st text;
begin
  select * into c from public.vibe_circles where id = p_id;
  select status into st from public.vibe_circle_members where circle_id = p_id and user_id = auth.uid();
  if c.id is null or st is null then return null; end if;
  return jsonb_build_object('id', c.id, 'name', c.name, 'description', c.description, 'purpose', c.purpose, 'is_owner', c.owner_id = auth.uid(), 'my_status', st,
    'conversation_id', case when st = 'active' then c.conversation_id end,
    'members', (select jsonb_agg(public.vibe_card(m.user_id) || jsonb_build_object('status', m.status, 'owner', m.user_id = c.owner_id) order by m.created_at)
                from public.vibe_circle_members m where m.circle_id = p_id and (st = 'active' or m.status = 'active')));
end $$;

-- Messages now also work inside circles. Direct conversations keep every phase 1 rule.
create or replace function public.vibe_message_send(p_conv uuid, p_kind text, p_body text, p_attachment text default null, p_name text default null, p_duration int default null, p_reply bigint default null) returns jsonb
language plpgsql security definer set search_path = public as $$
declare me uuid := public.vibe_need_me(); other uuid; m public.vibe_messages; circ uuid; cname text; r record;
begin
  if not public.vibe_in_conversation(p_conv, me) then raise exception 'conversation not found'; end if;
  select circle_id into circ from public.vibe_conversations where id = p_conv;
  if circ is null then
    select user_id into other from public.vibe_conversation_members where conversation_id = p_conv and user_id <> me limit 1;
    if public.vibe_blocked(me, other) or not exists (select 1 from public.vibe_profiles where user_id = other and status = 'active') then raise exception 'you cannot message this member'; end if;
  elsif not public.vibe_in_circle(circ, me) then raise exception 'conversation not found';
  end if;
  if (select count(*) from public.vibe_messages where sender_id = me and created_at > now() - interval '10 minutes') >= 120 then raise exception 'too many messages in a short time; please wait a while'; end if;
  if p_attachment is not null and p_attachment !~ ('^' || p_conv::text || '/' || me::text || '/[A-Za-z0-9._-]+$') then raise exception 'attachments must be uploaded to this conversation'; end if;
  if p_reply is not null and not exists (select 1 from public.vibe_messages where id = p_reply and conversation_id = p_conv) then p_reply := null; end if;
  insert into public.vibe_messages (conversation_id, sender_id, kind, body, attachment_path, attachment_name, duration_s, reply_to)
  values (p_conv, me, coalesce(p_kind, 'text'), trim(coalesce(p_body, '')), p_attachment, left(p_name, 120), p_duration, p_reply) returning * into m;
  update public.vibe_conversations set last_message_at = m.created_at where id = p_conv;
  update public.vibe_conversation_members set last_read_at = m.created_at where conversation_id = p_conv and user_id = me;
  update public.vibe_conversation_members set hidden_at = null where conversation_id = p_conv;
  select name into cname from public.vibe_circles where id = circ;
  for r in select user_id from public.vibe_conversation_members where conversation_id = p_conv and user_id <> me loop
    if not exists (select 1 from public.notifications where user_id = r.user_id and topic = 'messages' and link = '/vibe/messages/?c=' || p_conv and read_at is null)
       and not public.vibe_blocked(me, r.user_id) then
      perform public.notify(r.user_id, 'messages', case when circ is null then 'New message from ' || public.vibe_name(me) else 'New message in ' || cname end,
        case when m.kind = 'text' then left(public.vibe_name(me) || ': ' || m.body, 120) else public.vibe_name(me) || ' sent a ' || case m.kind when 'image' then 'photo' when 'voice' then 'voice note' else 'document' end end, '/vibe/messages/?c=' || p_conv);
    end if;
  end loop;
  return to_jsonb(m) || jsonb_build_object('mine', true);
end $$;

create or replace function public.vibe_inbox(p_q text default '') returns jsonb
language sql stable security definer set search_path = public as $$
  select coalesce(jsonb_agg(x order by (x->>'last_message_at') desc), '[]') from (
    select jsonb_build_object('id', c.id, 'last_message_at', c.last_message_at,
      'other', case when c.circle_id is null then public.vibe_card((select o.user_id from public.vibe_conversation_members o where o.conversation_id = c.id and o.user_id <> auth.uid() limit 1)) end,
      'circle', (select jsonb_build_object('id', ci.id, 'name', ci.name, 'members', (select count(*) from public.vibe_circle_members x where x.circle_id = ci.id and x.status = 'active')) from public.vibe_circles ci where ci.id = c.circle_id),
      'unread', (select count(*) from public.vibe_messages m where m.conversation_id = c.id and m.sender_id <> auth.uid() and m.created_at > me.last_read_at and m.deleted_at is null),
      'last', (select jsonb_build_object('kind', m.kind, 'body', case when m.deleted_at is null then left(m.body, 80) else 'Message deleted' end, 'mine', m.sender_id = auth.uid(), 'sender', public.vibe_name(m.sender_id))
               from public.vibe_messages m where m.conversation_id = c.id order by m.id desc limit 1),
      'blocked', c.circle_id is null and public.vibe_blocked(auth.uid(), (select o.user_id from public.vibe_conversation_members o where o.conversation_id = c.id and o.user_id <> auth.uid() limit 1))) x
    from public.vibe_conversation_members me
    join public.vibe_conversations c on c.id = me.conversation_id
    where me.user_id = auth.uid() and me.hidden_at is null
      and (c.circle_id is not null or exists (select 1 from public.vibe_messages m where m.conversation_id = c.id))
      and (coalesce(p_q, '') = '' or lower(coalesce((select name from public.vibe_circles where id = c.circle_id),
            (select public.vibe_name(o.user_id) || ' ' || v.username from public.vibe_conversation_members o join public.vibe_profiles v on v.user_id = o.user_id where o.conversation_id = c.id and o.user_id <> auth.uid() limit 1), '')) like '%' || lower(trim(p_q)) || '%')
    limit 100) s;
$$;

create or replace function public.vibe_messages_list(p_conv uuid, p_before bigint default null) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare other uuid; o_read timestamptz; o_receipts boolean; my_receipts boolean; circ uuid;
begin
  if not public.vibe_in_conversation(p_conv) then raise exception 'conversation not found'; end if;
  select circle_id into circ from public.vibe_conversations where id = p_conv;
  if circ is null then
    select m.user_id, m.last_read_at, v.read_receipts into other, o_read, o_receipts from public.vibe_conversation_members m join public.vibe_profiles v on v.user_id = m.user_id
    where m.conversation_id = p_conv and m.user_id <> auth.uid();
  end if;
  select read_receipts into my_receipts from public.vibe_profiles where user_id = auth.uid();
  return jsonb_build_object(
    'other', case when circ is null then public.vibe_card(other) end,
    'circle', (select jsonb_build_object('id', c.id, 'name', c.name, 'members', (select count(*) from public.vibe_circle_members x where x.circle_id = c.id and x.status = 'active')) from public.vibe_circles c where c.id = circ),
    'can_send', case when circ is null then not public.vibe_blocked(auth.uid(), other) and exists (select 1 from public.vibe_profiles where user_id = other and status = 'active') else public.vibe_in_circle(circ) end,
    'blocked', circ is null and public.vibe_blocked(auth.uid(), other),
    'seen_until', case when circ is null and o_receipts and my_receipts then o_read end,
    'messages', coalesce((select jsonb_agg(jsonb_build_object('id', m.id, 'kind', m.kind, 'body', case when m.deleted_at is null then m.body else '' end,
        'attachment_path', case when m.deleted_at is null then m.attachment_path end, 'attachment_name', m.attachment_name, 'duration_s', m.duration_s,
        'reply_to', m.reply_to, 'created_at', m.created_at, 'deleted', m.deleted_at is not null, 'mine', m.sender_id = auth.uid(),
        'sender', case when circ is not null then jsonb_build_object('name', public.vibe_name(m.sender_id), 'username', (select username from public.vibe_profiles where user_id = m.sender_id)) end,
        'reactions', (select coalesce(jsonb_agg(jsonb_build_object('emoji', r.emoji, 'mine', r.user_id = auth.uid())), '[]') from public.vibe_message_reactions r where r.message_id = m.id)) order by m.id)
      from (select * from public.vibe_messages where conversation_id = p_conv and (p_before is null or id < p_before) order by id desc limit 50) m), '[]'));
end $$;

-- ---------------------------------------------------------------------------------------------
-- Stories
-- ---------------------------------------------------------------------------------------------
create or replace function public.vibe_story_can_see(viewer uuid, author uuid) returns boolean language sql stable security definer set search_path = public as $$
  select viewer = author or (public.vibe_can_see(viewer, author) and exists (select 1 from public.vibe_profiles m where m.user_id = viewer and m.status = 'active')
    and ((select story_visibility from public.vibe_profiles where user_id = author) = 'members'
         or exists (select 1 from public.vibe_follows f where f.follower = viewer and f.followee = author)));
$$;
create or replace function public.vibe_story_add(p_media text, p_body text, p_background text default 'blue') returns bigint
language plpgsql security definer set search_path = public as $$
declare me uuid := public.vibe_need_me(); id_out bigint;
begin
  if p_media is not null and p_media !~ ('^' || me::text || '/') then raise exception 'photos must be uploaded from your own account'; end if;
  if (select count(*) from public.vibe_stories where author_id = me and created_at > now() - interval '1 day') >= 30 then raise exception 'you can add up to 30 stories a day'; end if;
  insert into public.vibe_stories (author_id, media_path, body, background) values (me, p_media, left(trim(coalesce(p_body, '')), 300), coalesce(p_background, 'blue')) returning id into id_out;
  return id_out;
end $$;
create or replace function public.vibe_story_delete(p_id bigint) returns void language plpgsql security definer set search_path = public as $$
begin delete from public.vibe_stories where id = p_id and author_id = public.vibe_need_me(); if not found then raise exception 'story not found'; end if; end $$;

-- The stories bar: me first, then people I follow with live stories, unseen first.
create or replace function public.vibe_stories_bar() returns jsonb
language sql stable security definer set search_path = public as $$
  select coalesce(jsonb_agg(public.vibe_card(a.author_id) || jsonb_build_object('count', a.n, 'unseen', a.unseen, 'latest', a.latest)
    order by (a.author_id = auth.uid()) desc, a.unseen desc, a.latest desc), '[]') from (
    select s.author_id, count(*) n, max(s.created_at) latest,
      count(*) filter (where not exists (select 1 from public.vibe_story_views w where w.story_id = s.id and w.viewer_id = auth.uid())) > 0 unseen
    from public.vibe_stories s
    where s.expires_at > now() and public.vibe_story_can_see(auth.uid(), s.author_id)
      and exists (select 1 from public.vibe_profiles v where v.user_id = s.author_id and v.status = 'active')
    group by s.author_id limit 40) a;
$$;
create or replace function public.vibe_stories_of(p_user uuid) returns jsonb
language plpgsql security definer set search_path = public as $$
declare me uuid := public.vibe_need_me();
begin
  if not public.vibe_story_can_see(me, p_user) then return '[]'; end if;
  insert into public.vibe_story_views (story_id, viewer_id) select id, me from public.vibe_stories where author_id = p_user and expires_at > now() and p_user <> me on conflict do nothing;
  return coalesce((select jsonb_agg(jsonb_build_object('id', s.id, 'media', s.media_path, 'body', s.body, 'background', s.background, 'created_at', s.created_at, 'expires_at', s.expires_at,
      'views', case when s.author_id = me then (select count(*) from public.vibe_story_views w where w.story_id = s.id) end) order by s.id)
    from public.vibe_stories s where s.author_id = p_user and s.expires_at > now()), '[]');
end $$;
create or replace function public.vibe_story_viewers(p_story bigint) returns jsonb
language plpgsql stable security definer set search_path = public as $$
begin
  if not exists (select 1 from public.vibe_stories where id = p_story and author_id = auth.uid()) then raise exception 'story not found'; end if;
  return coalesce((select jsonb_agg(public.vibe_card(w.viewer_id) || jsonb_build_object('viewed_at', w.viewed_at) order by w.viewed_at desc)
    from public.vibe_story_views w where w.story_id = p_story), '[]');
end $$;

-- ---------------------------------------------------------------------------------------------
-- Events
-- ---------------------------------------------------------------------------------------------
create or replace function public.vibe_event_json(e public.vibe_events, viewer uuid) returns jsonb language sql stable security definer set search_path = public as $$
  select jsonb_build_object('id', e.id, 'title', e.title, 'description', e.description, 'category', e.category, 'mode', e.mode, 'venue', e.venue,
    'online_link', case when e.organiser_id = viewer or exists (select 1 from public.vibe_event_rsvps r where r.event_id = e.id and r.user_id = viewer and r.status = 'going') then e.online_link end,
    'starts_at', e.starts_at, 'ends_at', e.ends_at, 'cover', e.cover_path, 'capacity', e.capacity, 'going', e.going_count,
    'interested', (select count(*) from public.vibe_event_rsvps r where r.event_id = e.id and r.status = 'interested'),
    'status', e.status, 'mine', e.organiser_id = viewer, 'organiser', public.vibe_card(e.organiser_id, viewer),
    'community', (select jsonb_build_object('slug', c.slug, 'name', c.name) from public.vibe_communities c where c.id = e.community_id),
    'my_rsvp', (select status from public.vibe_event_rsvps r where r.event_id = e.id and r.user_id = viewer));
$$;
create or replace function public.vibe_can_see_event(viewer uuid, p_id bigint) returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.vibe_events e where e.id = p_id and e.status <> 'removed' and public.vibe_can_see(viewer, e.organiser_id)
    and (e.community_id is null or public.vibe_can_see_community(viewer, e.community_id)));
$$;
create or replace function public.vibe_event_save(p jsonb) returns jsonb
language plpgsql security definer set search_path = public as $$
declare me uuid := public.vibe_need_me(); e public.vibe_events; id_in bigint := nullif(p->>'id', '')::bigint; comm bigint := nullif(p->>'community_id', '')::bigint;
begin
  if (select status from public.vibe_profiles where user_id = me) = 'restricted' then raise exception 'your account cannot create events right now'; end if;
  if comm is not null and coalesce(public.vibe_cm_role(comm, me), 'member') = 'member' then raise exception 'only community leaders can create events for the community'; end if;
  if (p->>'starts_at')::timestamptz < now() then raise exception 'the start time must be in the future'; end if;
  if nullif(p->>'cover_path', '') is not null and (p->>'cover_path') !~ ('^' || me::text || '/') then raise exception 'photos must be uploaded from your own account'; end if;
  if id_in is null then
    if (select count(*) from public.vibe_events where organiser_id = me and created_at > now() - interval '1 day') >= 5 then raise exception 'you can create up to 5 events a day'; end if;
    insert into public.vibe_events (organiser_id, community_id, title, description, category, mode, venue, online_link, starts_at, ends_at, cover_path, capacity)
    values (me, comm, trim(p->>'title'), left(trim(coalesce(p->>'description', '')), 3000), coalesce(p->>'category', 'meetup'), p->>'mode',
      nullif(trim(coalesce(p->>'venue', '')), ''), nullif(trim(coalesce(p->>'online_link', '')), ''), (p->>'starts_at')::timestamptz, nullif(p->>'ends_at', '')::timestamptz,
      nullif(p->>'cover_path', ''), nullif(p->>'capacity', '')::int) returning * into e;
    insert into public.vibe_event_rsvps (event_id, user_id, status) values (e.id, me, 'going');
    update public.vibe_events set going_count = 1 where id = e.id returning * into e;
  else
    update public.vibe_events set title = trim(p->>'title'), description = left(trim(coalesce(p->>'description', '')), 3000), category = coalesce(p->>'category', category),
      mode = p->>'mode', venue = nullif(trim(coalesce(p->>'venue', '')), ''), online_link = nullif(trim(coalesce(p->>'online_link', '')), ''),
      starts_at = (p->>'starts_at')::timestamptz, ends_at = nullif(p->>'ends_at', '')::timestamptz, cover_path = coalesce(nullif(p->>'cover_path', ''), cover_path),
      capacity = nullif(p->>'capacity', '')::int, reminded_at = null
    where id = id_in and organiser_id = me and status = 'scheduled' returning * into e;
    if e.id is null then raise exception 'event not found'; end if;
    perform public.notify(r.user_id, 'social', 'An event you are going to was updated: ' || e.title, null, '/vibe/events/?id=' || e.id)
    from public.vibe_event_rsvps r where r.event_id = e.id and r.status = 'going' and r.user_id <> me;
  end if;
  return public.vibe_event_json(e, me);
end $$;
create or replace function public.vibe_event_cancel(p_id bigint) returns void
language plpgsql security definer set search_path = public as $$
declare me uuid := public.vibe_need_me(); t text;
begin
  update public.vibe_events set status = 'cancelled' where id = p_id and organiser_id = me and status = 'scheduled' returning title into t;
  if t is null then raise exception 'event not found'; end if;
  perform public.notify(r.user_id, 'social', 'Cancelled: ' || t, 'The organiser cancelled this event.', '/vibe/events/?id=' || p_id)
  from public.vibe_event_rsvps r where r.event_id = p_id and r.user_id <> me;
end $$;
create or replace function public.vibe_event_rsvp(p_id bigint, p_status text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare me uuid := public.vibe_need_me(); e public.vibe_events;
begin
  select * into e from public.vibe_events where id = p_id;
  if e.id is null or not public.vibe_can_see_event(me, p_id) then raise exception 'event not found'; end if;
  if e.status <> 'scheduled' or coalesce(e.ends_at, e.starts_at + interval '3 hours') < now() then raise exception 'this event is not taking replies'; end if;
  if e.organiser_id = me then raise exception 'you are the organiser'; end if;
  if p_status = 'going' and e.capacity is not null and e.going_count >= e.capacity and not exists (select 1 from public.vibe_event_rsvps where event_id = p_id and user_id = me and status = 'going') then raise exception 'this event is full'; end if;
  if p_status is null or p_status = '' then delete from public.vibe_event_rsvps where event_id = p_id and user_id = me;
  else insert into public.vibe_event_rsvps (event_id, user_id, status) values (p_id, me, p_status) on conflict (event_id, user_id) do update set status = excluded.status; end if;
  update public.vibe_events set going_count = (select count(*) from public.vibe_event_rsvps where event_id = p_id and status = 'going') where id = p_id returning * into e;
  return public.vibe_event_json(e, me);
end $$;
create or replace function public.vibe_events_list(p_scope text default 'upcoming', p_community bigint default null) returns jsonb
language sql stable security definer set search_path = public as $$
  select coalesce(jsonb_agg(public.vibe_event_json(e, auth.uid()) order by case when p_scope = 'past' then -extract(epoch from e.starts_at) else extract(epoch from e.starts_at) end), '[]') from (
    select e.* from public.vibe_events e
    where e.status <> 'removed' and public.vibe_can_see_event(auth.uid(), e.id)
      and (p_community is null or e.community_id = p_community)
      and case p_scope
        when 'past' then coalesce(e.ends_at, e.starts_at + interval '3 hours') < now()
        when 'mine' then e.organiser_id = auth.uid() or exists (select 1 from public.vibe_event_rsvps r where r.event_id = e.id and r.user_id = auth.uid())
        else coalesce(e.ends_at, e.starts_at + interval '3 hours') >= now() and e.status = 'scheduled' end
    order by e.starts_at limit 60) e;
$$;
create or replace function public.vibe_event(p_id bigint) returns jsonb
language sql stable security definer set search_path = public as $$
  select case when public.vibe_can_see_event(auth.uid(), e.id) then public.vibe_event_json(e, auth.uid()) end from public.vibe_events e where e.id = p_id;
$$;
create or replace function public.vibe_event_attendees(p_id bigint) returns jsonb
language plpgsql stable security definer set search_path = public as $$
begin
  if not exists (select 1 from public.vibe_events e where e.id = p_id and (e.organiser_id = auth.uid() or exists (select 1 from public.vibe_event_rsvps r where r.event_id = e.id and r.user_id = auth.uid()))) then
    raise exception 'only people taking part can see who is going';
  end if;
  return coalesce((select jsonb_agg(public.vibe_card(r.user_id) || jsonb_build_object('rsvp', r.status) order by r.status, r.created_at)
    from public.vibe_event_rsvps r where r.event_id = p_id and public.vibe_can_see(auth.uid(), r.user_id)), '[]');
end $$;

-- ---------------------------------------------------------------------------------------------
-- Member Spotlight
-- ---------------------------------------------------------------------------------------------
create or replace function public.vibe_spotlights_list() returns jsonb language sql stable security definer set search_path = public as $$
  select coalesce(jsonb_agg(jsonb_build_object('id', s.id, 'title', s.title, 'story', s.story, 'created_at', s.created_at, 'member', public.vibe_card(s.user_id) || jsonb_build_object('skills', v.skills))
    order by s.created_at desc), '[]')
  from public.vibe_spotlights s join public.vibe_profiles v on v.user_id = s.user_id
  where s.active and v.status = 'active' and public.vibe_can_see(auth.uid(), s.user_id);
$$;
create or replace function public.admin_vibe_spotlight_save(p_username text, p_title text, p_story text, p_id bigint default null, p_active boolean default true) returns void
language plpgsql security definer set search_path = public as $$
declare u uuid := (select user_id from public.vibe_profiles where username = lower(trim(p_username)));
begin
  if not (public.has_permission('moderation.manage') or public.has_permission('content.manage')) then raise exception 'not allowed'; end if;
  if p_id is null then
    if u is null then raise exception 'no TnPVibe member with that username'; end if;
    insert into public.vibe_spotlights (user_id, title, story, featured_by) values (u, trim(p_title), trim(p_story), auth.uid());
    perform public.notify(u, 'social', 'You are in the TnPVibe Member Spotlight!', trim(p_title), '/vibe/spotlight/');
  else
    update public.vibe_spotlights set title = trim(p_title), story = trim(p_story), active = p_active where id = p_id;
  end if;
  perform public.log_action('vibe.spotlight', 'vibe_spotlight', coalesce(p_id::text, u::text), null, null, p_title);
end $$;
create or replace function public.admin_vibe_spotlights() returns jsonb language plpgsql stable security definer set search_path = public as $$
begin
  if not (public.has_permission('moderation.manage') or public.has_permission('content.manage')) then raise exception 'not allowed'; end if;
  return coalesce((select jsonb_agg(jsonb_build_object('id', s.id, 'title', s.title, 'story', s.story, 'active', s.active, 'username', v.username, 'name', public.vibe_name(s.user_id)) order by s.created_at desc)
    from public.vibe_spotlights s join public.vibe_profiles v on v.user_id = s.user_id), '[]');
end $$;

-- ---------------------------------------------------------------------------------------------
-- Reports now cover the new things
-- ---------------------------------------------------------------------------------------------
create or replace function public.vibe_report(p_type text, p_id text, p_reason text, p_details text default null) returns void
language plpgsql security definer set search_path = public as $$
declare me uuid := public.vibe_need_me(); owner uuid;
begin
  if (select count(*) from public.vibe_reports where reporter = me and created_at > now() - interval '1 day') >= 20 then raise exception 'too many reports today'; end if;
  owner := case p_type
    when 'profile' then (select user_id from public.vibe_profiles where user_id::text = p_id)
    when 'post' then (select author_id from public.vibe_posts where id::text = p_id and public.vibe_can_see_post(me, id))
    when 'question' then (select author_id from public.vibe_posts where id::text = p_id and public.vibe_can_see_post(me, id))
    when 'comment' then (select author_id from public.vibe_comments where id::text = p_id)
    when 'answer' then (select author_id from public.vibe_comments where id::text = p_id)
    when 'message' then (select sender_id from public.vibe_messages m where m.id::text = p_id and public.vibe_in_conversation(m.conversation_id, me))
    when 'community' then (select created_by from public.vibe_communities where id::text = p_id)
    when 'event' then (select organiser_id from public.vibe_events where id::text = p_id)
    when 'story' then (select author_id from public.vibe_stories where id::text = p_id and public.vibe_story_can_see(me, author_id))
    else null end;
  if owner is null then raise exception 'nothing to report'; end if;
  if owner = me then raise exception 'you cannot report your own content'; end if;
  insert into public.vibe_reports (reporter, target_type, target_id, target_owner, reason, details)
  values (me, p_type, p_id, owner, p_reason, nullif(left(trim(coalesce(p_details, '')), 500), '')) on conflict (reporter, target_type, target_id) do nothing;
  if (select count(*) from public.vibe_reports where target_type = p_type and target_id = p_id and status = 'open') = 1 then
    perform public.staff_alert('vibe_report', null, 'TnPVibe report: ' || p_type || ', reason ' || p_reason || '. Review it at technapesa.co.ke/admin/vibe/');
  end if;
end $$;

create or replace function public.admin_vibe_report_decide(p_report bigint, p_action text, p_note text default null) returns void
language plpgsql security definer set search_path = public as $$
declare r public.vibe_reports;
begin
  if not public.has_permission('moderation.manage') then raise exception 'not allowed'; end if;
  select * into r from public.vibe_reports where id = p_report;
  if r.id is null then raise exception 'report not found'; end if;
  if p_action = 'remove' then
    if r.target_type in ('post', 'question') then update public.vibe_posts set removed_at = now(), removed_reason = coalesce(p_note, r.reason) where id::text = r.target_id;
    elsif r.target_type in ('comment', 'answer') then update public.vibe_comments set removed_at = now() where id::text = r.target_id;
    elsif r.target_type = 'message' then update public.vibe_messages set deleted_at = now(), body = '' where id::text = r.target_id;
    elsif r.target_type = 'community' then update public.vibe_communities set status = 'removed' where id::text = r.target_id;
    elsif r.target_type = 'event' then update public.vibe_events set status = 'removed' where id::text = r.target_id;
    elsif r.target_type = 'story' then delete from public.vibe_stories where id::text = r.target_id;
    else raise exception 'this item cannot be removed; restrict or suspend the member instead'; end if;
    if r.target_owner is not null then perform public.notify(r.target_owner, 'account', 'Your ' || r.target_type || ' was removed from TnPVibe', 'It broke the TnPVibe community guidelines. Reason: ' || coalesce(p_note, r.reason), '/vibe/guidelines/'); end if;
  elsif p_action = 'restrict' then
    update public.vibe_profiles set status = 'restricted' where user_id = r.target_owner;
    perform public.notify(r.target_owner, 'account', 'Your TnPVibe account is restricted', 'You cannot post, comment or create communities and events for now. Reason: ' || coalesce(p_note, r.reason), '/vibe/guidelines/');
  elsif p_action = 'suspend' then
    if not public.has_permission('users.manage_status') then raise exception 'only administrators can suspend accounts'; end if;
    update public.profiles set status = 'suspended', status_reason = coalesce(p_note, 'TnPVibe: ' || r.reason) where id = r.target_owner;
  elsif p_action = 'restore' then
    update public.vibe_profiles set status = 'active' where user_id = r.target_owner and status = 'restricted';
    if r.target_type in ('post', 'question') then update public.vibe_posts set removed_at = null, removed_reason = null where id::text = r.target_id; end if;
    if r.target_type in ('comment', 'answer') then update public.vibe_comments set removed_at = null where id::text = r.target_id; end if;
    if r.target_type = 'community' then update public.vibe_communities set status = 'active' where id::text = r.target_id; end if;
    if r.target_type = 'event' then update public.vibe_events set status = 'scheduled' where id::text = r.target_id and status = 'removed'; end if;
  elsif p_action <> 'dismiss' then raise exception 'unknown action';
  end if;
  update public.vibe_reports set status = case when p_action in ('dismiss', 'restore') then 'dismissed' else 'actioned' end, handled_by = auth.uid(), handled_at = now(), handled_note = p_note
  where (target_type = r.target_type and target_id = r.target_id and status = 'open') or id = p_report;
  perform public.log_action('vibe.report.' || p_action, 'vibe_report', p_report::text, to_jsonb(r), null, p_note);
end $$;

-- The moderators' queue shows the reported item for the new kinds too.
create or replace function public.admin_vibe_reports(p_status text default 'open') returns jsonb
language plpgsql stable security definer set search_path = public as $$
begin
  if not public.has_permission('moderation.manage') then raise exception 'not allowed'; end if;
  return coalesce((select jsonb_agg(jsonb_build_object('id', r.id, 'type', r.target_type, 'target_id', r.target_id, 'reason', r.reason, 'details', r.details, 'status', r.status, 'created_at', r.created_at,
      'reporter', (select username from public.vibe_profiles where user_id = r.reporter),
      'owner', (select jsonb_build_object('id', v.user_id, 'username', v.username, 'name', public.vibe_name(v.user_id), 'status', v.status) from public.vibe_profiles v where v.user_id = r.target_owner),
      'reports_on_target', (select count(*) from public.vibe_reports x where x.target_type = r.target_type and x.target_id = r.target_id),
      'content', case
        when r.target_type in ('post', 'question') then (select jsonb_build_object('body', body, 'media', media, 'removed', removed_at is not null) from public.vibe_posts where id::text = r.target_id)
        when r.target_type in ('comment', 'answer') then (select jsonb_build_object('body', body, 'removed', removed_at is not null) from public.vibe_comments where id::text = r.target_id)
        when r.target_type = 'message' then (select jsonb_build_object('body', body, 'kind', kind) from public.vibe_messages where id::text = r.target_id)
        when r.target_type = 'profile' then (select jsonb_build_object('body', headline || ' ' || bio) from public.vibe_profiles where user_id::text = r.target_id)
        when r.target_type = 'community' then (select jsonb_build_object('body', name || ': ' || description, 'removed', status = 'removed', 'link', '/vibe/c/' || slug) from public.vibe_communities where id::text = r.target_id)
        when r.target_type = 'event' then (select jsonb_build_object('body', title || ': ' || description, 'removed', status = 'removed', 'link', '/vibe/events/?id=' || id) from public.vibe_events where id::text = r.target_id)
        when r.target_type = 'story' then (select jsonb_build_object('body', body, 'media', case when media_path is not null then array[media_path] else '{}' end) from public.vibe_stories where id::text = r.target_id)
      end) order by r.created_at)
    from public.vibe_reports r where r.status = p_status and (p_status = 'open' or r.handled_at > now() - interval '30 days')), '[]');
end $$;

create or replace function public.admin_vibe_stats() returns jsonb
language plpgsql stable security definer set search_path = public as $$
begin
  if not (public.has_permission('moderation.manage') or public.has_permission('users.view')) then raise exception 'not allowed'; end if;
  return jsonb_build_object(
    'members', (select count(*) from public.vibe_profiles where status = 'active'),
    'new_7d', (select count(*) from public.vibe_profiles where created_at > now() - interval '7 days'),
    'active_today', (select count(*) from public.vibe_profiles where last_active_at > now() - interval '1 day'),
    'active_30d', (select count(*) from public.vibe_profiles where last_active_at > now() - interval '30 days'),
    'posts', (select count(*) from public.vibe_posts where removed_at is null),
    'posts_7d', (select count(*) from public.vibe_posts where created_at > now() - interval '7 days'),
    'comments', (select count(*) from public.vibe_comments where removed_at is null),
    'follows', (select count(*) from public.vibe_follows),
    'messages_7d', (select count(*) from public.vibe_messages where created_at > now() - interval '7 days'),
    'communities', (select count(*) from public.vibe_communities where status = 'active'),
    'community_members', (select count(*) from public.vibe_community_members where status = 'active'),
    'circles', (select count(*) from public.vibe_circles),
    'events_upcoming', (select count(*) from public.vibe_events where status = 'scheduled' and starts_at > now()),
    'stories_live', (select count(*) from public.vibe_stories where expires_at > now()),
    'open_reports', (select count(*) from public.vibe_reports where status = 'open'),
    'actioned_30d', (select count(*) from public.vibe_reports where status = 'actioned' and handled_at > now() - interval '30 days'),
    'restricted', (select count(*) from public.vibe_profiles where status = 'restricted'));
end $$;

-- ---------------------------------------------------------------------------------------------
-- Points for taking part (with daily caps), and the hourly job
-- ---------------------------------------------------------------------------------------------
alter table public.point_events drop constraint point_events_kind_check;
alter table public.point_events add constraint point_events_kind_check check (kind in ('story_published', 'challenge_entry', 'challenge_win', 'vote', 'comment', 'referral', 'opportunity_shared', 'redeemed', 'adjustment',
  'vibe_post', 'vibe_comment', 'vibe_intro', 'vibe_answer', 'vibe_event', 'vibe_community'));
update public.site_settings set value = value || '{"vibe_post": 3, "vibe_comment": 1, "vibe_intro": 10, "vibe_answer": 10, "vibe_event": 5, "vibe_community": 5}'::jsonb where key = 'rewards.points';

create or replace function public.reward_points(p_user uuid, p_kind text, p_ref text, p_points int default null) returns void
language plpgsql security definer set search_path = public as $$
declare pts int := coalesce(p_points, ((select value from public.site_settings where key = 'rewards.points') ->> p_kind)::int, 0); ref_by uuid;
  cap int := case p_kind when 'vote' then 10 when 'comment' then 10 when 'vibe_post' then 5 when 'vibe_comment' then 10 when 'vibe_event' then 2 when 'vibe_community' then 1 else null end;
begin
  if p_user is null or pts = 0 then return; end if;
  if cap is not null and (select count(*) from public.point_events where user_id = p_user and kind = p_kind and created_at > now() - interval '1 day') >= cap then return; end if;
  insert into public.point_events (user_id, kind, ref, points) values (p_user, p_kind, p_ref, pts) on conflict do nothing;
  if found and p_kind not in ('referral', 'redeemed', 'adjustment') then
    select referred_by into ref_by from public.profiles where id = p_user;
    if ref_by is not null and ref_by <> p_user then
      insert into public.point_events (user_id, kind, ref, points) values (ref_by, 'referral', p_user::text, coalesce(((select value from public.site_settings where key = 'rewards.points') ->> 'referral')::int, 25)) on conflict do nothing;
    end if;
  end if;
end $$;
revoke execute on function public.reward_points(uuid, text, text, int) from public, anon, authenticated;

create or replace function public.vibe_points_on_post() returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.circle_id is not null then return new; end if;
  if new.kind = 'introduction' then perform public.reward_points(new.author_id, 'vibe_intro', 'intro');
  else perform public.reward_points(new.author_id, 'vibe_post', new.id::text); end if;
  return new;
end $$;
create trigger vibe_posts_points after insert on public.vibe_posts for each row execute function public.vibe_points_on_post();
create or replace function public.vibe_points_on_comment() returns trigger language plpgsql security definer set search_path = public as $$
begin
  if (select author_id from public.vibe_posts where id = new.post_id) <> new.author_id then perform public.reward_points(new.author_id, 'vibe_comment', new.id::text); end if;
  return new;
end $$;
create trigger vibe_comments_points after insert on public.vibe_comments for each row execute function public.vibe_points_on_comment();
create or replace function public.vibe_points_on_event() returns trigger language plpgsql security definer set search_path = public as $$
begin perform public.reward_points(new.organiser_id, 'vibe_event', new.id::text); return new; end $$;
create trigger vibe_events_points after insert on public.vibe_events for each row execute function public.vibe_points_on_event();
create or replace function public.vibe_points_on_community() returns trigger language plpgsql security definer set search_path = public as $$
begin perform public.reward_points(new.created_by, 'vibe_community', new.id::text); return new; end $$;
create trigger vibe_communities_points after insert on public.vibe_communities for each row execute function public.vibe_points_on_community();
-- points go when the post or comment is removed by moderators
create or replace function public.vibe_points_on_removal() returns trigger language plpgsql security definer set search_path = public as $$
begin
  if old.removed_at is null and new.removed_at is not null then
    delete from public.point_events where user_id = new.author_id and kind = case when tg_table_name = 'vibe_posts' then 'vibe_post' else 'vibe_comment' end and ref = new.id::text;
  end if;
  return new;
end $$;
create trigger vibe_posts_points_removed after update of removed_at on public.vibe_posts for each row execute function public.vibe_points_on_removal();
create trigger vibe_comments_points_removed after update of removed_at on public.vibe_comments for each row execute function public.vibe_points_on_removal();

-- Hourly: event reminders a day ahead, and clearing out stories older than a day.
create or replace function public.vibe_hourly() returns jsonb
language plpgsql security definer set search_path = public as $$
declare n int := 0; e record; gone int;
begin
  if not (public.is_service() or public.has_permission('settings.manage')) then raise exception 'not allowed'; end if;
  for e in select * from public.vibe_events where status = 'scheduled' and reminded_at is null and starts_at between now() and now() + interval '24 hours' loop
    perform public.notify(r.user_id, 'social', 'Reminder: ' || e.title || ' starts ' || to_char(e.starts_at at time zone 'Africa/Nairobi', 'Dy DD Mon, HH12:MI AM'), case when e.mode = 'online' then 'Online. The joining link is on the event page.' else e.venue end, '/vibe/events/?id=' || e.id)
    from public.vibe_event_rsvps r where r.event_id = e.id and r.status = 'going';
    update public.vibe_events set reminded_at = now() where id = e.id; n := n + 1;
  end loop;
  delete from public.vibe_stories where expires_at < now() - interval '1 day';
  get diagnostics gone = row_count;
  return jsonb_build_object('reminded_events', n, 'stories_cleared', gone);
end $$;

-- ---------------------------------------------------------------------------------------------
-- Grants
-- ---------------------------------------------------------------------------------------------
revoke execute on function public.vibe_cm_role(bigint, uuid), public.vibe_can_see_community(uuid, bigint), public.vibe_in_circle(uuid, uuid), public.vibe_community_json(public.vibe_communities, uuid),
  public.vibe_event_json(public.vibe_events, uuid), public.vibe_can_see_event(uuid, bigint), public.vibe_story_can_see(uuid, uuid), public.vibe_post_json(public.vibe_posts, uuid), public.vibe_can_see_post(uuid, bigint) from public, anon;
revoke all on function public.vibe_community_counts(), public.vibe_points_on_post(), public.vibe_points_on_comment(), public.vibe_points_on_event(), public.vibe_points_on_community(), public.vibe_points_on_removal() from public, anon, authenticated;
revoke execute on function public.vibe_hourly() from public, anon, authenticated;
grant execute on function public.vibe_hourly() to service_role;
revoke execute on function
  public.vibe_post_save(bigint, text, text, text[], bigint, uuid, text, jsonb), public.vibe_comment_like(bigint, boolean), public.vibe_accept_answer(bigint, bigint), public.vibe_community_remove_post(bigint, text),
  public.vibe_poll_vote(bigint, bigint[]), public.vibe_community_save(jsonb), public.vibe_community_join(text, boolean), public.vibe_community_member(bigint, uuid, text),
  public.vibe_circle_create(text, text, text), public.vibe_circle_invite(uuid, uuid), public.vibe_circle_respond(uuid, boolean), public.vibe_circle_leave(uuid, uuid), public.vibe_circles_mine(), public.vibe_circle(uuid),
  public.vibe_story_add(text, text, text), public.vibe_story_delete(bigint), public.vibe_stories_bar(), public.vibe_stories_of(uuid), public.vibe_story_viewers(bigint),
  public.vibe_event_save(jsonb), public.vibe_event_cancel(bigint), public.vibe_event_rsvp(bigint, text), public.vibe_event_attendees(bigint),
  public.admin_vibe_spotlight_save(text, text, text, bigint, boolean), public.admin_vibe_spotlights() from public, anon;
grant execute on function
  public.vibe_post_save(bigint, text, text, text[], bigint, uuid, text, jsonb), public.vibe_comment_like(bigint, boolean), public.vibe_accept_answer(bigint, bigint), public.vibe_community_remove_post(bigint, text),
  public.vibe_poll_vote(bigint, bigint[]), public.vibe_community_save(jsonb), public.vibe_community_join(text, boolean), public.vibe_community_member(bigint, uuid, text),
  public.vibe_circle_create(text, text, text), public.vibe_circle_invite(uuid, uuid), public.vibe_circle_respond(uuid, boolean), public.vibe_circle_leave(uuid, uuid), public.vibe_circles_mine(), public.vibe_circle(uuid),
  public.vibe_story_add(text, text, text), public.vibe_story_delete(bigint), public.vibe_stories_bar(), public.vibe_stories_of(uuid), public.vibe_story_viewers(bigint),
  public.vibe_event_save(jsonb), public.vibe_event_cancel(bigint), public.vibe_event_rsvp(bigint, text), public.vibe_event_attendees(bigint),
  public.admin_vibe_spotlight_save(text, text, text, bigint, boolean), public.admin_vibe_spotlights() to authenticated;
grant execute on function public.vibe_questions(text, text, bigint), public.vibe_communities_list(text, text, boolean), public.vibe_community(text), public.vibe_community_members_list(bigint, text),
  public.vibe_events_list(text, bigint), public.vibe_event(bigint), public.vibe_spotlights_list() to anon, authenticated;
-- Community names and descriptions are public information for active communities.
create policy "read active communities" on public.vibe_communities for select using (status = 'active' and (visibility = 'public' or public.vibe_cm_role(id) is not null));
grant select on public.vibe_communities to anon, authenticated;
grant execute on function public.vibe_cm_role(bigint, uuid) to anon, authenticated;
