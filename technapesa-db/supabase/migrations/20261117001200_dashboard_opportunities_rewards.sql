-- Owner, 17 Nov 2026: owner dashboard, verified opportunities board, community rewards (points, referrals, airtime).

-- ===================== Owner dashboard =====================
create or replace function public.admin_owner_dashboard() returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare r jsonb; m timestamptz := date_trunc('month', now() at time zone 'Africa/Nairobi') at time zone 'Africa/Nairobi';
begin
  if not (public.has_permission('users.view') and public.has_permission('settings.manage')) then raise exception 'not allowed'; end if;
  select jsonb_build_object(
    'accounts', (select count(*) from public.profiles where status <> 'deleted'),
    'accounts_7d', (select count(*) from public.profiles where created_at > now() - interval '7 days'),
    'accounts_today', (select count(*) from public.profiles where created_at > date_trunc('day', now() at time zone 'Africa/Nairobi') at time zone 'Africa/Nairobi'),
    'revenue_month', (select coalesce(sum(amount_kes), 0) from public.payments where status = 'success' and paid_at >= m),
    'revenue_total', (select coalesce(sum(amount_kes), 0) from public.payments where status = 'success'),
    'payments_month', (select count(*) from public.payments where status = 'success' and paid_at >= m),
    'payments_pending', (select count(*) from public.payments where status = 'pending' and created_at > now() - interval '3 days'),
    'applications', (select count(*) from public.growth_clients where status = 'applied'),
    'approved_waiting', (select count(*) from public.growth_clients where status = 'approved'),
    'trials', (select count(*) from public.growth_clients where status in ('trial_active', 'trial_paused')),
    'trials_ended', (select count(*) from public.growth_clients where status = 'trial_ended'),
    'subscribed', (select count(*) from public.growth_clients where status = 'subscribed'),
    'lapsed', (select count(*) from public.growth_clients where status = 'lapsed'),
    'calls_pending', (select count(*) from public.growth_clients where call_requested_at is not null and call_done_at is null),
    'requests_new', (select count(*) from public.service_requests where status = 'new'),
    'businesses', (select count(*) from public.businesses where status = 'published'),
    'businesses_pending', (select count(*) from public.businesses where status = 'pending'),
    'stories', (select count(*) from public.stories where status = 'published'),
    'stories_pending', (select count(*) from public.stories where status = 'pending'),
    'challenge_entries', (select count(*) from public.stories s join public.challenges c on c.id = s.challenge_id where s.status = 'published' and now() between c.opens_at and c.voting_close_at),
    'challenge_votes', (select count(*) from public.challenge_votes v join public.challenges c on c.id = v.challenge_id where now() between c.opens_at and c.voting_close_at),
    'articles', (select count(*) from public.articles where status = 'published'),
    'article_views', (select coalesce(sum(views), 0) from public.articles),
    'opportunities', (select count(*) from public.opportunities where status = 'published'),
    'opportunities_pending', (select count(*) from public.opportunities where status = 'pending'),
    'subscribers', (select count(*) from public.newsletter_subscribers where status = 'active'),
    'page_posts_7d', (select count(*) from public.social_shares where status = 'posted' and posted_at > now() - interval '7 days'),
    'page_posts_failed_7d', (select count(*) from public.social_shares where status = 'failed' and created_at > now() - interval '7 days'),
    'agent_jobs_waiting', (select count(*) from public.agent_jobs where status in ('awaiting_configuration', 'queued', 'failed')),
    'redemptions_pending', (select count(*) from public.reward_redemptions where status = 'requested'),
    'signups_14d', (select jsonb_agg(jsonb_build_object('day', d::date, 'n', (select count(*) from public.profiles p where (p.created_at at time zone 'Africa/Nairobi')::date = d::date)) order by d)
                    from generate_series((now() at time zone 'Africa/Nairobi')::date - 13, (now() at time zone 'Africa/Nairobi')::date, interval '1 day') d),
    'revenue_6m', (select jsonb_agg(jsonb_build_object('month', to_char(mm, 'Mon'), 'kes', (select coalesce(sum(amount_kes), 0) from public.payments p where p.status = 'success' and date_trunc('month', p.paid_at at time zone 'Africa/Nairobi') = mm)) order by mm)
                    from generate_series(date_trunc('month', now() at time zone 'Africa/Nairobi') - interval '5 months', date_trunc('month', now() at time zone 'Africa/Nairobi'), interval '1 month') mm),
    'recent', (select jsonb_agg(x) from (select action, entity, note, at from public.audit_log order by at desc limit 12) x)
  ) into r;
  return r;
