-- Owner, 18 Nov 2026: Challenge 01 launches officially today. Most votes in one week wins KSh 500 airtime (M-PESA),
-- entrants give their M-PESA number when registering, winner published on the site and the Facebook Page.
update public.challenges set
  opens_at = least(opens_at, now()),
  entries_close_at = '2026-11-25 23:59:59+03',
  voting_close_at = '2026-11-25 23:59:59+03',
  judge_weight = 0,
  brief = 'Share a photo of you, or one you took yourself, that reminds you of something from your primary school life. Tell the short story behind it and make it interesting. Then share your post with friends so they vote. The entry with the most votes after one week wins KSh 500 airtime, sent by M-PESA. Thanks to Kyandu Bright Academy.',
  rules = E'Free to enter and free to vote. There is nothing to pay and nothing to buy.\n'
    'Anyone with a free TECH na PESA account can take part. Add your M-PESA number when you register so we can send the prize. One entry per person.\n'
    'Your photo must be your own: of you, taken by you, or from your own or your family''s album. Photos downloaded from the internet or taken from other people''s pages are disqualified.\n'
    'Every photo is checked for originality before it appears on the site, including a search of the internet for copies.\n'
    'If your photo shows other people, make sure they are happy for it to be shared. Do not post photos of other people''s children without their parent''s permission.\n'
    'Write a short story to go with your photo, up to 600 characters (about 3 to 6 sentences), in your own words.\n'
    'The challenge runs for one week, until Wednesday 25 November 2026 at 11.59 pm. Entries and votes close at the same time.\n'
    'Every signed in reader has one vote and can move it to another entry until the challenge closes. You cannot vote for your own entry.\n'
    'The entry with the most votes wins. Votes from fake or duplicate accounts are removed, and entries that use them are disqualified.\n'
    'The winner is announced on Thursday 26 November 2026 on the TECH na PESA website and Facebook Page. The KSh 500 airtime is sent by M-PESA to the number on the winner''s account.'
where number = 1;

update public.challenges set opens_at = '2026-11-26 00:00:00+03', entries_close_at = '2026-12-02 23:59:59+03', voting_close_at = '2026-12-02 23:59:59+03'
where number = 2 and opens_at > now();

-- The M-PESA number given when registering is saved on the profile (a wrong number never blocks sign up).
create or replace function public.handle_new_user() returns trigger
language plpgsql security definer set search_path = public as $$
declare m jsonb := coalesce(new.raw_user_meta_data, '{}'::jsonb); v text := coalesce(m->>'terms_version', 'unrecorded'); ph text;
begin
  begin ph := public.clean_phone(m->>'phone'); exception when others then ph := null; end;
  insert into public.profiles (id, full_name, display_name, phone)
  values (new.id, nullif(left(trim(m->>'full_name'), 120), ''), nullif(left(trim(coalesce(m->>'display_name', m->>'full_name')), 60), ''), ph);
  insert into public.user_roles (user_id, role) values (new.id, 'general_user');
  if (m->>'accepted_terms')::boolean is true then
    insert into public.consents (user_id, kind, version, granted, source) values
      (new.id, 'terms', v, true, 'signup'), (new.id, 'privacy', v, true, 'signup');
  end if;
  insert into public.consents (user_id, kind, version, granted, source)
  values (new.id, 'marketing_email', v, coalesce((m->>'marketing_email')::boolean, false), 'signup');
  insert into public.notification_prefs (user_id, topic, channel, enabled)
  select new.id, t, c, case when t = 'news' then coalesce((m->>'marketing_email')::boolean, false) else true end
  from unnest(array['account','billing','trial','content','enquiries','reviews','verification','news']) t,
       unnest(array['in_app','email']) c;
  perform public.log_action('account.created', 'profile', new.id::text, null, null, null);
  return new;
end $$;

-- Challenge entrants must have an M-PESA number on their account (the prize goes there).
create or replace function public.challenge_entry_needs_phone() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.challenge_id is not null and (tg_op = 'INSERT' or old.challenge_id is distinct from new.challenge_id)
     and not exists (select 1 from public.profiles where id = new.author_id and phone is not null) then
    raise exception 'add your M-PESA number first so we can send you the prize';
  end if;
  return new;
end $$;
create trigger stories_challenge_phone before insert or update of challenge_id on public.stories for each row execute function public.challenge_entry_needs_phone();

-- Members save their M-PESA number in one step from the challenge page.
create or replace function public.profile_set_phone(p_phone text) returns text
language plpgsql security definer set search_path = public as $$
declare ph text := public.clean_phone(p_phone);
begin
  if auth.uid() is null then raise exception 'please sign in'; end if;
  if ph is null then raise exception 'enter your M-PESA number, for example 0712 345 678'; end if;
  update public.profiles set phone = ph, updated_at = now() where id = auth.uid();
  return ph;
end $$;
revoke execute on function public.profile_set_phone(text) from public, anon;
grant execute on function public.profile_set_phone(text) to authenticated;

-- The sponsor's name as the owner writes it in the launch post.
update public.challenges set sponsor_name = 'Kyandu Bright Academy' where sponsor_name = 'Kyandu Bright School';
