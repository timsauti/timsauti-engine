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
-- institution and sponsorship requests
set role authenticated; select pg_temp.as_user('00000000-0000-0000-0000-0000000000c2');
select public.service_request_create(null, 'sponsorship', 'We would like to sponsor a challenge in January for our school.', '0712345678');
select public.service_request_create(null, 'institution_plan', 'Please call us about social media for our clinic.', null);
reset role;
select pg_temp.expect((select count(*) from public.service_requests where service in ('sponsorship', 'institution_plan')) = 2, 'sponsorship and institution requests are accepted');
-- payment links: staff mark a pending payment as paid
select pg_temp.expect((select value = '"links"'::jsonb from public.site_settings where key = 'payments.mode'), 'payments use Paystack payment links');
set role authenticated; select pg_temp.as_user('00000000-0000-0000-0000-0000000000a7');
truncate t_ref;
insert into t_ref select public.payment_create((select id from public.growth_clients where business_name = 'Grace Bakery Kangundo'), 'starter');
select pg_temp.fails($$select public.admin_payment_mark_paid((select id from public.payments where reference = (select ref from t_ref)), 'T123456789')$$, 'clients cannot mark their own payment as paid');
reset role;
set role authenticated; select pg_temp.as_user('00000000-0000-0000-0000-00000000000a');
select public.admin_payment_mark_paid((select id from public.payments where reference = (select ref from t_ref)), 'T123456789');
select pg_temp.fails($$select public.admin_payment_mark_paid((select id from public.payments where reference = (select ref from t_ref)), 'T999999999')$$, 'a payment cannot be marked paid twice');
select pg_temp.fails($$select public.admin_payment_record((select id from public.growth_clients where business_name = 'Grace Bakery Kangundo'), 'starter', 'T123456789')$$, 'the same Paystack reference cannot be used twice');
select public.admin_payment_record((select id from public.growth_clients where business_name = 'Grace Bakery Kangundo'), 'growth', 'T555555555');
reset role;
select pg_temp.expect((select status from public.payments where reference = (select ref from t_ref)) = 'success', 'staff can mark a payment as paid');
select pg_temp.expect((select paid_until > now() + interval '2 months' from public.growth_clients where business_name = 'Grace Bakery Kangundo'), 'each payment adds a period to the subscription');
select pg_temp.expect((select count(*) from public.audit_log where action = 'payment.marked_paid') = 2, 'marking payments as paid is audited');
-- renewals
reset role; select set_config('request.jwt.claims', '{}', false);
update public.growth_clients set paid_until = now() + interval '2 days', renewal_reminders = '{}' where business_name = 'Grace Bakery Kangundo';
select pg_temp.expect((public.growth_billing_daily()->>'reminders')::int = 1, 'a client is reminded before the paid month ends');
select pg_temp.expect((public.growth_billing_daily()->>'reminders')::int = 0, 'the same reminder is not sent twice');
update public.growth_clients set paid_until = now() - interval '1 hour' where business_name = 'Grace Bakery Kangundo';
select pg_temp.expect((public.growth_billing_daily()->>'lapsed')::int = 1, 'an unpaid package lapses when the month ends');
select pg_temp.expect((select status from public.growth_clients where business_name = 'Grace Bakery Kangundo') = 'lapsed', 'the client shows as lapsed');
set role authenticated; select pg_temp.as_user('00000000-0000-0000-0000-0000000000a7');
select pg_temp.expect(public.payment_create((select id from public.growth_clients where business_name = 'Grace Bakery Kangundo'), 'starter') like 'TNP-%', 'a lapsed client can pay again');
reset role;
