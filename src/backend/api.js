// All BreatheGuard database calls. Every function takes the Supabase client first,
// so it can be tested against a real database. Permissions are enforced by the
// database (row-level security); these functions never decide access themselves.
export class BackendError extends Error {
  constructor(message, code, cause) { super(message); this.code = code; this.cause = cause; }
}

export function friendly(error, context = '') {
  const code = error?.code || error?.status || '';
  const msg = String(error?.message || error || '');
  let text;
  // The database's own explanations are the most useful message, so they come first.
  const specific = /Only patients can send|not currently verified|not addressed to you|already been|accepted connection|not part of this conversation|Only a verified doctor connected|own prescriptions|HH:MM|completed appointment|your own appointments|limit reached|resolution note|reason of at least|Cannot change status|Cannot move an appointment|must be approved|Only the healthcare authority|Only hospital staff|already linked|only be changed by|hospital is not approved|not found or not permitted/i;
  if (/uq_care_request_open/.test(msg)) text = 'You already have an open request with this doctor.';
  else if (/reviews_appointment_id_key/.test(msg)) text = 'You have already reviewed this appointment.';
  else if (specific.test(msg)) text = msg;
  else if (code === '42501' || /row-level security|permission denied/i.test(msg)) text = 'You do not have permission to do that.';
  else if (/JWT|token is expired|PGRST301/i.test(msg) || code === 'PGRST301') text = 'Your sign-in has expired. Please sign in again.';
  else if (/Failed to fetch|NetworkError|fetch failed|ECONNREFUSED|ENOTFOUND/i.test(msg)) text = 'Cannot reach the server. Check your internet connection and try again.';
  else if (/Invalid login credentials/i.test(msg)) text = 'Email or password is incorrect.';
  else if (/already registered|User already registered/i.test(msg)) text = 'An account with this email already exists.';
  else if (code === '22023' || code === 'P0002') text = msg;
  else text = msg || 'Something went wrong.';
  return new BackendError(context ? `${context}: ${text}` : text, code, error);
}

const run = async (promise, context) => {
  let res;
  try { res = await promise; } catch (e) { throw friendly(e, context); }
  if (res?.error) throw friendly(res.error, context);
  return res?.data;
};

// ---------- auth ----------
export const SELF_SERVICE_ROLES = ['patient', 'hospital_staff', 'doctor']; // never 'authority': see bootstrap_authority
export async function signUp(sb, { email, password, fullName, role, bodyModel }) {
  if (!SELF_SERVICE_ROLES.includes(role)) throw new BackendError('Only patient, hospital staff or doctor accounts can be created here.');
  if (!email || !password || password.length < 8) throw new BackendError('Enter an email and a password of at least 8 characters.');
  return run(sb.auth.signUp({ email, password, options: { data: { role, full_name: fullName || '', ...(role === 'patient' && ['female', 'male'].includes(bodyModel) ? { body_model: bodyModel } : {}) } } }), 'Could not create the account');
}
export const signIn = (sb, { email, password }) => run(sb.auth.signInWithPassword({ email, password }), 'Could not sign in');
export const signOut = (sb) => run(sb.auth.signOut(), 'Could not sign out');
export const getProfile = (sb, userId) => run(sb.from('profiles').select('*').eq('id', userId).single(), 'Could not load your profile');

