-- Challenges become short, fun questions: a question, a short answer limit, a sponsor logo, and a site pop up.
-- Challenge 01 is reset to a one week question challenge.

alter table public.challenges add column question text check (question is null or char_length(question) between 10 and 300);
alter table public.challenges add column answer_max smallint not null default 500 check (answer_max between 50 and 5000);
alter table public.stories drop constraint stories_body_check;
alter table public.stories add constraint stories_body_check check (char_length(body) between 20 and 20000);

insert into public.site_settings (key, value, is_public) values ('community.challenge_popup', 'true', true) on conflict (key) do nothing;

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
    v_status := case when v_trusted then 'published' else 'pending' end;
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
  v_status := case when s.status = 'published' and v_trusted then 'published' else 'pending' end;
  update public.stories set title = left(p_title, 140), body = left(p_body, 20000), category = p_category, cover_path = p_cover_path, link = p_link,
    status = v_status, status_reason = case when v_status = 'pending' then null else status_reason end,
    published_at = case when v_status = 'published' then coalesce(published_at, now()) else published_at end, updated_at = now()
  where id = p_id;
  return p_id;
end $$;

create or replace function public.admin_challenge_save(p_id smallint, p jsonb) returns smallint
language plpgsql security definer set search_path = public as $$
declare v smallint; b jsonb;
begin
  if not public.has_permission('challenges.manage') then raise exception 'not allowed'; end if;
  if p_id is null then
    insert into public.challenges (number, slug, title, question, answer_max, brief, rules, prize, sponsor_name, sponsor_url, sponsor_logo_path,
      opens_at, entries_close_at, voting_close_at, judge_weight, published)
    values ((p->>'number')::smallint, lpad(p->>'number', 2, '0'), p->>'title', nullif(p->>'question', ''), coalesce((p->>'answer_max')::smallint, 500),
            p->>'brief', coalesce(p->>'rules', ''), p->>'prize', nullif(p->>'sponsor_name', ''), nullif(p->>'sponsor_url', ''), nullif(p->>'sponsor_logo_path', ''),
            (p->>'opens_at')::timestamptz, (p->>'entries_close_at')::timestamptz, (p->>'voting_close_at')::timestamptz,
            coalesce((p->>'judge_weight')::smallint, 70), coalesce((p->>'published')::boolean, false))
    returning id into v;
  else
    select to_jsonb(c) into b from public.challenges c where id = p_id; if b is null then raise exception 'unknown challenge'; end if;
    update public.challenges set title = p->>'title', question = nullif(p->>'question', ''), answer_max = coalesce((p->>'answer_max')::smallint, answer_max),
      brief = p->>'brief', rules = coalesce(p->>'rules', ''), prize = p->>'prize',
      sponsor_name = nullif(p->>'sponsor_name', ''), sponsor_url = nullif(p->>'sponsor_url', ''),
      sponsor_logo_path = case when p ? 'sponsor_logo_path' then nullif(p->>'sponsor_logo_path', '') else sponsor_logo_path end,
      opens_at = (p->>'opens_at')::timestamptz, entries_close_at = (p->>'entries_close_at')::timestamptz, voting_close_at = (p->>'voting_close_at')::timestamptz,
      judge_weight = coalesce((p->>'judge_weight')::smallint, judge_weight), published = coalesce((p->>'published')::boolean, published)
    where id = p_id;
    v := p_id;
  end if;
  perform public.log_action('challenge.saved', 'challenge', v::text, b, (select to_jsonb(c) from public.challenges c where id = v));
  return v;
end $$;

-- the public list now carries the question, answer limit and sponsor logo
drop view public.challenge_list;
create view public.challenge_list with (security_barrier = true) as
  select c.id, c.number, c.slug, c.title, c.question, c.answer_max, c.brief, c.rules, c.prize, c.sponsor_name, c.sponsor_url, c.sponsor_logo_path,
         c.opens_at, c.entries_close_at, c.voting_close_at, c.judge_weight, public.challenge_phase(c) as phase,
         c.winner_story_id, c.winner_note, c.results_at,
         (select count(*) from public.stories s where s.challenge_id = c.id and s.status = 'published') as entries
  from public.challenges c where c.published;
revoke all on public.challenge_list from anon, authenticated;
grant all on public.challenge_list to service_role;
grant select on public.challenge_list to anon, authenticated;

-- Challenge 01: one simple question, short answers, one week
update public.challenges set
  title = 'The KSh 1,000 Hustle',
  question = 'You have KSh 1,000 and a smartphone. How would you turn it into more money in one month?',
  answer_max = 500,
  brief = 'Answer one simple question in a few sentences. Be practical, be creative, make us smile. Read other answers, like the ones you love, and vote for the best idea. The best answer wins KSh 500 airtime.',
  rules = E'Free to enter and free to vote. There is nothing to pay and nothing to buy.\n'
    'Anyone with a free TECH na PESA account can take part. There is no limit on the number of participants.\n'
    'One answer per person, up to 500 characters (about 3 to 5 sentences). You can edit your answer until the challenge closes.\n'
    'The challenge runs for one week: from Monday 16 November 2026 to Sunday 23 November 2026 at 11.59 pm. Answers and votes close at the same time.\n'
    'Every signed in reader has one vote and can move it to another answer until the challenge closes. You cannot vote for your own answer.\n'
    'Our judges score each answer for creativity, how practical it is, and how clearly it is written (70 percent of the result). Public votes make up the other 30 percent.\n'
    'The winner is announced on Monday 24 November 2026 on TECH na PESA and our Facebook Page.\n'
    'The prize of KSh 500 airtime is sent to the phone number in the winner''s profile, so add yours in My account.\n'
    'Copied, abusive or misleading answers are removed. The judges'' decision is final.',
  opens_at = '2026-11-16 00:00:00+03', entries_close_at = '2026-11-23 23:59:59+03', voting_close_at = '2026-11-23 23:59:59+03'
where slug = '01';
