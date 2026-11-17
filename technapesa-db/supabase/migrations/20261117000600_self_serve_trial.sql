-- Owner, 17 Nov 2026: the client goes from application to paid package without waiting on staff.
-- 1) A complete application is approved automatically (growth.auto_approve, default on; staff can still pause or end).
-- 2) The client starts the free trial themselves, today or on a date they choose.
-- 3) A call with the team is optional: the client requests one, it stays as the only pending item, and staff get a
--    phone alert (Telegram) the moment it is requested. Every staff alert goes through public.staff_alerts.

insert into public.site_settings (key, value, is_public) values ('growth.auto_approve', 'true', false) on conflict (key) do nothing;

alter table public.growth_clients
  add column call_requested_at timestamptz,
  add column call_phone text,
  add column call_when text check (call_when is null or call_when in ('morning', 'afternoon', 'evening', 'any')),
  add column call_note text check (call_note is null or char_length(call_note) <= 300),
  add column call_done_at timestamptz;

create table public.staff_alerts (
  id bigint generated always as identity primary key,
  kind text not null,
  client_id uuid references public.growth_clients(id) on delete cascade,
  message text not null check (char_length(message) <= 800),
  created_at timestamptz not null default now(),
  sent_at timestamptz
);
alter table public.staff_alerts enable row level security;
revoke all on public.staff_alerts from anon, authenticated;
grant all on public.staff_alerts to service_role;

create or replace function public.staff_alert(p_kind text, p_client uuid, p_message text) returns void
language sql security definer set search_path = public as $$
  insert into public.staff_alerts (kind, client_id, message) values (p_kind, p_client, left(p_message, 800));
$$;
revoke execute on function public.staff_alert(text, uuid, text) from public, anon, authenticated;

