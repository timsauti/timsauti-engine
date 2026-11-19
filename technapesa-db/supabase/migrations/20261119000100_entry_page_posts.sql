-- Owner, 19 Nov 2026: every approved challenge entry is posted on the TECH na PESA Facebook Page to help it collect votes.
alter table public.social_shares drop constraint social_shares_kind_check;
alter table public.social_shares add constraint social_shares_kind_check
  check (kind in ('listing', 'promo', 'article', 'news', 'tip', 'question', 'challenge', 'story', 'entry'));

-- Entrants are told in the rules that their entry may be shown on the Page.
update public.challenges
set rules = rules || E'\nTo help you collect votes, approved entries (the photo, your display name and the start of your story) are shared on the TECH na PESA Facebook Page with a link to vote. Ask us any time and we will take yours down.'
where coalesce(voting_close_at, now()) > now() and rules not like '%shared on the TECH na PESA Facebook Page%';
