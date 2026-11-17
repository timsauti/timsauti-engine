-- Simple payments: clients pay through Paystack payment pages (one link per package). The site records a pending
-- payment when the client starts, and staff mark it paid after checking it in the Paystack dashboard.
-- The automatic flow (Edge Functions) stays in place for later; payments.mode chooses which one clients see.

insert into public.site_settings (key, value, is_public) values
  ('payments.mode', '"links"', true),
  ('payments.links', '{}', true)
on conflict (key) do nothing;

-- Activates a client's package for one period from a payment row (shared by staff confirmations).
create or replace function public.payment_activate(p_payment uuid, p_channel text, p_provider_id text, p_raw jsonb) returns void
language plpgsql security definer set search_path = public as $$
declare pay public.payments; pk public.growth_packages; c public.growth_clients; v_start timestamptz; v_end timestamptz;
begin
  select * into pay from public.payments where id = p_payment for update;
  if not found then raise exception 'payment not found'; end if;
  if pay.status = 'success' then raise exception 'this payment is already marked as paid'; end if;
  select * into pk from public.growth_packages where key = pay.package_key;
  select * into c from public.growth_clients where id = pay.client_id;
  v_start := greatest(now(), coalesce(c.paid_until, now()));
  v_end := v_start + case pk.billing_period when 'quarterly' then interval '3 months' when 'yearly' then interval '1 year' else interval '1 month' end;
  update public.payments set status = 'success', channel = p_channel, provider_id = p_provider_id, raw = p_raw, paid_at = now(),
    period_start = v_start, period_end = v_end where id = pay.id;
  update public.growth_clients set status = 'subscribed', package_key = pay.package_key, paid_until = v_end, updated_at = now() where id = c.id;
  perform public.growth_log(c.id, 'payment', 'Payment received: KSh ' || pay.amount_kes || ' for ' || pk.name || ', paid up to ' || to_char(v_end at time zone 'Africa/Nairobi', 'DD Mon YYYY') || '. Paystack reference ' || coalesce(p_provider_id, pay.reference) || '.');
  perform public.notify(pay.owner_id, 'billing', 'Payment received: KSh ' || pay.amount_kes, pk.name || ' package, paid up to ' || to_char(v_end at time zone 'Africa/Nairobi', 'DD Mon YYYY') || '.', '/account/growth/?tab=billing');
end $$;

-- Staff: mark a pending payment as paid after finding it in Paystack.
create or replace function public.admin_payment_mark_paid(p_payment uuid, p_provider_ref text) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not (public.has_permission('growth.manage') and public.has_permission('payments.view')) then raise exception 'not allowed'; end if;
  if char_length(trim(coalesce(p_provider_ref, ''))) < 4 then raise exception 'enter the Paystack reference of the payment'; end if;
  if exists (select 1 from public.payments where provider_id = trim(p_provider_ref) and status = 'success') then raise exception 'that Paystack reference is already recorded'; end if;
  perform public.payment_activate(p_payment, 'paystack link', trim(p_provider_ref), jsonb_build_object('marked_by', auth.uid()));
  perform public.log_action('payment.marked_paid', 'payment', p_payment::text, to_jsonb('pending'::text), jsonb_build_object('paystack_reference', trim(p_provider_ref)));
end $$;

-- Staff: record a payment a client made without starting it on the site.
create or replace function public.admin_payment_record(p_client uuid, p_package text, p_provider_ref text) returns uuid
language plpgsql security definer set search_path = public as $$
declare c public.growth_clients; p public.growth_packages; v uuid;
begin
  if not (public.has_permission('growth.manage') and public.has_permission('payments.view')) then raise exception 'not allowed'; end if;
  select * into c from public.growth_clients where id = p_client; if not found then raise exception 'client not found'; end if;
  select * into p from public.growth_packages where key = p_package and not is_trial and price_kes > 0; if not found then raise exception 'choose a paid package'; end if;
  insert into public.payments (reference, owner_id, client_id, package_key, amount_kes)
  values ('TNP-' || upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 16)), c.owner_id, c.id, p.key, p.price_kes) returning id into v;
  perform public.admin_payment_mark_paid(v, p_provider_ref);
  return v;
end $$;

revoke execute on function public.payment_activate(uuid, text, text, jsonb), public.admin_payment_mark_paid(uuid, text), public.admin_payment_record(uuid, text, text) from public, anon, authenticated;
grant execute on function public.admin_payment_mark_paid(uuid, text), public.admin_payment_record(uuid, text, text) to authenticated;
grant execute on all functions in schema public to service_role;
