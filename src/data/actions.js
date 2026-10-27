// Pure state transitions with permission checks.
// IMPORTANT: in this demo these checks run in the browser, so a user could bypass them
// by editing localStorage. They demonstrate the intended rules; a real deployment must
// enforce the same rules on a server (see README → "Minimum viable backend").

export class PermissionError extends Error {}
export class ValidationError extends Error {}

const uid = (p) => `${p}_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
const now = () => new Date().toISOString();
const must = (cond, msg, E = PermissionError) => { if (!cond) throw new E(msg); };
const clone = (s) => JSON.parse(JSON.stringify(s));

export const HOSPITAL_STATUSES = ['pending', 'approved', 'rejected', 'more_info', 'suspended'];
export const STATUS_LABEL = { pending: 'Pending review', approved: 'Approved (demo)', rejected: 'Rejected', more_info: 'More information required', suspended: 'Suspended' };

// Allowed authority decisions from each status
const DECISIONS = {
  pending: ['approved', 'rejected', 'more_info'],
  more_info: ['rejected'],              // approval only after the hospital resubmits
  approved: ['suspended'],
  suspended: ['approved', 'rejected'],  // reinstate or revoke
  rejected: [],
};
export const allowedDecisions = (status) => DECISIONS[status] || [];

function audit(s, actor, action, targetType, targetId, from, to, reason) {
  s.audit.unshift({ id: uid('au'), at: now(), actorId: actor.id, actorRole: actor.role, action, targetType, targetId, from, to, reason: reason || '' });
}
function notify(s, userId, text) {
  if (userId) s.notifications.unshift({ id: uid('n'), userId, text, at: now(), read: false });
}
const requireReason = (reason) => must(typeof reason === 'string' && reason.trim().length >= 10, 'A reason of at least 10 characters is required for this decision.', ValidationError);
const hospitalOwner = (s, hospitalId) => s.hospitals.find((h) => h.id === hospitalId)?.ownerUserId;

// ---------- selectors ----------
export const isDoctorVisible = (s, doc) => doc.status === 'approved' && s.hospitals.find((h) => h.id === doc.hospitalId)?.status === 'approved';
export const visibleHospitals = (s) => s.hospitals.filter((h) => h.status === 'approved');
export const visibleDoctors = (s) => s.doctors.filter((d) => isDoctorVisible(s, d));
export function doctorRating(s, doctorId) {
  const rs = s.reviews.filter((r) => r.doctorId === doctorId && !r.hidden);
  return { count: rs.length, avg: rs.length ? rs.reduce((a, r) => a + r.rating, 0) / rs.length : null };
}
export const hasConsent = (s, patientId, hospitalId, scope) =>
  s.consents.some((c) => c.patientId === patientId && c.hospitalId === hospitalId && c.active && c.scopes.includes(scope));

export function suspiciousSignals(s) {
  const out = [];
  const byReg = {};
  s.hospitals.forEach((h) => (byReg[h.registrationNo] ||= []).push(h));
  Object.entries(byReg).forEach(([reg, hs]) => hs.length > 1 && out.push({ kind: 'Duplicate hospital registration number', detail: `${reg} used by ${hs.map((h) => h.name).join(', ')}`, ids: hs.map((h) => h.id) }));
  const byLic = {};
  s.doctors.forEach((d) => (byLic[d.licenseNo] ||= []).push(d));
  Object.entries(byLic).forEach(([lic, ds]) => ds.length > 1 && out.push({ kind: 'Duplicate doctor licence number', detail: `${lic} used by ${ds.map((d) => d.name).join(', ')}`, ids: ds.map((d) => d.id) }));
  s.hospitals.filter((h) => h.status !== 'approved' && (!h.documents || !h.documents.length)).forEach((h) => out.push({ kind: 'Application without documents', detail: h.name, ids: [h.id] }));
  const byEmail = {};
  s.users.forEach((u) => (byEmail[u.email.toLowerCase()] ||= []).push(u));
  Object.entries(byEmail).forEach(([e, us]) => us.length > 1 && out.push({ kind: 'Multiple accounts with one email', detail: e, ids: us.map((u) => u.id) }));
  return out;
}

// ---------- accounts ----------
export function registerPatient(state, _actor, { name, email, password, bodyModel }) {
  must(name?.trim() && email?.trim() && password?.length >= 6, 'Name, email and a password of at least 6 characters are required.', ValidationError);
  must(!state.users.some((u) => u.email.toLowerCase() === email.toLowerCase()), 'An account with this email already exists.', ValidationError);
  const s = clone(state);
  const user = { id: uid('u'), role: 'patient', name: name.trim(), email: email.trim(), password, bodyModel: bodyModel === 'male' ? 'male' : bodyModel === 'female' ? 'female' : undefined };
  s.users.push(user);
  s.baselines[user.id] = { rate: 14, sd: 1.5, source: 'Default demo baseline' };
  return { state: s, result: user };
}

export function registerHospital(state, _actor, { adminName, email, password, hospital }) {
  must(adminName?.trim() && email?.trim() && password?.length >= 6, 'Admin name, email and a password of at least 6 characters are required.', ValidationError);
  must(hospital?.name?.trim() && hospital?.city?.trim() && hospital?.registrationNo?.trim(), 'Hospital name, city and registration number are required.', ValidationError);
  must(!state.users.some((u) => u.email.toLowerCase() === email.toLowerCase()), 'An account with this email already exists.', ValidationError);
  const s = clone(state);
  const hId = uid('h'), userId = uid('u');
  s.users.push({ id: userId, role: 'hospital', name: adminName.trim(), email: email.trim(), password, hospitalId: hId });
  // Status is ALWAYS pending at creation, whatever the client sends.
  s.hospitals.push({ id: hId, name: hospital.name.trim(), city: hospital.city.trim(), address: hospital.address || '', registrationNo: hospital.registrationNo.trim(), contactEmail: email.trim(), beds: Number(hospital.beds) || 0, services: hospital.services || '', documents: hospital.documents || [], status: 'pending', statusReason: '', submittedAt: now(), ownerUserId: userId });
  audit(s, { id: userId, role: 'hospital' }, 'hospital.submitted', 'hospital', hId, null, 'pending', 'New application');
  return { state: s, result: { userId, hospitalId: hId } };
}

// ---------- hospital application ----------
export function resubmitHospital(state, actor, { hospitalId, changes }) {
  must(actor?.role === 'hospital' && actor.hospitalId === hospitalId, 'Only this hospital’s own administrator can edit its application.');
  const s = clone(state);
  const h = s.hospitals.find((x) => x.id === hospitalId);
  must(['pending', 'more_info'].includes(h.status), 'This application can no longer be edited.', ValidationError);
  const { status, statusReason, ownerUserId, id, ...safe } = changes || {}; // status cannot be set by the hospital
  Object.assign(h, safe, { submittedAt: now() });
  const from = h.status;
  h.status = 'pending';
  audit(s, actor, 'hospital.resubmitted', 'hospital', h.id, from, 'pending', 'Application updated by hospital');
  return { state: s };
}

export function decideHospital(state, actor, { hospitalId, decision, reason }) {
  must(actor?.role === 'authority', 'Only the healthcare authority can change a hospital’s approval status.');
  requireReason(reason);
  const s = clone(state);
  const h = s.hospitals.find((x) => x.id === hospitalId);
  must(h, 'Hospital not found.', ValidationError);
  must(allowedDecisions(h.status).includes(decision), `Cannot change status from "${STATUS_LABEL[h.status]}" to "${STATUS_LABEL[decision]}".`, ValidationError);
  const from = h.status;
  h.status = decision;
  h.statusReason = reason.trim();
  audit(s, actor, 'hospital.decision', 'hospital', h.id, from, decision, reason.trim());
  notify(s, h.ownerUserId, `Your hospital application is now: ${STATUS_LABEL[decision]}.`);
  // NB: approving a hospital does NOT approve its doctors.
  return { state: s };
}

// ---------- doctors ----------
export function submitDoctor(state, actor, { name, specialty, licenseNo, qualifications }) {
  must(actor?.role === 'hospital', 'Only hospital administrators can submit doctors.');
  const h = state.hospitals.find((x) => x.id === actor.hospitalId);
  must(h?.status === 'approved', 'Your hospital must be approved before submitting doctors.', ValidationError);
  must(name?.trim() && specialty?.trim() && licenseNo?.trim(), 'Name, specialty and licence number are required.', ValidationError);
  const s = clone(state);
  const doc = { id: uid('d'), name: name.trim(), specialty: specialty.trim(), hospitalId: h.id, licenseNo: licenseNo.trim(), qualifications: qualifications || '', status: 'pending', statusReason: '', submittedAt: now() };
  s.doctors.push(doc);
  audit(s, actor, 'doctor.submitted', 'doctor', doc.id, null, 'pending', `Submitted by ${h.name}`);
  return { state: s, result: doc };
}

export function decideDoctor(state, actor, { doctorId, decision, reason }) {
  must(actor?.role === 'authority', 'Only the healthcare authority can verify doctors.');
  requireReason(reason);
  const s = clone(state);
  const d = s.doctors.find((x) => x.id === doctorId);
  must(d, 'Doctor not found.', ValidationError);
  const allowed = { pending: ['approved', 'rejected', 'more_info'], more_info: ['approved', 'rejected'], approved: ['suspended'], suspended: ['approved', 'rejected'], rejected: [] }[d.status] || [];
  must(allowed.includes(decision), `Cannot change doctor status from "${STATUS_LABEL[d.status]}" to "${STATUS_LABEL[decision]}".`, ValidationError);
  if (decision === 'approved') must(s.hospitals.find((h) => h.id === d.hospitalId)?.status === 'approved', 'The doctor’s hospital is not approved, so the doctor cannot be approved.', ValidationError);
  const from = d.status;
  d.status = decision;
  d.statusReason = reason.trim();
  audit(s, actor, 'doctor.decision', 'doctor', d.id, from, decision, reason.trim());
  notify(s, hospitalOwner(s, d.hospitalId), `${d.name}: credential status is now ${STATUS_LABEL[decision]}.`);
  return { state: s };
}

// ---------- appointments ----------
export function requestAppointment(state, actor, { doctorId, datetime, reason }) {
  must(actor?.role === 'patient', 'Only patients can request appointments.');
  const d = state.doctors.find((x) => x.id === doctorId);
  must(d && isDoctorVisible(state, d), 'This doctor is not currently verified.', ValidationError);
  must(datetime && !Number.isNaN(Date.parse(datetime)), 'Choose a date and time.', ValidationError);
  const s = clone(state);
  const a = { id: uid('a'), patientId: actor.id, doctorId, hospitalId: d.hospitalId, datetime: new Date(datetime).toISOString(), reason: reason || '', status: 'requested', createdAt: now() };
  s.appointments.push(a);
  notify(s, actor.id, `Appointment request sent to ${d.name}.`);
  notify(s, hospitalOwner(s, d.hospitalId), `New appointment request for ${d.name}.`);
  return { state: s, result: a };
}

const APPT_FLOW = { requested: ['confirmed', 'declined', 'cancelled'], confirmed: ['completed', 'cancelled'], completed: [], declined: [], cancelled: [] };
export function updateAppointment(state, actor, { appointmentId, status }) {
  const a = state.appointments.find((x) => x.id === appointmentId);
  must(a, 'Appointment not found.', ValidationError);
  if (actor?.role === 'patient') must(a.patientId === actor.id && status === 'cancelled', 'Patients can only cancel their own appointments.');
  else must(actor?.role === 'hospital' && actor.hospitalId === a.hospitalId, 'Only the hospital that owns this appointment can update it.');
  must(APPT_FLOW[a.status].includes(status), `Cannot move an appointment from ${a.status} to ${status}.`, ValidationError);
  const s = clone(state);
  const x = s.appointments.find((y) => y.id === appointmentId);
  x.status = status;
  const doc = s.doctors.find((d) => d.id === x.doctorId);
  notify(s, x.patientId, `Your appointment with ${doc?.name} is now ${status}.${status === 'completed' ? ' You can now leave a review.' : ''}`);
  return { state: s };
}

// ---------- reviews ----------
export function submitReview(state, actor, { appointmentId, rating, comment }) {
  must(actor?.role === 'patient', 'Only patients can write reviews.');
  const a = state.appointments.find((x) => x.id === appointmentId);
  must(a && a.patientId === actor.id, 'You can only review your own appointments.');
  must(a.status === 'completed', 'Reviews are only possible after a completed appointment.', ValidationError);
  must(!state.reviews.some((r) => r.appointmentId === appointmentId), 'You have already reviewed this appointment.', ValidationError);
  must(Number.isInteger(rating) && rating >= 1 && rating <= 5, 'Rating must be 1–5 stars.', ValidationError);
  must((comment || '').length <= 600, 'Comment must be 600 characters or fewer.', ValidationError);
  const s = clone(state);
  s.reviews.push({ id: uid('r'), appointmentId, patientId: actor.id, doctorId: a.doctorId, rating, comment: (comment || '').trim(), createdAt: now(), hidden: false });
  return { state: s };
}

export function flagReview(state, actor, { reviewId, text }) {
  must(actor && ['patient', 'hospital'].includes(actor.role), 'Sign in to report a review.');
  must(state.reviews.some((r) => r.id === reviewId), 'Review not found.', ValidationError);
  must((text || '').trim().length >= 5, 'Say briefly why this review is inappropriate.', ValidationError);
  must(!state.complaints.some((c) => c.targetId === reviewId && c.byUserId === actor.id && c.status === 'open'), 'You have already reported this review.', ValidationError);
  const s = clone(state);
  s.complaints.unshift({ id: uid('cmp'), type: 'review', targetType: 'review', targetId: reviewId, text: text.trim(), byUserId: actor.id, status: 'open', createdAt: now() });
  return { state: s };
}

export function fileComplaint(state, actor, { targetType, targetId, text }) {
  must(actor?.role === 'patient', 'Only patients can file complaints in this demo.');
  must((text || '').trim().length >= 10, 'Describe the problem in at least 10 characters.', ValidationError);
  const s = clone(state);
  s.complaints.unshift({ id: uid('cmp'), type: 'complaint', targetType, targetId, text: text.trim(), byUserId: actor.id, status: 'open', createdAt: now() });
  return { state: s };
}

export function resolveComplaint(state, actor, { complaintId, action, reason }) {
  must(actor?.role === 'authority', 'Only the healthcare authority can resolve complaints.');
  requireReason(reason);
  const s = clone(state);
  const c = s.complaints.find((x) => x.id === complaintId);
  must(c && c.status === 'open', 'Complaint not found or already resolved.', ValidationError);
  if (action === 'hide_review') {
    must(c.targetType === 'review', 'Only review reports can hide a review.', ValidationError);
    const r = s.reviews.find((x) => x.id === c.targetId);
    r.hidden = true;
    r.hiddenReason = reason.trim();
  }
  c.status = action === 'dismiss' ? 'dismissed' : 'actioned';
  c.resolution = reason.trim();
  audit(s, actor, `complaint.${action}`, c.targetType, c.targetId, 'open', c.status, reason.trim());
  return { state: s };
}

// ---------- consent ----------
export function setConsent(state, actor, { hospitalId, scopes }) {
  must(actor?.role === 'patient', 'Only the patient can change their own sharing consent.');
  must(state.hospitals.some((h) => h.id === hospitalId), 'Hospital not found.', ValidationError);
  const s = clone(state);
  let c = s.consents.find((x) => x.patientId === actor.id && x.hospitalId === hospitalId);
  const before = c ? (c.active ? c.scopes.join('+') || 'none' : 'none') : 'none';
  if (!c) { c = { id: uid('c'), patientId: actor.id, hospitalId, scopes: [], active: false }; s.consents.push(c); }
  c.scopes = [...new Set(scopes)];
  c.active = c.scopes.length > 0;
  c.updatedAt = now();
  audit(s, actor, 'consent.changed', 'hospital', hospitalId, before, c.active ? c.scopes.join('+') : 'none', 'Patient changed sharing consent');
  return { state: s };
}

// ---------- reports / prescriptions ----------
export function saveReport(state, actor, report) {
  must(actor?.role === 'patient', 'Only patients can save their own monitoring reports.');
  const s = clone(state);
  const r = { ...report, id: uid('rep'), patientId: actor.id, createdAt: now() };
  s.reports.unshift(r);
  return { state: s, result: r };
}

export function setBaseline(state, actor, baseline) {
  must(actor?.role === 'patient', 'Only patients can set their own baseline.');
  must(baseline && baseline.rate >= 6 && baseline.rate <= 30, 'Baseline must be between 6 and 30 breaths/min.', ValidationError);
  const s = clone(state);
  s.baselines[actor.id] = baseline;
  return { state: s };
}

export function addPrescription(state, actor, { prescriber, items }) {
  must(actor?.role === 'patient', 'Only patients can add prescriptions to their own record.');
  must(items?.length && items.every((i) => i.name?.trim()), 'Add at least one medicine name.', ValidationError);
  const s = clone(state);
  s.prescriptions.unshift({ id: uid('p'), patientId: actor.id, prescriber: prescriber || 'Not specified', createdAt: now(), source: 'Entered by patient', items: items.map((i) => ({ ...i, id: uid('pi') })) });
  return { state: s };
}

export function toggleDose(state, actor, { key }) {
  must(actor?.role === 'patient', 'Only patients can log doses.');
  const s = clone(state);
  s.doseLog[`${actor.id}|${key}`] = !s.doseLog[`${actor.id}|${key}`];
  return { state: s };
}

export function markNotificationsRead(state, actor) {
  const s = clone(state);
  s.notifications.forEach((n) => { if (n.userId === actor.id) n.read = true; });
  return { state: s };
}

// The patient's own choice of body model for the 3D breathing view (never inferred from a name).
export function setBodyModel(state, actor, { bodyModel }) {
  must(actor?.role === 'patient', 'Only the patient can choose their body model.');
  must(['female', 'male'].includes(bodyModel), 'Choose Female or Male.', ValidationError);
  const s = clone(state);
  s.users.find((u) => u.id === actor.id).bodyModel = bodyModel;
  return { state: s };
}
