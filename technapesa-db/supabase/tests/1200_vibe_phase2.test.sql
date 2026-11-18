-- TnPVibe phase 2: communities, circles, stories, polls, events, questions, spotlight and points.
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
create temp table v2 (k text primary key, v text); grant all on v2 to authenticated, anon;
insert into auth.users (id, email, raw_user_meta_data) values
  ('00000000-0000-0000-0000-00000000f2a1', 'p2a@test.local', '{"full_name":"Pat Owner","accepted_terms":true}'),
  ('00000000-0000-0000-0000-00000000f2b2', 'p2b@test.local', '{"full_name":"Quinn Member","accepted_terms":true}'),
  ('00000000-0000-0000-0000-00000000f2c3', 'p2c@test.local', '{"full_name":"Ray Outsider","accepted_terms":true}');
set role authenticated;
select pg_temp.as_user('00000000-0000-0000-0000-00000000f2a1'); select public.vibe_join('pat_owner', true);
select pg_temp.as_user('00000000-0000-0000-0000-00000000f2b2'); select public.vibe_join('quinn_m', true);
select pg_temp.as_user('00000000-0000-0000-0000-00000000f2c3'); select public.vibe_join('ray_out', true);

-- Communities
select pg_temp.as_user('00000000-0000-0000-0000-00000000f2a1');
insert into v2 select 'pub', public.vibe_community_save('{"name":"Machakos Coders","description":"Learn to code together","category":"technology"}')->>'slug';
insert into v2 select 'priv', public.vibe_community_save('{"name":"Founders Room","category":"entrepreneurship","visibility":"private","rules":"Be kind"}')->>'slug';
reset role; insert into v2 select 'pubid', id from public.vibe_communities where slug = 'machakos-coders'; insert into v2 select 'privid', id from public.vibe_communities where slug = 'founders-room'; set role authenticated;
select pg_temp.expect((select v from v2 where k = 'pub') = 'machakos-coders', 'a community gets a clean web address');
select pg_temp.expect(public.vibe_community((select v from v2 where k = 'pub'))->>'my_role' = 'owner', 'the creator owns the community');
select pg_temp.as_user('00000000-0000-0000-0000-00000000f2b2');
select public.vibe_community_join((select v from v2 where k = 'pub'), true);
select pg_temp.expect((public.vibe_community((select v from v2 where k = 'pub'))->>'members')::int = 2, 'joining a public community counts the member');
select pg_temp.expect(public.vibe_community_join((select v from v2 where k = 'priv'), true)->>'my_status' = 'pending', 'joining a private community needs approval');
select pg_temp.fails($$select public.vibe_post_save(null, 'post', 'Hello founders', '{}', (select v::bigint from v2 where k = 'privid'))$$, 'pending members cannot post in a private community');
select pg_temp.as_user('00000000-0000-0000-0000-00000000f2a1');
select pg_temp.expect((public.vibe_community((select v from v2 where k = 'priv'))->>'pending')::int = 1, 'the owner sees one pending request');
select public.vibe_post_save(null, 'post', 'Secret founder plans', '{}', (select v::bigint from v2 where k = 'privid'));
select pg_temp.as_user('00000000-0000-0000-0000-00000000f2c3');
select pg_temp.expect(jsonb_array_length(public.vibe_feed('community:founders-room')) = 0, 'outsiders cannot read a private community');
select pg_temp.expect(jsonb_array_length(public.vibe_feed('all')) = 0, 'private community posts never reach the public feed');
select pg_temp.as_user('00000000-0000-0000-0000-00000000f2a1');
select public.vibe_community_member((select v::bigint from v2 where k = 'privid'), '00000000-0000-0000-0000-00000000f2b2', 'approve');
select pg_temp.as_user('00000000-0000-0000-0000-00000000f2b2');
select pg_temp.expect(jsonb_array_length(public.vibe_feed('community:founders-room')) = 1, 'approved members read the private community');
select pg_temp.expect(jsonb_array_length(public.vibe_feed('following')) = 1, 'community posts reach members in their following feed');
select pg_temp.fails($$select public.vibe_community_member((select v::bigint from v2 where k = 'privid'), '00000000-0000-0000-0000-00000000f2a1', 'remove')$$, 'ordinary members cannot remove others');
insert into v2 select 'cp', public.vibe_post_save(null, 'post', 'Buy cheap followers here', '{}', (select v::bigint from v2 where k = 'pubid'))->>'id';
select pg_temp.as_user('00000000-0000-0000-0000-00000000f2a1');
select public.vibe_community_member((select v::bigint from v2 where k = 'pubid'), '00000000-0000-0000-0000-00000000f2b2', 'make_moderator');
select public.vibe_community_remove_post((select v::bigint from v2 where k = 'cp'), 'spam');
reset role; select pg_temp.expect((select removed_at is not null from public.vibe_posts where id = (select v::bigint from v2 where k = 'cp')), 'community owners can remove posts'); set role authenticated;
select pg_temp.as_user('00000000-0000-0000-0000-00000000f2b2');
select pg_temp.fails($$select public.vibe_community_member((select v::bigint from v2 where k = 'pubid'), '00000000-0000-0000-0000-00000000f2a1', 'ban')$$, 'moderators cannot ban the owner');
select public.vibe_community_join((select v from v2 where k = 'pub'), false);
select pg_temp.expect((public.vibe_community((select v from v2 where k = 'pub'))->>'members')::int = 1, 'leaving lowers the member count');

