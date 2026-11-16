-- Foundation tests: accounts, roles, permissions, status guards, audit trail and row level security.
-- Each block acts as a specific user, exactly as Supabase does (JWT claims + the authenticated role).
\set QUIET on
create or replace function pg_temp.as_user(p uuid) returns void language plpgsql as $$
begin perform set_config('request.jwt.claims', json_build_object('sub', p, 'role', 'authenticated')::text, false); end $$;
create or replace function pg_temp.as_anon() returns void language plpgsql as $$
begin perform set_config('request.jwt.claims', '{"role":"anon"}', false); end $$;
create or replace function pg_temp.expect(cond boolean, what text) returns void language plpgsql as $$
begin if not coalesce(cond, false) then raise exception 'FAILED: %', what; else raise notice 'ok: %', what; end if; end $$;

-- three accounts sign up
insert into auth.users (id, email, raw_user_meta_data) values
  ('00000000-0000-0000-0000-00000000000a', 'admin@test.local', '{"full_name":"Test Admin","accepted_terms":true,"terms_version":"2026-11-16"}'),
  ('00000000-0000-0000-0000-00000000000b', 'amina@test.local', '{"full_name":"Amina Test","accepted_terms":true,"terms_version":"2026-11-16","marketing_email":true}'),
  ('00000000-0000-0000-0000-00000000000c', 'brian@test.local', '{"full_name":"Brian Test","accepted_terms":true,"terms_version":"2026-11-16"}');
-- the first administrator is granted directly in the database by the owner (service role)
insert into public.user_roles (user_id, role) values ('00000000-0000-0000-0000-00000000000a', 'administrator');

select pg_temp.expect((select count(*) from public.profiles) = 3, 'sign up creates a profile for each account');
select pg_temp.expect((select count(*) from public.user_roles where role = 'general_user') = 3, 'every account gets the general user role');
select pg_temp.expect((select count(*) from public.consents where user_id = '00000000-0000-0000-0000-00000000000b' and kind in ('terms','privacy') and granted) = 2, 'terms and privacy consent recorded at sign up');
select pg_temp.expect((select enabled from public.notification_prefs where user_id = '00000000-0000-0000-0000-00000000000b' and topic = 'news' and channel = 'email'), 'marketing opt in respected');
select pg_temp.expect(not (select enabled from public.notification_prefs where user_id = '00000000-0000-0000-0000-00000000000c' and topic = 'news' and channel = 'email'), 'no marketing email without opt in');
select pg_temp.expect((select count(*) from public.audit_log where action = 'account.created') = 3, 'account creation is audited');

-- anonymous visitors
set role anon; select pg_temp.as_anon();
select pg_temp.expect((select count(*) from public.counties) = 47, 'anyone can read the 47 counties');
select pg_temp.expect((select count(*) from public.categories where division = 'business') = 13, 'anyone can read the 13 business categories');
do $$ begin
  begin perform count(*) from public.profiles; raise exception 'FAILED: anon read profiles';
  exception when others then if sqlerrm like 'FAILED%' then raise; end if; raise notice 'ok: anonymous visitors cannot read profiles'; end;
end $$;
select pg_temp.expect((select count(*) from public.site_settings where key = 'growth.trial_days') = 1, 'public settings are readable');
reset role;

-- an ordinary user
set role authenticated; select pg_temp.as_user('00000000-0000-0000-0000-00000000000b');
select pg_temp.expect((select count(*) from public.profiles) = 1, 'a user sees only their own profile');
select pg_temp.expect((select count(*) from public.audit_log) = 0, 'a user cannot read the audit log');
update public.profiles set display_name = 'Amina K', county_id = 16, phone = '+254712345678' where id = auth.uid();
select pg_temp.expect((select display_name from public.profiles where id = auth.uid()) = 'Amina K', 'a user can edit their own profile');
do $$ begin
  begin update public.profiles set status = 'active', status_reason = 'x' where id = auth.uid(); raise exception 'FAILED: user changed own status';
  exception when others then if sqlerrm like 'FAILED%' then raise; end if; raise notice 'ok: a user cannot change their own account status'; end;
  begin update public.profiles set phone_verified_at = now() where id = auth.uid(); raise exception 'FAILED: user verified own phone';
  exception when others then if sqlerrm like 'FAILED%' then raise; end if; raise notice 'ok: a user cannot mark their own phone as verified'; end;
  begin update public.profiles set display_name = 'Hacked' where id = '00000000-0000-0000-0000-00000000000c';
    if (select count(*) from public.profiles where display_name = 'Hacked') > 0 then raise exception 'FAILED: edited another profile'; end if;
    raise notice 'ok: a user cannot edit another profile';
  end;
  begin perform public.admin_set_role('00000000-0000-0000-0000-00000000000b', 'administrator', true); raise exception 'FAILED: user made themselves admin';
  exception when others then if sqlerrm like 'FAILED%' then raise; end if; raise notice 'ok: a user cannot grant themselves roles'; end;
  begin perform public.admin_list_users(); raise exception 'FAILED: user listed users';
  exception when others then if sqlerrm like 'FAILED%' then raise; end if; raise notice 'ok: a user cannot list other users'; end;
  begin perform public.add_self_service_role('digital_growth_client'); raise exception 'FAILED: self granted client role';
  exception when others then if sqlerrm like 'FAILED%' then raise; end if; raise notice 'ok: Digital Growth client role cannot be self granted'; end;
