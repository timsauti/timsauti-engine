-- Rewards, referrals, opportunities and the owner dashboard.
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
create temp table rr (k text primary key, v text); grant all on rr to authenticated;
insert into auth.users (id, email, raw_user_meta_data) values
  ('00000000-0000-0000-0000-0000000000e1', 'referrer@test.local', '{"full_name":"Esther Referrer","accepted_terms":true}'),
  ('00000000-0000-0000-0000-0000000000e2', 'friend@test.local', '{"full_name":"Felix Friend","accepted_terms":true}');
set role authenticated; select pg_temp.as_user('00000000-0000-0000-0000-0000000000e1');
insert into rr select 'code', public.my_referral_code();
select pg_temp.expect(public.my_referral_code() = (select v from rr where k = 'code'), 'the referral code stays the same');
select pg_temp.as_user('00000000-0000-0000-0000-0000000000e2');
select pg_temp.expect(public.claim_referral((select v from rr where k = 'code')) = 'ok', 'a new member can claim a referral');
select pg_temp.expect(public.claim_referral((select v from rr where k = 'code')) = 'already', 'a referral is claimed once');
reset role;
insert into public.stories (slug, author_id, title, body, category, status) values ('friend-first-story', '00000000-0000-0000-0000-0000000000e2', 'How I saved with M-PESA', repeat('I saved a little every day with my phone. ', 4), 'money', 'pending');
update public.stories set status = 'published', published_at = now() where slug = 'friend-first-story';
select pg_temp.expect((select sum(points) from public.point_events where user_id = '00000000-0000-0000-0000-0000000000e2') = 20, 'a published story earns points');
select pg_temp.expect((select sum(points) from public.point_events where user_id = '00000000-0000-0000-0000-0000000000e1' and kind = 'referral') = 25, 'the referrer earns points when the friend takes part');
update public.stories set status = 'pending' where slug = 'friend-first-story'; update public.stories set status = 'published' where slug = 'friend-first-story';
select pg_temp.expect((select sum(points) from public.point_events where user_id = '00000000-0000-0000-0000-0000000000e2') = 20, 'points are not given twice for the same story');
set role authenticated; select pg_temp.as_user('00000000-0000-0000-0000-0000000000e2');
select pg_temp.fails($$select public.reward_redeem(200, '0712345678')$$, 'cannot redeem more points than you have');
select pg_temp.fails($$insert into public.point_events (user_id, kind, ref, points) values (auth.uid(), 'adjustment', 'x', 1000)$$, 'members cannot give themselves points');
insert into rr select 'opp', public.opportunity_save('{"kind":"training","title":"Free digital marketing training in Machakos","organisation":"Machakos County","summary":"A free five day digital marketing training for young people in Machakos County.","how_to_apply":"Register at the county offices"}'::jsonb)::text;
select pg_temp.as_user('00000000-0000-0000-0000-0000000000f9');
select pg_temp.expect((select count(*) from public.opportunities) = 0, 'unverified opportunities are not public');
reset role;
update public.opportunities set status = 'published', published_at = now() where id = (select v from rr where k = 'opp')::uuid;
set role anon; select set_config('request.jwt.claims', '{"role":"anon"}', false);
select pg_temp.expect((select count(*) from public.opportunities) = 1, 'published opportunities are public');
select pg_temp.expect((select count(*) from public.site_search_opportunities('digital machakos')) = 1, 'search finds opportunities');
select pg_temp.expect((select count(*) from public.points_leaderboard(10)) >= 1, 'the monthly leaderboard is public');
reset role; select set_config('request.jwt.claims', '{}', false);
