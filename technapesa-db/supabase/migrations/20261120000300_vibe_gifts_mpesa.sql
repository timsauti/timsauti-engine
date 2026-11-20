-- =============================================================================================
-- TnPVibe gifts by M-PESA prompt (owner, 20 Nov 2026: use Paystack so his personal name never shows, and the giver sees
-- M-PESA, not Paystack). The giver types their M-PESA number on our page; an M-PESA PIN prompt arrives on their phone
-- (sent through Paystack's Charge API by the gift-mpesa Edge Function). Paystack's verdict, checked against the amount,
-- confirms the gift by itself. The Till route stays available as a fallback (vibe.gifts "pay": "till").
-- =============================================================================================

alter table public.vibe_gifts alter column mpesa_code drop not null;
alter table public.vibe_gifts add column method text not null default 'till' check (method in ('till', 'mpesa')),
  add column reference text unique, add column provider_id text, add column paid_minor bigint;
alter table public.vibe_gifts add constraint vibe_gifts_till_code check (method <> 'till' or mpesa_code is not null);
alter table public.vibe_gifts drop constraint vibe_gifts_status_check;
alter table public.vibe_gifts add constraint vibe_gifts_status_check check (status in ('unpaid', 'pending', 'confirmed', 'rejected', 'failed'));
create index vibe_gifts_unpaid on public.vibe_gifts (giver, created_at) where status = 'unpaid';

update public.site_settings set value = value || '{"pay": "mpesa"}'::jsonb where key = 'vibe.gifts' and not (value ? 'pay');

create or replace function public.vibe_gift_open(p_user uuid) returns boolean language sql stable security definer set search_path = public as $$
  select coalesce((public.vibe_gifts_config() ->> 'on')::boolean, false)
    and (coalesce(public.vibe_gifts_config() ->> 'pay', 'till') = 'mpesa' or (public.vibe_gifts_config() ->> 'till') is not null)
    and exists (select 1 from public.vibe_gift_settings s join public.vibe_profiles v on v.user_id = s.user_id
                where s.user_id = p_user and s.accepts and s.payout_phone is not null and v.status = 'active');
$$;

create or replace function public.vibe_gift_info(p_user uuid) returns jsonb language sql stable security definer set search_path = public as $$
  select jsonb_build_object('open', public.vibe_gift_open(p_user), 'pay', coalesce(c ->> 'pay', 'till'),
    'till', case when coalesce(c ->> 'pay', 'till') = 'till' then c ->> 'till' end, 'items', coalesce(c -> 'items', '[]'::jsonb),
    'creator_share_pct', coalesce((c ->> 'creator_share_pct')::int, 80), 'name', public.vibe_name(p_user))
  from (select public.vibe_gifts_config() c) x;
$$;

-- Step 1 (called by the gift-mpesa function as the signed in giver): records the gift as unpaid and returns its reference.
create or replace function public.vibe_gift_start(p_receiver uuid, p_post bigint, p_item text, p_message text default null) returns jsonb
language plpgsql security definer set search_path = public as $$
declare me uuid := public.vibe_need_me(); c jsonb := public.vibe_gifts_config(); it jsonb; ref text; kes int;
begin
  if coalesce(c ->> 'pay', 'till') <> 'mpesa' then raise exception 'gifts by M-PESA prompt are not switched on'; end if;
  if not public.vibe_gift_open(p_receiver) then raise exception 'this member is not receiving gifts right now'; end if;
  if p_receiver = me then raise exception 'you cannot send a gift to yourself'; end if;
  if public.vibe_blocked(me, p_receiver) then raise exception 'not allowed'; end if;
  if p_post is not null and not exists (select 1 from public.vibe_posts where id = p_post and author_id = p_receiver) then raise exception 'that post is not by this member'; end if;
  select x into it from jsonb_array_elements(c -> 'items') x where x ->> 'key' = p_item;
  if it is null then raise exception 'choose a gift'; end if;
  if (select count(*) from public.vibe_gifts where giver = me and status = 'unpaid' and created_at > now() - interval '1 hour') >= 6 then
    raise exception 'too many unfinished gifts; please wait a little and try again'; end if;
  kes := (it ->> 'kes')::int;
  ref := 'gift_' || replace(gen_random_uuid()::text, '-', '');
  insert into public.vibe_gifts (giver, receiver, post_id, item_key, item_name, amount_kes, creator_kes, message, method, reference, status)
  values (me, p_receiver, p_post, it ->> 'key', it ->> 'name', kes, floor(kes * coalesce((c ->> 'creator_share_pct')::int, 80) / 100.0)::int,
    nullif(left(trim(coalesce(p_message, '')), 140), ''), 'mpesa', ref, 'unpaid');
  return jsonb_build_object('reference', ref, 'amount_kes', kes);
end $$;

-- Step 2 (server only): records Paystack's verdict. The amount and currency must match exactly. Safe to call more than once.
create or replace function public.vibe_gift_paid(p_reference text, p_status text, p_amount_minor bigint, p_currency text, p_provider_id text default null) returns text
language plpgsql security definer set search_path = public as $$
declare g public.vibe_gifts;
begin
  select * into g from public.vibe_gifts where reference = p_reference for update;
  if g.id is null then raise exception 'unknown gift'; end if;
  if g.status in ('confirmed', 'rejected') then return g.status; end if;
  if p_status = 'success' then
    if upper(coalesce(p_currency, '')) <> 'KES' or p_amount_minor <> g.amount_kes * 100 then
      update public.vibe_gifts set status = 'rejected', staff_note = 'Amount did not match; our team will look into it', provider_id = p_provider_id, paid_minor = p_amount_minor, decided_at = now() where id = g.id;
      perform public.log_action('vibe.gift_amount_mismatch', 'vibe_gift', g.id::text, null, jsonb_build_object('expected', g.amount_kes * 100, 'got', p_amount_minor, 'currency', p_currency), null);
      return 'rejected';
    end if;
    update public.vibe_gifts set status = 'confirmed', provider_id = p_provider_id, paid_minor = p_amount_minor, decided_at = now() where id = g.id;
    perform public.log_action('vibe.gift_paid', 'vibe_gift', g.id::text, null, jsonb_build_object('kes', g.amount_kes, 'reference', g.reference), null);
    perform public.notify(g.receiver, 'account', public.vibe_name(g.giver) || ' sent you ' || g.item_name, coalesce(g.message, 'A gift for your posts on TnPVibe. KSh ' || g.creator_kes || ' is now in your gifts balance.'), '/vibe/gifts/');
    perform public.notify(g.giver, 'account', 'Your ' || g.item_name || ' reached ' || public.vibe_name(g.receiver), 'Thank you for supporting a creator on TnPVibe.', '/vibe/gifts/');
    return 'confirmed';
  elsif p_status in ('failed', 'abandoned', 'reversed') then
    update public.vibe_gifts set status = 'failed', provider_id = p_provider_id, decided_at = now() where id = g.id and status = 'unpaid';
    return 'failed';
  end if;
  return g.status;
end $$;

-- The giver's own view of one gift, for the waiting screen.
create or replace function public.vibe_gift_status(p_reference text) returns text language sql stable security definer set search_path = public as $$
  select status from public.vibe_gifts where reference = p_reference and giver = auth.uid();
$$;

-- Unfinished prompts older than a day are closed so they do not clutter anyone's list.
create or replace function public.vibe_gifts_tidy() returns int language sql security definer set search_path = public as $$
  with x as (update public.vibe_gifts set status = 'failed', decided_at = now() where status = 'unpaid' and created_at < now() - interval '1 day' returning 1)
  select count(*)::int from x;
$$;

-- Gifts sent: leave out prompts the giver never finished.
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
                 from (select * from public.vibe_gifts where giver = (select id from me) and status not in ('unpaid', 'failed') order by created_at desc limit 50) g), '[]'::jsonb))
  from me left join public.vibe_gift_settings s on s.user_id = me.id;
$$;

-- Till codes are accepted only while gifts run on the Till.
create or replace function public.vibe_gift_send(p_receiver uuid, p_post bigint, p_item text, p_code text, p_message text default null) returns bigint
language plpgsql security definer set search_path = public as $$
declare me uuid := public.vibe_need_me(); c jsonb := public.vibe_gifts_config(); it jsonb; code text := upper(regexp_replace(coalesce(p_code, ''), '\s', '', 'g')); gid bigint;
begin
  if coalesce(c ->> 'pay', 'till') <> 'till' or (c ->> 'till') is null then raise exception 'gifts are paid by M-PESA prompt, not by Till code'; end if;
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

revoke execute on function public.vibe_gift_start(uuid, bigint, text, text), public.vibe_gift_paid(text, text, bigint, text, text),
  public.vibe_gift_status(text), public.vibe_gifts_tidy() from public, anon, authenticated;
grant execute on function public.vibe_gift_start(uuid, bigint, text, text), public.vibe_gift_status(text) to authenticated;
grant execute on all functions in schema public to service_role;
