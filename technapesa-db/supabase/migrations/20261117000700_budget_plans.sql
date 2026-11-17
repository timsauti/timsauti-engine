-- Owner, 17 Nov 2026: "name your budget". The client enters what they wish to spend; the agent builds a plan for
-- exactly that amount from the owner's rate card (growth.rate_card, editable in Admin, Settings). The agent only
-- chooses items and quantities; every price comes from the rate card and the database recomputes the total.

insert into public.site_settings (key, value, is_public) values ('growth.rate_card', '{
  "min_budget": 1500, "max_budget": 200000,
  "items": {
    "post": {"name": "Designed post with caption", "price": 300, "unit": "post", "max": 90},
    "extra_platform": {"name": "Extra social media platform", "price": 500, "unit": "platform a month", "max": 4},
    "comment_care": {"name": "Comment and message monitoring", "price": 1000, "unit": "a month", "max": 1},
    "weekly_report": {"name": "Weekly report instead of monthly", "price": 1000, "unit": "a month", "max": 1},
    "strategy_call": {"name": "Monthly strategy call", "price": 1000, "unit": "a month", "max": 1},
    "gbp_setup": {"name": "Google Business Profile set up", "price": 2000, "unit": "one time", "max": 1},
    "wa_catalogue": {"name": "WhatsApp Business catalogue set up", "price": 2000, "unit": "one time", "max": 1},
    "challenge_week": {"name": "Sponsored community challenge week", "price": 3000, "unit": "week", "max": 4},
    "story_month": {"name": "Story of the Month sponsorship", "price": 2000, "unit": "a month", "max": 1}
  }}', true) on conflict (key) do nothing;

insert into public.growth_packages (key, name, is_trial, price_kes, billing_period, posts_per_period, graphics_per_period, platforms_count, report_frequency, revisions_per_item, support_level, extras, summary, sort, active)
values ('custom', 'Your own plan', false, 0, 'monthly', 0, 0, 1, 'monthly', 2, 'WhatsApp and email, working days', '', 'A plan built around your budget', 90, false)
on conflict (key) do nothing;

alter table public.growth_clients add column custom_plan jsonb;

create table public.growth_quotes (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users(id) on delete cascade,
  client_id uuid not null references public.growth_clients(id) on delete cascade,
  budget_kes integer not null check (budget_kes > 0),
  goals text check (goals is null or char_length(goals) <= 600),
  items jsonb not null,
  total_kes integer not null check (total_kes > 0),
  summary text check (summary is null or char_length(summary) <= 1500),
  status text not null default 'offered' check (status in ('offered', 'paid', 'replaced', 'expired')),
  created_at timestamptz not null default now(),
  expires_at timestamptz not null default now() + interval '7 days'
);
create index growth_quotes_client on public.growth_quotes (client_id, created_at desc);
alter table public.growth_quotes enable row level security;
create policy "own or staff quotes" on public.growth_quotes for select using (owner_id = auth.uid() or public.has_permission('growth.manage'));
revoke all on public.growth_quotes from anon;
grant select on public.growth_quotes to authenticated;
grant all on public.growth_quotes to service_role;

alter table public.payments add column quote_id uuid references public.growth_quotes(id);

-- The database prices every plan itself from the rate card, so no plan can be charged below the card.
create or replace function public.quote_price(p_items jsonb) returns integer
language plpgsql stable security definer set search_path = public as $$
declare card jsonb := (select value -> 'items' from public.site_settings where key = 'growth.rate_card'); it jsonb; total int := 0; q int;
begin
  for it in select * from jsonb_array_elements(p_items) loop
    if card -> (it->>'key') is null then raise exception 'unknown item %', it->>'key'; end if;
    q := (it->>'qty')::int;
    if q < 1 or q > (card -> (it->>'key') ->> 'max')::int then raise exception 'quantity out of range for %', it->>'key'; end if;
    total := total + q * (card -> (it->>'key') ->> 'price')::int;
  end loop;
  return total;
end $$;
revoke execute on function public.quote_price(jsonb) from public, anon, authenticated;

