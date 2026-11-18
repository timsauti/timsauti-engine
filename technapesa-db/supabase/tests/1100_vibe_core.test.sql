-- TnPVibe core: joining, profiles, privacy, follows, blocks, posts, likes, comments, messages, reports, moderation.
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
create temp table vv (k text primary key, v text); grant all on vv to authenticated, anon;
insert into auth.users (id, email, raw_user_meta_data) values
  ('00000000-0000-0000-0000-00000000f1a1', 'amina.vibe@test.local', '{"full_name":"Amina Wanjiru","accepted_terms":true}'),
  ('00000000-0000-0000-0000-00000000f1b2', 'brian.vibe@test.local', '{"full_name":"Brian Otieno","accepted_terms":true}'),
  ('00000000-0000-0000-0000-00000000f1c3', 'carol.vibe@test.local', '{"full_name":"Carol Mutua","accepted_terms":true}'),
  ('00000000-0000-0000-0000-00000000f1d4', 'mod.vibe@test.local', '{"full_name":"Mo Derator","accepted_terms":true}');
insert into public.user_roles (user_id, role) values ('00000000-0000-0000-0000-00000000f1d4', 'moderator');

-- Joining
set role authenticated; select pg_temp.as_user('00000000-0000-0000-0000-00000000f1a1');
select pg_temp.fails($$select public.vibe_post_save(null, 'post', 'hello')$$, 'you must join TnPVibe before posting');
select pg_temp.fails($$select public.vibe_join('amina', false)$$, 'members must confirm they are 18 or older');
select pg_temp.fails($$select public.vibe_join('ad', true)$$, 'usernames need at least 3 characters');
select pg_temp.fails($$select public.vibe_join('admin', true)$$, 'reserved usernames are refused');
select pg_temp.expect(public.vibe_join('Amina_W', true, 'Web designer, Machakos', array['Technology', 'design', 'Design', '  farming ']) = 'amina_w', 'a member joins with a lower case username');
reset role; select pg_temp.expect((select interests from public.vibe_profiles where username = 'amina_w') = array['Technology', 'design', 'farming'], 'interests are cleaned and duplicates removed'); set role authenticated;
select pg_temp.expect(public.vibe_join('another', true) = 'amina_w', 'joining twice keeps the same profile');
select pg_temp.as_user('00000000-0000-0000-0000-00000000f1b2');
select pg_temp.fails($$select public.vibe_join('amina_w', true)$$, 'a username can only be used once');
select public.vibe_join('brian', true, 'Farmer and coder', array['farming', 'coding']);
select pg_temp.as_user('00000000-0000-0000-0000-00000000f1c3');
select public.vibe_join('carol', true, 'Student', array['music']);
select pg_temp.as_user('00000000-0000-0000-0000-00000000f1d4');
select public.vibe_join('mo_mod', true);

-- Profiles
select pg_temp.as_user('00000000-0000-0000-0000-00000000f1a1');
select public.vibe_profile_save('{"name":"Amina W.","bio":"I build websites for small shops.","location":"Machakos","skills":["Web design","Canva"],"website":"https://amina.example","socials":{"facebook":"https://facebook.com/amina","evil":"https://x.example"}}');
reset role; select pg_temp.expect((select display_name from public.profiles where id = '00000000-0000-0000-0000-00000000f1a1') = 'Amina W.', 'the profile name is saved on the account'); set role authenticated;
reset role; select pg_temp.expect((select socials from public.vibe_profiles where username = 'amina_w') = '{"facebook":"https://facebook.com/amina"}', 'only known social links are kept'); set role authenticated;
select pg_temp.fails($$select public.vibe_profile_save('{"avatar_path":"00000000-0000-0000-0000-00000000f1b2/face.jpg"}')$$, 'a member cannot use another member''s photo');
select public.vibe_profile_save('{"avatar_path":"00000000-0000-0000-0000-00000000f1a1/face.jpg"}');
select pg_temp.expect((public.vibe_profile('amina_w')->>'is_me')::boolean, 'a member sees their own profile');
reset role; set role anon; select set_config('request.jwt.claims', '{"role":"anon"}', false);
select pg_temp.expect(public.vibe_profile('amina_w')->>'name' = 'Amina W.', 'visitors can see a public profile');
select pg_temp.expect(public.vibe_profile('amina_w')->>'phone' is null, 'profiles never include phone numbers');
reset role; set role authenticated; select pg_temp.as_user('00000000-0000-0000-0000-00000000f1c3');
select public.vibe_privacy_save('{"visibility":"members","who_can_message":"followers","show_online":false}');
select public.vibe_heartbeat();
reset role; set role anon; select set_config('request.jwt.claims', '{"role":"anon"}', false);
select pg_temp.expect(public.vibe_profile('carol') is null, 'a members only profile is hidden from visitors');
reset role; set role authenticated; select pg_temp.as_user('00000000-0000-0000-0000-00000000f1a1');
select pg_temp.expect(public.vibe_profile('carol') is not null, 'members can see a members only profile');
select pg_temp.expect((public.vibe_profile('carol')->>'online')::boolean is false and public.vibe_profile('carol')->>'last_active' is null, 'a member who hides online status never shows as online');

