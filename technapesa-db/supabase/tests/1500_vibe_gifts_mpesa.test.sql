-- TnPVibe gifts by M-PESA prompt through Paystack: start, paid, amount check, repeat calls.
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
  ('00000000-0000-0000-0000-00000000e0a1', 'mp1@test.local', '{"full_name":"Kanini Singer","accepted_terms":true}'),
  ('00000000-0000-0000-0000-00000000e0b2', 'mp2@test.local', '{"full_name":"Mutinda Fan","accepted_terms":true}');
create temp table gv (k text primary key, v text);
grant all on gv to authenticated;
update public.site_settings set value = value || '{"on": true, "pay": "mpesa", "till": null}'::jsonb where key = 'vibe.gifts';
set role authenticated;
select pg_temp.as_user('00000000-0000-0000-0000-00000000e0a1'); select public.vibe_join('kanini_s', true);
select public.vibe_gift_settings_save(true, '0722 000 111');
select pg_temp.as_user('00000000-0000-0000-0000-00000000e0b2'); select public.vibe_join('mutinda_f', true);

select pg_temp.expect((public.vibe_gift_info('00000000-0000-0000-0000-00000000e0a1')->>'open')::boolean, 'gifts open with the M-PESA prompt and no Till');
select pg_temp.expect(public.vibe_gift_info('00000000-0000-0000-0000-00000000e0a1')->>'till' is null, 'no Till number is shown');
select pg_temp.fails($$select public.vibe_gift_send('00000000-0000-0000-0000-00000000e0a1', null, 'chai', 'SKL2ABC3DX')$$, 'Till codes are refused while gifts use the M-PESA prompt');
insert into gv select 'r1', public.vibe_gift_start('00000000-0000-0000-0000-00000000e0a1', null, 'soda', 'Kali sana')->>'reference';
insert into gv select 'r2', public.vibe_gift_start('00000000-0000-0000-0000-00000000e0a1', null, 'lunch')->>'reference';
insert into gv select 'r3', public.vibe_gift_start('00000000-0000-0000-0000-00000000e0a1', null, 'chai')->>'reference';
select pg_temp.expect((select v from gv where k = 'r1') like 'gift\_%', 'each gift gets its own payment reference');
select pg_temp.expect(public.vibe_gift_status((select v from gv where k = 'r1')) = 'unpaid', 'the giver can follow their gift');
select pg_temp.fails($$select public.vibe_gift_paid('x', 'success', 100, 'KES')$$, 'members cannot mark gifts paid');
select pg_temp.expect(jsonb_array_length(public.vibe_my_gifts()->'sent') = 0, 'unfinished prompts are not listed as sent');

reset role;
select pg_temp.expect(public.vibe_gift_paid((select v from gv where k = 'r1'), 'success', 5000, 'KES', '991') = 'confirmed', 'a matching M-PESA payment confirms the gift by itself');
select pg_temp.expect(public.vibe_gift_paid((select v from gv where k = 'r1'), 'success', 5000, 'KES', '991') = 'confirmed', 'a repeated message changes nothing');
select pg_temp.expect(public.vibe_gift_paid((select v from gv where k = 'r2'), 'success', 5000, 'KES', '992') = 'rejected', 'a wrong amount is not accepted');
select pg_temp.expect(public.vibe_gift_paid((select v from gv where k = 'r3'), 'failed', 0, 'KES', '993') = 'failed', 'a cancelled prompt is marked failed');
select pg_temp.expect((select count(*) from public.notifications where user_id = '00000000-0000-0000-0000-00000000e0a1' and title like 'Mutinda Fan sent you Soda%') = 1, 'the creator is told once');

set role authenticated;
select pg_temp.as_user('00000000-0000-0000-0000-00000000e0a1');
select pg_temp.expect((public.vibe_my_gifts()->>'earned_kes')::int = 40, 'the creator earns 80 percent of KSh 50');
reset role;
update public.site_settings set value = value || '{"on": false}'::jsonb where key = 'vibe.gifts';
