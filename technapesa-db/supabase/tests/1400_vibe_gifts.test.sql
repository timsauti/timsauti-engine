-- TnPVibe gifts: Till payment, staff check, creator share and payout.
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
  ('00000000-0000-0000-0000-00000000d0a1', 'gift1@test.local', '{"full_name":"Wanza Creator","accepted_terms":true}'),
  ('00000000-0000-0000-0000-00000000d0b2', 'gift2@test.local', '{"full_name":"Musyoka Fan","accepted_terms":true}');
create temp table gv (k text primary key, v text);
grant all on gv to authenticated;
set role authenticated;
select pg_temp.as_user('00000000-0000-0000-0000-00000000d0a1'); select public.vibe_join('wanza_c', true);
insert into gv select 'post', public.vibe_post_save(null, 'post', 'My new song about Kangundo is out this week.')->>'id';
select pg_temp.as_user('00000000-0000-0000-0000-00000000d0b2'); select public.vibe_join('musyoka_f', true);

select pg_temp.expect(not (public.vibe_gift_info('00000000-0000-0000-0000-00000000d0a1')->>'open')::boolean, 'gifts are closed until the owner switches them on');
select pg_temp.fails($$select public.vibe_gift_send('00000000-0000-0000-0000-00000000d0a1', null, 'chai', 'SKL2ABC3DE')$$, 'no gift can be sent while gifts are off');
reset role;
update public.site_settings set value = value || '{"on": true, "till": "123456"}'::jsonb where key = 'vibe.gifts';
set role authenticated;
select pg_temp.expect(not (public.vibe_gift_info('00000000-0000-0000-0000-00000000d0a1')->>'open')::boolean, 'a creator receives gifts only after choosing to');
select pg_temp.as_user('00000000-0000-0000-0000-00000000d0a1');
select pg_temp.fails($$select public.vibe_gift_settings_save(true, '')$$, 'a payout number is needed to accept gifts');
select public.vibe_gift_settings_save(true, '0712 345 678');
select pg_temp.expect(public.vibe_my_gifts()->>'payout_phone' = '+254712345678', 'the payout number is saved in full');
select pg_temp.fails($$select public.vibe_gift_send('00000000-0000-0000-0000-00000000d0a1', null, 'chai', 'SKL2ABC3DE')$$, 'creators cannot gift themselves');

select pg_temp.as_user('00000000-0000-0000-0000-00000000d0b2');
select pg_temp.expect((public.vibe_gift_info('00000000-0000-0000-0000-00000000d0a1')->>'open')::boolean, 'the Gift button opens once the creator accepts');
select pg_temp.fails($$select public.vibe_gift_send('00000000-0000-0000-0000-00000000d0a1', null, 'chai', 'abc')$$, 'a real M-PESA code is needed');
select pg_temp.fails($$select public.vibe_gift_send('00000000-0000-0000-0000-00000000d0a1', null, 'gold', 'SKL2ABC3DE')$$, 'only listed gifts can be sent');
insert into gv select 'g1', public.vibe_gift_send('00000000-0000-0000-0000-00000000d0a1', (select v::bigint from gv where k = 'post'), 'lunch', 'skl2 abc3de', 'Asante for the song');
select pg_temp.fails($$select public.vibe_gift_send('00000000-0000-0000-0000-00000000d0a1', null, 'chai', 'SKL2ABC3DE')$$, 'one M-PESA code is used once');
insert into gv select 'g2', public.vibe_gift_send('00000000-0000-0000-0000-00000000d0a1', null, 'chai', 'SKL2ABC3DF');
select pg_temp.expect((public.vibe_supporters('wanza_c')->>'gifts')::int = 0, 'unchecked gifts do not show publicly');
select pg_temp.fails($$select public.admin_vibe_gifts()$$, 'members cannot see the gift queue');
select pg_temp.fails($$select public.admin_vibe_gift_decide(1, true)$$, 'members cannot confirm gifts');

select pg_temp.as_user('00000000-0000-0000-0000-00000000000a');
select pg_temp.expect(jsonb_array_length(public.admin_vibe_gifts()) = 2, 'staff see gifts waiting for a check');
select public.admin_vibe_gift_decide((select v::bigint from gv where k = 'g1'), true);
select pg_temp.fails(format('select public.admin_vibe_gift_decide(%s, false, %L)', (select v from gv where k = 'g2'), ''), 'a rejected gift needs a reason');
select public.admin_vibe_gift_decide((select v::bigint from gv where k = 'g2'), false, 'Code not found on the Till statement');
select pg_temp.fails(format('select public.admin_vibe_gift_decide(%s, true)', (select v from gv where k = 'g2')), 'a gift is checked once');
select pg_temp.expect((select (x->>'owed_kes')::int from jsonb_array_elements(public.admin_vibe_gift_balances()) x where x->>'username' = 'wanza_c') = 80, 'the creator is owed 80 percent of KSh 100');
select pg_temp.fails($$select public.admin_vibe_gift_payout('00000000-0000-0000-0000-00000000d0a1', 81, 'TKA1BC2DE3')$$, 'staff cannot pay out more than is owed');
select public.admin_vibe_gift_payout('00000000-0000-0000-0000-00000000d0a1', 80, 'TKA1BC2DE3');
select pg_temp.expect(jsonb_array_length(public.admin_vibe_gift_balances()) = 0, 'nothing is owed after the payout');

select pg_temp.as_user('00000000-0000-0000-0000-00000000d0a1');
select pg_temp.expect((public.vibe_my_gifts()->>'earned_kes')::int = 80 and (public.vibe_my_gifts()->>'paid_kes')::int = 80, 'the creator sees what they earned and what was paid');
select pg_temp.expect(public.vibe_my_gifts()->'received'->0->>'message' = 'Asante for the song', 'the creator sees the message with the gift');
reset role; set role anon;
select pg_temp.expect((public.vibe_supporters('wanza_c')->>'gifts')::int = 1, 'confirmed gifts show on the profile');
select pg_temp.expect(public.vibe_gift_leaders()->0->>'username' = 'wanza_c', 'the creator leads the monthly list');
select pg_temp.expect(jsonb_array_length(public.vibe_featured_counties()) = 4, 'four featured counties are listed');
select pg_temp.expect(public.vibe_featured_counties()->1->>'name' = 'Nairobi', 'featured counties keep their order');
reset role;
select pg_temp.expect((select count(*) from public.audit_log where action in ('vibe.gift_confirmed', 'vibe.gift_rejected', 'vibe.gift_payout')) = 3, 'every money step is audited');
update public.site_settings set value = value || '{"on": false, "till": null}'::jsonb where key = 'vibe.gifts';
