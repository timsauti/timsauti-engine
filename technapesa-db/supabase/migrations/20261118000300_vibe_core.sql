-- TnPVibe by TECH na PESA, phase 1: networking profiles, follows, blocks, presence, posts, likes, comments,
-- private messages, reports and moderation. Reuses the existing accounts (auth.users, profiles), notifications,
-- permissions and audit log. Every write goes through a security definer function that checks the caller;
-- tables allow reads only through row level security, so nothing can be changed by calling the tables directly.
-- TnPVibe is for adults: joining needs a confirmation that the member is 18 or older.

-- Notifications get two new topics.
do $$ declare c text; begin
  for c in select conname from pg_constraint where conrelid in ('public.notifications'::regclass, 'public.notification_prefs'::regclass) and contype = 'c' and pg_get_constraintdef(oid) like '%topic%' loop
    execute format('alter table %s drop constraint %I', (select conrelid::regclass from pg_constraint where conname = c limit 1), c);
  end loop;
end $$;
alter table public.notifications add constraint notifications_topic_check check (topic in ('account', 'billing', 'trial', 'content', 'enquiries', 'reviews', 'verification', 'news', 'social', 'messages'));
alter table public.notification_prefs add constraint notification_prefs_topic_check check (topic in ('account', 'billing', 'trial', 'content', 'enquiries', 'reviews', 'verification', 'news', 'social', 'messages'));

-- ---------------------------------------------------------------------------------------------
-- Tables
-- ---------------------------------------------------------------------------------------------
create table public.vibe_profiles (
  user_id uuid primary key references public.profiles(id) on delete cascade,
  username text not null unique check (username ~ '^[a-z0-9_]{3,24}$'),
  headline text not null default '' check (char_length(headline) <= 80),
  bio text not null default '' check (char_length(bio) <= 300),
  location text not null default '' check (char_length(location) <= 80),
  organisation text not null default '' check (char_length(organisation) <= 80),
  website text check (website is null or website ~ '^https?://[^\s]+$'),
  socials jsonb not null default '{}'::jsonb,
  interests text[] not null default '{}' check (cardinality(interests) <= 12),
  skills text[] not null default '{}' check (cardinality(skills) <= 20),
  avatar_path text, cover_path text,
  visibility text not null default 'public' check (visibility in ('public', 'members')),
  discoverable boolean not null default true,
  show_online boolean not null default true,
  who_can_message text not null default 'everyone' check (who_can_message in ('everyone', 'followers', 'nobody')),
  read_receipts boolean not null default true,
  status text not null default 'active' check (status in ('active', 'deactivated', 'restricted')),
  adult_confirmed_at timestamptz not null,
  followers_count integer not null default 0, following_count integer not null default 0, posts_count integer not null default 0,
  last_active_at timestamptz,
  created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);
create index vibe_profiles_active on public.vibe_profiles (last_active_at desc) where status = 'active';
create index vibe_profiles_search on public.vibe_profiles using gin ((username || ' ' || headline || ' ' || location || ' ' || organisation) extensions.gin_trgm_ops);
create index vibe_profiles_interests on public.vibe_profiles using gin (interests);

create table public.vibe_follows (
  follower uuid not null references public.vibe_profiles(user_id) on delete cascade,
  followee uuid not null references public.vibe_profiles(user_id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (follower, followee), check (follower <> followee)
);
create index vibe_follows_followee on public.vibe_follows (followee, created_at desc);

create table public.vibe_blocks (
  blocker uuid not null references public.vibe_profiles(user_id) on delete cascade,
  blocked uuid not null references public.vibe_profiles(user_id) on delete cascade,
  created_at timestamptz not null default now(), primary key (blocker, blocked), check (blocker <> blocked)
);
create table public.vibe_mutes (
  muter uuid not null references public.vibe_profiles(user_id) on delete cascade,
  muted uuid not null references public.vibe_profiles(user_id) on delete cascade,
  created_at timestamptz not null default now(), primary key (muter, muted), check (muter <> muted)
);

create table public.vibe_posts (
  id bigint generated always as identity primary key,
  author_id uuid not null references public.vibe_profiles(user_id) on delete cascade,
  kind text not null default 'post' check (kind in ('post', 'question', 'announcement', 'experience', 'idea', 'achievement', 'update', 'introduction')),
  body text not null default '' check (char_length(body) <= 3000),
  media text[] not null default '{}' check (cardinality(media) <= 6),
  likes_count integer not null default 0, comments_count integer not null default 0,
  featured_on_profile boolean not null default false,
  created_at timestamptz not null default now(), edited_at timestamptz,
  removed_at timestamptz, removed_reason text,
  check (char_length(trim(body)) > 0 or cardinality(media) > 0)
);
create index vibe_posts_author on public.vibe_posts (author_id, id desc);
create index vibe_posts_recent on public.vibe_posts (id desc) where removed_at is null;
create index vibe_posts_body on public.vibe_posts using gin (body extensions.gin_trgm_ops);

create table public.vibe_likes (
  post_id bigint not null references public.vibe_posts(id) on delete cascade,
  user_id uuid not null references public.vibe_profiles(user_id) on delete cascade,
  created_at timestamptz not null default now(), primary key (post_id, user_id)
);
create table public.vibe_comments (
  id bigint generated always as identity primary key,
  post_id bigint not null references public.vibe_posts(id) on delete cascade,
  author_id uuid not null references public.vibe_profiles(user_id) on delete cascade,
  parent_id bigint references public.vibe_comments(id) on delete cascade,
  body text not null check (char_length(trim(body)) between 1 and 1000),
  created_at timestamptz not null default now(), removed_at timestamptz
);
create index vibe_comments_post on public.vibe_comments (post_id, id);

create table public.vibe_conversations (
  id uuid primary key default gen_random_uuid(),
  direct_key text unique,
  created_at timestamptz not null default now(),
  last_message_at timestamptz not null default now()
);
create table public.vibe_conversation_members (
  conversation_id uuid not null references public.vibe_conversations(id) on delete cascade,
  user_id uuid not null references public.vibe_profiles(user_id) on delete cascade,
  last_read_at timestamptz not null default now(),
  hidden_at timestamptz,
  primary key (conversation_id, user_id)
);
create index vibe_conv_members_user on public.vibe_conversation_members (user_id);
create table public.vibe_messages (
  id bigint generated always as identity primary key,
  conversation_id uuid not null references public.vibe_conversations(id) on delete cascade,
  sender_id uuid not null references public.vibe_profiles(user_id) on delete cascade,
  kind text not null default 'text' check (kind in ('text', 'image', 'voice', 'document')),
  body text not null default '' check (char_length(body) <= 4000),
  attachment_path text, attachment_name text check (attachment_name is null or char_length(attachment_name) <= 120),
  duration_s integer check (duration_s is null or duration_s between 1 and 300),
  reply_to bigint references public.vibe_messages(id) on delete set null,
  created_at timestamptz not null default now(), edited_at timestamptz, deleted_at timestamptz,
  check (kind = 'text' and char_length(trim(body)) > 0 or kind <> 'text' and attachment_path is not null)
);
create index vibe_messages_conv on public.vibe_messages (conversation_id, id desc);
create table public.vibe_message_reactions (
  message_id bigint not null references public.vibe_messages(id) on delete cascade,
  user_id uuid not null references public.vibe_profiles(user_id) on delete cascade,
  emoji text not null check (emoji in ('👍', '❤️', '😂', '😮', '🙏', '🔥')),
  primary key (message_id, user_id)
);

create table public.vibe_reports (
  id bigint generated always as identity primary key,
  reporter uuid not null references public.vibe_profiles(user_id) on delete cascade,
  target_type text not null check (target_type in ('profile', 'post', 'comment', 'message', 'community', 'video', 'event', 'collab', 'question', 'answer', 'story')),
  target_id text not null,
  target_owner uuid references auth.users(id) on delete set null,
  reason text not null check (reason in ('spam', 'harassment', 'hate', 'nudity', 'violence', 'scam', 'fake_account', 'underage', 'self_harm', 'other')),
  details text check (details is null or char_length(details) <= 500),
  status text not null default 'open' check (status in ('open', 'actioned', 'dismissed')),
  handled_by uuid references auth.users(id), handled_at timestamptz, handled_note text,
  created_at timestamptz not null default now(),
  unique (reporter, target_type, target_id)
);
create index vibe_reports_open on public.vibe_reports (status, created_at);

alter table public.vibe_profiles enable row level security;
alter table public.vibe_follows enable row level security;
alter table public.vibe_blocks enable row level security;
alter table public.vibe_mutes enable row level security;
alter table public.vibe_posts enable row level security;
alter table public.vibe_likes enable row level security;
alter table public.vibe_comments enable row level security;
alter table public.vibe_conversations enable row level security;
alter table public.vibe_conversation_members enable row level security;
alter table public.vibe_messages enable row level security;
alter table public.vibe_message_reactions enable row level security;
alter table public.vibe_reports enable row level security;

-- ---------------------------------------------------------------------------------------------
-- Helpers
-- ---------------------------------------------------------------------------------------------
create or replace function public.vibe_me() returns uuid language sql stable security definer set search_path = public as $$
  select v.user_id from public.vibe_profiles v join public.profiles p on p.id = v.user_id
  where v.user_id = auth.uid() and v.status = 'active' and p.status = 'active';
$$;
create or replace function public.vibe_need_me() returns uuid language plpgsql stable security definer set search_path = public as $$
declare me uuid := public.vibe_me();
begin
  if auth.uid() is null then raise exception 'please sign in'; end if;
  if me is null then raise exception 'join TnPVibe first'; end if;
  return me;
end $$;
create or replace function public.vibe_blocked(a uuid, b uuid) returns boolean language sql stable security definer set search_path = public as $$
  select a is not null and b is not null and exists (select 1 from public.vibe_blocks where (blocker = a and blocked = b) or (blocker = b and blocked = a));
$$;
create or replace function public.vibe_can_see(viewer uuid, owner uuid) returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.vibe_profiles v join public.profiles p on p.id = v.user_id
    where v.user_id = owner and p.status = 'active'
      and (v.status = 'active' or viewer = owner)
      and (v.visibility = 'public' or viewer = owner or exists (select 1 from public.vibe_profiles m where m.user_id = viewer and m.status = 'active')))
    and not public.vibe_blocked(viewer, owner);
