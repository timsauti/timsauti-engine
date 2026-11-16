-- =============================================================================================
-- TECH na PESA milestone 3: Digital Growth (social media management).
-- Applications with progressive onboarding, editable packages, the 14 day free trial with its rules,
-- content approvals with revision history, reports, in-app notifications, and an integration log for
-- the existing social media agent. Until that integration is configured every job is recorded as
-- 'awaiting_configuration' and staff work it manually. No payment is taken or recorded here.
-- =============================================================================================

-- ---------------------------------------------------------------------------------------------
-- In-app notifications (used by every service)
-- ---------------------------------------------------------------------------------------------
create table public.notifications (
  id bigint generated always as identity primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  topic text not null check (topic in ('account', 'billing', 'trial', 'content', 'enquiries', 'reviews', 'verification', 'news')),
  title text not null check (char_length(title) <= 140),
  body text check (body is null or char_length(body) <= 600),
  link text check (link is null or link ~ '^/'),
  created_at timestamptz not null default now(),
  read_at timestamptz
);
create index notifications_user on public.notifications (user_id, created_at desc);

create or replace function public.notify(p_user uuid, p_topic text, p_title text, p_body text default null, p_link text default null) returns void
language plpgsql security definer set search_path = public as $$
begin
  if p_user is null then return; end if;
  if exists (select 1 from public.notification_prefs where user_id = p_user and topic = p_topic and channel = 'in_app' and not enabled) and p_topic <> 'account' then return; end if;
  insert into public.notifications (user_id, topic, title, body, link) values (p_user, p_topic, left(p_title, 140), left(p_body, 600), p_link);
end $$;

create or replace function public.notifications_mark_read(p_id bigint default null) returns void
language sql security definer set search_path = public as $$
  update public.notifications set read_at = now() where user_id = auth.uid() and read_at is null and (p_id is null or id = p_id);
$$;

-- Business owners hear about new enquiries (directory, milestone 2).
create or replace function public.enquiry_notify() returns trigger language plpgsql security definer set search_path = public as $$
begin
  perform public.notify((select owner_id from public.businesses where id = new.business_id), 'enquiries',
    'New enquiry from ' || new.sender_name, left(new.message, 200), '/account/businesses/?id=' || new.business_id || '&tab=enquiries');
  return new;
end $$;
create trigger enquiry_notify after insert on public.enquiries for each row execute function public.enquiry_notify();

-- Listing owners hear about review decisions.
create or replace function public.business_status_notify() returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.status is distinct from old.status and new.status in ('published', 'rejected', 'suspended') then
    perform public.notify(new.owner_id, 'account',
      case new.status when 'published' then new.name || ' is live in the directory' when 'rejected' then new.name || ': changes requested' else new.name || ' has been suspended' end,
      new.status_reason, '/account/businesses/?id=' || new.id);
  end if;
  return new;
end $$;
create trigger business_status_notify after update of status on public.businesses for each row execute function public.business_status_notify();

-- Business Connect requesters hear when staff reply.
create or replace function public.service_request_notify() returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.response is distinct from old.response or new.status is distinct from old.status then
    perform public.notify(new.requester_id, 'account', 'Update on your Business Connect request', new.response, '/business-connect/#ask');
  end if;
  return new;
end $$;
create trigger service_request_notify after update on public.service_requests for each row execute function public.service_request_notify();

-- ---------------------------------------------------------------------------------------------
-- Packages (admin editable; the trial is a package row too)
-- ---------------------------------------------------------------------------------------------
create table public.growth_packages (
  key text primary key check (key ~ '^[a-z0-9_]{2,30}$'),
  name text not null check (char_length(name) between 2 and 40),
  is_trial boolean not null default false,
  price_kes integer not null default 0 check (price_kes >= 0),
  billing_period text not null default 'monthly' check (billing_period in ('monthly', 'quarterly', 'yearly', 'once')),
  posts_per_period smallint not null default 0 check (posts_per_period >= 0),
  graphics_per_period smallint not null default 0 check (graphics_per_period >= 0),
  platforms_count smallint not null default 1 check (platforms_count between 1 and 6),
  report_frequency text not null default 'monthly' check (report_frequency in ('end_of_trial', 'monthly', 'fortnightly', 'weekly')),
  revisions_per_item smallint not null default 1 check (revisions_per_item between 0 and 10),
  support_level text not null default '' check (char_length(support_level) <= 120),
  extras text not null default '' check (char_length(extras) <= 400),
  summary text not null default '' check (char_length(summary) <= 200),
  active boolean not null default true,
  sort smallint not null default 100,
  updated_at timestamptz not null default now()
);

-- Proposed starting values from the specification. Deliverables are deliberately modest; the owner adjusts them in the admin area.
insert into public.growth_packages (key, name, is_trial, price_kes, billing_period, posts_per_period, graphics_per_period, platforms_count, report_frequency, revisions_per_item, support_level, extras, summary, sort) values
  ('trial',    'Free trial', true,  0,     'once',    6,  6,  1, 'end_of_trial', 1, 'WhatsApp and email, working days', 'Presence check, content plan for 14 days, trial report and package recommendation', '14 days to see the work before you pay anything', 5),
  ('starter',  'Starter',  false, 2500,  'monthly', 8,  8,  1, 'monthly',     1, 'WhatsApp and email, working days', '', 'For a small business starting out on one platform', 10),
  ('growth',   'Growth',   false, 4500,  'monthly', 12, 12, 2, 'monthly',     2, 'WhatsApp and email, working days', 'Basic comment monitoring', 'Steady posting on two platforms', 20),
  ('business', 'Business', false, 7500,  'monthly', 20, 20, 3, 'fortnightly', 2, 'Priority WhatsApp support', 'Comment monitoring, monthly strategy check in', 'For businesses that sell actively online', 30),
  ('premium',  'Premium',  false, 12000, 'monthly', 30, 30, 4, 'weekly',      3, 'Priority support with a named contact', 'Comment monitoring, campaign planning, monthly strategy call', 'Full service across your main platforms', 40);

insert into public.site_settings (key, value, is_public) values
  ('growth.agreement_version', '"2026-11-16"', true),
  ('growth.trial_warning_days', '3', false)
