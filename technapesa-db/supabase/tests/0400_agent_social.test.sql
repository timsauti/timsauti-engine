-- Agent connection and social sharing tests. Runs after the Digital Growth tests.
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

update public.site_settings set value = '"agent_pull"' where key = 'growth.agent_integration';
insert into auth.users (id, email, raw_user_meta_data) values ('00000000-0000-0000-0000-0000000000a7', 'bakery@test.local', '{"full_name":"Grace Bakery","accepted_terms":true}');
set role authenticated; select pg_temp.as_user('00000000-0000-0000-0000-0000000000a7');
select public.growth_save(null, jsonb_build_object('business_name', 'Grace Bakery Kangundo', 'category_id', (select id from public.categories where slug = 'retail'),
  'county_id', 16, 'description', 'Fresh bread, cakes and pastries baked daily in Kangundo town since 2019.', 'whatsapp', '0799888777', 'objectives', 'More cake orders', 'platforms', jsonb_build_array('facebook')));
select public.growth_submit((select id from public.growth_clients where business_name = 'Grace Bakery Kangundo'), '2026-11-16');
reset role;
set role authenticated; select pg_temp.as_user('00000000-0000-0000-0000-00000000000a');
select public.admin_growth_decide((select id from public.growth_clients where business_name = 'Grace Bakery Kangundo'), 'approve');
select public.admin_growth_start_trial((select id from public.growth_clients where business_name = 'Grace Bakery Kangundo'));
select pg_temp.expect((select count(*) from public.agent_jobs j join public.growth_clients c on c.id = j.client_id where c.business_name = 'Grace Bakery Kangundo' and j.status = 'queued') = 2, 'a trial start queues the client set up and the first drafts for the agent');
select pg_temp.expect((select (payload->>'count')::int from public.agent_jobs j join public.growth_clients c on c.id = j.client_id where c.business_name = 'Grace Bakery Kangundo' and j.kind = 'content_request') = 6, 'the first batch matches the trial post count');
select public.admin_agent_request((select id from public.growth_clients where business_name = 'Grace Bakery Kangundo'), 3, 'Christmas cake orders');
select pg_temp.expect((select count(*) from public.agent_jobs where kind = 'content_request' and payload->>'instructions' = 'Christmas cake orders') = 1, 'staff can ask the agent for more drafts');
select pg_temp.fails($$select public.admin_agent_request((select id from public.growth_clients where business_name = 'Grace Bakery Kangundo'), 50)$$, 'draft requests are limited to 10 at a time');
reset role;
-- an approved post is never sent to the agent for publishing on a client's Page
insert into public.content_items (client_id, platform, caption, status) select id, 'facebook', 'Order your Christmas cake today.', 'awaiting_approval' from public.growth_clients where business_name = 'Grace Bakery Kangundo';
set role authenticated; select pg_temp.as_user('00000000-0000-0000-0000-0000000000a7');
select public.content_decide((select max(id) from public.content_items), 'approve');
reset role;
select pg_temp.expect((select status from public.agent_jobs where kind = 'publish_approved' order by id desc limit 1) = 'awaiting_configuration', 'publishing to a client Page stays manual');

-- listing owners opt in to social sharing
set role authenticated; select pg_temp.as_user('00000000-0000-0000-0000-00000000000d');
select pg_temp.expect(not (select share_ok from public.businesses limit 1), 'listings are not shared unless the owner agrees');
select public.business_set_share((select id from public.businesses limit 1), true);
select pg_temp.expect((select share_ok from public.businesses limit 1), 'the owner can allow sharing');
select pg_temp.expect((select count(*) from public.social_shares) = 0, 'owners cannot read the share queue');
reset role;
set role authenticated; select pg_temp.as_user('00000000-0000-0000-0000-0000000000a7');
select pg_temp.fails($$select public.business_set_share((select id from public.businesses where owner_id = '00000000-0000-0000-0000-00000000000d' limit 1), false)$$, 'other users cannot change sharing for a listing');
reset role;
insert into public.social_shares (kind, ref, page_key, link, caption) values ('promo', 'digital-growth', 'techpulse', 'https://technapesa.pages.dev/digital-growth/', 'x');
set role authenticated; select pg_temp.as_user('00000000-0000-0000-0000-00000000000a');
select pg_temp.expect((select count(*) from public.social_shares) = 1, 'staff see the share queue');
select public.admin_share_skip((select id from public.social_shares limit 1), 'not this week');
select pg_temp.expect((select status from public.social_shares limit 1) = 'skipped', 'staff can stop a planned share');
reset role;