$$;
create or replace function public.vibe_name(u uuid) returns text language sql stable security definer set search_path = public as $$
  select coalesce(nullif(p.display_name, ''), nullif(p.full_name, ''), v.username) from public.vibe_profiles v join public.profiles p on p.id = v.user_id where v.user_id = u;
$$;
create or replace function public.vibe_card(u uuid, viewer uuid default auth.uid()) returns jsonb language sql stable security definer set search_path = public as $$
  select jsonb_build_object('id', v.user_id, 'username', v.username, 'name', public.vibe_name(v.user_id), 'headline', v.headline,
    'avatar', v.avatar_path, 'location', v.location,
    'online', v.show_online and v.last_active_at > now() - interval '2 minutes',
    'last_active', case when v.show_online then v.last_active_at end,
    'followers', v.followers_count,
    'following_them', exists (select 1 from public.vibe_follows f where f.follower = viewer and f.followee = v.user_id),
    'follows_me', exists (select 1 from public.vibe_follows f where f.follower = v.user_id and f.followee = viewer))
  from public.vibe_profiles v where v.user_id = u;
$$;
create or replace function public.vibe_rate(p_table text, p_col text, p_limit int, p_window interval, p_what text) returns void
language plpgsql security definer set search_path = public as $$
declare n int;
begin
  execute format('select count(*) from public.%I where %I = $1 and created_at > now() - $2', p_table, p_col) into n using auth.uid(), p_window;
  if n >= p_limit then raise exception 'too many % in a short time; please wait a while', p_what; end if;
end $$;
create or replace function public.vibe_clean_tags(t text[], max_n int) returns text[] language plpgsql immutable as $$
declare out_t text[] := '{}'; x text; c text;
begin
  foreach x in array coalesce(t, '{}') loop
    c := left(trim(regexp_replace(x, '\s+', ' ', 'g')), 30);
    if c <> '' and not exists (select 1 from unnest(out_t) y where lower(y) = lower(c)) then out_t := out_t || c; end if;
    exit when cardinality(out_t) >= max_n;
  end loop;
  return out_t;
end $$;

-- ---------------------------------------------------------------------------------------------
-- Joining, profile and settings
-- ---------------------------------------------------------------------------------------------
create or replace function public.vibe_username_free(p_username text) returns boolean language sql stable security definer set search_path = public as $$
  select lower(p_username) ~ '^[a-z0-9_]{3,24}$' and lower(p_username) not in ('admin', 'support', 'technapesa', 'tnpvibe', 'vibe', 'moderator', 'official', 'help', 'settings', 'messages', 'people', 'feed')
    and not exists (select 1 from public.vibe_profiles where username = lower(p_username));
$$;

create or replace function public.vibe_join(p_username text, p_adult boolean, p_headline text default '', p_interests text[] default '{}') returns text
language plpgsql security definer set search_path = public as $$
declare u text := lower(trim(p_username));
begin
  if auth.uid() is null then raise exception 'please sign in'; end if;
  if not exists (select 1 from public.profiles where id = auth.uid() and status = 'active') then raise exception 'your account is not active'; end if;
  if exists (select 1 from public.vibe_profiles where user_id = auth.uid()) then
    update public.vibe_profiles set status = 'active', updated_at = now() where user_id = auth.uid() and status = 'deactivated';
    return (select username from public.vibe_profiles where user_id = auth.uid());
  end if;
  if p_adult is not true then raise exception 'TnPVibe is for members aged 18 and over'; end if;
  if not public.vibe_username_free(u) then raise exception 'that username is taken or not allowed; use 3 to 24 letters, numbers or _'; end if;
  insert into public.vibe_profiles (user_id, username, headline, interests, adult_confirmed_at)
  values (auth.uid(), u, left(trim(coalesce(p_headline, '')), 80), public.vibe_clean_tags(p_interests, 12), now());
  perform public.log_action('vibe.joined', 'vibe_profile', auth.uid()::text, null, null, null);
  return u;
end $$;

