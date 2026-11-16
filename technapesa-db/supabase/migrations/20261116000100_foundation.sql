-- TECH na PESA foundation: accounts, roles and permissions, consents, notification preferences,
-- audit log, locations, categories and site settings. Every table has row level security.
-- Server-side work uses the service role; browsers use the anon/authenticated roles and see only what policies allow.

create extension if not exists pgcrypto with schema extensions;
create extension if not exists pg_trgm with schema extensions;
create extension if not exists postgis with schema extensions;

-- ---------------------------------------------------------------------------------------------
-- Roles and permissions
-- ---------------------------------------------------------------------------------------------
create table public.roles (
  key text primary key check (key ~ '^[a-z_]{3,40}$'),
  name text not null,
  description text not null default '',
  is_staff boolean not null default false,      -- staff roles can only be granted by an administrator
  self_service boolean not null default false,  -- a user may add this role to their own account (e.g. business_owner)
  sort smallint not null default 100
);

insert into public.roles (key, name, description, is_staff, self_service, sort) values
  ('general_user',          'General user',           'Every account',                                         false, false, 10),
  ('business_owner',        'Business owner',         'Owns or manages a business profile',                    false, true,  20),
  ('digital_growth_client', 'Digital Growth client',  'Approved Digital Growth trial or subscription',         false, false, 30),
  ('professional',          'Professional',           'Service provider with a professional profile',          false, true,  40),
  ('property_advertiser',   'Property advertiser',    'Future Homes division',                                 false, false, 50),
  ('agent',                 'Agent',                  'Future Homes division',                                 false, false, 60),
  ('employer',              'Employer',               'Future Opportunities division',                         false, false, 70),
  ('contributor',           'Contributor',            'Writes community content',                              false, false, 80),
  ('editor',                'Editor',                 'Edits and publishes content',                           true,  false, 90),
  ('moderator',             'Moderator',              'Reviews reports, reviews and community content',        true,  false, 100),
  ('service_manager',       'Service manager',        'Runs Digital Growth and Business Connect operations',   true,  false, 110),
  ('administrator',         'Administrator',          'Full control, including roles and settings',            true,  false, 120);

create table public.permissions (
  key text primary key check (key ~ '^[a-z_]+\.[a-z_]+$'),
  description text not null
);

insert into public.permissions (key, description) values
  ('users.view',            'Search users and view account details'),
  ('users.manage_roles',    'Grant and remove roles'),
  ('users.manage_status',   'Suspend and reactivate accounts, process deletion requests'),
  ('audit.view',            'Read the audit log'),
  ('settings.manage',       'Change platform settings and homepage sections'),
  ('categories.manage',     'Create, edit and deactivate categories'),
  ('growth.manage',         'Review Digital Growth applications, trials, packages and subscriptions'),
  ('business.manage',       'Manage business profiles, featured listings and service requests'),
  ('payments.view',         'View transactions and reconciliation'),
  ('payments.refund',       'Record authorised refunds'),
  ('support.manage',        'View, assign and answer support cases'),
  ('content.manage',        'Manage articles, banners and announcements'),
  ('moderation.manage',     'Moderate reviews, reports and community content'),
  ('verification.manage',   'Review verification evidence and record decisions');

create table public.role_permissions (
  role text not null references public.roles(key) on delete cascade,
  permission text not null references public.permissions(key) on delete cascade,
  primary key (role, permission)
);

insert into public.role_permissions (role, permission)
select 'administrator', key from public.permissions;
insert into public.role_permissions (role, permission) values
  ('service_manager', 'users.view'), ('service_manager', 'growth.manage'), ('service_manager', 'business.manage'),
  ('service_manager', 'payments.view'), ('service_manager', 'support.manage'),
  ('moderator', 'users.view'), ('moderator', 'moderation.manage'), ('moderator', 'support.manage'),
  ('editor', 'content.manage');

-- ---------------------------------------------------------------------------------------------
-- Locations (all 47 counties; towns and areas are added later from an official source)
-- ---------------------------------------------------------------------------------------------
create table public.counties (
  id smallint primary key check (id between 1 and 47),  -- official county code
  name text not null unique,
  slug text not null unique
);

