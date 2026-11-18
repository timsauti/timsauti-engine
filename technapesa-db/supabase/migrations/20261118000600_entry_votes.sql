-- Public vote totals for each published entry, so every entry shows the votes it has collected.
create or replace function public.challenge_vote_counts(p_challenge smallint) returns table (story_id uuid, votes bigint)
language sql stable security definer set search_path = public as $$
  select s.id, (select count(*) from public.challenge_votes v where v.story_id = s.id)
  from public.stories s where s.challenge_id = p_challenge and s.status = 'published';
$$;
grant execute on function public.challenge_vote_counts(smallint) to anon, authenticated;
