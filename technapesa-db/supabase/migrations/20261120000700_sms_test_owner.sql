-- One time SMS test to the owner's business line (the number printed on Timsauti posters), 20 Nov 2026.
insert into public.sms_outbox (phone, message, reason, ref)
values ('+254728245824', 'TECH na PESA: SMS notifications are working. This is a one time test message.', 'setup_test', '2026-11-20-business-line')
on conflict (reason, ref) do nothing;
