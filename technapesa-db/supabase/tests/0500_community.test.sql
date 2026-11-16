-- Community stories and challenges tests. Runs after the other tests (admin ...0a exists).
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
  ('00000000-0000-0000-0000-0000000000c1', 'writer@test.local', '{"full_name":"Mwende Writer","accepted_terms":true}'),
  ('00000000-0000-0000-0000-0000000000c2', 'reader@test.local', '{"full_name":"Kioko Reader","accepted_terms":true}'),
  ('00000000-0000-0000-0000-0000000000c3', 'judge@test.local', '{"full_name":"Judge Mutua","accepted_terms":true}');
insert into public.user_roles (user_id, role) values ('00000000-0000-0000-0000-0000000000c3', 'judge');

-- a new writer's first story waits for review
set role authenticated; select pg_temp.as_user('00000000-0000-0000-0000-0000000000c1');
select public.story_save(null, 'How I started selling eggs on WhatsApp', repeat('I started with ten hens and a WhatsApp status. ', 5), 'hustle');
select pg_temp.expect((select status from public.stories where title like 'How I started selling eggs%') = 'pending', 'a first story from a new writer waits for review');
select pg_temp.fails($$select public.story_save(null, 'Too short', 'Hi', 'tech')$$, 'very short stories are refused');
select pg_temp.fails($$select public.story_save(null, 'Bad photo story here', repeat('x', 100), 'tech', '00000000-0000-0000-0000-0000000000c2/a.jpg')$$, 'a writer cannot use another account''s photo');
reset role;
set role anon; select set_config('request.jwt.claims', '{"role":"anon"}', false);
select pg_temp.expect((select count(*) from public.community_feed) = 0, 'pending stories are not public');
reset role;

-- moderator publishes; then the writer is trusted and later stories publish straight away
set role authenticated; select pg_temp.as_user('00000000-0000-0000-0000-00000000000a');
select public.admin_review_story((select id from public.stories where title like 'How I started selling eggs%'), 'publish');
reset role;
set role authenticated; select pg_temp.as_user('00000000-0000-0000-0000-0000000000c1');
select public.story_save(null, 'Saving with M-PESA lock savings', repeat('Every Friday I lock part of my pay so I cannot spend it. ', 3), 'money');
select pg_temp.expect((select status from public.stories where title = 'Saving with M-PESA lock savings') = 'published', 'a trusted writer publishes straight away');
reset role;
set role anon; select set_config('request.jwt.claims', '{"role":"anon"}', false);
select pg_temp.expect((select count(*) from public.community_feed) = 2, 'the public feed shows published stories');
select pg_temp.expect((select author_name from public.community_feed limit 1) = 'Mwende Writer', 'the feed shows the writer''s name');
select pg_temp.fails($$select public.story_like((select id from public.community_feed limit 1))$$, 'visitors who are not signed in cannot like');
reset role;

-- likes and comments
set role authenticated; select pg_temp.as_user('00000000-0000-0000-0000-0000000000c2');
select pg_temp.expect(public.story_like((select id from public.community_feed where title = 'Saving with M-PESA lock savings')), 'a reader can like a story');
select pg_temp.expect((select like_count from public.community_feed where title = 'Saving with M-PESA lock savings') = 1, 'the like is counted');
select pg_temp.expect(not public.story_like((select id from public.community_feed where title = 'Saving with M-PESA lock savings')), 'liking again removes the like');
select public.comment_add((select id from public.community_feed where title = 'Saving with M-PESA lock savings'), 'Great idea, I will try this.');
select pg_temp.expect((select comment_count from public.community_feed where title = 'Saving with M-PESA lock savings') = 1, 'the comment is counted');
select pg_temp.fails($$update public.stories set status = 'published'$$, 'readers cannot change stories directly');
select pg_temp.fails($$select public.admin_review_story((select id from public.stories limit 1), 'remove', 'spam')$$, 'readers cannot moderate');
select public.report_content('story', (select id::text from public.community_feed where title = 'Saving with M-PESA lock savings'), 'Looks like spam');
reset role;
select pg_temp.expect((select count(*) from public.notifications where user_id = '00000000-0000-0000-0000-0000000000c1' and title like '%commented%') = 1, 'the writer is told about the comment');

