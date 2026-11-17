-- TECH na PESA 2.0: articles, search, newsletter, promotions.
\set QUIET on
create or replace function pg_temp.as_user(p uuid) returns void language plpgsql as $$
begin perform set_config('request.jwt.claims', json_build_object('sub', p, 'role', 'authenticated')::text, false); end $$;
create or replace function pg_temp.expect(cond boolean, what text) returns void language plpgsql as $$
begin if not coalesce(cond, false) then raise exception 'FAILED: %', what; else raise notice 'ok: %', what; end if; end $$;
create or replace function pg_temp.fails(sql text, what text) returns void language plpgsql as $$
begin
  begin execute sql; exception when others then raise notice 'ok: %', what; return; end;
  raise exception 'FAILED: %', what;
end $$;
insert into public.articles (slug, title, dek, body, category, origin, origin_ref) values
  ('keep-your-mpesa-pin-safe', 'Keep your M-PESA PIN safe', 'Five habits that protect your money', repeat('Never share your PIN with anyone, even a caller who says they are from Safaricom. ', 3), 'mpesa', 'agent', 'tip:pin'),
  ('hidden-draft', 'A hidden draft article', '', repeat('Draft words for testing only. ', 6), 'technology', 'staff', null);
update public.articles set status = 'hidden' where slug = 'hidden-draft';
set role anon; select set_config('request.jwt.claims', '{"role":"anon"}', false);
select pg_temp.expect((select count(*) from public.articles) = 1, 'visitors see only published articles');
select pg_temp.expect((select count(*) from public.site_search('mpesa pin') where kind = 'article') = 1, 'search finds articles by every word');
select pg_temp.expect((select count(*) from public.site_search('x')) = 0, 'very short searches return nothing');
select pg_temp.fails($$insert into public.articles (slug, title, body) values ('spam-post', 'Spam title here', repeat('spam ', 40))$$, 'visitors cannot write articles');
select pg_temp.expect(public.newsletter_subscribe('Reader@Example.com', true) = 'subscribed', 'a visitor can subscribe');
select pg_temp.expect(public.newsletter_subscribe('reader@example.com', true) = 'already', 'a second sign up is recognised');
select pg_temp.fails($$select public.newsletter_subscribe('reader2@example.com', false)$$, 'consent is required');
select pg_temp.fails($$select public.newsletter_subscribe('not-an-email', true)$$, 'a bad address is refused');
select pg_temp.expect(public.newsletter_subscribe('bot@example.com', true, 'filled') = 'subscribed' , 'bots are quietly ignored');
select pg_temp.fails($$select count(*) from public.newsletter_subscribers$$, 'visitors cannot read the subscriber list');
reset role; select set_config('request.jwt.claims', '{}', false);
select pg_temp.expect((select count(*) from public.newsletter_subscribers where email = 'bot@example.com') = 0, 'the bot address was not stored');
select pg_temp.expect(public.newsletter_unsubscribe((select token from public.newsletter_subscribers where email = 'reader@example.com')) = 'done', 'the unsubscribe link works');
select pg_temp.expect((select status from public.newsletter_subscribers where email = 'reader@example.com') = 'unsubscribed', 'the reader is unsubscribed');
