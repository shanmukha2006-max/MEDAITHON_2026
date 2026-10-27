// Annotated events for the timeline: what happens in the scenario, and when.
// These come from the scenario definition (ground truth), so the UI labels them
// "scenario events", separate from what the engine itself detects.
const SENSOR_NAME = { chest: 'Chest-motion sensor', acoustic: 'Acoustic sensor', motion: 'Movement sensor' };

export function scenarioEvents(scenario, injected = []) {
  const ev = [];
  for (const n of scenario.notes || []) ev.push({ t: n.t, kind: 'note', text: n.text });
  for (const a of scenario.activity || []) {
    if (!(scenario.notes || []).some((n) => n.t === a.from)) ev.push({ t: a.from, kind: 'movement', text: a.type === 'walking' ? 'Walking starts' : 'Restless movement' });
  }
  for (const c of scenario.coughs || []) ev.push({ t: c, kind: 'cough', text: 'Cough' });
  for (const p of scenario.postures || []) ev.push({ t: p.t, kind: 'posture', text: p.tilt > 30 ? 'Lies down' : 'Sits up' });
  for (const f of scenario.failures || []) ev.push({ t: f.from, kind: 'failure', text: `${SENSOR_NAME[f.sensor]} ${f.sensor === 'chest' ? 'detaches (flat signal)' : 'drops out'}` });
  for (const f of injected) {
    ev.push({ t: f.from, kind: 'failure', text: `${SENSOR_NAME[f.sensor]} failure injected`, injected: true });
    if (f.to != null) ev.push({ t: f.to, kind: 'restore', text: `${SENSOR_NAME[f.sensor]} reconnected`, injected: true });
  }
  return ev.sort((a, b) => a.t - b.t);
}
