-- Paystack payment page links supplied by the owner on 17 Nov 2026 (checked by page name). Starter link to follow.
update public.site_settings set value = jsonb_build_object(
  'growth',   'https://paystack.shop/pay/vydpjjirvf',
  'business', 'https://paystack.shop/pay/jsirb5x8dx',
  'premium',  'https://paystack.shop/pay/ac7d17417g'
), updated_at = now() where key = 'payments.links';
insert into public.audit_log (actor_kind, action, entity, entity_id, after, note)
values ('system', 'setting.changed', 'site_setting', 'payments.links', (select value from public.site_settings where key = 'payments.links'), 'Paystack payment pages added at the owner''s request');
