// Synthetic demo data. Every organisation, person and credential here is fictional.
// Registration numbers use the reserved "DEMO-" prefix so they cannot be mistaken for real ones.
import { getScenario } from '../sim/scenarios.js';
import { generateSession } from '../sim/generator.js';
import { analyzeSession } from '../analysis/session.js';

// One pre-saved SIMULATED report for the demo patient, produced by the real engine,
// so the hospital portal has something to show when consent is given.
function demoReport(createdAt) {
  const sc = getScenario('hidden_change');
  const baseline = { rate: 14, sd: 1.5, source: 'Default demo baseline' };
  const results = analyzeSession(generateSession(sc, 1), baseline);
  const counts = results.reduce((m, r) => ({ ...m, [r.outcome]: (m[r.outcome] || 0) + 1 }), {});
  return {
    id: 'rep_demo1', patientId: 'u_pat1', createdAt, simulated: true, seeded: true,
    patchId: 'care', patchName: 'BreatheGuard Care',
    scenarioId: sc.id, scenarioName: sc.name, seed: 1, analysedSec: sc.durationSec, baseline,
    controls: { movement: 1, noise: 0, injectedFailures: [] }, counts, latestOutcome: results.at(-1).outcome,
    windows: results.map((w) => ({ t1: w.t1, outcome: w.outcome, rate: w.rate && +w.rate.toFixed(1), confidence: +w.confidence.toFixed(2), quality: +w.quality.toFixed(2), activity: w.activity.dominant, reason: w.reason, naiveRate: w.naive.rate && +w.naive.rate.toFixed(1), chestSqi: +w.channels.chest.sqi.toFixed(2), acousticSqi: +w.channels.acoustic.sqi.toFixed(2) })),
  };
}

const d = (daysAgo, h = 10) => {
  const t = new Date(); t.setDate(t.getDate() - daysAgo); t.setHours(h, 0, 0, 0); return t.toISOString();
};

