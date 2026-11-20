-- =============================================================================================
-- TnPVibe gifts (owner, 20 Nov 2026: "input the gifting element already, as I work on my Till").
-- A member sends a creator a small gift (Chai, Soda, Lunch...) by paying the TECH na PESA M-PESA Till and entering
-- the M-PESA confirmation code. Staff check the code against the Till statement, then the gift shows and the
-- creator's share is owed to them. Staff pay creators out by M-PESA and record it. Nothing is automatic about money.
-- Gifts stay switched off until the owner sets the Till number and switches them on in site settings.
-- Also: featured county spaces (Machakos, Nairobi, Makueni, Kitui).
-- =============================================================================================

insert into public.site_settings (key, value, is_public) values
  ('vibe.gifts', '{"on": false, "till": null, "creator_share_pct": 80, "items": [
     {"key": "chai", "name": "Chai", "kes": 20}, {"key": "soda", "name": "Soda", "kes": 50}, {"key": "lunch", "name": "Lunch", "kes": 100},
     {"key": "fare", "name": "Fare", "kes": 200}, {"key": "respect", "name": "Big Respect", "kes": 500}]}', true),
  ('vibe.featured_counties', '["machakos", "nairobi", "makueni", "kitui"]', true)
on conflict (key) do nothing;

-- Who accepts gifts, and the M-PESA number their payouts go to. Private to the member and payment staff.
create table public.vibe_gift_settings (
  user_id uuid primary key references public.vibe_profiles(user_id) on delete cascade,
  accepts boolean not null default false,
  payout_phone text check (payout_phone is null or payout_phone ~ '^\+254[17][0-9]{8}$'),
  agreed_at timestamptz,
  updated_at timestamptz not null default now()
);

create table public.vibe_gift_payouts (
  id bigint generated always as identity primary key,
  receiver uuid not null references auth.users(id) on delete restrict,
  amount_kes integer not null check (amount_kes > 0),
  phone text not null,
  mpesa_ref text not null unique,
  paid_by uuid not null references auth.users(id),
  paid_at timestamptz not null default now()
);

create table public.vibe_gifts (
  id bigint generated always as identity primary key,
  giver uuid not null references auth.users(id) on delete restrict,
  receiver uuid not null references auth.users(id) on delete restrict,
  post_id bigint references public.vibe_posts(id) on delete set null,
  item_key text not null,
  item_name text not null,
  amount_kes integer not null check (amount_kes between 10 and 5000),
  creator_kes integer not null check (creator_kes >= 0),
  message text check (message is null or char_length(message) <= 140),
  mpesa_code text not null unique check (mpesa_code ~ '^[A-Z0-9]{10}$'),
  status text not null default 'pending' check (status in ('pending', 'confirmed', 'rejected')),
  staff_note text,
  decided_by uuid references auth.users(id),
  decided_at timestamptz,
  payout_id bigint references public.vibe_gift_payouts(id),
  created_at timestamptz not null default now(),
  check (giver <> receiver)
);
create index vibe_gifts_receiver on public.vibe_gifts (receiver, status, created_at desc);
create index vibe_gifts_giver on public.vibe_gifts (giver, created_at desc);
create index vibe_gifts_pending on public.vibe_gifts (created_at) where status = 'pending';

alter table public.vibe_gift_settings enable row level security;
alter table public.vibe_gift_payouts enable row level security;
alter table public.vibe_gifts enable row level security;
grant all on public.vibe_gift_settings, public.vibe_gift_payouts, public.vibe_gifts to service_role;

create or replace function public.vibe_gifts_config() returns jsonb language sql stable security definer set search_path = public as $$
  select coalesce((select value from public.site_settings where key = 'vibe.gifts'), '{"on": false}'::jsonb);
$$;

