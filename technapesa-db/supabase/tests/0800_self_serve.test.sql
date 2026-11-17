-- Self serve Digital Growth: automatic approval, the client starts the trial, optional call request with a staff alert.
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
create temp table s (v text); grant all on s to authenticated;
update public.site_settings set value = 'true' where key = 'growth.auto_approve';
update public.site_settings set value = 'true' where key = 'growth.trials_open';
insert into auth.users (id, email, raw_user_meta_data) values ('00000000-0000-0000-0000-0000000000d1', 'hardware@test.local', '{"full_name":"Dan Hardware","accepted_terms":true}');

set role authenticated; select pg_temp.as_user('00000000-0000-0000-0000-0000000000d1');
insert into s select public.growth_save(null, jsonb_build_object('business_name', 'Dan Hardware Tala',
  'category_id', (select id from public.categories limit 1), 'county_id', 16, 'town', 'Tala',
  'description', 'Hardware shop in Tala selling cement, iron sheets, paint and plumbing supplies.', 'phone', '0722333444',
  'objectives', 'More orders on WhatsApp', 'platforms', jsonb_build_array('facebook')))::text;
select public.growth_submit((select v from s)::uuid, (select value #>> '{}' from public.site_settings where key = 'growth.agreement_version'));
select pg_temp.expect((select status from public.growth_clients where business_name = 'Dan Hardware Tala') = 'approved', 'a complete application is approved automatically');
select pg_temp.fails($$select public.growth_request_call((select v from s)::uuid, '123', 'morning')$$, 'a call request needs a real phone number');
select public.growth_request_call((select v from s)::uuid, '0722333444', 'morning', 'Please call after 9');
select pg_temp.fails($$select public.growth_request_call((select v from s)::uuid, '0722333444', 'morning')$$, 'a call request is not sent twice in a row');
select public.growth_start_own_trial((select v from s)::uuid, null);
select pg_temp.expect((select status = 'trial_active' and trial_ends_at > now() + interval '13 days' from public.growth_clients where business_name = 'Dan Hardware Tala'), 'the client starts the free trial without waiting for staff');
select pg_temp.fails($$select public.growth_start_own_trial((select v from s)::uuid, null)$$, 'a trial cannot be started twice');
select pg_temp.fails($$select public.admin_growth_call_done((select v from s)::uuid, null)$$, 'a client cannot close the call request');
select pg_temp.fails($$select count(*) from public.staff_alerts$$, 'clients cannot read staff alerts');
reset role;
select pg_temp.expect((select count(*) from public.staff_alerts where client_id = (select v from s)::uuid) = 3, 'staff are alerted for the application, the call and the trial');
select pg_temp.expect((select call_done_at is null and call_phone is not null from public.growth_clients where business_name = 'Dan Hardware Tala'), 'the call stays pending');
-- name your budget
select set_config('request.jwt.claims', '{"role":"service_role"}', false);
select pg_temp.fails($$select public.quote_save('00000000-0000-0000-0000-0000000000d1', (select v from s)::uuid, 5000, 'x', '[{"key":"post","qty":30}]', 'too big')$$, 'a plan above the budget is refused');
select pg_temp.fails($$select public.quote_save('00000000-0000-0000-0000-0000000000d1', (select v from s)::uuid, 5000, 'x', '[{"key":"post","qty":5},{"key":"free_money","qty":1}]', 'x')$$, 'items outside the rate card are refused');
insert into s select public.quote_save('00000000-0000-0000-0000-0000000000d1', (select v from s limit 1)::uuid, 5000, 'More orders', '[{"key":"post","qty":10},{"key":"gbp_setup","qty":1}]', 'Ten posts and a Google profile');
select pg_temp.expect((select total_kes from public.growth_quotes) = 5000, 'the database prices the plan from the rate card');
select set_config('request.jwt.claims', '{}', false);
set role authenticated; select pg_temp.as_user('00000000-0000-0000-0000-0000000000d1');
create temp table r (v text);
insert into r select public.payment_create_quote((select id from public.growth_quotes limit 1));
select pg_temp.expect((select amount_kes from public.payments where reference = (select v from r)) = 5000, 'the plan payment carries the plan total');
reset role; select set_config('request.jwt.claims', '{"role":"service_role"}', false);
select pg_temp.expect(public.payment_confirm((select v from r), 'success', 500000, 'KES', 'mobile_money', 'q1', '{}') = 'confirmed', 'the plan payment is confirmed');
select pg_temp.expect((select package_key = 'custom' and custom_plan->>'total_kes' = '5000' and status = 'subscribed' from public.growth_clients where business_name = 'Dan Hardware Tala'), 'the paid plan becomes the client package');
select set_config('request.jwt.claims', '{}', false);
