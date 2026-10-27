-- BreatheGuard: ALL migrations in order (0001–0006), for ONE paste into the Supabase SQL Editor.
-- Generated from supabase/migrations/. Safe to re-run.

-- ======================== 0001_breatheguard_init.sql ========================
-- BreatheGuard backend foundation (Supabase / PostgreSQL 15+)
-- Run once in the Supabase SQL editor (or `supabase db push`).
-- Every access rule is enforced HERE with row-level security (RLS), so it applies to
-- direct API calls and real-time subscriptions, not just to the app's own screens.
-- All monitoring data is synthetic: rows carry is_synthetic = true and a label.

create extension if not exists pgcrypto;

-- ---------------------------------------------------------------- types
do $$ begin
  create type public.app_role as enum ('patient', 'hospital_staff', 'authority');
exception when duplicate_object then null; end $$;
do $$ begin
  create type public.review_status as enum ('pending', 'approved', 'rejected', 'more_info', 'suspended');
exception when duplicate_object then null; end $$;
do $$ begin
  create type public.outcome as enum ('within', 'concerning', 'insufficient');
exception when duplicate_object then null; end $$;

-- ---------------------------------------------------------------- tables
create table if not exists public.hospitals (
  id uuid primary key default gen_random_uuid(),
  name text not null check (char_length(name) between 2 and 200),
  city text not null check (char_length(city) between 1 and 100),
  registration_no text not null check (char_length(registration_no) between 2 and 60),
  status public.review_status not null default 'pending',
  status_reason text,
  created_by uuid not null,
  is_synthetic boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  role public.app_role not null default 'patient',
  full_name text not null default '' check (char_length(full_name) <= 200),
  hospital_id uuid references public.hospitals (id) on delete set null,
  baseline_rate numeric(4,1) not null default 14.0 check (baseline_rate between 6 and 30),
  baseline_sd numeric(3,1) not null default 1.5 check (baseline_sd between 0.5 and 10),
  is_synthetic boolean not null default true,
  created_at timestamptz not null default now()
);

create table if not exists public.doctors (
  id uuid primary key default gen_random_uuid(),
  hospital_id uuid not null references public.hospitals (id) on delete cascade,
  full_name text not null check (char_length(full_name) between 2 and 200),
  specialty text not null check (char_length(specialty) between 2 and 100),
  license_no text not null check (char_length(license_no) between 2 and 60),
  status public.review_status not null default 'pending',
  status_reason text,
  submitted_by uuid not null references public.profiles (id),
  is_synthetic boolean not null default true,
  created_at timestamptz not null default now()
);

create table if not exists public.consents (
  id uuid primary key default gen_random_uuid(),
  patient_id uuid not null references public.profiles (id) on delete cascade,
  hospital_id uuid not null references public.hospitals (id) on delete cascade,
  scopes text[] not null default '{}' check (scopes <@ array['reports', 'live']::text[]),
  active boolean not null default true,
  updated_at timestamptz not null default now(),
  unique (patient_id, hospital_id)
);

create table if not exists public.monitoring_sessions (
  id uuid primary key default gen_random_uuid(),
  patient_id uuid not null references public.profiles (id) on delete cascade,
  patch text not null check (patch in ('care', 'quick')),
  channels text[] not null check (array_length(channels, 1) >= 1),
  scenario_id text not null check (char_length(scenario_id) <= 60),
  seed integer not null check (seed between 1 and 1000000),
  status text not null default 'active' check (status in ('active', 'stopped')),
  started_at timestamptz not null default now(),
  stopped_at timestamptz,
  is_synthetic boolean not null default true check (is_synthetic),
  label text not null default 'SYNTHETIC DATA — NOT FOR CLINICAL USE'
);

-- One row per second of signal (10 samples per channel). (session_id, seq) makes writes idempotent.
create table if not exists public.observations (
  session_id uuid not null references public.monitoring_sessions (id) on delete cascade,
  seq integer not null check (seq >= 0),
  t_start numeric(8,1) not null,
  chest real[], acoustic real[], accel real[], tilt real[],
  recorded_at timestamptz not null default now(),
  primary key (session_id, seq)
);

create table if not exists public.analysis_results (
  session_id uuid not null references public.monitoring_sessions (id) on delete cascade,
  window_end integer not null check (window_end >= 0),
  outcome public.outcome not null,
  rate numeric(5,1),
  quality numeric(4,3) check (quality between 0 and 1),
  confidence numeric(4,3) check (confidence between 0 and 1),
  activity text,
  reason text not null check (char_length(reason) <= 2000),
  explanation jsonb not null default '{}'::jsonb,
  channel_quality jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  primary key (session_id, window_end)
);

create table if not exists public.alerts (
  id uuid primary key default gen_random_uuid(),
  session_id uuid not null references public.monitoring_sessions (id) on delete cascade,
  patient_id uuid not null references public.profiles (id) on delete cascade,
  window_end integer not null,
  category public.outcome not null,
  explanation text not null,
  quality_context jsonb not null default '{}'::jsonb,
  recipients uuid[] not null default '{}',
  created_at timestamptz not null default now(),
  acknowledged_at timestamptz,
  acknowledged_by uuid references public.profiles (id),
  label text not null default 'SOFTWARE DEMONSTRATION — NOT A CLINICAL WARNING',
  unique (session_id, window_end)
);

