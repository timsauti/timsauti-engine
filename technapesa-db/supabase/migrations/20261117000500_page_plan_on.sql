-- Owner, 17 Nov 2026: the agent takes over the TECH na PESA Page (samples reviewed first).
update public.site_settings set value = '"on"', updated_at = now() where key = 'social.page_plan';