insert into public.counties (id, name, slug) values
  (1,'Mombasa','mombasa'),(2,'Kwale','kwale'),(3,'Kilifi','kilifi'),(4,'Tana River','tana-river'),(5,'Lamu','lamu'),
  (6,'Taita Taveta','taita-taveta'),(7,'Garissa','garissa'),(8,'Wajir','wajir'),(9,'Mandera','mandera'),(10,'Marsabit','marsabit'),
  (11,'Isiolo','isiolo'),(12,'Meru','meru'),(13,'Tharaka Nithi','tharaka-nithi'),(14,'Embu','embu'),(15,'Kitui','kitui'),
  (16,'Machakos','machakos'),(17,'Makueni','makueni'),(18,'Nyandarua','nyandarua'),(19,'Nyeri','nyeri'),(20,'Kirinyaga','kirinyaga'),
  (21,'Murang''a','muranga'),(22,'Kiambu','kiambu'),(23,'Turkana','turkana'),(24,'West Pokot','west-pokot'),(25,'Samburu','samburu'),
  (26,'Trans Nzoia','trans-nzoia'),(27,'Uasin Gishu','uasin-gishu'),(28,'Elgeyo Marakwet','elgeyo-marakwet'),(29,'Nandi','nandi'),(30,'Baringo','baringo'),
  (31,'Laikipia','laikipia'),(32,'Nakuru','nakuru'),(33,'Narok','narok'),(34,'Kajiado','kajiado'),(35,'Kericho','kericho'),
  (36,'Bomet','bomet'),(37,'Kakamega','kakamega'),(38,'Vihiga','vihiga'),(39,'Bungoma','bungoma'),(40,'Busia','busia'),
  (41,'Siaya','siaya'),(42,'Kisumu','kisumu'),(43,'Homa Bay','homa-bay'),(44,'Migori','migori'),(45,'Kisii','kisii'),
  (46,'Nyamira','nyamira'),(47,'Nairobi','nairobi');

create table public.towns (
  id bigint generated always as identity primary key,
  county_id smallint not null references public.counties(id),
  name text not null,
  slug text not null,
  location extensions.geography(point, 4326),
  unique (county_id, slug)
);
create index towns_name_trgm on public.towns using gin (name extensions.gin_trgm_ops);
create index towns_location on public.towns using gist (location);

-- ---------------------------------------------------------------------------------------------
-- Profiles (one per account), created automatically when someone signs up
-- ---------------------------------------------------------------------------------------------
create table public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  full_name text check (full_name is null or char_length(full_name) between 2 and 120),
  display_name text check (display_name is null or char_length(display_name) between 2 and 60),
  phone text check (phone is null or phone ~ '^\+254[17][0-9]{8}$'),
  phone_verified_at timestamptz,
  county_id smallint references public.counties(id),
  town text check (town is null or char_length(town) <= 80),
  avatar_path text,
  status text not null default 'active' check (status in ('active', 'suspended', 'deletion_requested', 'deleted')),
  status_reason text,
  deletion_requested_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.user_roles (
  user_id uuid not null references auth.users(id) on delete cascade,
  role text not null references public.roles(key),
  granted_by uuid references auth.users(id),
  granted_at timestamptz not null default now(),
  primary key (user_id, role)
);

create table public.consents (
  id bigint generated always as identity primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  kind text not null check (kind in ('terms', 'privacy', 'marketing_email', 'marketing_sms', 'marketing_whatsapp')),
  version text not null,
  granted boolean not null,
  recorded_at timestamptz not null default now(),
  source text not null default 'web'
);
create index consents_user on public.consents (user_id, kind, recorded_at desc);

create table public.notification_prefs (
  user_id uuid not null references auth.users(id) on delete cascade,
  topic text not null check (topic in ('account', 'billing', 'trial', 'content', 'enquiries', 'reviews', 'verification', 'news')),
  channel text not null check (channel in ('in_app', 'email', 'sms', 'whatsapp')),
  enabled boolean not null default true,
  primary key (user_id, topic, channel)
);

