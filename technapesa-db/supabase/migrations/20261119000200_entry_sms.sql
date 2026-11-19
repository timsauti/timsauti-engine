-- SMS to challenge entrants (owner, 19 Nov 2026): a text when their entry is approved and live (with their vote link),
-- or when it needs a change. Sent by the hourly agent through Africa's Talking once AT_USERNAME and AT_API_KEY are set
-- and sms.notifications is switched on; until then messages wait in the queue and are dropped after two days.
insert into public.site_settings (key, value, is_public) values
  ('sms.notifications', '{"on": false, "provider": "africastalking", "sender_id": null}', false)
on conflict (key) do nothing;

create table public.sms_outbox (
  id bigint generated always as identity primary key,
  user_id uuid references auth.users(id) on delete cascade,
  phone text not null check (phone ~ '^\+254[17][0-9]{8}$'),
  message text not null check (char_length(message) <= 300),
  reason text not null,
  ref text,
  status text not null default 'queued' check (status in ('queued', 'sent', 'failed', 'skipped')),
  error text, cost text,
  created_at timestamptz not null default now(), sent_at timestamptz,
  unique (reason, ref)
);
create index sms_outbox_queue on public.sms_outbox (status, created_at);
alter table public.sms_outbox enable row level security;
create policy "staff read sms outbox" on public.sms_outbox for select using (public.has_permission('settings.manage'));
grant select on public.sms_outbox to authenticated;
grant all on public.sms_outbox to service_role;

create or replace function public.entry_sms() returns trigger
language plpgsql security definer set search_path = public as $$
declare ph text; who text; sponsor text; msg text; host text := 'technapesa.co.ke';
begin
  if new.challenge_id is null or new.status is not distinct from old.status then return new; end if;
  select p.phone, split_part(coalesce(nullif(p.display_name, ''), p.full_name, ''), ' ', 1) into ph, who from public.profiles p where p.id = new.author_id;
  if ph is null then return new; end if;
  select sponsor_name into sponsor from public.challenges where id = new.challenge_id;
  if new.status = 'published' then
    msg := 'TECH na PESA: ' || coalesce(nullif(who, '') || ', ', '') || 'your ' || coalesce(sponsor || ' ', '') || 'challenge entry is approved and live. Share it for votes: ' || host || '/s/' || new.slug;
  elsif new.status = 'rejected' then
    msg := 'TECH na PESA: ' || coalesce(nullif(who, '') || ', ', '') || 'your challenge entry needs a small change before it goes live. See the note: ' || host || '/community/write/?id=' || new.id;
  else return new;
  end if;
  insert into public.sms_outbox (user_id, phone, message, reason, ref) values (new.author_id, ph, left(msg, 300), 'entry_' || new.status, new.id::text)
  on conflict (reason, ref) do nothing;
  return new;
end $$;
create trigger stories_entry_sms after update of status on public.stories for each row execute function public.entry_sms();
revoke all on function public.entry_sms() from public, anon, authenticated;
