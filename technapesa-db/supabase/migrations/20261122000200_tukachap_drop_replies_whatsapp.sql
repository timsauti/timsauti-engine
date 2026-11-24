-- Tukachap Drop replies and privacy-preserving WhatsApp notifications.
-- Additive only. Apply to the isolated Tukachap staging project after its base schema is prepared.

alter table public.vibe_drops
  add column if not exists reply_token_hash text,
  add column if not exists reply_token_expires_at timestamptz;

create unique index if not exists vibe_drops_reply_token_hash
  on public.vibe_drops (reply_token_hash)
  where reply_token_hash is not null;

create table if not exists public.vibe_drop_replies (
  id uuid primary key default gen_random_uuid(),
  drop_id uuid not null references public.vibe_drops(id) on delete cascade,
  author_role text not null check (author_role in ('recipient', 'sender')),
  message text not null check (char_length(trim(message)) between 1 and 2000),
  created_at timestamptz not null default now()
);
create index if not exists vibe_drop_replies_thread
  on public.vibe_drop_replies (drop_id, created_at);

alter table public.vibe_drop_replies enable row level security;
revoke all on public.vibe_drop_replies from anon, authenticated;
grant select, insert, update, delete on public.vibe_drop_replies to service_role;

alter table public.vibe_drop_settings
  add column if not exists whatsapp_enabled boolean not null default false,
  add column if not exists whatsapp_consent_at timestamptz;

grant update (whatsapp_enabled, whatsapp_consent_at) on public.vibe_drop_settings to authenticated;

create or replace function public.vibe_drop_whatsapp_set(p_on boolean)
returns void
language plpgsql security definer set search_path = public as $$
declare
  me uuid := public.vibe_need_me();
  verified timestamptz;
begin
  if p_on then
    select phone_verified_at into verified from public.profiles where id = me and status = 'active';
    if verified is null then
      raise exception 'Verify your phone number before enabling WhatsApp Drop alerts';
    end if;
  end if;

  insert into public.vibe_drop_settings (user_id, whatsapp_enabled, whatsapp_consent_at, updated_at)
  values (me, p_on, case when p_on then now() else null end, now())
  on conflict (user_id) do update set
    whatsapp_enabled = excluded.whatsapp_enabled,
    whatsapp_consent_at = excluded.whatsapp_consent_at,
    updated_at = now();
end $$;

revoke all on function public.vibe_drop_whatsapp_set(boolean) from public, anon;
grant execute on function public.vibe_drop_whatsapp_set(boolean) to authenticated;

-- The messages topic is already allowed by notification_prefs_topic_check (migration 20261118000300_vibe_core),
-- together with social. Do not redefine that constraint here: an earlier version of this file dropped 'social',
-- which broke joining Tukachap (test 1100) and would fail on the live database where social rows exist.
-- Add messages to the global WhatsApp allow-list only.

update public.site_settings
set value = jsonb_set(
  value,
  '{topics}',
  (select to_jsonb(array(select distinct x from unnest(
    coalesce(array(select jsonb_array_elements_text(value->'topics')), '{}'::text[]) || array['messages']
  ) x order by x)))
)
where key = 'whatsapp.notifications';

-- Existing WhatsApp delivery infrastructure is reused, but Drop alerts require explicit
-- Drop-specific opt-in and a verified phone. Alert text is supplied by the notification
-- producer and must never contain the Drop or reply contents.
create or replace function public.whatsapp_enqueue() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  cfg jsonb := (select value from public.site_settings where key = 'whatsapp.notifications');
  ph text;
  verified timestamptz;
begin
  if not (cfg->'topics') ? new.topic then return new; end if;

  if new.topic = 'messages' then
    if not exists (
      select 1 from public.vibe_drop_settings s
      where s.user_id = new.user_id and s.whatsapp_enabled = true and s.whatsapp_consent_at is not null
    ) then return new; end if;
    select p.phone, p.phone_verified_at into ph, verified
      from public.profiles p where p.id = new.user_id and p.status = 'active';
    if ph is null or verified is null then return new; end if;
  else
    if exists (select 1 from public.notification_prefs
      where user_id = new.user_id and topic = new.topic and channel = 'whatsapp' and not enabled) then
      return new;
    end if;
    select coalesce(p.phone, (
      select coalesce(g.whatsapp, g.phone) from public.growth_clients g
      where g.owner_id = new.user_id order by g.created_at desc limit 1
    )) into ph from public.profiles p where p.id = new.user_id;
  end if;

  if ph is null then return new; end if;
  insert into public.whatsapp_outbox (user_id, phone, topic, title, body, link)
  values (new.user_id, ph, new.topic, new.title, new.body, new.link);
  return new;
end $$;