create table if not exists public.appointments (
  id uuid primary key default gen_random_uuid(),
  patient_id uuid not null references public.profiles (id) on delete cascade,
  doctor_id uuid not null references public.doctors (id) on delete cascade,
  hospital_id uuid not null references public.hospitals (id) on delete cascade,
  requested_for timestamptz not null,
  reason text check (char_length(reason) <= 500),
  status text not null default 'requested' check (status in ('requested', 'confirmed', 'declined', 'completed', 'cancelled')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.reports (
  id uuid primary key default gen_random_uuid(),
  session_id uuid not null references public.monitoring_sessions (id) on delete cascade,
  generated_by uuid not null references public.profiles (id),
  generated_at timestamptz not null default now(),
  label text not null default 'SYNTHETIC DATA — NOT FOR CLINICAL USE'
);

create table if not exists public.audit_log (
  id bigint generated always as identity primary key,
  actor_id uuid,
  action text not null,
  target_table text not null,
  target_id text not null,
  detail jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists idx_obs_session on public.observations (session_id, seq);
create index if not exists idx_ar_session on public.analysis_results (session_id, window_end);
create index if not exists idx_alerts_session on public.alerts (session_id, created_at);
create index if not exists idx_sessions_patient on public.monitoring_sessions (patient_id, started_at desc);
create index if not exists idx_consents_hospital on public.consents (hospital_id) where active;

-- ---------------------------------------------------------------- helper functions
-- SECURITY DEFINER helpers read profiles without recursing through RLS.
create or replace function public.my_role() returns public.app_role
language sql stable security definer set search_path = public as
$$ select role from public.profiles where id = auth.uid() $$;

create or replace function public.is_authority() returns boolean
language sql stable security definer set search_path = public as
$$ select coalesce((select role = 'authority' from public.profiles where id = auth.uid()), false) $$;

-- the hospital of the current staff user, only if that hospital is approved
create or replace function public.my_approved_hospital() returns uuid
language sql stable security definer set search_path = public as
$$ select p.hospital_id from public.profiles p join public.hospitals h on h.id = p.hospital_id
   where p.id = auth.uid() and p.role = 'hospital_staff' and h.status = 'approved' $$;

-- can the current user read this patient's monitoring data?
create or replace function public.can_read_patient(p_patient uuid) returns boolean
language sql stable security definer set search_path = public as
$$ select p_patient = auth.uid()
     or exists (select 1 from public.consents c
                where c.patient_id = p_patient and c.active and 'reports' = any (c.scopes)
                  and c.hospital_id = public.my_approved_hospital()) $$;

create or replace function public.session_owner(p_session uuid) returns uuid
language sql stable security definer set search_path = public as
$$ select patient_id from public.monitoring_sessions where id = p_session $$;

create or replace function public.audit(p_action text, p_table text, p_target text, p_detail jsonb)
returns void language sql security definer set search_path = public as
$$ insert into public.audit_log (actor_id, action, target_table, target_id, detail)
   values (auth.uid(), p_action, p_table, p_target, coalesce(p_detail, '{}'::jsonb)) $$;
revoke execute on function public.audit(text, text, text, jsonb) from public, anon, authenticated;

-- ---------------------------------------------------------------- triggers
-- New auth user -> profile. Only 'patient' or 'hospital_staff' may be self-chosen;
-- anything else (including 'authority') silently becomes 'patient'.
create or replace function public.handle_new_user() returns trigger
language plpgsql security definer set search_path = public as $$
declare r text := coalesce(new.raw_user_meta_data ->> 'role', 'patient');
begin
  if r not in ('patient', 'hospital_staff') then r := 'patient'; end if;
  insert into public.profiles (id, role, full_name)
  values (new.id, r::public.app_role, left(coalesce(new.raw_user_meta_data ->> 'full_name', ''), 200));
  return new;
end $$;
drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created after insert on auth.users
  for each row execute function public.handle_new_user();

-- Users may edit their name and baseline, never their role or hospital link.
create or replace function public.protect_profile() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if (new.role is distinct from old.role or new.hospital_id is distinct from old.hospital_id)
     and coalesce(current_setting('breatheguard.internal', true), '') <> 'on'
     and not public.is_authority() then
    raise exception 'Only the healthcare authority can change roles or hospital links' using errcode = '42501';
  end if;
  return new;
end $$;
drop trigger if exists trg_protect_profile on public.profiles;
create trigger trg_protect_profile before update on public.profiles
  for each row execute function public.protect_profile();

-- Hospital applications always start pending, are owned by their creator, and link the creator.
create or replace function public.hospital_before_insert() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if public.my_role() is distinct from 'hospital_staff' then
    raise exception 'Only hospital staff accounts can submit a hospital application' using errcode = '42501';
  end if;
  if exists (select 1 from public.profiles where id = auth.uid() and hospital_id is not null) then
    raise exception 'This account is already linked to a hospital' using errcode = '23505';
  end if;
  new.status := 'pending'; new.status_reason := null; new.created_by := auth.uid(); new.is_synthetic := true;
  return new;
end $$;
create or replace function public.hospital_after_insert() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  perform set_config('breatheguard.internal', 'on', true);
  update public.profiles set hospital_id = new.id where id = new.created_by;
  perform set_config('breatheguard.internal', 'off', true);
  perform public.audit('hospital.submitted', 'hospitals', new.id::text, jsonb_build_object('name', new.name));
  return new;
end $$;
-- Staff may edit details while pending / more_info; status changes only through decide_hospital().
create or replace function public.hospital_before_update() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if coalesce(current_setting('breatheguard.internal', true), '') = 'on' then return new; end if;
  if new.status is distinct from old.status or new.status_reason is distinct from old.status_reason then
    if old.status = 'more_info' and new.status = 'pending' and new.status_reason is not distinct from old.status_reason then
      perform public.audit('hospital.resubmitted', 'hospitals', new.id::text, '{}'::jsonb);
    else
      raise exception 'Hospital status can only be changed by the healthcare authority' using errcode = '42501';
    end if;
  end if;
  new.created_by := old.created_by; new.updated_at := now();
  return new;
end $$;
drop trigger if exists trg_hospital_bi on public.hospitals;
create trigger trg_hospital_bi before insert on public.hospitals for each row execute function public.hospital_before_insert();
drop trigger if exists trg_hospital_ai on public.hospitals;
create trigger trg_hospital_ai after insert on public.hospitals for each row execute function public.hospital_after_insert();
drop trigger if exists trg_hospital_bu on public.hospitals;
create trigger trg_hospital_bu before update on public.hospitals for each row execute function public.hospital_before_update();

-- Doctors always start pending and belong to the submitter's own approved hospital.
create or replace function public.doctor_before_insert() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if public.my_approved_hospital() is null then
    raise exception 'Your hospital must be approved before submitting doctors' using errcode = '42501';
  end if;
  new.hospital_id := public.my_approved_hospital(); new.status := 'pending'; new.status_reason := null;
  new.submitted_by := auth.uid(); new.is_synthetic := true;
  perform public.audit('doctor.submitted', 'doctors', new.id::text, jsonb_build_object('name', new.full_name));
  return new;
end $$;
drop trigger if exists trg_doctor_bi on public.doctors;
create trigger trg_doctor_bi before insert on public.doctors for each row execute function public.doctor_before_insert();

-- Consent: always the patient's own row; every change audited.
create or replace function public.consent_guard() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if tg_op in ('INSERT', 'UPDATE') then
    new.patient_id := auth.uid(); new.updated_at := now();
    if new.active and cardinality(new.scopes) = 0 then new.active := false; end if;
    perform public.audit('consent.' || lower(tg_op), 'consents', new.hospital_id::text,
      jsonb_build_object('patient', new.patient_id, 'active', new.active, 'scopes', new.scopes));
    return new;
  end if;
  perform public.audit('consent.delete', 'consents', old.hospital_id::text, jsonb_build_object('patient', old.patient_id));
  return old;
end $$;
drop trigger if exists trg_consent on public.consents;
create trigger trg_consent before insert or update or delete on public.consents
  for each row execute function public.consent_guard();

-- Alerts are created by the database when a session's outcome CHANGES (never once per
-- observation). Users cannot insert alerts directly. Recipients = hospitals with live consent.
create or replace function public.analysis_to_alert() returns trigger
language plpgsql security definer set search_path = public as $$
declare prev public.outcome; pid uuid; recips uuid[];
begin
  select outcome into prev from public.analysis_results
   where session_id = new.session_id and window_end < new.window_end
   order by window_end desc limit 1;
  if (prev is null and new.outcome <> 'within') or (prev is not null and prev <> new.outcome) then
    select patient_id into pid from public.monitoring_sessions where id = new.session_id;
    select coalesce(array_agg(hospital_id), '{}') into recips from public.consents
     where patient_id = pid and active and 'reports' = any (scopes);
    insert into public.alerts (session_id, patient_id, window_end, category, explanation, quality_context, recipients)
    values (new.session_id, pid, new.window_end, new.outcome,
            case new.outcome
              when 'within' then 'Back within expected simulated range. '
              when 'concerning' then 'Potentially concerning simulated pattern. '
              else 'Insufficient reliable data. ' end || new.reason,
            jsonb_build_object('quality', new.quality, 'channels', new.channel_quality, 'previous', prev),
            recips)
    on conflict (session_id, window_end) do nothing;
  end if;
  return new;
end $$;
drop trigger if exists trg_analysis_alert on public.analysis_results;
create trigger trg_analysis_alert after insert on public.analysis_results
  for each row execute function public.analysis_to_alert();

-- ---------------------------------------------------------------- RPCs (server-side decisions)
create or replace function public.decide_hospital(p_hospital uuid, p_decision public.review_status, p_reason text)
returns public.hospitals language plpgsql security definer set search_path = public as $$
declare h public.hospitals; allowed public.review_status[];
begin
  if not public.is_authority() then raise exception 'Only the healthcare authority can decide applications' using errcode = '42501'; end if;
  if char_length(trim(coalesce(p_reason, ''))) < 10 then raise exception 'A reason of at least 10 characters is required' using errcode = '22023'; end if;
  select * into h from public.hospitals where id = p_hospital for update;
  if not found then raise exception 'Hospital not found' using errcode = 'P0002'; end if;
  allowed := case h.status when 'pending' then array['approved','rejected','more_info']::public.review_status[]
                           when 'more_info' then array['rejected']::public.review_status[]
                           when 'approved' then array['suspended']::public.review_status[]
                           when 'suspended' then array['approved','rejected']::public.review_status[]
                           else array[]::public.review_status[] end;
  if not (p_decision = any (allowed)) then raise exception 'Cannot change status from % to %', h.status, p_decision using errcode = '22023'; end if;
  perform set_config('breatheguard.internal', 'on', true);
  update public.hospitals set status = p_decision, status_reason = trim(p_reason), updated_at = now() where id = p_hospital returning * into h;
  perform set_config('breatheguard.internal', 'off', true);
  perform public.audit('hospital.decision', 'hospitals', p_hospital::text, jsonb_build_object('to', p_decision, 'reason', trim(p_reason)));
  return h;  -- NB: approving a hospital does not approve any doctor
end $$;

create or replace function public.decide_doctor(p_doctor uuid, p_decision public.review_status, p_reason text)
returns public.doctors language plpgsql security definer set search_path = public as $$
declare d public.doctors; hs public.review_status;
begin
  if not public.is_authority() then raise exception 'Only the healthcare authority can verify doctors' using errcode = '42501'; end if;
  if char_length(trim(coalesce(p_reason, ''))) < 10 then raise exception 'A reason of at least 10 characters is required' using errcode = '22023'; end if;
  select * into d from public.doctors where id = p_doctor for update;
  if not found then raise exception 'Doctor not found' using errcode = 'P0002'; end if;
  select status into hs from public.hospitals where id = d.hospital_id;
  if p_decision = 'approved' and hs <> 'approved' then raise exception 'The doctor''s hospital is not approved' using errcode = '22023'; end if;
  update public.doctors set status = p_decision, status_reason = trim(p_reason) where id = p_doctor returning * into d;
  perform public.audit('doctor.decision', 'doctors', p_doctor::text, jsonb_build_object('to', p_decision, 'reason', trim(p_reason)));
  return d;
end $$;

create or replace function public.acknowledge_alert(p_alert uuid) returns public.alerts
language plpgsql security definer set search_path = public as $$
declare a public.alerts;
begin
  select * into a from public.alerts where id = p_alert;
  if not found or not public.can_read_patient(a.patient_id) then raise exception 'Alert not found or not permitted' using errcode = '42501'; end if;
  update public.alerts set acknowledged_at = coalesce(acknowledged_at, now()), acknowledged_by = coalesce(acknowledged_by, auth.uid())
   where id = p_alert returning * into a;
  perform public.audit('alert.acknowledged', 'alerts', p_alert::text, '{}'::jsonb);
  return a;
end $$;

create or replace function public.set_appointment_status(p_appt uuid, p_status text) returns public.appointments
language plpgsql security definer set search_path = public as $$
declare a public.appointments; ok boolean;
begin
  select * into a from public.appointments where id = p_appt for update;
  if not found then raise exception 'Appointment not found' using errcode = 'P0002'; end if;
  if a.patient_id = auth.uid() then ok := p_status = 'cancelled' and a.status in ('requested', 'confirmed');
  elsif a.hospital_id = public.my_approved_hospital() then
    ok := (a.status = 'requested' and p_status in ('confirmed', 'declined', 'cancelled')) or (a.status = 'confirmed' and p_status in ('completed', 'cancelled'));
  else raise exception 'Not permitted' using errcode = '42501'; end if;
  if not ok then raise exception 'Cannot move an appointment from % to %', a.status, p_status using errcode = '22023'; end if;
  update public.appointments set status = p_status, updated_at = now() where id = p_appt returning * into a;
  return a;
end $$;

-- Report payload, read with the CALLER's permissions (security invoker): if RLS hides the
-- session, the report is empty and the function raises.
create or replace function public.session_report(p_session uuid) returns jsonb
language plpgsql stable security invoker set search_path = public as $$
declare s public.monitoring_sessions; result jsonb;
begin
  select * into s from public.monitoring_sessions where id = p_session;
  if not found then raise exception 'Session not found or not permitted' using errcode = '42501'; end if;
  select jsonb_build_object(
    'label', 'SYNTHETIC DATA — NOT FOR CLINICAL USE',
    'session', to_jsonb(s),
    'analysis', coalesce((select jsonb_agg(to_jsonb(a) - 'session_id' order by a.window_end) from public.analysis_results a where a.session_id = p_session), '[]'::jsonb),
    'alerts', coalesce((select jsonb_agg(to_jsonb(al) - 'session_id' order by al.created_at) from public.alerts al where al.session_id = p_session), '[]'::jsonb),
    'observation_seconds', (select count(*) from public.observations o where o.session_id = p_session),
    'generated_at', now()) into result;
  return result;
end $$;

-- ---------------------------------------------------------------- row-level security
alter table public.profiles enable row level security;
alter table public.hospitals enable row level security;
alter table public.doctors enable row level security;
alter table public.consents enable row level security;
alter table public.monitoring_sessions enable row level security;
alter table public.observations enable row level security;
alter table public.analysis_results enable row level security;
alter table public.alerts enable row level security;
alter table public.appointments enable row level security;
alter table public.reports enable row level security;
alter table public.audit_log enable row level security;

-- profiles
drop policy if exists profiles_read on public.profiles;
create policy profiles_read on public.profiles for select to authenticated
  using (id = auth.uid() or public.is_authority() or (role = 'patient' and public.can_read_patient(id)));
drop policy if exists profiles_update_self on public.profiles;
create policy profiles_update_self on public.profiles for update to authenticated
  using (id = auth.uid()) with check (id = auth.uid());

-- hospitals: approved ones are public to signed-in users; staff see their own; authority sees all
drop policy if exists hospitals_read on public.hospitals;
create policy hospitals_read on public.hospitals for select to authenticated
  using (status = 'approved' or created_by = auth.uid() or public.is_authority());
drop policy if exists hospitals_insert on public.hospitals;
create policy hospitals_insert on public.hospitals for insert to authenticated with check (true); -- trigger enforces role and status
drop policy if exists hospitals_update_own on public.hospitals;
create policy hospitals_update_own on public.hospitals for update to authenticated
  using (created_by = auth.uid() and status in ('pending', 'more_info')) with check (created_by = auth.uid());

-- doctors: verified doctors at approved hospitals are visible; staff see their hospital's; authority all
drop policy if exists doctors_read on public.doctors;
create policy doctors_read on public.doctors for select to authenticated
  using ((status = 'approved' and exists (select 1 from public.hospitals h where h.id = hospital_id and h.status = 'approved'))
         or hospital_id = (select hospital_id from public.profiles where id = auth.uid())
         or public.is_authority());
drop policy if exists doctors_insert on public.doctors;
create policy doctors_insert on public.doctors for insert to authenticated with check (true); -- trigger enforces approval and ownership

-- consents: patient manages own; the named hospital's approved staff and the authority can read
drop policy if exists consents_patient on public.consents;
create policy consents_patient on public.consents for all to authenticated
  using (patient_id = auth.uid()) with check (patient_id = auth.uid() and public.my_role() = 'patient');
drop policy if exists consents_hospital_read on public.consents;
create policy consents_hospital_read on public.consents for select to authenticated
  using (hospital_id = public.my_approved_hospital() or public.is_authority());

-- monitoring sessions
drop policy if exists sessions_read on public.monitoring_sessions;
create policy sessions_read on public.monitoring_sessions for select to authenticated using (public.can_read_patient(patient_id));
drop policy if exists sessions_insert on public.monitoring_sessions;
create policy sessions_insert on public.monitoring_sessions for insert to authenticated
  with check (patient_id = auth.uid() and public.my_role() = 'patient' and is_synthetic);
drop policy if exists sessions_update on public.monitoring_sessions;
create policy sessions_update on public.monitoring_sessions for update to authenticated
  using (patient_id = auth.uid()) with check (patient_id = auth.uid());

-- observations and analysis: written only by the session owner while active; read by owner or consented hospital
drop policy if exists obs_read on public.observations;
create policy obs_read on public.observations for select to authenticated using (public.can_read_patient(public.session_owner(session_id)));
drop policy if exists obs_insert on public.observations;
create policy obs_insert on public.observations for insert to authenticated
  with check (exists (select 1 from public.monitoring_sessions s where s.id = session_id and s.patient_id = auth.uid() and s.status = 'active'));
drop policy if exists ar_read on public.analysis_results;
create policy ar_read on public.analysis_results for select to authenticated using (public.can_read_patient(public.session_owner(session_id)));
drop policy if exists ar_insert on public.analysis_results;
create policy ar_insert on public.analysis_results for insert to authenticated
  with check (exists (select 1 from public.monitoring_sessions s where s.id = session_id and s.patient_id = auth.uid() and s.status = 'active'));

-- alerts: read by owner or consented hospital; no direct insert/update (trigger + acknowledge_alert only)
drop policy if exists alerts_read on public.alerts;
create policy alerts_read on public.alerts for select to authenticated using (public.can_read_patient(patient_id));

-- appointments
drop policy if exists appt_read on public.appointments;
create policy appt_read on public.appointments for select to authenticated
  using (patient_id = auth.uid() or hospital_id = public.my_approved_hospital() or public.is_authority());
drop policy if exists appt_insert on public.appointments;
create policy appt_insert on public.appointments for insert to authenticated
  with check (patient_id = auth.uid() and public.my_role() = 'patient' and status = 'requested'
    and exists (select 1 from public.doctors d join public.hospitals h on h.id = d.hospital_id
                where d.id = doctor_id and d.hospital_id = appointments.hospital_id and d.status = 'approved' and h.status = 'approved'));

-- reports log
drop policy if exists reports_read on public.reports;
create policy reports_read on public.reports for select to authenticated using (public.can_read_patient(public.session_owner(session_id)));
drop policy if exists reports_insert on public.reports;
create policy reports_insert on public.reports for insert to authenticated
  with check (generated_by = auth.uid() and public.can_read_patient(public.session_owner(session_id)));

-- audit log: authority reads all; users read entries they made; nobody writes directly
drop policy if exists audit_read on public.audit_log;
create policy audit_read on public.audit_log for select to authenticated using (public.is_authority() or actor_id = auth.uid());

-- table privileges (RLS still applies on top)
grant usage on schema public to anon, authenticated;
grant select, insert, update, delete on all tables in schema public to authenticated;
revoke insert, update, delete on public.alerts, public.audit_log from authenticated;
revoke update, delete on public.observations, public.analysis_results from authenticated;
revoke all on all tables in schema public from anon;
grant execute on function public.decide_hospital(uuid, public.review_status, text), public.decide_doctor(uuid, public.review_status, text),
  public.acknowledge_alert(uuid), public.set_appointment_status(uuid, text), public.session_report(uuid) to authenticated;

-- ---------------------------------------------------------------- real-time
-- Supabase Realtime delivers row changes only to subscribers whose RLS allows the row.
do $$ begin
  if not exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    create publication supabase_realtime;
  end if;
end $$;
do $$ declare t text; begin
  foreach t in array array['monitoring_sessions', 'observations', 'analysis_results', 'alerts', 'consents'] loop
    if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = t) then
      execute format('alter publication supabase_realtime add table public.%I', t);
    end if;
  end loop;
end $$;


-- ======================== 0002_breatheguard_complete.sql ========================
-- BreatheGuard 0002: completes accounts, care teams, appointments, notifications, alert rules,
-- AI history and report metadata. Run AFTER 0001. Safe to re-run.
-- Note: 'doctor' is compared as text inside functions, so this file also works when the
-- new enum value is added in the same run.

alter type public.app_role add value if not exists 'doctor';

-- ---------------------------------------------------------------- schema additions
alter table public.doctors add column if not exists user_id uuid unique references public.profiles (id) on delete set null;
alter table public.reports add column if not exists format text not null default 'pdf' check (format in ('pdf', 'csv'));
alter table public.reports add column if not exists file_name text check (char_length(file_name) <= 200);
alter table public.reports add column if not exists size_bytes integer check (size_bytes >= 0);

create table if not exists public.notifications (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles (id) on delete cascade,
  kind text not null check (kind in ('alert', 'appointment', 'report', 'application', 'consent', 'account')),
  title text not null check (char_length(title) <= 200),
  body text not null default '' check (char_length(body) <= 1000),
  link text check (char_length(link) <= 200),
  created_at timestamptz not null default now(),
  read_at timestamptz
);
create index if not exists idx_notifications_user on public.notifications (user_id, created_at desc);

create table if not exists public.appointment_events (
  id bigint generated always as identity primary key,
  appointment_id uuid not null references public.appointments (id) on delete cascade,
  actor_id uuid,
  from_status text, to_status text,
  from_time timestamptz, to_time timestamptz,
  note text check (char_length(note) <= 500),
  created_at timestamptz not null default now()
);
create index if not exists idx_appt_events on public.appointment_events (appointment_id, created_at);

create table if not exists public.alert_settings (
  id boolean primary key default true check (id),
  concerning_min_windows integer not null default 1 check (concerning_min_windows between 1 and 5),
  alert_on_insufficient boolean not null default true,
  updated_by uuid, updated_at timestamptz not null default now()
);
insert into public.alert_settings (id) values (true) on conflict (id) do nothing;

create table if not exists public.ai_messages (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles (id) on delete cascade,
  session_id uuid references public.monitoring_sessions (id) on delete set null,
  role text not null check (role in ('user', 'assistant')),
  content text not null check (char_length(content) <= 8000),
  model text,
  created_at timestamptz not null default now()
);
create index if not exists idx_ai_messages_user on public.ai_messages (user_id, created_at);

-- ---------------------------------------------------------------- helpers
-- Care-team hospital of the current user: staff of an approved hospital, or a doctor whose
-- own record is verified AND whose hospital is approved. All 0001 policies use this, so doctors
-- gain exactly the access their hospital has, and only once verified.
create or replace function public.my_approved_hospital() returns uuid
language plpgsql stable security definer set search_path = public as $$
declare r text; hid uuid;
begin
  select role::text, hospital_id into r, hid from public.profiles where id = auth.uid();
  if r = 'hospital_staff' then
    return (select h.id from public.hospitals h where h.id = hid and h.status = 'approved');
  elsif r = 'doctor' then
    return (select d.hospital_id from public.doctors d join public.hospitals h on h.id = d.hospital_id
            where d.user_id = auth.uid() and d.status = 'approved' and h.status = 'approved' limit 1);
  end if;
  return null;
end $$;

create or replace function public.notify(p_user uuid, p_kind text, p_title text, p_body text, p_link text)
returns void language sql security definer set search_path = public as
$$ insert into public.notifications (user_id, kind, title, body, link)
   select p_user, p_kind, left(p_title, 200), left(coalesce(p_body, ''), 1000), p_link where p_user is not null $$;
revoke execute on function public.notify(uuid, text, text, text, text) from public, anon, authenticated;

-- everyone on a hospital's care team (staff, plus linked doctors)
create or replace function public.care_team(p_hospital uuid) returns setof uuid
language sql stable security definer set search_path = public as
$$ select id from public.profiles where hospital_id = p_hospital and role::text in ('hospital_staff', 'doctor') $$;
revoke execute on function public.care_team(uuid) from public, anon, authenticated;

-- New users: patient, hospital_staff or doctor may be self-chosen. Never authority.
create or replace function public.handle_new_user() returns trigger
language plpgsql security definer set search_path = public as $$
declare r text := coalesce(new.raw_user_meta_data ->> 'role', 'patient');
begin
  if r not in ('patient', 'hospital_staff', 'doctor') then r := 'patient'; end if;
  insert into public.profiles (id, role, full_name)
  values (new.id, r::public.app_role, left(coalesce(new.raw_user_meta_data ->> 'full_name', ''), 200));
  return new;
end $$;

-- ---------------------------------------------------------------- administrator management
-- Initial administrator: run ONLY in the Supabase SQL editor (service role). Not callable from the app.
create or replace function public.bootstrap_authority(p_email text) returns text
language plpgsql security definer set search_path = public as $$
declare uid uuid;
begin
  select id into uid from auth.users where lower(email) = lower(trim(p_email));
  if uid is null then raise exception 'No account with that email. Register it in the app first.'; end if;
  perform set_config('breatheguard.internal', 'on', true);
  update public.profiles set role = 'authority', hospital_id = null where id = uid;
  perform set_config('breatheguard.internal', 'off', true);
  insert into public.audit_log (actor_id, action, target_table, target_id, detail)
  values (null, 'authority.bootstrap', 'profiles', uid::text, jsonb_build_object('email', p_email));
  return 'Authority role granted to ' || p_email;
end $$;
revoke execute on function public.bootstrap_authority(text) from public, anon, authenticated;

create or replace function public.set_authority(p_email text, p_grant boolean, p_reason text) returns text
language plpgsql security definer set search_path = public as $$
declare uid uuid; n int;
begin
  if not public.is_authority() then raise exception 'Only the healthcare authority can manage administrators' using errcode = '42501'; end if;
  if char_length(trim(coalesce(p_reason, ''))) < 10 then raise exception 'A reason of at least 10 characters is required' using errcode = '22023'; end if;
  select id into uid from auth.users where lower(email) = lower(trim(p_email));
  if uid is null then raise exception 'No account with that email' using errcode = 'P0002'; end if;
  if not p_grant and uid = auth.uid() then raise exception 'You cannot remove your own administrator rights' using errcode = '22023'; end if;
  if not p_grant then
    select count(*) into n from public.profiles where role = 'authority';
    if n <= 1 then raise exception 'At least one administrator must remain' using errcode = '22023'; end if;
  end if;
  perform set_config('breatheguard.internal', 'on', true);
  update public.profiles set role = case when p_grant then 'authority'::public.app_role else 'patient'::public.app_role end, hospital_id = null where id = uid;
  perform set_config('breatheguard.internal', 'off', true);
  perform public.audit(case when p_grant then 'authority.granted' else 'authority.revoked' end, 'profiles', uid::text, jsonb_build_object('email', p_email, 'reason', trim(p_reason)));
  perform public.notify(uid, 'account', case when p_grant then 'You are now a healthcare authority administrator' else 'Your administrator rights were removed' end, trim(p_reason), null);
  return 'Done';
end $$;

-- ---------------------------------------------------------------- doctors: account linking and decisions
create or replace function public.link_doctor_account(p_doctor uuid, p_email text) returns public.doctors
language plpgsql security definer set search_path = public as $$
declare d public.doctors; uid uuid; urole text;
begin
  select * into d from public.doctors where id = p_doctor;
  if not found then raise exception 'Doctor not found' using errcode = 'P0002'; end if;
  if not exists (select 1 from public.profiles where id = auth.uid() and role = 'hospital_staff' and hospital_id = d.hospital_id) then
    raise exception 'Only staff of this doctor''s hospital can link an account' using errcode = '42501';
  end if;
  select u.id, p.role::text into uid, urole from auth.users u join public.profiles p on p.id = u.id where lower(u.email) = lower(trim(p_email));
  if uid is null or urole <> 'doctor' then raise exception 'No doctor account with that email. The doctor must register with account type Doctor first.' using errcode = 'P0002'; end if;
  if exists (select 1 from public.doctors where user_id = uid and id <> p_doctor) then raise exception 'That account is already linked to another doctor record' using errcode = '23505'; end if;
  update public.doctors set user_id = uid where id = p_doctor returning * into d;
  perform set_config('breatheguard.internal', 'on', true);
  update public.profiles set hospital_id = d.hospital_id where id = uid;
  perform set_config('breatheguard.internal', 'off', true);
  perform public.audit('doctor.account_linked', 'doctors', p_doctor::text, jsonb_build_object('email', p_email));
  perform public.notify(uid, 'account', 'Your account was linked to a doctor record', 'Care-team access starts once the healthcare authority verifies your credentials and your hospital is approved.', 'hospital');
  return d;
end $$;

-- Decisions: same as 0001 plus revoking an approval (approved -> rejected), and notifications.
create or replace function public.decide_hospital(p_hospital uuid, p_decision public.review_status, p_reason text)
returns public.hospitals language plpgsql security definer set search_path = public as $$
declare h public.hospitals; allowed public.review_status[];
begin
  if not public.is_authority() then raise exception 'Only the healthcare authority can decide applications' using errcode = '42501'; end if;
  if char_length(trim(coalesce(p_reason, ''))) < 10 then raise exception 'A reason of at least 10 characters is required' using errcode = '22023'; end if;
  select * into h from public.hospitals where id = p_hospital for update;
  if not found then raise exception 'Hospital not found' using errcode = 'P0002'; end if;
  allowed := case h.status when 'pending' then array['approved','rejected','more_info']::public.review_status[]
                           when 'more_info' then array['rejected']::public.review_status[]
                           when 'approved' then array['suspended','rejected']::public.review_status[]
                           when 'suspended' then array['approved','rejected']::public.review_status[]
                           else array[]::public.review_status[] end;
  if not (p_decision = any (allowed)) then raise exception 'Cannot change status from % to %', h.status, p_decision using errcode = '22023'; end if;
  perform set_config('breatheguard.internal', 'on', true);
  update public.hospitals set status = p_decision, status_reason = trim(p_reason), updated_at = now() where id = p_hospital returning * into h;
  perform set_config('breatheguard.internal', 'off', true);
  perform public.audit('hospital.decision', 'hospitals', p_hospital::text, jsonb_build_object('from', (select status from public.hospitals where false), 'to', p_decision, 'reason', trim(p_reason)));
  perform public.notify(m, 'application', 'Hospital application: ' || p_decision::text, trim(p_reason), 'hospital') from public.care_team(p_hospital) m;
  return h;
end $$;

create or replace function public.decide_doctor(p_doctor uuid, p_decision public.review_status, p_reason text)
returns public.doctors language plpgsql security definer set search_path = public as $$
declare d public.doctors; hs public.review_status; allowed public.review_status[];
begin
  if not public.is_authority() then raise exception 'Only the healthcare authority can verify doctors' using errcode = '42501'; end if;
  if char_length(trim(coalesce(p_reason, ''))) < 10 then raise exception 'A reason of at least 10 characters is required' using errcode = '22023'; end if;
  select * into d from public.doctors where id = p_doctor for update;
  if not found then raise exception 'Doctor not found' using errcode = 'P0002'; end if;
  allowed := case d.status when 'pending' then array['approved','rejected','more_info']::public.review_status[]
                           when 'more_info' then array['approved','rejected']::public.review_status[]
                           when 'approved' then array['suspended','rejected']::public.review_status[]
                           when 'suspended' then array['approved','rejected']::public.review_status[]
                           else array[]::public.review_status[] end;
  if not (p_decision = any (allowed)) then raise exception 'Cannot change status from % to %', d.status, p_decision using errcode = '22023'; end if;
  select status into hs from public.hospitals where id = d.hospital_id;
  if p_decision = 'approved' and hs <> 'approved' then raise exception 'The doctor''s hospital is not approved' using errcode = '22023'; end if;
  update public.doctors set status = p_decision, status_reason = trim(p_reason) where id = p_doctor returning * into d;
  perform public.audit('doctor.decision', 'doctors', p_doctor::text, jsonb_build_object('to', p_decision, 'reason', trim(p_reason)));
  perform public.notify(m, 'application', d.full_name || ': credential ' || p_decision::text, trim(p_reason), 'hospital') from public.care_team(d.hospital_id) m;
  return d;
end $$;

-- ---------------------------------------------------------------- alerts: configurable, reproducible rules
create or replace function public.analysis_to_alert() returns trigger
language plpgsql security definer set search_path = public as $$
declare prev public.outcome; beyond public.outcome; pid uuid; hid uuid; recips uuid[]; s public.alert_settings; run int; fire boolean := false; aid uuid;
begin
  select * into s from public.alert_settings where id;
  select outcome into prev from public.analysis_results where session_id = new.session_id and window_end < new.window_end order by window_end desc limit 1;
  if new.outcome = 'concerning' then
    -- fire once, on the window where the run of consecutive concerning results reaches the configured length
    select count(*) filter (where outcome = 'concerning'), count(*) into run from (
      select outcome from public.analysis_results where session_id = new.session_id and window_end <= new.window_end order by window_end desc limit s.concerning_min_windows) x;
    select outcome into beyond from public.analysis_results where session_id = new.session_id and window_end <= new.window_end order by window_end desc offset s.concerning_min_windows limit 1;
    fire := run = s.concerning_min_windows and (select count(*) from (select 1 from public.analysis_results where session_id = new.session_id and window_end <= new.window_end limit s.concerning_min_windows) y) = s.concerning_min_windows
            and beyond is distinct from 'concerning';
  elsif new.outcome = 'insufficient' then
    fire := s.alert_on_insufficient and prev is distinct from 'insufficient';
  else -- back within range: only worth an alert if an earlier alert in this session is still the latest state
    fire := prev is not null and prev <> 'within' and exists (select 1 from public.alerts where session_id = new.session_id and category <> 'within');
  end if;
  if not fire then return new; end if;
  select patient_id into pid from public.monitoring_sessions where id = new.session_id;
  select coalesce(array_agg(hospital_id), '{}') into recips from public.consents where patient_id = pid and active and 'reports' = any (scopes);
  insert into public.alerts (session_id, patient_id, window_end, category, explanation, quality_context, recipients)
  values (new.session_id, pid, new.window_end, new.outcome,
          case new.outcome when 'within' then 'Back within expected simulated range. '
                           when 'concerning' then 'Potentially concerning simulated pattern. '
                           else 'Insufficient reliable data. ' end || new.reason,
          jsonb_build_object('quality', new.quality, 'channels', new.channel_quality, 'previous', prev, 'rule', jsonb_build_object('concerning_min_windows', s.concerning_min_windows, 'alert_on_insufficient', s.alert_on_insufficient)),
          recips)
  on conflict (session_id, window_end) do nothing returning id into aid;
  if aid is not null then
    perform public.notify(pid, 'alert', 'Simulated monitoring alert: ' || new.outcome::text, left(new.reason, 300), 'sessions');
    foreach hid in array recips loop
      perform public.notify(m, 'alert', 'Shared patient alert: ' || new.outcome::text, left(new.reason, 300), 'live') from public.care_team(hid) m;
    end loop;
  end if;
  return new;
end $$;

create or replace function public.update_alert_settings(p_min_windows integer, p_on_insufficient boolean, p_reason text) returns public.alert_settings
language plpgsql security definer set search_path = public as $$
declare s public.alert_settings;
begin
  if not public.is_authority() then raise exception 'Only the healthcare authority can change alert rules' using errcode = '42501'; end if;
  if char_length(trim(coalesce(p_reason, ''))) < 10 then raise exception 'A reason of at least 10 characters is required' using errcode = '22023'; end if;
  update public.alert_settings set concerning_min_windows = p_min_windows, alert_on_insufficient = p_on_insufficient, updated_by = auth.uid(), updated_at = now() where id returning * into s;
  perform public.audit('alert_rules.updated', 'alert_settings', 'singleton', jsonb_build_object('concerning_min_windows', p_min_windows, 'alert_on_insufficient', p_on_insufficient, 'reason', trim(p_reason)));
  return s;
end $$;

-- ---------------------------------------------------------------- appointments: history, rescheduling, notifications
create or replace function public.appointment_audit() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'INSERT' then
    insert into public.appointment_events (appointment_id, actor_id, to_status, to_time, note) values (new.id, auth.uid(), new.status, new.requested_for, 'Requested');
    perform public.notify(m, 'appointment', 'New appointment request', coalesce(new.reason, ''), 'appointments') from public.care_team(new.hospital_id) m;
  elsif new.status is distinct from old.status or new.requested_for is distinct from old.requested_for then
    insert into public.appointment_events (appointment_id, actor_id, from_status, to_status, from_time, to_time, note)
    values (new.id, auth.uid(), old.status, new.status, old.requested_for, new.requested_for, nullif(current_setting('breatheguard.note', true), ''));
    perform public.notify(new.patient_id, 'appointment', 'Appointment ' || new.status || case when new.requested_for is distinct from old.requested_for then ' (new time)' else '' end, to_char(new.requested_for at time zone 'UTC', 'YYYY-MM-DD HH24:MI') || ' UTC', 'appointments')
      where auth.uid() is distinct from new.patient_id;
    perform public.notify(m, 'appointment', 'Appointment ' || new.status, to_char(new.requested_for at time zone 'UTC', 'YYYY-MM-DD HH24:MI') || ' UTC', 'appointments')
      from public.care_team(new.hospital_id) m where auth.uid() = new.patient_id;
  end if;
  return new;
end $$;
drop trigger if exists trg_appointment_audit on public.appointments;
create trigger trg_appointment_audit after insert or update on public.appointments for each row execute function public.appointment_audit();

create or replace function public.reschedule_appointment(p_appt uuid, p_time timestamptz, p_note text) returns public.appointments
language plpgsql security definer set search_path = public as $$
declare a public.appointments;
begin
  select * into a from public.appointments where id = p_appt for update;
  if not found then raise exception 'Appointment not found' using errcode = 'P0002'; end if;
  if p_time <= now() then raise exception 'Choose a time in the future' using errcode = '22023'; end if;
  if a.patient_id = auth.uid() then
    if a.status <> 'requested' then raise exception 'Only a pending request can be changed by the patient; ask the hospital to reschedule' using errcode = '22023'; end if;
  elsif a.hospital_id = public.my_approved_hospital() then
    if a.status not in ('requested', 'confirmed') then raise exception 'Cannot reschedule a % appointment', a.status using errcode = '22023'; end if;
  else raise exception 'Not permitted' using errcode = '42501'; end if;
  perform set_config('breatheguard.note', left(coalesce(p_note, 'Rescheduled'), 500), true);
  update public.appointments set requested_for = p_time, status = case when a.patient_id = auth.uid() then 'requested' else 'confirmed' end, updated_at = now()
   where id = p_appt returning * into a;
  return a;
end $$;

-- ---------------------------------------------------------------- reports and sessions: notifications and audit
create or replace function public.session_stopped_notify() returns trigger
language plpgsql security definer set search_path = public as $$
declare hid uuid;
begin
  if new.status = 'stopped' and old.status = 'active' then
    perform public.notify(new.patient_id, 'report', 'Session report available', 'Your synthetic monitoring session has ended. Its report can now be downloaded.', 'sessions');
    for hid in select hospital_id from public.consents where patient_id = new.patient_id and active and 'reports' = any (scopes) loop
      perform public.notify(m, 'report', 'Shared session report available', 'A consented patient’s synthetic monitoring session has ended.', 'live') from public.care_team(hid) m;
    end loop;
  end if;
  return new;
end $$;
drop trigger if exists trg_session_stopped on public.monitoring_sessions;
create trigger trg_session_stopped after update on public.monitoring_sessions for each row execute function public.session_stopped_notify();

create or replace function public.report_audit() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  perform public.audit('report.generated', 'monitoring_sessions', new.session_id::text, jsonb_build_object('format', new.format, 'file', new.file_name));
  return new;
end $$;
drop trigger if exists trg_report_audit on public.reports;
create trigger trg_report_audit after insert on public.reports for each row execute function public.report_audit();

create or replace function public.consent_notify() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  perform public.notify(m, 'consent', case when new.active then 'A patient shared their monitoring data' else 'A patient stopped sharing their monitoring data' end, '', 'live')
    from public.care_team(new.hospital_id) m;
  return new;
end $$;
drop trigger if exists trg_consent_notify on public.consents;
create trigger trg_consent_notify after insert or update on public.consents for each row execute function public.consent_notify();

-- Report payload: adds a record identifier (not the patient's name) and the data-quality notes.
create or replace function public.session_report(p_session uuid) returns jsonb
language plpgsql stable security invoker set search_path = public as $$
declare s public.monitoring_sessions;
begin
  select * into s from public.monitoring_sessions where id = p_session;
  if not found then raise exception 'Session not found or not permitted' using errcode = '42501'; end if;
  return jsonb_build_object(
    'label', 'SYNTHETIC DATA — NOT FOR CLINICAL USE',
    'record_id', 'BG-' || upper(left(replace(s.patient_id::text, '-', ''), 8)),
    'session', to_jsonb(s),
    'analysis', coalesce((select jsonb_agg(to_jsonb(a) - 'session_id' order by a.window_end) from public.analysis_results a where a.session_id = p_session), '[]'::jsonb),
    'alerts', coalesce((select jsonb_agg(to_jsonb(al) - 'session_id' order by al.created_at) from public.alerts al where al.session_id = p_session), '[]'::jsonb),
    'observation_seconds', (select count(*) from public.observations o where o.session_id = p_session),
    'missing_seconds', (select count(*) from public.observations o where o.session_id = p_session and (o.chest is null or array_position(o.chest, null) is not null)),
    'generated_at', now());
end $$;

-- ---------------------------------------------------------------- row-level security for new tables
alter table public.notifications enable row level security;
alter table public.appointment_events enable row level security;
alter table public.alert_settings enable row level security;
alter table public.ai_messages enable row level security;

drop policy if exists notif_own on public.notifications;
create policy notif_own on public.notifications for select to authenticated using (user_id = auth.uid());
drop policy if exists notif_mark_read on public.notifications;
create policy notif_mark_read on public.notifications for update to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());

drop policy if exists appt_events_read on public.appointment_events;
create policy appt_events_read on public.appointment_events for select to authenticated
  using (exists (select 1 from public.appointments a where a.id = appointment_id and (a.patient_id = auth.uid() or a.hospital_id = public.my_approved_hospital() or public.is_authority())));

drop policy if exists alert_settings_read on public.alert_settings;
create policy alert_settings_read on public.alert_settings for select to authenticated using (true);

drop policy if exists ai_own on public.ai_messages;
create policy ai_own on public.ai_messages for all to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());

