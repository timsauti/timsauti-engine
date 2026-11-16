-- Directory and Business Connect tests: listing life cycle, review, public visibility, enquiries,
-- support requests, analytics, photo storage rules and abuse limits. Runs after the foundation tests.
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
grant execute on function pg_temp.as_user(uuid), pg_temp.as_anon(), pg_temp.expect(boolean, text), pg_temp.fails(text, text) to anon, authenticated;

insert into auth.users (id, email, raw_user_meta_data) values
  ('00000000-0000-0000-0000-00000000000d', 'owner@test.local', '{"full_name":"Daisy Owner","accepted_terms":true}'),
  ('00000000-0000-0000-0000-00000000000e', 'customer@test.local', '{"full_name":"Eric Customer","accepted_terms":true}');
create temp table ids (k text primary key, v text);
grant all on ids to anon, authenticated;

-- an owner creates a listing
set role authenticated; select pg_temp.as_user('00000000-0000-0000-0000-00000000000d');
insert into ids values ('biz', public.business_save(null, jsonb_build_object(
  'name', 'Mama Mboga Fresh', 'category_id', (select id from public.categories where slug = 'retail'),
  'county_id', 16, 'town', 'Machakos', 'phone', '0712 345 678', 'whatsapp', '254712345678',
  'description', 'Fresh vegetables and fruit delivered daily around Machakos town.',
  'social', jsonb_build_object('facebook', 'https://facebook.com/mamamboga'), 'lat', '-1.52', 'lng', '37.26'))::text);
select pg_temp.expect((select status from public.businesses where id = (select v from ids where k = 'biz')::uuid) = 'draft', 'a new listing starts as a draft');
select pg_temp.expect((select slug from public.businesses where id = (select v from ids where k = 'biz')::uuid) = 'mama-mboga-fresh', 'a readable web address is made from the name');
select pg_temp.expect((select phone from public.businesses where id = (select v from ids where k = 'biz')::uuid) = '+254712345678', 'phone numbers are stored in one format');
select pg_temp.expect(public.has_role('business_owner'), 'listing a business adds the business owner role');
select pg_temp.fails($$select public.business_save(null, '{"name":"Bad","phone":"12345"}')$$, 'a phone number that is not Kenyan is refused');
select pg_temp.fails($$select public.business_save(null, '{"name":"Far","lat":"51.5","lng":"-0.1"}')$$, 'a map location outside Kenya is refused');
select pg_temp.fails($$select public.business_save(null, '{"name":"Bad link","social":{"facebook":"javascript:alert(1)"}}')$$, 'unsafe social links are refused');
select pg_temp.fails($$update public.businesses set status = 'published'$$, 'an owner cannot publish by editing the table');
select pg_temp.expect(public.business_offering_save((select v from ids where k = 'biz')::uuid, null, 'product', 'Sukuma wiki bunch', 'Fresh daily', 'KSh 20') > 0, 'an owner can add a product');
select pg_temp.expect(public.business_photo_add((select v from ids where k = 'biz')::uuid, (select v from ids where k = 'biz') || '/shop.jpg', 'Our stall') > 0, 'an owner can add a photo');
select pg_temp.fails($$select public.business_photo_add((select v from ids where k = 'biz')::uuid, '00000000-0000-0000-0000-000000000000/x.jpg')$$, 'a photo from another listing folder is refused');
select pg_temp.expect(public.can_edit_business_path((select v from ids where k = 'biz') || '/logo.png'), 'the owner may upload into the listing folder');
select pg_temp.expect(not public.can_edit_business_path('../etc/passwd'), 'odd file paths are refused');
select public.business_submit((select v from ids where k = 'biz')::uuid);
select pg_temp.expect((select status from public.businesses where id = (select v from ids where k = 'biz')::uuid) = 'pending', 'an owner can send a listing for review');
reset role;

-- visitors cannot see it until staff approve it
set role anon; select pg_temp.as_anon();
select pg_temp.expect((select count(*) from public.directory) = 0, 'a listing is not public before review');
select pg_temp.expect((select count(*) from public.business_offerings) = 0, 'products of an unreviewed listing are hidden');
select pg_temp.fails($$select count(*) from public.businesses$$, 'visitors cannot read the listings table directly');
reset role;

-- another user cannot touch it or approve it
set role authenticated; select pg_temp.as_user('00000000-0000-0000-0000-00000000000e');
select pg_temp.expect((select count(*) from public.businesses) = 0, 'other users cannot see a draft or pending listing');
select pg_temp.fails($$select public.business_save((select v from ids where k = 'biz')::uuid, '{"name":"Taken over"}')$$, 'other users cannot edit a listing');
select pg_temp.fails($$select public.admin_review_business((select v from ids where k = 'biz')::uuid, 'publish')$$, 'ordinary users cannot approve listings');
select pg_temp.expect(not public.can_edit_business_path((select v from ids where k = 'biz') || '/x.jpg'), 'other users cannot upload photos to a listing');
reset role;