// ---------- hospitals, doctors, consent ----------
export const listApprovedHospitals = (sb) => run(sb.from('hospitals').select('id, name, city, status').eq('status', 'approved').order('name'), 'Could not load hospitals');
export const getHospital = (sb, id) => run(sb.from('hospitals').select('*').eq('id', id).single(), 'Could not load the hospital');
export const createHospital = (sb, { name, city, registrationNo }) => run(sb.from('hospitals').insert({ name, city, registration_no: registrationNo }).select().single(), 'Could not submit the application');
export const listDoctors = (sb, hospitalId) => run(sb.from('doctors').select('*').eq('hospital_id', hospitalId).order('created_at'), 'Could not load doctors');
export const submitDoctor = (sb, { fullName, specialty, licenseNo }) => run(sb.from('doctors').insert({ full_name: fullName, specialty, license_no: licenseNo }).select().single(), 'Could not submit the doctor');
// Patient-controlled sharing with the healthcare authority (read-only, audited, revocable).
export const getAuthorityAccess = async (sb, patientId) => (await run(sb.from('authority_access').select('active, updated_at').eq('patient_id', patientId).maybeSingle(), 'Could not load authority sharing')) || { active: false };
export const setAuthorityAccess = (sb, patientId, active) => run(sb.from('authority_access').upsert({ patient_id: patientId, active }, { onConflict: 'patient_id' }).select().single(), 'Could not update authority sharing');
export const listConsents = (sb) => run(sb.from('consents').select('*'), 'Could not load sharing settings');
export const setConsent = (sb, { patientId, hospitalId, scopes }) => run(
  sb.from('consents').upsert({ patient_id: patientId, hospital_id: hospitalId, scopes, active: scopes.length > 0 }, { onConflict: 'patient_id,hospital_id' }).select().single(),
  'Could not update sharing');

// ---------- authority ----------
export const listForReview = async (sb) => ({
  hospitals: await run(sb.from('hospitals').select('*').order('created_at', { ascending: false }), 'Could not load applications'),
  doctors: await run(sb.from('doctors').select('*, hospitals(name, status)').order('created_at', { ascending: false }), 'Could not load doctors'),
});
export const decideHospital = (sb, id, decision, reason) => run(sb.rpc('decide_hospital', { p_hospital: id, p_decision: decision, p_reason: reason }), 'Decision not recorded');
export const decideDoctor = (sb, id, decision, reason) => run(sb.rpc('decide_doctor', { p_doctor: id, p_decision: decision, p_reason: reason }), 'Decision not recorded');
export const listAudit = (sb, limit = 100) => run(sb.from('audit_log').select('*').order('created_at', { ascending: false }).limit(limit), 'Could not load the audit log');

// ---------- monitoring ----------
export const startSession = (sb, { patientId, patch, channels, scenarioId, seed }) => run(
  sb.from('monitoring_sessions').insert({ patient_id: patientId, patch, channels, scenario_id: scenarioId, seed }).select().single(), 'Could not start the session');
export const stopSession = (sb, id) => run(sb.from('monitoring_sessions').update({ status: 'stopped', stopped_at: new Date().toISOString() }).eq('id', id).select().single(), 'Could not stop the session');
export const listSessions = (sb, limit = 50) => run(sb.from('monitoring_sessions').select('*, profiles(full_name)').order('started_at', { ascending: false }).limit(limit), 'Could not load sessions');
// Idempotent writes: retries or duplicate events never create duplicate rows.
export const writeObservations = (sb, rows) => run(sb.from('observations').upsert(rows, { onConflict: 'session_id,seq', ignoreDuplicates: true }), 'Could not save observations');
export const writeAnalysis = (sb, rows) => run(sb.from('analysis_results').upsert(rows, { onConflict: 'session_id,window_end', ignoreDuplicates: true }), 'Could not save analysis');
export const fetchObservations = (sb, sessionId, afterSeq = -1) => run(sb.from('observations').select('*').eq('session_id', sessionId).gt('seq', afterSeq).order('seq'), 'Could not load observations');
export const fetchAnalysis = (sb, sessionId) => run(sb.from('analysis_results').select('*').eq('session_id', sessionId).order('window_end'), 'Could not load analysis');
export const fetchAlerts = (sb, sessionId) => run(sb.from('alerts').select('*').eq('session_id', sessionId).order('created_at'), 'Could not load alerts');
export const acknowledgeAlert = (sb, id) => run(sb.rpc('acknowledge_alert', { p_alert: id }), 'Could not acknowledge the alert');
export async function fetchReport(sb, { sessionId, userId }) {
  const payload = await run(sb.rpc('session_report', { p_session: sessionId }), 'Report not available');
  try { await sb.from('reports').insert({ session_id: sessionId, generated_by: userId }); } catch { /* logging the download is best-effort */ }
  return payload;
}

