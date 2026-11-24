-- Member earnings: invites (KSh per active friend) and confirmed gifts, paid and waiting, public board and hiding.
\set QUIET on
create or replace function pg_temp.as_user(p uuid) returns void language plpgsql as $$
begin perform set_config('request.jwt.claims', json_build_object('sub', p, 'role', 'authenticated')::text, false); end $$;
create or replace function pg_temp.expect(cond boolean, what text) returns void language plpgsql as $$
begin if not coalesce(cond, false) then raise exception 'FAILED: %', what; else raise notice 'ok: %', what; end if; end $$;
create or replace function pg_temp.fails(sql text, what text) returns void language plpgsql as $$
begin
  begin execute sql; exception when others then raise notice 'ok: %', what; return; end;
  raise exception 'FAILED: %', what;
end $$;

insert into auth.users (id, email, raw_user_meta_data) values
  ('00000000-0000-0000-0000-0000000ea001', 'earn.mumbua@test.local', '{"full_name":"Mumbua Kyalo","accepted_terms":true}'),
  ('00000000-0000-0000-0000-0000000ea002', 'earn.f1@test.local', '{"full_name":"Friend One","accepted_terms":true}'),
  ('00000000-0000-0000-0000-0000000ea003', 'earn.f2@test.local', '{"full_name":"Friend Two","accepted_terms":true}'),
  ('00000000-0000-0000-0000-0000000ea004', 'earn.f3@test.local', '{"full_name":"Friend Three","accepted_terms":true}'),
  ('00000000-0000-0000-0000-0000000ea005', 'earn.staff@test.local', '{"full_name":"Staff Payer","accepted_terms":true}');
set role authenticated;
select pg_temp.as_user('00000000-0000-0000-0000-0000000ea001'); select public.vibe_join('mumbua_earns', true);
select pg_temp.as_user('00000000-0000-0000-0000-0000000ea002'); select public.vibe_join('friend_one_e', true);
reset role;

-- Three friends joined with Mumbua's link; two became active
update public.profiles set referred_by = '00000000-0000-0000-0000-0000000ea001'
  where id in ('00000000-0000-0000-0000-0000000ea002', '00000000-0000-0000-0000-0000000ea003', '00000000-0000-0000-0000-0000000ea004');
insert into public.point_events (user_id, kind, ref, points) values
  ('00000000-0000-0000-0000-0000000ea002', 'vote', 'test-e1', 1), ('00000000-0000-0000-0000-0000000ea003', 'comment', 'test-e2', 1);
-- One confirmed gift (creator share KSh 40) and one still pending
insert into public.vibe_gifts (giver, receiver, item_key, item_name, amount_kes, creator_kes, mpesa_code, status, decided_at) values
  ('00000000-0000-0000-0000-0000000ea002', '00000000-0000-0000-0000-0000000ea001', 'soda', 'Soda', 50, 40, 'TESTEARN01', 'confirmed', now()),
  ('00000000-0000-0000-0000-0000000ea003', '00000000-0000-0000-0000-0000000ea001', 'chai', 'Chai', 20, 16, 'TESTEARN02', 'pending', null);
-- Staff already paid for one active friend
insert into public.referral_cash_payouts (referrer, active_count, amount_kes, paid_by) values ('00000000-0000-0000-0000-0000000ea001', 1, 10, '00000000-0000-0000-0000-0000000ea005');

set role authenticated; select pg_temp.as_user('00000000-0000-0000-0000-0000000ea001');
create temp table e as select public.my_earnings() j;
select pg_temp.expect((select (j->'invites'->>'signups')::int = 3 and (j->'invites'->>'active')::int = 2 from e), 'the member sees 3 friends joined and 2 active');
select pg_temp.expect((select (j->'invites'->>'earned_kes')::int = 20 and (j->'invites'->>'paid_kes')::int = 10 and (j->'invites'->>'waiting_kes')::int = 10 from e), 'invites: KSh 20 earned, 10 paid, 10 waiting');
select pg_temp.expect((select (j->'gifts'->>'earned_kes')::int = 40 and (j->'gifts'->>'count')::int = 1 from e), 'gifts: only confirmed gifts count (KSh 40)');
select pg_temp.expect((select (j->>'total_earned_kes')::int = 60 and (j->>'total_paid_kes')::int = 10 from e), 'total earned KSh 60, paid KSh 10');
select pg_temp.expect((select jsonb_array_length(j->'friends') = 3 and not (j->'friends')::text ilike '%@%' from e), 'friends list shows first names only, no emails');
reset role;

set role anon; select set_config('request.jwt.claims', '{"role":"anon"}', false);
create temp table b as select public.earnings_board(10) j;
select pg_temp.expect((select (j->>'total_earned_kes')::int >= 60 from b), 'the public board shows the total members have earned');
select pg_temp.expect((select (j->'top')::text ilike '%mumbua_earns%' from b), 'the top earner appears on the public board');
select pg_temp.expect((select (j->'top')::text not ilike '%phone%' from b), 'the board never shows phone numbers');
select pg_temp.fails($$select public.my_earnings_hide(true)$$, 'visitors cannot change anyone''s board setting');
select pg_temp.fails($$select public.member_earning_figures('00000000-0000-0000-0000-0000000ea001')$$, 'visitors cannot read a member''s private figures');
reset role;

set role authenticated; select pg_temp.as_user('00000000-0000-0000-0000-0000000ea001');
select public.my_earnings_hide(true);
reset role;
select pg_temp.expect((select (public.earnings_board(10)->'top')::text not ilike '%mumbua_earns%'), 'a member who hides is removed from the board');
select pg_temp.expect((select (public.earnings_board(10)->>'total_earned_kes')::int >= 60), 'the total still counts hidden members');
