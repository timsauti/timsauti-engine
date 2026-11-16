-- Short answer challenges. Runs after the community tests.
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

reset role;
insert into public.challenges (number, slug, title, question, answer_max, brief, prize, opens_at, entries_close_at, voting_close_at, published)
values (9, '09', 'Test question challenge', 'What would you do with KSh 1,000 and a phone?', 300, 'Answer one simple question in a few sentences.', 'KSh 500 airtime',
        now() - interval '1 hour', now() + interval '6 days', now() + interval '6 days', true);
set role anon; select set_config('request.jwt.claims', '{"role":"anon"}', false);
select pg_temp.expect((select question from public.challenge_list where slug = '09') like 'What would you do%', 'the public list shows the question');
select pg_temp.expect((select sponsor_name from public.challenge_list where slug = '01') = 'Kyandu Bright School', 'challenge 01 is sponsored by Kyandu Bright School');
reset role;
set role authenticated; select pg_temp.as_user('00000000-0000-0000-0000-0000000000c2');
select public.story_save(null, '', 'Buy airtime in bulk and resell it to neighbours.', 'hustle', null, null, (select id from public.challenge_list where slug = '09'));
select pg_temp.expect((select title from public.stories where author_id = '00000000-0000-0000-0000-0000000000c2' and challenge_id = (select id from public.challenge_list where slug = '09')) = 'Challenge 09 answer', 'a short answer is accepted and titled for the writer');
select pg_temp.fails($$select public.story_save((select id from public.stories where author_id = '00000000-0000-0000-0000-0000000000c2' and challenge_id is not null limit 1), '', repeat('a', 301), 'hustle')$$, 'answers longer than the limit are refused');
select pg_temp.fails($$select public.story_save((select id from public.stories where author_id = '00000000-0000-0000-0000-0000000000c2' and challenge_id is not null limit 1), '', 'Too short', 'hustle')$$, 'answers need at least one full sentence');
reset role;
set role anon; select set_config('request.jwt.claims', '{"role":"anon"}', false);
select pg_temp.expect((select question from public.challenge_list where slug = '01') like 'Pick the best grade%', 'challenge 01 is the boarding debate');
select pg_temp.expect((select phase from public.challenge_list where slug = '02') = 'upcoming' or now() > '2026-11-24', 'challenge 02 is scheduled for next week');
select pg_temp.expect((select sponsor_phone from public.challenge_list where slug = '01') = '+254705234763', 'the sponsor advert carries the school phone');
reset role;
select pg_temp.expect((select rules from public.challenges where slug = '01') like '%defend it in three sentences%', 'challenge 01 rules ask for three sentences');
select pg_temp.expect((select title from public.challenges where slug = '02') = 'The School Checklist', 'challenge 02 is the school checklist');