-- Presence
select public.vibe_heartbeat();
select pg_temp.expect((public.vibe_profile('amina_w')->>'online')::boolean, 'a member with a recent heartbeat shows as online');
reset role; update public.vibe_profiles set last_active_at = now() - interval '10 minutes' where username = 'amina_w';
set role authenticated; select pg_temp.as_user('00000000-0000-0000-0000-00000000f1b2');
select pg_temp.expect(not (public.vibe_profile('amina_w')->>'online')::boolean, 'a member with no heartbeat for 10 minutes is offline');

-- Follows
select pg_temp.fails($$select public.vibe_follow('00000000-0000-0000-0000-00000000f1b2', true)$$, 'nobody can follow themselves');
select public.vibe_follow('00000000-0000-0000-0000-00000000f1a1', true);
select public.vibe_follow('00000000-0000-0000-0000-00000000f1a1', true);
reset role; select pg_temp.expect((select followers_count from public.vibe_profiles where username = 'amina_w') = 1, 'following twice counts once'); set role authenticated;
reset role; select pg_temp.expect((select count(*) from public.notifications where user_id = '00000000-0000-0000-0000-00000000f1a1' and topic = 'social') = 1, 'a new follower creates one notification'); set role authenticated;
select pg_temp.as_user('00000000-0000-0000-0000-00000000f1c3');
select public.vibe_follow('00000000-0000-0000-0000-00000000f1a1', true);
select pg_temp.as_user('00000000-0000-0000-0000-00000000f1a1');
select public.vibe_follow('00000000-0000-0000-0000-00000000f1b2', true);
select pg_temp.expect((public.vibe_profile('amina_w')->>'followers')::int = 2 and (public.vibe_profile('amina_w')->>'following')::int = 1, 'follower and following counts are right');
select pg_temp.expect(jsonb_array_length(public.vibe_connections('amina_w', 'followers')) = 2, 'the followers list matches the count');
select pg_temp.as_user('00000000-0000-0000-0000-00000000f1c3');
select public.vibe_follow('00000000-0000-0000-0000-00000000f1a1', false);
reset role; select pg_temp.expect((select followers_count from public.vibe_profiles where username = 'amina_w') = 1, 'unfollowing lowers the count'); set role authenticated;
set role authenticated;
select pg_temp.fails($$insert into public.vibe_follows (follower, followee) values ('00000000-0000-0000-0000-00000000f1c3', '00000000-0000-0000-0000-00000000f1a1')$$, 'nobody writes follows directly');

-- Discovery
set role authenticated; select pg_temp.as_user('00000000-0000-0000-0000-00000000f1c3');
select pg_temp.expect(jsonb_array_length(public.vibe_people('farm')) = 2, 'people search finds members by interest');
select pg_temp.expect((select bool_and(x->>'username' <> 'carol') from jsonb_array_elements(public.vibe_people('')) x), 'people search never lists the searcher');
select pg_temp.expect(jsonb_array_length(public.vibe_people('', 'coding')) = 1, 'the interest filter works');

