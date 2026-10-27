-- BreatheGuard 0005: patient-granted access for the healthcare authority.
-- The authority can read a patient's monitoring sessions, results, alerts and reports ONLY while
-- that patient has switched sharing with the authority on. Read-only: the authority cannot
-- acknowledge or resolve alerts (that stays with the care team). Every change is audited.
-- Run AFTER 0001–0004. Safe to re-run.

create table if not exists public.authority_access (
  patient_id uuid primary key references public.profiles (id) on delete cascade,
  active boolean not null default true,
  updated_at timestamptz not null default now()
);

create or replace function public.authority_access_guard() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if public.my_role()::text <> 'patient' then raise exception 'Only the patient can share their own records with the authority' using errcode = '42501'; end if;
  new.patient_id := auth.uid(); new.updated_at := now();
  perform public.audit(case when new.active then 'consent.authority_granted' else 'consent.authority_revoked' end,
                       'authority_access', new.patient_id::text, '{}'::jsonb);
  return new;
end $$;
drop trigger if exists trg_authority_access on public.authority_access;
create trigger trg_authority_access before insert or update on public.authority_access
  for each row execute function public.authority_access_guard();

alter table public.authority_access enable row level security;
drop policy if exists authority_access_patient on public.authority_access;
create policy authority_access_patient on public.authority_access for all to authenticated
  using (patient_id = auth.uid()) with check (patient_id = auth.uid());
drop policy if exists authority_access_read on public.authority_access;
create policy authority_access_read on public.authority_access for select to authenticated using (public.is_authority());
grant select, insert, update on public.authority_access to authenticated;
revoke delete on public.authority_access from authenticated;
revoke all on public.authority_access from anon;

-- READ ACCESS: self; approved hospital with active consent; connected doctor; and NOW the
-- healthcare authority, only while the patient's authority sharing is on.
create or replace function public.can_read_patient(p_patient uuid) returns boolean
language sql stable security definer set search_path = public as
$$ select p_patient = auth.uid()
     or exists (select 1 from public.consents c
                where c.patient_id = p_patient and c.active and 'reports' = any (c.scopes)
                  and c.hospital_id = public.my_approved_hospital())
     or public.is_connected_doctor(p_patient)
     or (public.is_authority() and exists (select 1 from public.authority_access a where a.patient_id = p_patient and a.active)) $$;

-- the authority's access is read-only: acknowledging alerts stays with the patient and care team
create or replace function public.acknowledge_alert(p_alert uuid) returns public.alerts
language plpgsql security definer set search_path = public as $$
declare a public.alerts;
begin
  select * into a from public.alerts where id = p_alert;
  if not found or not public.can_read_patient(a.patient_id) or public.is_authority() then
    raise exception 'Alert not found or not permitted' using errcode = '42501';
  end if;
  update public.alerts set acknowledged_at = coalesce(acknowledged_at, now()), acknowledged_by = coalesce(acknowledged_by, auth.uid())
   where id = p_alert returning * into a;
  perform public.audit('alert.acknowledged', 'alerts', p_alert::text, '{}'::jsonb);
  return a;
end $$;

create or replace function public.bg_health() returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare
  want_tables text[] := array['profiles','hospitals','doctors','consents','monitoring_sessions','observations','analysis_results',
    'alerts','appointments','appointment_events','notifications','alert_settings','ai_messages','reports','audit_log',
    'care_requests','messages','prescriptions','medication_reminders','reminder_doses','reviews','ai_usage','authority_access'];
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
    'schema_version', 5,
    'ok', cardinality(missing_tables) = 0 and cardinality(no_rls) = 0 and cardinality(missing_fn) = 0,
    'missing_tables', missing_tables, 'tables_without_rls', no_rls, 'missing_functions', missing_fn,
    'realtime_missing', missing_rt, 'authority_accounts', authorities > 0, 'checked_at', now());
end $$;
revoke all on function public.bg_health() from public;
grant execute on function public.bg_health() to anon, authenticated;

-- Let the project owner create the first authority from the setup script using the service-role key
-- (server/terminal only; never in the app). App users still cannot call it.
grant execute on function public.bootstrap_authority(text) to service_role;

notify pgrst, 'reload schema';
