-- Tukachap Drop reply and WhatsApp safety checks.
do $$
begin
  if not exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'vibe_drops' and column_name = 'reply_token_hash'
  ) then raise exception 'Drop sender return-token hash is missing'; end if;

  if not exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'vibe_drop_settings' and column_name = 'whatsapp_enabled'
  ) then raise exception 'Drop WhatsApp preference is missing'; end if;

  if not exists (
    select 1 from pg_class where oid = 'public.vibe_drop_replies'::regclass and relrowsecurity
  ) then raise exception 'Drop replies must have RLS enabled'; end if;

  if has_table_privilege('anon', 'public.vibe_drop_replies', 'SELECT')
    or has_table_privilege('authenticated', 'public.vibe_drop_replies', 'SELECT') then
    raise exception 'Drop replies must not be directly readable by browser roles';
  end if;

  if not has_function_privilege('authenticated', 'public.vibe_drop_whatsapp_set(boolean)', 'EXECUTE') then
    raise exception 'Members must be able to manage their own Drop WhatsApp preference';
  end if;

  if has_function_privilege('anon', 'public.vibe_drop_whatsapp_set(boolean)', 'EXECUTE') then
    raise exception 'Anonymous visitors must not change WhatsApp preferences';
  end if;

  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.notification_prefs'::regclass
      and conname = 'notification_prefs_topic_check'
  ) then raise exception 'Notification topic constraint is missing'; end if;

  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.vibe_reports'::regclass
      and conname = 'vibe_reports_target_type_check'
      and pg_get_constraintdef(oid) ilike '%drop%'
  ) then raise exception 'Drop reporting is not registered with moderation'; end if;

  if not exists (
    select 1 from pg_class where oid = 'public.vibe_drop_abuse_metadata'::regclass and relrowsecurity
  ) or not exists (
    select 1 from pg_class where oid = 'public.vibe_drop_blocked_fingerprints'::regclass and relrowsecurity
  ) then raise exception 'Drop abuse metadata and blocks must have RLS enabled'; end if;

  if has_table_privilege('anon', 'public.vibe_drop_abuse_metadata', 'SELECT')
    or has_table_privilege('anon', 'public.vibe_drop_blocked_fingerprints', 'SELECT')
    or has_table_privilege('authenticated', 'public.vibe_drop_abuse_metadata', 'SELECT')
    or has_table_privilege('authenticated', 'public.vibe_drop_blocked_fingerprints', 'SELECT') then
    raise exception 'Recipients must not read private Drop abuse fingerprints';
  end if;
end $$;
