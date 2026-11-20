-- Sign in with Google or Facebook: terms acceptance is recorded once.
\set QUIET on
create or replace function pg_temp.as_user(p uuid) returns void language plpgsql as $$
begin perform set_config('request.jwt.claims', json_build_object('sub', p, 'role', 'authenticated')::text, false); end $$;
create or replace function pg_temp.expect(cond boolean, what text) returns void language plpgsql as $$
begin if not coalesce(cond, false) then raise exception 'FAILED: %', what; else raise notice 'ok: %', what; end if; end $$;
insert into auth.users (id, email, raw_user_meta_data) values
  ('00000000-0000-0000-0000-0000000aa0a1', 'g1@test.local', '{"full_name":"Mwikali Google","name":"Mwikali Google","avatar_url":"https://x"}');
select pg_temp.expect((select full_name from public.profiles where id = '00000000-0000-0000-0000-0000000aa0a1') = 'Mwikali Google', 'a Google account gets its name on the profile');
select pg_temp.expect(not exists (select 1 from public.consents where user_id = '00000000-0000-0000-0000-0000000aa0a1' and kind = 'terms'), 'no terms acceptance is assumed');
set role authenticated;
select pg_temp.as_user('00000000-0000-0000-0000-0000000aa0a1');
select public.record_signup_consent('2026-11-16', false);
select public.record_signup_consent('2026-11-16', false);
reset role;
select pg_temp.expect((select count(*) from public.consents where user_id = '00000000-0000-0000-0000-0000000aa0a1' and kind in ('terms', 'privacy') and granted and source = 'social_signup') = 2, 'terms and privacy are recorded once');
select pg_temp.expect((select value from public.site_settings where key = 'auth.social') = '{"google": false, "facebook": false}'::jsonb, 'buttons stay hidden until switched on');
