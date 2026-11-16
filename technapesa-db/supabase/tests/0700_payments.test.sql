-- Paystack payments. Runs after the agent tests (Grace Bakery Kangundo is on an active trial).
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

select pg_temp.expect((select value = 'true'::jsonb from public.site_settings where key = 'growth.trials_open'), 'trial applications are switched on');
create temp table t_ref (ref text); grant all on t_ref to authenticated;
set role authenticated; select pg_temp.as_user('00000000-0000-0000-0000-0000000000a7');
insert into t_ref select public.payment_create((select id from public.growth_clients where business_name = 'Grace Bakery Kangundo'), 'growth');
select pg_temp.expect((select amount_kes from public.payments where reference = (select ref from t_ref)) = 4500, 'the amount comes from the package price');
select pg_temp.fails($$select public.payment_create((select id from public.growth_clients where business_name = 'Grace Bakery Kangundo'), 'trial')$$, 'the free trial cannot be paid for');
select pg_temp.fails($$select public.payment_confirm((select ref from t_ref), 'success', 450000, 'KES', 'mobile_money', '1', '{}')$$, 'a client cannot confirm their own payment');
select pg_temp.fails($$update public.payments set status = 'success'$$, 'clients cannot change payments directly');
reset role;
select pg_temp.expect(public.payment_confirm((select ref from t_ref), 'success', 100, 'KES', 'mobile_money', '1', '{}') = 'amount mismatch', 'a wrong amount is refused');
set role authenticated; select pg_temp.as_user('00000000-0000-0000-0000-0000000000a7');
insert into t_ref select public.payment_create((select id from public.growth_clients where business_name = 'Grace Bakery Kangundo'), 'growth');
reset role; select set_config('request.jwt.claims', '{}', false);
select pg_temp.expect(public.payment_confirm((select reference from public.payments where status = 'pending' limit 1), 'success', 450000, 'KES', 'mobile_money', 'ps1', '{}') = 'confirmed', 'a correct payment is confirmed');
select pg_temp.expect((select status = 'subscribed' and paid_until > now() + interval '27 days' from public.growth_clients where business_name = 'Grace Bakery Kangundo'), 'the client is subscribed for a month');
select pg_temp.expect(public.payment_confirm((select reference from public.payments where status = 'success' limit 1), 'success', 450000, 'KES', 'mobile_money', 'ps1', '{}') = 'already confirmed', 'confirming twice changes nothing');
select pg_temp.expect((select count(*) from public.notifications where topic = 'billing') >= 1, 'the client is told about the payment');
set role authenticated; select pg_temp.as_user('00000000-0000-0000-0000-00000000000a');
select pg_temp.expect((select count(*) from public.admin_list_payments()) >= 2, 'staff with payments.view see payments');
reset role;