-- Doctors may see the patient profiles of their care team like staff do (covered by can_read_patient via my_approved_hospital).
-- Staff can see doctor accounts linked to their hospital.
-- (a SECURITY DEFINER helper avoids the policy reading its own table, which would recurse)
create or replace function public.my_hospital_id() returns uuid
language sql stable security definer set search_path = public as
$$ select hospital_id from public.profiles where id = auth.uid() $$;
drop policy if exists profiles_read on public.profiles;
create policy profiles_read on public.profiles for select to authenticated
  using (id = auth.uid() or public.is_authority() or (role = 'patient' and public.can_read_patient(id))
         or (hospital_id is not null and hospital_id = public.my_hospital_id()));

grant select, insert, update, delete on public.notifications, public.appointment_events, public.alert_settings, public.ai_messages to authenticated;
revoke insert, delete on public.notifications from authenticated;
revoke update on public.notifications from authenticated;
grant update (read_at) on public.notifications to authenticated;
revoke insert, update, delete on public.appointment_events, public.alert_settings from authenticated;
revoke update on public.ai_messages from authenticated;
revoke update on public.appointments from authenticated;  -- status and time change only through functions
revoke all on public.notifications, public.appointment_events, public.alert_settings, public.ai_messages from anon;
grant execute on function public.set_authority(text, boolean, text), public.link_doctor_account(uuid, text),
  public.update_alert_settings(integer, boolean, text), public.reschedule_appointment(uuid, timestamptz, text) to authenticated;

