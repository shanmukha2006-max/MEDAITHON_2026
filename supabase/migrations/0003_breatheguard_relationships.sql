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
