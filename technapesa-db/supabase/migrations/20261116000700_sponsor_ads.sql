-- Sponsor adverts: a thank you note with the sponsor's advert after a reader votes.
-- Challenge 01 becomes a parents' question for Kyandu Bright School; Challenge 02 is scheduled for the following week.

alter table public.challenges add column sponsor_ad_path text;                 -- advert image (storage path or a site path starting with /)
alter table public.challenges add column sponsor_ad_text text check (sponsor_ad_text is null or char_length(sponsor_ad_text) <= 600);
alter table public.challenges add column sponsor_phone text check (sponsor_phone is null or sponsor_phone ~ '^\+254[0-9]{9}$');

create or replace function public.admin_challenge_save(p_id smallint, p jsonb) returns smallint
language plpgsql security definer set search_path = public as $$
declare v smallint; b jsonb;
begin
  if not public.has_permission('challenges.manage') then raise exception 'not allowed'; end if;
  if p_id is null then
    insert into public.challenges (number, slug, title, question, answer_max, brief, rules, prize, sponsor_name, sponsor_url, sponsor_logo_path,
      sponsor_ad_path, sponsor_ad_text, sponsor_phone, opens_at, entries_close_at, voting_close_at, judge_weight, published)
    values ((p->>'number')::smallint, lpad(p->>'number', 2, '0'), p->>'title', nullif(p->>'question', ''), coalesce((p->>'answer_max')::smallint, 500),
            p->>'brief', coalesce(p->>'rules', ''), p->>'prize', nullif(p->>'sponsor_name', ''), nullif(p->>'sponsor_url', ''), nullif(p->>'sponsor_logo_path', ''),
            nullif(p->>'sponsor_ad_path', ''), nullif(p->>'sponsor_ad_text', ''), public.clean_phone(nullif(p->>'sponsor_phone', '')),
            (p->>'opens_at')::timestamptz, (p->>'entries_close_at')::timestamptz, (p->>'voting_close_at')::timestamptz,
            coalesce((p->>'judge_weight')::smallint, 70), coalesce((p->>'published')::boolean, false))
    returning id into v;
  else
    select to_jsonb(c) into b from public.challenges c where id = p_id; if b is null then raise exception 'unknown challenge'; end if;
    update public.challenges set title = p->>'title', question = nullif(p->>'question', ''), answer_max = coalesce((p->>'answer_max')::smallint, answer_max),
      brief = p->>'brief', rules = coalesce(p->>'rules', ''), prize = p->>'prize',
      sponsor_name = nullif(p->>'sponsor_name', ''), sponsor_url = nullif(p->>'sponsor_url', ''),
      sponsor_logo_path = case when p ? 'sponsor_logo_path' then nullif(p->>'sponsor_logo_path', '') else sponsor_logo_path end,
      sponsor_ad_path = case when p ? 'sponsor_ad_path' then nullif(p->>'sponsor_ad_path', '') else sponsor_ad_path end,
      sponsor_ad_text = case when p ? 'sponsor_ad_text' then nullif(p->>'sponsor_ad_text', '') else sponsor_ad_text end,
      sponsor_phone = case when p ? 'sponsor_phone' then public.clean_phone(nullif(p->>'sponsor_phone', '')) else sponsor_phone end,
      opens_at = (p->>'opens_at')::timestamptz, entries_close_at = (p->>'entries_close_at')::timestamptz, voting_close_at = (p->>'voting_close_at')::timestamptz,
      judge_weight = coalesce((p->>'judge_weight')::smallint, judge_weight), published = coalesce((p->>'published')::boolean, published)
    where id = p_id;
    v := p_id;
  end if;
  perform public.log_action('challenge.saved', 'challenge', v::text, b, (select to_jsonb(c) from public.challenges c where id = v));
  return v;
end $$;