-- ---------------------------------------------------------------- real-time
do $$ declare t text; begin
  foreach t in array array['notifications', 'appointments', 'appointment_events', 'hospitals', 'doctors'] loop
    if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = t) then
      execute format('alter publication supabase_realtime add table public.%I', t);
    end if;
  end loop;
end $$;


-- ======================== 0003_breatheguard_relationships.sql ========================
-- BreatheGuard 0003: patient–doctor connection requests, messaging, alert resolution,
-- clinician-entered prescriptions, medication reminders, reviews, AI rate limiting and
-- AI-history opt-in. Run AFTER 0001 and 0002. Safe to re-run.

-- ---------------------------------------------------------------- notifications: new kinds
alter table public.notifications drop constraint if exists notifications_kind_check;
alter table public.notifications add constraint notifications_kind_check
  check (kind in ('alert', 'appointment', 'report', 'application', 'consent', 'account', 'message', 'connection', 'prescription', 'review'));

-- a doctor record is "active" when the doctor is verified, linked to an account, and the hospital approved
create or replace function public.active_doctor_user(p_doctor uuid) returns uuid
language sql stable security definer set search_path = public as
$$ select d.user_id from public.doctors d join public.hospitals h on h.id = d.hospital_id
   where d.id = p_doctor and d.status = 'approved' and h.status = 'approved' and d.user_id is not null $$;
