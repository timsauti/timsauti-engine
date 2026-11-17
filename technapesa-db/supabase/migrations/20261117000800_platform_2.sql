-- TECH na PESA 2.0 (owner brief, 17 Nov 2026): articles, unified search, newsletter, sponsored placements, contact settings.
-- Everything here is additive; no existing table or record is changed.

insert into public.permissions (key, description) values
  ('content.manage', 'Write, publish, feature and hide articles; manage promotions'),
  ('newsletter.view', 'See and export newsletter subscribers')
on conflict do nothing;
insert into public.role_permissions (role, permission) values
  ('administrator', 'content.manage'), ('administrator', 'newsletter.view'), ('editor', 'content.manage')
on conflict do nothing;

insert into public.site_settings (key, value, is_public) values
  ('contact.email', '""', true),
  ('contact.phone', '""', true),
  ('contact.social', '{"facebook": "https://www.facebook.com/570910356269659"}', true),
  ('analytics.google_id', '""', true)
on conflict (key) do nothing;

-- ---------- Articles: Technology and Money ----------
create table public.articles (
  id uuid primary key default gen_random_uuid(),
  slug text not null unique check (slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$' and char_length(slug) between 3 and 100),
  title text not null check (char_length(title) between 5 and 160),
  dek text not null default '' check (char_length(dek) <= 320),
  body text not null check (char_length(body) between 100 and 20000),
  category text not null default 'technology' check (category in ('technology', 'money', 'mpesa', 'business', 'opportunities', 'guides')),
  cover_url text check (cover_url is null or cover_url ~ '^https://'),
  cover_alt text check (cover_alt is null or char_length(cover_alt) <= 200),
  cover_credit text check (cover_credit is null or char_length(cover_credit) <= 160),
  source_name text check (source_name is null or char_length(source_name) <= 80),
  source_url text check (source_url is null or source_url ~ '^https://'),
  author_name text not null default 'TECH na PESA Desk' check (char_length(author_name) <= 80),
  status text not null default 'published' check (status in ('draft', 'published', 'hidden')),
  featured boolean not null default false,
  sponsored_by text check (sponsored_by is null or char_length(sponsored_by) <= 80),
  origin text not null default 'staff' check (origin in ('agent', 'staff')),
  origin_ref text unique,
  views integer not null default 0,
  published_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid references auth.users(id)
);
create index articles_public on public.articles (status, published_at desc);
alter table public.articles enable row level security;
create policy "public reads published articles" on public.articles for select using (status = 'published' or public.has_permission('content.manage'));
create policy "staff write articles" on public.articles for all using (public.has_permission('content.manage')) with check (public.has_permission('content.manage'));
grant select on public.articles to anon, authenticated;
grant insert, update on public.articles to authenticated;
grant all on public.articles to service_role;

create or replace function public.article_view(p_slug text) returns void
language sql security definer set search_path = public as $$
  update public.articles set views = views + 1 where slug = p_slug and status = 'published';
$$;
grant execute on function public.article_view(text) to anon, authenticated;

-- ---------- Sponsored placements and adverts (clearly labelled, off until staff add one) ----------
create table public.promotions (
  id bigint generated always as identity primary key,
  placement text not null check (placement in ('home_banner', 'directory_top', 'article_inline')),
  advertiser text not null check (char_length(advertiser) between 2 and 80),
  headline text not null check (char_length(headline) between 3 and 120),
  body text check (body is null or char_length(body) <= 240),
  image_url text check (image_url is null or image_url ~ '^https://'),
  link text check (link is null or link ~ '^https://'),
  starts_at timestamptz not null default now(),
  ends_at timestamptz not null,
  active boolean not null default true,
  created_at timestamptz not null default now()
);
alter table public.promotions enable row level security;
create policy "public sees live promotions" on public.promotions for select using ((active and now() between starts_at and ends_at) or public.has_permission('content.manage'));
create policy "staff manage promotions" on public.promotions for all using (public.has_permission('content.manage')) with check (public.has_permission('content.manage'));
grant select on public.promotions to anon, authenticated;
grant insert, update, delete on public.promotions to authenticated;

-- ---------- Newsletter ----------
create table public.newsletter_subscribers (
  id bigint generated always as identity primary key,
  email text not null check (email ~* '^[^@\s]+@[^@\s]+\.[a-z]{2,}$' and char_length(email) <= 160),
  status text not null default 'active' check (status in ('active', 'unsubscribed')),
  token uuid not null default gen_random_uuid() unique,
  source text check (source is null or char_length(source) <= 40),
  consent_at timestamptz not null default now(),
  unsubscribed_at timestamptz,
  created_at timestamptz not null default now()
);
create unique index newsletter_email on public.newsletter_subscribers (lower(email));
alter table public.newsletter_subscribers enable row level security;
create policy "staff read subscribers" on public.newsletter_subscribers for select using (public.has_permission('newsletter.view'));
revoke all on public.newsletter_subscribers from anon;
grant select on public.newsletter_subscribers to authenticated;
grant all on public.newsletter_subscribers to service_role;

create or replace function public.newsletter_subscribe(p_email text, p_consent boolean, p_trap text default null, p_source text default null) returns text
language plpgsql security definer set search_path = public as $$
declare e text := lower(trim(coalesce(p_email, ''))); r public.newsletter_subscribers;
begin
  if coalesce(p_trap, '') <> '' then return 'subscribed'; end if;   -- bots fill the hidden field; tell them nothing
  if p_consent is not true then raise exception 'please tick the box to agree to receive our emails'; end if;
  if e !~* '^[^@\s]+@[^@\s]+\.[a-z]{2,}$' or char_length(e) > 160 then raise exception 'enter a valid email address'; end if;
  if (select count(*) from public.newsletter_subscribers where created_at > now() - interval '1 minute') >= 20 then raise exception 'please try again in a minute'; end if;
  select * into r from public.newsletter_subscribers where lower(email) = e;
  if found and r.status = 'active' then return 'already'; end if;
  if found then update public.newsletter_subscribers set status = 'active', consent_at = now(), unsubscribed_at = null where id = r.id; return 'subscribed'; end if;
  insert into public.newsletter_subscribers (email, source) values (e, left(p_source, 40));
  return 'subscribed';
end $$;
grant execute on function public.newsletter_subscribe(text, boolean, text, text) to anon, authenticated;

create or replace function public.newsletter_unsubscribe(p_token uuid) returns text
language plpgsql security definer set search_path = public as $$
begin
  update public.newsletter_subscribers set status = 'unsubscribed', unsubscribed_at = now() where token = p_token and status = 'active';
  return case when found then 'done' else 'unknown' end;
end $$;
grant execute on function public.newsletter_unsubscribe(uuid) to anon, authenticated;

-- signed in people can see and change their own subscription
create or replace function public.newsletter_mine() returns text
language sql stable security definer set search_path = public as $$
  select coalesce((select status from public.newsletter_subscribers where lower(email) = lower((select email from auth.users where id = auth.uid()))), 'none');
$$;
create or replace function public.newsletter_set_mine(p_on boolean) returns text
language plpgsql security definer set search_path = public as $$
declare e text := lower((select email from auth.users where id = auth.uid()));
begin
  if e is null then raise exception 'not signed in'; end if;
  if p_on then return public.newsletter_subscribe(e, true, null, 'account'); end if;
  update public.newsletter_subscribers set status = 'unsubscribed', unsubscribed_at = now() where lower(email) = e and status = 'active';
  return 'unsubscribed';
end $$;
revoke execute on function public.newsletter_mine(), public.newsletter_set_mine(boolean) from public, anon;
grant execute on function public.newsletter_mine(), public.newsletter_set_mine(boolean) to authenticated;

-- ---------- Unified search across real platform content ----------
create or replace function public.site_search(p_q text, p_limit int default 6)
returns table (kind text, title text, snippet text, url text, meta text)
language plpgsql stable security definer set search_path = public as $$
declare q text := left(trim(regexp_replace(coalesce(p_q, ''), '[%_\\]', ' ', 'g')), 80); words text[]; lim int := least(greatest(coalesce(p_limit, 6), 1), 12);
begin
  if char_length(q) < 2 then return; end if;
  words := array(select w from unnest(regexp_split_to_array(lower(q), '\s+')) w where char_length(w) >= 2 limit 5);
  if cardinality(words) = 0 then return; end if;
  return query
  (select 'article'::text, a.title, left(coalesce(nullif(a.dek, ''), a.body), 160), '/a/' || a.slug, a.category
     from public.articles a where a.status = 'published'
      and (select bool_and(lower(a.title || ' ' || a.dek || ' ' || a.category || ' ' || left(a.body, 4000)) like '%' || w || '%') from unnest(words) w)
     order by (lower(a.title) like '%' || words[1] || '%') desc, a.published_at desc limit lim)
  union all
  (select 'business', d.name, left(coalesce(nullif(d.tagline, ''), d.description, ''), 160), '/b/' || d.slug, concat_ws(', ', d.category, d.town, d.county)
     from public.directory d
     where (select bool_and(lower(concat_ws(' ', d.name, d.tagline, d.description, d.town, d.county, d.category)) like '%' || w || '%') from unnest(words) w)
     order by d.featured desc, (lower(d.name) like '%' || words[1] || '%') desc, d.published_at desc limit lim)
  union all
  (select 'category', c.name, 'Businesses in ' || c.name, '/businesses/?category=' || c.slug, null
     from public.categories c where (select bool_or(lower(c.name) like '%' || w || '%') from unnest(words) w) limit 4)
  union all
  (select 'story', f.title, left(f.body, 160), '/s/' || f.slug, f.author_name
     from public.community_feed f where (select bool_and(lower(f.title || ' ' || left(f.body, 3000)) like '%' || w || '%') from unnest(words) w)
     order by f.published_at desc limit lim)
  union all
  (select 'challenge', ch.title, left(coalesce(ch.question, ch.brief, ''), 160), '/c/' || ch.slug, ch.phase
     from public.challenge_list ch where (select bool_and(lower(ch.title || ' ' || coalesce(ch.question, '') || ' ' || coalesce(ch.brief, '')) like '%' || w || '%') from unnest(words) w)
     order by ch.opens_at desc limit 4);
end $$;
grant execute on function public.site_search(text, int) to anon, authenticated;

-- Public pictures for articles (covers the agent designs; staff uploads). Written only by staff or the service role.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('site-media', 'site-media', true, 3145728, array['image/jpeg', 'image/png', 'image/webp'])
on conflict (id) do nothing;
create policy "site media staff upload" on storage.objects for insert to authenticated with check (bucket_id = 'site-media' and public.has_permission('content.manage'));
