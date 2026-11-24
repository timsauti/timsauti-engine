-- Tukachap Drop SMS alerts (owner, 24 Nov 2026): when a member receives a Drop, the phone number on their
-- TECH na PESA account gets a short SMS through the existing queue (sms_outbox, sent hourly by the agent with Onfon).
-- On by default; the member can switch it off on their My Drops page. At most one alert every 3 hours per member.
-- The SMS never contains the Drop text or anything about the sender.

alter table public.vibe_drop_settings
  add column if not exists sms_alerts boolean not null default true,
  add column if not exists last_sms_alert_at timestamptz;

create or replace function public.vibe_drop_sms_alert() returns trigger
language plpgsql security definer set search_path = public as $$
declare on_ boolean; last_ timestamptz; ph text; who text;
begin
  insert into public.vibe_drop_settings (user_id) values (new.recipient_id) on conflict (user_id) do nothing;
  select s.sms_alerts, s.last_sms_alert_at into on_, last_ from public.vibe_drop_settings s where s.user_id = new.recipient_id;
  if not coalesce(on_, true) then return new; end if;
  if last_ is not null and last_ > now() - interval '3 hours' then return new; end if;
  select p.phone, split_part(coalesce(nullif(p.display_name, ''), p.full_name, ''), ' ', 1) into ph, who
    from public.profiles p where p.id = new.recipient_id and p.status = 'active';
  if ph is null then return new; end if;
  insert into public.sms_outbox (user_id, phone, message, reason, ref)
  values (new.recipient_id, ph,
    left('TECH na PESA: ' || coalesce(nullif(who, '') || ', ', '') || 'you have a new private message on Tukachap Drop. Read it here: technapesa.co.ke/vibe/drops/', 300),
    'drop_alert', new.id::text)
  on conflict (reason, ref) do nothing;
  update public.vibe_drop_settings set last_sms_alert_at = now() where user_id = new.recipient_id;
  return new;
end $$;
revoke all on function public.vibe_drop_sms_alert() from public, anon, authenticated;

drop trigger if exists vibe_drops_sms_alert on public.vibe_drops;
create trigger vibe_drops_sms_alert after insert on public.vibe_drops for each row execute function public.vibe_drop_sms_alert();

-- The member's own switch, and what their My Drops page needs to show it.
create or replace function public.vibe_drop_sms_set(p_on boolean) returns void
language plpgsql security definer set search_path = public as $$
declare me uuid := auth.uid();
begin
  if me is null or not exists (select 1 from public.vibe_profiles where user_id = me) then raise exception 'Join Tukachap first'; end if;
  insert into public.vibe_drop_settings (user_id, sms_alerts) values (me, coalesce(p_on, true))
  on conflict (user_id) do update set sms_alerts = excluded.sms_alerts, updated_at = now();
end $$;
revoke all on function public.vibe_drop_sms_set(boolean) from public, anon;
grant execute on function public.vibe_drop_sms_set(boolean) to authenticated;

create or replace function public.vibe_drop_sms_status() returns jsonb
language sql stable security definer set search_path = public as $$
  select jsonb_build_object(
    'on', coalesce((select s.sms_alerts from public.vibe_drop_settings s where s.user_id = auth.uid()), true),
    'has_phone', exists (select 1 from public.profiles p where p.id = auth.uid() and p.phone is not null))
  where auth.uid() is not null;
$$;
revoke all on function public.vibe_drop_sms_status() from public, anon;
grant execute on function public.vibe_drop_sms_status() to authenticated;
