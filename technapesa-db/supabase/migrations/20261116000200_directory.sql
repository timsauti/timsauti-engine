-- =============================================================================================
-- TECH na PESA milestone 2: business directory, Business Connect (enquiries and support requests),
-- basic listing analytics and business photos.
-- Rules kept from the specification: a listing is reviewed by staff before it is public; a published
-- listing is never described as verified; every staff decision is written to the audit log.
-- All writes go through the functions below; browsers get read access only, filtered by row level security.
-- =============================================================================================

-- ---------------------------------------------------------------------------------------------
-- Businesses
-- ---------------------------------------------------------------------------------------------
create table public.businesses (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users(id) on delete cascade,
  slug text not null unique check (slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$' and char_length(slug) between 3 and 80),
  name text not null check (char_length(name) between 2 and 120),
  category_id bigint references public.categories(id),
  tagline text check (tagline is null or char_length(tagline) <= 140),
  description text not null default '' check (char_length(description) <= 3000),
  county_id smallint references public.counties(id),
  town text check (town is null or char_length(town) <= 80),
  address text check (address is null or char_length(address) <= 200),
  location extensions.geography(point, 4326),
  phone text check (phone is null or phone ~ '^\+254[17][0-9]{8}$'),
  whatsapp text check (whatsapp is null or whatsapp ~ '^\+254[17][0-9]{8}$'),
  email text check (email is null or email ~* '^[^@\s]+@[^@\s]+\.[^@\s]+$'),
  website text check (website is null or website ~* '^https?://[^\s]+$'),
  hours text check (hours is null or char_length(hours) <= 400),
  social jsonb not null default '{}'::jsonb,
  logo_path text,
  status text not null default 'draft' check (status in ('draft', 'pending', 'published', 'rejected', 'suspended')),
  status_reason text,
  submitted_at timestamptz,
  published_at timestamptz,
  featured_until timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index businesses_owner on public.businesses (owner_id);
create index businesses_public on public.businesses (status, county_id, category_id);
create index businesses_name_trgm on public.businesses using gin (name extensions.gin_trgm_ops);
create index businesses_location on public.businesses using gist (location);

create table public.business_offerings (
  id bigint generated always as identity primary key,
  business_id uuid not null references public.businesses(id) on delete cascade,
  kind text not null default 'service' check (kind in ('service', 'product')),
  name text not null check (char_length(name) between 2 and 100),
  description text not null default '' check (char_length(description) <= 400),
  price_text text check (price_text is null or char_length(price_text) <= 60),
  sort smallint not null default 100
);
create index business_offerings_business on public.business_offerings (business_id, sort);

create table public.business_photos (
  id bigint generated always as identity primary key,
  business_id uuid not null references public.businesses(id) on delete cascade,
  path text not null,
  caption text check (caption is null or char_length(caption) <= 140),
  sort smallint not null default 100,
  created_at timestamptz not null default now()
);
create index business_photos_business on public.business_photos (business_id, sort);

-- Basic analytics: daily counters only, no visitor details are stored.
create table public.business_daily_stats (
  business_id uuid not null references public.businesses(id) on delete cascade,
  day date not null default (now() at time zone 'Africa/Nairobi')::date,
  kind text not null check (kind in ('view', 'call', 'whatsapp', 'website', 'share', 'directions', 'enquiry')),
  count integer not null default 0,
  primary key (business_id, day, kind)
);

-- Customer enquiries to a business (Business Connect). Senders must be signed in, which limits spam.
create table public.enquiries (
  id bigint generated always as identity primary key,
  business_id uuid not null references public.businesses(id) on delete cascade,
  sender_id uuid references auth.users(id) on delete set null,
  sender_name text not null check (char_length(sender_name) between 2 and 80),
  sender_phone text check (sender_phone is null or sender_phone ~ '^\+254[17][0-9]{8}$'),
  sender_email text,
  preferred text not null default 'call' check (preferred in ('call', 'whatsapp', 'email')),
  message text not null check (char_length(message) between 10 and 1000),
  status text not null default 'new' check (status in ('new', 'read', 'replied', 'closed', 'spam')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index enquiries_business on public.enquiries (business_id, created_at desc);
create index enquiries_sender on public.enquiries (sender_id, created_at desc);

-- Requests from businesses for TECH na PESA Business Connect support services.
create table public.service_requests (
  id bigint generated always as identity primary key,
  requester_id uuid not null references auth.users(id) on delete cascade,
  business_id uuid references public.businesses(id) on delete set null,
  service text not null check (service in ('presence_assessment', 'profile_creation', 'google_profile', 'whatsapp_business',
    'catalogue', 'marketing_consultation', 'enquiry_workflow', 'promotion', 'other')),
  details text not null check (char_length(details) between 10 and 1500),
  contact_phone text check (contact_phone is null or contact_phone ~ '^\+254[17][0-9]{8}$'),
  status text not null default 'new' check (status in ('new', 'in_progress', 'done', 'cancelled')),
  assigned_to uuid references auth.users(id) on delete set null,
  response text check (response is null or char_length(response) <= 1500),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index service_requests_requester on public.service_requests (requester_id, created_at desc);
create index service_requests_status on public.service_requests (status, created_at);

insert into public.site_settings (key, value, is_public) values
  ('directory.max_listings_per_owner', '5', true),
  ('directory.enquiries_per_hour', '5', false)
on conflict (key) do nothing;

-- ---------------------------------------------------------------------------------------------
-- Helpers
-- ---------------------------------------------------------------------------------------------
create or replace function public.can_edit_business(p_business uuid, p_user uuid default auth.uid())
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.businesses b join public.profiles p on p.id = p_user
                 where b.id = p_business and p.status = 'active'
                   and (b.owner_id = p_user or public.has_permission('business.manage', p_user)));
$$;

create or replace function public.is_business_public(p_business uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.businesses where id = p_business and status = 'published');
$$;

-- Storage paths look like '<business id>/<file name>'. Anything else is refused.
create or replace function public.can_edit_business_path(p_path text)
returns boolean language plpgsql stable security definer set search_path = public as $$
begin
  if p_path !~ '^[0-9a-f-]{36}/[A-Za-z0-9._-]{1,80}$' then return false; end if;
  return public.can_edit_business(split_part(p_path, '/', 1)::uuid);
end $$;

create or replace function public.slugify(p text) returns text language sql immutable as $$
  select trim(both '-' from regexp_replace(lower(coalesce(p, '')), '[^a-z0-9]+', '-', 'g'));
$$;

create or replace function public.clean_phone(p text) returns text language plpgsql immutable as $$
declare v text := regexp_replace(coalesce(p, ''), '[\s()-]', '', 'g');
begin
  if v = '' then return null; end if;
  if v ~ '^0[17][0-9]{8}$' then v := '+254' || substr(v, 2); end if;
  if v ~ '^254[17][0-9]{8}$' then v := '+' || v; end if;
  if v !~ '^\+254[17][0-9]{8}$' then raise exception 'enter a Kenyan mobile number, for example 0712 345 678'; end if;
  return v;
end $$;

-- ---------------------------------------------------------------------------------------------
-- Owner actions
-- ---------------------------------------------------------------------------------------------
create or replace function public.business_save(p_id uuid, p jsonb) returns uuid
language plpgsql security definer set search_path = public as $$
declare
  b public.businesses; v_id uuid := p_id; v_slug text; n int; v_social jsonb := '{}'::jsonb; k text; u text;
  v_lat double precision := nullif(p->>'lat', '')::double precision; v_lng double precision := nullif(p->>'lng', '')::double precision;
  v_max int := coalesce((select value::int from public.site_settings where key = 'directory.max_listings_per_owner'), 5);
begin
  if auth.uid() is null then raise exception 'sign in first'; end if;
  if not exists (select 1 from public.profiles where id = auth.uid() and status = 'active') then raise exception 'account is not active'; end if;
  if char_length(trim(coalesce(p->>'name', ''))) < 2 then raise exception 'enter the business name'; end if;
  if nullif(p->>'category_id', '') is not null and not exists (select 1 from public.categories where id = (p->>'category_id')::bigint and division = 'business' and active) then
    raise exception 'choose a business category'; end if;
  for k in select unnest(array['facebook', 'instagram', 'tiktok', 'x', 'linkedin', 'youtube']) loop
    u := nullif(trim(coalesce(p->'social'->>k, '')), '');
    if u is not null then
      if u !~* '^https://[^\s]+$' then raise exception 'social links must start with https://'; end if;
      v_social := v_social || jsonb_build_object(k, left(u, 200));
    end if;
  end loop;
  if (v_lat is null) <> (v_lng is null) or (v_lat is not null and (v_lat not between -5 and 5.5 or v_lng not between 33.5 and 42.5)) then
    raise exception 'the map location must be inside Kenya'; end if;

  if v_id is null then
    select count(*) into n from public.businesses where owner_id = auth.uid();
    if n >= v_max then raise exception 'you can list up to % businesses; contact support for more', v_max; end if;
    v_slug := left(public.slugify(p->>'name'), 70);
    if char_length(v_slug) < 3 then v_slug := 'business-' || substr(md5(random()::text), 1, 6); end if;
    if exists (select 1 from public.businesses where slug = v_slug) then
      v_slug := v_slug || '-' || coalesce(public.slugify((select name from public.counties where id = nullif(p->>'county_id', '')::smallint)), 'ke');
      while exists (select 1 from public.businesses where slug = v_slug) loop v_slug := v_slug || '-' || substr(md5(random()::text), 1, 3); end loop;
    end if;
    insert into public.businesses (owner_id, slug, name) values (auth.uid(), v_slug, trim(p->>'name')) returning id into v_id;
    insert into public.user_roles (user_id, role) values (auth.uid(), 'business_owner') on conflict do nothing;
    perform public.log_action('business.created', 'business', v_id::text, null, jsonb_build_object('name', trim(p->>'name')));
  elsif not public.can_edit_business(v_id) then
    raise exception 'not allowed';
  end if;

  select * into b from public.businesses where id = v_id;
  if b.status = 'suspended' and not public.has_permission('business.manage') then raise exception 'this listing is suspended; contact support'; end if;
  update public.businesses set
    name = trim(p->>'name'),
    category_id = nullif(p->>'category_id', '')::bigint,
    tagline = nullif(left(trim(coalesce(p->>'tagline', '')), 140), ''),
    description = left(trim(coalesce(p->>'description', '')), 3000),
    county_id = nullif(p->>'county_id', '')::smallint,
    town = nullif(left(trim(coalesce(p->>'town', '')), 80), ''),
    address = nullif(left(trim(coalesce(p->>'address', '')), 200), ''),
    location = case when v_lat is null then null else extensions.st_setsrid(extensions.st_makepoint(v_lng, v_lat), 4326)::extensions.geography end,
    phone = public.clean_phone(p->>'phone'),
    whatsapp = public.clean_phone(p->>'whatsapp'),
    email = nullif(lower(trim(coalesce(p->>'email', ''))), ''),
    website = nullif(trim(coalesce(p->>'website', '')), ''),
    hours = nullif(left(trim(coalesce(p->>'hours', '')), 400), ''),
    social = v_social,
    updated_at = now()
  where id = v_id;
  if p_id is not null then
    perform public.log_action('business.updated', 'business', v_id::text, jsonb_build_object('name', b.name, 'status', b.status), jsonb_build_object('name', trim(p->>'name')));
  end if;
  return v_id;
end $$;

create or replace function public.business_submit(p_id uuid) returns void
language plpgsql security definer set search_path = public as $$
declare b public.businesses;
begin
  select * into b from public.businesses where id = p_id;
  if not found or b.owner_id <> auth.uid() or not public.can_edit_business(p_id) then raise exception 'not allowed'; end if;
  if b.status not in ('draft', 'rejected') then raise exception 'this listing is already %', b.status; end if;
  if b.category_id is null or b.county_id is null then raise exception 'choose a category and a county before sending for review'; end if;
  if char_length(b.description) < 40 then raise exception 'describe the business in at least 40 characters before sending for review'; end if;
  if b.phone is null and b.whatsapp is null and b.email is null then raise exception 'add a phone number, WhatsApp number or email so customers can reach you'; end if;
  update public.businesses set status = 'pending', status_reason = null, submitted_at = now() where id = p_id;
  perform public.log_action('business.submitted', 'business', p_id::text, to_jsonb(b.status), to_jsonb('pending'::text));
end $$;

-- Owner hides a listing (pending or published goes back to draft). Nothing is deleted.
create or replace function public.business_withdraw(p_id uuid) returns void
language plpgsql security definer set search_path = public as $$
declare b public.businesses;
begin
  select * into b from public.businesses where id = p_id;
  if not found or b.owner_id <> auth.uid() then raise exception 'not allowed'; end if;
  if b.status not in ('pending', 'published') then raise exception 'only a pending or published listing can be hidden'; end if;
  update public.businesses set status = 'draft', published_at = null where id = p_id;
  perform public.log_action('business.withdrawn', 'business', p_id::text, to_jsonb(b.status), to_jsonb('draft'::text));
end $$;

create or replace function public.business_set_logo(p_id uuid, p_path text) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not public.can_edit_business(p_id) then raise exception 'not allowed'; end if;
  if p_path is not null and split_part(p_path, '/', 1) <> p_id::text then raise exception 'that file does not belong to this business'; end if;
  update public.businesses set logo_path = p_path, updated_at = now() where id = p_id;
end $$;

create or replace function public.business_photo_add(p_id uuid, p_path text, p_caption text default null) returns bigint
language plpgsql security definer set search_path = public as $$
declare v bigint;
begin
  if not public.can_edit_business(p_id) then raise exception 'not allowed'; end if;
  if split_part(p_path, '/', 1) <> p_id::text then raise exception 'that file does not belong to this business'; end if;
  if (select count(*) from public.business_photos where business_id = p_id) >= 12 then raise exception 'a listing can show up to 12 photos'; end if;
  insert into public.business_photos (business_id, path, caption, sort)
  values (p_id, p_path, nullif(left(trim(coalesce(p_caption, '')), 140), ''), coalesce((select max(sort) + 10 from public.business_photos where business_id = p_id), 10))
  returning id into v;
  return v;
end $$;

create or replace function public.business_photo_remove(p_photo bigint) returns text
language plpgsql security definer set search_path = public as $$
declare ph public.business_photos;
begin
  select * into ph from public.business_photos where id = p_photo;
  if not found or not public.can_edit_business(ph.business_id) then raise exception 'not allowed'; end if;
  delete from public.business_photos where id = p_photo;
  return ph.path;
end $$;

create or replace function public.business_offering_save(p_business uuid, p_id bigint, p_kind text, p_name text, p_description text, p_price text) returns bigint
language plpgsql security definer set search_path = public as $$
declare v bigint := p_id;
begin
  if not public.can_edit_business(p_business) then raise exception 'not allowed'; end if;
  if char_length(trim(coalesce(p_name, ''))) < 2 then raise exception 'enter a name for the product or service'; end if;
  if v is null then
    if (select count(*) from public.business_offerings where business_id = p_business) >= 30 then raise exception 'a listing can show up to 30 products and services'; end if;
    insert into public.business_offerings (business_id, kind, name, description, price_text, sort)
    values (p_business, coalesce(p_kind, 'service'), trim(p_name), left(trim(coalesce(p_description, '')), 400), nullif(left(trim(coalesce(p_price, '')), 60), ''),
            coalesce((select max(sort) + 10 from public.business_offerings where business_id = p_business), 10))
    returning id into v;
  else
    update public.business_offerings set kind = coalesce(p_kind, kind), name = trim(p_name), description = left(trim(coalesce(p_description, '')), 400),
      price_text = nullif(left(trim(coalesce(p_price, '')), 60), '')
    where id = v and business_id = p_business;
    if not found then raise exception 'not found'; end if;
  end if;
  return v;
end $$;

create or replace function public.business_offering_remove(p_id bigint) returns void
language plpgsql security definer set search_path = public as $$
declare o public.business_offerings;
begin
  select * into o from public.business_offerings where id = p_id;
  if not found or not public.can_edit_business(o.business_id) then raise exception 'not allowed'; end if;
  delete from public.business_offerings where id = p_id;
end $$;

-- Anyone (signed in or not) may count a view or a contact tap on a published listing.
create or replace function public.record_business_event(p_business uuid, p_kind text) returns void
language plpgsql security definer set search_path = public as $$
begin
  if p_kind not in ('view', 'call', 'whatsapp', 'website', 'share', 'directions') then return; end if;
  if not public.is_business_public(p_business) then return; end if;
  insert into public.business_daily_stats (business_id, kind, count) values (p_business, p_kind, 1)
  on conflict (business_id, day, kind) do update set count = public.business_daily_stats.count + 1;
end $$;

create or replace function public.business_stats(p_business uuid, p_days int default 30)
returns table (kind text, total bigint) language plpgsql stable security definer set search_path = public as $$
begin
  if not public.can_edit_business(p_business) then raise exception 'not allowed'; end if;
  return query select s.kind, sum(s.count)::bigint from public.business_daily_stats s
    where s.business_id = p_business and s.day > (now() at time zone 'Africa/Nairobi')::date - least(greatest(p_days, 1), 365)
    group by s.kind;
end $$;

-- ---------------------------------------------------------------------------------------------
-- Enquiries
-- ---------------------------------------------------------------------------------------------
create or replace function public.send_enquiry(p_business uuid, p_name text, p_phone text, p_preferred text, p_message text) returns bigint
language plpgsql security definer set search_path = public as $$
declare v bigint; b public.businesses; v_max int := coalesce((select value::int from public.site_settings where key = 'directory.enquiries_per_hour'), 5);
begin
  if auth.uid() is null then raise exception 'sign in to send an enquiry'; end if;
  if not exists (select 1 from public.profiles where id = auth.uid() and status = 'active') then raise exception 'account is not active'; end if;
  select * into b from public.businesses where id = p_business and status = 'published';
  if not found then raise exception 'this business is not taking enquiries right now'; end if;
  if b.owner_id = auth.uid() then raise exception 'you cannot send an enquiry to your own business'; end if;
  if (select count(*) from public.enquiries where sender_id = auth.uid() and created_at > now() - interval '1 hour') >= v_max
     or (select count(*) from public.enquiries where sender_id = auth.uid() and created_at > now() - interval '1 day') >= v_max * 4 then
    raise exception 'too many enquiries; please wait a while and try again';
  end if;
  if char_length(trim(coalesce(p_message, ''))) < 10 then raise exception 'write a little more about what you need'; end if;
  insert into public.enquiries (business_id, sender_id, sender_name, sender_phone, sender_email, preferred, message)
  values (p_business, auth.uid(), left(trim(p_name), 80), public.clean_phone(p_phone), (select email from auth.users where id = auth.uid()),
          coalesce(nullif(p_preferred, ''), 'call'), left(trim(p_message), 1000))
  returning id into v;
  insert into public.business_daily_stats (business_id, kind, count) values (p_business, 'enquiry', 1)
  on conflict (business_id, day, kind) do update set count = public.business_daily_stats.count + 1;
  return v;
end $$;

create or replace function public.enquiry_set_status(p_id bigint, p_status text) returns void
language plpgsql security definer set search_path = public as $$
declare e public.enquiries;
begin
  if p_status not in ('read', 'replied', 'closed', 'spam', 'new') then raise exception 'unknown status'; end if;
  select * into e from public.enquiries where id = p_id;
  if not found or not public.can_edit_business(e.business_id) then raise exception 'not allowed'; end if;
  update public.enquiries set status = p_status, updated_at = now() where id = p_id;
end $$;

-- ---------------------------------------------------------------------------------------------
-- Business Connect support requests
-- ---------------------------------------------------------------------------------------------
create or replace function public.service_request_create(p_business uuid, p_service text, p_details text, p_phone text) returns bigint
language plpgsql security definer set search_path = public as $$
declare v bigint;
begin
  if auth.uid() is null then raise exception 'sign in first'; end if;
  if not exists (select 1 from public.profiles where id = auth.uid() and status = 'active') then raise exception 'account is not active'; end if;
  if p_business is not null and not exists (select 1 from public.businesses where id = p_business and owner_id = auth.uid()) then raise exception 'not allowed'; end if;
  if (select count(*) from public.service_requests where requester_id = auth.uid() and status in ('new', 'in_progress')) >= 5 then
    raise exception 'you already have 5 open requests; we will get back to you on those first'; end if;
  insert into public.service_requests (requester_id, business_id, service, details, contact_phone)
  values (auth.uid(), p_business, p_service, trim(p_details), public.clean_phone(p_phone)) returning id into v;
  perform public.log_action('service_request.created', 'service_request', v::text, null, jsonb_build_object('service', p_service));
  return v;
end $$;

create or replace function public.service_request_cancel(p_id bigint) returns void
language plpgsql security definer set search_path = public as $$
begin
  update public.service_requests set status = 'cancelled', updated_at = now() where id = p_id and requester_id = auth.uid() and status = 'new';
  if not found then raise exception 'only a new request of yours can be cancelled'; end if;
  perform public.log_action('service_request.cancelled', 'service_request', p_id::text, null, null);
end $$;

-- ---------------------------------------------------------------------------------------------
-- Staff actions (business.manage)
-- ---------------------------------------------------------------------------------------------
create or replace function public.admin_review_business(p_id uuid, p_decision text, p_note text default null) returns void
language plpgsql security definer set search_path = public as $$
declare b public.businesses;
begin
  if not public.has_permission('business.manage') then raise exception 'not allowed'; end if;
  select * into b from public.businesses where id = p_id; if not found then raise exception 'unknown business'; end if;
  if p_decision = 'publish' then
    if b.status not in ('pending', 'suspended') then raise exception 'only a pending or suspended listing can be published'; end if;
    update public.businesses set status = 'published', status_reason = null, published_at = coalesce(published_at, now()) where id = p_id;
  elsif p_decision in ('reject', 'suspend') then
    if coalesce(trim(p_note), '') = '' then raise exception 'a reason is required; the owner will see it'; end if;
    if p_decision = 'reject' and b.status <> 'pending' then raise exception 'only a pending listing can be rejected'; end if;
    if p_decision = 'suspend' and b.status <> 'published' then raise exception 'only a published listing can be suspended'; end if;
    update public.businesses set status = case when p_decision = 'reject' then 'rejected' else 'suspended' end,
      status_reason = left(trim(p_note), 500), featured_until = null where id = p_id;
  else
    raise exception 'use publish, reject or suspend';
  end if;
  perform public.log_action('business.' || p_decision || 'ed', 'business', p_id::text,
    to_jsonb(b.status), to_jsonb((select status from public.businesses where id = p_id)), left(p_note, 500));
end $$;

create or replace function public.admin_feature_business(p_id uuid, p_days int) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not public.has_permission('business.manage') then raise exception 'not allowed'; end if;
  if p_days < 0 or p_days > 366 then raise exception 'choose between 0 and 366 days'; end if;
  update public.businesses set featured_until = case when p_days = 0 then null else now() + make_interval(days => p_days) end
  where id = p_id and status = 'published';
  if not found then raise exception 'only a published listing can be featured'; end if;
  perform public.log_action(case when p_days = 0 then 'business.unfeatured' else 'business.featured' end, 'business', p_id::text, null, jsonb_build_object('days', p_days));
end $$;

create or replace function public.admin_service_request_update(p_id bigint, p_status text, p_response text default null, p_assign_to_me boolean default false) returns void
language plpgsql security definer set search_path = public as $$
declare r public.service_requests;
begin
  if not public.has_permission('business.manage') then raise exception 'not allowed'; end if;
  if p_status not in ('new', 'in_progress', 'done', 'cancelled') then raise exception 'unknown status'; end if;
  select * into r from public.service_requests where id = p_id; if not found then raise exception 'unknown request'; end if;
  update public.service_requests set status = p_status, response = coalesce(nullif(trim(coalesce(p_response, '')), ''), response),
    assigned_to = case when p_assign_to_me then auth.uid() else assigned_to end, updated_at = now() where id = p_id;
  perform public.log_action('service_request.updated', 'service_request', p_id::text, to_jsonb(r.status), to_jsonb(p_status), left(p_response, 500));
end $$;

create or replace function public.admin_business_stats()
returns table (businesses bigint, published bigint, pending bigint, featured bigint, enquiries_7_days bigint, open_requests bigint)
language plpgsql stable security definer set search_path = public as $$
begin
  if not public.has_permission('business.manage') then raise exception 'not allowed'; end if;
  return query select
    (select count(*) from public.businesses), (select count(*) from public.businesses where status = 'published'),
    (select count(*) from public.businesses where status = 'pending'), (select count(*) from public.businesses where featured_until > now()),
    (select count(*) from public.enquiries where created_at > now() - interval '7 days'),
    (select count(*) from public.service_requests where status in ('new', 'in_progress'));
end $$;

-- Staff list of service requests with the requester's name and email.
create or replace function public.admin_list_service_requests(p_status text default null)
returns table (id bigint, created_at timestamptz, service text, details text, status text, response text, contact_phone text,
               business_name text, requester_name text, requester_email text, assigned_to_me boolean)
language plpgsql stable security definer set search_path = public as $$
begin
  if not public.has_permission('business.manage') then raise exception 'not allowed'; end if;
  return query select r.id, r.created_at, r.service, r.details, r.status, r.response, r.contact_phone, b.name, p.full_name, u.email::text, r.assigned_to = auth.uid()
    from public.service_requests r join public.profiles p on p.id = r.requester_id join auth.users u on u.id = r.requester_id
    left join public.businesses b on b.id = r.business_id
    where p_status is null or r.status = p_status
    order by (r.status = 'new') desc, r.created_at desc limit 200;
end $$;

-- ---------------------------------------------------------------------------------------------
-- Public directory view: published listings only, without owner or review details.
-- The view runs with its owner's rights, so it is the only way visitors read listings.
-- ---------------------------------------------------------------------------------------------
create view public.directory with (security_barrier = true) as
  select b.id, b.slug, b.name, b.tagline, b.description, b.town, b.address, b.phone, b.whatsapp, b.email, b.website, b.hours, b.social,
         b.logo_path, b.published_at, (b.featured_until is not null and b.featured_until > now()) as featured,
         case when b.location is null then null else extensions.st_y(b.location::extensions.geometry) end as lat,
         case when b.location is null then null else extensions.st_x(b.location::extensions.geometry) end as lng,
         b.county_id, co.name as county, co.slug as county_slug, b.category_id, c.name as category, c.slug as category_slug
  from public.businesses b
  left join public.counties co on co.id = b.county_id
  left join public.categories c on c.id = b.category_id
  where b.status = 'published';

-- ---------------------------------------------------------------------------------------------
-- Photo storage: public bucket, images only, 3 MB each, written only by the listing's owner or staff.
-- ---------------------------------------------------------------------------------------------
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('business-media', 'business-media', true, 3145728, array['image/jpeg', 'image/png', 'image/webp'])
on conflict (id) do nothing;

create policy "business media readable" on storage.objects for select using (bucket_id = 'business-media');
create policy "business media upload" on storage.objects for insert to authenticated with check (bucket_id = 'business-media' and public.can_edit_business_path(name));
create policy "business media replace" on storage.objects for update to authenticated using (bucket_id = 'business-media' and public.can_edit_business_path(name));
create policy "business media remove" on storage.objects for delete to authenticated using (bucket_id = 'business-media' and public.can_edit_business_path(name));

-- ---------------------------------------------------------------------------------------------
-- Row level security and grants
-- ---------------------------------------------------------------------------------------------
alter table public.businesses enable row level security;
alter table public.business_offerings enable row level security;
alter table public.business_photos enable row level security;
alter table public.business_daily_stats enable row level security;
alter table public.enquiries enable row level security;
alter table public.service_requests enable row level security;

create policy "own or staff businesses" on public.businesses for select using (owner_id = auth.uid() or public.has_permission('business.manage'));
create policy "offerings of public or own listings" on public.business_offerings for select using (public.is_business_public(business_id) or public.can_edit_business(business_id));
create policy "photos of public or own listings" on public.business_photos for select using (public.is_business_public(business_id) or public.can_edit_business(business_id));
create policy "stats of own listings" on public.business_daily_stats for select using (public.can_edit_business(business_id));
create policy "enquiries for owner, sender or staff" on public.enquiries for select using (sender_id = auth.uid() or public.can_edit_business(business_id));
create policy "own or staff service requests" on public.service_requests for select using (requester_id = auth.uid() or public.has_permission('business.manage'));

-- Supabase grants new tables to anon and authenticated by default; take that away and grant back reads only.
revoke all on public.businesses, public.business_offerings, public.business_photos, public.business_daily_stats,
  public.enquiries, public.service_requests, public.directory from anon, authenticated;
grant all on public.businesses, public.business_offerings, public.business_photos, public.business_daily_stats,
  public.enquiries, public.service_requests, public.directory to service_role;
grant select on public.directory, public.business_offerings, public.business_photos to anon, authenticated;
grant select on public.businesses, public.business_daily_stats, public.enquiries, public.service_requests to authenticated;

revoke execute on function public.can_edit_business(uuid, uuid), public.is_business_public(uuid), public.can_edit_business_path(text),
  public.slugify(text), public.clean_phone(text), public.business_save(uuid, jsonb), public.business_submit(uuid), public.business_withdraw(uuid),
  public.business_set_logo(uuid, text), public.business_photo_add(uuid, text, text), public.business_photo_remove(bigint),
  public.business_offering_save(uuid, bigint, text, text, text, text), public.business_offering_remove(bigint),
  public.record_business_event(uuid, text), public.business_stats(uuid, int), public.send_enquiry(uuid, text, text, text, text),
  public.enquiry_set_status(bigint, text), public.service_request_create(uuid, text, text, text), public.service_request_cancel(bigint),
  public.admin_review_business(uuid, text, text), public.admin_feature_business(uuid, int), public.admin_service_request_update(bigint, text, text, boolean),
  public.admin_business_stats(), public.admin_list_service_requests(text) from public, anon, authenticated;
grant execute on function public.is_business_public(uuid), public.can_edit_business(uuid, uuid), public.record_business_event(uuid, text) to anon, authenticated;
grant execute on function public.can_edit_business(uuid, uuid), public.can_edit_business_path(text),
  public.business_save(uuid, jsonb), public.business_submit(uuid), public.business_withdraw(uuid),
  public.business_set_logo(uuid, text), public.business_photo_add(uuid, text, text), public.business_photo_remove(bigint),
  public.business_offering_save(uuid, bigint, text, text, text, text), public.business_offering_remove(bigint),
  public.business_stats(uuid, int), public.send_enquiry(uuid, text, text, text, text), public.enquiry_set_status(bigint, text),
  public.service_request_create(uuid, text, text, text), public.service_request_cancel(bigint),
  public.admin_review_business(uuid, text, text), public.admin_feature_business(uuid, int), public.admin_service_request_update(bigint, text, text, boolean),
  public.admin_business_stats(), public.admin_list_service_requests(text) to authenticated;
grant execute on all functions in schema public to service_role;