// Convert one engine result into a database row (only what the report and dashboard need).
export function analysisRow(sessionId, r, explanation) {
  const cq = {};
  for (const k of ['chest', 'acoustic']) { const c = r.channels[k]; cq[k] = { fitted: c.fitted !== false, usable: !!c.usable, reliable: !!c.reliable, quality: +(+c.sqi).toFixed(3), rate: c.rate == null ? null : +c.rate.toFixed(1) }; }
  cq.motion = { available: !!r.motionOk };
  return {
    session_id: sessionId, window_end: Math.round(r.t1), outcome: r.outcome,
    rate: r.rate == null ? null : +r.rate.toFixed(1), quality: +r.quality.toFixed(3), confidence: +r.confidence.toFixed(3),
    activity: r.activity.dominant, reason: String(r.reason).slice(0, 2000), explanation: explanation || {}, channel_quality: cq,
  };
}

// One observation row = one second of samples (10 per channel at 10 Hz). NaN becomes null.
export function observationRow(sessionId, data, second, channels) {
  const fs = data.fs, i0 = second * fs, i1 = i0 + fs;
  const pick = (arr) => arr.slice(i0, i1).map((v) => (Number.isFinite(v) ? +v.toFixed(4) : null));
  return {
    session_id: sessionId, seq: second, t_start: second,
    chest: channels.includes('chest') ? pick(data.chest) : null,
    acoustic: channels.includes('acoustic') ? pick(data.acoustic) : null,
    accel: channels.includes('motion') ? pick(data.accel) : null,
    tilt: channels.includes('motion') ? pick(data.tilt) : null,
  };
}

// AI assistant: runs as a server-side Edge Function holding the provider key.
export async function askAssistant(sb, { question, sessionId, prescriptionId }) {
  try {
    const { data, error } = await sb.functions.invoke('ai-assistant', { body: { question, sessionId, prescriptionId } });
    if (error) {
      const status = error?.context?.status;
      if (status === 404) return { configured: false, message: 'The AI assistant is not deployed yet. See docs/BACKEND_SETUP.md, step 6.' };
      let body = null; try { body = await error.context.json(); } catch { /* not json */ }
      if (body?.configured === false) return { configured: false, message: body.message };
      throw friendly(body?.error ? { message: body.error } : error, 'Assistant unavailable');
    }
    return data;
  } catch (e) {
    if (e instanceof BackendError) throw e;
    throw friendly(e, 'Assistant unavailable');
  }
}

// ---------- Part 7: accounts ----------
export const ACCOUNT_TYPES = ['patient', 'hospital_staff', 'doctor'];
export const requestPasswordReset = (sb, email, redirectTo) => run(sb.auth.resetPasswordForEmail(email, { redirectTo }), 'Could not send the reset email');
export async function updatePassword(sb, password) {
  if (!password || password.length < 8) throw new BackendError('Use a password of at least 8 characters.');
  return run(sb.auth.updateUser({ password }), 'Could not change the password');
}
export const updateProfile = (sb, id, { fullName, baselineRate, baselineSd }) => run(
  sb.from('profiles').update({ full_name: fullName, baseline_rate: baselineRate, baseline_sd: baselineSd }).eq('id', id).select().single(), 'Could not save your profile');

// ---------- directory, doctors ----------
export async function listDirectory(sb) {
  const hospitals = await run(sb.from('hospitals').select('id, name, city').eq('status', 'approved').order('name'), 'Could not load hospitals');
  const doctors = await run(sb.from('doctors').select('id, full_name, specialty, hospital_id, status').eq('status', 'approved').order('full_name'), 'Could not load doctors');
  const ok = new Set(hospitals.map((h) => h.id));
  return { hospitals, doctors: doctors.filter((d) => ok.has(d.hospital_id)) };
}
export const linkDoctorAccount = (sb, doctorId, email) => run(sb.rpc('link_doctor_account', { p_doctor: doctorId, p_email: email }), 'Could not link the account');
export const myDoctorRecord = (sb, userId) => run(sb.from('doctors').select('*, hospitals(name, status)').eq('user_id', userId).maybeSingle(), 'Could not load your doctor record');

