-- TnP Desk posts in county spaces; invites board counts active invites and records payouts once.
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
  ('00000000-0000-0000-0000-0000000bb0a1', 'desk@test.local', '{"full_name":"TnP Desk","accepted_terms":true}'),
  ('00000000-0000-0000-0000-0000000bb0b2', 'inv1@test.local', '{"full_name":"Inviter One","accepted_terms":true}'),
  ('00000000-0000-0000-0000-0000000bb0c3', 'inv2@test.local', '{"full_name":"Friend Active","accepted_terms":true}'),
  ('00000000-0000-0000-0000-0000000bb0d4', 'inv3@test.local', '{"full_name":"Friend Idle","accepted_terms":true}');
select pg_temp.expect((public.vibe_desk_setup('00000000-0000-0000-0000-0000000bb0a1')->>'spaces')::int = 4, 'the desk joins the four featured county spaces');
select pg_temp.expect((select verified_at is not null from public.vibe_profiles where username = 'tnpdesk'), 'the desk carries the Verified badge');
-- tick at a fixed daytime by checking only the result shape (the hour depends on when tests run)
select pg_temp.expect(public.vibe_desk_tick() ? 'sent', 'the desk run reports what it sent');
select pg_temp.expect((select count(*) from public.vibe_desk_log l where l.posted_at > now() - interval '1 minute') <= 4, 'at most one post per space per run');
select pg_temp.expect((select count(*) from public.vibe_desk_log) = (select count(*) from (select community_id, ref from public.vibe_desk_log group by 1, 2) x), 'no post is repeated in a space');

update public.profiles set referred_by = '00000000-0000-0000-0000-0000000bb0b2' where id in ('00000000-0000-0000-0000-0000000bb0c3', '00000000-0000-0000-0000-0000000bb0d4');
insert into public.point_events (user_id, kind, ref, points) values ('00000000-0000-0000-0000-0000000bb0c3', 'vote', 'test-vote', 2);
set role authenticated;
select pg_temp.as_user('00000000-0000-0000-0000-0000000bb0b2');
select pg_temp.fails($$select public.admin_invites()$$, 'members cannot see the invites board');
select pg_temp.as_user('00000000-0000-0000-0000-00000000000a');
select pg_temp.expect((select (x->>'signups')::int = 2 and (x->>'active')::int = 1 and (x->>'owed_kes')::int = 10 from jsonb_array_elements(public.admin_invites()->'rows') x where x->>'name' = 'Inviter One'), 'two sign ups, one active, KSh 10 owed');
select pg_temp.expect((public.admin_invite_paid('00000000-0000-0000-0000-0000000bb0b2', 'airtime')->>'kes')::int = 10, 'staff record the KSh 10 payout');
select pg_temp.fails($$select public.admin_invite_paid('00000000-0000-0000-0000-0000000bb0b2')$$, 'the same invites are never paid twice');
reset role;
