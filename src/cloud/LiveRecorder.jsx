import { useEffect, useMemo, useRef, useState } from 'react';
import { Play, Square, Cloud, CloudOff } from 'lucide-react';
import { SCENARIOS, getScenario } from '../sim/scenarios.js';
import { generateSession } from '../sim/generator.js';
import { PATCHES } from '../sim/patches.js';
import { sliceWindow, STEP_SEC, WINDOW_SEC } from '../analysis/session.js';
import { analyzeWindow, DEFAULT_BASELINE } from '../analysis/engine.js';
import { explainResult, neededEvidence } from '../analysis/explain.js';
import * as api from '../backend/api.js';
import { SessionRecorder } from '../backend/recorder.js';
import { useCloud } from './CloudContext.jsx';
import { Card, Btn, Badge, OutcomeChip, Field } from '../components/ui.jsx';

// A labelled group of buttons (a <label> would wrongly rename the first button for screen readers).
const Group = ({ label, children }) => <div className="field" role="group" aria-label={label}><span>{label}</span>{children}</div>;
import { SignalChart } from '../components/charts.jsx';
import Body3D from '../components/Body3D.jsx';

const CHANNELS = { care: ['chest', 'acoustic', 'motion'], quick: ['chest', 'motion'] };

// Patient-side live recording: the simulator plays in real time (or faster) and every second of
// synthetic signal, plus each 30 s analysis result, is written to the shared backend.
export default function LiveRecorder() {
  const { sb, profile, refreshProfile } = useCloud();
  const [patch, setPatch] = useState('care');
  const [scenarioId, setScenarioId] = useState('walking');
  const [speed, setSpeed] = useState(5);
  const [session, setSession] = useState(null);
  const [t, setT] = useState(0);
  const [latest, setLatest] = useState(null);
  const [save, setSave] = useState({ status: 'idle', pending: 0, saved: 0 });
  const [online, setOnline] = useState(typeof navigator === 'undefined' ? true : navigator.onLine);
  const [error, setError] = useState('');
  const recRef = useRef(null);
  const sentSec = useRef(-1);
  const sentWin = useRef(0);
  const scenario = getScenario(scenarioId);
  const [paused, setPaused] = useState(false);
  const [movement, setMovement] = useState(1);
  const [noise, setNoise] = useState(0);
  const [failures, setFailures] = useState([]);
  // controls change the synthetic signals from now on; earlier seconds are already saved
  const data = useMemo(() => generateSession(scenario, 1, { movement, noise, failures }), [scenario, movement, noise, failures]);
  const failSensor = (k) => setFailures((f) => (f.some((x) => x.sensor === k) ? f : [...f, { sensor: k, from: Math.round(t) }]));
  const baseline = { ...DEFAULT_BASELINE, rate: +profile.baseline_rate, sd: +profile.baseline_sd };

  useEffect(() => { const on = () => setOnline(true), off = () => setOnline(false); window.addEventListener('online', on); window.addEventListener('offline', off); return () => { window.removeEventListener('online', on); window.removeEventListener('offline', off); }; }, []);

  // playback clock
  useEffect(() => {
    if (!session || paused) return undefined;
    const id = setInterval(() => setT((p) => Math.min(data.durationSec, p + speed * 0.1)), 100);
    return () => clearInterval(id);
  }, [session, speed, data.durationSec, paused]);

  // emit completed seconds and analysis windows to the recorder
  useEffect(() => {
    if (!session || !recRef.current) return;
    const whole = Math.floor(t);
    for (let s = sentSec.current + 1; s < whole; s++) recRef.current.addObservation(api.observationRow(session.id, data, s, session.channels));
    sentSec.current = Math.max(sentSec.current, whole - 1);
    for (let w = Math.max(WINDOW_SEC, sentWin.current + STEP_SEC); w <= t; w += STEP_SEC) {
      const r = analyzeWindow(sliceWindow(data, w), baseline, { channels: PATCHES[patch].channels });
      const ex = explainResult(r, PATCHES[patch].name);
      recRef.current.addAnalysis(api.analysisRow(session.id, r, { steps: ex.steps, verdict: ex.verdict }));
      setLatest(r); sentWin.current = w;
    }
    if (t >= data.durationSec) stop();
  }, [t]); // eslint-disable-line react-hooks/exhaustive-deps

  const start = async () => {
    setError('');
    try {
      const s = await api.startSession(sb, { patientId: profile.id, patch, channels: CHANNELS[patch], scenarioId, seed: 1 });
      recRef.current = new SessionRecorder({ writeObservations: (rows) => api.writeObservations(sb, rows), writeAnalysis: (rows) => api.writeAnalysis(sb, rows), onStatus: setSave });
      sentSec.current = -1; sentWin.current = 0; setLatest(null); setT(0); setPaused(false); setFailures([]); setSession(s);
    } catch (e) { setError(e.message); }
  };
  const stop = async () => {
    const s = session, rec = recRef.current;
    if (!s) return;
    setSession(null);
    const whole = Math.floor(Math.min(t, data.durationSec));
    for (let x = sentSec.current + 1; x < whole; x++) rec.addObservation(api.observationRow(s.id, data, x, s.channels));
    const ok = await rec.drain(20000);
    rec.stop();
    try { await api.stopSession(sb, s.id); } catch (e) { setError(e.message); }
    if (!ok) setError(`${rec.pending()} items could not be saved before stopping. Check your connection.`);
  };

  const i1 = Math.max(1, Math.round(t * 10)), i0 = Math.max(0, i1 - 300);
  const view = [];
  for (let i = i0; i < i1; i += 2) view.push({ t: i / 10, chest: data.chest[i], acoustic: Number.isFinite(data.acoustic[i]) ? data.acoustic[i] : null, accel: data.accel[i] });
  const SAVE = { idle: ['neutral', 'Not recording'], saving: ['info', 'Saving…'], saved: ['good', 'All data saved'], retrying: ['warn', 'Connection problem: retrying'], stopped: ['neutral', 'Stopped'] }[save.status] || ['neutral', save.status];

  return (
    <div className="stack-l">
      <div className="sim-notice" role="note">SIMULATED DATA — NOT FOR CLINICAL USE <span className="sub">Recorded to the shared backend as synthetic data.</span></div>
      <Card title="Record a monitoring session" sub="The simulator plays the scenario; each second of signal and each analysis result is saved to the shared database, where consented hospitals can watch it live.">
        <div className="grid-3" style={{ alignItems: 'end' }}>
          <Group label="Patch">
            <div className="seg">{['care', 'quick'].map((p) => <button key={p} disabled={!!session} className={patch === p ? 'on' : ''} onClick={() => setPatch(p)}>{PATCHES[p].name.replace('BreatheGuard ', '')}</button>)}</div>
          </Group>
          <Field label="Scenario"><select className="select" disabled={!!session} value={scenarioId} onChange={(e) => setScenarioId(e.target.value)}>{SCENARIOS.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}</select></Field>
          <Group label="Speed"><div className="seg">{[1, 5].map((x) => <button key={x} className={speed === x ? 'on' : ''} onClick={() => setSpeed(x)}>{x}×</button>)}</div></Group>
        </div>
        <p className="tiny muted" style={{ marginTop: 8 }}>Channels recorded: {CHANNELS[patch].join(', ')}{patch === 'quick' ? ' (no acoustic sensor on Quick)' : ''}.</p>
        <div className="grid-3" style={{ marginTop: 12 }}>
          <Field label={`Movement intensity ×${movement.toFixed(1)}`}><input type="range" min="0" max="2" step="0.1" value={movement} onChange={(e) => setMovement(+e.target.value)} aria-label="Movement intensity" /></Field>
          <Field label={`Extra sensor noise: ${noise === 0 ? 'none' : noise < 1.6 ? 'moderate' : 'heavy'}`}><input type="range" min="0" max="2" step="0.1" value={noise} onChange={(e) => setNoise(+e.target.value)} aria-label="Sensor noise" /></Field>
          <Group label="Simulate a sensor failure"><div className="row">{CHANNELS[patch].map((k) => <Btn key={k} size="sm" variant="danger" disabled={!session || failures.some((x) => x.sensor === k)} onClick={() => failSensor(k)}>{failures.some((x) => x.sensor === k) ? `${k} failed` : `Fail ${k}`}</Btn>)}</div></Group>
        </div>
        <div className="row-between" style={{ marginTop: 12 }}>
          <div className="row">
            {session && <Btn onClick={() => setPaused(!paused)}>{paused ? 'Resume' : 'Pause'}</Btn>}{session ? <Btn variant="danger" icon={Square} onClick={stop}>Stop recording</Btn> : <Btn variant="primary" icon={Play} onClick={start}>Start recording</Btn>}
            <span className="small muted">{Math.floor(t)} s / {data.durationSec} s</span>
          </div>
          <div className="row">
            <span className={`badge ${online ? 'good' : 'bad'}`}>{online ? <Cloud size={13} /> : <CloudOff size={13} />}{online ? 'Online' : 'Offline: data is queued'}</span>
            <span className={`badge ${SAVE[0]}`} data-testid="save-status" style={{ minWidth: 230, justifyContent: 'center', whiteSpace: 'nowrap' }}>{SAVE[1]}{save.pending ? ` · ${save.pending} waiting` : ''}</span>
            <span className="tiny muted" style={{ minWidth: 110, display: 'inline-block', whiteSpace: 'nowrap' }}>{save.saved} items saved</span>
          </div>
        </div>
        {paused && <div className="notice warn small" style={{ marginTop: 8 }}>Paused. Nothing new is recorded until you resume.</div>}
        {error && <div className="notice bad small" role="alert" style={{ marginTop: 10 }}>{error}</div>}
        {session && <p className="tiny muted" style={{ marginTop: 6 }}>Session {session.id.slice(0, 8)} · {session.label}</p>}
      </Card>
      <div className="grid-2">
        <Card title="Signals being recorded" sub="SIMULATED DATA — NOT FOR CLINICAL USE">{t > 1 ? <div className="stack"><SignalChart data={view} dataKey="chest" color="#0b1f3a" label="Chest motion" unit="a.u." />{patch === 'care' && <SignalChart data={view} dataKey="acoustic" color="#0b7f86" label="Acoustic" unit="a.u." />}<SignalChart data={view} dataKey="accel" color="#7a4d9e" label="Movement" unit="g" height={80} /></div> : <p className="small muted">Press Start recording.</p>}</Card>
        <Card title="Latest result" sub="SIMULATED DATA — NOT FOR CLINICAL USE">{latest ? <div className="stack-s"><OutcomeChip outcome={latest.outcome} /><p className="small">{latest.reason}</p><p className="tiny muted">Signal quality {Math.round(latest.quality * 100)}% (shown separately from the result).</p>{latest.outcome === 'insufficient' && <div className="notice warn small" data-testid="quality-warning"><strong>Signal-quality warning.</strong> This is not a normal result. Please repeat the measurement, or ask for a clinician’s review if you are concerned.<ul style={{ margin: '4px 0 0', paddingLeft: 18 }}>{neededEvidence(latest, PATCHES[patch].name).map((x, i) => <li key={i}>{x}</li>)}</ul></div>}</div> : <p className="small muted">Appears after 30 s.</p>}</Card>
      </div>
      <Card title="Breathing in 3D" sub="Moves at the simulated session’s current rate. Patch shown over the diaphragm.">
        <Body3D compact rate={latest?.rate || 12} bodyModel={profile.body_model || 'female'} onBodyModelChange={async (m) => { try { await api.setBodyModelRemote(sb, profile.id, m); await refreshProfile(); } catch (e) { setError(e.message); } }} initialPatch={patch} />
      </Card>
    </div>
  );
}
