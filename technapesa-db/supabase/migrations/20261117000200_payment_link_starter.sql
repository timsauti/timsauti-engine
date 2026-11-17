-- Starter package Paystack payment page (owner, 17 Nov 2026).
update public.site_settings set value = value || jsonb_build_object('starter', 'https://paystack.shop/pay/mzvpligcjz'), updated_at = now() where key = 'payments.links';
insert into public.audit_log (actor_kind, action, entity, entity_id, after, note)
values ('system', 'setting.changed', 'site_setting', 'payments.links', (select value from public.site_settings where key = 'payments.links'), 'Starter payment page added');
