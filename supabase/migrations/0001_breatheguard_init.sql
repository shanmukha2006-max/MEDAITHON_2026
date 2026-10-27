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
