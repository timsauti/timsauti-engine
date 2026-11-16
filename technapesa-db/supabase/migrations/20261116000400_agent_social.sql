-- =============================================================================================
-- TECH na PESA milestone 4: connection to the existing social media agent, and sharing site content
-- to the owner's Facebook Pages to bring visitors to the site.
-- The agent runs on GitHub (timsauti-engine, tnp-agent.yml). It reads queued jobs with the service key,
-- writes draft posts for staff to check, and records every request, result and error in agent_jobs.
-- It never publishes to a client's Page: that needs Meta approval first, so those jobs stay manual.
-- =============================================================================================

-- Listing owners choose whether TECH na PESA may feature their listing on its social media.
alter table public.businesses add column share_ok boolean not null default false;

create or replace function public.business_set_share(p_id uuid, p_ok boolean) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not public.can_edit_business(p_id) then raise exception 'not allowed'; end if;
  update public.businesses set share_ok = p_ok where id = p_id;
  perform public.log_action(case when p_ok then 'business.share_allowed' else 'business.share_withdrawn' end, 'business', p_id::text, null, null);
end $$;

-- Every post the agent makes (or plans) on the owner's Pages from site content.
create table public.social_shares (
  id bigint generated always as identity primary key,
  kind text not null check (kind in ('listing', 'promo', 'article')),
  ref text not null,                      -- business id, promo key or article slug
  page_key text not null,                 -- techpulse, makasa, timsauti or sauti (the agent's own names)
  link text not null check (link ~ '^https://'),
  caption text not null default '',
  status text not null default 'planned' check (status in ('planned', 'posted', 'failed', 'skipped')),
  fb_post_id text,
  error text,
  planned_for timestamptz not null default now(),
  posted_at timestamptz,
  created_at timestamptz not null default now()
);
create index social_shares_status on public.social_shares (status, planned_for);
create unique index social_shares_once on public.social_shares (kind, ref, page_key) where kind = 'listing' and status in ('planned', 'posted');

insert into public.site_settings (key, value, is_public) values
  ('social.share_mode', '"off"', false),              -- off: nothing is posted; auto: the agent posts within the limits below (owner switches it on)
  ('social.share_pages', '["techpulse"]', false),    -- which of the owner's Pages carry site content
  ('social.shares_per_day', '2', false)
on conflict (key) do nothing;

create or replace function public.admin_share_skip(p_id bigint, p_note text default null) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not (public.has_permission('content.manage') or public.has_permission('business.manage')) then raise exception 'not allowed'; end if;
  update public.social_shares set status = 'skipped', error = left(coalesce(p_note, 'skipped by staff'), 300) where id = p_id and status = 'planned';
  if not found then raise exception 'only a planned share can be skipped'; end if;
  perform public.log_action('social.share_skipped', 'social_share', p_id::text, null, null, p_note);
end $$;

-- Agent connection. 'agent_pull' means the agent collects queued jobs itself every hour.
-- Publishing approved posts to a client's Page stays manual until Meta approves TECH na PESA as a Tech Provider.
create or replace function public.agent_enqueue(p_client uuid, p_kind text, p_payload jsonb) returns bigint
language plpgsql security definer set search_path = public as $$
declare v bigint; connected boolean := coalesce((select value #>> '{}' from public.site_settings where key = 'growth.agent_integration'), '') = 'agent_pull';
  st text := case when connected and p_kind <> 'publish_approved' then 'queued' else 'awaiting_configuration' end;
begin
  insert into public.agent_jobs (client_id, kind, payload, status) values (p_client, p_kind, p_payload, st) returning id into v;
  if p_kind <> 'publish_approved' then update public.growth_clients set agent_status = st where id = p_client; end if;
  return v;
end $$;

-- Staff ask the agent for more draft posts for a client.
create or replace function public.admin_agent_request(p_client uuid, p_count int, p_note text default null) returns bigint
language plpgsql security definer set search_path = public as $$
declare v bigint;
begin
  if not public.has_permission('growth.manage') then raise exception 'not allowed'; end if;
  if p_count not between 1 and 10 then raise exception 'ask for 1 to 10 drafts at a time'; end if;
  if not exists (select 1 from public.growth_clients where id = p_client and status in ('approved', 'trial_active', 'subscribed')) then
    raise exception 'drafts can be requested for approved, trial or subscribed clients'; end if;
  v := public.agent_enqueue(p_client, 'content_request', public.growth_brief(p_client) || jsonb_build_object('count', p_count, 'instructions', left(coalesce(p_note, ''), 600)));
  perform public.log_action('agent.content_requested', 'growth_client', p_client::text, null, jsonb_build_object('count', p_count), p_note);
  return v;
end $$;

-- A trial start asks the agent for the first drafts straight away (the trial package's post count, capped at 6 per batch).
create or replace function public.agent_first_batch() returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.status = 'trial_active' and old.status = 'approved' then
    perform public.agent_enqueue(new.id, 'content_request', public.growth_brief(new.id) ||
      jsonb_build_object('count', least(6, coalesce((select posts_per_period from public.growth_packages where key = 'trial'), 6)), 'instructions', 'First posts of the free trial'));
  end if;
  return new;
end $$;
create trigger agent_first_batch after update of status on public.growth_clients for each row execute function public.agent_first_batch();

-- RLS and grants
alter table public.social_shares enable row level security;
create policy "shares for staff" on public.social_shares for select using (public.has_permission('content.manage') or public.has_permission('business.manage'));
revoke all on public.social_shares from anon, authenticated;
grant all on public.social_shares to service_role;
grant select on public.social_shares to authenticated;
revoke execute on function public.business_set_share(uuid, boolean), public.admin_share_skip(bigint, text), public.admin_agent_request(uuid, int, text),
  public.agent_enqueue(uuid, text, jsonb), public.agent_first_batch() from public, anon, authenticated;
grant execute on function public.business_set_share(uuid, boolean), public.admin_share_skip(bigint, text), public.admin_agent_request(uuid, int, text) to authenticated;
grant execute on all functions in schema public to service_role;

-- The agent connection goes live with this migration (the engine job tnp-agent.yml is deployed with it).
update public.site_settings set value = '"agent_pull"', updated_at = now() where key = 'growth.agent_integration';