-- Circles
select pg_temp.as_user('00000000-0000-0000-0000-00000000f2a1');
insert into v2 select 'circle', public.vibe_circle_create('Study buddies', 'CPA revision', 'study');
select public.vibe_circle_invite((select v::uuid from v2 where k = 'circle'), '00000000-0000-0000-0000-00000000f2b2');
select pg_temp.as_user('00000000-0000-0000-0000-00000000f2b2');
select pg_temp.expect(public.vibe_circle((select v::uuid from v2 where k = 'circle'))->>'my_status' = 'invited', 'an invited member sees the invitation');
select pg_temp.expect(public.vibe_circle((select v::uuid from v2 where k = 'circle'))->>'conversation_id' is null, 'invited members cannot see the chat yet');
select public.vibe_circle_respond((select v::uuid from v2 where k = 'circle'), true);
insert into v2 select 'cconv', public.vibe_circle((select v::uuid from v2 where k = 'circle'))->>'conversation_id';
select public.vibe_message_send((select v::uuid from v2 where k = 'cconv'), 'text', 'Hi study group');
select public.vibe_post_save(null, 'update', 'Chapter 3 notes are ready', '{}', null, (select v::uuid from v2 where k = 'circle'));
select pg_temp.as_user('00000000-0000-0000-0000-00000000f2a1');
select pg_temp.expect((public.vibe_whoami()->>'unread_messages')::int = 1, 'circle members get the group message');
select pg_temp.expect(jsonb_array_length(public.vibe_feed('circle:' || (select v from v2 where k = 'circle'))) = 1, 'circle updates show to members');
select pg_temp.expect(jsonb_array_length(public.vibe_feed('following')) = 1, 'circle updates stay out of the main feed');
select pg_temp.as_user('00000000-0000-0000-0000-00000000f2c3');
select pg_temp.fails($$select public.vibe_message_send((select v::uuid from v2 where k = 'cconv'), 'text', 'let me in')$$, 'outsiders cannot write in a circle');
select pg_temp.expect(public.vibe_circle((select v::uuid from v2 where k = 'circle')) is null, 'outsiders cannot see a circle');

