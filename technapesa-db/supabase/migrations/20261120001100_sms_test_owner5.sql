-- SMS test 5 to the owner's business line (20 Nov 2026).
insert into public.sms_outbox (phone, message, reason, ref)
values ('+254728245824', 'TECH na PESA: SMS test 5. SMS notifications work.', 'setup_test', '2026-11-20-test-5')
on conflict (reason, ref) do nothing;