-- Can this person receive gifts right now? (Shown as the Gift button on their posts and profile.)
create or replace function public.vibe_gift_open(p_user uuid) returns boolean language sql stable security definer set search_path = public as $$
  select coalesce((public.vibe_gifts_config() ->> 'on')::boolean, false) and (public.vibe_gifts_config() ->> 'till') is not null
    and exists (select 1 from public.vibe_gift_settings s join public.vibe_profiles v on v.user_id = s.user_id
                where s.user_id = p_user and s.accepts and s.payout_phone is not null and v.status = 'active');
$$;

-- Public facts for the gift sheet: the Till, the gift list, and whether this creator accepts gifts.
create or replace function public.vibe_gift_info(p_user uuid) returns jsonb language sql stable security definer set search_path = public as $$
  select jsonb_build_object('open', public.vibe_gift_open(p_user), 'till', c ->> 'till', 'items', coalesce(c -> 'items', '[]'::jsonb),
    'creator_share_pct', coalesce((c ->> 'creator_share_pct')::int, 80), 'name', public.vibe_name(p_user))
  from (select public.vibe_gifts_config() c) x;
$$;

-- The member turns gifts on for themselves and gives the M-PESA number for payouts.
create or replace function public.vibe_gift_settings_save(p_accepts boolean, p_phone text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare me uuid := public.vibe_need_me(); ph text := nullif(regexp_replace(coalesce(p_phone, ''), '\s', '', 'g'), '');
begin
  if ph ~ '^0[17][0-9]{8}$' then ph := '+254' || substr(ph, 2); elsif ph ~ '^254[17][0-9]{8}$' then ph := '+' || ph; end if;
  if p_accepts and (ph is null or ph !~ '^\+254[17][0-9]{8}$') then raise exception 'enter the M-PESA number your gifts should be paid to, like 0712 345 678'; end if;
  insert into public.vibe_gift_settings (user_id, accepts, payout_phone, agreed_at, updated_at)
  values (me, p_accepts, ph, case when p_accepts then now() end, now())
  on conflict (user_id) do update set accepts = excluded.accepts, payout_phone = coalesce(excluded.payout_phone, vibe_gift_settings.payout_phone),
    agreed_at = coalesce(vibe_gift_settings.agreed_at, excluded.agreed_at), updated_at = now();
  return public.vibe_my_gifts();
end $$;

-- A member records a gift they have paid to the Till.
create or replace function public.vibe_gift_send(p_receiver uuid, p_post bigint, p_item text, p_code text, p_message text default null) returns bigint
language plpgsql security definer set search_path = public as $$
declare me uuid := public.vibe_need_me(); c jsonb := public.vibe_gifts_config(); it jsonb; code text := upper(regexp_replace(coalesce(p_code, ''), '\s', '', 'g')); gid bigint;
begin
  if not public.vibe_gift_open(p_receiver) then raise exception 'this member is not receiving gifts right now'; end if;
  if p_receiver = me then raise exception 'you cannot send a gift to yourself'; end if;
  if public.vibe_blocked(me, p_receiver) then raise exception 'not allowed'; end if;
  if p_post is not null and not exists (select 1 from public.vibe_posts where id = p_post and author_id = p_receiver) then raise exception 'that post is not by this member'; end if;
  select x into it from jsonb_array_elements(c -> 'items') x where x ->> 'key' = p_item;
  if it is null then raise exception 'choose a gift'; end if;
  if code !~ '^[A-Z0-9]{10}$' then raise exception 'enter the 10 character M-PESA code from your confirmation SMS, for example SKL2ABC3DE'; end if;
  if exists (select 1 from public.vibe_gifts where mpesa_code = code) then raise exception 'that M-PESA code has already been used for a gift'; end if;
  if (select count(*) from public.vibe_gifts where giver = me and status = 'pending') >= 5 then raise exception 'you have 5 gifts waiting to be checked; please wait for them first'; end if;
  insert into public.vibe_gifts (giver, receiver, post_id, item_key, item_name, amount_kes, creator_kes, message, mpesa_code)
  values (me, p_receiver, p_post, it ->> 'key', it ->> 'name', (it ->> 'kes')::int,
    floor((it ->> 'kes')::int * coalesce((c ->> 'creator_share_pct')::int, 80) / 100.0)::int, nullif(left(trim(coalesce(p_message, '')), 140), ''), code)
  returning id into gid;
  return gid;
end $$;

-- The member's own gift page: settings, money owed to them, gifts received and sent.
create or replace function public.vibe_my_gifts() returns jsonb language sql stable security definer set search_path = public as $$
  with me as (select public.vibe_need_me() id)
  select jsonb_build_object(
    'config', public.vibe_gift_info((select id from me)),
    'accepts', coalesce(s.accepts, false), 'payout_phone', s.payout_phone,
    'earned_kes', coalesce((select sum(creator_kes) from public.vibe_gifts where receiver = (select id from me) and status = 'confirmed'), 0),
    'paid_kes', coalesce((select sum(amount_kes) from public.vibe_gift_payouts where receiver = (select id from me)), 0),
    'received', coalesce((select jsonb_agg(jsonb_build_object('id', g.id, 'from', public.vibe_card(g.giver, (select id from me)), 'item', g.item_name, 'kes', g.creator_kes, 'message', g.message, 'post', g.post_id, 'at', g.decided_at) order by g.decided_at desc)
                 from (select * from public.vibe_gifts where receiver = (select id from me) and status = 'confirmed' order by decided_at desc limit 50) g), '[]'::jsonb),
    'sent', coalesce((select jsonb_agg(jsonb_build_object('id', g.id, 'to', public.vibe_card(g.receiver, (select id from me)), 'item', g.item_name, 'kes', g.amount_kes, 'status', g.status, 'note', g.staff_note, 'at', g.created_at) order by g.created_at desc)
                 from (select * from public.vibe_gifts where giver = (select id from me) order by created_at desc limit 50) g), '[]'::jsonb))
  from me left join public.vibe_gift_settings s on s.user_id = me.id;
$$;

-- Public: the people who supported a creator (confirmed gifts only, no amounts).
create or replace function public.vibe_supporters(p_username text) returns jsonb language sql stable security definer set search_path = public as $$
  with u as (select user_id from public.vibe_profiles where username = lower(p_username))
  select jsonb_build_object('gifts', (select count(*) from public.vibe_gifts where receiver = (select user_id from u) and status = 'confirmed'),
    'open', public.vibe_gift_open((select user_id from u)),
    'top', coalesce((select jsonb_agg(public.vibe_card(t.giver, auth.uid()) || jsonb_build_object('gift_count', t.n) order by t.n desc)
      from (select giver, count(*) n from public.vibe_gifts where receiver = (select user_id from u) and status = 'confirmed'
            and not public.vibe_blocked(giver, coalesce(auth.uid(), giver)) group by giver order by n desc limit 6) t), '[]'::jsonb));
$$;

-- Public: most loved creators this month (by number of confirmed gifts).
create or replace function public.vibe_gift_leaders(p_limit int default 5) returns jsonb language sql stable security definer set search_path = public as $$
  select coalesce(jsonb_agg(public.vibe_card(t.receiver, auth.uid()) || jsonb_build_object('gift_count', t.n) order by t.n desc), '[]'::jsonb)
  from (select receiver, count(*) n from public.vibe_gifts g join public.vibe_profiles v on v.user_id = g.receiver and v.status = 'active'
        where g.status = 'confirmed' and g.decided_at >= date_trunc('month', now() at time zone 'Africa/Nairobi') at time zone 'Africa/Nairobi'
        group by receiver order by n desc limit least(greatest(p_limit, 1), 20)) t;
$$;

-- Staff: gifts waiting for a check against the Till statement.
create or replace function public.admin_vibe_gifts(p_status text default 'pending') returns jsonb language plpgsql stable security definer set search_path = public as $$
begin
  if not public.has_permission('payments.view') then raise exception 'not allowed'; end if;
  return coalesce((select jsonb_agg(jsonb_build_object('id', g.id, 'code', g.mpesa_code, 'kes', g.amount_kes, 'item', g.item_name, 'status', g.status, 'note', g.staff_note,
      'giver', public.vibe_name(g.giver), 'giver_username', (select username from public.vibe_profiles where user_id = g.giver),
      'receiver', public.vibe_name(g.receiver), 'receiver_username', (select username from public.vibe_profiles where user_id = g.receiver), 'at', g.created_at) order by g.created_at)
    from (select * from public.vibe_gifts where status = coalesce(p_status, 'pending') order by created_at desc limit 200) g), '[]'::jsonb);
end $$;

create or replace function public.admin_vibe_gift_decide(p_gift bigint, p_ok boolean, p_note text default null) returns void
language plpgsql security definer set search_path = public as $$
declare g public.vibe_gifts;
begin
  if not public.has_permission('payments.view') then raise exception 'not allowed'; end if;
  select * into g from public.vibe_gifts where id = p_gift for update;
  if g.id is null or g.status <> 'pending' then raise exception 'this gift was already checked'; end if;
  if not p_ok and coalesce(trim(p_note), '') = '' then raise exception 'say why, for the giver (for example: code not found on the Till statement)'; end if;
  update public.vibe_gifts set status = case when p_ok then 'confirmed' else 'rejected' end, staff_note = nullif(trim(coalesce(p_note, '')), ''), decided_by = auth.uid(), decided_at = now() where id = p_gift;
  perform public.log_action(case when p_ok then 'vibe.gift_confirmed' else 'vibe.gift_rejected' end, 'vibe_gift', p_gift::text, null, jsonb_build_object('kes', g.amount_kes, 'code', g.mpesa_code), p_note);
  if p_ok then
    perform public.notify(g.receiver, 'account', public.vibe_name(g.giver) || ' sent you ' || g.item_name, coalesce(g.message, 'A gift for your posts on TnPVibe. KSh ' || g.creator_kes || ' is now in your gifts balance.'), '/vibe/gifts/');
    perform public.notify(g.giver, 'account', 'Your ' || g.item_name || ' reached ' || public.vibe_name(g.receiver), 'Thank you for supporting a creator on TnPVibe.', '/vibe/gifts/');
  else
    perform public.notify(g.giver, 'account', 'We could not confirm your gift', trim(p_note), '/vibe/gifts/');
  end if;
end $$;

-- Staff: creators owed money, with their payout number.
create or replace function public.admin_vibe_gift_balances() returns jsonb language plpgsql stable security definer set search_path = public as $$
begin
  if not public.has_permission('payments.view') then raise exception 'not allowed'; end if;
  return coalesce((select jsonb_agg(x order by (x ->> 'owed_kes')::int desc) from (
    select jsonb_build_object('user', r.receiver, 'name', public.vibe_name(r.receiver), 'username', (select username from public.vibe_profiles where user_id = r.receiver),
      'phone', (select payout_phone from public.vibe_gift_settings where user_id = r.receiver),
      'owed_kes', r.earned - coalesce((select sum(amount_kes) from public.vibe_gift_payouts where receiver = r.receiver), 0)) x
    from (select receiver, sum(creator_kes) earned from public.vibe_gifts where status = 'confirmed' group by receiver) r) y
    where (x ->> 'owed_kes')::int > 0), '[]'::jsonb);
end $$;

create or replace function public.admin_vibe_gift_payout(p_user uuid, p_amount int, p_ref text) returns void
language plpgsql security definer set search_path = public as $$
declare owed int; ph text; pid bigint; ref text := upper(trim(coalesce(p_ref, '')));
begin
  if not (public.has_permission('payments.view') and public.has_permission('payments.refund')) then raise exception 'not allowed'; end if;
  if ref !~ '^[A-Z0-9]{10}$' then raise exception 'enter the M-PESA code of the payout'; end if;
  select coalesce(sum(creator_kes), 0) - coalesce((select sum(amount_kes) from public.vibe_gift_payouts where receiver = p_user), 0) into owed
    from public.vibe_gifts where receiver = p_user and status = 'confirmed';
  if p_amount is null or p_amount <= 0 or p_amount > owed then raise exception 'the amount must be between 1 and KSh %', owed; end if;
  select payout_phone into ph from public.vibe_gift_settings where user_id = p_user;
  if ph is null then raise exception 'this member has no payout number'; end if;
  insert into public.vibe_gift_payouts (receiver, amount_kes, phone, mpesa_ref, paid_by) values (p_user, p_amount, ph, ref, auth.uid()) returning id into pid;
  perform public.log_action('vibe.gift_payout', 'vibe_gift_payout', pid::text, null, jsonb_build_object('kes', p_amount, 'ref', ref), null);
  perform public.notify(p_user, 'account', 'KSh ' || p_amount || ' of your gifts was sent to your M-PESA', 'M-PESA code ' || ref || '. Thank you for creating on TnPVibe.', '/vibe/gifts/');
end $$;

-- Featured county spaces for the Communities page and the home page.
create or replace function public.vibe_featured_counties() returns jsonb language sql stable security definer set search_path = public as $$
  select coalesce(jsonb_agg(jsonb_build_object('id', co.id, 'name', co.name, 'slug', co.slug, 'space', vc.slug,
    'members', coalesce((select count(*) from public.vibe_community_members m where m.community_id = vc.id and m.status = 'active'), 0)) order by f.ord), '[]'::jsonb)
  from jsonb_array_elements_text(coalesce((select value from public.site_settings where key = 'vibe.featured_counties'), '[]'::jsonb)) with ordinality f(slug, ord)
  join public.counties co on co.slug = f.slug left join public.vibe_communities vc on vc.county_id = co.id;
$$;

revoke execute on function public.vibe_gifts_config(), public.vibe_gift_open(uuid) from public, anon, authenticated;
revoke execute on function public.vibe_gift_settings_save(boolean, text), public.vibe_gift_send(uuid, bigint, text, text, text), public.vibe_my_gifts(),
  public.admin_vibe_gifts(text), public.admin_vibe_gift_decide(bigint, boolean, text), public.admin_vibe_gift_balances(), public.admin_vibe_gift_payout(uuid, int, text) from public, anon;
grant execute on function public.vibe_gift_settings_save(boolean, text), public.vibe_gift_send(uuid, bigint, text, text, text), public.vibe_my_gifts(),
  public.admin_vibe_gifts(text), public.admin_vibe_gift_decide(bigint, boolean, text), public.admin_vibe_gift_balances(), public.admin_vibe_gift_payout(uuid, int, text) to authenticated;
grant execute on function public.vibe_gift_info(uuid), public.vibe_supporters(text), public.vibe_gift_leaders(int), public.vibe_featured_counties() to anon, authenticated;
grant execute on all functions in schema public to service_role;

-- Member cards say if the person accepts gifts, so the Gift button shows only where it works.
create or replace function public.vibe_card(u uuid, viewer uuid default auth.uid()) returns jsonb language sql stable security definer set search_path = public as $$
  select jsonb_build_object('id', v.user_id, 'username', v.username, 'name', public.vibe_name(v.user_id), 'headline', v.headline,
    'avatar', v.avatar_path, 'location', v.location,
    'online', v.show_online and v.last_active_at > now() - interval '2 minutes',
    'last_active', case when v.show_online then v.last_active_at end,
    'followers', v.followers_count,
    'verified', v.verified_at is not null,
    'gifts', public.vibe_gift_open(v.user_id),
    'following_them', exists (select 1 from public.vibe_follows f where f.follower = viewer and f.followee = v.user_id),
    'follows_me', exists (select 1 from public.vibe_follows f where f.follower = v.user_id and f.followee = viewer))
  from public.vibe_profiles v where v.user_id = u;
$$;