create or replace function public.vibe_profile_save(p jsonb) returns void
language plpgsql security definer set search_path = public as $$
declare me uuid := public.vibe_need_me(); u text := lower(trim(coalesce(p->>'username', '')));
begin
  if u <> '' and u <> (select username from public.vibe_profiles where user_id = me) and not public.vibe_username_free(u) then
    raise exception 'that username is taken or not allowed';
  end if;
  if p ? 'name' then
    if char_length(trim(p->>'name')) not between 2 and 60 then raise exception 'your name must be 2 to 60 characters'; end if;
    update public.profiles set display_name = trim(p->>'name'), updated_at = now() where id = me;
  end if;
  update public.vibe_profiles set
    username = case when u <> '' then u else username end,
    headline = case when p ? 'headline' then left(trim(p->>'headline'), 80) else headline end,
    bio = case when p ? 'bio' then left(trim(p->>'bio'), 300) else bio end,
    location = case when p ? 'location' then left(trim(p->>'location'), 80) else location end,
    organisation = case when p ? 'organisation' then left(trim(p->>'organisation'), 80) else organisation end,
    website = case when p ? 'website' then nullif(trim(p->>'website'), '') else website end,
    socials = case when p ? 'socials' then (select coalesce(jsonb_object_agg(k, left(v, 200)), '{}') from jsonb_each_text(p->'socials') s(k, v)
                 where k in ('facebook', 'instagram', 'x', 'tiktok', 'linkedin', 'youtube') and v ~ '^https://') else socials end,
    interests = case when p ? 'interests' then public.vibe_clean_tags(array(select jsonb_array_elements_text(p->'interests')), 12) else interests end,
    skills = case when p ? 'skills' then public.vibe_clean_tags(array(select jsonb_array_elements_text(p->'skills')), 20) else skills end,
    avatar_path = case when p ? 'avatar_path' then nullif(p->>'avatar_path', '') else avatar_path end,
    cover_path = case when p ? 'cover_path' then nullif(p->>'cover_path', '') else cover_path end,
    updated_at = now()
  where user_id = me;
  if (select avatar_path from public.vibe_profiles where user_id = me) !~ ('^' || me::text || '/') or (select cover_path from public.vibe_profiles where user_id = me) !~ ('^' || me::text || '/') then
    raise exception 'photos must be uploaded from your own account';
  end if;
end $$;

create or replace function public.vibe_privacy_save(p jsonb) returns void
language plpgsql security definer set search_path = public as $$
declare me uuid := public.vibe_need_me();
begin
  update public.vibe_profiles set
    visibility = coalesce(p->>'visibility', visibility),
    discoverable = coalesce((p->>'discoverable')::boolean, discoverable),
    show_online = coalesce((p->>'show_online')::boolean, show_online),
    who_can_message = coalesce(p->>'who_can_message', who_can_message),
    read_receipts = coalesce((p->>'read_receipts')::boolean, read_receipts),
    updated_at = now()
  where user_id = me;
end $$;

create or replace function public.vibe_deactivate() returns void
language plpgsql security definer set search_path = public as $$
begin
  update public.vibe_profiles set status = 'deactivated', updated_at = now() where user_id = public.vibe_need_me();
  perform public.log_action('vibe.deactivated', 'vibe_profile', auth.uid()::text, null, null, null);
end $$;

create or replace function public.vibe_heartbeat() returns void
language sql security definer set search_path = public as $$
  update public.vibe_profiles set last_active_at = now() where user_id = auth.uid() and status = 'active' and (last_active_at is null or last_active_at < now() - interval '45 seconds');
$$;

-- My own state, for the app shell
create or replace function public.vibe_whoami() returns jsonb
language sql stable security definer set search_path = public as $$
  select case when auth.uid() is null then null else jsonb_build_object(
    'signed_in', true,
    'member', v.user_id is not null, 'status', v.status, 'username', v.username, 'name', coalesce(public.vibe_name(v.user_id), (select coalesce(display_name, full_name) from public.profiles where id = auth.uid())),
    'avatar', v.avatar_path,
    'unread_messages', (select count(*) from public.vibe_conversation_members cm join public.vibe_messages m on m.conversation_id = cm.conversation_id
                         where cm.user_id = auth.uid() and m.sender_id <> auth.uid() and m.created_at > cm.last_read_at and m.deleted_at is null),
    'unread_notifications', (select count(*) from public.notifications where user_id = auth.uid() and read_at is null),
    'moderator', public.has_permission('moderation.manage'),
    'settings', case when v.user_id is not null then jsonb_build_object('visibility', v.visibility, 'discoverable', v.discoverable, 'show_online', v.show_online, 'who_can_message', v.who_can_message, 'read_receipts', v.read_receipts) end)
  end
  from (select 1) one left join public.vibe_profiles v on v.user_id = auth.uid();
$$;

-- A profile page
create or replace function public.vibe_profile(p_username text) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare v public.vibe_profiles; me uuid := auth.uid();
begin
  select * into v from public.vibe_profiles where username = lower(p_username);
  if v.user_id is null or not public.vibe_can_see(me, v.user_id) then return null; end if;
  return public.vibe_card(v.user_id, me) || jsonb_build_object(
    'bio', v.bio, 'organisation', v.organisation, 'website', v.website, 'socials', v.socials,
    'interests', v.interests, 'skills', v.skills, 'cover', v.cover_path,
    'following', v.following_count, 'posts', v.posts_count, 'joined', v.created_at,
    'is_me', v.user_id = me, 'status', v.status,
    'can_message', public.vibe_can_message(me, v.user_id),
    'blocked_by_me', exists (select 1 from public.vibe_blocks where blocker = me and blocked = v.user_id),
    'muted_by_me', exists (select 1 from public.vibe_mutes where muter = me and muted = v.user_id),
    'email_verified', exists (select 1 from auth.users where id = v.user_id and email_confirmed_at is not null),
    'phone_verified', exists (select 1 from public.profiles where id = v.user_id and phone_verified_at is not null));
end $$;

-- ---------------------------------------------------------------------------------------------
-- Follows, blocks, mutes
-- ---------------------------------------------------------------------------------------------
create or replace function public.vibe_follow(p_user uuid, p_on boolean) returns jsonb
language plpgsql security definer set search_path = public as $$
declare me uuid := public.vibe_need_me(); n int;
begin
  if p_user = me then raise exception 'you cannot follow yourself'; end if;
  if p_on then
    if not public.vibe_can_see(me, p_user) or not exists (select 1 from public.vibe_profiles where user_id = p_user and status = 'active') then raise exception 'this member is not available'; end if;
    perform public.vibe_rate('vibe_follows', 'follower', 200, interval '1 day', 'follows');
    insert into public.vibe_follows (follower, followee) values (me, p_user) on conflict do nothing;
    get diagnostics n = row_count;
    if n > 0 and not exists (select 1 from public.notifications where user_id = p_user and topic = 'social' and link = '/vibe/u/' || (select username from public.vibe_profiles where user_id = me) and created_at > now() - interval '1 day') then
      perform public.notify(p_user, 'social', public.vibe_name(me) || ' started following you', null, '/vibe/u/' || (select username from public.vibe_profiles where user_id = me));
    end if;
  else
    delete from public.vibe_follows where follower = me and followee = p_user;
  end if;
  return public.vibe_card(p_user, me);
end $$;

create or replace function public.vibe_follow_counts() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'INSERT' then
    update public.vibe_profiles set following_count = following_count + 1 where user_id = new.follower;
    update public.vibe_profiles set followers_count = followers_count + 1 where user_id = new.followee;
  else
    update public.vibe_profiles set following_count = greatest(following_count - 1, 0) where user_id = old.follower;
    update public.vibe_profiles set followers_count = greatest(followers_count - 1, 0) where user_id = old.followee;
  end if;
  return null;
end $$;
create trigger vibe_follows_count after insert or delete on public.vibe_follows for each row execute function public.vibe_follow_counts();

create or replace function public.vibe_block(p_user uuid, p_on boolean) returns void
language plpgsql security definer set search_path = public as $$
declare me uuid := public.vibe_need_me();
begin
  if p_user = me then raise exception 'you cannot block yourself'; end if;
  if p_on then
    insert into public.vibe_blocks (blocker, blocked) values (me, p_user) on conflict do nothing;
    delete from public.vibe_follows where (follower = me and followee = p_user) or (follower = p_user and followee = me);
  else
    delete from public.vibe_blocks where blocker = me and blocked = p_user;
  end if;
end $$;

