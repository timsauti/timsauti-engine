-- Lets an entry link say "being checked" instead of "not found" while a challenge entry waits for its originality check.
-- Returns only the status and the challenge, never the content of an unpublished entry.
create or replace function public.story_entry_status(p_slug text) returns jsonb
language sql stable security definer set search_path = public as $$
  select jsonb_build_object('status', s.status, 'challenge_slug', c.slug)
  from public.stories s join public.challenges c on c.id = s.challenge_id
  where s.slug = p_slug and s.status in ('pending', 'published');
$$;
grant execute on function public.story_entry_status(text) to anon, authenticated;
