-- =============================================================================================
-- TnPVibe: county spaces and Verified members (owner, 20 Nov 2026: grow the community as a Kenyan social
-- network that is better than Facebook: real people, local first, opportunities in the feed).
-- 1) Verified badge: staff with verification.manage mark a member as checked; the badge shows on every member card.
-- 2) County spaces: one public community per county ("Machakos County"), created the first time anyone opens it,
--    run by TnP staff (no member becomes its owner).
-- =============================================================================================

alter table public.vibe_profiles add column verified_at timestamptz, add column verified_note text check (verified_note is null or char_length(verified_note) <= 300);

create or replace function public.vibe_card(u uuid, viewer uuid default auth.uid()) returns jsonb language sql stable security definer set search_path = public as $$
  select jsonb_build_object('id', v.user_id, 'username', v.username, 'name', public.vibe_name(v.user_id), 'headline', v.headline,
    'avatar', v.avatar_path, 'location', v.location,
    'online', v.show_online and v.last_active_at > now() - interval '2 minutes',
    'last_active', case when v.show_online then v.last_active_at end,
    'followers', v.followers_count,
    'verified', v.verified_at is not null,
    'following_them', exists (select 1 from public.vibe_follows f where f.follower = viewer and f.followee = v.user_id),
    'follows_me', exists (select 1 from public.vibe_follows f where f.follower = v.user_id and f.followee = viewer))
  from public.vibe_profiles v where v.user_id = u;
$$;

create or replace function public.admin_vibe_verify(p_username text, p_on boolean, p_note text default null) returns void
language plpgsql security definer set search_path = public as $$
declare p_user uuid;
begin
  if not public.has_permission('verification.manage') then raise exception 'not allowed'; end if;
  if p_on and coalesce(trim(p_note), '') = '' then raise exception 'say what was checked, for the record (for example: ID seen in person)'; end if;
  select user_id into p_user from public.vibe_profiles where username = lower(trim(leading '@' from trim(coalesce(p_username, ''))));
  if p_user is null then raise exception 'no TnPVibe member has that username'; end if;
  update public.vibe_profiles set verified_at = case when p_on then now() else null end, verified_note = case when p_on then left(trim(p_note), 300) else null end where user_id = p_user;
  if not found then raise exception 'this person has no TnPVibe profile yet'; end if;
  perform public.log_action(case when p_on then 'vibe.member_verified' else 'vibe.member_unverified' end, 'vibe_profile', p_user::text, null, null, p_note);
  if p_on then perform public.notify(p_user, 'account', 'You are now a Verified member of TnPVibe', 'The Verified badge shows next to your name.', '/vibe/'); end if;
end $$;

-- County spaces
alter table public.vibe_communities drop constraint vibe_communities_category_check;
alter table public.vibe_communities add constraint vibe_communities_category_check check (category in ('technology', 'entrepreneurship', 'education', 'business', 'careers',
  'agriculture', 'entertainment', 'sports', 'creativity', 'personal-development', 'lifestyle', 'professional-networking', 'faith', 'health', 'local'));
alter table public.vibe_communities add column county_id smallint unique references public.counties(id);

-- Opens a county's space, creating it the first time, and joins the caller. Returns the space's web name.
create or replace function public.vibe_county_space(p_county smallint, p_join boolean default true) returns text
language plpgsql security definer set search_path = public as $$
declare me uuid := public.vibe_need_me(); co public.counties; s text;
begin
  select * into co from public.counties where id = p_county; if co.id is null then raise exception 'choose a county'; end if;
  select slug into s from public.vibe_communities where county_id = p_county;
  if s is null then
    s := 'county-' || co.slug;
    insert into public.vibe_communities (slug, name, description, category, rules, visibility, created_by, county_id)
    values (s, co.name || ' County', 'News, opportunities, businesses, events and people of ' || co.name || ' County. Ask, share and help each other.',
      'local', 'Be kind and truthful. No scams, no hate, no politics of insults. Never ask anyone to pay to get a job.', 'public', me, p_county)
    on conflict (county_id) do nothing;
    select slug into s from public.vibe_communities where county_id = p_county;
  end if;
  if p_join then perform public.vibe_community_join(s, true); end if;
  return s;
end $$;

revoke execute on function public.admin_vibe_verify(text, boolean, text), public.vibe_county_space(smallint, boolean) from public, anon;
grant execute on function public.admin_vibe_verify(text, boolean, text), public.vibe_county_space(smallint, boolean) to authenticated;
grant execute on all functions in schema public to service_role;