end $$;
select public.add_self_service_role('business_owner');
select pg_temp.expect(public.has_role('business_owner'), 'a user can add the business owner role to their own account');
select public.request_account_deletion('testing');
select pg_temp.expect((select status from public.profiles where id = auth.uid()) = 'deletion_requested', 'a user can request account deletion');
select public.cancel_account_deletion();
select pg_temp.expect((select status from public.profiles where id = auth.uid()) = 'active', 'a user can cancel a deletion request');
reset role;

-- the administrator
set role authenticated; select pg_temp.as_user('00000000-0000-0000-0000-00000000000a');
select pg_temp.expect((select count(*) from public.admin_list_users()) = 3, 'an administrator can list users');
select pg_temp.expect((select total from public.admin_user_stats()) = 3 and (select staff from public.admin_user_stats()) = 1, 'an administrator sees accurate user counts');
select pg_temp.expect((select email from public.admin_list_users('amina')) = 'amina@test.local', 'an administrator can search users');
select public.admin_set_role('00000000-0000-0000-0000-00000000000c', 'service_manager', true, 'runs Digital Growth');
select pg_temp.expect((select count(*) from public.audit_log where action = 'role.granted') = 1, 'role changes are written to the audit log');
select public.admin_set_status('00000000-0000-0000-0000-00000000000b', 'suspended', 'test suspension');
select pg_temp.expect((select status from public.profiles where id = '00000000-0000-0000-0000-00000000000b') = 'suspended', 'an administrator can suspend an account');
select pg_temp.expect((select count(*) from public.audit_log where action = 'account.status_changed') = 1, 'status changes are audited');
select public.admin_set_setting('growth.trial_days', '21');
select pg_temp.expect((select value::int from public.site_settings where key = 'growth.trial_days') = 21, 'an administrator can change a setting');
select pg_temp.expect((select count(*) from public.audit_log where action = 'setting.changed' and entity_id = 'growth.trial_days') = 1, 'setting changes are audited');
do $$ begin
  begin perform public.admin_set_role(auth.uid(), 'administrator', false); raise exception 'FAILED: admin removed own admin role';
  exception when others then if sqlerrm like 'FAILED%' then raise; end if; raise notice 'ok: an administrator cannot remove their own administrator role'; end;
  begin perform public.admin_set_status('00000000-0000-0000-0000-00000000000c', 'suspended', ''); raise exception 'FAILED: suspended without reason';
  exception when others then if sqlerrm like 'FAILED%' then raise; end if; raise notice 'ok: a suspension needs a reason'; end;
end $$;
reset role;

-- a service manager has limited powers
set role authenticated; select pg_temp.as_user('00000000-0000-0000-0000-00000000000c');
select pg_temp.expect(public.has_permission('growth.manage'), 'a service manager can manage Digital Growth');
select pg_temp.expect(not public.has_permission('users.manage_roles'), 'a service manager cannot manage roles');
select pg_temp.expect((select count(*) from public.admin_list_users()) = 3, 'a service manager can view users');
do $$ begin
  begin perform public.admin_set_role('00000000-0000-0000-0000-00000000000b', 'moderator', true); raise exception 'FAILED: manager granted staff role';
  exception when others then if sqlerrm like 'FAILED%' then raise; end if; raise notice 'ok: a service manager cannot grant staff roles'; end;
end $$;
reset role;

-- a suspended account loses its powers
update public.profiles set status = 'suspended' where id = '00000000-0000-0000-0000-00000000000c';
set role authenticated; select pg_temp.as_user('00000000-0000-0000-0000-00000000000c');
select pg_temp.expect(not public.has_permission('users.view'), 'a suspended staff account loses its permissions');
reset role;

-- the audit log cannot be edited, even by an administrator
set role authenticated; select pg_temp.as_user('00000000-0000-0000-0000-00000000000a');
do $$ begin
  begin delete from public.audit_log; raise exception 'FAILED: deleted audit log';
  exception when others then if sqlerrm like 'FAILED%' then raise; end if; raise notice 'ok: nobody can delete audit entries'; end;
  begin update public.audit_log set note = 'x'; raise exception 'FAILED: edited audit log';
  exception when others then if sqlerrm like 'FAILED%' then raise; end if; raise notice 'ok: nobody can edit audit entries'; end;
end $$;
reset role;
