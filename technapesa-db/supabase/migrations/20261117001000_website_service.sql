-- Owner, 17 Nov 2026: website design and development is a TECH na PESA service.
alter table public.service_requests drop constraint service_requests_service_check;
alter table public.service_requests add constraint service_requests_service_check check (service in ('presence_assessment', 'profile_creation',
  'google_profile', 'whatsapp_business', 'catalogue', 'marketing_consultation', 'enquiry_workflow', 'promotion', 'sponsorship', 'institution_plan', 'website', 'other'));
