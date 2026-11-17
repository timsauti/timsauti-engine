-- Renewals: reminders three days and one day before a paid month ends, and a "lapsed" state when it ends unpaid.
-- Run hourly by the engine agent (growth_billing_daily is safe to run often). Also a WhatsApp sales number setting.

alter table public.growth_clients drop constraint growth_clients_status_check;
alter table public.growth_clients add constraint growth_clients_status_check check (status in ('draft', 'applied', 'info_requested', 'approved', 'rejected',
  'withdrawn', 'trial_active', 'trial_paused', 'trial_ended', 'subscribed', 'lapsed', 'terminated'));
alter table public.growth_clients add column renewal_reminders text[] not null default '{}';

insert into public.site_settings (key, value, is_public) values ('contact.whatsapp', '""', true) on conflict (key) do nothing;

create or replace function public.payment_create(p_client uuid, p_package text) returns text
language plpgsql security definer set search_path = public as $$
declare c public.growth_clients; p public.growth_packages; v_ref text;
begin
  select * into c from public.growth_clients where id = p_client and owner_id = auth.uid();
  if not found then raise exception 'not allowed'; end if;
  if c.status not in ('approved', 'trial_active', 'trial_paused', 'trial_ended', 'subscribed', 'lapsed') then
    raise exception 'payment opens once your application is approved';
  end if;
  select * into p from public.growth_packages where key = p_package and active and not is_trial and price_kes > 0;
  if not found then raise exception 'choose an available package'; end if;
  if (select count(*) from public.payments where owner_id = auth.uid() and created_at > now() - interval '1 hour') >= 10 then
    raise exception 'too many payment attempts; please wait a while';
  end if;
  v_ref := 'TNP-' || upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 16));
  insert into public.payments (reference, owner_id, client_id, package_key, amount_kes) values (v_ref, auth.uid(), p_client, p_package, p.price_kes);
  update public.growth_clients set package_key = p_package, updated_at = now() where id = p_client;
  return v_ref;
end $$;

create or replace function public.growth_billing_daily() returns jsonb
language plpgsql security definer set search_path = public as $$
declare c record; v_key text; n_remind int := 0; n_lapsed int := 0;
begin
  if not public.is_service() then raise exception 'not allowed'; end if;
  for c in select g.*, p.name as package_name, p.price_kes from public.growth_clients g left join public.growth_packages p on p.key = g.package_key
           where g.status = 'subscribed' and g.paid_until is not null and g.paid_until < now() + interval '3 days' loop
    if c.paid_until <= now() then
      update public.growth_clients set status = 'lapsed', updated_at = now() where id = c.id;
      perform public.growth_log(c.id, 'billing', 'Paid period ended without renewal. Posting is paused until the next payment.');
      perform public.notify(c.owner_id, 'billing', 'Your ' || coalesce(c.package_name, 'Digital Growth') || ' package has ended',
        'Pay for the next month to continue your posts and reports.', '/account/growth/?tab=billing');
      n_lapsed := n_lapsed + 1;
    else
      v_key := to_char(c.paid_until, 'YYYYMMDD') || case when c.paid_until < now() + interval '1 day' then '-1d' else '-3d' end;
      if not v_key = any(c.renewal_reminders) then
        update public.growth_clients set renewal_reminders = array_append(renewal_reminders, v_key) where id = c.id;
        perform public.notify(c.owner_id, 'billing', 'Your package renews on ' || to_char(c.paid_until at time zone 'Africa/Nairobi', 'DD Mon'),
          'Pay KSh ' || coalesce(c.price_kes, 0) || ' for ' || coalesce(c.package_name, 'your package') || ' to keep your posts going without a break.', '/account/growth/?tab=billing');
        n_remind := n_remind + 1;
      end if;
    end if;
  end loop;
  return jsonb_build_object('reminders', n_remind, 'lapsed', n_lapsed);
end $$;
revoke execute on function public.growth_billing_daily() from public, anon, authenticated;
grant execute on function public.growth_billing_daily() to service_role;
