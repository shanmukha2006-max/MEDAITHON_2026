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