create or replace function public.my_doctor_id() returns uuid
language sql stable security definer set search_path = public as
$$ select id from public.doctors where user_id = auth.uid() $$;

-- ---------------------------------------------------------------- connection requests / care relationships
create table if not exists public.care_requests (
  id uuid primary key default gen_random_uuid(),
  patient_id uuid not null references public.profiles (id) on delete cascade,
  doctor_id uuid not null references public.doctors (id) on delete cascade,
  message text check (char_length(message) <= 500),
  status text not null default 'pending' check (status in ('pending', 'accepted', 'rejected', 'cancelled', 'ended')),
  created_at timestamptz not null default now(),
  decided_at timestamptz,
  decided_by uuid references public.profiles (id),
  decision_note text check (char_length(decision_note) <= 500)
);
-- at most one open (pending or accepted) request per patient–doctor pair
create unique index if not exists uq_care_request_open on public.care_requests (patient_id, doctor_id) where status in ('pending', 'accepted');
create index if not exists idx_care_requests_doctor on public.care_requests (doctor_id, status);

create or replace function public.care_request_before_insert() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if public.my_role()::text <> 'patient' then raise exception 'Only patients can send connection requests' using errcode = '42501'; end if;
  if public.active_doctor_user(new.doctor_id) is null then
    raise exception 'This doctor is not currently verified and available for connections' using errcode = '22023';
  end if;
  new.patient_id := auth.uid(); new.status := 'pending'; new.decided_at := null; new.decided_by := null; new.decision_note := null;
  return new;
