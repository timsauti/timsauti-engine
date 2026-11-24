-- Moderation and sender blocking for Tukachap Drops.
-- Private abuse fingerprints are service-role-only and never exposed to recipients.

alter table public.vibe_reports drop constraint if exists vibe_reports_target_type_check;
alter table public.vibe_reports add constraint vibe_reports_target_type_check
  check (target_type in ('profile', 'post', 'comment', 'message', 'community', 'video', 'event', 'collab', 'question', 'answer', 'story', 'drop'));

create table if not exists public.vibe_drop_abuse_metadata (
  drop_id uuid primary key references public.vibe_drops(id) on delete cascade,
  recipient_id uuid not null references public.vibe_profiles(user_id) on delete cascade,
  fingerprint_hash text not null check (fingerprint_hash ~ '^[a-f0-9]{64}$'),
  created_at timestamptz not null default now()
);
create table if not exists public.vibe_drop_blocked_fingerprints (
  recipient_id uuid not null references public.vibe_profiles(user_id) on delete cascade,
  fingerprint_hash text not null check (fingerprint_hash ~ '^[a-f0-9]{64}$'),
  created_at timestamptz not null default now(),
  primary key (recipient_id, fingerprint_hash)
);
alter table public.vibe_drop_abuse_metadata enable row level security;
alter table public.vibe_drop_blocked_fingerprints enable row level security;
revoke all on public.vibe_drop_abuse_metadata, public.vibe_drop_blocked_fingerprints from anon, authenticated;
grant select, insert, update, delete on public.vibe_drop_abuse_metadata, public.vibe_drop_blocked_fingerprints to service_role;

create or replace function public.vibe_report(p_type text, p_id text, p_reason text, p_details text default null) returns void
language plpgsql security definer set search_path = public as $$
declare me uuid := public.vibe_need_me(); owner uuid;
begin
  if (select count(*) from public.vibe_reports where reporter = me and created_at > now() - interval '1 day') >= 20 then
    raise exception 'too many reports today';
  end if;
  owner := case p_type
    when 'profile' then (select user_id from public.vibe_profiles where user_id::text = p_id)
    when 'post' then (select author_id from public.vibe_posts where id::text = p_id and public.vibe_can_see_post(me, id))
    when 'comment' then (select author_id from public.vibe_comments where id::text = p_id)
    when 'message' then (select sender_id from public.vibe_messages m where m.id::text = p_id and public.vibe_in_conversation(m.conversation_id, me))
    when 'drop' then (select sender_user_id from public.vibe_drops where id::text = p_id and recipient_id = me)
    else null end;
  if p_type = 'drop' and not exists (select 1 from public.vibe_drops where id::text = p_id and recipient_id = me) then
    raise exception 'nothing to report';
  end if;
  if owner is null and p_type in ('profile', 'post', 'comment', 'message') then raise exception 'nothing to report'; end if;
  if owner = me then raise exception 'you cannot report your own content'; end if;
  insert into public.vibe_reports (reporter, target_type, target_id, target_owner, reason, details)
  values (me, p_type, p_id, owner, p_reason, nullif(left(trim(coalesce(p_details, '')), 500), ''))
  on conflict (reporter, target_type, target_id) do nothing;
  if (select count(*) from public.vibe_reports where target_type = p_type and target_id = p_id and status = 'open') = 1 then
    perform public.staff_alert('vibe_report', null, 'TnPVibe report: ' || p_type || ', reason ' || p_reason || '. Review it at technapesa.co.ke/admin/vibe/');
  end if;
end $$;

