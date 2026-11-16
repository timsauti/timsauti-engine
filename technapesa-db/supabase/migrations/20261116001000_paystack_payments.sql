-- Paystack payments for Digital Growth packages (M-PESA and card, in KES), and trial applications switched on.
-- The amount always comes from the package price in this database, never from the browser. A payment is confirmed
-- only by the server (Paystack webhook or a server-side verification), through payment_confirm(), which checks
-- the amount and currency and is safe to run twice.

update public.site_settings set value = 'true', updated_at = now() where key = 'growth.trials_open';
insert into public.audit_log (actor_kind, action, entity, entity_id, before, after, note)
values ('system', 'setting.changed', 'site_setting', 'growth.trials_open', 'false', 'true', 'Switched on at the owner''s request, 16 Nov 2026');

alter table public.growth_clients add column paid_until timestamptz;

create table public.payments (
  id uuid primary key default gen_random_uuid(),
  reference text not null unique check (reference ~ '^TNP-[A-Z0-9]{10,30}$'),
  owner_id uuid not null references auth.users(id) on delete restrict,
  client_id uuid not null references public.growth_clients(id) on delete restrict,
  package_key text not null references public.growth_packages(key),
  amount_kes integer not null check (amount_kes > 0),
  provider text not null default 'paystack',
  status text not null default 'pending' check (status in ('pending', 'success', 'failed', 'abandoned')),
  channel text,
  provider_id text,
  period_start timestamptz,
  period_end timestamptz,
  paid_at timestamptz,
  raw jsonb,
  created_at timestamptz not null default now()
);
create index payments_owner on public.payments (owner_id, created_at desc);
create index payments_client on public.payments (client_id, created_at desc);

-- The client starts a payment for a package. Returns the reference the Edge Function uses with Paystack.
create or replace function public.payment_create(p_client uuid, p_package text) returns text
language plpgsql security definer set search_path = public as $$
declare c public.growth_clients; p public.growth_packages; v_ref text;
begin
  select * into c from public.growth_clients where id = p_client and owner_id = auth.uid();
  if not found then raise exception 'not allowed'; end if;
  if c.status not in ('approved', 'trial_active', 'trial_paused', 'trial_ended', 'subscribed') then
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

-- Server only (Edge Functions with the service key). Confirms a payment once Paystack reports it as successful.
create or replace function public.payment_confirm(p_reference text, p_status text, p_amount_minor bigint, p_currency text,
  p_channel text, p_provider_id text, p_raw jsonb) returns text
language plpgsql security definer set search_path = public as $$
declare pay public.payments; pk public.growth_packages; c public.growth_clients; v_start timestamptz; v_end timestamptz;
begin
  if not public.is_service() then raise exception 'not allowed'; end if;
  select * into pay from public.payments where reference = p_reference for update;
  if not found then return 'unknown reference'; end if;
  if pay.status = 'success' then return 'already confirmed'; end if;
  if p_status <> 'success' then
    update public.payments set status = case when p_status = 'abandoned' then 'abandoned' else 'failed' end, raw = p_raw, channel = p_channel where id = pay.id;
    return 'not successful';
  end if;
  if upper(coalesce(p_currency, '')) <> 'KES' or p_amount_minor <> pay.amount_kes::bigint * 100 then
    update public.payments set status = 'failed', raw = p_raw where id = pay.id;
    perform public.log_action('payment.mismatch', 'payment', pay.id::text, to_jsonb(pay.amount_kes), p_raw, 'amount or currency did not match');
    return 'amount mismatch';
  end if;
  select * into pk from public.growth_packages where key = pay.package_key;
  select * into c from public.growth_clients where id = pay.client_id;
  v_start := greatest(now(), coalesce(c.paid_until, now()));
  v_end := v_start + case pk.billing_period when 'quarterly' then interval '3 months' when 'yearly' then interval '1 year' else interval '1 month' end;
  update public.payments set status = 'success', channel = p_channel, provider_id = p_provider_id, raw = p_raw, paid_at = now(),
    period_start = v_start, period_end = v_end where id = pay.id;
  update public.growth_clients set status = 'subscribed', package_key = pay.package_key, paid_until = v_end, updated_at = now() where id = c.id;
  perform public.growth_log(c.id, 'payment', 'Payment received: KSh ' || pay.amount_kes || ' for ' || pk.name || ', paid up to ' || to_char(v_end at time zone 'Africa/Nairobi', 'DD Mon YYYY') || '. Reference ' || pay.reference || '.');
  perform public.notify(pay.owner_id, 'billing', 'Payment received: KSh ' || pay.amount_kes, pk.name || ' package, paid up to ' || to_char(v_end at time zone 'Africa/Nairobi', 'DD Mon YYYY') || '. Reference ' || pay.reference, '/account/growth/?tab=billing');
  perform public.log_action('payment.confirmed', 'payment', pay.id::text, to_jsonb('pending'::text), jsonb_build_object('amount_kes', pay.amount_kes, 'package', pay.package_key, 'reference', pay.reference, 'channel', p_channel));
  return 'confirmed';
end $$;

create or replace function public.admin_list_payments(p_status text default null)
returns table (id uuid, reference text, created_at timestamptz, paid_at timestamptz, status text, amount_kes integer, package_key text, channel text,
               business_name text, owner_name text, owner_email text, period_end timestamptz)
language plpgsql stable security definer set search_path = public as $$
begin
  if not public.has_permission('payments.view') then raise exception 'not allowed'; end if;
  return query select p.id, p.reference, p.created_at, p.paid_at, p.status, p.amount_kes, p.package_key, p.channel, c.business_name,
    coalesce(pr.full_name, pr.display_name), u.email::text, p.period_end
    from public.payments p join public.growth_clients c on c.id = p.client_id left join public.profiles pr on pr.id = p.owner_id join auth.users u on u.id = p.owner_id
    where p_status is null or p.status = p_status order by p.created_at desc limit 300;
end $$;

alter table public.payments enable row level security;
create policy "own or finance payments" on public.payments for select using (owner_id = auth.uid() or public.has_permission('payments.view'));
revoke all on public.payments from anon, authenticated;
grant all on public.payments to service_role;
grant select on public.payments to authenticated;
revoke execute on function public.payment_create(uuid, text), public.payment_confirm(text, text, bigint, text, text, text, jsonb), public.admin_list_payments(text) from public, anon, authenticated;
grant execute on function public.payment_create(uuid, text), public.admin_list_payments(text) to authenticated;
grant execute on all functions in schema public to service_role;
