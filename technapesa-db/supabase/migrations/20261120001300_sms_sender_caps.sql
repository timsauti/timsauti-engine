-- The approved Onfon sender ID is TIMSAUTI in capitals (owner, 20 Nov 2026). Test 7 to the owner's business line.
update public.site_settings set value = value || '{"sender_id": "TIMSAUTI"}'::jsonb, updated_at = now() where key = 'sms.notifications';
insert into public.sms_outbox (phone, message, reason, ref)
values ('+254728245824', 'TECH na PESA: SMS notifications are working.', 'setup_test', '2026-11-20-test-7')
on conflict (reason, ref) do nothing;
