-- Digital Growth tests: application, trial rules, repeat trial guard, content approvals and revisions,
-- reports, notifications, agent job log and staff permissions. Runs after the directory tests.
\set QUIET on
create or replace function pg_temp.as_user(p uuid) returns void language plpgsql as $$
begin perform set_config('request.jwt.claims', json_build_object('sub', p, 'role', 'authenticated')::text, false); end $$;
create or replace function pg_temp.as_anon() returns void language plpgsql as $$
begin perform set_config('request.jwt.claims', '{"role":"anon"}', false); end $$;
create or replace function pg_temp.expect(cond boolean, what text) returns void language plpgsql as $$
begin if not coalesce(cond, false) then raise exception 'FAILED: %', what; else raise notice 'ok: %', what; end if; end $$;
create or replace function pg_temp.fails(sql text, what text) returns void language plpgsql as $$
begin
  begin execute sql; exception when others then raise notice 'ok: %', what; return; end;
  raise exception 'FAILED: %', what;
end $$;
create temp table g (k text primary key, v text);
grant all on g to anon, authenticated;

insert into auth.users (id, email, raw_user_meta_data) values
  ('00000000-0000-0000-0000-0000000000f1', 'salon@test.local', '{"full_name":"Faith Salon","accepted_terms":true}'),
  ('00000000-0000-0000-0000-0000000000f2', 'copycat@test.local', '{"full_name":"Fred Copy","accepted_terms":true}');
update public.site_settings set value = '14' where key = 'growth.trial_days';

set role anon; select pg_temp.as_anon();
select pg_temp.expect((select count(*) from public.growth_packages where not is_trial) = 4 and (select price_kes from public.growth_packages where key = 'growth') = 4500, 'visitors see the four packages with prices');
select pg_temp.fails($$select count(*) from public.growth_clients$$, 'visitors cannot read applications');
reset role;

-- a business applies
set role authenticated; select pg_temp.as_user('00000000-0000-0000-0000-0000000000f1');
insert into g values ('c', public.growth_save(null, jsonb_build_object('business_name', 'Faith Beauty Salon',
  'category_id', (select id from public.categories where slug = 'beauty-and-wellness'), 'county_id', 16, 'town', 'Machakos',
  'description', 'A modern salon in Machakos town for braiding, nails and bridal make up.', 'phone', '0711222333',
  'objectives', 'More bookings on WhatsApp', 'platforms', jsonb_build_array('facebook', 'instagram', 'myspace')))::text);
select pg_temp.expect((select platforms from public.growth_clients) = array['facebook', 'instagram'], 'only real platforms are kept');
select pg_temp.fails($$select public.growth_save(null, '{"business_name":"Second try"}')$$, 'one open application per account');
select pg_temp.fails($$select public.growth_submit((select v from g)::uuid, '2026-11-16')$$, 'applications wait until trials are opened by the owner');
reset role;
update public.site_settings set value = 'true' where key = 'growth.trials_open';
set role authenticated; select pg_temp.as_user('00000000-0000-0000-0000-0000000000f1');
select pg_temp.fails($$select public.growth_submit((select v from g)::uuid, 'old-version')$$, 'the current service agreement must be accepted');
select public.growth_submit((select v from g)::uuid, '2026-11-16');
select pg_temp.expect((select status from public.growth_clients) = 'applied' and (select agreed_at is not null from public.growth_clients), 'application submitted with the agreement recorded');
select pg_temp.expect((select count(*) from public.consents where user_id = auth.uid() and version = 'growth-2026-11-16') = 1, 'agreement consent is stored');
select pg_temp.fails($$select public.admin_growth_decide((select v from g)::uuid, 'approve')$$, 'applicants cannot approve themselves');
reset role;

