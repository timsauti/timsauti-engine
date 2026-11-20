-- =============================================================================================
-- TnPVibe polls (owner, 20 Nov 2026: "this poll should not have limited options ... I should also be able to add their small
-- portraits against their names"). Up to 30 options, and each option may carry a small photo (a candidate's portrait).
-- =============================================================================================
alter table public.vibe_poll_options add column photo text check (photo is null or char_length(photo) <= 300);

create or replace function public.vibe_post_json(p public.vibe_posts, viewer uuid) returns jsonb language sql stable security definer set search_path = public as $$
  select jsonb_build_object('id', p.id, 'kind', p.kind, 'body', p.body, 'media', p.media, 'created_at', p.created_at, 'edited_at', p.edited_at,
    'likes', p.likes_count, 'comments', p.comments_count, 'liked', exists (select 1 from public.vibe_likes l where l.post_id = p.id and l.user_id = viewer),
    'mine', p.author_id = viewer, 'featured', p.featured_on_profile, 'author', public.vibe_card(p.author_id, viewer),
    'category', p.category, 'accepted_comment_id', p.accepted_comment_id,
    'community', (select jsonb_build_object('slug', c.slug, 'name', c.name) from public.vibe_communities c where c.id = p.community_id),
    'can_moderate', p.community_id is not null and public.vibe_cm_role(p.community_id, viewer) in ('owner', 'admin', 'moderator'),
    'circle_id', p.circle_id,
    'poll', (select jsonb_build_object('closes_at', pl.closes_at, 'anonymous', pl.anonymous, 'multiple', pl.multiple,
               'closed', pl.closes_at is not null and pl.closes_at < now(),
               'total', (select count(distinct user_id) from public.vibe_poll_votes v where v.post_id = p.id),
               'options', (select jsonb_agg(jsonb_build_object('id', o.id, 'label', o.label, 'photo', o.photo, 'votes', o.votes,
                  'mine', exists (select 1 from public.vibe_poll_votes v where v.option_id = o.id and v.user_id = viewer)) order by o.position) from public.vibe_poll_options o where o.post_id = p.id))
             from public.vibe_polls pl where pl.post_id = p.id));
$$;

create or replace function public.vibe_post_save(p_id bigint, p_kind text, p_body text, p_media text[] default '{}', p_community bigint default null, p_circle uuid default null,
  p_category text default null, p_poll jsonb default null) returns jsonb
language plpgsql security definer set search_path = public as $$
declare ph text; me uuid := public.vibe_need_me(); r public.vibe_posts; m text; opt text; i int := 0;
begin
  foreach m in array coalesce(p_media, '{}') loop
    if m !~ ('^' || me::text || '/[A-Za-z0-9._/-]+$') then raise exception 'photos must be uploaded from your own account'; end if;
  end loop;
  if (select status from public.vibe_profiles where user_id = me) = 'restricted' then raise exception 'your account cannot post right now'; end if;
  if p_id is null then
    if p_community is not null and public.vibe_cm_role(p_community, me) is null then raise exception 'join the community to post in it'; end if;
    if p_circle is not null and not public.vibe_in_circle(p_circle, me) then raise exception 'only circle members can post here'; end if;
    if p_kind = 'announcement' and p_community is not null and public.vibe_cm_role(p_community, me) not in ('owner', 'admin', 'moderator') then raise exception 'only community leaders can post announcements'; end if;
    perform public.vibe_rate('vibe_posts', 'author_id', 20, interval '1 hour', 'posts');
    if p_kind = 'poll' then
      if p_poll is null or jsonb_array_length(coalesce(p_poll->'options', '[]')) not between 2 and 30 then raise exception 'a poll can have 2 to 30 options'; end if;
      if char_length(trim(coalesce(p_body, ''))) < 5 then raise exception 'write the poll question'; end if;
    end if;
    insert into public.vibe_posts (author_id, kind, body, media, community_id, circle_id, category)
    values (me, coalesce(p_kind, 'post'), trim(coalesce(p_body, '')), coalesce(p_media, '{}'), p_community, p_circle, nullif(left(trim(coalesce(p_category, '')), 40), '')) returning * into r;
    if p_kind = 'poll' then
      insert into public.vibe_polls (post_id, closes_at, anonymous, multiple)
      values (r.id, case when (p_poll->>'days') is not null then now() + make_interval(days => least(greatest((p_poll->>'days')::int, 1), 30)) end,
              coalesce((p_poll->>'anonymous')::boolean, true), coalesce((p_poll->>'multiple')::boolean, false));
      for opt in select jsonb_array_elements_text(p_poll->'options') loop
        i := i + 1;
        if char_length(trim(opt)) > 0 then
          ph := nullif(trim(coalesce(p_poll->'photos'->>(i - 1), '')), '');
          if ph is not null and ph !~ ('^' || me::text || '/[A-Za-z0-9._/-]+$') then raise exception 'option photos must be uploaded from your own account'; end if;
          insert into public.vibe_poll_options (post_id, label, position, photo) values (r.id, left(trim(opt), 80), i, ph);
        end if;
      end loop;
      if (select count(*) from public.vibe_poll_options where post_id = r.id) < 2 then raise exception 'a poll needs at least 2 options'; end if;
    end if;
  else
    update public.vibe_posts set body = trim(coalesce(p_body, '')), media = coalesce(p_media, media), category = coalesce(nullif(trim(coalesce(p_category, '')), ''), category), edited_at = now()
    where id = p_id and author_id = me and removed_at is null returning * into r;
    if r.id is null then raise exception 'post not found'; end if;
  end if;
  return public.vibe_post_json(r, me);
end $$;
