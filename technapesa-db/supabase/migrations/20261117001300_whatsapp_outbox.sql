-- WhatsApp notifications (owner, 17 Nov 2026). Every important notification for a member with a phone number is also
-- queued for WhatsApp. The hourly agent sends the queue through the WhatsApp Business Cloud API once the owner adds
-- WHATSAPP_TOKEN and WHATSAPP_PHONE_ID; until then nothing leaves the queue. Members can switch WhatsApp off per topic.
insert into public.site_settings (key, value, is_public) values
  ('whatsapp.notifications', '{"on": false, "template": "tnp_update", "language": "en", "topics": ["billing", "trial", "content", "enquiries", "account"]}', false)
on conflict (key) do nothing;

create table public.whatsapp_outbox (
  id bigint generated always as identity primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  phone text not null check (phone ~ '^\+254[17][0-9]{8}$'),
  topic text not null,
  title text not null,
  body text,
  link text,
  status text not null default 'queued' check (status in ('queued', 'sent', 'failed', 'skipped')),
  error text,
  created_at timestamptz not null default now(),
  sent_at timestamptz
);
create index whatsapp_outbox_queue on public.whatsapp_outbox (status, created_at);
alter table public.whatsapp_outbox enable row level security;
create policy "staff read whatsapp outbox" on public.whatsapp_outbox for select using (public.has_permission('settings.manage'));
grant select on public.whatsapp_outbox to authenticated;
grant all on public.whatsapp_outbox to service_role;

create or replace function public.whatsapp_enqueue() returns trigger
language plpgsql security definer set search_path = public as $$
declare cfg jsonb := (select value from public.site_settings where key = 'whatsapp.notifications'); ph text;
begin
  if not (cfg->'topics') ? new.topic then return new; end if;
  if exists (select 1 from public.notification_prefs where user_id = new.user_id and topic = new.topic and channel = 'whatsapp' and not enabled) then return new; end if;
  select coalesce(p.phone, (select coalesce(g.whatsapp, g.phone) from public.growth_clients g where g.owner_id = new.user_id order by g.created_at desc limit 1)) into ph
    from public.profiles p where p.id = new.user_id;
  if ph is null then return new; end if;
  insert into public.whatsapp_outbox (user_id, phone, topic, title, body, link) values (new.user_id, ph, new.topic, new.title, new.body, new.link);
  return new;
end $$;
create trigger notifications_whatsapp after insert on public.notifications for each row execute function public.whatsapp_enqueue();

-- Members choose WhatsApp on or off for all their updates in one tap.
create or replace function public.whatsapp_set_mine(p_on boolean) returns void
language sql security definer set search_path = public as $$
  insert into public.notification_prefs (user_id, topic, channel, enabled)
  select auth.uid(), t, 'whatsapp', p_on from unnest(array['account', 'billing', 'trial', 'content', 'enquiries', 'reviews', 'verification', 'news']) t
  on conflict (user_id, topic, channel) do update set enabled = excluded.enabled;
$$;
revoke execute on function public.whatsapp_set_mine(boolean) from public, anon;
grant execute on function public.whatsapp_set_mine(boolean) to authenticated;
