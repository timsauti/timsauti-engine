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
update public.profiles set phone = '+254700000000' where phone is null;  -- challenge entrants need an M-PESA number
set role anon; select set_config('request.jwt.claims', '{"role":"anon"}', false);
select pg_temp.expect((select question from public.challenge_list where slug = '09') like 'What would you do%', 'the public list shows the question');
select pg_temp.expect((select sponsor_name from public.challenge_list where slug = '01') = 'Kyandu Bright Academy', 'challenge 01 is sponsored by Kyandu Bright Academy');
reset role;
set role authenticated; select pg_temp.as_user('00000000-0000-0000-0000-0000000000c2');
select public.story_save(null, '', 'Buy airtime in bulk and resell it to neighbours.', 'hustle', null, null, (select id from public.challenge_list where slug = '09'));
select pg_temp.expect((select title from public.stories where author_id = '00000000-0000-0000-0000-0000000000c2' and challenge_id = (select id from public.challenge_list where slug = '09')) = 'Challenge 09 answer', 'a short answer is accepted and titled for the writer');
select pg_temp.fails($$select public.story_save((select id from public.stories where author_id = '00000000-0000-0000-0000-0000000000c2' and challenge_id is not null limit 1), '', repeat('a', 301), 'hustle')$$, 'answers longer than the limit are refused');
select pg_temp.fails($$select public.story_save((select id from public.stories where author_id = '00000000-0000-0000-0000-0000000000c2' and challenge_id is not null limit 1), '', 'Too short', 'hustle')$$, 'answers need at least one full sentence');
reset role;
set role anon; select set_config('request.jwt.claims', '{"role":"anon"}', false);
select pg_temp.expect((select question from public.challenge_list where slug = '01') like 'One photo%', 'challenge 01 is the primary school photo challenge');
select pg_temp.expect((select phase from public.challenge_list where slug = '02') = 'upcoming' or now() > '2026-11-24', 'challenge 02 is scheduled for next week');
select pg_temp.expect((select sponsor_phone from public.challenge_list where slug = '01') = '+254705234763', 'the sponsor advert carries the school phone');
reset role;
select pg_temp.expect((select rules from public.challenges where slug = '01') like '%checked for originality%', 'challenge 01 rules explain the originality check');
select pg_temp.expect((select title from public.challenges where slug = '02') = 'The School Checklist', 'challenge 02 is the school checklist');
-- photo challenge (Challenge 01 after migration 0900)
reset role;
update public.challenges set entry_kind = 'photo', opens_at = now() - interval '1 hour', entries_close_at = now() + interval '5 days', voting_close_at = now() + interval '5 days', results_at = null, winner_story_id = null where slug = '01';
delete from public.stories where challenge_id = (select id from public.challenges where slug = '01');
set role authenticated; select pg_temp.as_user('00000000-0000-0000-0000-0000000000c1');
select pg_temp.fails($$select public.challenge_photo_submit((select id from public.challenge_list where slug = '01'), 'My class seven photo with Mr Mutua, the teacher who believed in me.', '00000000-0000-0000-0000-0000000000c1/p.jpg', false)$$, 'entrants must confirm the photo is their own');
select pg_temp.fails($$select public.challenge_photo_submit((select id from public.challenge_list where slug = '01'), 'My class seven photo with Mr Mutua, the teacher who believed in me.', null, true)$$, 'a photo challenge entry needs a photo');
select public.challenge_photo_submit((select id from public.challenge_list where slug = '01'), 'My class seven photo with Mr Mutua, the teacher who believed in me.', '00000000-0000-0000-0000-0000000000c1/p.jpg', true);
select pg_temp.expect((select status from public.stories where author_id = '00000000-0000-0000-0000-0000000000c1' and challenge_id = (select id from public.challenge_list where slug = '01')) = 'pending', 'photo entries wait for an originality check even from trusted writers');
select pg_temp.expect((select original_declared_at is not null from public.stories where author_id = '00000000-0000-0000-0000-0000000000c1' and challenge_id = (select id from public.challenge_list where slug = '01')), 'the originality declaration is recorded');
reset role;

-- SMS to entrants when an entry is approved
reset role;
update public.stories set status = 'pending' where challenge_id is not null and status = 'published' and id = (select id from public.stories where challenge_id is not null and status = 'published' limit 1);
update public.stories set status = 'published' where challenge_id is not null and status = 'pending';
do $$ begin
  if not exists (select 1 from public.sms_outbox where reason = 'entry_published' and message like '%/s/%') then raise exception 'FAILED: an approved entry queues an SMS with the vote link'; end if;
  raise notice 'ok: an approved entry queues an SMS with the vote link';
end $$;
