-- Photo challenges: an original photo with a short story. Every photo entry waits for an originality check by a moderator
-- (reverse image search links in Admin), and the entrant confirms the photo is their own.
-- Challenge 01 becomes "My Primary School Memory".

alter table public.challenges add column entry_kind text not null default 'text' check (entry_kind in ('text', 'photo'));
alter table public.stories add column original_declared_at timestamptz;

create or replace function public.story_save(p_id uuid, p_title text, p_body text, p_category text, p_cover_path text default null,
  p_link text default null, p_challenge smallint default null) returns uuid
language plpgsql security definer set search_path = public as $$
declare s public.stories; c public.challenges; v_entry boolean; v_id uuid; v_slug text; v_trusted boolean; v_status text;
  v_max int := coalesce((select value::int from public.site_settings where key = 'community.stories_per_day'), 5);
begin
  if auth.uid() is null then raise exception 'sign in to publish a story'; end if;
  if not exists (select 1 from public.profiles where id = auth.uid() and status = 'active') then raise exception 'account is not active'; end if;
  p_title := trim(regexp_replace(coalesce(p_title, ''), '\s+', ' ', 'g')); p_body := trim(coalesce(p_body, ''));
  -- challenge answers are short: a few words to answer_max characters, and the title is made for the writer
  v_entry := p_challenge is not null or (p_id is not null and exists (select 1 from public.stories where id = p_id and challenge_id is not null));
  if v_entry then
    select * into c from public.challenges where id = coalesce(p_challenge, (select challenge_id from public.stories where id = p_id));
    if char_length(p_body) < 20 then raise exception 'your answer is too short; write at least one full sentence (20 characters)'; end if;
    if char_length(p_body) > c.answer_max then raise exception 'keep your answer within % characters', c.answer_max; end if;
    p_title := 'Challenge ' || c.slug || ' answer';
    if c.entry_kind = 'photo' and p_cover_path is null then raise exception 'add your photo; this challenge needs an original photo'; end if;
  else
    if char_length(p_title) < 5 then raise exception 'give your story a title of at least 5 characters'; end if;
    if char_length(p_body) < 80 then raise exception 'your story is too short; write at least a few sentences (80 characters)'; end if;
  end if;
  if p_cover_path is not null and split_part(p_cover_path, '/', 1) <> auth.uid()::text then raise exception 'that photo does not belong to your account'; end if;
  p_link := nullif(trim(coalesce(p_link, '')), '');
  if p_link is not null and p_link !~ '^https?://' then p_link := 'https://' || p_link; end if;
  v_trusted := coalesce((select value::boolean from public.site_settings where key = 'community.auto_publish_trusted'), true)
               and exists (select 1 from public.stories where author_id = auth.uid() and status = 'published' and published_at is not null)
               or public.has_permission('moderation.manage');

  if p_id is null then
    if (select count(*) from public.stories where author_id = auth.uid() and created_at > now() - interval '1 day') >= v_max then
      raise exception 'you have shared % stories today; please come back tomorrow', v_max;
    end if;
    if p_challenge is not null then
      if c.id is null or public.challenge_phase(c) <> 'open' then raise exception 'this challenge is not taking entries right now'; end if;
      if exists (select 1 from public.stories where challenge_id = p_challenge and author_id = auth.uid() and status <> 'deleted') then
        raise exception 'you have already entered this challenge; you can edit your entry instead';
      end if;
    end if;
    v_slug := left(public.slugify(p_title), 70);
    if char_length(v_slug) < 3 then v_slug := 'story'; end if;
    v_slug := v_slug || '-' || substr(md5(random()::text || clock_timestamp()::text), 1, 5);
    v_status := case when v_trusted and not (v_entry and c.entry_kind = 'photo' and not public.has_permission('moderation.manage')) then 'published' else 'pending' end;
    insert into public.stories (slug, author_id, title, body, category, cover_path, link, challenge_id, status, published_at)
    values (v_slug, auth.uid(), left(p_title, 140), left(p_body, 20000), p_category, p_cover_path, p_link, p_challenge, v_status,
            case when v_status = 'published' then now() end)
    returning id into v_id;
    return v_id;
  end if;

  select * into s from public.stories where id = p_id and author_id = auth.uid() and status <> 'deleted';
  if not found then raise exception 'story not found'; end if;
  if s.status = 'removed' then raise exception 'this story was removed by a moderator and cannot be edited'; end if;
  if s.challenge_id is not null and (select public.challenge_phase(x) from public.challenges x where x.id = s.challenge_id) <> 'open' then
    raise exception 'challenge entries cannot be changed after entries close';
  end if;
  v_status := case when s.status = 'published' and v_trusted
                    and not (v_entry and c.entry_kind = 'photo' and p_cover_path is distinct from s.cover_path) then 'published' else 'pending' end;
  update public.stories set title = left(p_title, 140), body = left(p_body, 20000), category = p_category, cover_path = p_cover_path, link = p_link,
    status = v_status, status_reason = case when v_status = 'pending' then null else status_reason end,
    published_at = case when v_status = 'published' then coalesce(published_at, now()) else published_at end, updated_at = now()
  where id = p_id;
  return p_id;