create or replace function public.vibe_mute(p_user uuid, p_on boolean) returns void
language plpgsql security definer set search_path = public as $$
declare me uuid := public.vibe_need_me();
begin
  if p_user = me then raise exception 'you cannot mute yourself'; end if;
  if p_on then insert into public.vibe_mutes (muter, muted) values (me, p_user) on conflict do nothing;
  else delete from public.vibe_mutes where muter = me and muted = p_user; end if;
end $$;

create or replace function public.vibe_blocked_list() returns jsonb language sql stable security definer set search_path = public as $$
  select coalesce(jsonb_agg(jsonb_build_object('id', b.blocked, 'username', v.username, 'name', public.vibe_name(b.blocked)) order by b.created_at desc), '[]')
  from public.vibe_blocks b join public.vibe_profiles v on v.user_id = b.blocked where b.blocker = auth.uid();
$$;

create or replace function public.vibe_connections(p_username text, p_kind text, p_offset int default 0) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare owner uuid := (select user_id from public.vibe_profiles where username = lower(p_username));
begin
  if owner is null or not public.vibe_can_see(auth.uid(), owner) then return '[]'; end if;
  return coalesce((select jsonb_agg(public.vibe_card(x.u)) from (
    select case when p_kind = 'followers' then f.follower else f.followee end u, f.created_at from public.vibe_follows f
    where (p_kind = 'followers' and f.followee = owner) or (p_kind = 'following' and f.follower = owner)
    order by f.created_at desc offset greatest(p_offset, 0) limit 50) x
    where public.vibe_can_see(auth.uid(), x.u) and exists (select 1 from public.vibe_profiles where user_id = x.u and status = 'active')), '[]');
end $$;

-- ---------------------------------------------------------------------------------------------
-- Discovery
-- ---------------------------------------------------------------------------------------------
create or replace function public.vibe_people(p_q text default '', p_interest text default '', p_location text default '', p_offset int default 0) returns jsonb
language sql stable security definer set search_path = public as $$
  select coalesce(jsonb_agg(public.vibe_card(x.user_id) || jsonb_build_object('interests', x.interests, 'skills', x.skills) order by x.rank desc, x.last_active_at desc nulls last), '[]') from (
    select v.*, (case when lower(v.username) = lower(trim(p_q)) then 10 else 0 end)
      + coalesce(extensions.similarity(lower(public.vibe_name(v.user_id) || ' ' || v.username || ' ' || v.headline || ' ' || array_to_string(v.skills, ' ')), lower(p_q)), 0) * 5
      + least(v.followers_count, 200) / 200.0 as rank
    from public.vibe_profiles v join public.profiles p on p.id = v.user_id
    where v.status = 'active' and p.status = 'active' and v.discoverable and v.user_id is distinct from auth.uid()
      and public.vibe_can_see(auth.uid(), v.user_id)
      and (trim(coalesce(p_q, '')) = '' or (lower(coalesce(p.display_name, '') || ' ' || coalesce(p.full_name, '') || ' ' || v.username || ' ' || v.headline || ' ' || v.location || ' ' || v.organisation || ' ' || array_to_string(v.interests, ' ') || ' ' || array_to_string(v.skills, ' ')) like '%' || lower(trim(p_q)) || '%'))
      and (coalesce(p_interest, '') = '' or exists (select 1 from unnest(v.interests || v.skills) i where lower(i) = lower(p_interest)))
      and (coalesce(p_location, '') = '' or lower(v.location) like '%' || lower(trim(p_location)) || '%')
    order by rank desc, v.last_active_at desc nulls last
    offset greatest(p_offset, 0) limit 24) x;
$$;

-- Suggestions in labelled groups, from real shared interests, follows and activity. Never includes blocked or hidden members.
create or replace function public.vibe_suggestions() returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare me uuid := public.vibe_me(); mine text[];
begin
  select interests || skills into mine from public.vibe_profiles where user_id = me;
  return jsonb_build_object(
    'similar', coalesce((select jsonb_agg(public.vibe_card(s.user_id) || jsonb_build_object('shared', s.shared)) from (
      select v.user_id, (select array_agg(i) from unnest(v.interests || v.skills) i where lower(i) in (select lower(m) from unnest(mine) m)) shared
      from public.vibe_profiles v where v.status = 'active' and v.discoverable and v.user_id <> coalesce(me, '00000000-0000-0000-0000-000000000000')
        and not exists (select 1 from public.vibe_follows f where f.follower = me and f.followee = v.user_id)
        and public.vibe_can_see(me, v.user_id)
        and exists (select 1 from unnest(v.interests || v.skills) i where lower(i) in (select lower(m) from unnest(mine) m))
      order by cardinality((select array_agg(i) from unnest(v.interests || v.skills) i where lower(i) in (select lower(m) from unnest(mine) m))) desc, v.last_active_at desc nulls last limit 8) s), '[]'),
    'know', coalesce((select jsonb_agg(public.vibe_card(s.u) || jsonb_build_object('mutuals', s.n)) from (
      select f2.followee u, count(*) n from public.vibe_follows f1 join public.vibe_follows f2 on f2.follower = f1.followee
      join public.vibe_profiles v on v.user_id = f2.followee
      where f1.follower = me and f2.followee <> me and v.status = 'active' and v.discoverable
        and not exists (select 1 from public.vibe_follows f where f.follower = me and f.followee = f2.followee)
        and public.vibe_can_see(me, f2.followee)
      group by f2.followee order by n desc limit 8) s), '[]'),
    'popular', coalesce((select jsonb_agg(public.vibe_card(v.user_id) order by v.followers_count desc) from (
      select v.user_id, v.followers_count from public.vibe_profiles v where v.status = 'active' and v.discoverable and v.followers_count > 0 and v.user_id is distinct from me
        and not exists (select 1 from public.vibe_follows f where f.follower = me and f.followee = v.user_id) and public.vibe_can_see(me, v.user_id)
      order by v.followers_count desc limit 8) v), '[]'),
    'new', coalesce((select jsonb_agg(public.vibe_card(v.user_id) order by v.created_at desc) from (
      select v.user_id, v.created_at from public.vibe_profiles v where v.status = 'active' and v.discoverable and v.user_id is distinct from me and public.vibe_can_see(me, v.user_id)
        and not exists (select 1 from public.vibe_follows f where f.follower = me and f.followee = v.user_id)
      order by v.created_at desc limit 8) v), '[]'));
end $$;

-- ---------------------------------------------------------------------------------------------
-- Posts, likes, comments
-- ---------------------------------------------------------------------------------------------
create or replace function public.vibe_post_json(p public.vibe_posts, viewer uuid) returns jsonb language sql stable security definer set search_path = public as $$
  select jsonb_build_object('id', p.id, 'kind', p.kind, 'body', p.body, 'media', p.media, 'created_at', p.created_at, 'edited_at', p.edited_at,
    'likes', p.likes_count, 'comments', p.comments_count, 'liked', exists (select 1 from public.vibe_likes l where l.post_id = p.id and l.user_id = viewer),
    'mine', p.author_id = viewer, 'featured', p.featured_on_profile, 'author', public.vibe_card(p.author_id, viewer));
$$;
create or replace function public.vibe_can_see_post(viewer uuid, p_id bigint) returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.vibe_posts p where p.id = p_id and p.removed_at is null and public.vibe_can_see(viewer, p.author_id));
$$;

