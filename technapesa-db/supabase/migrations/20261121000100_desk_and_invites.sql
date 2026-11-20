-- =============================================================================================
-- 1) TnP Desk (owner, 20 Nov 2026): the official account @tnpdesk keeps the county spaces alive with real, useful posts:
--    open opportunities from the checked board and a weekly county question. At most 2 posts a day per space,
--    at least 4 hours apart, 7am to 8pm. Never posts as anyone else.
-- 2) Invites board (owner, 20 Nov 2026): KSh 10 for each person a member brings who becomes active (posts, votes or
--    comments). Staff see sign ups, active invites and what is owed, and record each payout once.
-- =============================================================================================

insert into public.site_settings (key, value, is_public) values
  ('vibe.desk', '{"user_id": null, "per_day": 2}', false),
  ('referral.cash', '{"kes_per_active": 10}', false)
on conflict (key) do nothing;

create table public.vibe_desk_log (
  community_id bigint not null references public.vibe_communities(id) on delete cascade,
  ref text not null,
  post_id bigint references public.vibe_posts(id) on delete set null,
  posted_at timestamptz not null default now(),
  primary key (community_id, ref)
);
alter table public.vibe_desk_log enable row level security;
grant all on public.vibe_desk_log to service_role;

-- Called once by the agent after it creates the desk login: profile, Verified badge, and the featured county spaces.
create or replace function public.vibe_desk_setup(p_user uuid) returns jsonb
language plpgsql security definer set search_path = public as $$
declare c record; sid bigint; n int := 0;
begin
  insert into public.vibe_profiles (user_id, username, headline, bio, location, adult_confirmed_at, verified_at, verified_note, who_can_message)
  values (p_user, 'tnpdesk', 'Official TECH na PESA account', 'Opportunities, local news and questions for your county. Run by the TECH na PESA team.', 'Kenya', now(), now(), 'Official TECH na PESA account', 'followers')
  on conflict (user_id) do update set verified_at = coalesce(vibe_profiles.verified_at, now()), verified_note = 'Official TECH na PESA account';
  update public.profiles set full_name = 'TnP Desk', display_name = 'TnP Desk' where id = p_user;
  for c in select co.* from jsonb_array_elements_text(coalesce((select value from public.site_settings where key = 'vibe.featured_counties'), '[]'::jsonb)) f(slug)
           join public.counties co on co.slug = f.slug loop
    select id into sid from public.vibe_communities where county_id = c.id;
    if sid is null then
      insert into public.vibe_communities (slug, name, description, category, rules, visibility, created_by, county_id)
      values ('county-' || c.slug, c.name || ' County', 'News, opportunities, businesses, events and people of ' || c.name || ' County. Ask, share and help each other.',
        'local', 'Be kind and truthful. No scams, no hate, no politics of insults. Never ask anyone to pay to get a job.', 'public', p_user, c.id)
      returning id into sid;
    end if;
    insert into public.vibe_community_members (community_id, user_id, role, status) values (sid, p_user, 'admin', 'active')
    on conflict (community_id, user_id) do update set role = 'admin', status = 'active';
    n := n + 1;
  end loop;
  update public.site_settings set value = value || jsonb_build_object('user_id', p_user), updated_at = now() where key = 'vibe.desk';
  return jsonb_build_object('spaces', n);
end $$;

-- One run: each featured county space gets its next post if it is due. Returns how many posts went out.
create or replace function public.vibe_desk_tick() returns jsonb
language plpgsql security definer set search_path = public as $$
declare desk uuid := nullif((select value ->> 'user_id' from public.site_settings where key = 'vibe.desk'), '')::uuid;
  per_day int := coalesce((select (value ->> 'per_day')::int from public.site_settings where key = 'vibe.desk'), 2);
  h int := extract(hour from now() at time zone 'Africa/Nairobi');
  today date := (now() at time zone 'Africa/Nairobi')::date;
  wk text := to_char(now() at time zone 'Africa/Nairobi', 'IYYY-IW');
  s record; o record; body text; ref text; pid bigint; sent int := 0;
  qs text[] := array[
    'What is one thing %s County should fix first this year, and why?',
    'Which business in %s County gives the best service? Name it and say what they do well.',
    'Where can young people in %s County find work or training right now? Share what you know.',
    'Which road in %s County needs repair most urgently?',
    'Who is a quiet hero in %s County that more people should know about?',
    'What should every new resident of %s County know?'];