-- Posts, likes, comments
select pg_temp.as_user('00000000-0000-0000-0000-00000000f1a1');
insert into vv select 'p1', public.vibe_post_save(null, 'idea', 'Small shops in Machakos need simple websites. Who wants to team up?')->>'id';
select pg_temp.fails($$select public.vibe_post_save(null, 'post', '   ')$$, 'empty posts are refused');
select pg_temp.fails($$select public.vibe_post_save(null, 'post', 'look', array['00000000-0000-0000-0000-00000000f1b2/x.jpg'])$$, 'posts cannot use someone else''s photos');
reset role; select pg_temp.expect((select posts_count from public.vibe_profiles where username = 'amina_w') = 1, 'the post count goes up'); set role authenticated;
select pg_temp.as_user('00000000-0000-0000-0000-00000000f1b2');
select pg_temp.expect(jsonb_array_length(public.vibe_feed('following')) = 1, 'the following feed shows posts of people I follow');
select public.vibe_like((select v::bigint from vv where k = 'p1'), true);
select public.vibe_like((select v::bigint from vv where k = 'p1'), true);
reset role; select pg_temp.expect((select likes_count from public.vibe_posts where id = (select v::bigint from vv where k = 'p1')) = 1, 'a post is liked once per member'); set role authenticated;
insert into vv select 'c1', public.vibe_comment_add((select v::bigint from vv where k = 'p1'), 'I am in! I can do the hosting.')->>'id';
select pg_temp.as_user('00000000-0000-0000-0000-00000000f1a1');
select public.vibe_comment_add((select v::bigint from vv where k = 'p1'), 'Great, let us talk.', (select v::bigint from vv where k = 'c1'));
reset role; select pg_temp.expect((select comments_count from public.vibe_posts where id = (select v::bigint from vv where k = 'p1')) = 2, 'comments and replies are counted'); set role authenticated;
select pg_temp.expect(jsonb_array_length(public.vibe_comments_list((select v::bigint from vv where k = 'p1'))) = 2, 'comments and replies are listed');
reset role; select pg_temp.expect((select count(*) from public.notifications where user_id = '00000000-0000-0000-0000-00000000f1b2' and title like '%replied%') = 1, 'the commenter hears about the reply'); set role authenticated;
select pg_temp.as_user('00000000-0000-0000-0000-00000000f1b2');
select public.vibe_like((select v::bigint from vv where k = 'p1'), false);
reset role; select pg_temp.expect((select likes_count from public.vibe_posts where id = (select v::bigint from vv where k = 'p1')) = 0, 'unliking lowers the count'); set role authenticated;
select pg_temp.fails($$select public.vibe_post_delete((select v::bigint from vv where k = 'p1'))$$, 'members cannot delete other people''s posts');
select pg_temp.as_user('00000000-0000-0000-0000-00000000f1a1');
select public.vibe_comment_delete((select v::bigint from vv where k = 'c1'));
reset role; select pg_temp.expect((select comments_count from public.vibe_posts where id = (select v::bigint from vv where k = 'p1')) = 0, 'removing a comment also removes its replies from the count'); set role authenticated;

-- Messages
select pg_temp.as_user('00000000-0000-0000-0000-00000000f1b2');
select pg_temp.fails($$select public.vibe_conversation_open('00000000-0000-0000-0000-00000000f1c3')$$, 'members who only accept followers cannot be messaged by others');
insert into vv select 'conv', public.vibe_conversation_open('00000000-0000-0000-0000-00000000f1a1');
select pg_temp.expect(public.vibe_conversation_open('00000000-0000-0000-0000-00000000f1a1')::text = (select v from vv where k = 'conv'), 'two members share one conversation');
select public.vibe_message_send((select v::uuid from vv where k = 'conv'), 'text', 'Hi Amina, about the websites idea');
select public.vibe_message_send((select v::uuid from vv where k = 'conv'), 'text', 'Are you free on Friday?');
select pg_temp.fails($$select public.vibe_message_send((select v::uuid from vv where k = 'conv'), 'image', '', '00000000-0000-0000-0000-00000000f1b2/x.jpg')$$, 'attachments must sit in the conversation folder');
select pg_temp.as_user('00000000-0000-0000-0000-00000000f1a1');
select pg_temp.expect((public.vibe_whoami()->>'unread_messages')::int = 2, 'the receiver has two unread messages');
reset role; select pg_temp.expect((select count(*) from public.notifications where user_id = '00000000-0000-0000-0000-00000000f1a1' and topic = 'messages') = 1, 'many messages create one notification until it is read'); set role authenticated;
select pg_temp.expect(jsonb_array_length(public.vibe_messages_list((select v::uuid from vv where k = 'conv'))->'messages') = 2, 'the receiver reads the conversation');
select public.vibe_conversation_read((select v::uuid from vv where k = 'conv'));
select pg_temp.expect((public.vibe_whoami()->>'unread_messages')::int = 0, 'reading clears the unread count');
select pg_temp.expect((select count(*) from public.vibe_messages) = 2, 'members see only their own conversations through the table');
select pg_temp.as_user('00000000-0000-0000-0000-00000000f1c3');
select pg_temp.expect((select count(*) from public.vibe_messages) = 0, 'outsiders cannot read a conversation');
select pg_temp.fails($$select public.vibe_messages_list((select v::uuid from vv where k = 'conv'))$$, 'outsiders cannot open a conversation');
select pg_temp.fails($$select public.vibe_message_send((select v::uuid from vv where k = 'conv'), 'text', 'let me in')$$, 'outsiders cannot post into a conversation');