create or replace function public.vibe_post_save(p_id bigint, p_kind text, p_body text, p_media text[] default '{}') returns jsonb
language plpgsql security definer set search_path = public as $$
declare me uuid := public.vibe_need_me(); r public.vibe_posts; m text;
begin
  foreach m in array coalesce(p_media, '{}') loop
    if m !~ ('^' || me::text || '/[A-Za-z0-9._/-]+$') then raise exception 'photos must be uploaded from your own account'; end if;
  end loop;
  if (select status from public.vibe_profiles where user_id = me) = 'restricted' then raise exception 'your account cannot post right now'; end if;
  if p_id is null then
    perform public.vibe_rate('vibe_posts', 'author_id', 20, interval '1 hour', 'posts');
    insert into public.vibe_posts (author_id, kind, body, media) values (me, coalesce(p_kind, 'post'), trim(coalesce(p_body, '')), coalesce(p_media, '{}')) returning * into r;
  else
    update public.vibe_posts set kind = coalesce(p_kind, kind), body = trim(coalesce(p_body, '')), media = coalesce(p_media, media), edited_at = now()
    where id = p_id and author_id = me and removed_at is null returning * into r;
    if r.id is null then raise exception 'post not found'; end if;
  end if;
  return public.vibe_post_json(r, me);
end $$;

create or replace function public.vibe_post_delete(p_id bigint) returns void
language plpgsql security definer set search_path = public as $$
begin
  delete from public.vibe_posts where id = p_id and author_id = public.vibe_need_me();
  if not found then raise exception 'post not found'; end if;
end $$;

create or replace function public.vibe_post_feature(p_id bigint, p_on boolean) returns void
language plpgsql security definer set search_path = public as $$
begin
  update public.vibe_posts set featured_on_profile = p_on where id = p_id and author_id = public.vibe_need_me();
end $$;

create or replace function public.vibe_post_counts() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'INSERT' then update public.vibe_profiles set posts_count = posts_count + 1 where user_id = new.author_id;
  elsif tg_op = 'DELETE' then update public.vibe_profiles set posts_count = greatest(posts_count - 1, 0) where user_id = old.author_id;
  elsif old.removed_at is null and new.removed_at is not null then update public.vibe_profiles set posts_count = greatest(posts_count - 1, 0) where user_id = new.author_id;
  elsif old.removed_at is not null and new.removed_at is null then update public.vibe_profiles set posts_count = posts_count + 1 where user_id = new.author_id;
  end if;
  return null;
end $$;
create trigger vibe_posts_count after insert or delete or update of removed_at on public.vibe_posts for each row execute function public.vibe_post_counts();

-- p_scope: 'following' (people I follow and me), 'all' (everyone I can see), 'user:<username>'
create or replace function public.vibe_feed(p_scope text default 'following', p_before bigint default null, p_kind text default null) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare me uuid := auth.uid(); owner uuid;
begin
  if p_scope like 'user:%' then
    owner := (select user_id from public.vibe_profiles where username = lower(substr(p_scope, 6)));
    if owner is null or not public.vibe_can_see(me, owner) then return '[]'; end if;
  end if;
  return coalesce((select jsonb_agg(public.vibe_post_json(p, me) order by p.id desc) from (
    select p.* from public.vibe_posts p join public.vibe_profiles v on v.user_id = p.author_id
    where p.removed_at is null and (p_before is null or p.id < p_before) and (p_kind is null or p.kind = p_kind)
      and (v.status = 'active' or p.author_id = me)
      and case when p_scope = 'following' then p.author_id = me or exists (select 1 from public.vibe_follows f where f.follower = me and f.followee = p.author_id)
               when p_scope like 'user:%' then p.author_id = owner
               else true end
      and public.vibe_can_see(me, p.author_id)
      and not exists (select 1 from public.vibe_mutes mu where mu.muter = me and mu.muted = p.author_id and p_scope not like 'user:%')
    order by p.id desc limit 20) p), '[]');
end $$;

create or replace function public.vibe_post(p_id bigint) returns jsonb
language sql stable security definer set search_path = public as $$
  select case when public.vibe_can_see_post(auth.uid(), p.id) then public.vibe_post_json(p, auth.uid()) end from public.vibe_posts p where p.id = p_id;
$$;

create or replace function public.vibe_like(p_post bigint, p_on boolean) returns jsonb
language plpgsql security definer set search_path = public as $$
declare me uuid := public.vibe_need_me(); n int; a uuid;
begin
  if not public.vibe_can_see_post(me, p_post) then raise exception 'post not found'; end if;
  if p_on then
    insert into public.vibe_likes (post_id, user_id) values (p_post, me) on conflict do nothing;
    get diagnostics n = row_count;
    if n > 0 then
      update public.vibe_posts set likes_count = likes_count + 1 where id = p_post returning author_id into a;
      if a <> me and not exists (select 1 from public.notifications where user_id = a and topic = 'social' and link = '/vibe/p/?id=' || p_post and title like '%liked%' and read_at is null) then
        perform public.notify(a, 'social', public.vibe_name(me) || ' liked your post', null, '/vibe/p/?id=' || p_post);
      end if;
    end if;
  else
    delete from public.vibe_likes where post_id = p_post and user_id = me;
    get diagnostics n = row_count;
    if n > 0 then update public.vibe_posts set likes_count = greatest(likes_count - 1, 0) where id = p_post; end if;
  end if;
  return (select jsonb_build_object('likes', likes_count, 'liked', p_on) from public.vibe_posts where id = p_post);
end $$;

create or replace function public.vibe_comment_add(p_post bigint, p_body text, p_parent bigint default null) returns jsonb
language plpgsql security definer set search_path = public as $$
declare me uuid := public.vibe_need_me(); c public.vibe_comments; a uuid; pa uuid;
begin
  if not public.vibe_can_see_post(me, p_post) then raise exception 'post not found'; end if;
  if (select status from public.vibe_profiles where user_id = me) = 'restricted' then raise exception 'your account cannot comment right now'; end if;
  perform public.vibe_rate('vibe_comments', 'author_id', 60, interval '1 hour', 'comments');
  if p_parent is not null then
    select author_id into pa from public.vibe_comments where id = p_parent and post_id = p_post and parent_id is null and removed_at is null;
    if pa is null then raise exception 'you can reply to a comment on this post only'; end if;
  end if;
  insert into public.vibe_comments (post_id, author_id, parent_id, body) values (p_post, me, p_parent, trim(p_body)) returning * into c;
  update public.vibe_posts set comments_count = comments_count + 1 where id = p_post returning author_id into a;
  if a <> me and not public.vibe_blocked(a, me) then perform public.notify(a, 'social', public.vibe_name(me) || ' commented on your post', left(c.body, 140), '/vibe/p/?id=' || p_post); end if;
  if pa is not null and pa <> me and pa <> a then perform public.notify(pa, 'social', public.vibe_name(me) || ' replied to your comment', left(c.body, 140), '/vibe/p/?id=' || p_post); end if;
  return jsonb_build_object('id', c.id, 'body', c.body, 'parent_id', c.parent_id, 'created_at', c.created_at, 'mine', true, 'author', public.vibe_card(me, me));
end $$;

create or replace function public.vibe_comment_delete(p_id bigint) returns void
language plpgsql security definer set search_path = public as $$
declare me uuid := public.vibe_need_me(); c public.vibe_comments; n int;
begin
  select * into c from public.vibe_comments where id = p_id;
  if c.id is null or not (c.author_id = me or exists (select 1 from public.vibe_posts where id = c.post_id and author_id = me)) then raise exception 'comment not found'; end if;
  select 1 + (select count(*) from public.vibe_comments where parent_id = c.id) into n;
  delete from public.vibe_comments where id = p_id;
  update public.vibe_posts set comments_count = greatest(comments_count - n, 0) where id = c.post_id;
end $$;

