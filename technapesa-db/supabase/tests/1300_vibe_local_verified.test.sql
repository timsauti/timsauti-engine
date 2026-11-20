-- TnPVibe county spaces and Verified members.
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
  ('00000000-0000-0000-0000-00000000c0a1', 'loc1@test.local', '{"full_name":"Mueni Local","accepted_terms":true}'),
  ('00000000-0000-0000-0000-00000000c0b2', 'loc2@test.local', '{"full_name":"Kioko Local","accepted_terms":true}');
set role authenticated;
select pg_temp.as_user('00000000-0000-0000-0000-00000000c0a1'); select public.vibe_join('mueni_loc', true);
select pg_temp.as_user('00000000-0000-0000-0000-00000000c0b2'); select public.vibe_join('kioko_loc', true);

-- county spaces
select pg_temp.as_user('00000000-0000-0000-0000-00000000c0a1');
select pg_temp.expect(public.vibe_county_space((select id from public.counties where slug = 'machakos')) = 'county-machakos', 'opening a county creates its space with a clean address');
select pg_temp.expect(public.vibe_community('county-machakos')->>'my_status' = 'active', 'the member who opened it has joined');
select pg_temp.expect(public.vibe_community('county-machakos')->>'my_role' is distinct from 'owner', 'no member becomes the owner of a county space');
select pg_temp.as_user('00000000-0000-0000-0000-00000000c0b2');
select pg_temp.expect(public.vibe_county_space((select id from public.counties where slug = 'machakos')) = 'county-machakos', 'a second member joins the same space, not a copy');
reset role;
select pg_temp.expect((select count(*) from public.vibe_communities where county_id = (select id from public.counties where slug = 'machakos')) = 1, 'there is one space per county');
select pg_temp.expect((select category from public.vibe_communities where slug = 'county-machakos') = 'local', 'county spaces are in the Local group');
set role authenticated;

-- verified badge
select pg_temp.as_user('00000000-0000-0000-0000-00000000c0b2');
select pg_temp.expect(not (public.vibe_profile('mueni_loc')->>'verified')::boolean, 'members start without the Verified badge');
select pg_temp.fails($$select public.admin_vibe_verify('kioko_loc', true, 'self')$$, 'members cannot verify themselves');
select pg_temp.as_user('00000000-0000-0000-0000-00000000000a');
select pg_temp.fails($$select public.admin_vibe_verify('mueni_loc', true, '')$$, 'staff must record what was checked');
select public.admin_vibe_verify('@Mueni_Loc', true, 'National ID seen in person at Machakos office');
select pg_temp.as_user('00000000-0000-0000-0000-00000000c0b2');
select pg_temp.expect((public.vibe_profile('mueni_loc')->>'verified')::boolean, 'the Verified badge shows on the member card');
reset role;
select pg_temp.expect((select count(*) from public.audit_log where action = 'vibe.member_verified') = 1, 'verification is audited');
