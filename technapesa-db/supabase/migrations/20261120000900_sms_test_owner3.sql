-- One time SMS test to a third owner line (owner asked, 20 Nov 2026).
insert into public.sms_outbox (phone, message, reason, ref)
values ('+254716909062', 'TECH na PESA: SMS test 3. If you see this, SMS notifications work.', 'setup_test', '2026-11-20-line-3')
on conflict (reason, ref) do nothing;