end $$;

-- ===================== Opportunities (verified before publishing) =====================
create table public.opportunities (
  id uuid primary key default gen_random_uuid(),
  slug text not null unique check (slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$' and char_length(slug) between 3 and 100),
  kind text not null check (kind in ('job', 'internship', 'tender', 'scholarship', 'training', 'grant', 'event')),
  title text not null check (char_length(title) between 5 and 160),
  organisation text not null check (char_length(organisation) between 2 and 120),
  location text check (location is null or char_length(location) <= 120),
  summary text not null check (char_length(summary) between 20 and 400),
  details text check (details is null or char_length(details) <= 6000),
  how_to_apply text check (how_to_apply is null or char_length(how_to_apply) <= 1500),
  apply_url text check (apply_url is null or apply_url ~ '^https://'),
  deadline date,
  source_name text check (source_name is null or char_length(source_name) <= 80),
  source_url text check (source_url is null or source_url ~ '^https://'),
  sponsored_by text check (sponsored_by is null or char_length(sponsored_by) <= 80),
  status text not null default 'pending' check (status in ('pending', 'published', 'rejected', 'expired')),
  status_reason text check (status_reason is null or char_length(status_reason) <= 300),
  origin text not null default 'staff' check (origin in ('staff', 'user', 'agent')),
  submitted_by uuid references auth.users(id),
  verified_by uuid references auth.users(id),
  verified_at timestamptz,
  published_at timestamptz,
  created_at timestamptz not null default now()
);
create index opportunities_public on public.opportunities (status, deadline);
alter table public.opportunities enable row level security;
create policy "public reads live opportunities" on public.opportunities for select
  using ((status = 'published' and (deadline is null or deadline >= (now() at time zone 'Africa/Nairobi')::date)) or public.has_permission('content.manage') or submitted_by = auth.uid());
grant select on public.opportunities to anon, authenticated;
grant all on public.opportunities to service_role;

create or replace function public.opportunity_save(p jsonb, p_id uuid default null) returns uuid
language plpgsql security definer set search_path = public as $$
declare v uuid := p_id; staff boolean := public.has_permission('content.manage'); s text;
begin
  if auth.uid() is null then raise exception 'please sign in'; end if;
  if not staff then
    if p_id is not null then raise exception 'not allowed'; end if;
    if (select count(*) from public.opportunities where submitted_by = auth.uid() and created_at > now() - interval '1 day') >= 5 then raise exception 'you can share up to five opportunities a day'; end if;
  end if;
  if nullif(p->>'deadline', '') is not null and (p->>'deadline')::date < (now() at time zone 'Africa/Nairobi')::date then raise exception 'the deadline has already passed'; end if;
  if v is null then
    s := trim(both '-' from left(regexp_replace(lower(coalesce(p->>'title', '')), '[^a-z0-9]+', '-', 'g'), 80));
    if exists (select 1 from public.opportunities where slug = s) then s := s || '-' || substr(md5(random()::text), 1, 5); end if;
    insert into public.opportunities (slug, kind, title, organisation, location, summary, details, how_to_apply, apply_url, deadline, source_name, source_url, sponsored_by, origin, submitted_by)
    values (s, p->>'kind', trim(p->>'title'), trim(p->>'organisation'), nullif(trim(coalesce(p->>'location', '')), ''), trim(p->>'summary'), nullif(trim(coalesce(p->>'details', '')), ''),
      nullif(trim(coalesce(p->>'how_to_apply', '')), ''), nullif(trim(coalesce(p->>'apply_url', '')), ''), nullif(p->>'deadline', '')::date,
      nullif(trim(coalesce(p->>'source_name', '')), ''), nullif(trim(coalesce(p->>'source_url', '')), ''), case when staff then nullif(trim(coalesce(p->>'sponsored_by', '')), '') end,
      case when staff then 'staff' else 'user' end, auth.uid()) returning id into v;
    if not staff then perform public.staff_alert('opportunity', null, 'New opportunity shared for checking: ' || left(p->>'title', 120) || '. Admin, Articles and promotions.'); end if;
  else
    update public.opportunities set kind = p->>'kind', title = trim(p->>'title'), organisation = trim(p->>'organisation'), location = nullif(trim(coalesce(p->>'location', '')), ''),
      summary = trim(p->>'summary'), details = nullif(trim(coalesce(p->>'details', '')), ''), how_to_apply = nullif(trim(coalesce(p->>'how_to_apply', '')), ''),
      apply_url = nullif(trim(coalesce(p->>'apply_url', '')), ''), deadline = nullif(p->>'deadline', '')::date, source_name = nullif(trim(coalesce(p->>'source_name', '')), ''),
      source_url = nullif(trim(coalesce(p->>'source_url', '')), ''), sponsored_by = nullif(trim(coalesce(p->>'sponsored_by', '')), '') where id = v;
  end if;
  return v;
end $$;

create or replace function public.admin_opportunity_decide(p_id uuid, p_decision text, p_note text default null) returns void
language plpgsql security definer set search_path = public as $$
declare o public.opportunities;
begin
  if not public.has_permission('content.manage') then raise exception 'not allowed'; end if;
  select * into o from public.opportunities where id = p_id; if not found then raise exception 'unknown opportunity'; end if;
  if p_decision = 'publish' then
    if o.apply_url is null and o.how_to_apply is null then raise exception 'add how to apply or an application link before publishing'; end if;
    update public.opportunities set status = 'published', verified_by = auth.uid(), verified_at = now(), published_at = coalesce(published_at, now()), status_reason = null where id = p_id;
    if o.submitted_by is not null and o.origin = 'user' then perform public.reward_points(o.submitted_by, 'opportunity_shared', p_id::text, 15); end if;
  elsif p_decision = 'reject' then
    update public.opportunities set status = 'rejected', status_reason = left(p_note, 300) where id = p_id;
  elsif p_decision = 'unpublish' then
    update public.opportunities set status = 'pending' where id = p_id;
  else raise exception 'use publish, reject or unpublish'; end if;
  perform public.log_action('opportunity.' || p_decision, 'opportunity', p_id::text, to_jsonb(o.status), null, p_note);
end $$;

-- ===================== Community rewards =====================
alter table public.profiles add column referral_code text unique, add column referred_by uuid references auth.users(id);
insert into public.site_settings (key, value, is_public) values
  ('rewards.points', '{"story_published": 20, "challenge_entry": 15, "challenge_win": 100, "vote": 2, "comment": 3, "referral": 25, "opportunity_shared": 15}', true),
  ('rewards.redeem', '{"on": true, "min_points": 200, "kes_per_100_points": 50}', true)
on conflict (key) do nothing;

create table public.point_events (
  id bigint generated always as identity primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  kind text not null check (kind in ('story_published', 'challenge_entry', 'challenge_win', 'vote', 'comment', 'referral', 'opportunity_shared', 'redeemed', 'adjustment')),
  ref text not null,
  points integer not null,
  created_at timestamptz not null default now(),
  unique (user_id, kind, ref)
);
create index point_events_user on public.point_events (user_id, created_at desc);
alter table public.point_events enable row level security;
create policy "own points" on public.point_events for select using (user_id = auth.uid() or public.has_permission('users.view'));
grant select on public.point_events to authenticated;
grant all on public.point_events to service_role;

create table public.reward_redemptions (
  id bigint generated always as identity primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  points integer not null check (points > 0),
  airtime_kes integer not null check (airtime_kes > 0),
  phone text not null check (phone ~ '^\+254[17][0-9]{8}$'),
  status text not null default 'requested' check (status in ('requested', 'sent', 'declined')),
  note text,
  created_at timestamptz not null default now(),
  handled_at timestamptz
);
alter table public.reward_redemptions enable row level security;
create policy "own or staff redemptions" on public.reward_redemptions for select using (user_id = auth.uid() or public.has_permission('users.view'));
grant select on public.reward_redemptions to authenticated;

-- Internal: award points once per (user, kind, ref); daily caps keep voting and commenting honest.
create or replace function public.reward_points(p_user uuid, p_kind text, p_ref text, p_points int default null) returns void
language plpgsql security definer set search_path = public as $$
declare pts int := coalesce(p_points, ((select value from public.site_settings where key = 'rewards.points') ->> p_kind)::int, 0); ref_by uuid;
begin
  if p_user is null or pts = 0 then return; end if;
  if p_kind in ('vote', 'comment') and (select count(*) from public.point_events where user_id = p_user and kind = p_kind and created_at > now() - interval '1 day') >= 10 then return; end if;
  insert into public.point_events (user_id, kind, ref, points) values (p_user, p_kind, p_ref, pts) on conflict do nothing;
  -- the first real activity of a referred member earns their referrer the referral points
  if found and p_kind not in ('referral', 'redeemed', 'adjustment') then
    select referred_by into ref_by from public.profiles where id = p_user;
    if ref_by is not null and ref_by <> p_user then
      insert into public.point_events (user_id, kind, ref, points) values (ref_by, 'referral', p_user::text, coalesce(((select value from public.site_settings where key = 'rewards.points') ->> 'referral')::int, 25)) on conflict do nothing;
    end if;
  end if;
end $$;
revoke execute on function public.reward_points(uuid, text, text, int) from public, anon, authenticated;

create or replace function public.points_on_story() returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.status = 'published' and old.status is distinct from 'published' then
    perform public.reward_points(new.author_id, case when new.challenge_id is null then 'story_published' else 'challenge_entry' end, new.id::text);
  end if;
  if new.featured_label is not null and old.featured_label is distinct from new.featured_label and new.featured_label ilike '%winner%' then
    perform public.reward_points(new.author_id, 'challenge_win', new.id::text);
  end if;
  return new;
end $$;
create trigger stories_points after update of status, featured_label on public.stories for each row execute function public.points_on_story();
create or replace function public.points_on_vote() returns trigger language plpgsql security definer set search_path = public as $$
begin perform public.reward_points(new.user_id, 'vote', new.challenge_id::text); return new; end $$;
create trigger votes_points after insert on public.challenge_votes for each row execute function public.points_on_vote();
create or replace function public.points_on_comment() returns trigger language plpgsql security definer set search_path = public as $$
begin perform public.reward_points(new.user_id, 'comment', new.story_id::text); return new; end $$;
create trigger comments_points after insert on public.story_comments for each row execute function public.points_on_comment();

create or replace function public.points_balance(p_user uuid default auth.uid()) returns integer
language sql stable security definer set search_path = public as $$
  select coalesce(sum(points), 0)::int from public.point_events where user_id = p_user and (p_user = auth.uid() or public.has_permission('users.view'));
$$;

-- Your referral code (created on first request) and claiming one after sign up.
create or replace function public.my_referral_code() returns text
language plpgsql security definer set search_path = public as $$
declare c text;
begin
  if auth.uid() is null then raise exception 'please sign in'; end if;
  select referral_code into c from public.profiles where id = auth.uid();
  if c is null then
    loop
      c := upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 6));
      begin update public.profiles set referral_code = c where id = auth.uid(); exit; exception when unique_violation then end;
    end loop;
  end if;
  return c;