end $$;
create or replace function public.care_request_after_insert() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  perform public.notify(public.active_doctor_user(new.doctor_id), 'connection', 'New connection request',
    'A patient asked to connect with you. Review it under Connections.', '/connections');
  perform public.audit('care.requested', 'care_requests', new.id::text, jsonb_build_object('doctor', new.doctor_id));
  return new;
end $$;
drop trigger if exists trg_care_request_bi on public.care_requests;
create trigger trg_care_request_bi before insert on public.care_requests for each row execute function public.care_request_before_insert();
drop trigger if exists trg_care_request_ai on public.care_requests;
create trigger trg_care_request_ai after insert on public.care_requests for each row execute function public.care_request_after_insert();

-- the intended doctor accepts or rejects
create or replace function public.respond_care_request(p_request uuid, p_accept boolean, p_note text) returns public.care_requests
language plpgsql security definer set search_path = public as $$
declare r public.care_requests;
begin
  select * into r from public.care_requests where id = p_request for update;
  if not found or public.active_doctor_user(r.doctor_id) is distinct from auth.uid() then
    raise exception 'Request not found or not addressed to you' using errcode = '42501';
  end if;
  if r.status <> 'pending' then raise exception 'This request has already been %', r.status using errcode = '22023'; end if;
  update public.care_requests set status = case when p_accept then 'accepted' else 'rejected' end,
    decided_at = now(), decided_by = auth.uid(), decision_note = left(nullif(trim(coalesce(p_note, '')), ''), 500)
   where id = p_request returning * into r;
  perform public.notify(r.patient_id, 'connection', case when p_accept then 'Connection accepted' else 'Connection request declined' end,
    coalesce(r.decision_note, ''), '/providers');
  perform public.audit('care.' || r.status, 'care_requests', r.id::text, jsonb_build_object('doctor', r.doctor_id));
  return r;