-- the administrator reviews it
set role authenticated; select pg_temp.as_user('00000000-0000-0000-0000-00000000000a');
select pg_temp.fails($$select public.admin_review_business((select v from ids where k = 'biz')::uuid, 'reject', '')$$, 'a rejection needs a reason');
select public.admin_review_business((select v from ids where k = 'biz')::uuid, 'publish');
select public.admin_feature_business((select v from ids where k = 'biz')::uuid, 30);
select pg_temp.expect((select count(*) from public.audit_log where action in ('business.published', 'business.featured')) = 2, 'approval and featuring are audited');
reset role;

set role anon; select pg_temp.as_anon();
select pg_temp.expect((select count(*) from public.directory where slug = 'mama-mboga-fresh' and featured and county = 'Machakos' and category = 'Retail') = 1, 'an approved listing is public, featured, with its county and category');
select pg_temp.expect((select round(lat::numeric, 2) from public.directory) = -1.52, 'the map location is published');
select pg_temp.expect((select count(*) from public.business_offerings) = 1 and (select count(*) from public.business_photos) = 1, 'products and photos of a public listing are visible');
select public.record_business_event((select id from public.directory), 'view');
select public.record_business_event((select id from public.directory), 'view');
select public.record_business_event((select id from public.directory), 'whatsapp');
select public.record_business_event((select id from public.directory), 'hack');
select pg_temp.fails($$select public.send_enquiry((select id from public.directory), 'Anon', null, 'call', 'Do you deliver to Kangundo?')$$, 'visitors must sign in to send an enquiry');
reset role;
select pg_temp.expect((select sum(count) from public.business_daily_stats where kind = 'view') = 2 and (select count(*) from public.business_daily_stats) = 2, 'views and taps are counted; unknown kinds are ignored');

-- a customer sends an enquiry
set role authenticated; select pg_temp.as_user('00000000-0000-0000-0000-00000000000e');
select pg_temp.expect(public.send_enquiry((select v from ids where k = 'biz')::uuid, 'Eric', '0722000111', 'whatsapp', 'Do you deliver to Kangundo on Saturdays?') > 0, 'a signed in customer can send an enquiry');
select pg_temp.expect((select count(*) from public.enquiries) = 1, 'the customer can see their own enquiry');
select pg_temp.expect((select count(*) from public.business_daily_stats) = 0, 'customers cannot read a listing''s numbers');
do $$ begin
  for i in 1..4 loop perform public.send_enquiry((select v from ids where k = 'biz')::uuid, 'Eric', null, 'call', 'Another question number ' || i); end loop;
end $$;
select pg_temp.fails($$select public.send_enquiry((select v from ids where k = 'biz')::uuid, 'Eric', null, 'call', 'One too many questions')$$, 'enquiries are limited to 5 an hour per person');
select pg_temp.expect(public.service_request_create(null, 'whatsapp_business', 'Please help me set up WhatsApp Business for my salon.', '0733000222') > 0, 'anyone signed in can ask Business Connect for help');
select pg_temp.fails($$select public.service_request_create((select v from ids where k = 'biz')::uuid, 'promotion', 'Promote a business that is not mine')$$, 'a support request cannot name someone else''s business');
reset role;

-- the owner works the enquiry and sees the numbers
set role authenticated; select pg_temp.as_user('00000000-0000-0000-0000-00000000000d');
select pg_temp.expect((select count(*) from public.enquiries) = 5 and (select sender_email from public.enquiries order by id limit 1) = 'customer@test.local', 'the owner sees every enquiry with the sender''s contact');
select public.enquiry_set_status((select min(id) from public.enquiries), 'replied');
select pg_temp.expect((select status from public.enquiries order by id limit 1) = 'replied', 'the owner can mark an enquiry replied');
select pg_temp.expect((select total from public.business_stats((select v from ids where k = 'biz')::uuid) where kind = 'enquiry') = 5, 'the owner sees enquiry, view and tap counts');
select pg_temp.fails($$select public.send_enquiry((select v from ids where k = 'biz')::uuid, 'Me', null, 'call', 'Talking to myself here')$$, 'an owner cannot enquire to their own business');
select pg_temp.expect(public.service_request_create((select v from ids where k = 'biz')::uuid, 'google_profile', 'Help me set up my Google business profile.', null) > 0, 'an owner can ask for help with their listing');
select pg_temp.expect((select count(*) from public.service_requests) = 1, 'people see only their own support requests');
select public.business_withdraw((select v from ids where k = 'biz')::uuid);
reset role;

set role anon; select pg_temp.as_anon();
select pg_temp.expect((select count(*) from public.directory) = 0, 'an owner can hide a published listing; nothing is deleted');
reset role;
select pg_temp.expect((select count(*) from public.businesses) = 1, 'the hidden listing is kept');

-- staff manage support requests
set role authenticated; select pg_temp.as_user('00000000-0000-0000-0000-00000000000a');
select pg_temp.expect((select count(*) from public.admin_list_service_requests()) = 2, 'staff see every support request');
select public.admin_service_request_update((select min(id) from public.service_requests), 'in_progress', 'We will call you tomorrow morning.', true);
select pg_temp.expect((select businesses from public.admin_business_stats()) = 1 and (select open_requests from public.admin_business_stats()) = 2, 'staff see directory numbers');
reset role;
set role authenticated; select pg_temp.as_user('00000000-0000-0000-0000-00000000000e');
select pg_temp.expect((select response from public.service_requests) = 'We will call you tomorrow morning.', 'the requester sees the staff reply');
reset role;