-- staff approve and start the trial
set role authenticated; select pg_temp.as_user('00000000-0000-0000-0000-00000000000a');
select pg_temp.expect((select count(*) from public.admin_list_growth()) = 1, 'staff see submitted applications');
select pg_temp.fails($$select public.admin_growth_start_trial((select v from g)::uuid)$$, 'a trial cannot start before approval');
select public.admin_growth_decide((select v from g)::uuid, 'approve');
select pg_temp.expect((select status from public.growth_clients) = 'approved' and (select trial_started_at is null from public.growth_clients), 'approval does not start the clock');
select public.admin_growth_start_trial((select v from g)::uuid);
select pg_temp.expect((select trial_ends_at - trial_started_at from public.growth_clients) = interval '14 days', 'the trial lasts 14 days from the recorded start');
select pg_temp.expect((select count(*) from public.agent_jobs where kind = 'onboard_client' and status = 'awaiting_configuration' and payload->>'business_name' = 'Faith Beauty Salon') = 1, 'the agent job is logged as awaiting configuration with the client brief');
select pg_temp.expect((select agent_status from public.growth_clients) = 'awaiting_configuration', 'the client record shows the integration is not configured');
select public.admin_growth_trial((select v from g)::uuid, 'pause', 0, 'client travelling');
select pg_temp.expect((select status from public.growth_clients) = 'trial_paused', 'staff can pause a trial');
select public.admin_growth_trial((select v from g)::uuid, 'resume', 0, 'client back');
select public.admin_growth_trial((select v from g)::uuid, 'extend', 3, 'holiday week');
select pg_temp.expect((select trial_ends_at::date - trial_started_at::date from public.growth_clients) between 16 and 18, 'staff can extend a trial');
select pg_temp.fails($$select public.admin_growth_trial((select v from g)::uuid, 'extend', 3, '')$$, 'trial changes need a reason');
insert into g values ('p1', public.admin_content_save((select v from g where k = 'c')::uuid, null, jsonb_build_object('platform', 'facebook', 'title', 'Bridal offer', 'caption', 'Book your bridal make up this December.',
  'media_paths', jsonb_build_array((select v from g where k = 'c') || '/content/a.jpg', 'someone-else/content/x.jpg')))::text);
select pg_temp.expect((select media_paths from public.content_items) = array[(select v from g where k = 'c') || '/content/a.jpg'], 'only this client''s graphics can be attached');
reset role;

set role authenticated; select pg_temp.as_user('00000000-0000-0000-0000-0000000000f1');
select pg_temp.expect((select count(*) from public.content_items) = 0, 'drafts stay hidden from the client');
reset role;
set role authenticated; select pg_temp.as_user('00000000-0000-0000-0000-00000000000a');
select public.admin_content_send((select v from g where k = 'p1')::bigint);
reset role;

-- the client reviews content
set role authenticated; select pg_temp.as_user('00000000-0000-0000-0000-0000000000f1');
select pg_temp.expect((select count(*) from public.notifications where topic = 'content') = 1, 'the client is told a post awaits approval');
select pg_temp.expect((select count(*) from public.notifications where topic = 'trial') >= 2, 'the client was told about approval and the trial start');
select pg_temp.fails($$select public.content_decide((select v from g where k = 'p1')::bigint, 'revise', '')$$, 'a change request needs a comment');
select public.content_decide((select v from g where k = 'p1')::bigint, 'revise', 'Use our pink colour please');
select pg_temp.fails($$select public.admin_content_send((select v from g where k = 'p1')::bigint)$$, 'clients cannot send content themselves');
reset role;
set role authenticated; select pg_temp.as_user('00000000-0000-0000-0000-00000000000a');
select public.admin_content_send((select v from g where k = 'p1')::bigint, 'Changed to pink');
reset role;
set role authenticated; select pg_temp.as_user('00000000-0000-0000-0000-0000000000f1');
select pg_temp.fails($$select public.content_decide((select v from g where k = 'p1')::bigint, 'revise', 'and again')$$, 'revisions are limited by the package');
select public.content_decide((select v from g where k = 'p1')::bigint, 'approve');
select pg_temp.expect((select status from public.content_items) = 'approved' and (select revision from public.content_items) = 2, 'approved on the second version');
select pg_temp.expect((select count(*) from public.content_feedback) = 3, 'the revision history is kept');
select pg_temp.expect((select count(*) from public.agent_jobs) = 0, 'clients cannot read the agent log');
select pg_temp.fails($$select public.growth_withdraw((select v from g where k = 'c')::uuid)$$, 'a running trial is ended by staff, not withdrawn');
select public.notifications_mark_read();
select pg_temp.expect((select count(*) from public.notifications where read_at is null) = 0, 'notifications can be marked read');
reset role;