-- ---------------------------------------------------------------------------------------------
-- Helper functions used by policies (security definer so policies can read role tables)
-- ---------------------------------------------------------------------------------------------
create or replace function public.has_role(p_role text, p_user uuid default auth.uid())
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.user_roles ur join public.profiles p on p.id = ur.user_id
                 where ur.user_id = p_user and ur.role = p_role and p.status = 'active');
$$;

create or replace function public.has_permission(p_permission text, p_user uuid default auth.uid())
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.user_roles ur
                 join public.role_permissions rp on rp.role = ur.role
                 join public.profiles p on p.id = ur.user_id
                 where ur.user_id = p_user and rp.permission = p_permission and p.status = 'active');
$$;

create or replace function public.is_service() returns boolean language sql stable as $$
  select coalesce(auth.role(), '') = 'service_role' or current_user in ('postgres', 'supabase_admin');
$$;

-- ---------------------------------------------------------------------------------------------
-- Audit log: append only; written only through log_action() or by triggers
-- ---------------------------------------------------------------------------------------------
create table public.audit_log (
  id bigint generated always as identity primary key,
  at timestamptz not null default now(),
  actor uuid,
  actor_kind text not null default 'user' check (actor_kind in ('user', 'system', 'service')),
  action text not null,
  entity text not null,
  entity_id text,
  before jsonb,
  after jsonb,
  note text
);
create index audit_log_entity on public.audit_log (entity, entity_id, at desc);
create index audit_log_actor on public.audit_log (actor, at desc);

create or replace function public.log_action(p_action text, p_entity text, p_entity_id text, p_before jsonb, p_after jsonb, p_note text default null)
returns void language sql security definer set search_path = public as $$
  insert into public.audit_log (actor, actor_kind, action, entity, entity_id, before, after, note)
  values (auth.uid(), case when public.is_service() then 'service' when auth.uid() is null then 'system' else 'user' end,
          p_action, p_entity, p_entity_id, p_before, p_after, p_note);
$$;
revoke all on function public.log_action(text, text, text, jsonb, jsonb, text) from public, anon, authenticated;

-- ---------------------------------------------------------------------------------------------
-- New account: profile, general_user role, recorded consents, default notification preferences
-- ---------------------------------------------------------------------------------------------
create or replace function public.handle_new_user() returns trigger
language plpgsql security definer set search_path = public as $$
declare m jsonb := coalesce(new.raw_user_meta_data, '{}'::jsonb); v text := coalesce(m->>'terms_version', 'unrecorded');
begin
  insert into public.profiles (id, full_name, display_name)
  values (new.id, nullif(left(trim(m->>'full_name'), 120), ''), nullif(left(trim(coalesce(m->>'display_name', m->>'full_name')), 60), ''));
  insert into public.user_roles (user_id, role) values (new.id, 'general_user');
  if (m->>'accepted_terms')::boolean is true then
    insert into public.consents (user_id, kind, version, granted, source) values
      (new.id, 'terms', v, true, 'signup'), (new.id, 'privacy', v, true, 'signup');
  end if;
  insert into public.consents (user_id, kind, version, granted, source)
  values (new.id, 'marketing_email', v, coalesce((m->>'marketing_email')::boolean, false), 'signup');
  insert into public.notification_prefs (user_id, topic, channel, enabled)
  select new.id, t, c, case when t = 'news' then coalesce((m->>'marketing_email')::boolean, false) else true end
  from unnest(array['account','billing','trial','content','enquiries','reviews','verification','news']) t,
       unnest(array['in_app','email']) c;
  perform public.log_action('account.created', 'profile', new.id::text, null, null, null);
  return new;
end $$;

create trigger on_auth_user_created after insert on auth.users for each row execute function public.handle_new_user();

-- Users may edit their own profile, but never their own status or phone verification (guard defined below).