create or replace function public.growth_submit(p_id uuid, p_agreement text) returns void
language plpgsql security definer set search_path = public as $$
declare c public.growth_clients; cur text := (select value #>> '{}' from public.site_settings where key = 'growth.agreement_version');
  auto boolean := coalesce((select value::boolean from public.site_settings where key = 'growth.auto_approve'), true);
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
  update public.growth_clients set status = case when auto then 'approved' else 'applied' end, applied_at = now(), decided_at = case when auto then now() end,
    agreement_version = p_agreement, agreed_at = now(), status_reason = null, updated_at = now() where id = p_id;
  insert into public.consents (user_id, kind, version, granted, source) values (auth.uid(), 'terms', 'growth-' || p_agreement, true, 'web');
  if auto then
    perform public.growth_log(p_id, 'approve', 'Application approved. Start your free trial whenever you are ready.');
    perform public.notify(c.owner_id, 'trial', 'Your Digital Growth free trial is approved', 'Start your 14 day free trial whenever you are ready.', '/account/growth/');
  else
    perform public.growth_log(p_id, 'applied', 'Application sent. Our team reviews it, usually within two working days.');
  end if;
  perform public.staff_alert('application', p_id, 'New Digital Growth application' || case when auto then ' (approved automatically)' else ' to review' end || ': ' || c.business_name
    || coalesce(', ' || c.town, '') || '. Phone ' || coalesce(c.whatsapp, c.phone, 'not given') || '.');
  perform public.log_action(case when auto then 'growth.auto_approved' else 'growth.applied' end, 'growth_client', p_id::text, to_jsonb(c.status), to_jsonb(case when auto then 'approved' else 'applied' end));
end $$;

-- The client starts their own free trial (same rules as staff: no uncontrolled repeat trials).
create or replace function public.growth_start_own_trial(p_id uuid, p_start date default null) returns timestamptz
language plpgsql security definer set search_path = public as $$
declare c public.growth_clients; days int := coalesce((select value::int from public.site_settings where key = 'growth.trial_days'), 14);
  s timestamptz := case when p_start is null or p_start <= (now() at time zone 'Africa/Nairobi')::date then now() else (p_start::text || ' 08:00:00+03')::timestamptz end;
begin
  select * into c from public.growth_clients where id = p_id;
  if not found or c.owner_id <> auth.uid() then raise exception 'not allowed'; end if;
  if c.status <> 'approved' then raise exception 'your free trial can be started once the application is approved'; end if;
  if s > now() + interval '30 days' then raise exception 'choose a start date within the next 30 days'; end if;
  if not c.repeat_trial_allowed and exists (
      select 1 from public.growth_clients o where o.id <> c.id and o.trial_started_at is not null
        and (o.owner_id = c.owner_id or (c.phone is not null and c.phone in (o.phone, o.whatsapp)) or (c.whatsapp is not null and c.whatsapp in (o.phone, o.whatsapp))
             or (lower(o.business_name) = lower(c.business_name) and o.county_id is not distinct from c.county_id))) then
    raise exception 'this business or phone number has had a free trial before. You can choose a package under Package and billing, or request a call and we will help';
  end if;
  update public.growth_clients set status = 'trial_active', trial_started_at = s, trial_ends_at = s + make_interval(days => days), trial_warned_at = null, updated_at = now() where id = p_id;
  perform public.agent_enqueue(p_id, 'onboard_client', public.growth_brief(p_id));
  perform public.growth_log(p_id, 'trial', 'You started your free trial. It runs from ' || to_char(s at time zone 'Africa/Nairobi', 'DD Mon YYYY') || ' to ' || to_char((s + make_interval(days => days)) at time zone 'Africa/Nairobi', 'DD Mon YYYY') || '. Nothing is charged when it ends.');
  perform public.notify(c.owner_id, 'trial', 'Your ' || days || ' day free trial has started', 'It ends on ' || to_char((s + make_interval(days => days)) at time zone 'Africa/Nairobi', 'DD Mon YYYY') || '. Nothing is charged when it ends.', '/account/growth/');
  perform public.staff_alert('trial', p_id, 'Free trial started by the client: ' || c.business_name || ', from ' || to_char(s at time zone 'Africa/Nairobi', 'DD Mon') || '. Plan their first posts.');
  perform public.log_action('growth.trial_started_by_client', 'growth_client', p_id::text, to_jsonb(c.status), to_jsonb(s));
  return s;
end $$;

-- Optional call with the team: never blocks anything; stays pending until staff mark it done.
create or replace function public.growth_request_call(p_id uuid, p_phone text, p_when text, p_note text default null) returns void
language plpgsql security definer set search_path = public as $$
declare c public.growth_clients; ph text := public.clean_phone(p_phone);
begin
  select * into c from public.growth_clients where id = p_id;
  if not found or c.owner_id <> auth.uid() then raise exception 'not allowed'; end if;
  if c.status in ('rejected', 'withdrawn', 'terminated') then raise exception 'this application is closed'; end if;
  if ph is null then raise exception 'enter a phone number such as 0712 345 678'; end if;
  if coalesce(p_when, 'any') not in ('morning', 'afternoon', 'evening', 'any') then raise exception 'choose a time of day'; end if;
  if c.call_requested_at is not null and c.call_done_at is null and c.call_requested_at > now() - interval '10 minutes' then raise exception 'your call request is already with our team'; end if;
  update public.growth_clients set call_requested_at = now(), call_phone = ph, call_when = coalesce(p_when, 'any'), call_note = nullif(left(trim(coalesce(p_note, '')), 300), ''), call_done_at = null, updated_at = now() where id = p_id;
  perform public.growth_log(p_id, 'call', 'You asked for a call. Our team will call you on ' || ph || '.');
  perform public.staff_alert('call', p_id, 'CALL REQUEST: ' || c.business_name || ' wants a call on ' || ph || ', best time: ' || coalesce(p_when, 'any') || '.' || coalesce(' Note: ' || nullif(trim(coalesce(p_note, '')), ''), ''));
end $$;

create or replace function public.admin_growth_call_done(p_id uuid, p_note text default null) returns void
language plpgsql security definer set search_path = public as $$
declare c public.growth_clients;
begin
  if not public.has_permission('growth.manage') then raise exception 'not allowed'; end if;
  select * into c from public.growth_clients where id = p_id; if not found then raise exception 'unknown client'; end if;
  if c.call_requested_at is null or c.call_done_at is not null then raise exception 'there is no pending call'; end if;
  update public.growth_clients set call_done_at = now(), updated_at = now() where id = p_id;
  perform public.growth_log(p_id, 'call', 'Our team called you.' || coalesce(' ' || nullif(trim(coalesce(p_note, '')), ''), ''));
  perform public.log_action('growth.call_done', 'growth_client', p_id::text, null, null, p_note);
end $$;

drop function public.admin_growth_stats();
create function public.admin_growth_stats()
returns table (applications bigint, approved_waiting bigint, active_trials bigint, ended_trials bigint, subscribed bigint, awaiting_approval bigint, agent_jobs_waiting bigint, calls_pending bigint)
language plpgsql stable security definer set search_path = public as $$
begin
  if not public.has_permission('growth.manage') then raise exception 'not allowed'; end if;
  return query select
    (select count(*) from public.growth_clients where status = 'applied'), (select count(*) from public.growth_clients where status = 'approved'),
    (select count(*) from public.growth_clients where status in ('trial_active', 'trial_paused')), (select count(*) from public.growth_clients where status = 'trial_ended'),
    (select count(*) from public.growth_clients where status = 'subscribed'), (select count(*) from public.content_items where status = 'awaiting_approval'),
    (select count(*) from public.agent_jobs where status in ('awaiting_configuration', 'queued', 'failed')),
    (select count(*) from public.growth_clients where call_requested_at is not null and call_done_at is null);
end $$;
revoke execute on function public.admin_growth_stats() from public, anon;
grant execute on function public.admin_growth_stats() to authenticated;

revoke execute on function public.growth_start_own_trial(uuid, date), public.growth_request_call(uuid, text, text, text), public.admin_growth_call_done(uuid, text) from public, anon;
grant execute on function public.growth_start_own_trial(uuid, date), public.growth_request_call(uuid, text, text, text), public.admin_growth_call_done(uuid, text) to authenticated;