-- reports and the nightly job
set role authenticated; select pg_temp.as_user('00000000-0000-0000-0000-00000000000a');
select pg_temp.expect((select count(*) from public.agent_jobs where kind = 'publish_approved') = 1, 'approval queues the post for the agent');
select public.admin_report_save((select v from g where k = 'c')::uuid, null, jsonb_build_object('title', 'Trial report', 'period_start', current_date, 'period_end', current_date, 'summary', 'Good start', 'metrics', jsonb_build_object('reach', 1200)), false);
reset role;
set role authenticated; select pg_temp.as_user('00000000-0000-0000-0000-0000000000f1');
select pg_temp.expect((select count(*) from public.growth_reports) = 0, 'unpublished reports are hidden');
reset role;
update public.growth_clients set trial_ends_at = now() - interval '1 minute';
select public.growth_daily();
select pg_temp.expect((select status from public.growth_clients) = 'trial_ended', 'the nightly job ends a finished trial');
select pg_temp.expect((select count(*) from public.notifications where title like 'Your free trial has finished') = 1, 'the client is told the trial finished and nothing was charged');

-- the repeat trial guard
set role authenticated; select pg_temp.as_user('00000000-0000-0000-0000-0000000000f2');
insert into g values ('c2', public.growth_save(null, jsonb_build_object('business_name', 'Faith Beauty Salon', 'category_id', (select id from public.categories where slug = 'beauty-and-wellness'),
  'county_id', 16, 'description', 'A modern salon in Machakos town for braiding, nails and bridal make up.', 'whatsapp', '0711222333', 'objectives', 'More bookings', 'platforms', jsonb_build_array('facebook')))::text);
select public.growth_submit((select v from g where k = 'c2')::uuid, '2026-11-16');
reset role;
set role authenticated; select pg_temp.as_user('00000000-0000-0000-0000-00000000000a');
select pg_temp.expect((select possible_repeat from public.admin_list_growth('applied')), 'staff are warned about a likely repeat trial');
select public.admin_growth_decide((select v from g where k = 'c2')::uuid, 'approve');
select pg_temp.fails($$select public.admin_growth_start_trial((select v from g where k = 'c2')::uuid)$$, 'a second trial for the same phone is refused');
select public.admin_growth_allow_repeat((select v from g where k = 'c2')::uuid, 'new owner bought the salon');
select public.admin_growth_start_trial((select v from g where k = 'c2')::uuid);
select pg_temp.expect((select status from public.growth_clients where id = (select v from g where k = 'c2')::uuid) = 'trial_active', 'an administrator can allow a legitimate repeat trial');
select public.admin_package_save('starter', jsonb_build_object('name', 'Starter', 'price_kes', 3000, 'posts_per_period', 8, 'graphics_per_period', 8, 'platforms_count', 1, 'revisions_per_item', 1));
select pg_temp.expect((select price_kes from public.growth_packages where key = 'starter') = 3000, 'staff can change package prices without code');
select pg_temp.expect((select count(*) from public.audit_log where action = 'package.saved') = 1, 'package changes are audited');
reset role;
set role authenticated; select pg_temp.as_user('00000000-0000-0000-0000-00000000000e');
select pg_temp.fails($$select public.admin_package_save('starter', '{"name":"Free","price_kes":0}')$$, 'ordinary users cannot change packages');
select pg_temp.expect(not public.can_write_growth_path((select v from g where k = 'c') || '/brand/logo.png'), 'other users cannot upload to a client''s files');
reset role;
set role authenticated; select pg_temp.as_user('00000000-0000-0000-0000-0000000000f1');
select pg_temp.expect(public.can_write_growth_path((select v from g where k = 'c') || '/brand/logo.png') and not public.can_write_growth_path((select v from g where k = 'c') || '/content/x.jpg'), 'clients upload brand files but not content graphics');
reset role;