-- ---------------------------------------------------------------------------------------------
-- Actions: self-service roles, account deletion request, admin role and status changes (all logged)
-- ---------------------------------------------------------------------------------------------
create or replace function public.add_self_service_role(p_role text) returns void
language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null then raise exception 'sign in first'; end if;
  if not exists (select 1 from public.roles where key = p_role and self_service) then raise exception 'that role is not self service'; end if;
  if not exists (select 1 from public.profiles where id = auth.uid() and status = 'active') then raise exception 'account is not active'; end if;
  insert into public.user_roles (user_id, role) values (auth.uid(), p_role) on conflict do nothing;
  perform public.log_action('role.self_added', 'user_role', auth.uid()::text, null, jsonb_build_object('role', p_role));
end $$;

create or replace function public.request_account_deletion(p_reason text default null) returns void
language plpgsql security definer set search_path = public as $$
declare b jsonb;
begin
  if auth.uid() is null then raise exception 'sign in first'; end if;
  select to_jsonb(p) into b from public.profiles p where id = auth.uid();
  perform set_config('tnp.trusted', 'on', true);
  update public.profiles set status = 'deletion_requested', deletion_requested_at = now(), status_reason = left(p_reason, 500) where id = auth.uid();
  perform public.log_action('account.deletion_requested', 'profile', auth.uid()::text, b->'status', to_jsonb('deletion_requested'::text), left(p_reason, 500));
end $$;

create or replace function public.cancel_account_deletion() returns void
language plpgsql security definer set search_path = public as $$
begin
  perform set_config('tnp.trusted', 'on', true);
  update public.profiles set status = 'active', deletion_requested_at = null, status_reason = null where id = auth.uid() and status = 'deletion_requested';
  if found then perform public.log_action('account.deletion_cancelled', 'profile', auth.uid()::text, null, null); end if;
end $$;

create or replace function public.admin_set_role(p_user uuid, p_role text, p_grant boolean, p_note text default null) returns void
language plpgsql security definer set search_path = public as $$
declare r public.roles;
begin
  if not public.has_permission('users.manage_roles') then raise exception 'not allowed'; end if;
  select * into r from public.roles where key = p_role; if not found then raise exception 'unknown role'; end if;
  if r.is_staff and not public.has_role('administrator') then raise exception 'only an administrator can change staff roles'; end if;
  if p_role = 'general_user' then raise exception 'every account keeps the general user role'; end if;
  if p_role = 'administrator' and not p_grant and p_user = auth.uid() then raise exception 'you cannot remove your own administrator role'; end if;
  if p_grant then
    insert into public.user_roles (user_id, role, granted_by) values (p_user, p_role, auth.uid()) on conflict do nothing;
  else
    delete from public.user_roles where user_id = p_user and role = p_role;
  end if;
  perform public.log_action(case when p_grant then 'role.granted' else 'role.removed' end, 'user_role', p_user::text, null, jsonb_build_object('role', p_role), left(p_note, 500));
end $$;

create or replace function public.admin_set_status(p_user uuid, p_status text, p_note text) returns void
language plpgsql security definer set search_path = public as $$
declare b text;
begin
  if not public.has_permission('users.manage_status') then raise exception 'not allowed'; end if;
  if p_status not in ('active', 'suspended') then raise exception 'use active or suspended'; end if;
  if p_user = auth.uid() then raise exception 'you cannot change your own status'; end if;
  if coalesce(trim(p_note), '') = '' then raise exception 'a reason is required'; end if;
  select status into b from public.profiles where id = p_user; if not found then raise exception 'unknown user'; end if;
  perform set_config('tnp.trusted', 'on', true);
  update public.profiles set status = p_status, status_reason = left(p_note, 500), deletion_requested_at = case when p_status = 'active' then null else deletion_requested_at end where id = p_user;
  perform public.log_action('account.status_changed', 'profile', p_user::text, to_jsonb(b), to_jsonb(p_status), left(p_note, 500));
end $$;

-- Status changes are only allowed inside the trusted actions above, which set tnp.trusted for their own transaction.
-- (Browsers reach the database only through table operations and the granted functions, so they cannot set it.)
create or replace function public.guard_profile() returns trigger language plpgsql security definer set search_path = public as $$
begin
  new.updated_at := now();
  if public.is_service() then return new; end if;
  if new.id <> old.id then raise exception 'profile id cannot change'; end if;
  if new.phone_verified_at is distinct from old.phone_verified_at then raise exception 'phone verification is set by the system'; end if;
  if new.phone is distinct from old.phone then new.phone_verified_at := null; end if;
  if (new.status is distinct from old.status or new.status_reason is distinct from old.status_reason or new.deletion_requested_at is distinct from old.deletion_requested_at)
     and coalesce(current_setting('tnp.trusted', true), '') <> 'on' then
    raise exception 'account status changes go through the proper actions';
  end if;
  return new;
