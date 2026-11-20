-- TnPVibe polls: many options, with a small photo per option.
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
  ('00000000-0000-0000-0000-00000000f0a1', 'poll1@test.local', '{"full_name":"Poll Maker","accepted_terms":true}');
create temp table gv (k text primary key, v jsonb);
grant all on gv to authenticated;
set role authenticated;
select pg_temp.as_user('00000000-0000-0000-0000-00000000f0a1'); select public.vibe_join('poll_maker', true);
insert into gv select 'p', public.vibe_post_save(null, 'poll', 'Who should be the next Machakos governor?', '{}', null, null, null,
  jsonb_build_object('days', 3, 'options', (select jsonb_agg('Candidate ' || g) from generate_series(1, 12) g),
    'photos', jsonb_build_array('00000000-0000-0000-0000-00000000f0a1/poll-1.jpg', '', '00000000-0000-0000-0000-00000000f0a1/poll-3.jpg')));
select pg_temp.expect(jsonb_array_length((select v from gv where k = 'p')->'poll'->'options') = 12, 'a poll can have more than six options');
select pg_temp.expect((select v from gv where k = 'p')->'poll'->'options'->0->>'photo' = '00000000-0000-0000-0000-00000000f0a1/poll-1.jpg', 'an option shows its photo');
select pg_temp.expect((select v from gv where k = 'p')->'poll'->'options'->1->>'photo' is null, 'an option without a photo is fine');
select pg_temp.expect((select v from gv where k = 'p')->'poll'->'options'->2->>'photo' like '%poll-3.jpg', 'photos stay with the right names');
select pg_temp.fails($$select public.vibe_post_save(null, 'poll', 'Too many choices here?', '{}', null, null, null, jsonb_build_object('options', (select jsonb_agg('Option ' || g) from generate_series(1, 31) g)))$$, 'more than 30 options is refused');
select pg_temp.fails($$select public.vibe_post_save(null, 'poll', 'Whose photo is this?', '{}', null, null, null, jsonb_build_object('options', jsonb_build_array('A', 'B'), 'photos', jsonb_build_array('someone-else/x.jpg')))$$, 'photos must come from your own uploads');
reset role;