create or replace function public.vibe_comments_list(p_post bigint) returns jsonb
language sql stable security definer set search_path = public as $$
  select case when public.vibe_can_see_post(auth.uid(), p_post) then coalesce((select jsonb_agg(jsonb_build_object('id', c.id, 'body', c.body, 'parent_id', c.parent_id, 'created_at', c.created_at,
      'mine', c.author_id = auth.uid(), 'can_delete', c.author_id = auth.uid() or (select author_id from public.vibe_posts where id = p_post) = auth.uid(),
      'author', public.vibe_card(c.author_id)) order by coalesce(c.parent_id, c.id), c.id)
    from public.vibe_comments c where c.post_id = p_post and c.removed_at is null and public.vibe_can_see(auth.uid(), c.author_id)), '[]') else '[]' end;
$$;

-- ---------------------------------------------------------------------------------------------
-- Private messages
-- ---------------------------------------------------------------------------------------------
create or replace function public.vibe_can_message(a uuid, b uuid) returns boolean language sql stable security definer set search_path = public as $$
  select a is not null and a <> b and not public.vibe_blocked(a, b)
    and exists (select 1 from public.vibe_profiles where user_id = a and status = 'active')
    and exists (select 1 from public.vibe_profiles v where v.user_id = b and v.status = 'active' and (
      v.who_can_message = 'everyone'
      or (v.who_can_message = 'followers' and exists (select 1 from public.vibe_follows f where f.follower = a and f.followee = b))
      -- an existing conversation can always continue unless someone blocked
      or exists (select 1 from public.vibe_conversations c where c.direct_key = least(a, b)::text || ':' || greatest(a, b)::text)));
$$;
create or replace function public.vibe_in_conversation(p_conv uuid, u uuid default auth.uid()) returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.vibe_conversation_members where conversation_id = p_conv and user_id = u);
$$;

create or replace function public.vibe_conversation_open(p_user uuid) returns uuid
language plpgsql security definer set search_path = public as $$
declare me uuid := public.vibe_need_me(); k text := least(me, p_user)::text || ':' || greatest(me, p_user)::text; c uuid;
begin
  select id into c from public.vibe_conversations where direct_key = k;
  if c is not null then
    if public.vibe_blocked(me, p_user) then raise exception 'you cannot message this member'; end if;
    update public.vibe_conversation_members set hidden_at = null where conversation_id = c and user_id = me;
    return c;
  end if;
  if not public.vibe_can_message(me, p_user) then raise exception 'this member is not accepting messages from you'; end if;
  if (select count(*) from public.vibe_conversations cv join public.vibe_conversation_members m on m.conversation_id = cv.id and m.user_id = me where cv.created_at > now() - interval '1 day') >= 30 then
    raise exception 'too many new conversations today; please wait a while';
  end if;
  insert into public.vibe_conversations (direct_key) values (k) returning id into c;
  insert into public.vibe_conversation_members (conversation_id, user_id) values (c, me), (c, p_user);
  return c;
end $$;

create or replace function public.vibe_message_send(p_conv uuid, p_kind text, p_body text, p_attachment text default null, p_name text default null, p_duration int default null, p_reply bigint default null) returns jsonb
language plpgsql security definer set search_path = public as $$
declare me uuid := public.vibe_need_me(); other uuid; m public.vibe_messages;
begin
  if not public.vibe_in_conversation(p_conv, me) then raise exception 'conversation not found'; end if;
  select user_id into other from public.vibe_conversation_members where conversation_id = p_conv and user_id <> me limit 1;
  if public.vibe_blocked(me, other) or not exists (select 1 from public.vibe_profiles where user_id = other and status = 'active') then raise exception 'you cannot message this member'; end if;
  if (select count(*) from public.vibe_messages where sender_id = me and created_at > now() - interval '10 minutes') >= 120 then raise exception 'too many messages in a short time; please wait a while'; end if;
  if p_attachment is not null and p_attachment !~ ('^' || p_conv::text || '/' || me::text || '/[A-Za-z0-9._-]+$') then raise exception 'attachments must be uploaded to this conversation'; end if;
  if p_reply is not null and not exists (select 1 from public.vibe_messages where id = p_reply and conversation_id = p_conv) then p_reply := null; end if;
  insert into public.vibe_messages (conversation_id, sender_id, kind, body, attachment_path, attachment_name, duration_s, reply_to)
  values (p_conv, me, coalesce(p_kind, 'text'), trim(coalesce(p_body, '')), p_attachment, left(p_name, 120), p_duration, p_reply) returning * into m;
  update public.vibe_conversations set last_message_at = m.created_at where id = p_conv;
  update public.vibe_conversation_members set last_read_at = m.created_at where conversation_id = p_conv and user_id = me;
  update public.vibe_conversation_members set hidden_at = null where conversation_id = p_conv;
  -- one unread notice per conversation, not one per message
  if not exists (select 1 from public.notifications where user_id = other and topic = 'messages' and link = '/vibe/messages/?c=' || p_conv and read_at is null) then
    perform public.notify(other, 'messages', 'New message from ' || public.vibe_name(me), case when m.kind = 'text' then left(m.body, 120) else 'Sent a ' || case m.kind when 'image' then 'photo' when 'voice' then 'voice note' else 'document' end end, '/vibe/messages/?c=' || p_conv);
  end if;
  return to_jsonb(m) - 'attachment_path' || jsonb_build_object('attachment_path', m.attachment_path, 'mine', true);
end $$;

create or replace function public.vibe_inbox(p_q text default '') returns jsonb
language sql stable security definer set search_path = public as $$
  select coalesce(jsonb_agg(x order by (x->>'last_message_at') desc), '[]') from (
    select jsonb_build_object('id', c.id, 'last_message_at', c.last_message_at, 'other', public.vibe_card(o.user_id),
      'unread', (select count(*) from public.vibe_messages m where m.conversation_id = c.id and m.sender_id <> auth.uid() and m.created_at > me.last_read_at and m.deleted_at is null),
      'last', (select jsonb_build_object('kind', m.kind, 'body', case when m.deleted_at is null then left(m.body, 80) else 'Message deleted' end, 'mine', m.sender_id = auth.uid())
               from public.vibe_messages m where m.conversation_id = c.id order by m.id desc limit 1),
      'blocked', public.vibe_blocked(auth.uid(), o.user_id)) x
    from public.vibe_conversation_members me
    join public.vibe_conversations c on c.id = me.conversation_id
    join public.vibe_conversation_members o on o.conversation_id = c.id and o.user_id <> me.user_id
    where me.user_id = auth.uid() and me.hidden_at is null
      and exists (select 1 from public.vibe_messages m where m.conversation_id = c.id)
      and (coalesce(p_q, '') = '' or lower(public.vibe_name(o.user_id) || ' ' || (select username from public.vibe_profiles where user_id = o.user_id)) like '%' || lower(trim(p_q)) || '%')
    limit 100) s;
$$;

create or replace function public.vibe_messages_list(p_conv uuid, p_before bigint default null) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare other uuid; o_read timestamptz; o_receipts boolean; my_receipts boolean;
begin
  if not public.vibe_in_conversation(p_conv) then raise exception 'conversation not found'; end if;
  select m.user_id, m.last_read_at, v.read_receipts into other, o_read, o_receipts from public.vibe_conversation_members m join public.vibe_profiles v on v.user_id = m.user_id
  where m.conversation_id = p_conv and m.user_id <> auth.uid();
  select read_receipts into my_receipts from public.vibe_profiles where user_id = auth.uid();
  return jsonb_build_object('other', public.vibe_card(other), 'can_send', public.vibe_can_message(auth.uid(), other) or (not public.vibe_blocked(auth.uid(), other) and exists (select 1 from public.vibe_profiles where user_id = other and status = 'active')),
    'blocked', public.vibe_blocked(auth.uid(), other),
    'seen_until', case when o_receipts and my_receipts then o_read end,
    'messages', coalesce((select jsonb_agg(jsonb_build_object('id', m.id, 'kind', m.kind, 'body', case when m.deleted_at is null then m.body else '' end,
        'attachment_path', case when m.deleted_at is null then m.attachment_path end, 'attachment_name', m.attachment_name, 'duration_s', m.duration_s,
        'reply_to', m.reply_to, 'created_at', m.created_at, 'deleted', m.deleted_at is not null, 'mine', m.sender_id = auth.uid(),
        'reactions', (select coalesce(jsonb_agg(jsonb_build_object('emoji', r.emoji, 'mine', r.user_id = auth.uid())), '[]') from public.vibe_message_reactions r where r.message_id = m.id)) order by m.id)
      from (select * from public.vibe_messages where conversation_id = p_conv and (p_before is null or id < p_before) order by id desc limit 50) m), '[]'));