end $$;
create trigger guard_profile before update on public.profiles for each row execute function public.guard_profile();

-- admin view of users (only through this function, so emails are never exposed by table policies)
create or replace function public.admin_list_users(p_search text default null, p_limit int default 50, p_offset int default 0)
returns table (id uuid, email text, full_name text, display_name text, phone text, county text, status text, roles text[], created_at timestamptz, last_sign_in_at timestamptz)
language plpgsql stable security definer set search_path = public as $$
begin
  if not public.has_permission('users.view') then raise exception 'not allowed'; end if;
  return query
  select p.id, u.email::text, p.full_name, p.display_name, p.phone, c.name, p.status,
         coalesce(array_agg(ur.role order by ur.role) filter (where ur.role is not null), '{}'), p.created_at, u.last_sign_in_at
  from public.profiles p join auth.users u on u.id = p.id
  left join public.counties c on c.id = p.county_id
  left join public.user_roles ur on ur.user_id = p.id
  where p_search is null or p_search = '' or u.email ilike '%' || p_search || '%' or p.full_name ilike '%' || p_search || '%' or p.display_name ilike '%' || p_search || '%' or p.phone ilike '%' || p_search || '%'
  group by p.id, u.email, c.name, u.last_sign_in_at
  order by p.created_at desc
  limit least(greatest(p_limit, 1), 200) offset greatest(p_offset, 0);
end $$;

create or replace function public.admin_user_stats()
returns table (total bigint, active bigint, suspended bigint, deletion_requested bigint, new_last_7_days bigint, staff bigint)
language plpgsql stable security definer set search_path = public as $$
begin
  if not public.has_permission('users.view') then raise exception 'not allowed'; end if;
  return query select count(*), count(*) filter (where p.status = 'active'), count(*) filter (where p.status = 'suspended'),
    count(*) filter (where p.status = 'deletion_requested'), count(*) filter (where p.created_at > now() - interval '7 days'),
    (select count(distinct ur.user_id) from public.user_roles ur join public.roles r on r.key = ur.role where r.is_staff)
  from public.profiles p;
end $$;

-- ---------------------------------------------------------------------------------------------
-- Categories (business directory now; professional categories in Phase 2), managed by admins
-- ---------------------------------------------------------------------------------------------
create table public.categories (
  id bigint generated always as identity primary key,
  division text not null check (division in ('business', 'professional')),
  parent_id bigint references public.categories(id),
  slug text not null check (slug ~ '^[a-z0-9-]{2,60}$'),
  name text not null check (char_length(name) between 2 and 80),
  description text not null default '',
  active boolean not null default true,
  sort smallint not null default 100,
  unique (division, slug)
);

insert into public.categories (division, slug, name, sort) values
  ('business','healthcare','Healthcare',10),('business','education','Education',20),('business','hospitality','Hospitality',30),
  ('business','retail','Retail',40),('business','professional-services','Professional services',50),('business','construction','Construction',60),
  ('business','transport','Transport',70),('business','beauty-and-wellness','Beauty and wellness',80),('business','technology','Technology',90),
  ('business','entertainment','Entertainment',100),('business','real-estate','Real estate',110),('business','financial-services','Financial services',120),
  ('business','home-services','Home services',130);

-- ---------------------------------------------------------------------------------------------
-- Site settings (homepage sections, trial length and other configurable values)
-- ---------------------------------------------------------------------------------------------
create table public.site_settings (
  key text primary key check (key ~ '^[a-z_.]{3,80}$'),
  value jsonb not null,
  is_public boolean not null default false,
  updated_by uuid references auth.users(id),
  updated_at timestamptz not null default now()
);
insert into public.site_settings (key, value, is_public) values
  ('legal.terms_version', '"2026-11-16"', true),
  ('growth.trial_days', '14', true),
  ('growth.trials_open', 'false', true);