end $$;
create or replace function public.claim_referral(p_code text) returns text
language plpgsql security definer set search_path = public as $$
declare me public.profiles; who uuid;
begin
  select * into me from public.profiles where id = auth.uid();
  if not found then raise exception 'please sign in'; end if;
  if me.referred_by is not null then return 'already'; end if;
  if me.created_at < now() - interval '3 days' then return 'too late'; end if;
  select id into who from public.profiles where referral_code = upper(trim(coalesce(p_code, ''))) and id <> auth.uid();
  if who is null then return 'unknown'; end if;
  update public.profiles set referred_by = who where id = auth.uid();
  return 'ok';
end $$;

-- Monthly leaderboard (public): names as shown on stories.
create or replace function public.points_leaderboard(p_limit int default 10)
returns table (name text, county text, points bigint)
language sql stable security definer set search_path = public as $$
  select public.author_name(e.user_id), co.name, sum(e.points)
  from public.point_events e join public.profiles p on p.id = e.user_id and p.status = 'active' left join public.counties co on co.id = p.county_id
  where e.points > 0 and e.created_at >= date_trunc('month', now() at time zone 'Africa/Nairobi') at time zone 'Africa/Nairobi'
  group by e.user_id, co.name order by 3 desc limit least(greatest(p_limit, 1), 50);