end $$;

create or replace function public.vibe_conversation_read(p_conv uuid) returns void
language plpgsql security definer set search_path = public as $$
begin
  update public.vibe_conversation_members set last_read_at = now() where conversation_id = p_conv and user_id = auth.uid();
  update public.notifications set read_at = now() where user_id = auth.uid() and topic = 'messages' and link = '/vibe/messages/?c=' || p_conv and read_at is null;
end $$;

create or replace function public.vibe_message_delete(p_id bigint) returns void
language plpgsql security definer set search_path = public as $$
begin
  update public.vibe_messages set deleted_at = now(), body = '' where id = p_id and sender_id = public.vibe_need_me() and deleted_at is null;
  if not found then raise exception 'message not found'; end if;
end $$;

create or replace function public.vibe_message_react(p_id bigint, p_emoji text) returns void
language plpgsql security definer set search_path = public as $$
declare me uuid := public.vibe_need_me();
begin
  if not exists (select 1 from public.vibe_messages m where m.id = p_id and public.vibe_in_conversation(m.conversation_id, me) and m.deleted_at is null) then raise exception 'message not found'; end if;
  if p_emoji is null or p_emoji = '' then delete from public.vibe_message_reactions where message_id = p_id and user_id = me;
  else insert into public.vibe_message_reactions (message_id, user_id, emoji) values (p_id, me, p_emoji) on conflict (message_id, user_id) do update set emoji = excluded.emoji; end if;
end $$;

create or replace function public.vibe_conversation_hide(p_conv uuid) returns void
language sql security definer set search_path = public as $$
  update public.vibe_conversation_members set hidden_at = now(), last_read_at = now() where conversation_id = p_conv and user_id = auth.uid();
$$;

-- Realtime: members of a conversation can read its messages (needed for live delivery); nobody can write directly.
create policy "members read their conversations" on public.vibe_messages for select to authenticated using (public.vibe_in_conversation(conversation_id));
create policy "members read their membership" on public.vibe_conversation_members for select to authenticated using (user_id = auth.uid());
grant select on public.vibe_messages, public.vibe_conversation_members to authenticated;
do $$ begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    execute 'alter publication supabase_realtime add table public.vibe_messages';
  end if;
end $$;