create or replace function public.admin_set_setting(p_key text, p_value jsonb) returns void
language plpgsql security definer set search_path = public as $$
declare b jsonb;
begin
  if not public.has_permission('settings.manage') then raise exception 'not allowed'; end if;
  select value into b from public.site_settings where key = p_key;
  if not found then raise exception 'unknown setting'; end if;
  update public.site_settings set value = p_value, updated_by = auth.uid(), updated_at = now() where key = p_key;
  perform public.log_action('setting.changed', 'site_setting', p_key, b, p_value);
end $$;

-- ---------------------------------------------------------------------------------------------
-- Row level security
-- ---------------------------------------------------------------------------------------------
alter table public.roles enable row level security;
alter table public.permissions enable row level security;
alter table public.role_permissions enable row level security;
alter table public.counties enable row level security;
alter table public.towns enable row level security;
alter table public.profiles enable row level security;
alter table public.user_roles enable row level security;
alter table public.consents enable row level security;
alter table public.notification_prefs enable row level security;
alter table public.audit_log enable row level security;
alter table public.categories enable row level security;
alter table public.site_settings enable row level security;

create policy "roles readable" on public.roles for select using (true);
create policy "permissions readable" on public.permissions for select using (true);
create policy "role permissions readable" on public.role_permissions for select using (true);
create policy "counties readable" on public.counties for select using (true);
create policy "towns readable" on public.towns for select using (true);
create policy "categories readable" on public.categories for select using (active or public.has_permission('categories.manage'));
create policy "categories managed" on public.categories for all using (public.has_permission('categories.manage')) with check (public.has_permission('categories.manage'));
create policy "public settings readable" on public.site_settings for select using (is_public or public.has_permission('settings.manage'));

-- profiles: own row, plus staff with users.view; display names of others come through public views later
create policy "own profile" on public.profiles for select using (id = auth.uid() or public.has_permission('users.view'));
create policy "edit own profile" on public.profiles for update using (id = auth.uid()) with check (id = auth.uid());

create policy "own roles" on public.user_roles for select using (user_id = auth.uid() or public.has_permission('users.view'));
create policy "own consents" on public.consents for select using (user_id = auth.uid() or public.has_permission('users.view'));
create policy "record own consent" on public.consents for insert with check (user_id = auth.uid() and source = 'web');
create policy "own notification prefs" on public.notification_prefs for select using (user_id = auth.uid());
create policy "change own notification prefs" on public.notification_prefs for update using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy "audit readable by auditors" on public.audit_log for select using (public.has_permission('audit.view'));

-- Grants: browsers read through RLS; writes to sensitive tables only through the functions above.
-- Supabase gives anon/authenticated full table rights by default, so take them away first and grant back only what is needed.
revoke all on all tables in schema public from anon, authenticated;
grant all on all tables in schema public to service_role;
grant usage on schema public to anon, authenticated;
grant select on public.roles, public.permissions, public.role_permissions, public.counties, public.towns, public.categories, public.site_settings to anon, authenticated;
grant select, update (full_name, display_name, phone, county_id, town, avatar_path) on public.profiles to authenticated;
grant select on public.user_roles, public.consents, public.notification_prefs, public.audit_log to authenticated;
grant insert (user_id, kind, version, granted, source) on public.consents to authenticated;
grant update (enabled) on public.notification_prefs to authenticated;
grant insert, update, delete on public.categories to authenticated;
revoke execute on all functions in schema public from public, anon;
grant execute on function public.has_role(text, uuid), public.has_permission(text, uuid) to anon, authenticated;
grant execute on all functions in schema public to service_role;
grant execute on function public.add_self_service_role(text), public.request_account_deletion(text), public.cancel_account_deletion(),
  public.admin_set_role(uuid, text, boolean, text), public.admin_set_status(uuid, text, text),
  public.admin_list_users(text, int, int), public.admin_user_stats(), public.admin_set_setting(text, jsonb) to authenticated;