export function createSeed() {
  return {
    version: 1,
    users: [
      { id: 'u_pat1', role: 'patient', name: 'Asha Rao', email: 'asha@demo.test', password: 'demo123', bodyModel: 'female' },
      { id: 'u_pat2', role: 'patient', name: 'Ben Ortiz', email: 'ben@demo.test', password: 'demo123', bodyModel: 'male' },
      { id: 'u_hosp1', role: 'hospital', name: 'Riverside admin (demo)', email: 'riverside@demo.test', password: 'demo123', hospitalId: 'h_riverside' },
      { id: 'u_hosp2', role: 'hospital', name: 'Northgate admin (demo)', email: 'northgate@demo.test', password: 'demo123', hospitalId: 'h_northgate' },
      { id: 'u_hosp3', role: 'hospital', name: 'Lakeview admin (demo)', email: 'lakeview@demo.test', password: 'demo123', hospitalId: 'h_lakeview' },
      { id: 'u_hosp4', role: 'hospital', name: 'Cedar Park admin (demo)', email: 'cedar@demo.test', password: 'demo123', hospitalId: 'h_cedar' },
      { id: 'u_auth1', role: 'authority', name: 'Dana Okafor (demo reviewer)', email: 'authority@demo.test', password: 'demo123' },
    ],
    hospitals: [
      { id: 'h_riverside', name: 'Riverside Demo Hospital', city: 'Northbridge', address: '12 River Road', registrationNo: 'DEMO-H-1001', contactEmail: 'riverside@demo.test', beds: 220, services: 'Pulmonology, emergency, sleep clinic', documents: ['operating-licence-demo.pdf'], status: 'approved', statusReason: 'Demo licence and premises details checked against demo registry.', submittedAt: d(40), ownerUserId: 'u_hosp1' },
      { id: 'h_cedar', name: 'Cedar Park Demo Hospital', city: 'Westford', address: '4 Cedar Avenue', registrationNo: 'DEMO-H-1002', contactEmail: 'cedar@demo.test', beds: 140, services: 'Allergy, internal medicine', documents: ['operating-licence-demo.pdf'], status: 'approved', statusReason: 'All demo documents in order.', submittedAt: d(35), ownerUserId: 'u_hosp4' },
      { id: 'h_northgate', name: 'Northgate Demo Clinic', city: 'Northbridge', address: '88 Gate Street', registrationNo: 'DEMO-H-1003', contactEmail: 'northgate@demo.test', beds: 30, services: 'Outpatient respiratory care', documents: ['operating-licence-demo.pdf'], status: 'pending', statusReason: '', submittedAt: d(2), ownerUserId: 'u_hosp2' },
      { id: 'h_lakeview', name: 'Lakeview Demo Medical Centre', city: 'Eastvale', address: '3 Shore Lane', registrationNo: 'DEMO-H-1001', contactEmail: 'lakeview@demo.test', beds: 60, services: 'General medicine', documents: [], status: 'more_info', statusReason: 'Registration number duplicates another hospital and no licence document was attached. Please correct and upload.', submittedAt: d(6), ownerUserId: 'u_hosp3' },
    ],
    doctors: [
      { id: 'd_lin', name: 'Dr. Mei Lin', specialty: 'Pulmonology', hospitalId: 'h_riverside', licenseNo: 'DEMO-D-5001', qualifications: 'MD, Pulmonary medicine (demo)', status: 'approved', statusReason: 'Demo credential verified.', submittedAt: d(38) },
      { id: 'd_adeyemi', name: 'Dr. Samuel Adeyemi', specialty: 'Internal medicine', hospitalId: 'h_riverside', licenseNo: 'DEMO-D-5002', qualifications: 'MD (demo)', status: 'approved', statusReason: 'Demo credential verified.', submittedAt: d(38) },
      { id: 'd_nair', name: 'Dr. Priya Nair', specialty: 'Pulmonology', hospitalId: 'h_riverside', licenseNo: 'DEMO-D-5003', qualifications: 'MD, Respiratory medicine (demo)', status: 'pending', statusReason: '', submittedAt: d(1) },
      { id: 'd_rossi', name: 'Dr. Elena Rossi', specialty: 'Allergy and immunology', hospitalId: 'h_cedar', licenseNo: 'DEMO-D-5004', qualifications: 'MD (demo)', status: 'approved', statusReason: 'Demo credential verified.', submittedAt: d(30) },
      { id: 'd_park', name: 'Dr. Jun Park', specialty: 'Sleep medicine', hospitalId: 'h_northgate', licenseNo: 'DEMO-D-5005', qualifications: 'MD (demo)', status: 'pending', statusReason: '', submittedAt: d(2) },
    ],
    appointments: [
      { id: 'a1', patientId: 'u_pat1', doctorId: 'd_lin', hospitalId: 'h_riverside', datetime: d(20, 9), reason: 'Breathlessness on stairs', status: 'completed', createdAt: d(25) },
      { id: 'a2', patientId: 'u_pat1', doctorId: 'd_adeyemi', hospitalId: 'h_riverside', datetime: d(5, 14), reason: 'Follow-up', status: 'completed', createdAt: d(9) },
      { id: 'a3', patientId: 'u_pat1', doctorId: 'd_rossi', hospitalId: 'h_cedar', datetime: d(-4, 11), reason: 'Seasonal wheeze', status: 'requested', createdAt: d(1) },
      { id: 'a4', patientId: 'u_pat2', doctorId: 'd_lin', hospitalId: 'h_riverside', datetime: d(12, 10), reason: 'Night-time cough', status: 'completed', createdAt: d(15) },
      { id: 'a5', patientId: 'u_pat2', doctorId: 'd_lin', hospitalId: 'h_riverside', datetime: d(-2, 15), reason: 'Review of monitoring', status: 'confirmed', createdAt: d(3) },
    ],
    reviews: [
      { id: 'r1', appointmentId: 'a1', patientId: 'u_pat1', doctorId: 'd_lin', rating: 5, comment: 'Explained the monitoring results clearly and did not rush.', createdAt: d(19), hidden: false },
      { id: 'r2', appointmentId: 'a4', patientId: 'u_pat2', doctorId: 'd_lin', rating: 2, comment: 'Waited a long time. This doctor is useless and so is everyone there!!!', createdAt: d(11), hidden: false },
    ],
    consents: [
      { id: 'c1', patientId: 'u_pat1', hospitalId: 'h_riverside', scopes: ['reports'], active: true, updatedAt: d(20) },
    ],
    reports: [demoReport(d(3))],
    prescriptions: [
      { id: 'p1', patientId: 'u_pat1', prescriber: 'Dr. Samuel Adeyemi (demo)', createdAt: d(5), source: 'Entered by patient from demo paper prescription',
        items: [
          { id: 'p1i1', name: 'Salbutamol inhaler', dose: '100 micrograms per puff, as written by prescriber', slots: { morning: false, afternoon: false, night: false }, asNeeded: true },
          { id: 'p1i2', name: 'Beclometasone inhaler', dose: 'As written by prescriber', slots: { morning: true, afternoon: false, night: true }, asNeeded: false },
        ] },
    ],
    doseLog: {},
    complaints: [
      { id: 'cmp1', type: 'review', targetType: 'review', targetId: 'r2', text: 'Review contains abusive language about staff.', byUserId: 'u_hosp1', status: 'open', createdAt: d(10) },
      { id: 'cmp2', type: 'account', targetType: 'hospital', targetId: 'h_lakeview', text: 'Automated flag: registration number DEMO-H-1001 is already used by an approved hospital.', byUserId: 'system', status: 'open', createdAt: d(6) },
    ],
    audit: [
      { id: 'au1', at: d(39), actorId: 'u_auth1', actorRole: 'authority', action: 'hospital.decision', targetType: 'hospital', targetId: 'h_riverside', from: 'pending', to: 'approved', reason: 'Demo licence and premises details checked against demo registry.' },
      { id: 'au2', at: d(38), actorId: 'u_auth1', actorRole: 'authority', action: 'doctor.decision', targetType: 'doctor', targetId: 'd_lin', from: 'pending', to: 'approved', reason: 'Demo credential verified.' },
      { id: 'au3', at: d(5), actorId: 'u_auth1', actorRole: 'authority', action: 'hospital.decision', targetType: 'hospital', targetId: 'h_lakeview', from: 'pending', to: 'more_info', reason: 'Registration number duplicates another hospital and no licence document was attached. Please correct and upload.' },
    ],
    notifications: [
      { id: 'n1', userId: 'u_pat1', text: 'Your appointment request with Dr. Elena Rossi was sent.', at: d(1), read: false },
      { id: 'n2', userId: 'u_hosp3', text: 'The authority requested more information on your application.', at: d(5), read: false },
    ],
    baselines: { u_pat1: { rate: 14, sd: 1.5, source: 'Default demo baseline' } },
  };
}