on conflict (key) do nothing;

-- ---------------------------------------------------------------------------------------------
-- Clients (an application becomes a client once approved)
-- ---------------------------------------------------------------------------------------------
create table public.growth_clients (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users(id) on delete cascade,
  business_id uuid references public.businesses(id) on delete set null,
  business_name text not null check (char_length(business_name) between 2 and 120),
  category_id bigint references public.categories(id),
  county_id smallint references public.counties(id),
  town text check (town is null or char_length(town) <= 80),
  description text not null default '' check (char_length(description) <= 2000),
  products text not null default '' check (char_length(products) <= 1500),
  audience text not null default '' check (char_length(audience) <= 800),
  phone text check (phone is null or phone ~ '^\+254[17][0-9]{8}$'),
  whatsapp text check (whatsapp is null or whatsapp ~ '^\+254[17][0-9]{8}$'),
  email text check (email is null or email ~* '^[^@\s]+@[^@\s]+\.[^@\s]+$'),
  website text check (website is null or website ~* '^https?://[^\s]+$'),
  social jsonb not null default '{}'::jsonb,
  platforms text[] not null default '{}' check (platforms <@ array['facebook', 'instagram', 'tiktok', 'linkedin', 'x', 'youtube']),
  brand_colours text check (brand_colours is null or char_length(brand_colours) <= 120),
  objectives text not null default '' check (char_length(objectives) <= 1500),
  challenges text not null default '' check (char_length(challenges) <= 1500),
  promotions text not null default '' check (char_length(promotions) <= 1500),
  package_key text references public.growth_packages(key),
  status text not null default 'draft' check (status in ('draft', 'applied', 'info_requested', 'approved', 'rejected', 'withdrawn',
    'trial_active', 'trial_paused', 'trial_ended', 'subscribed', 'terminated')),
  status_reason text,
  agreement_version text,
  agreed_at timestamptz,
  applied_at timestamptz,
  decided_at timestamptz,
  trial_started_at timestamptz,
  trial_ends_at timestamptz,
  trial_paused_at timestamptz,
  trial_warned_at timestamptz,
  repeat_trial_allowed boolean not null default false,
  agent_status text not null default 'not_configured' check (agent_status in ('not_configured', 'awaiting_configuration', 'queued', 'sent', 'acknowledged', 'failed')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index growth_clients_owner on public.growth_clients (owner_id);
create index growth_clients_status on public.growth_clients (status, applied_at);

-- What the client sees on their timeline. Staff detail goes to the audit log.
create table public.growth_activity (
  id bigint generated always as identity primary key,
  client_id uuid not null references public.growth_clients(id) on delete cascade,
  at timestamptz not null default now(),
  kind text not null,
  message text not null check (char_length(message) <= 600)
);
create index growth_activity_client on public.growth_activity (client_id, at desc);

create table public.content_items (
  id bigint generated always as identity primary key,
  client_id uuid not null references public.growth_clients(id) on delete cascade,
  platform text not null check (platform in ('facebook', 'instagram', 'tiktok', 'linkedin', 'x', 'youtube')),
  title text check (title is null or char_length(title) <= 120),
  caption text not null default '' check (char_length(caption) <= 5000),
  media_paths text[] not null default '{}',
  scheduled_for timestamptz,
  status text not null default 'draft' check (status in ('draft', 'awaiting_approval', 'revision_requested', 'approved', 'rejected', 'scheduled', 'published', 'cancelled')),
  revision smallint not null default 1,
  source text not null default 'staff' check (source in ('staff', 'agent')),
  published_url text check (published_url is null or published_url ~* '^https://'),
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index content_items_client on public.content_items (client_id, status, scheduled_for);

create table public.content_feedback (
  id bigint generated always as identity primary key,
  item_id bigint not null references public.content_items(id) on delete cascade,
  revision smallint not null,
  by_user uuid references auth.users(id) on delete set null,
  by_staff boolean not null default false,
  decision text not null check (decision in ('approve', 'revise', 'reject', 'staff_note', 'resubmitted')),
  comment text check (comment is null or char_length(comment) <= 1500),
  at timestamptz not null default now()
);
create index content_feedback_item on public.content_feedback (item_id, at);

create table public.growth_reports (
  id bigint generated always as identity primary key,
  client_id uuid not null references public.growth_clients(id) on delete cascade,
  title text not null check (char_length(title) between 3 and 120),
  period_start date not null,
  period_end date not null check (period_end >= period_start),
  summary text not null default '' check (char_length(summary) <= 4000),
  metrics jsonb not null default '{}'::jsonb,
  recommendations text not null default '' check (char_length(recommendations) <= 3000),
  published_at timestamptz,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now()
);
create index growth_reports_client on public.growth_reports (client_id, period_end desc);

-- Integration log for the existing social media agent: every request, response, error and status change.
create table public.agent_jobs (
  id bigint generated always as identity primary key,
  client_id uuid references public.growth_clients(id) on delete set null,
  kind text not null check (kind in ('onboard_client', 'pause_client', 'resume_client', 'end_client', 'content_request', 'publish_approved')),
  payload jsonb not null default '{}'::jsonb,
  status text not null default 'awaiting_configuration' check (status in ('awaiting_configuration', 'queued', 'sent', 'acknowledged', 'failed', 'done_manually', 'cancelled')),
  response jsonb,
  error text,
  attempts smallint not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index agent_jobs_status on public.agent_jobs (status, created_at);

insert into public.site_settings (key, value, is_public) values ('growth.agent_integration', '"not_configured"', false) on conflict (key) do nothing;

-- ---------------------------------------------------------------------------------------------
-- Helpers
-- ---------------------------------------------------------------------------------------------
create or replace function public.can_see_growth(p_client uuid, p_user uuid default auth.uid())
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.growth_clients c where c.id = p_client and (c.owner_id = p_user or public.has_permission('growth.manage', p_user)));
$$;

create or replace function public.growth_log(p_client uuid, p_kind text, p_message text) returns void
language sql security definer set search_path = public as $$
  insert into public.growth_activity (client_id, kind, message) values (p_client, p_kind, left(p_message, 600));
$$;

-- Records a job for the agent. While the integration is not configured it waits for staff to work it manually.
create or replace function public.agent_enqueue(p_client uuid, p_kind text, p_payload jsonb) returns bigint
language plpgsql security definer set search_path = public as $$
declare v bigint; mode text := coalesce((select value #>> '{}' from public.site_settings where key = 'growth.agent_integration'), 'not_configured');
begin
  insert into public.agent_jobs (client_id, kind, payload, status)
  values (p_client, p_kind, p_payload, case when mode = 'github_dispatch' then 'queued' else 'awaiting_configuration' end) returning id into v;
  update public.growth_clients set agent_status = case when mode = 'github_dispatch' then 'queued' else 'awaiting_configuration' end where id = p_client;
  return v;
end $$;

create or replace function public.growth_brief(p_client uuid) returns jsonb
language sql stable security definer set search_path = public as $$
  select jsonb_build_object('client_id', c.id, 'business_name', c.business_name, 'category', cat.name, 'county', co.name, 'town', c.town,
    'description', c.description, 'products', c.products, 'audience', c.audience, 'objectives', c.objectives, 'challenges', c.challenges,
    'promotions', c.promotions, 'brand_colours', c.brand_colours, 'platforms', c.platforms, 'social', c.social, 'website', c.website,
    'package', c.package_key, 'trial_ends_at', c.trial_ends_at)
  from public.growth_clients c left join public.categories cat on cat.id = c.category_id left join public.counties co on co.id = c.county_id
  where c.id = p_client;
$$;

-- Storage paths: '<client id>/brand/<file>' (client or staff) and '<client id>/content/<file>' (staff only).
create or replace function public.can_write_growth_path(p_path text)
returns boolean language plpgsql stable security definer set search_path = public as $$
declare cid uuid; area text;
begin
  if p_path !~ '^[0-9a-f-]{36}/(brand|content)/[A-Za-z0-9._-]{1,80}$' then return false; end if;
  cid := split_part(p_path, '/', 1)::uuid; area := split_part(p_path, '/', 2);
  if public.has_permission('growth.manage') then return exists (select 1 from public.growth_clients where id = cid); end if;
  return area = 'brand' and exists (select 1 from public.growth_clients where id = cid and owner_id = auth.uid()
    and status not in ('rejected', 'withdrawn', 'terminated'));
end $$;

create or replace function public.can_read_growth_path(p_path text)
returns boolean language plpgsql stable security definer set search_path = public as $$
begin
  if p_path !~ '^[0-9a-f-]{36}/' then return false; end if;
  return public.can_see_growth(split_part(p_path, '/', 1)::uuid);
end $$;

-- ---------------------------------------------------------------------------------------------
-- Client actions
-- ---------------------------------------------------------------------------------------------
create or replace function public.growth_save(p_id uuid, p jsonb) returns uuid
language plpgsql security definer set search_path = public as $$
declare c public.growth_clients; v uuid := p_id; k text; u text; v_social jsonb := '{}'::jsonb; v_platforms text[];
begin
  if auth.uid() is null then raise exception 'sign in first'; end if;
  if not exists (select 1 from public.profiles where id = auth.uid() and status = 'active') then raise exception 'account is not active'; end if;
  if char_length(trim(coalesce(p->>'business_name', ''))) < 2 then raise exception 'enter the business name'; end if;
  for k in select unnest(array['facebook', 'instagram', 'tiktok', 'x', 'linkedin', 'youtube']) loop
    u := nullif(trim(coalesce(p->'social'->>k, '')), '');
    if u is not null then
      if u !~* '^https://[^\s]+$' then raise exception 'social links must start with https://'; end if;
      v_social := v_social || jsonb_build_object(k, left(u, 200));
    end if;
  end loop;
  select coalesce(array_agg(x), '{}') into v_platforms from jsonb_array_elements_text(coalesce(p->'platforms', '[]'::jsonb)) x
    where x in ('facebook', 'instagram', 'tiktok', 'linkedin', 'x', 'youtube');
  if nullif(p->>'business_id', '') is not null and not exists (select 1 from public.businesses where id = (p->>'business_id')::uuid and owner_id = auth.uid()) then
    raise exception 'that listing is not yours'; end if;
  if nullif(p->>'package_key', '') is not null and not exists (select 1 from public.growth_packages where key = p->>'package_key' and active and not is_trial) then
    raise exception 'choose an available package'; end if;

  if v is null then
    if exists (select 1 from public.growth_clients where owner_id = auth.uid() and status in ('draft', 'applied', 'info_requested', 'approved', 'trial_active', 'trial_paused')) then
      raise exception 'you already have an open Digital Growth application; continue that one'; end if;
    insert into public.growth_clients (owner_id, business_name) values (auth.uid(), trim(p->>'business_name')) returning id into v;
  else
    select * into c from public.growth_clients where id = v;
    if not found or c.owner_id <> auth.uid() then raise exception 'not allowed'; end if;
    if c.status in ('rejected', 'withdrawn', 'terminated') then raise exception 'this application is closed'; end if;
  end if;
  update public.growth_clients set
    business_name = trim(p->>'business_name'), business_id = nullif(p->>'business_id', '')::uuid,
    category_id = nullif(p->>'category_id', '')::bigint, county_id = nullif(p->>'county_id', '')::smallint,
    town = nullif(left(trim(coalesce(p->>'town', '')), 80), ''),
    description = left(trim(coalesce(p->>'description', '')), 2000), products = left(trim(coalesce(p->>'products', '')), 1500),
    audience = left(trim(coalesce(p->>'audience', '')), 800),
    phone = public.clean_phone(p->>'phone'), whatsapp = public.clean_phone(p->>'whatsapp'),
    email = nullif(lower(trim(coalesce(p->>'email', ''))), ''), website = nullif(trim(coalesce(p->>'website', '')), ''),
    social = v_social, platforms = v_platforms, brand_colours = nullif(left(trim(coalesce(p->>'brand_colours', '')), 120), ''),
    objectives = left(trim(coalesce(p->>'objectives', '')), 1500), challenges = left(trim(coalesce(p->>'challenges', '')), 1500),
    promotions = left(trim(coalesce(p->>'promotions', '')), 1500), package_key = nullif(p->>'package_key', ''), updated_at = now()
  where id = v;
  if p_id is not null then perform public.growth_log(v, 'details', 'Business details updated'); end if;
  return v;
end $$;

create or replace function public.growth_submit(p_id uuid, p_agreement text) returns void
language plpgsql security definer set search_path = public as $$
declare c public.growth_clients; cur text := (select value #>> '{}' from public.site_settings where key = 'growth.agreement_version');
begin
  select * into c from public.growth_clients where id = p_id;
  if not found or c.owner_id <> auth.uid() then raise exception 'not allowed'; end if;
  if c.status not in ('draft', 'info_requested') then raise exception 'this application is already %', replace(c.status, '_', ' '); end if;
  if c.status = 'draft' and coalesce((select value::boolean from public.site_settings where key = 'growth.trials_open'), false) is not true then
    raise exception 'Digital Growth trials are not open yet. Your details are saved; we will tell you when they open'; end if;
  if p_agreement is distinct from cur then raise exception 'please read and accept the current service agreement'; end if;
  if c.category_id is null or c.county_id is null then raise exception 'choose a category and a county'; end if;
  if char_length(c.description) < 40 then raise exception 'describe the business in at least 40 characters'; end if;
  if char_length(c.objectives) < 10 then raise exception 'tell us what you want social media to do for the business'; end if;
  if c.phone is null and c.whatsapp is null then raise exception 'add a phone or WhatsApp number'; end if;
  if cardinality(c.platforms) = 0 then raise exception 'choose at least one platform'; end if;
  update public.growth_clients set status = 'applied', applied_at = now(), agreement_version = p_agreement, agreed_at = now(), status_reason = null, updated_at = now() where id = p_id;
  insert into public.consents (user_id, kind, version, granted, source) values (auth.uid(), 'terms', 'growth-' || p_agreement, true, 'web');
  perform public.growth_log(p_id, 'applied', 'Application sent. Our team reviews it, usually within two working days.');
  perform public.log_action('growth.applied', 'growth_client', p_id::text, to_jsonb(c.status), to_jsonb('applied'::text));
end $$;

create or replace function public.growth_withdraw(p_id uuid) returns void
language plpgsql security definer set search_path = public as $$
declare c public.growth_clients;
begin
  select * into c from public.growth_clients where id = p_id;
  if not found or c.owner_id <> auth.uid() then raise exception 'not allowed'; end if;
  if c.status not in ('draft', 'applied', 'info_requested', 'approved') then raise exception 'this can no longer be withdrawn here; contact support'; end if;
  update public.growth_clients set status = 'withdrawn', updated_at = now() where id = p_id;
  perform public.growth_log(p_id, 'withdrawn', 'Application withdrawn.');
  perform public.log_action('growth.withdrawn', 'growth_client', p_id::text, to_jsonb(c.status), to_jsonb('withdrawn'::text));
end $$;

-- The client chooses a package. This records the choice only; nothing is charged until payment is confirmed by the provider.
create or replace function public.growth_choose_package(p_id uuid, p_package text) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not exists (select 1 from public.growth_clients where id = p_id and owner_id = auth.uid()) then raise exception 'not allowed'; end if;
  if not exists (select 1 from public.growth_packages where key = p_package and active and not is_trial) then raise exception 'choose an available package'; end if;
  update public.growth_clients set package_key = p_package, updated_at = now() where id = p_id;
  perform public.growth_log(p_id, 'package', 'Package chosen: ' || (select name from public.growth_packages where key = p_package) || '. Payment is arranged before it starts.');
  perform public.log_action('growth.package_chosen', 'growth_client', p_id::text, null, to_jsonb(p_package));
end $$;

create or replace function public.content_decide(p_item bigint, p_decision text, p_comment text default null) returns void
language plpgsql security definer set search_path = public as $$
declare i public.content_items; c public.growth_clients;
begin
  select * into i from public.content_items where id = p_item;
  if not found then raise exception 'not found'; end if;
  select * into c from public.growth_clients where id = i.client_id;
  if c.owner_id <> auth.uid() then raise exception 'not allowed'; end if;
  if i.status <> 'awaiting_approval' then raise exception 'this post is not waiting for your approval'; end if;
  if p_decision not in ('approve', 'revise', 'reject') then raise exception 'use approve, revise or reject'; end if;
  if p_decision <> 'approve' and char_length(trim(coalesce(p_comment, ''))) < 3 then raise exception 'tell us what to change'; end if;
  if p_decision = 'revise' and i.revision > coalesce((select revisions_per_item from public.growth_packages where key = coalesce(c.package_key, 'trial')), 1) then
    raise exception 'this post has used its revisions; approve it, reject it, or contact us'; end if;
  insert into public.content_feedback (item_id, revision, by_user, decision, comment) values (p_item, i.revision, auth.uid(), p_decision, nullif(trim(coalesce(p_comment, '')), ''));
  update public.content_items set status = case p_decision when 'approve' then 'approved' when 'revise' then 'revision_requested' else 'rejected' end, updated_at = now() where id = p_item;
  perform public.growth_log(c.id, 'content', case p_decision when 'approve' then 'You approved' when 'revise' then 'You asked for changes to' else 'You rejected' end || ' a ' || i.platform || ' post' || coalesce(': ' || i.title, ''));
  if p_decision = 'approve' then perform public.agent_enqueue(c.id, 'publish_approved', jsonb_build_object('content_item', p_item, 'platform', i.platform, 'scheduled_for', i.scheduled_for)); end if;
end $$;

-- ---------------------------------------------------------------------------------------------
-- Staff actions (growth.manage)
-- ---------------------------------------------------------------------------------------------
create or replace function public.admin_growth_decide(p_id uuid, p_decision text, p_note text default null) returns void
language plpgsql security definer set search_path = public as $$
declare c public.growth_clients;
begin
  if not public.has_permission('growth.manage') then raise exception 'not allowed'; end if;
  select * into c from public.growth_clients where id = p_id; if not found then raise exception 'unknown client'; end if;
  if c.status <> 'applied' then raise exception 'only a submitted application can be decided'; end if;
  if p_decision not in ('approve', 'reject', 'request_info') then raise exception 'use approve, reject or request_info'; end if;
  if p_decision <> 'approve' and coalesce(trim(p_note), '') = '' then raise exception 'a reason is required; the applicant will see it'; end if;
  update public.growth_clients set status = case p_decision when 'approve' then 'approved' when 'reject' then 'rejected' when 'request_info' then 'info_requested' else null end,
    status_reason = nullif(left(trim(coalesce(p_note, '')), 500), ''), decided_at = now(), updated_at = now() where id = p_id;
  perform public.growth_log(p_id, p_decision, case p_decision when 'approve' then 'Application approved. We will contact you to agree the start date of your free trial.'
    when 'reject' then 'Application not accepted: ' || p_note else 'We need a little more information: ' || p_note end);
  perform public.notify(c.owner_id, 'trial', case p_decision when 'approve' then 'Your Digital Growth application is approved' when 'reject' then 'About your Digital Growth application' else 'We need more information for Digital Growth' end, p_note, '/account/growth/');
  perform public.log_action('growth.' || p_decision, 'growth_client', p_id::text, to_jsonb(c.status), null, p_note);
end $$;

-- Starts the 14 day trial from an explicit activation date, refusing uncontrolled repeat trials.
create or replace function public.admin_growth_start_trial(p_id uuid, p_start timestamptz default null) returns void
language plpgsql security definer set search_path = public as $$
declare c public.growth_clients; days int := coalesce((select value::int from public.site_settings where key = 'growth.trial_days'), 14); s timestamptz := coalesce(p_start, now());
begin
  if not public.has_permission('growth.manage') then raise exception 'not allowed'; end if;
  select * into c from public.growth_clients where id = p_id; if not found then raise exception 'unknown client'; end if;
  if c.status <> 'approved' then raise exception 'approve the application before starting a trial'; end if;
  if c.agreed_at is null then raise exception 'the client has not accepted the service agreement'; end if;
  if s < now() - interval '2 days' or s > now() + interval '60 days' then raise exception 'choose a start date between yesterday and 60 days from now'; end if;
  if not c.repeat_trial_allowed and exists (
      select 1 from public.growth_clients o where o.id <> c.id and o.trial_started_at is not null
        and (o.owner_id = c.owner_id or (c.phone is not null and c.phone in (o.phone, o.whatsapp)) or (c.whatsapp is not null and c.whatsapp in (o.phone, o.whatsapp))
             or (lower(o.business_name) = lower(c.business_name) and o.county_id is not distinct from c.county_id))) then
    raise exception 'this business or phone number has had a trial before; allow a repeat trial first if that is intended';
  end if;
  update public.growth_clients set status = 'trial_active', trial_started_at = s, trial_ends_at = s + make_interval(days => days), trial_warned_at = null, updated_at = now() where id = p_id;
  perform public.agent_enqueue(p_id, 'onboard_client', public.growth_brief(p_id));
  perform public.growth_log(p_id, 'trial', 'Free trial starts ' || to_char(s at time zone 'Africa/Nairobi', 'DD Mon YYYY') || ' and ends ' || to_char((s + make_interval(days => days)) at time zone 'Africa/Nairobi', 'DD Mon YYYY') || '. You will not be charged when it ends.');
  perform public.notify(c.owner_id, 'trial', 'Your ' || days || ' day free trial has started', 'It ends on ' || to_char((s + make_interval(days => days)) at time zone 'Africa/Nairobi', 'DD Mon YYYY') || '. Nothing is charged when it ends.', '/account/growth/');
  perform public.log_action('growth.trial_started', 'growth_client', p_id::text, to_jsonb(c.status), to_jsonb(s));
end $$;

create or replace function public.admin_growth_allow_repeat(p_id uuid, p_note text) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not public.has_permission('growth.manage') then raise exception 'not allowed'; end if;
  if coalesce(trim(p_note), '') = '' then raise exception 'a reason is required'; end if;
  update public.growth_clients set repeat_trial_allowed = true where id = p_id;
  perform public.log_action('growth.repeat_trial_allowed', 'growth_client', p_id::text, null, null, p_note);
end $$;

create or replace function public.admin_growth_trial(p_id uuid, p_action text, p_days int default 0, p_note text default null) returns void
language plpgsql security definer set search_path = public as $$
declare c public.growth_clients; left_time interval;
begin
  if not public.has_permission('growth.manage') then raise exception 'not allowed'; end if;
  select * into c from public.growth_clients where id = p_id; if not found then raise exception 'unknown client'; end if;
  if coalesce(trim(p_note), '') = '' then raise exception 'a reason is required for the record'; end if;
  if p_action = 'pause' then
    if c.status <> 'trial_active' then raise exception 'only an active trial can be paused'; end if;
    update public.growth_clients set status = 'trial_paused', trial_paused_at = now() where id = p_id;
    perform public.agent_enqueue(p_id, 'pause_client', jsonb_build_object('client_id', p_id));
    perform public.growth_log(p_id, 'trial', 'Trial paused: ' || p_note);
  elsif p_action = 'resume' then
    if c.status <> 'trial_paused' then raise exception 'only a paused trial can be resumed'; end if;
    left_time := greatest(c.trial_ends_at - c.trial_paused_at, interval '0');
    update public.growth_clients set status = 'trial_active', trial_ends_at = now() + left_time, trial_paused_at = null, trial_warned_at = null where id = p_id;
    perform public.agent_enqueue(p_id, 'resume_client', jsonb_build_object('client_id', p_id));
    perform public.growth_log(p_id, 'trial', 'Trial resumed. It now ends ' || to_char((now() + left_time) at time zone 'Africa/Nairobi', 'DD Mon YYYY') || '.');
  elsif p_action = 'extend' then
    if c.status not in ('trial_active', 'trial_paused', 'trial_ended') or p_days not between 1 and 30 then raise exception 'extend an active, paused or ended trial by 1 to 30 days'; end if;
    update public.growth_clients set trial_ends_at = greatest(trial_ends_at, case when c.status = 'trial_ended' then now() else trial_ends_at end) + make_interval(days => p_days),
      status = case when c.status = 'trial_ended' then 'trial_active' else c.status end, trial_warned_at = null where id = p_id;
    perform public.growth_log(p_id, 'trial', 'Trial extended by ' || p_days || ' days.');
    perform public.notify(c.owner_id, 'trial', 'Your free trial has been extended by ' || p_days || ' days', p_note, '/account/growth/');
  elsif p_action = 'terminate' then
    if c.status not in ('trial_active', 'trial_paused', 'approved') then raise exception 'only an approved or running trial can be ended early'; end if;
    update public.growth_clients set status = 'terminated', status_reason = left(p_note, 500), trial_ends_at = least(coalesce(trial_ends_at, now()), now()) where id = p_id;
    perform public.agent_enqueue(p_id, 'end_client', jsonb_build_object('client_id', p_id, 'reason', 'terminated'));
    perform public.growth_log(p_id, 'trial', 'Trial ended early: ' || p_note);
    perform public.notify(c.owner_id, 'trial', 'Your Digital Growth trial has ended', p_note, '/account/growth/');
  else
    raise exception 'use pause, resume, extend or terminate';
  end if;
  perform public.log_action('growth.trial_' || p_action, 'growth_client', p_id::text, to_jsonb(c.status), to_jsonb(p_days), p_note);
end $$;

-- Runs nightly (engine backup job): ends trials whose time is up and warns clients a few days before.
create or replace function public.growth_daily() returns jsonb
language plpgsql security definer set search_path = public as $$
declare r record; ended int := 0; warned int := 0; w int := coalesce((select value::int from public.site_settings where key = 'growth.trial_warning_days'), 3);
begin
  if not (public.is_service() or public.has_permission('growth.manage')) then raise exception 'not allowed'; end if;
  for r in select * from public.growth_clients where status = 'trial_active' and trial_ends_at <= now() loop
    update public.growth_clients set status = 'trial_ended', updated_at = now() where id = r.id;
    perform public.agent_enqueue(r.id, 'end_client', jsonb_build_object('client_id', r.id, 'reason', 'trial_ended'));
    perform public.growth_log(r.id, 'trial', 'Free trial finished. Your trial report and our package recommendation will appear here. Nothing has been charged.');
    perform public.notify(r.owner_id, 'trial', 'Your free trial has finished', 'Nothing has been charged. Choose a package if you want us to continue.', '/account/growth/');
    perform public.log_action('growth.trial_ended', 'growth_client', r.id::text, to_jsonb('trial_active'::text), to_jsonb('trial_ended'::text));
    ended := ended + 1;
  end loop;
  for r in select * from public.growth_clients where status = 'trial_active' and trial_warned_at is null and trial_ends_at <= now() + make_interval(days => w) loop
    update public.growth_clients set trial_warned_at = now() where id = r.id;
    perform public.notify(r.owner_id, 'trial', 'Your free trial ends on ' || to_char(r.trial_ends_at at time zone 'Africa/Nairobi', 'DD Mon'),
      'Nothing is charged automatically. Choose a package if you want us to continue.', '/account/growth/');
    warned := warned + 1;
  end loop;
  return jsonb_build_object('ended', ended, 'warned', warned);
end $$;

create or replace function public.admin_content_save(p_client uuid, p_id bigint, p jsonb) returns bigint
language plpgsql security definer set search_path = public as $$
declare v bigint := p_id; i public.content_items; paths text[];
begin
  if not public.has_permission('growth.manage') then raise exception 'not allowed'; end if;
  if not exists (select 1 from public.growth_clients where id = p_client and status in ('trial_active', 'trial_paused', 'subscribed', 'approved')) then
    raise exception 'content can be prepared only for approved, trial or subscribed clients'; end if;
  select coalesce(array_agg(x), '{}') into paths from jsonb_array_elements_text(coalesce(p->'media_paths', '[]'::jsonb)) x where x like p_client::text || '/content/%';
  if v is null then
    insert into public.content_items (client_id, platform, title, caption, media_paths, scheduled_for, created_by)
    values (p_client, p->>'platform', nullif(trim(coalesce(p->>'title', '')), ''), coalesce(p->>'caption', ''), paths, nullif(p->>'scheduled_for', '')::timestamptz, auth.uid())
    returning id into v;
  else
    select * into i from public.content_items where id = v and client_id = p_client; if not found then raise exception 'not found'; end if;
    if i.status in ('approved', 'scheduled', 'published') then raise exception 'approved or published posts cannot be edited; create a new one'; end if;
    update public.content_items set platform = p->>'platform', title = nullif(trim(coalesce(p->>'title', '')), ''), caption = coalesce(p->>'caption', ''),
      media_paths = paths, scheduled_for = nullif(p->>'scheduled_for', '')::timestamptz, updated_at = now() where id = v;
  end if;
  return v;
end $$;

-- Sends a draft (or a revised post) to the client for approval.
create or replace function public.admin_content_send(p_item bigint, p_note text default null) returns void
language plpgsql security definer set search_path = public as $$
declare i public.content_items; c public.growth_clients;
begin
  if not public.has_permission('growth.manage') then raise exception 'not allowed'; end if;
  select * into i from public.content_items where id = p_item; if not found then raise exception 'not found'; end if;
  if i.status not in ('draft', 'revision_requested') then raise exception 'only a draft or a post with requested changes can be sent'; end if;
  if char_length(trim(i.caption)) = 0 and cardinality(i.media_paths) = 0 then raise exception 'add a caption or a graphic first'; end if;
  select * into c from public.growth_clients where id = i.client_id;
  update public.content_items set status = 'awaiting_approval', revision = case when i.status = 'revision_requested' then i.revision + 1 else i.revision end, updated_at = now() where id = p_item;
  if i.status = 'revision_requested' then
    insert into public.content_feedback (item_id, revision, by_user, by_staff, decision, comment) values (p_item, i.revision + 1, auth.uid(), true, 'resubmitted', nullif(trim(coalesce(p_note, '')), ''));
  end if;
  perform public.growth_log(c.id, 'content', 'A ' || i.platform || ' post is waiting for your approval' || coalesce(': ' || i.title, ''));
  perform public.notify(c.owner_id, 'content', 'A post is waiting for your approval', i.title, '/account/growth/?tab=approvals');
end $$;

create or replace function public.admin_content_mark(p_item bigint, p_status text, p_url text default null) returns void
language plpgsql security definer set search_path = public as $$
declare i public.content_items;
begin
  if not public.has_permission('growth.manage') then raise exception 'not allowed'; end if;
  select * into i from public.content_items where id = p_item; if not found then raise exception 'not found'; end if;
  if p_status in ('scheduled', 'published') and i.status not in ('approved', 'scheduled') then raise exception 'only approved posts can be scheduled or marked published'; end if;
  if p_status = 'cancelled' and i.status = 'published' then raise exception 'a published post cannot be cancelled'; end if;
  if p_status not in ('scheduled', 'published', 'cancelled') then raise exception 'use scheduled, published or cancelled'; end if;
  update public.content_items set status = p_status, published_url = coalesce(nullif(trim(coalesce(p_url, '')), ''), published_url), updated_at = now() where id = p_item;
  perform public.growth_log(i.client_id, 'content', 'A ' || i.platform || ' post was ' || p_status || coalesce(': ' || i.title, ''));
end $$;

create or replace function public.admin_report_save(p_client uuid, p_id bigint, p jsonb, p_publish boolean) returns bigint
language plpgsql security definer set search_path = public as $$
declare v bigint := p_id;
begin
  if not public.has_permission('growth.manage') then raise exception 'not allowed'; end if;
  if v is null then
    insert into public.growth_reports (client_id, title, period_start, period_end, created_by) values (p_client, trim(p->>'title'), (p->>'period_start')::date, (p->>'period_end')::date, auth.uid()) returning id into v;
  end if;
  update public.growth_reports set title = trim(p->>'title'), period_start = (p->>'period_start')::date, period_end = (p->>'period_end')::date,
    summary = coalesce(p->>'summary', ''), metrics = coalesce(p->'metrics', '{}'::jsonb), recommendations = coalesce(p->>'recommendations', ''),
    published_at = case when p_publish then coalesce(published_at, now()) else published_at end
  where id = v and client_id = p_client;
  if not found then raise exception 'not found'; end if;
  if p_publish then
    perform public.growth_log(p_client, 'report', 'New report: ' || trim(p->>'title'));
    perform public.notify((select owner_id from public.growth_clients where id = p_client), 'content', 'New report: ' || trim(p->>'title'), null, '/account/growth/?tab=reports');
  end if;
  return v;
end $$;

create or replace function public.admin_agent_job_update(p_job bigint, p_status text, p_note text default null) returns void
language plpgsql security definer set search_path = public as $$
declare j public.agent_jobs;
begin
  if not public.has_permission('growth.manage') then raise exception 'not allowed'; end if;
  if p_status not in ('done_manually', 'cancelled', 'awaiting_configuration') then raise exception 'use done_manually or cancelled'; end if;
  select * into j from public.agent_jobs where id = p_job; if not found then raise exception 'not found'; end if;
  update public.agent_jobs set status = p_status, error = coalesce(nullif(trim(coalesce(p_note, '')), ''), error), updated_at = now() where id = p_job;
  perform public.log_action('agent_job.' || p_status, 'agent_job', p_job::text, to_jsonb(j.status), to_jsonb(p_status), p_note);
end $$;

create or replace function public.admin_package_save(p_key text, p jsonb) returns void
language plpgsql security definer set search_path = public as $$
declare b public.growth_packages;
begin
  if not public.has_permission('growth.manage') then raise exception 'not allowed'; end if;
  select * into b from public.growth_packages where key = p_key;
  insert into public.growth_packages (key, name) values (p_key, coalesce(p->>'name', p_key)) on conflict (key) do nothing;
  update public.growth_packages set name = trim(p->>'name'), price_kes = (p->>'price_kes')::int, billing_period = coalesce(p->>'billing_period', billing_period),
    posts_per_period = (p->>'posts_per_period')::smallint, graphics_per_period = (p->>'graphics_per_period')::smallint, platforms_count = (p->>'platforms_count')::smallint,
    report_frequency = coalesce(p->>'report_frequency', report_frequency), revisions_per_item = (p->>'revisions_per_item')::smallint,
    support_level = coalesce(p->>'support_level', ''), extras = coalesce(p->>'extras', ''), summary = coalesce(p->>'summary', ''),
    active = coalesce((p->>'active')::boolean, active), sort = coalesce((p->>'sort')::smallint, sort), updated_at = now()
  where key = p_key;
  perform public.log_action('package.saved', 'growth_package', p_key, to_jsonb(b), (select to_jsonb(x) from public.growth_packages x where key = p_key));
end $$;

create or replace function public.admin_growth_stats()
returns table (applications bigint, approved_waiting bigint, active_trials bigint, ended_trials bigint, subscribed bigint, awaiting_approval bigint, agent_jobs_waiting bigint)
language plpgsql stable security definer set search_path = public as $$
begin
  if not public.has_permission('growth.manage') then raise exception 'not allowed'; end if;
  return query select
    (select count(*) from public.growth_clients where status = 'applied'), (select count(*) from public.growth_clients where status = 'approved'),
    (select count(*) from public.growth_clients where status in ('trial_active', 'trial_paused')), (select count(*) from public.growth_clients where status = 'trial_ended'),
    (select count(*) from public.growth_clients where status = 'subscribed'), (select count(*) from public.content_items where status = 'awaiting_approval'),
    (select count(*) from public.agent_jobs where status in ('awaiting_configuration', 'queued', 'failed'));
end $$;

-- Staff list with the applicant's email and a repeat trial warning.
create or replace function public.admin_list_growth(p_status text default null)
returns table (id uuid, business_name text, status text, applied_at timestamptz, trial_ends_at timestamptz, package_key text, owner_name text, owner_email text,
               phone text, whatsapp text, agent_status text, possible_repeat boolean, repeat_trial_allowed boolean)
language plpgsql stable security definer set search_path = public as $$
begin
  if not public.has_permission('growth.manage') then raise exception 'not allowed'; end if;
  return query select c.id, c.business_name, c.status, c.applied_at, c.trial_ends_at, c.package_key, p.full_name, u.email::text, c.phone, c.whatsapp, c.agent_status,
    exists (select 1 from public.growth_clients o where o.id <> c.id and o.trial_started_at is not null
      and (o.owner_id = c.owner_id or (c.phone is not null and c.phone in (o.phone, o.whatsapp)) or (c.whatsapp is not null and c.whatsapp in (o.phone, o.whatsapp))
           or (lower(o.business_name) = lower(c.business_name) and o.county_id is not distinct from c.county_id))),
    c.repeat_trial_allowed
  from public.growth_clients c join public.profiles p on p.id = c.owner_id join auth.users u on u.id = c.owner_id
  where (p_status is null and c.status <> 'draft') or c.status = p_status
  order by (c.status = 'applied') desc, c.applied_at desc nulls last limit 200;
end $$;

-- ---------------------------------------------------------------------------------------------
-- Storage: private bucket for brand assets and content graphics (images and short video, 20 MB)
-- ---------------------------------------------------------------------------------------------
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('growth-assets', 'growth-assets', false, 20971520, array['image/jpeg', 'image/png', 'image/webp', 'video/mp4', 'application/pdf'])
on conflict (id) do nothing;
create policy "growth assets readable" on storage.objects for select to authenticated using (bucket_id = 'growth-assets' and public.can_read_growth_path(name));
create policy "growth assets upload" on storage.objects for insert to authenticated with check (bucket_id = 'growth-assets' and public.can_write_growth_path(name));
create policy "growth assets replace" on storage.objects for update to authenticated using (bucket_id = 'growth-assets' and public.can_write_growth_path(name));
create policy "growth assets remove" on storage.objects for delete to authenticated using (bucket_id = 'growth-assets' and public.can_write_growth_path(name));

-- ---------------------------------------------------------------------------------------------
-- Row level security and grants
-- ---------------------------------------------------------------------------------------------
alter table public.notifications enable row level security;
alter table public.growth_packages enable row level security;
alter table public.growth_clients enable row level security;
alter table public.growth_activity enable row level security;
alter table public.content_items enable row level security;
alter table public.content_feedback enable row level security;
alter table public.growth_reports enable row level security;
alter table public.agent_jobs enable row level security;

create policy "own notifications" on public.notifications for select using (user_id = auth.uid());
create policy "packages readable" on public.growth_packages for select using (active or public.has_permission('growth.manage'));
create policy "own or staff growth clients" on public.growth_clients for select using (owner_id = auth.uid() or public.has_permission('growth.manage'));
create policy "growth activity" on public.growth_activity for select using (public.can_see_growth(client_id));
-- Clients see posts once they are sent to them; drafts stay with staff.
create policy "content items" on public.content_items for select using (public.has_permission('growth.manage') or (public.can_see_growth(client_id) and status <> 'draft'));
create policy "content feedback" on public.content_feedback for select using (exists (select 1 from public.content_items i where i.id = item_id and public.can_see_growth(i.client_id)));
create policy "reports" on public.growth_reports for select using (public.has_permission('growth.manage') or (public.can_see_growth(client_id) and published_at is not null));
create policy "agent jobs for staff" on public.agent_jobs for select using (public.has_permission('growth.manage'));

revoke all on public.notifications, public.growth_packages, public.growth_clients, public.growth_activity, public.content_items,
  public.content_feedback, public.growth_reports, public.agent_jobs from anon, authenticated;
grant all on public.notifications, public.growth_packages, public.growth_clients, public.growth_activity, public.content_items,
  public.content_feedback, public.growth_reports, public.agent_jobs to service_role;
grant select on public.growth_packages to anon, authenticated;
grant select on public.notifications, public.growth_clients, public.growth_activity, public.content_items, public.content_feedback,
  public.growth_reports, public.agent_jobs to authenticated;

revoke execute on function public.notify(uuid, text, text, text, text), public.growth_log(uuid, text, text), public.agent_enqueue(uuid, text, jsonb),
  public.growth_brief(uuid), public.enquiry_notify(), public.business_status_notify(), public.service_request_notify() from public, anon, authenticated;
revoke execute on function public.notifications_mark_read(bigint), public.can_see_growth(uuid, uuid), public.can_write_growth_path(text), public.can_read_growth_path(text),
  public.growth_save(uuid, jsonb), public.growth_submit(uuid, text), public.growth_withdraw(uuid), public.growth_choose_package(uuid, text),
  public.content_decide(bigint, text, text), public.admin_growth_decide(uuid, text, text), public.admin_growth_start_trial(uuid, timestamptz),
  public.admin_growth_allow_repeat(uuid, text), public.admin_growth_trial(uuid, text, int, text), public.growth_daily(),
  public.admin_content_save(uuid, bigint, jsonb), public.admin_content_send(bigint, text), public.admin_content_mark(bigint, text, text),
  public.admin_report_save(uuid, bigint, jsonb, boolean), public.admin_agent_job_update(bigint, text, text), public.admin_package_save(text, jsonb),
  public.admin_growth_stats(), public.admin_list_growth(text) from public, anon;
grant execute on function public.notifications_mark_read(bigint), public.can_see_growth(uuid, uuid), public.can_write_growth_path(text), public.can_read_growth_path(text),
  public.growth_save(uuid, jsonb), public.growth_submit(uuid, text), public.growth_withdraw(uuid), public.growth_choose_package(uuid, text),
  public.content_decide(bigint, text, text), public.admin_growth_decide(uuid, text, text), public.admin_growth_start_trial(uuid, timestamptz),
  public.admin_growth_allow_repeat(uuid, text), public.admin_growth_trial(uuid, text, int, text), public.growth_daily(),
  public.admin_content_save(uuid, bigint, jsonb), public.admin_content_send(bigint, text), public.admin_content_mark(bigint, text, text),
  public.admin_report_save(uuid, bigint, jsonb, boolean), public.admin_agent_job_update(bigint, text, text), public.admin_package_save(text, jsonb),
  public.admin_growth_stats(), public.admin_list_growth(text) to authenticated;
grant execute on all functions in schema public to service_role;