-- Message attachments: a private bucket. Files live under <conversation>/<sender>/..., only members can read them.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('vibe-private', 'vibe-private', false, 10485760, array['image/jpeg', 'image/png', 'image/webp', 'audio/webm', 'audio/ogg', 'audio/mp4', 'audio/mpeg', 'application/pdf',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', 'application/vnd.openxmlformats-officedocument.presentationml.presentation'])
on conflict (id) do nothing;
create policy "vibe private read by conversation members" on storage.objects for select to authenticated
  using (bucket_id = 'vibe-private' and public.vibe_in_conversation(nullif(split_part(name, '/', 1), '')::uuid));
create policy "vibe private upload by sender" on storage.objects for insert to authenticated
  with check (bucket_id = 'vibe-private' and split_part(name, '/', 2) = auth.uid()::text and public.vibe_in_conversation(nullif(split_part(name, '/', 1), '')::uuid));

-- Profile photos and post photos: a public bucket, each member writes only in their own folder.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('vibe-media', 'vibe-media', true, 5242880, array['image/jpeg', 'image/png', 'image/webp'])
on conflict (id) do nothing;
create policy "vibe media readable" on storage.objects for select using (bucket_id = 'vibe-media');
create policy "vibe media upload own" on storage.objects for insert to authenticated with check (bucket_id = 'vibe-media' and split_part(name, '/', 1) = auth.uid()::text);
create policy "vibe media remove own" on storage.objects for delete to authenticated using (bucket_id = 'vibe-media' and split_part(name, '/', 1) = auth.uid()::text);

-- ---------------------------------------------------------------------------------------------
-- Reports and moderation
-- ---------------------------------------------------------------------------------------------
create or replace function public.vibe_report(p_type text, p_id text, p_reason text, p_details text default null) returns void
language plpgsql security definer set search_path = public as $$
declare me uuid := public.vibe_need_me(); owner uuid;
begin
  if (select count(*) from public.vibe_reports where reporter = me and created_at > now() - interval '1 day') >= 20 then raise exception 'too many reports today'; end if;
  owner := case p_type
    when 'profile' then (select user_id from public.vibe_profiles where user_id::text = p_id)
    when 'post' then (select author_id from public.vibe_posts where id::text = p_id and public.vibe_can_see_post(me, id))
    when 'comment' then (select author_id from public.vibe_comments where id::text = p_id)
    when 'message' then (select sender_id from public.vibe_messages m where m.id::text = p_id and public.vibe_in_conversation(m.conversation_id, me))
    else null end;
  if owner is null and p_type in ('profile', 'post', 'comment', 'message') then raise exception 'nothing to report'; end if;
  if owner = me then raise exception 'you cannot report your own content'; end if;
  insert into public.vibe_reports (reporter, target_type, target_id, target_owner, reason, details)
  values (me, p_type, p_id, owner, p_reason, nullif(left(trim(coalesce(p_details, '')), 500), '')) on conflict (reporter, target_type, target_id) do nothing;
  -- tell staff once per item, not once per report
  if (select count(*) from public.vibe_reports where target_type = p_type and target_id = p_id and status = 'open') = 1 then
    perform public.staff_alert('vibe_report', null, 'TnPVibe report: ' || p_type || ', reason ' || p_reason || '. Review it at technapesa.co.ke/admin/vibe/');
  end if;
end $$;

create or replace function public.admin_vibe_reports(p_status text default 'open') returns jsonb
language plpgsql stable security definer set search_path = public as $$
begin
  if not public.has_permission('moderation.manage') then raise exception 'not allowed'; end if;
  return coalesce((select jsonb_agg(jsonb_build_object('id', r.id, 'type', r.target_type, 'target_id', r.target_id, 'reason', r.reason, 'details', r.details, 'status', r.status, 'created_at', r.created_at,
      'reporter', (select username from public.vibe_profiles where user_id = r.reporter),
      'owner', (select jsonb_build_object('id', v.user_id, 'username', v.username, 'name', public.vibe_name(v.user_id), 'status', v.status) from public.vibe_profiles v where v.user_id = r.target_owner),
      'reports_on_target', (select count(*) from public.vibe_reports x where x.target_type = r.target_type and x.target_id = r.target_id),
      -- moderators see the reported item itself; for messages only the single reported message, never the conversation
      'content', case r.target_type
        when 'post' then (select jsonb_build_object('body', body, 'media', media, 'removed', removed_at is not null) from public.vibe_posts where id::text = r.target_id)
        when 'comment' then (select jsonb_build_object('body', body, 'removed', removed_at is not null) from public.vibe_comments where id::text = r.target_id)
        when 'message' then (select jsonb_build_object('body', body, 'kind', kind) from public.vibe_messages where id::text = r.target_id)
        when 'profile' then (select jsonb_build_object('body', headline || ' ' || bio) from public.vibe_profiles where user_id::text = r.target_id) end) order by r.created_at)
    from public.vibe_reports r where r.status = p_status and (p_status = 'open' or r.handled_at > now() - interval '30 days')), '[]');
end $$;

-- p_action: dismiss, remove (the reported post or comment), restrict (the owner cannot post or comment), suspend (owner's whole account), restore
create or replace function public.admin_vibe_report_decide(p_report bigint, p_action text, p_note text default null) returns void
language plpgsql security definer set search_path = public as $$
declare r public.vibe_reports;
begin
  if not public.has_permission('moderation.manage') then raise exception 'not allowed'; end if;
  select * into r from public.vibe_reports where id = p_report;
  if r.id is null then raise exception 'report not found'; end if;
  if p_action = 'remove' then
    if r.target_type = 'post' then update public.vibe_posts set removed_at = now(), removed_reason = coalesce(p_note, r.reason) where id::text = r.target_id;
    elsif r.target_type = 'comment' then update public.vibe_comments set removed_at = now() where id::text = r.target_id;
    elsif r.target_type = 'message' then update public.vibe_messages set deleted_at = now(), body = '' where id::text = r.target_id;
    else raise exception 'this item cannot be removed; restrict or suspend the member instead'; end if;
    if r.target_owner is not null then perform public.notify(r.target_owner, 'account', 'Your ' || r.target_type || ' was removed from TnPVibe', 'It broke the TnPVibe community guidelines. Reason: ' || coalesce(p_note, r.reason), '/vibe/guidelines/'); end if;
  elsif p_action = 'restrict' then
    update public.vibe_profiles set status = 'restricted' where user_id = r.target_owner;
    perform public.notify(r.target_owner, 'account', 'Your TnPVibe account is restricted', 'You cannot post or comment for now. Reason: ' || coalesce(p_note, r.reason), '/vibe/guidelines/');
  elsif p_action = 'suspend' then
    if not public.has_permission('users.manage_status') then raise exception 'only administrators can suspend accounts'; end if;
    update public.profiles set status = 'suspended', status_reason = coalesce(p_note, 'TnPVibe: ' || r.reason) where id = r.target_owner;
  elsif p_action = 'restore' then
    update public.vibe_profiles set status = 'active' where user_id = r.target_owner and status = 'restricted';
    if r.target_type = 'post' then update public.vibe_posts set removed_at = null, removed_reason = null where id::text = r.target_id; end if;
    if r.target_type = 'comment' then update public.vibe_comments set removed_at = null where id::text = r.target_id; end if;
  elsif p_action <> 'dismiss' then raise exception 'unknown action';
  end if;
  update public.vibe_reports set status = case when p_action in ('dismiss', 'restore') then 'dismissed' else 'actioned' end, handled_by = auth.uid(), handled_at = now(), handled_note = p_note
  where target_type = r.target_type and target_id = r.target_id and status = 'open' or id = p_report;
  perform public.log_action('vibe.report.' || p_action, 'vibe_report', p_report::text, to_jsonb(r), null, p_note);
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
    'open_reports', (select count(*) from public.vibe_reports where status = 'open'),
    'actioned_30d', (select count(*) from public.vibe_reports where status = 'actioned' and handled_at > now() - interval '30 days'),
    'restricted', (select count(*) from public.vibe_profiles where status = 'restricted'));
end $$;

-- ---------------------------------------------------------------------------------------------
-- Grants: members call functions; tables are never written directly
-- ---------------------------------------------------------------------------------------------
revoke all on function public.vibe_follow_counts(), public.vibe_post_counts(), public.vibe_rate(text, text, int, interval, text) from public, anon, authenticated;
revoke execute on function public.vibe_join(text, boolean, text, text[]), public.vibe_profile_save(jsonb), public.vibe_privacy_save(jsonb), public.vibe_deactivate(), public.vibe_heartbeat(),
  public.vibe_follow(uuid, boolean), public.vibe_block(uuid, boolean), public.vibe_mute(uuid, boolean), public.vibe_blocked_list(),
  public.vibe_post_save(bigint, text, text, text[]), public.vibe_post_delete(bigint), public.vibe_post_feature(bigint, boolean), public.vibe_like(bigint, boolean),
  public.vibe_comment_add(bigint, text, bigint), public.vibe_comment_delete(bigint),
  public.vibe_conversation_open(uuid), public.vibe_message_send(uuid, text, text, text, text, int, bigint), public.vibe_inbox(text), public.vibe_messages_list(uuid, bigint),
  public.vibe_conversation_read(uuid), public.vibe_message_delete(bigint), public.vibe_message_react(bigint, text), public.vibe_conversation_hide(uuid),
  public.vibe_report(text, text, text, text), public.vibe_suggestions(),
  public.admin_vibe_reports(text), public.admin_vibe_report_decide(bigint, text, text), public.admin_vibe_stats() from public, anon;
grant execute on function public.vibe_join(text, boolean, text, text[]), public.vibe_profile_save(jsonb), public.vibe_privacy_save(jsonb), public.vibe_deactivate(), public.vibe_heartbeat(),
  public.vibe_follow(uuid, boolean), public.vibe_block(uuid, boolean), public.vibe_mute(uuid, boolean), public.vibe_blocked_list(),
  public.vibe_post_save(bigint, text, text, text[]), public.vibe_post_delete(bigint), public.vibe_post_feature(bigint, boolean), public.vibe_like(bigint, boolean),
  public.vibe_comment_add(bigint, text, bigint), public.vibe_comment_delete(bigint),
  public.vibe_conversation_open(uuid), public.vibe_message_send(uuid, text, text, text, text, int, bigint), public.vibe_inbox(text), public.vibe_messages_list(uuid, bigint),
  public.vibe_conversation_read(uuid), public.vibe_message_delete(bigint), public.vibe_message_react(bigint, text), public.vibe_conversation_hide(uuid),
  public.vibe_report(text, text, text, text), public.vibe_suggestions(),
  public.admin_vibe_reports(text), public.admin_vibe_report_decide(bigint, text, text), public.admin_vibe_stats() to authenticated;
-- Public reads (visitors can view public profiles and posts)
grant execute on function public.vibe_whoami(), public.vibe_profile(text), public.vibe_feed(text, bigint, text), public.vibe_post(bigint), public.vibe_comments_list(bigint),
  public.vibe_connections(text, text, int), public.vibe_people(text, text, text, int), public.vibe_username_free(text) to anon, authenticated;
revoke execute on function public.vibe_card(uuid, uuid), public.vibe_name(uuid), public.vibe_can_see(uuid, uuid), public.vibe_blocked(uuid, uuid), public.vibe_in_conversation(uuid, uuid),
  public.vibe_can_message(uuid, uuid), public.vibe_can_see_post(uuid, bigint), public.vibe_post_json(public.vibe_posts, uuid), public.vibe_me(), public.vibe_need_me() from public, anon;
grant execute on function public.vibe_in_conversation(uuid, uuid) to authenticated;

-- Notification choices for the two new topics, for members who join TnPVibe (in app on, email off by default).
create or replace function public.vibe_prefs_on_join() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  insert into public.notification_prefs (user_id, topic, channel, enabled)
  select new.user_id, t, c, c = 'in_app' from unnest(array['social', 'messages']) t, unnest(array['in_app', 'email']) c
  on conflict do nothing;
  return new;
end $$;
create trigger vibe_profiles_prefs after insert on public.vibe_profiles for each row execute function public.vibe_prefs_on_join();
revoke all on function public.vibe_prefs_on_join() from public, anon, authenticated;
