-- SMS notifications switched on (owner, 20 Nov 2026): Onfon Media, sender ID "Timsauti".
-- One test text goes to the administrator's own phone on the profile (no number is written here).
update public.site_settings set value = value || '{"on": true, "provider": "onfon", "sender_id": "Timsauti"}'::jsonb, updated_at = now()
where key = 'sms.notifications';

insert into public.sms_outbox (user_id, phone, message, reason, ref)
select p.id, p.phone, 'TECH na PESA: SMS notifications are working. This is a one time test message.', 'setup_test', '2026-11-20'
from public.profiles p join public.user_roles r on r.user_id = p.id and r.role = 'administrator'
where p.phone ~ '^\+254[17][0-9]{8}$'
order by r.granted_at limit 1
on conflict (reason, ref) do nothing;