end $$;

-- the patient cancels a pending request or ends an accepted relationship (access stops immediately)
create or replace function public.end_care_request(p_request uuid) returns public.care_requests
language plpgsql security definer set search_path = public as $$
declare r public.care_requests;
begin
  select * into r from public.care_requests where id = p_request for update;
  if not found or r.patient_id <> auth.uid() then raise exception 'Request not found' using errcode = '42501'; end if;
  if r.status not in ('pending', 'accepted') then raise exception 'This request is already %', r.status using errcode = '22023'; end if;
  update public.care_requests set status = case when r.status = 'pending' then 'cancelled' else 'ended' end, decided_at = now(), decided_by = auth.uid()
   where id = p_request returning * into r;
  perform public.notify(public.active_doctor_user(r.doctor_id), 'connection', case when r.status = 'cancelled' then 'Connection request withdrawn' else 'Patient ended the connection' end, '', '/connections');
  perform public.audit('care.' || r.status, 'care_requests', r.id::text, '{}'::jsonb);
  return r;
end $$;

-- the doctor of an accepted relationship (verified, hospital approved) for a patient, if the caller is that doctor
create or replace function public.is_connected_doctor(p_patient uuid) returns boolean
language sql stable security definer set search_path = public as
$$ select exists (select 1 from public.care_requests r
                  where r.patient_id = p_patient and r.status = 'accepted' and public.active_doctor_user(r.doctor_id) = auth.uid()) $$;

-- READ ACCESS: original rule (self, or approved hospital with active consent) PLUS an accepted care relationship
create or replace function public.can_read_patient(p_patient uuid) returns boolean
language sql stable security definer set search_path = public as
$$ select p_patient = auth.uid()
     or exists (select 1 from public.consents c
                where c.patient_id = p_patient and c.active and 'reports' = any (c.scopes)
                  and c.hospital_id = public.my_approved_hospital())
     or public.is_connected_doctor(p_patient) $$;

alter table public.care_requests enable row level security;
drop policy if exists care_requests_read on public.care_requests;
create policy care_requests_read on public.care_requests for select to authenticated
  using (patient_id = auth.uid() or public.active_doctor_user(doctor_id) = auth.uid() or public.is_authority());
drop policy if exists care_requests_insert on public.care_requests;
create policy care_requests_insert on public.care_requests for insert to authenticated with check (patient_id = auth.uid());

-- ---------------------------------------------------------------- messaging (within an accepted relationship)
create table if not exists public.messages (
  id uuid primary key default gen_random_uuid(),
  request_id uuid not null references public.care_requests (id) on delete cascade,
  sender_id uuid not null references public.profiles (id) on delete cascade,
  recipient_id uuid not null references public.profiles (id) on delete cascade,
  body text not null check (char_length(trim(body)) between 1 and 2000),
  client_id text check (char_length(client_id) <= 64),
  created_at timestamptz not null default now(),
  read_at timestamptz,
  unique (sender_id, client_id)   -- a retried send with the same client id is stored once
);
create index if not exists idx_messages_thread on public.messages (request_id, created_at);
create index if not exists idx_messages_unread on public.messages (recipient_id) where read_at is null;

create or replace function public.message_before_insert() returns trigger
language plpgsql security definer set search_path = public as $$
declare r public.care_requests; doc uuid;
begin
  select * into r from public.care_requests where id = new.request_id;
  if not found or r.status <> 'accepted' then raise exception 'Messages can only be sent within an accepted connection' using errcode = '42501'; end if;
  doc := public.active_doctor_user(r.doctor_id);
  if doc is null then raise exception 'This doctor is not currently verified' using errcode = '42501'; end if;
  if auth.uid() = r.patient_id then new.recipient_id := doc;
  elsif auth.uid() = doc then new.recipient_id := r.patient_id;
  else raise exception 'You are not part of this conversation' using errcode = '42501'; end if;
  new.sender_id := auth.uid(); new.read_at := null; new.created_at := now(); new.body := trim(new.body);
  return new;
end $$;
create or replace function public.message_after_insert() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  perform public.notify(new.recipient_id, 'message', 'New message', left(new.body, 80), '/messages');
  return new;
end $$;
drop trigger if exists trg_message_bi on public.messages;
create trigger trg_message_bi before insert on public.messages for each row execute function public.message_before_insert();
drop trigger if exists trg_message_ai on public.messages;
create trigger trg_message_ai after insert on public.messages for each row execute function public.message_after_insert();

create or replace function public.mark_messages_read(p_request uuid) returns integer
language plpgsql security definer set search_path = public as $$
declare n integer;
begin
  update public.messages set read_at = now() where request_id = p_request and recipient_id = auth.uid() and read_at is null;
  get diagnostics n = row_count; return n;
end $$;

alter table public.messages enable row level security;
drop policy if exists messages_read on public.messages;
create policy messages_read on public.messages for select to authenticated using (sender_id = auth.uid() or recipient_id = auth.uid());
drop policy if exists messages_insert on public.messages;
create policy messages_insert on public.messages for insert to authenticated with check (sender_id = auth.uid());

-- ---------------------------------------------------------------- alerts: resolution + connected doctors
alter table public.alerts add column if not exists resolved_at timestamptz;
alter table public.alerts add column if not exists resolved_by uuid references public.profiles (id);
alter table public.alerts add column if not exists resolution_note text check (char_length(resolution_note) <= 1000);

create or replace function public.resolve_alert(p_alert uuid, p_note text) returns public.alerts
language plpgsql security definer set search_path = public as $$
declare a public.alerts;
begin
  select * into a from public.alerts where id = p_alert for update;
  if not found or not public.can_read_patient(a.patient_id) or public.my_role()::text not in ('hospital_staff', 'doctor') then
    raise exception 'Alert not found or not permitted' using errcode = '42501';
  end if;
  if char_length(trim(coalesce(p_note, ''))) < 5 then raise exception 'Add a short resolution note (at least 5 characters)' using errcode = '22023'; end if;
  update public.alerts set acknowledged_at = coalesce(acknowledged_at, now()), acknowledged_by = coalesce(acknowledged_by, auth.uid()),
    resolved_at = coalesce(resolved_at, now()), resolved_by = coalesce(resolved_by, auth.uid()), resolution_note = coalesce(resolution_note, trim(p_note))
   where id = p_alert returning * into a;
  perform public.notify(a.patient_id, 'alert', 'A clinician reviewed your simulated alert', left(trim(p_note), 200), '/alerts');
  perform public.audit('alert.resolved', 'alerts', p_alert::text, '{}'::jsonb);
  return a;
end $$;

-- connected doctors are notified of alerts too (once per alert, even if also on a consented care team)
create or replace function public.alert_notify_connected_doctors() returns trigger
language plpgsql security definer set search_path = public as $$
declare u uuid;
begin
  for u in select distinct public.active_doctor_user(r.doctor_id) from public.care_requests r
           where r.patient_id = new.patient_id and r.status = 'accepted' loop
    if u is not null and not exists (select 1 from public.notifications where user_id = u and link = '/alerts/' || new.id) then
      perform public.notify(u, 'alert', 'Simulated monitoring alert: ' || new.category::text, left(new.explanation, 300), '/alerts/' || new.id);
    end if;
  end loop;
  return new;
end $$;
drop trigger if exists trg_alert_connected on public.alerts;
create trigger trg_alert_connected after insert on public.alerts for each row execute function public.alert_notify_connected_doctors();

-- ---------------------------------------------------------------- prescriptions (clinician-entered only)
create table if not exists public.prescriptions (
  id uuid primary key default gen_random_uuid(),
  patient_id uuid not null references public.profiles (id) on delete cascade,
  doctor_id uuid not null references public.doctors (id),
  prescribed_by uuid not null references public.profiles (id),
  medicine text not null check (char_length(trim(medicine)) between 2 and 200),
  dose_text text not null check (char_length(trim(dose_text)) between 1 and 200),
  instructions text check (char_length(instructions) <= 1000),
  start_date date not null default current_date,
  end_date date,
  status text not null default 'active' check (status in ('active', 'stopped')),
  is_demo_record boolean not null default true,
  created_at timestamptz not null default now(),
  check (end_date is null or end_date >= start_date)
);
create index if not exists idx_prescriptions_patient on public.prescriptions (patient_id, created_at desc);

create or replace function public.prescription_before_insert() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if public.my_role()::text <> 'doctor' or not public.is_connected_doctor(new.patient_id) then
    raise exception 'Only a verified doctor connected to this patient can enter prescriptions' using errcode = '42501';
  end if;
  new.doctor_id := public.my_doctor_id(); new.prescribed_by := auth.uid(); new.status := 'active'; new.is_demo_record := true;
  return new;
end $$;
create or replace function public.prescription_after_insert() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  perform public.notify(new.patient_id, 'prescription', 'New prescription entered by your doctor', new.medicine, '/medicines');
  perform public.audit('prescription.created', 'prescriptions', new.id::text, jsonb_build_object('patient', new.patient_id));
  return new;
