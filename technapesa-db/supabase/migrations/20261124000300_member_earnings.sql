-- Member earnings (owner, 24 Nov 2026): members see what they earn from invites (KSh per active friend, setting
-- referral.cash) and M-PESA gifts (confirmed gifts, creator share), what was paid and what is waiting. A public board
-- shows top earners and the total members have earned, for credibility. Members can hide themselves from the board.
-- Same rules as admin_invites() and vibe_my_gifts(); nothing here pays anyone.

alter table public.vibe_profiles add column if not exists hide_earnings boolean not null default false;

-- Per member figures (internal helper, not callable from the browser)
create or replace function public.member_earning_figures(p_user uuid) returns jsonb
language sql stable security definer set search_path = public as $$
  with rate as (select coalesce((select (value ->> 'kes_per_active')::int from public.site_settings where key = 'referral.cash'), 10) kes),
  refs as (
    select q.id, q.created_at, exists (select 1 from public.point_events e where e.user_id = q.id and e.kind not in ('referral', 'redeemed', 'adjustment')) active
    from public.profiles q where q.referred_by = p_user),
  inv as (
    select count(*) signups, count(*) filter (where active) active,
      coalesce((select sum(active_count) from public.referral_cash_payouts c where c.referrer = p_user), 0) paid_for,
      coalesce((select sum(amount_kes) from public.referral_cash_payouts c where c.referrer = p_user), 0) paid_kes
    from refs),
  gif as (
    select coalesce((select sum(creator_kes) from public.vibe_gifts where receiver = p_user and status = 'confirmed'), 0) earned_kes,
      coalesce((select count(*) from public.vibe_gifts where receiver = p_user and status = 'confirmed'), 0) gifts,
      coalesce((select sum(amount_kes) from public.vibe_gift_payouts where receiver = p_user), 0) paid_kes)
  select jsonb_build_object(
    'kes_per_active', (select kes from rate),
    'invites', jsonb_build_object('signups', inv.signups, 'active', inv.active,
      'earned_kes', inv.active * (select kes from rate), 'paid_kes', inv.paid_kes,
      'waiting_kes', greatest(0, (inv.active - inv.paid_for) * (select kes from rate))),
    'gifts', jsonb_build_object('count', gif.gifts, 'earned_kes', gif.earned_kes, 'paid_kes', gif.paid_kes,
      'waiting_kes', greatest(0, gif.earned_kes - gif.paid_kes)),
    'total_earned_kes', inv.active * (select kes from rate) + gif.earned_kes,
    'total_paid_kes', inv.paid_kes + gif.paid_kes)
  from inv, gif;
$$;
revoke all on function public.member_earning_figures(uuid) from public, anon, authenticated;

-- The signed in member's own earnings, with recent friends who joined (first names only) and the switches they need.
create or replace function public.my_earnings() returns jsonb
language sql stable security definer set search_path = public as $$
  select public.member_earning_figures(auth.uid()) || jsonb_build_object(
    'referral_code', (select referral_code from public.profiles where id = auth.uid()),
    'gifts_on', coalesce((select accepts from public.vibe_gift_settings where user_id = auth.uid()), false),
    'member', exists (select 1 from public.vibe_profiles where user_id = auth.uid()),
    'hidden', coalesce((select hide_earnings from public.vibe_profiles where user_id = auth.uid()), false),
    'friends', coalesce((select jsonb_agg(f order by f->>'joined' desc) from (
      select jsonb_build_object('name', split_part(coalesce(nullif(q.display_name, ''), q.full_name, 'Friend'), ' ', 1), 'joined', q.created_at,
        'active', exists (select 1 from public.point_events e where e.user_id = q.id and e.kind not in ('referral', 'redeemed', 'adjustment'))) f
      from public.profiles q where q.referred_by = auth.uid() order by q.created_at desc limit 20) x), '[]'::jsonb))
  where auth.uid() is not null;
$$;
revoke all on function public.my_earnings() from public, anon;
grant execute on function public.my_earnings() to authenticated;

-- Show or hide me on the public earners board
create or replace function public.my_earnings_hide(p_hide boolean) returns void
language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null or not exists (select 1 from public.vibe_profiles where user_id = auth.uid()) then raise exception 'Join Tukachap first'; end if;
  update public.vibe_profiles set hide_earnings = coalesce(p_hide, false) where user_id = auth.uid();
end $$;
revoke all on function public.my_earnings_hide(boolean) from public, anon;
grant execute on function public.my_earnings_hide(boolean) to authenticated;

-- Public board: top earners (active Tukachap members who did not hide) and the total all members have earned.
create or replace function public.earnings_board(p_limit int default 10) returns jsonb
language sql stable security definer set search_path = public as $$
  with rate as (select coalesce((select (value ->> 'kes_per_active')::int from public.site_settings where key = 'referral.cash'), 10) kes),
  inv as (
    select q.referred_by uid, count(*) filter (where exists (select 1 from public.point_events e where e.user_id = q.id and e.kind not in ('referral', 'redeemed', 'adjustment'))) active
    from public.profiles q where q.referred_by is not null group by q.referred_by),
  gif as (select receiver uid, sum(creator_kes) kes from public.vibe_gifts where status = 'confirmed' group by receiver),
  per as (
    select coalesce(i.uid, g.uid) uid, coalesce(i.active, 0) * (select kes from rate) invite_kes, coalesce(g.kes, 0) gift_kes
    from inv i full join gif g on g.uid = i.uid),
  shown as (
    select p.*, p.invite_kes + p.gift_kes total from per p
    join public.vibe_profiles v on v.user_id = p.uid and v.status = 'active' and not v.hide_earnings
    where p.invite_kes + p.gift_kes > 0)
  select jsonb_build_object(
    'kes_per_active', (select kes from rate),
    'total_earned_kes', (select coalesce(sum(invite_kes + gift_kes), 0) from per),
    'total_paid_kes', coalesce((select sum(amount_kes) from public.referral_cash_payouts), 0) + coalesce((select sum(amount_kes) from public.vibe_gift_payouts), 0),
    'earners', (select count(*) from per where invite_kes + gift_kes > 0),
    'top', coalesce((select jsonb_agg(public.vibe_card(s.uid, auth.uid()) || jsonb_build_object('total_kes', s.total, 'invite_kes', s.invite_kes, 'gift_kes', s.gift_kes) order by s.total desc)
      from (select * from shown order by total desc limit least(greatest(coalesce(p_limit, 10), 1), 20)) s), '[]'::jsonb));
$$;
revoke all on function public.earnings_board(int) from public;
grant execute on function public.earnings_board(int) to anon, authenticated;
