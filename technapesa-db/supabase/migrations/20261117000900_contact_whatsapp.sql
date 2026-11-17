-- Owner, 17 Nov 2026: the official TECH na PESA WhatsApp line for the site wide chat button.
update public.site_settings set value = '"+254733566667"', updated_at = now() where key = 'contact.whatsapp';
update public.site_settings set value = '"+254733566667"', updated_at = now() where key = 'contact.phone' and value = '""';