-- Called by the budget-plan Edge Function (service role) after the agent proposes items.
create or replace function public.quote_save(p_owner uuid, p_client uuid, p_budget int, p_goals text, p_items jsonb, p_summary text) returns uuid
language plpgsql security definer set search_path = public as $$
declare card jsonb := (select value from public.site_settings where key = 'growth.rate_card'); c public.growth_clients; total int; v uuid; items jsonb;
begin
  if not public.is_service() then raise exception 'not allowed'; end if;
  select * into c from public.growth_clients where id = p_client and owner_id = p_owner;
  if not found then raise exception 'not allowed'; end if;
  if p_budget < (card->>'min_budget')::int or p_budget > (card->>'max_budget')::int then raise exception 'budget out of range'; end if;
  if not exists (select 1 from jsonb_array_elements(p_items) x where x->>'key' = 'post') then raise exception 'a plan needs posts'; end if;
  total := public.quote_price(p_items);
  if total > p_budget or total < 1 then raise exception 'plan does not fit the budget'; end if;
  select jsonb_agg(jsonb_build_object('key', x->>'key', 'qty', (x->>'qty')::int, 'name', card->'items'->(x->>'key')->>'name', 'unit', card->'items'->(x->>'key')->>'unit',
    'price', (card->'items'->(x->>'key')->>'price')::int, 'subtotal', (x->>'qty')::int * (card->'items'->(x->>'key')->>'price')::int)) into items from jsonb_array_elements(p_items) x;
  update public.growth_quotes set status = 'replaced' where client_id = p_client and status = 'offered';
  insert into public.growth_quotes (owner_id, client_id, budget_kes, goals, items, total_kes, summary) values (p_owner, p_client, p_budget, left(p_goals, 600), items, total, left(p_summary, 1500)) returning id into v;
  return v;
end $$;
revoke execute on function public.quote_save(uuid, uuid, int, text, jsonb, text) from public, anon, authenticated;

create or replace function public.payment_create_quote(p_quote uuid) returns text
language plpgsql security definer set search_path = public as $$
declare q public.growth_quotes; c public.growth_clients; v_ref text;
begin
  select * into q from public.growth_quotes where id = p_quote and owner_id = auth.uid();
  if not found then raise exception 'not allowed'; end if;
  if q.status <> 'offered' or q.expires_at < now() then raise exception 'this plan has expired; ask the agent for a new one'; end if;
  select * into c from public.growth_clients where id = q.client_id;
  if c.status not in ('approved', 'trial_active', 'trial_paused', 'trial_ended', 'subscribed', 'lapsed') then raise exception 'payment opens once your application is approved'; end if;
  if (select count(*) from public.payments where owner_id = auth.uid() and created_at > now() - interval '1 hour') >= 10 then raise exception 'too many payment attempts; please wait a while'; end if;
  if public.quote_price(q.items) <> q.total_kes then raise exception 'prices have changed; ask the agent for a new plan'; end if;
  v_ref := 'TNP-' || upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 16));
  insert into public.payments (reference, owner_id, client_id, package_key, amount_kes, quote_id) values (v_ref, auth.uid(), q.client_id, 'custom', q.total_kes, q.id);
  return v_ref;
end $$;
revoke execute on function public.payment_create_quote(uuid) from public, anon;
grant execute on function public.payment_create_quote(uuid) to authenticated;

-- When a plan payment succeeds, the plan becomes the client's package.
create or replace function public.payment_quote_paid() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.status = 'success' and old.status is distinct from 'success' and new.quote_id is not null then
    update public.growth_quotes set status = 'paid' where id = new.quote_id;
    update public.growth_clients set custom_plan = (select jsonb_build_object('items', items, 'total_kes', total_kes, 'summary', summary, 'quote_id', id) from public.growth_quotes where id = new.quote_id),
      package_key = 'custom' where id = new.client_id;
    perform public.staff_alert('payment', new.client_id, 'Paid for their own plan: KSh ' || new.amount_kes || ' for ' || (select business_name from public.growth_clients where id = new.client_id) || '. See the plan in Admin.');
  end if;
  return new;
end $$;
create trigger payments_quote_paid after update of status on public.payments for each row execute function public.payment_quote_paid();