-- Blocking
select pg_temp.as_user('00000000-0000-0000-0000-00000000f1a1');
select public.vibe_block('00000000-0000-0000-0000-00000000f1b2', true);
reset role; select pg_temp.expect(not exists (select 1 from public.vibe_follows where follower in ('00000000-0000-0000-0000-00000000f1a1', '00000000-0000-0000-0000-00000000f1b2') and followee in ('00000000-0000-0000-0000-00000000f1a1', '00000000-0000-0000-0000-00000000f1b2')), 'blocking removes follows both ways'); set role authenticated;
select pg_temp.as_user('00000000-0000-0000-0000-00000000f1b2');
select pg_temp.fails($$select public.vibe_message_send((select v::uuid from vv where k = 'conv'), 'text', 'hello?')$$, 'a blocked member cannot send messages');
select pg_temp.expect(public.vibe_profile('amina_w') is null, 'a blocked member cannot see the profile');
select pg_temp.fails($$select public.vibe_like((select v::bigint from vv where k = 'p1'), true)$$, 'a blocked member cannot like posts');
select pg_temp.expect(jsonb_array_length(public.vibe_people('amina')) = 0, 'a blocked member does not find the blocker in search');
select pg_temp.as_user('00000000-0000-0000-0000-00000000f1a1');
select public.vibe_block('00000000-0000-0000-0000-00000000f1b2', false);

-- Reports and moderation
select pg_temp.as_user('00000000-0000-0000-0000-00000000f1c3');
select public.vibe_report('post', (select v from vv where k = 'p1'), 'spam', 'looks like an advert');
select pg_temp.fails($$select public.vibe_report('message', (select min(id)::text from public.vibe_messages), 'harassment')$$, 'members cannot report messages from conversations they are not in');
select pg_temp.fails($$select public.admin_vibe_reports()$$, 'members cannot see the reports queue');
select pg_temp.as_user('00000000-0000-0000-0000-00000000f1a1');
select pg_temp.fails($$select public.vibe_report('post', (select v from vv where k = 'p1'), 'spam')$$, 'members cannot report their own posts');
select pg_temp.as_user('00000000-0000-0000-0000-00000000f1d4');
select pg_temp.expect(jsonb_array_length(public.admin_vibe_reports()) = 1, 'moderators see open reports');
reset role; insert into vv select 'r1', id from public.vibe_reports limit 1; set role authenticated;
select public.admin_vibe_report_decide((select v::bigint from vv where k = 'r1'), 'remove', 'advertising');
reset role; select pg_temp.expect((select removed_at is not null from public.vibe_posts where id = (select v::bigint from vv where k = 'p1')), 'a moderator can remove a reported post'); set role authenticated;
reset role; select pg_temp.expect((select posts_count from public.vibe_profiles where username = 'amina_w') = 0, 'removed posts leave the count'); set role authenticated;
select pg_temp.fails($$select public.admin_vibe_report_decide((select v::bigint from vv where k = 'r1'), 'suspend')$$, 'moderators cannot suspend whole accounts');
select pg_temp.expect((public.admin_vibe_stats()->>'members')::int = 4, 'statistics count real members');
select pg_temp.as_user('00000000-0000-0000-0000-00000000f1b2');
select pg_temp.expect(public.vibe_post((select v::bigint from vv where k = 'p1')) is null, 'removed posts are hidden from members');

-- Deactivation
select pg_temp.as_user('00000000-0000-0000-0000-00000000f1c3');
select public.vibe_deactivate();
select pg_temp.as_user('00000000-0000-0000-0000-00000000f1b2');
select pg_temp.expect(public.vibe_profile('carol') is null, 'a deactivated profile is hidden');
select pg_temp.as_user('00000000-0000-0000-0000-00000000f1c3');
select pg_temp.expect(public.vibe_join('ignored', true) = 'carol', 'a deactivated member can come back');
reset role;