begin
  if desk is null or h < 7 or h >= 20 then return jsonb_build_object('sent', 0, 'why', 'not set up or outside 7am to 8pm'); end if;
  for s in select vc.id, co.name from public.vibe_communities vc join public.counties co on co.id = vc.county_id
           where vc.county_id is not null and exists (select 1 from public.vibe_community_members m where m.community_id = vc.id and m.user_id = desk and m.status = 'active') loop
    if (select count(*) from public.vibe_desk_log l where l.community_id = s.id and (l.posted_at at time zone 'Africa/Nairobi')::date = today) >= per_day then continue; end if;
    if exists (select 1 from public.vibe_desk_log l where l.community_id = s.id and l.posted_at > now() - interval '4 hours') then continue; end if;
    body := null; ref := null;
    -- the weekly county question goes first each week
    if not exists (select 1 from public.vibe_desk_log l where l.community_id = s.id and l.ref = 'q:' || wk) then
      ref := 'q:' || wk;
      body := 'QUESTION OF THE WEEK' || E'\n\n' || format(qs[1 + (extract(week from now())::int % array_length(qs, 1))], s.name);
    else
      select * into o from public.opportunities op
       where op.status = 'published' and (op.deadline is null or op.deadline >= today)
         and not exists (select 1 from public.vibe_desk_log l where l.community_id = s.id and l.ref = 'o:' || op.slug)
       order by (op.location ilike '%' || s.name || '%') desc, op.deadline nulls last, op.published_at desc nulls last limit 1;
      if o.id is not null then
        ref := 'o:' || o.slug;
        body := 'OPPORTUNITY: ' || upper(o.title) || E'\n\n' || o.organisation || coalesce(' · ' || o.location, '')
          || coalesce(E'\nCloses ' || to_char(o.deadline, 'FMDD Mon YYYY'), '') || E'\n\n' || o.summary
          || E'\n\nChecked by TECH na PESA. Details and how to apply: https://technapesa.co.ke/o/' || o.slug
          || E'\n\nNever pay anyone to get a job.';
      end if;
    end if;
    if body is null then continue; end if;
    insert into public.vibe_posts (author_id, kind, body, media, community_id) values (desk, 'post', left(body, 3000), '{}', s.id) returning id into pid;
    insert into public.vibe_desk_log (community_id, ref, post_id) values (s.id, ref, pid);
    sent := sent + 1;
  end loop;
  return jsonb_build_object('sent', sent);
end $$;

-- ---------------------------------------------------------------------------------------------
-- Invites board
-- ---------------------------------------------------------------------------------------------
create table public.referral_cash_payouts (
  id bigint generated always as identity primary key,
  referrer uuid not null references auth.users(id) on delete restrict,
  active_count integer not null check (active_count > 0),
  amount_kes integer not null check (amount_kes > 0),
  note text check (note is null or char_length(note) <= 200),
  paid_by uuid not null references auth.users(id),
  paid_at timestamptz not null default now()
);
alter table public.referral_cash_payouts enable row level security;
grant all on public.referral_cash_payouts to service_role;

-- A referred member is active once they have done something real (any points other than referral, redeemed, adjustment).
create or replace function public.admin_invites() returns jsonb language plpgsql stable security definer set search_path = public as $$
declare rate int := coalesce((select (value ->> 'kes_per_active')::int from public.site_settings where key = 'referral.cash'), 10);
begin
  if not public.has_permission('payments.view') then raise exception 'not allowed'; end if;
  return jsonb_build_object('kes_per_active', rate, 'rows', coalesce((select jsonb_agg(x order by (x ->> 'owed_kes')::int desc, (x ->> 'signups')::int desc) from (
    select jsonb_build_object('user', r.referred_by, 'name', coalesce(p.full_name, p.display_name, 'Member'),
      'username', (select username from public.vibe_profiles where user_id = r.referred_by), 'phone', p.phone,
      'signups', count(*), 'active', count(*) filter (where r.active),
      'paid_for', coalesce((select sum(active_count) from public.referral_cash_payouts c where c.referrer = r.referred_by), 0),
      'owed_kes', greatest(0, (count(*) filter (where r.active) - coalesce((select sum(active_count) from public.referral_cash_payouts c where c.referrer = r.referred_by), 0)) * rate)) x
    from (select q.referred_by, exists (select 1 from public.point_events e where e.user_id = q.id and e.kind not in ('referral', 'redeemed', 'adjustment')) active
          from public.profiles q where q.referred_by is not null) r
    join public.profiles p on p.id = r.referred_by group by r.referred_by, p.full_name, p.display_name, p.phone) y), '[]'::jsonb));
end $$;

create or replace function public.admin_invite_paid(p_user uuid, p_note text default null) returns jsonb
language plpgsql security definer set search_path = public as $$
declare rate int := coalesce((select (value ->> 'kes_per_active')::int from public.site_settings where key = 'referral.cash'), 10); act int; paid int; due int; pid bigint;
begin
  if not public.has_permission('payments.view') then raise exception 'not allowed'; end if;
  select count(*) into act from public.profiles q where q.referred_by = p_user
    and exists (select 1 from public.point_events e where e.user_id = q.id and e.kind not in ('referral', 'redeemed', 'adjustment'));
  select coalesce(sum(active_count), 0) into paid from public.referral_cash_payouts where referrer = p_user;
  due := act - paid;
  if due <= 0 then raise exception 'nothing is owed to this member'; end if;
  insert into public.referral_cash_payouts (referrer, active_count, amount_kes, note, paid_by) values (p_user, due, due * rate, nullif(trim(coalesce(p_note, '')), ''), auth.uid()) returning id into pid;
  perform public.log_action('referral.cash_paid', 'referral_cash_payout', pid::text, null, jsonb_build_object('active', due, 'kes', due * rate), p_note);
  perform public.notify(p_user, 'account', 'KSh ' || (due * rate) || ' sent for the friends you brought', 'Thank you for growing TnPVibe. ' || due || ' active invite' || case when due = 1 then '' else 's' end || ' paid.', '/vibe/');
  return jsonb_build_object('paid_for', due, 'kes', due * rate);
end $$;

revoke execute on function public.vibe_desk_setup(uuid), public.vibe_desk_tick(), public.admin_invites(), public.admin_invite_paid(uuid, text) from public, anon, authenticated;
grant execute on function public.admin_invites(), public.admin_invite_paid(uuid, text) to authenticated;
grant execute on all functions in schema public to service_role;
