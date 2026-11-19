-- The owner already has an Onfon Media SMS account (19 Nov 2026): texts go through Onfon. Still off until switched on.
update public.site_settings set value = value || '{"provider": "onfon"}'::jsonb where key = 'sms.notifications';
