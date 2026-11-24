-- Tukachap Drop: additive schema only. This migration is intentionally not applied to any database.
-- Public visitors cannot read or write these tables directly; submissions go through a server-side Edge Function.

create table public.vibe_drop_settings (
  user_id uuid primary key references public.vibe_profiles(user_id) on delete cascade,
  enabled boolean not null default true,
  allow_anonymous boolean not null default true,
  allow_identified boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.vibe_drops (
  id uuid primary key default gen_random_uuid(),
  recipient_id uuid not null references public.vibe_profiles(user_id) on delete cascade,
  sender_user_id uuid references auth.users(id) on delete set null,
  sender_mode text not null check (sender_mode in ('anonymous', 'identified')),
  message text not null check (char_length(trim(message)) between 1 and 2000),
  status text not null default 'unread' check (status in ('unread', 'read', 'reported', 'deleted')),
  created_at timestamptz not null default now(),
  read_at timestamptz,
  deleted_at timestamptz,
  constraint vibe_drops_identified_sender check (
    (sender_mode = 'anonymous' and sender_user_id is null)
    or (sender_mode = 'identified' and sender_user_id is not null)
  )
);

create index vibe_drops_recipient_inbox
  on public.vibe_drops (recipient_id, created_at desc)
  where status <> 'deleted';

create table public.vibe_drop_rate_limits (
  fingerprint_hash text not null,
  window_started_at timestamptz not null,
  submissions integer not null default 0 check (submissions >= 0),
  primary key (fingerprint_hash, window_started_at)
);

alter table public.vibe_drop_settings enable row level security;
alter table public.vibe_drops enable row level security;
alter table public.vibe_drop_rate_limits enable row level security;

-- No direct anonymous access. The Edge Function uses its server-side service role.
revoke all on public.vibe_drop_settings, public.vibe_drops, public.vibe_drop_rate_limits from anon, authenticated;
grant select, insert, update, delete on public.vibe_drop_settings, public.vibe_drops, public.vibe_drop_rate_limits to service_role;

-- Members may read their own settings and update only the settings columns granted below.
grant select on public.vibe_drop_settings to authenticated;
grant update (enabled, allow_anonymous, allow_identified, updated_at) on public.vibe_drop_settings to authenticated;
create policy "members read own drop settings"
  on public.vibe_drop_settings for select to authenticated
  using (user_id = auth.uid());
create policy "members update own drop settings"
  on public.vibe_drop_settings for update to authenticated
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

-- Recipients can read and manage only their own inbox. They cannot insert or rewrite message content.
grant select on public.vibe_drops to authenticated;
grant update (status, read_at, deleted_at) on public.vibe_drops to authenticated;
create policy "recipients read own drops"
  on public.vibe_drops for select to authenticated
  using (recipient_id = auth.uid());
create policy "recipients manage own drops"
  on public.vibe_drops for update to authenticated
  using (recipient_id = auth.uid())
  with check (recipient_id = auth.uid());

-- No client role receives access to the rate-limit table.


-- Settings are created/updated through this authenticated, owner-scoped function.
create or replace function public.vibe_drop_settings_save(p jsonb) returns void
language plpgsql security definer set search_path = public as $$
declare me uuid := public.vibe_need_me();
begin
  insert into public.vibe_drop_settings (user_id, enabled, allow_anonymous, allow_identified, updated_at)
  values (
    me,
    coalesce((p->>'enabled')::boolean, true),
    coalesce((p->>'allow_anonymous')::boolean, true),
    coalesce((p->>'allow_identified')::boolean, true),
    now()
  )
  on conflict (user_id) do update set
    enabled = coalesce((p->>'enabled')::boolean, public.vibe_drop_settings.enabled),
    allow_anonymous = coalesce((p->>'allow_anonymous')::boolean, public.vibe_drop_settings.allow_anonymous),
    allow_identified = coalesce((p->>'allow_identified')::boolean, public.vibe_drop_settings.allow_identified),
    updated_at = now();
end $$;

revoke all on function public.vibe_drop_settings_save(jsonb) from public, anon;
grant execute on function public.vibe_drop_settings_save(jsonb) to authenticated;


-- Atomic server-only rate-limit check. The endpoint supplies a keyed digest, never a raw IP.
create or replace function public.vibe_drop_rate_check(p_fingerprint text, p_window timestamptz, p_limit integer default 5)
returns boolean
language plpgsql security definer set search_path = public as $$
declare accepted boolean;
begin
  if p_fingerprint !~ '^[a-f0-9]{64}$' or p_limit < 1 or p_limit > 20 then
    return false;
  end if;
  insert into public.vibe_drop_rate_limits (fingerprint_hash, window_started_at, submissions)
  values (p_fingerprint, p_window, 1)
  on conflict (fingerprint_hash, window_started_at) do update
    set submissions = public.vibe_drop_rate_limits.submissions + 1
    where public.vibe_drop_rate_limits.submissions < p_limit
  returning true into accepted;
  return coalesce(accepted, false);
end $$;

revoke all on function public.vibe_drop_rate_check(text, timestamptz, integer) from public, anon, authenticated;
grant execute on function public.vibe_drop_rate_check(text, timestamptz, integer) to service_role;
