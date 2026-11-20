-- SMS test 9 to the owner's two lines after unblocking promotional messages (20 Nov 2026).
insert into public.sms_outbox (phone, message, reason, ref) values
  ('+254728245824', 'TECH na PESA: SMS test 9 from TIMSAUTI.', 'setup_test', '2026-11-20-test-9a'),
  ('+254716909062', 'TECH na PESA: SMS test 9 from TIMSAUTI.', 'setup_test', '2026-11-20-test-9b')
on conflict (reason, ref) do nothing;