// ---------- appointments ----------
export const listAppointments = (sb) => run(sb.from('appointments').select('*, doctors(full_name, specialty), hospitals(name), profiles(full_name)').order('requested_for'), 'Could not load appointments');
export function requestAppointment(sb, { patientId, doctorId, hospitalId, when, reason }) {
  if (!when || Number.isNaN(Date.parse(when))) throw new BackendError('Choose a date and time.');
  if (new Date(when) <= new Date()) throw new BackendError('Choose a time in the future.');
  return run(sb.from('appointments').insert({ patient_id: patientId, doctor_id: doctorId, hospital_id: hospitalId, requested_for: new Date(when).toISOString(), reason }).select().single(), 'Could not request the appointment');
}
export const setAppointmentStatus = (sb, id, status) => run(sb.rpc('set_appointment_status', { p_appt: id, p_status: status }), 'Could not update the appointment');
export const rescheduleAppointment = (sb, id, when, note) => run(sb.rpc('reschedule_appointment', { p_appt: id, p_time: new Date(when).toISOString(), p_note: note || null }), 'Could not reschedule');
export const listAppointmentEvents = (sb, id) => run(sb.from('appointment_events').select('*').eq('appointment_id', id).order('id'), 'Could not load the history');

// ---------- notifications, alerts ----------
export const listNotifications = (sb, limit = 30) => run(sb.from('notifications').select('*').order('created_at', { ascending: false }).limit(limit), 'Could not load notifications');
export const markNotificationsRead = (sb, ids) => (ids.length ? run(sb.from('notifications').update({ read_at: new Date().toISOString() }).in('id', ids), 'Could not update notifications') : null);
export const listAllAlerts = (sb, limit = 100) => run(sb.from('alerts').select('*, monitoring_sessions(patch, scenario_id, started_at, profiles(full_name))').order('created_at', { ascending: false }).limit(limit), 'Could not load alerts');
export const getAlertSettings = (sb) => run(sb.from('alert_settings').select('*').single(), 'Could not load alert rules');
export const updateAlertSettings = (sb, minWindows, onInsufficient, reason) => run(sb.rpc('update_alert_settings', { p_min_windows: minWindows, p_on_insufficient: onInsufficient, p_reason: reason }), 'Could not update alert rules');

// ---------- administrators ----------
export const listAdministrators = (sb) => run(sb.from('profiles').select('id, full_name, created_at').eq('role', 'authority'), 'Could not load administrators');
export const setAuthority = (sb, email, grant, reason) => run(sb.rpc('set_authority', { p_email: email, p_grant: grant, p_reason: reason }), 'Could not change administrator rights');

// ---------- AI history, report log ----------
export const listAiHistory = (sb, userId) => run(sb.from('ai_messages').select('*').eq('user_id', userId).order('created_at').limit(50), 'Could not load the conversation');
export const clearAiHistory = (sb, userId) => run(sb.from('ai_messages').delete().eq('user_id', userId), 'Could not clear the conversation');
export const logReport = (sb, { id, sessionId, userId, format, fileName, size }) => run(sb.from('reports').insert({ id, session_id: sessionId, generated_by: userId, format, file_name: fileName, size_bytes: size }), 'Report was generated but could not be logged');

