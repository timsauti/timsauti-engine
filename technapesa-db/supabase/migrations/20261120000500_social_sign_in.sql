-- =============================================================================================
-- Sign up and sign in with Google or Facebook (owner, 20 Nov 2026: make joining easier).
-- The buttons show only when a provider is switched on (site setting auth.social, set by the tnp-auth workflow once the
-- owner has added the provider's keys). A person who joins this way accepts the terms on our page before leaving for
-- Google or Facebook; the acceptance is recorded here when they come back signed in.
-- =============================================================================================
insert into public.site_settings (key, value, is_public) values ('auth.social', '{"google": false, "facebook": false}', true)
on conflict (key) do nothing;

create or replace function public.record_signup_consent(p_version text, p_marketing boolean default false) returns void
language plpgsql security definer set search_path = public as $$
declare me uuid := auth.uid(); v text := left(coalesce(nullif(trim(p_version), ''), 'unrecorded'), 40);
begin
  if me is null then raise exception 'please sign in again'; end if;
  if not exists (select 1 from public.consents where user_id = me and kind = 'terms' and granted) then
    insert into public.consents (user_id, kind, version, granted, source) values (me, 'terms', v, true, 'social_signup'), (me, 'privacy', v, true, 'social_signup');
  end if;
  if p_marketing then
    insert into public.consents (user_id, kind, version, granted, source) values (me, 'marketing_email', v, true, 'social_signup');
  end if;
end $$;
revoke execute on function public.record_signup_consent(text, boolean) from public, anon;
grant execute on function public.record_signup_consent(text, boolean) to authenticated;
grant execute on all functions in schema public to service_role;