-- Stories
select pg_temp.as_user('00000000-0000-0000-0000-00000000f2b2');
select public.vibe_follow('00000000-0000-0000-0000-00000000f2a1', true);
select pg_temp.as_user('00000000-0000-0000-0000-00000000f2a1');
insert into v2 select 'story', public.vibe_story_add(null, 'Great day at the market', 'green');
select pg_temp.as_user('00000000-0000-0000-0000-00000000f2b2');
select pg_temp.expect(jsonb_array_length(public.vibe_stories_bar()) = 1, 'followers see the story in their bar');
select pg_temp.expect(jsonb_array_length(public.vibe_stories_of('00000000-0000-0000-0000-00000000f2a1')) = 1, 'a follower opens the story');
select pg_temp.as_user('00000000-0000-0000-0000-00000000f2c3');
select pg_temp.expect(jsonb_array_length(public.vibe_stories_of('00000000-0000-0000-0000-00000000f2a1')) = 0, 'stories are for followers by default');
select pg_temp.as_user('00000000-0000-0000-0000-00000000f2a1');
select pg_temp.expect(jsonb_array_length(public.vibe_story_viewers((select v::bigint from v2 where k = 'story'))) = 1, 'the author sees who viewed the story');
reset role; update public.vibe_stories set expires_at = now() - interval '1 minute'; set role authenticated;
select pg_temp.as_user('00000000-0000-0000-0000-00000000f2b2');
select pg_temp.expect(jsonb_array_length(public.vibe_stories_bar()) = 0, 'stories disappear after 24 hours');

-- Polls
select pg_temp.as_user('00000000-0000-0000-0000-00000000f2a1');
select pg_temp.fails($$select public.vibe_post_save(null, 'poll', 'Best day to meet?', '{}', null, null, null, '{"options":["Saturday"]}')$$, 'a poll needs at least two options');
insert into v2 select 'poll', public.vibe_post_save(null, 'poll', 'Best day to meet?', '{}', null, null, null, '{"options":["Saturday","Sunday"],"days":3}')->>'id';
reset role; insert into v2 select 'o1', min(id) from public.vibe_poll_options; insert into v2 select 'o2', max(id) from public.vibe_poll_options; set role authenticated;
select pg_temp.as_user('00000000-0000-0000-0000-00000000f2b2');
select public.vibe_poll_vote((select v::bigint from v2 where k = 'poll'), array[(select v::bigint from v2 where k = 'o1')]);
select pg_temp.fails($$select public.vibe_poll_vote((select v::bigint from v2 where k = 'poll'), array[(select v::bigint from v2 where k = 'o1'), (select v::bigint from v2 where k = 'o2')])$$, 'single choice polls refuse two options');
select public.vibe_poll_vote((select v::bigint from v2 where k = 'poll'), array[(select v::bigint from v2 where k = 'o2')]);
reset role;
select pg_temp.expect((select sum(votes) from public.vibe_poll_options) = 1 and (select votes from public.vibe_poll_options order by id desc limit 1) = 1, 'changing a vote moves it, one vote per member');
update public.vibe_polls set closes_at = now() - interval '1 minute';
set role authenticated;
select pg_temp.fails($$select public.vibe_poll_vote((select v::bigint from v2 where k = 'poll'), array[(select v::bigint from v2 where k = 'o1')])$$, 'closed polls take no votes');

