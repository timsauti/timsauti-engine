-- Rename (owner, 24 Nov 2026): Tukachap Drop is now called Secret Messages on screen. Same alert rules, new SMS wording.
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
    left('TECH na PESA: ' || coalesce(nullif(who, '') || ', ', '') || 'someone sent you a secret message on Tukachap. Read it here: technapesa.co.ke/vibe/drops/', 300),
    'drop_alert', new.id::text)
  on conflict (reason, ref) do nothing;
  update public.vibe_drop_settings set last_sms_alert_at = now() where user_id = new.recipient_id;
  return new;
end $$;
