-- The TECH na PESA Facebook Page, run by the agent (owner, 17 Nov 2026): three designed posts a day (morning question,
-- midday tip or site content, evening Kenyan tech and money news), the website link always in the first comment.
alter table public.social_shares drop constraint social_shares_kind_check;
alter table public.social_shares add constraint social_shares_kind_check
  check (kind in ('listing', 'promo', 'article', 'news', 'tip', 'question', 'challenge', 'story'));
alter table public.social_shares add column slot text;
alter table public.social_shares add column comment_id text;
create unique index social_shares_slot on public.social_shares (page_key, slot) where slot is not null and status in ('planned', 'posted');
insert into public.site_settings (key, value, is_public) values ('social.page_plan', '"off"', false) on conflict (key) do nothing;