-- moderation of a removed story and reports
set role authenticated; select pg_temp.as_user('00000000-0000-0000-0000-00000000000a');
select pg_temp.expect((select count(*) from public.admin_list_reports()) = 1, 'moderators see open reports');
select pg_temp.fails($$select public.admin_review_story((select id from public.stories where title = 'Saving with M-PESA lock savings'), 'remove')$$, 'removing needs a reason');
select public.admin_feature_story((select id from public.stories where title like 'How I started selling eggs%'), 'Story of the Month, November 2026');
select pg_temp.expect((select featured_label from public.community_feed where title like 'How I started selling eggs%') = 'Story of the Month, November 2026', 'a story can be featured as Story of the Month');
reset role;

-- Challenge 01 is published and open; entries, votes, judging and the winner
select pg_temp.expect((select phase from public.challenge_list where slug = '01') in ('open', 'upcoming', 'voting', 'judging'), 'challenge 01 is published');
update public.challenges set opens_at = now() - interval '1 day', entries_close_at = now() + interval '1 day', voting_close_at = now() + interval '2 days' where slug = '01';
set role authenticated; select pg_temp.as_user('00000000-0000-0000-0000-0000000000c1');
select public.story_save(null, 'My phone repair hustle in Tala', repeat('I learnt phone repair from videos and now fix phones for my neighbours. ', 3), 'hustle', null, null, (select id from public.challenges where slug = '01'));
select pg_temp.fails($$select public.story_save(null, 'A second entry for me', repeat('y', 100), 'tech', null, null, (select id from public.challenges where slug = '01'))$$, 'one entry per person per challenge');
select pg_temp.fails($$select public.challenge_vote((select id from public.stories where challenge_id is not null))$$, 'writers cannot vote for their own entry');
reset role;
set role authenticated; select pg_temp.as_user('00000000-0000-0000-0000-0000000000c2');
select public.challenge_vote((select id from public.community_feed where challenge_id is not null));
select public.challenge_vote((select id from public.community_feed where challenge_id is not null));
select pg_temp.expect((select count(*) from public.challenge_votes) = 1, 'one vote per reader per challenge');
select pg_temp.fails($$select public.judge_score((select id from public.community_feed where challenge_id is not null), 9)$$, 'readers cannot judge');
select pg_temp.fails($$select * from public.challenge_results((select id from public.challenges where slug = '01'))$$, 'results stay private until announced');
reset role;
set role authenticated; select pg_temp.as_user('00000000-0000-0000-0000-0000000000c3');
select public.judge_score((select id from public.stories where challenge_id is not null), 8, 'Clear and useful');
select pg_temp.expect((select total from public.challenge_results((select id from public.challenges where slug = '01')) limit 1) = 86.0, 'the result combines judges (70) and votes (30)');
reset role;
set role authenticated; select pg_temp.as_user('00000000-0000-0000-0000-00000000000a');
select pg_temp.fails($$select public.admin_challenge_winner((select id from public.challenges where slug = '01'), (select id from public.stories where challenge_id is not null))$$, 'no winner before voting closes');
reset role;
update public.challenges set entries_close_at = now() - interval '2 hours', voting_close_at = now() - interval '1 hour' where slug = '01';
set role authenticated; select pg_temp.as_user('00000000-0000-0000-0000-0000000000c2');
select pg_temp.fails($$select public.challenge_vote((select id from public.community_feed where challenge_id is not null))$$, 'no votes after voting closes');
reset role;
set role authenticated; select pg_temp.as_user('00000000-0000-0000-0000-00000000000a');
select public.admin_challenge_winner((select id from public.challenges where slug = '01'), (select id from public.stories where challenge_id is not null), 'Congratulations');
select pg_temp.expect((select count(*) from public.admin_challenge_contact((select id from public.challenges where slug = '01'))) = 1, 'staff can see the winner''s contact to send the prize');
reset role;
set role anon; select set_config('request.jwt.claims', '{"role":"anon"}', false);
select pg_temp.expect((select phase from public.challenge_list where slug = '01') = 'results', 'results are public once announced');
select pg_temp.expect((select count(*) from public.challenge_results((select id from public.challenge_list where slug = '01'))) = 1, 'anyone can see the final ranking');
reset role;
select pg_temp.expect((select count(*) from public.audit_log where action like 'story.%' or action like 'challenge.%') >= 3, 'moderation and results are audited');