drop view public.challenge_list;
create view public.challenge_list with (security_barrier = true) as
  select c.id, c.number, c.slug, c.title, c.question, c.answer_max, c.brief, c.rules, c.prize, c.sponsor_name, c.sponsor_url, c.sponsor_logo_path,
         c.sponsor_ad_path, c.sponsor_ad_text, c.sponsor_phone,
         c.opens_at, c.entries_close_at, c.voting_close_at, c.judge_weight, public.challenge_phase(c) as phase,
         c.winner_story_id, c.winner_note, c.results_at,
         (select count(*) from public.stories s where s.challenge_id = c.id and s.status = 'published') as entries
  from public.challenges c where c.published;
revoke all on public.challenge_list from anon, authenticated;
grant all on public.challenge_list to service_role;
grant select on public.challenge_list to anon, authenticated;

-- Challenge 01 (this week): a parents' question, sponsored by Kyandu Bright School
update public.challenges set
  title = 'Boarding: When Is the Right Time?',
  question = 'At what grade do you think it is best to start boarding your child, and why?',
  answer_max = 500,
  brief = 'Parents, teachers and former boarders: share your view in a few sentences. Read other answers, like the ones you agree with, and vote for the most helpful answer. The best answer wins KSh 500 airtime.',
  rules = E'Free to enter and free to vote. There is nothing to pay and nothing to buy.\n'
    'Anyone with a free TECH na PESA account can take part. There is no limit on the number of participants.\n'
    'One answer per person, up to 500 characters (about 3 to 5 sentences). You can edit your answer until the challenge closes.\n'
    'The challenge runs for one week: from Monday 16 November 2026 to Sunday 23 November 2026 at 11.59 pm. Answers and votes close at the same time.\n'
    'Every signed in reader has one vote and can move it to another answer until the challenge closes. You cannot vote for your own answer.\n'
    'Our judges score each answer for how helpful, thoughtful and clearly written it is (70 percent of the result). Public votes make up the other 30 percent.\n'
    'The winner is announced on Monday 24 November 2026 on TECH na PESA and our Facebook Page.\n'
    'The prize of KSh 500 airtime is sent to the phone number in the winner''s profile, so add yours in My account.\n'
    'Respect other parents'' choices. Abusive, copied or misleading answers are removed. The judges'' decision is final.',
  sponsor_name = 'Kyandu Bright School',
  sponsor_url = 'https://kyandubright.sc.ke/',
  sponsor_logo_path = '/sponsors/kyandu-logo.png',
  sponsor_ad_path = '/sponsors/kyandu-enrolment.jpg',
  sponsor_ad_text = 'Kyandu Bright School, Oasis of Excellence, along Kangundo Kathiani Road. ECDE, Primary and Junior School (Grades 7 to 9). Boys and girls, day and boarding. Enrolment second interviews: 16th to 21st November 2026. Grade 9 is full; other grades are open.',
  sponsor_phone = '+254705234763'
where slug = '01';

-- Challenge 02 (next week), shown as "opens soon"
insert into public.challenges (number, slug, title, question, answer_max, brief, rules, prize, sponsor_name, sponsor_url, sponsor_logo_path,
  sponsor_ad_path, sponsor_ad_text, sponsor_phone, opens_at, entries_close_at, voting_close_at, judge_weight, published)
select 2, '02', 'Choosing the Right School',
  'What should parents look for when choosing a school for Primary and Junior School?',
  500,
  'Share the one or two things you would check before taking your child to a primary or junior school. Read other answers, vote for the most helpful one, and win KSh 500 airtime.',
  replace(replace(c.rules, 'Monday 16 November 2026 to Sunday 23 November 2026', 'Monday 24 November 2026 to Sunday 30 November 2026'), 'Monday 24 November 2026 on TECH', 'Monday 1 December 2026 on TECH'),
  'KSh 500 airtime', c.sponsor_name, c.sponsor_url, c.sponsor_logo_path, c.sponsor_ad_path, c.sponsor_ad_text, c.sponsor_phone,
  '2026-11-24 00:00:00+03', '2026-11-30 23:59:59+03', '2026-11-30 23:59:59+03', 70, true
from public.challenges c where c.slug = '01'
on conflict (number) do nothing;