-- Events
select pg_temp.as_user('00000000-0000-0000-0000-00000000f2a1');
select pg_temp.fails($$select public.vibe_event_save('{"title":"Past meetup","mode":"physical","venue":"Machakos","starts_at":"2020-01-01T10:00:00Z"}')$$, 'events cannot start in the past');
insert into v2 select 'ev', public.vibe_event_save(jsonb_build_object('title', 'Coders online hangout', 'mode', 'online', 'online_link', 'https://meet.example/abc', 'starts_at', now() + interval '20 hours', 'capacity', 2))->>'id';
select pg_temp.as_user('00000000-0000-0000-0000-00000000f2c3');
select pg_temp.expect(public.vibe_event((select v::bigint from v2 where k = 'ev'))->>'online_link' is null, 'the joining link stays hidden until you RSVP');
select pg_temp.expect(public.vibe_event_rsvp((select v::bigint from v2 where k = 'ev'), 'going')->>'online_link' = 'https://meet.example/abc', 'going members see the joining link');
select pg_temp.as_user('00000000-0000-0000-0000-00000000f2b2');
select pg_temp.fails($$select public.vibe_event_rsvp((select v::bigint from v2 where k = 'ev'), 'going')$$, 'a full event refuses more people');
select public.vibe_event_rsvp((select v::bigint from v2 where k = 'ev'), 'interested');
reset role; select pg_temp.expect((public.vibe_hourly()->>'reminded_events')::int = 1, 'reminders go out a day before'); set role authenticated;
select pg_temp.as_user('00000000-0000-0000-0000-00000000f2c3');
select public.vibe_event_rsvp((select v::bigint from v2 where k = 'ev'), null);
select pg_temp.expect((public.vibe_event((select v::bigint from v2 where k = 'ev'))->>'going')::int = 1, 'cancelling attendance updates the count');

-- Questions and helpful answers
select pg_temp.as_user('00000000-0000-0000-0000-00000000f2c3');
insert into v2 select 'q', public.vibe_post_save(null, 'question', 'How do I register a business name in Kenya?', '{}', null, null, 'business')->>'id';
select pg_temp.as_user('00000000-0000-0000-0000-00000000f2b2');
insert into v2 select 'ans', public.vibe_comment_add((select v::bigint from v2 where k = 'q'), 'Use the eCitizen business registration service.')->>'id';
select pg_temp.as_user('00000000-0000-0000-0000-00000000f2a1');
select public.vibe_comment_like((select v::bigint from v2 where k = 'ans'), true);
select pg_temp.fails($$select public.vibe_accept_answer((select v::bigint from v2 where k = 'q'), (select v::bigint from v2 where k = 'ans'))$$, 'only the asker chooses the helpful answer');
select pg_temp.as_user('00000000-0000-0000-0000-00000000f2c3');
select public.vibe_accept_answer((select v::bigint from v2 where k = 'q'), (select v::bigint from v2 where k = 'ans'));
select pg_temp.expect((public.vibe_comments_list((select v::bigint from v2 where k = 'q'))->0->>'accepted')::boolean and (public.vibe_comments_list((select v::bigint from v2 where k = 'q'))->0->>'likes')::int = 1, 'the helpful answer is marked and shows its likes');
select pg_temp.expect(jsonb_array_length(public.vibe_questions('register')) = 1, 'questions can be searched');

-- Spotlight
select pg_temp.fails($$select public.admin_vibe_spotlight_save('quinn_m', 'Top helper this week', 'Quinn answered many questions and helped new members find their way.')$$, 'members cannot add spotlights');
reset role; insert into public.user_roles (user_id, role) values ('00000000-0000-0000-0000-00000000f2a1', 'moderator'); set role authenticated;
select pg_temp.as_user('00000000-0000-0000-0000-00000000f2a1');
select public.admin_vibe_spotlight_save('quinn_m', 'Top helper this week', 'Quinn answered many questions and helped new members find their way.');
select pg_temp.expect(jsonb_array_length(public.vibe_spotlights_list()) = 1, 'moderators feature members in the spotlight');

-- Points
reset role;
select pg_temp.expect((select points from public.point_events where user_id = '00000000-0000-0000-0000-00000000f2b2' and kind = 'vibe_answer') = 10, 'a helpful answer earns points');
select pg_temp.expect(exists (select 1 from public.point_events where user_id = '00000000-0000-0000-0000-00000000f2a1' and kind = 'vibe_community'), 'creating a community earns points');
select pg_temp.expect(not exists (select 1 from public.point_events where kind = 'vibe_post' and ref = (select v from v2 where k = 'cp')), 'a removed post loses its points');
select pg_temp.expect(not exists (select 1 from public.point_events p join public.vibe_posts x on x.id::text = p.ref where p.kind = 'vibe_post' and x.circle_id is not null), 'circle posts earn no points');