end $$;
drop trigger if exists trg_rx_bi on public.prescriptions;
create trigger trg_rx_bi before insert on public.prescriptions for each row execute function public.prescription_before_insert();
drop trigger if exists trg_rx_ai on public.prescriptions;
create trigger trg_rx_ai after insert on public.prescriptions for each row execute function public.prescription_after_insert();

create or replace function public.stop_prescription(p_rx uuid) returns public.prescriptions
language plpgsql security definer set search_path = public as $$
declare x public.prescriptions;
begin
  update public.prescriptions set status = 'stopped' where id = p_rx and prescribed_by = auth.uid() and status = 'active' returning * into x;
  if not found then raise exception 'Prescription not found or not yours to change' using errcode = '42501'; end if;
  perform public.notify(x.patient_id, 'prescription', 'A prescription was marked as stopped by your doctor', x.medicine, '/medicines');
  perform public.audit('prescription.stopped', 'prescriptions', p_rx::text, '{}'::jsonb);
  return x;
end $$;

alter table public.prescriptions enable row level security;
drop policy if exists rx_read on public.prescriptions;
create policy rx_read on public.prescriptions for select to authenticated
  using (patient_id = auth.uid() or prescribed_by = auth.uid() or public.is_connected_doctor(patient_id));
drop policy if exists rx_insert on public.prescriptions;
create policy rx_insert on public.prescriptions for insert to authenticated with check (prescribed_by = auth.uid());

-- ---------------------------------------------------------------- medication reminders (persisted schedule)
create table if not exists public.medication_reminders (
  id uuid primary key default gen_random_uuid(),
  patient_id uuid not null references public.profiles (id) on delete cascade,
  prescription_id uuid not null references public.prescriptions (id) on delete cascade,
  times text[] not null check (array_length(times, 1) between 1 and 6),
  active boolean not null default true,
  created_at timestamptz not null default now(),
  unique (prescription_id)
);
create or replace function public.reminder_guard() returns trigger
language plpgsql security definer set search_path = public as $$
declare t text;
begin
  new.patient_id := auth.uid();
  if not exists (select 1 from public.prescriptions where id = new.prescription_id and patient_id = auth.uid()) then
    raise exception 'You can only set reminders for your own prescriptions' using errcode = '42501';
  end if;
  foreach t in array new.times loop
    if t !~ '^([01][0-9]|2[0-3]):[0-5][0-9]$' then raise exception 'Reminder times must be HH:MM (24-hour)' using errcode = '22023'; end if;
  end loop;
  return new;
end $$;
drop trigger if exists trg_reminder on public.medication_reminders;
create trigger trg_reminder before insert or update on public.medication_reminders for each row execute function public.reminder_guard();
create table if not exists public.reminder_doses (
  reminder_id uuid not null references public.medication_reminders (id) on delete cascade,
  due_date date not null,
  slot text not null check (slot ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$'),
  taken_at timestamptz not null default now(),
  primary key (reminder_id, due_date, slot)
);
alter table public.medication_reminders enable row level security;
alter table public.reminder_doses enable row level security;
drop policy if exists reminders_own on public.medication_reminders;
create policy reminders_own on public.medication_reminders for all to authenticated using (patient_id = auth.uid()) with check (patient_id = auth.uid());
drop policy if exists doses_own on public.reminder_doses;
create policy doses_own on public.reminder_doses for all to authenticated
  using (exists (select 1 from public.medication_reminders m where m.id = reminder_id and m.patient_id = auth.uid()))
  with check (exists (select 1 from public.medication_reminders m where m.id = reminder_id and m.patient_id = auth.uid()));

-- ---------------------------------------------------------------- reviews (completed appointments only)
create table if not exists public.reviews (
  id uuid primary key default gen_random_uuid(),
  appointment_id uuid not null unique references public.appointments (id) on delete cascade,
  patient_id uuid not null references public.profiles (id) on delete cascade,
  doctor_id uuid not null references public.doctors (id) on delete cascade,
  rating integer not null check (rating between 1 and 5),
  body text check (char_length(body) <= 600),
  hidden boolean not null default false,
  created_at timestamptz not null default now()
);
create or replace function public.review_before_insert() returns trigger
language plpgsql security definer set search_path = public as $$
declare a public.appointments;
begin
  select * into a from public.appointments where id = new.appointment_id;
  if not found or a.patient_id <> auth.uid() then raise exception 'You can only review your own appointments' using errcode = '42501'; end if;
  if a.status <> 'completed' then raise exception 'Reviews are only possible after a completed appointment' using errcode = '22023'; end if;
  new.patient_id := auth.uid(); new.doctor_id := a.doctor_id; new.hidden := false;
  return new;
end $$;
drop trigger if exists trg_review_bi on public.reviews;
create trigger trg_review_bi before insert on public.reviews for each row execute function public.review_before_insert();
alter table public.reviews enable row level security;
drop policy if exists reviews_read on public.reviews;
create policy reviews_read on public.reviews for select to authenticated
  using (patient_id = auth.uid() or (not hidden and public.active_doctor_user(doctor_id) is not null) or public.is_authority());
drop policy if exists reviews_insert on public.reviews;
create policy reviews_insert on public.reviews for insert to authenticated with check (patient_id = auth.uid());

-- ---------------------------------------------------------------- AI: rate limit + history opt-in
alter table public.profiles add column if not exists ai_history_opt_in boolean not null default false;
create table if not exists public.ai_usage (
  id bigint generated always as identity primary key,
  user_id uuid not null references public.profiles (id) on delete cascade,
  at timestamptz not null default now()
);
create index if not exists idx_ai_usage on public.ai_usage (user_id, at);
alter table public.ai_usage enable row level security;
-- counts and records one assistant call; refuses beyond p_limit calls per rolling hour
create or replace function public.ai_rate_check(p_limit integer default 20) returns integer
language plpgsql security definer set search_path = public as $$
declare n integer;
begin
  if auth.uid() is null then raise exception 'Sign in to use the assistant' using errcode = '42501'; end if;
  select count(*) into n from public.ai_usage where user_id = auth.uid() and at > now() - interval '1 hour';
  if n >= least(greatest(p_limit, 1), 100) then raise exception 'Assistant limit reached (% questions per hour). Please try again later.', least(greatest(p_limit, 1), 100) using errcode = '54000'; end if;
  insert into public.ai_usage (user_id) values (auth.uid());
  return n + 1;
end $$;

-- doctors may read the NAME of patients who sent them an open request (session data still needs acceptance)
drop policy if exists profiles_read on public.profiles;
create policy profiles_read on public.profiles for select to authenticated
  using (id = auth.uid() or public.is_authority() or (role = 'patient' and public.can_read_patient(id))
         or (hospital_id is not null and hospital_id = public.my_hospital_id())
         or exists (select 1 from public.care_requests r where r.patient_id = profiles.id and r.status in ('pending', 'accepted')
                    and public.active_doctor_user(r.doctor_id) = auth.uid()));

-- ---------------------------------------------------------------- privileges and real-time
grant select, insert on public.care_requests, public.messages, public.prescriptions, public.reviews to authenticated;
grant select, insert, update, delete on public.medication_reminders, public.reminder_doses to authenticated;
revoke update, delete on public.care_requests, public.messages, public.prescriptions, public.reviews from authenticated;
revoke all on public.ai_usage from authenticated, anon;
revoke all on public.care_requests, public.messages, public.prescriptions, public.reviews, public.medication_reminders, public.reminder_doses from anon;
revoke execute on function public.active_doctor_user(uuid), public.is_connected_doctor(uuid) from public, anon;
-- Row-level security policies call these two helpers as the signed-in user, so authenticated users
-- must be able to execute them (they only reveal the caller's own relationships and a doctor's account id).
grant execute on function public.active_doctor_user(uuid), public.is_connected_doctor(uuid) to authenticated;
grant execute on function public.respond_care_request(uuid, boolean, text), public.end_care_request(uuid), public.mark_messages_read(uuid),
  public.resolve_alert(uuid, text), public.stop_prescription(uuid), public.ai_rate_check(integer), public.my_doctor_id() to authenticated;
do $$ declare t text; begin
  foreach t in array array['care_requests', 'messages', 'prescriptions', 'notifications', 'appointments', 'alerts'] loop
    if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = t) then
      execute format('alter publication supabase_realtime add table public.%I', t);
    end if;
  end loop;
end $$;


-- ======================== 0004_breatheguard_health.sql ========================
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


-- ======================== 0005_breatheguard_authority_access.sql ========================
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


-- ======================== 0006_breatheguard_body_model.sql ========================
-- BreatheGuard 0006: the patient's chosen body model for the 3D breathing view (female | male).
-- Chosen by the patient at registration or on the 3D view; never inferred from a name. Safe to re-run.
alter table public.profiles add column if not exists body_model text check (body_model in ('female', 'male'));

-- Copy the choice from sign-up metadata after the profile is created (fires after on_auth_user_created).
create or replace function public.apply_body_model() returns trigger
language plpgsql security definer set search_path = public as $$
declare bm text := lower(coalesce(new.raw_user_meta_data ->> 'body_model', ''));
begin
  if bm in ('female', 'male') then update public.profiles set body_model = bm where id = new.id; end if;
  return new;
end $$;
drop trigger if exists zz_apply_body_model on auth.users;
create trigger zz_apply_body_model after insert on auth.users for each row execute function public.apply_body_model();
notify pgrst, 'reload schema';