// ---------- Part 8: connections, messaging, alerts, prescriptions, reminders, reviews ----------
const CR = 'id, status, message, created_at, decided_at, decision_note, patient_id, doctor_id, patient:profiles!care_requests_patient_id_fkey(full_name), doctors(full_name, specialty, user_id, hospitals(name))';
export const listCareRequests = (sb) => run(sb.from('care_requests').select(CR).order('created_at', { ascending: false }), 'Could not load connections');
export const requestConnection = (sb, { patientId, doctorId, message }) => run(sb.from('care_requests').insert({ patient_id: patientId, doctor_id: doctorId, message: message || null }).select('id, status').single(), 'Could not send the request');
export const respondConnection = (sb, id, accept, note) => run(sb.rpc('respond_care_request', { p_request: id, p_accept: accept, p_note: note || null }), 'Could not record the decision');
export const endConnection = (sb, id) => run(sb.rpc('end_care_request', { p_request: id }), 'Could not update the connection');
export const listMessages = (sb, requestId) => run(sb.from('messages').select('*').eq('request_id', requestId).order('created_at'), 'Could not load messages');
export const sendMessage = (sb, { requestId, senderId, body, clientId }) => run(sb.from('messages').upsert({ request_id: requestId, sender_id: senderId, recipient_id: senderId, body, client_id: clientId }, { onConflict: 'sender_id,client_id', ignoreDuplicates: true }), 'Message not sent');
export const markRead = (sb, requestId) => run(sb.rpc('mark_messages_read', { p_request: requestId }), 'Could not mark as read');
export const unreadByThread = async (sb, userId) => {
  const rows = await run(sb.from('messages').select('request_id').eq('recipient_id', userId).is('read_at', null), 'Could not load unread messages');
  return rows.reduce((m, r) => ({ ...m, [r.request_id]: (m[r.request_id] || 0) + 1 }), {});
};
export const resolveAlert = (sb, id, note) => run(sb.rpc('resolve_alert', { p_alert: id, p_note: note }), 'Could not resolve the alert');
export const listPrescriptions = (sb) => run(sb.from('prescriptions').select('*, doctors(full_name), patient:profiles!prescriptions_patient_id_fkey(full_name)').order('created_at', { ascending: false }), 'Could not load prescriptions');
export const createPrescription = (sb, { patientId, userId, medicine, doseText, instructions, endDate }) => run(sb.from('prescriptions').insert({ patient_id: patientId, doctor_id: '00000000-0000-0000-0000-000000000000', prescribed_by: userId, medicine, dose_text: doseText, instructions: instructions || null, end_date: endDate || null }).select().single(), 'Could not save the prescription');
export const stopPrescription = (sb, id) => run(sb.rpc('stop_prescription', { p_rx: id }), 'Could not stop the prescription');
export const listReminders = (sb) => run(sb.from('medication_reminders').select('*, reminder_doses(due_date, slot, taken_at)'), 'Could not load reminders');
export const setReminder = (sb, { patientId, prescriptionId, times }) => run(sb.from('medication_reminders').upsert({ patient_id: patientId, prescription_id: prescriptionId, times, active: true }, { onConflict: 'prescription_id' }).select().single(), 'Could not save the reminder');
export const takeDose = (sb, { reminderId, dueDate, slot }) => run(sb.from('reminder_doses').upsert({ reminder_id: reminderId, due_date: dueDate, slot }, { onConflict: 'reminder_id,due_date,slot', ignoreDuplicates: true }), 'Could not record the dose');
export const listMyReviews = (sb, userId) => run(sb.from('reviews').select('*').eq('patient_id', userId), 'Could not load reviews');
export const submitReview = (sb, { appointmentId, userId, rating, body }) => run(sb.from('reviews').insert({ appointment_id: appointmentId, patient_id: userId, doctor_id: '00000000-0000-0000-0000-000000000000', rating, body: body || null }).select().single(), 'Could not save the review');
export const setAiHistoryOptIn = (sb, userId, on) => run(sb.from('profiles').update({ ai_history_opt_in: on }).eq('id', userId).select('ai_history_opt_in').single(), 'Could not save the setting');

export const setBodyModelRemote = (sb, id, bodyModel) => run(sb.from('profiles').update({ body_model: bodyModel }).eq('id', id).select().single(), 'Could not save your body model');
