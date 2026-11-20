-- One time SMS test to the owner's second business line (printed on Timsauti posters), 20 Nov 2026.
insert into public.sms_outbox (phone, message, reason, ref)
values ('+254733566667', 'TECH na PESA: SMS test 2. If you see this, SMS notifications work.', 'setup_test', '2026-11-20-business-line-2')
on conflict (reason, ref) do nothing;
