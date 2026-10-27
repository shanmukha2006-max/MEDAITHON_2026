import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createSeed } from '../src/data/seed.js';
import * as A from '../src/data/actions.js';

const S = () => createSeed();
const user = (s, id) => s.users.find((u) => u.id === id);
const authority = (s) => user(s, 'u_auth1');

test('a hospital cannot approve itself', () => {
  const s = S();
  assert.throws(() => A.decideHospital(s, user(s, 'u_hosp2'), { hospitalId: 'h_northgate', decision: 'approved', reason: 'We are great, trust us' }), A.PermissionError);
});

test('hospital cannot smuggle a status change through resubmission', () => {
  const s = S();
  const { state } = A.resubmitHospital(s, user(s, 'u_hosp2'), { hospitalId: 'h_northgate', changes: { status: 'approved', city: 'Newtown' } });
  const h = state.hospitals.find((x) => x.id === 'h_northgate');
  assert.equal(h.status, 'pending');
  assert.equal(h.city, 'Newtown');
});

test('new hospital registrations always start pending', () => {
  const s = S();
  const { state, result } = A.registerHospital(s, null, { adminName: 'X', email: 'x@demo.test', password: 'secret1', hospital: { name: 'X Demo', city: 'Y', registrationNo: 'DEMO-H-9', status: 'approved' } });
  assert.equal(state.hospitals.find((h) => h.id === result.hospitalId).status, 'pending');
});

test('authority decisions require a reason and are audited', () => {
  const s = S();
  assert.throws(() => A.decideHospital(s, authority(s), { hospitalId: 'h_northgate', decision: 'approved', reason: '' }), A.ValidationError);
  const { state } = A.decideHospital(s, authority(s), { hospitalId: 'h_northgate', decision: 'approved', reason: 'Demo documents checked.' });
  assert.equal(state.audit[0].targetId, 'h_northgate');
  assert.equal(state.audit[0].to, 'approved');
  assert.equal(state.audit[0].actorRole, 'authority');
});

test('approving a hospital does not verify its doctors', () => {
  const s = S();
  const { state } = A.decideHospital(s, authority(s), { hospitalId: 'h_northgate', decision: 'approved', reason: 'Demo documents checked.' });
  assert.equal(state.doctors.find((d) => d.id === 'd_park').status, 'pending');
  assert.ok(!A.visibleDoctors(state).some((d) => d.id === 'd_park'));
});

test('a doctor cannot be approved while their hospital is unapproved', () => {
  const s = S();
  assert.throws(() => A.decideDoctor(s, authority(s), { doctorId: 'd_park', decision: 'approved', reason: 'Credential looks fine.' }), /hospital is not approved/);
});

test('only approved hospitals and doctors appear in the patient directory', () => {
  const s = S();
  assert.deepEqual(A.visibleHospitals(s).map((h) => h.id).sort(), ['h_cedar', 'h_riverside']);
  assert.ok(!A.visibleDoctors(s).some((d) => d.id === 'd_nair'));
  const { state } = A.decideHospital(s, authority(s), { hospitalId: 'h_riverside', decision: 'suspended', reason: 'Demo complaint under investigation.' });
  assert.ok(!A.visibleDoctors(state).some((d) => d.hospitalId === 'h_riverside'));
});

test('reviews: completed appointments only, one per appointment', () => {
  const s = S();
  const pat = user(s, 'u_pat1');
  assert.throws(() => A.submitReview(s, pat, { appointmentId: 'a3', rating: 5, comment: '' }), /completed/);
  assert.throws(() => A.submitReview(s, pat, { appointmentId: 'a1', rating: 4, comment: '' }), /already reviewed/);
  assert.throws(() => A.submitReview(s, pat, { appointmentId: 'a4', rating: 4, comment: '' }), A.PermissionError);
  const { state } = A.submitReview(s, pat, { appointmentId: 'a2', rating: 4, comment: 'Good' });
  assert.equal(A.doctorRating(state, 'd_adeyemi').count, 1);
});

test('hospitals cannot see reports without consent; consent can be revoked', () => {
  const s = S();
  assert.equal(A.hasConsent(s, 'u_pat1', 'h_riverside', 'reports'), true);
  assert.equal(A.hasConsent(s, 'u_pat1', 'h_cedar', 'reports'), false);
  const { state } = A.setConsent(s, user(s, 'u_pat1'), { hospitalId: 'h_riverside', scopes: [] });
  assert.equal(A.hasConsent(state, 'u_pat1', 'h_riverside', 'reports'), false);
  assert.throws(() => A.setConsent(s, user(s, 'u_hosp1'), { hospitalId: 'h_riverside', scopes: ['reports'] }), A.PermissionError);
});

test('hiding a reported review removes it from the rating', () => {
  const s = S();
  assert.equal(A.doctorRating(s, 'd_lin').count, 2);
  const { state } = A.resolveComplaint(s, authority(s), { complaintId: 'cmp1', action: 'hide_review', reason: 'Abusive language breaches review policy.' });
  assert.equal(A.doctorRating(state, 'd_lin').count, 1);
});

test('duplicate registration numbers are surfaced as suspicious', () => {
  assert.ok(A.suspiciousSignals(S()).some((x) => x.kind === 'Duplicate hospital registration number'));
});


test('saved data with missing sections is repaired instead of breaking pages', async () => {
  const { repairState } = await import('../src/data/repair.js');
  const seed = S();
  const { complaints, doseLog, baselines, ...partial } = seed;
  const r = repairState(partial);
  assert.equal(r.repaired, true);
  assert.deepEqual(r.state.complaints, []);
  assert.deepEqual(r.state.doseLog, {});
  assert.deepEqual(r.state.baselines, {});
  assert.equal(r.state.hospitals.length, seed.hospitals.length, 'existing records are kept');
  assert.equal(repairState({ users: [] }).state.users.length, seed.users.length, 'unusable core falls back to the demo seed');
  assert.equal(repairState(null).repaired, true);
  assert.equal(repairState(seed).repaired, false, 'healthy data is left untouched');
});