end $$;

create or replace function public.challenge_photo_submit(p_challenge smallint, p_body text, p_cover_path text, p_original boolean) returns uuid
language plpgsql security definer set search_path = public as $$
declare v uuid;
begin
  if not coalesce(p_original, false) then raise exception 'please confirm that the photo is your own'; end if;
  v := public.story_save(null, '', p_body, 'life', p_cover_path, null, p_challenge);
  update public.stories set original_declared_at = now() where id = v;
  return v;
end $$;
revoke execute on function public.challenge_photo_submit(smallint, text, text, boolean) from public, anon;
grant execute on function public.challenge_photo_submit(smallint, text, text, boolean) to authenticated, service_role;

drop view public.challenge_list;
create view public.challenge_list with (security_barrier = true) as
  select c.id, c.number, c.slug, c.title, c.question, c.answer_max, c.entry_kind, c.brief, c.rules, c.prize, c.sponsor_name, c.sponsor_url, c.sponsor_logo_path,
         c.sponsor_ad_path, c.sponsor_ad_text, c.sponsor_phone,
         c.opens_at, c.entries_close_at, c.voting_close_at, c.judge_weight, public.challenge_phase(c) as phase,
         c.winner_story_id, c.winner_note, c.results_at,
         (select count(*) from public.stories s where s.challenge_id = c.id and s.status = 'published') as entries
  from public.challenges c where c.published;
revoke all on public.challenge_list from anon, authenticated;
grant all on public.challenge_list to service_role;
grant select on public.challenge_list to anon, authenticated;

update public.challenges set
  entry_kind = 'photo',
  title = 'My Primary School Memory',
  question = 'One photo. One primary school memory. Tell us the story behind it and make us feel it.',
  answer_max = 600,
  brief = 'Share an original photo that takes you back to primary school: your old classroom, a school trip, your first uniform, a teacher, a friend, a sports day. Tell the touching story behind it in a few sentences. The story that moves readers the most wins KSh 500 airtime.',
  rules = E'Free to enter and free to vote. There is nothing to pay and nothing to buy.\n'
    'Anyone with a free TECH na PESA account can take part. There is no limit on the number of participants. One entry per person.\n'
    'Your photo must be your own: taken by you, or from your own or your family''s album. Photos downloaded from the internet or taken from other people''s pages are disqualified.\n'
    'Every photo is checked for originality before it appears on the site, including a search of the internet for copies.\n'
    'If your photo shows other people, make sure they are happy for it to be shared. Do not post photos of other people''s children without their parent''s permission.\n'
    'Write a short story to go with your photo, up to 600 characters (about 3 to 6 sentences), in your own words.\n'
    'The challenge runs for one week: from Monday 16 November 2026 to Sunday 23 November 2026 at 11.59 pm. Entries and votes close at the same time.\n'
    'Every signed in reader has one vote and can move it to another entry until the challenge closes. You cannot vote for your own entry.\n'
    'Our judges score each entry for how touching, original and well told the story is (70 percent of the result). Public votes make up the other 30 percent.\n'
    'The winner is announced on Monday 24 November 2026 on TECH na PESA and our Facebook Page. The prize of KSh 500 airtime is sent to the phone number in the winner''s profile, so add yours in My account.\n'
    'The judges'' decision is final.'
where slug = '01';