$$;

create or replace function public.reward_redeem(p_points int, p_phone text) returns bigint
language plpgsql security definer set search_path = public as $$
declare cfg jsonb := (select value from public.site_settings where key = 'rewards.redeem'); bal int; ph text := public.clean_phone(p_phone); v bigint;
begin
  if auth.uid() is null then raise exception 'please sign in'; end if;
  if coalesce((cfg->>'on')::boolean, false) is not true then raise exception 'airtime rewards are paused for now'; end if;
  if p_points < (cfg->>'min_points')::int or p_points % 100 <> 0 then raise exception 'redeem at least % points, in hundreds', cfg->>'min_points'; end if;
  if ph is null then raise exception 'enter a Safaricom or Airtel number such as 0712 345 678'; end if;
  if exists (select 1 from public.reward_redemptions where user_id = auth.uid() and status = 'requested') then raise exception 'your last request is still being processed'; end if;
  bal := public.points_balance(auth.uid());
  if bal < p_points then raise exception 'you have % points', bal; end if;
  insert into public.reward_redemptions (user_id, points, airtime_kes, phone) values (auth.uid(), p_points, p_points / 100 * (cfg->>'kes_per_100_points')::int, ph) returning id into v;
  insert into public.point_events (user_id, kind, ref, points) values (auth.uid(), 'redeemed', v::text, -p_points);
  perform public.staff_alert('reward', null, 'Airtime reward requested: KSh ' || (p_points / 100 * (cfg->>'kes_per_100_points')::int) || ' to ' || ph || ' (' || p_points || ' points). Admin, Users, Rewards.');
  return v;