create or replace function public.admin_vibe_reports(p_status text default 'open') returns jsonb
language plpgsql stable security definer set search_path = public as $$
begin
  if not public.has_permission('moderation.manage') then raise exception 'not allowed'; end if;
  return coalesce((select jsonb_agg(jsonb_build_object(
      'id', r.id, 'type', r.target_type, 'target_id', r.target_id, 'reason', r.reason, 'details', r.details,
      'status', r.status, 'created_at', r.created_at,
      'reporter', (select username from public.vibe_profiles where user_id = r.reporter),
      'owner', (select jsonb_build_object('id', v.user_id, 'username', v.username, 'name', public.vibe_name(v.user_id), 'status', v.status) from public.vibe_profiles v where v.user_id = r.target_owner),
      'reports_on_target', (select count(*) from public.vibe_reports x where x.target_type = r.target_type and x.target_id = r.target_id),
      'content', case r.target_type
        when 'post' then (select jsonb_build_object('body', body, 'media', media, 'removed', removed_at is not null) from public.vibe_posts where id::text = r.target_id)
        when 'comment' then (select jsonb_build_object('body', body, 'removed', removed_at is not null) from public.vibe_comments where id::text = r.target_id)
        when 'message' then (select jsonb_build_object('body', body, 'kind', kind) from public.vibe_messages where id::text = r.target_id)
        when 'profile' then (select jsonb_build_object('body', headline || ' ' || bio) from public.vibe_profiles where user_id::text = r.target_id)
        when 'drop' then (select jsonb_build_object('body', message, 'sender_mode', sender_mode, 'removed', status = 'deleted') from public.vibe_drops where id::text = r.target_id)
      end
    ) order by r.created_at)
    from public.vibe_reports r where r.status = p_status and (p_status = 'open' or r.handled_at > now() - interval '30 days')), '[]');
end $$;

create or replace function public.admin_vibe_report_decide(p_report bigint, p_action text, p_note text default null) returns void
language plpgsql security definer set search_path = public as $$
declare r public.vibe_reports;
begin
  if not public.has_permission('moderation.manage') then raise exception 'not allowed'; end if;
  select * into r from public.vibe_reports where id = p_report;
  if r.id is null then raise exception 'report not found'; end if;
  if p_action = 'remove' then
    if r.target_type = 'post' then update public.vibe_posts set removed_at = now(), removed_reason = coalesce(p_note, r.reason) where id::text = r.target_id;
    elsif r.target_type = 'comment' then update public.vibe_comments set removed_at = now() where id::text = r.target_id;
    elsif r.target_type = 'message' then update public.vibe_messages set deleted_at = now(), body = '' where id::text = r.target_id;
    elsif r.target_type = 'drop' then update public.vibe_drops set status = 'deleted', deleted_at = now() where id::text = r.target_id;
    else raise exception 'this item cannot be removed; restrict or suspend the member instead'; end if;
    if r.target_owner is not null then
      perform public.notify(r.target_owner, 'account', 'Your ' || r.target_type || ' was removed from TnPVibe',
        'It broke the TnPVibe community guidelines. Reason: ' || coalesce(p_note, r.reason), '/vibe/guidelines/');
    end if;
  elsif p_action = 'restrict' then
    if r.target_owner is null then raise exception 'this report has no identified account to restrict'; end if;
    update public.vibe_profiles set status = 'restricted' where user_id = r.target_owner;
    perform public.notify(r.target_owner, 'account', 'Your TnPVibe account is restricted',
      'You cannot post or comment for now. Reason: ' || coalesce(p_note, r.reason), '/vibe/guidelines/');
  elsif p_action = 'suspend' then
    if not public.has_permission('users.manage_status') then raise exception 'only administrators can suspend accounts'; end if;
    if r.target_owner is null then raise exception 'this report has no identified account to suspend'; end if;
    update public.profiles set status = 'suspended', status_reason = coalesce(p_note, 'TnPVibe: ' || r.reason) where id = r.target_owner;
  elsif p_action = 'restore' then
    update public.vibe_profiles set status = 'active' where user_id = r.target_owner and status = 'restricted';
    if r.target_type = 'post' then update public.vibe_posts set removed_at = null, removed_reason = null where id::text = r.target_id; end if;
    if r.target_type = 'comment' then update public.vibe_comments set removed_at = null where id::text = r.target_id; end if;
    if r.target_type = 'drop' then update public.vibe_drops set status = 'unread', deleted_at = null where id::text = r.target_id; end if;
  elsif p_action <> 'dismiss' then raise exception 'unknown action';
  end if;
  update public.vibe_reports set status = case when p_action in ('dismiss', 'restore') then 'dismissed' else 'actioned' end,
    handled_by = auth.uid(), handled_at = now(), handled_note = p_note
  where (target_type = r.target_type and target_id = r.target_id and status = 'open') or id = p_report;
  perform public.log_action('vibe.report.' || p_action, 'vibe_report', p_report::text, to_jsonb(r), null, p_note);
end $$;
