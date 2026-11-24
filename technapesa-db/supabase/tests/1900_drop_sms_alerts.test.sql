-- Tukachap Drop SMS alerts: on by default, one per 3 hours, no message text, member can switch off, no phone no SMS.
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
  ('00000000-0000-0000-0000-000000d50a01', 'drop.sms.a@test.local', '{"full_name":"Wanza Mutua","accepted_terms":true}'),
  ('00000000-0000-0000-0000-000000d50b02', 'drop.sms.b@test.local', '{"full_name":"Kioko Musyoka","accepted_terms":true}');
update public.profiles set phone = '+254712345678' where id = '00000000-0000-0000-0000-000000d50a01';
update public.profiles set phone = null where id = '00000000-0000-0000-0000-000000d50b02';

set role authenticated;
select pg_temp.as_user('00000000-0000-0000-0000-000000d50a01'); select public.vibe_join('wanza_sms', true);
select pg_temp.as_user('00000000-0000-0000-0000-000000d50b02'); select public.vibe_join('kioko_sms', true);
reset role;

-- Drops are written by the drop-submit function with the service key
insert into public.vibe_drops (recipient_id, sender_mode, message) values ('00000000-0000-0000-0000-000000d50a01', 'anonymous', 'Secret one: you are kind');
select pg_temp.expect((select count(*) from public.sms_outbox where reason = 'drop_alert' and user_id = '00000000-0000-0000-0000-000000d50a01') = 1, 'a member with a phone gets an SMS alert for a new Drop');
select pg_temp.expect((select phone from public.sms_outbox where reason = 'drop_alert' and user_id = '00000000-0000-0000-0000-000000d50a01') = '+254712345678', 'the alert goes to the phone on their account');
select pg_temp.expect((select message from public.sms_outbox where reason = 'drop_alert' and user_id = '00000000-0000-0000-0000-000000d50a01') not ilike '%secret%', 'the SMS never contains the Drop text');
select pg_temp.expect((select message from public.sms_outbox where reason = 'drop_alert' and user_id = '00000000-0000-0000-0000-000000d50a01') ilike '%technapesa.co.ke/vibe/drops/%', 'the SMS links to the inbox');

insert into public.vibe_drops (recipient_id, sender_mode, message) values ('00000000-0000-0000-0000-000000d50a01', 'anonymous', 'Secret two');
select pg_temp.expect((select count(*) from public.sms_outbox where reason = 'drop_alert' and user_id = '00000000-0000-0000-0000-000000d50a01') = 1, 'a second Drop within 3 hours sends no second SMS');

update public.vibe_drop_settings set last_sms_alert_at = now() - interval '4 hours' where user_id = '00000000-0000-0000-0000-000000d50a01';
insert into public.vibe_drops (recipient_id, sender_mode, message) values ('00000000-0000-0000-0000-000000d50a01', 'anonymous', 'Secret three');
select pg_temp.expect((select count(*) from public.sms_outbox where reason = 'drop_alert' and user_id = '00000000-0000-0000-0000-000000d50a01') = 2, 'after 3 hours the next Drop sends a new SMS');

insert into public.vibe_drops (recipient_id, sender_mode, message) values ('00000000-0000-0000-0000-000000d50b02', 'anonymous', 'Hello');
select pg_temp.expect((select count(*) from public.sms_outbox where reason = 'drop_alert' and user_id = '00000000-0000-0000-0000-000000d50b02') = 0, 'a member without a phone gets no SMS and the Drop still arrives');
select pg_temp.expect((select count(*) from public.vibe_drops where recipient_id = '00000000-0000-0000-0000-000000d50b02') = 1, 'the Drop is saved even without a phone');

set role authenticated; select pg_temp.as_user('00000000-0000-0000-0000-000000d50a01');
select pg_temp.expect((public.vibe_drop_sms_status()->>'on')::boolean and (public.vibe_drop_sms_status()->>'has_phone')::boolean, 'the member sees alerts on and their phone saved');
select public.vibe_drop_sms_set(false);
select pg_temp.expect(not (public.vibe_drop_sms_status()->>'on')::boolean, 'the member can switch SMS alerts off');
reset role;
update public.vibe_drop_settings set last_sms_alert_at = null where user_id = '00000000-0000-0000-0000-000000d50a01';
insert into public.vibe_drops (recipient_id, sender_mode, message) values ('00000000-0000-0000-0000-000000d50a01', 'anonymous', 'Secret four');
select pg_temp.expect((select count(*) from public.sms_outbox where reason = 'drop_alert' and user_id = '00000000-0000-0000-0000-000000d50a01') = 2, 'no SMS once switched off');

set role anon; select set_config('request.jwt.claims', '{"role":"anon"}', false);
select pg_temp.fails($$select public.vibe_drop_sms_set(true)$$, 'visitors cannot change anyone''s alerts');
reset role;