end $$;

create or replace function public.admin_reward_handle(p_id bigint, p_sent boolean, p_note text default null) returns void
language plpgsql security definer set search_path = public as $$
declare r public.reward_redemptions;
begin
  if not public.has_permission('users.manage_status') then raise exception 'not allowed'; end if;
  select * into r from public.reward_redemptions where id = p_id for update;
  if not found or r.status <> 'requested' then raise exception 'nothing to handle'; end if;
  update public.reward_redemptions set status = case when p_sent then 'sent' else 'declined' end, note = left(p_note, 300), handled_at = now() where id = p_id;
  if not p_sent then insert into public.point_events (user_id, kind, ref, points) values (r.user_id, 'adjustment', 'refund-' || p_id, r.points); end if;
  perform public.notify(r.user_id, 'account', case when p_sent then 'Your airtime is on its way' else 'About your airtime request' end,
    case when p_sent then 'KSh ' || r.airtime_kes || ' airtime was sent to your number. Thank you for being part of TECH na PESA.' else coalesce(p_note, 'We could not send it this time; your points are back.') end, '/account/');
  perform public.log_action('reward.' || case when p_sent then 'sent' else 'declined' end, 'reward_redemption', p_id::text, null, null, p_note);
end $$;

revoke execute on function public.admin_owner_dashboard(), public.opportunity_save(jsonb, uuid), public.admin_opportunity_decide(uuid, text, text), public.points_balance(uuid),
  public.my_referral_code(), public.claim_referral(text), public.reward_redeem(int, text), public.admin_reward_handle(bigint, boolean, text) from public, anon;
grant execute on function public.admin_owner_dashboard(), public.opportunity_save(jsonb, uuid), public.admin_opportunity_decide(uuid, text, text), public.points_balance(uuid),
  public.my_referral_code(), public.claim_referral(text), public.reward_redeem(int, text), public.admin_reward_handle(bigint, boolean, text) to authenticated;
grant execute on function public.points_leaderboard(int) to anon, authenticated;

-- Search covers opportunities too.
create or replace function public.site_search_opportunities(p_q text, p_limit int default 6)
returns table (kind text, title text, snippet text, url text, meta text)
language sql stable security definer set search_path = public as $$
  select 'opportunity', o.title, left(o.summary, 160), '/o/' || o.slug, o.organisation
  from public.opportunities o, (select array(select w from unnest(regexp_split_to_array(lower(left(trim(coalesce(p_q, '')), 80)), '\s+')) w where char_length(w) >= 2 limit 5) as words) q
  where o.status = 'published' and (o.deadline is null or o.deadline >= (now() at time zone 'Africa/Nairobi')::date) and cardinality(q.words) > 0
    and (select bool_and(lower(o.title || ' ' || o.organisation || ' ' || o.kind || ' ' || coalesce(o.location, '') || ' ' || o.summary) like '%' || w || '%') from unnest(q.words) w)
  order by o.deadline nulls last limit least(greatest(coalesce(p_limit, 6), 1), 12);
$$;
grant execute on function public.site_search_opportunities(text, int) to anon, authenticated;
