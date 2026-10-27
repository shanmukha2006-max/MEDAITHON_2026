-- BreatheGuard 0004: backend health check used by the login screen to report whether the
-- database is genuinely ready (schema, row-level security, real-time), instead of assuming it.
-- Returns only booleans and counts: no user data. Run AFTER 0001–0003. Safe to re-run.

create or replace function public.bg_health() returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare
  want_tables text[] := array['profiles','hospitals','doctors','consents','monitoring_sessions','observations','analysis_results',
    'alerts','appointments','appointment_events','notifications','alert_settings','ai_messages','reports','audit_log',
    'care_requests','messages','prescriptions','medication_reminders','reminder_doses','reviews','ai_usage'];
  want_rt text[] := array['monitoring_sessions','observations','analysis_results','alerts','notifications','care_requests','messages','appointments'];
  want_fn text[] := array['decide_hospital','decide_doctor','session_report','respond_care_request','mark_messages_read','resolve_alert','ai_rate_check','bootstrap_authority'];
  missing_tables text[]; no_rls text[]; missing_rt text[]; missing_fn text[]; authorities int;
begin
  select coalesce(array_agg(t), '{}') into missing_tables from unnest(want_tables) t
   where not exists (select 1 from pg_tables where schemaname = 'public' and tablename = t);
  select coalesce(array_agg(t), '{}') into no_rls from unnest(want_tables) t
   where exists (select 1 from pg_class c join pg_namespace n on n.oid = c.relnamespace where n.nspname = 'public' and c.relname = t and not c.relrowsecurity);
  select coalesce(array_agg(t), '{}') into missing_rt from unnest(want_rt) t
   where not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = t);
  select coalesce(array_agg(f), '{}') into missing_fn from unnest(want_fn) f
   where not exists (select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public' and p.proname = f);
  select count(*) into authorities from public.profiles where role::text = 'authority';
  return jsonb_build_object(
    'schema_version', 4,
    'ok', cardinality(missing_tables) = 0 and cardinality(no_rls) = 0 and cardinality(missing_fn) = 0,
    'missing_tables', missing_tables, 'tables_without_rls', no_rls, 'missing_functions', missing_fn,
    'realtime_missing', missing_rt, 'authority_accounts', authorities > 0, 'checked_at', now());
end $$;
revoke all on function public.bg_health() from public;
grant execute on function public.bg_health() to anon, authenticated;

-- Ask the API layer (PostgREST) to reload its schema cache so new functions are callable immediately.
notify pgrst, 'reload schema';
