import { useDeferredValue, useEffect, useMemo, useState } from 'react';
import { Play, Pause, RotateCcw, FastForward, Save, Gauge, Activity, Mic, Move, Info, FlaskConical, Target, Presentation, Unplug, PlugZap, X, SlidersHorizontal, MessageCircleQuestion } from 'lucide-react';
import { SCENARIOS, getScenario } from '../../sim/scenarios.js';
import { generateSession } from '../../sim/generator.js';
import { PATCHES, PATCH_LIST } from '../../sim/patches.js';
import { scenarioEvents } from '../../sim/events.js';
import { JUDGE_STEPS } from '../../sim/judgeDemo.js';
import { analyzeUpTo, deriveBaseline, STEP_SEC, WINDOW_SEC } from '../../analysis/session.js';
import { activityContext, DEFAULT_BASELINE } from '../../analysis/engine.js';
import { explainResult, neededEvidence, demoLine } from '../../analysis/explain.js';
import { fillGaps } from '../../analysis/dsp.js';
import { saveReport, setBaseline } from '../../data/actions.js';
import { useStore } from '../../data/store.jsx';
import { Card, Btn, Badge, Meter, OUTCOME_META, OutcomeChip, PageHead } from '../../components/ui.jsx';
import { SignalChart, TrendChart, trendPoints, labelRuns, ACT_COLORS, ACT_LABEL, OUTCOME_COLOR, EVENT_COLORS } from '../../components/charts.jsx';
import { PatchArt } from '../../components/PatchArt.jsx';

const SPEEDS = [1, 5, 15];
const SHORT = { normal_rest: 'Rest', walking: 'Walking', coughing: 'Cough', posture: 'Posture', irregular: 'Irregular', hidden_change: 'Change + movement', single_failure: '1 sensor fails', multi_failure: 'Sensors fail', recovery: 'Recovery', ambiguous: 'Ambiguous' };
const SENSORS = [
  { key: 'chest', name: 'Chest motion', icon: Activity },
  { key: 'acoustic', name: 'Acoustic', icon: Mic },
  { key: 'motion', name: 'Movement', icon: Move },
];
const sameFailures = (a, b) => JSON.stringify(a) === JSON.stringify(b);

// Run one Judge Demo step headlessly (for comparison and summary cards)
function runStep(step, baseline) {
  const data = generateSession(getScenario(step.scenario), 1, { failures: step.failures || [] });
  return analyzeUpTo(data, step.to, baseline, { channels: PATCHES[step.patch].channels }).at(-1);
}

export default function Monitor({ go, query = {}, routeKey }) {
  const { state, user, act, judge: judgeState, judgeGo, judgeExit, setSimRunning } = useStore();
  const baseline = state.baselines[user.id] || DEFAULT_BASELINE;
  const [patchId, setPatchId] = useState('care');
  const [scenarioId, setScenarioId] = useState('hidden_change');
  const [seed, setSeed] = useState(1);
  const [speed, setSpeed] = useState(5);
  const [running, setRunning] = useState(false);
  const [t, setT] = useState(0);
  const [stopAt, setStopAt] = useState(null);
  const [movement, setMovement] = useState(1);
  const [noise, setNoise] = useState(0);
  const [injected, setInjected] = useState([]);
  const [showTruth, setShowTruth] = useState(false);
  const [showNaive, setShowNaive] = useState(true);
  const [showControls, setShowControls] = useState(true);

  const patch = PATCHES[patchId];
  const scenario = getScenario(scenarioId);
  const dMovement = useDeferredValue(movement);
  const dNoise = useDeferredValue(noise);
  const data = useMemo(() => generateSession(scenario, seed, { movement: dMovement, noise: dNoise, failures: injected }), [scenario, seed, dMovement, dNoise, injected]);
  const dur = data.durationSec;
  const step = Math.floor(t / STEP_SEC);
  const results = useMemo(() => analyzeUpTo(data, t, baseline, { channels: patch.channels }), [data, step, baseline.rate, baseline.sd, patchId]); // eslint-disable-line react-hooks/exhaustive-deps
  const latest = results.at(-1);

  // playback
  useEffect(() => {
    if (!running) return undefined;
    const id = setInterval(() => setT((p) => Math.min(dur, p + speed * 0.1)), 100);
    return () => clearInterval(id);
  }, [running, speed, dur]);
  useEffect(() => {
    const limit = stopAt ?? dur;
    if (running && t >= limit - 1e-6) { setRunning(false); setStopAt(null); }
  }, [t, running, stopAt, dur]);

  const applyPreset = ({ patch: p = patchId, scenario: sc, seed: sd = 1, movement: mv = 1, noise: nz = 0, failures = [], from, to, play = true }) => {
    setPatchId(p); setScenarioId(sc); setSeed(sd); setMovement(mv); setNoise(nz);
    setInjected((cur) => (sameFailures(cur, failures) ? cur : failures));
    setT(from);
    if (play && to != null) { setStopAt(to); setSpeed(Math.max(3, (to - from) / 6)); setRunning(true); } else { setStopAt(null); setRunning(false); }
  };
  // Judge Demo: the store says which step is active; simulator steps load their preset here
  const judgeStep = judgeState ? JUDGE_STEPS[judgeState.i] : null;
  const judge = judgeStep && !judgeStep.portal ? judgeState.i : null;
  useEffect(() => {
    if (!judgeStep || judgeStep.portal) { setShowControls(true); return; }
    setShowControls(false);
    if (judgeStep.summary) setRunning(false);
    else applyPreset({ ...judgeStep });
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }, [judgeState?.nonce]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { setSimRunning(running); }, [running, setSimRunning]);
  useEffect(() => () => setSimRunning(false), [setSimRunning]);

  // presets from the URL (Explore Care/Quick buttons, Judge Demo links)
  useEffect(() => {
    if (query.judge) judgeGo(0);
    else if (query.patch && PATCHES[query.patch]) { judgeExit(); applyPreset({ patch: query.patch, scenario: 'normal_rest', from: 0, play: false }); }
  }, [routeKey]); // eslint-disable-line react-hooks/exhaustive-deps

  const reset = () => { setRunning(false); setStopAt(null); setT(0); setInjected([]); };
  const pickScenario = (id) => { setScenarioId(id); setRunning(false); setStopAt(null); setT(0); setInjected([]); };
  const jumpPreset = (id) => { const sc = getScenario(id); applyPreset({ patch: patchId, scenario: id, seed, movement, noise, from: Math.max(30, sc.keyMoment.t - 20), to: sc.keyMoment.t }); };

  // failure state of a sensor at the current time
  const failureAt = (key) => {
    const sf = (scenario.failures || []).find((f) => f.sensor === key && t >= f.from);
    if (sf) return { source: 'scenario', since: sf.from };
    const inj = injected.find((f) => f.sensor === key && t >= f.from && (f.to == null || t < f.to));
    if (inj) return { source: 'injected', since: inj.from };
    return null;
  };
  const failNow = (key) => setInjected((cur) => [...cur, { sensor: key, from: Math.round(t) }]);
  const reconnect = (key) => setInjected((cur) => cur.map((f) => (f.sensor === key && f.to == null ? { ...f, to: Math.max(f.from + 1, Math.round(t)) } : f)));

  // live 30 s display window
  const fs = data.fs;
  const iEnd = Math.max(1, Math.round(t * fs));
  const iStart = Math.max(0, iEnd - WINDOW_SEC * fs);
  const view = useMemo(() => {
    const pts = [];
    const ok = (v) => (Number.isFinite(v) ? +v.toFixed(3) : null);
    for (let i = iStart; i < iEnd; i += 2) pts.push({ t: i / fs, chest: ok(data.chest[i]), acoustic: ok(data.acoustic[i]), accel: ok(data.accel[i]) });
    return pts;
  }, [data, iStart, iEnd, fs]);
  const motionLive = data.accel.slice(iStart, iEnd);
  const liveCtx = useMemo(() => {
    if (iEnd - iStart < fs * 3 || motionLive.filter(Number.isFinite).length < motionLive.length * 0.7) return null;
    return activityContext(fillGaps(motionLive), fillGaps(data.tilt.slice(iStart, iEnd)), data.acoustic.slice(iStart, iEnd), fs);
  }, [data, iStart, iEnd, fs]); // eslint-disable-line react-hooks/exhaustive-deps
  const runs = liveCtx ? labelRuns(liveCtx.labels, iStart / fs) : [];
  const events = useMemo(() => scenarioEvents(scenario, injected), [scenario, injected]);
  const viewMarkers = events.filter((e) => e.t >= iStart / fs && e.t <= iEnd / fs);
  const missingNow = (arr) => view.length > 0 && view.slice(-20).every((p) => p[arr] == null);

  // engine-detected labels for the whole session so far
  const sessionLabels = useMemo(() => {
    const n = Math.floor(t);
    if (n < 3) return [];
    const out = [];
    for (let s0 = 0; s0 < n; s0 += 30) {
      const s1 = Math.min(n, s0 + 30);
      const acc = data.accel.slice(s0 * fs, s1 * fs);
      if (acc.filter(Number.isFinite).length < acc.length * 0.7) { out.push(...new Array(s1 - s0).fill('unknown')); continue; }
      out.push(...activityContext(fillGaps(acc), fillGaps(data.tilt.slice(s0 * fs, s1 * fs)), data.acoustic.slice(s0 * fs, s1 * fs), fs).labels.slice(0, s1 - s0));
    }
    return out;
  }, [data, Math.floor(t / 2), fs]); // eslint-disable-line react-hooks/exhaustive-deps

  const points = trendPoints(results, data.truth.rate);
  const counts = results.reduce((m, r) => ({ ...m, [r.outcome]: (m[r.outcome] || 0) + 1 }), {});
  const jstep = judge != null ? JUDGE_STEPS[judge] : null;

  const save = () => act(saveReport, {
    simulated: true, patchId, patchName: patch.name,
    scenarioId, scenarioName: scenario.name, seed, analysedSec: Math.round(t), baseline,
    controls: { movement, noise, injectedFailures: injected },
    counts, latestOutcome: latest?.outcome || null,
    windows: results.map((w) => ({ t1: w.t1, outcome: w.outcome, rate: w.rate && +w.rate.toFixed(1), confidence: +w.confidence.toFixed(2), quality: +w.quality.toFixed(2), activity: w.activity.dominant, reason: w.reason, naiveRate: w.naive.rate && +w.naive.rate.toFixed(1), chestSqi: +w.channels.chest.sqi.toFixed(2), acousticSqi: +w.channels.acoustic.sqi.toFixed(2) })),
  }, 'Report saved. Sharing follows your consent settings.');
  const useAsBaseline = () => {
    const b = deriveBaseline(results);
    if (!b) return act(() => { throw new Error('Need at least 3 reliable resting windows within range to set a baseline.'); });
    act(setBaseline, b, `Baseline set to ${b.rate}/min (±${b.sd}).`);
  };

  return (
    <div className="stack-l">
      <PageHead title="Patch simulator"
        text="Synthetic signals from a simulated BreatheGuard patch, analysed by the real engine. Change the patch, the situation, movement, noise or sensor failures and watch how the answer changes."
        actions={judge == null && <Btn variant="teal" icon={Presentation} onClick={() => judgeGo(0)}>Judge Demo</Btn>} />

      <div className="sim-notice" role="note"><FlaskConical size={18} />SIMULATED DATA — NOT FOR CLINICAL USE <span className="sub">Not a medical device. Normal results say nothing about a real person’s health.</span></div>

      {jstep?.summary ? <JudgeSummary baseline={baseline} /> : (
        <>
          {judge != null && !showControls ? (
            <div className="console" style={{ padding: '12px 18px' }}>
              <div className="row-between">
                <div className="row small"><strong>{patch.name}</strong><span className="muted">·</span><span>{scenario.name}</span><span className="muted">· {Math.floor(t)} s</span></div>
                <Btn size="sm" icon={SlidersHorizontal} onClick={() => setShowControls(true)}>Show controls</Btn>
              </div>
            </div>
          ) : (
            <Console {...{ patchId, setPatchId, scenarioId, pickScenario, jumpPreset, seed, setSeed: (v) => { setSeed(v); reset(); }, speed, setSpeed, running, setRunning, t, setT: (v) => { setRunning(false); setStopAt(null); setT(v); }, dur, reset, movement, setMovement, noise, setNoise, failureAt, failNow, reconnect, showNaive, setShowNaive, showTruth, setShowTruth, stopAt, setStopAt, scenario, patch, judge, onHide: () => setShowControls(false) }} />
          )}

          {jstep?.compare && <CompareCard ids={jstep.compare} baseline={baseline} />}

          <Verdict latest={latest} t={t} showNaive={showNaive} patch={patch} />

          <Availability patch={patch} latest={latest} failureAt={failureAt} />

          <div className="grid-2">
            <Card title="Live signals" sub="Last 30 s. Shading = activity detected from the movement sensor. Dashed lines = scenario events.">
              <div className="stack">
                <SignalChart data={view} dataKey="chest" color="#0b1f3a" label="Chest motion" unit="a.u." runs={runs} markers={viewMarkers} missing={false} />
                {patch.channels.acoustic
                  ? <SignalChart data={view} dataKey="acoustic" color="#0b7f86" label="Acoustic breathing feature" unit="a.u." runs={runs} markers={viewMarkers} missing={missingNow('acoustic')} />
                  : <div className="avail-chip absent" style={{ height: 70 }}><span className="dot" /><span className="small">Acoustic sensor not fitted on BreatheGuard Quick. Nothing to cross-check the chest signal against.</span></div>}
                <SignalChart data={view} dataKey="accel" color="#7a4d9e" label="Movement / activity" unit="g" runs={runs} markers={viewMarkers} height={90} missing={missingNow('accel')} />
                <div className="legend">{Object.entries(ACT_LABEL).filter(([k]) => !['rest', 'impact', 'unknown'].includes(k)).map(([k, l]) => <span key={k}><i style={{ background: ACT_COLORS[k] }} />{l}</span>)}</div>
              </div>
            </Card>
            <WhyPanel latest={latest} patch={patch} scenario={scenario} />
          </div>

          <EventTimeline events={events} labels={sessionLabels} t={t} dur={dur} results={results} showTruth={showTruth} data={data} scenario={scenario} />

          <div className="grid-2">
            <SensorQuality latest={latest} patch={patch} />
            {latest ? <Hypotheses latest={latest} /> : <Card title="Movement artefact or genuine change?"><p className="small muted">Appears with the first result.</p></Card>}
          </div>

          <Card title="Breathing rate trend" sub={`One point per 30 s window, every ${STEP_SEC} s. Dot colour = outcome. Band = expected range for your baseline (${baseline.rate}/min) and the detected activity.`}>
            {results.length ? <TrendChart points={points} showTruth={showTruth} showNaive={showNaive} /> : <p className="muted small">The first estimate appears after 30 s of data.</p>}
            <div className="stack-s" style={{ marginTop: 10 }}>
              <span className="tiny muted">Outcome per window</span>
              <div className="strip">{results.map((r, i) => <div key={i} className={`${r.outcome} ${r.outcome === 'insufficient' ? 'hatch' : ''}`} title={`${r.t1}s: ${OUTCOME_META[r.outcome].short}`} />)}</div>
            </div>
          </Card>

          <Card title="Save and baseline">
            <div className="row-between">
              <div className="small muted" style={{ maxWidth: '70ch' }}>Your baseline is <strong>{baseline.rate}/min (±{baseline.sd})</strong>, {baseline.source.toLowerCase()}. Saved reports record the patch, scenario and control settings, and are shared only with hospitals you have consented to.</div>
              <div className="row">
                <Btn icon={Gauge} onClick={useAsBaseline} disabled={!results.length}>Use as baseline</Btn>
                <Btn variant="primary" icon={Save} onClick={() => save() && go && go('reports')} disabled={!results.length}>Save report</Btn>
              </div>
            </div>
          </Card>
        </>
      )}
    </div>
  );
}

function Console(p) {
  const { patchId, setPatchId, scenarioId, pickScenario, jumpPreset, seed, setSeed, speed, setSpeed, running, setRunning, t, setT, dur, reset, movement, setMovement, noise, setNoise, failureAt, failNow, reconnect, showNaive, setShowNaive, showTruth, setShowTruth, stopAt, setStopAt, scenario, patch, judge, onHide } = p;
  const atEnd = t >= dur - 1e-6;
  return (
    <section className="console" aria-label="Simulation controls">
      <div className="row-between">
        <h2>Simulation controls</h2>
        {judge != null && <Btn size="sm" icon={X} onClick={onHide}>Hide controls</Btn>}
      </div>
      <div className="console-grid">
        <div>
          <span className="lab">Patch</span>
          <div className="patch-toggle" role="group" aria-label="Patch">
            {PATCH_LIST.map((x) => (
              <button key={x.id} className={patchId === x.id ? 'on' : ''} onClick={() => setPatchId(x.id)} aria-pressed={patchId === x.id}>
                <span><strong style={{ color: 'inherit' }}>{x.id === 'care' ? 'Care' : 'Quick'}</strong><small>{x.sensors.length} sensors</small></span>
              </button>
            ))}
          </div>
        </div>
        <div>
          <label className="lab" htmlFor="sc">Scenario</label>
          <select id="sc" className="select" value={scenarioId} onChange={(e) => pickScenario(e.target.value)}>
            {SCENARIOS.map((s, i) => <option key={s.id} value={s.id}>{i + 1}. {s.name}</option>)}
          </select>
        </div>
        <div>
          <label className="lab" htmlFor="mv">Movement intensity: ×{movement.toFixed(1)}</label>
          <input id="mv" type="range" min="0" max="2" step="0.1" value={movement} onChange={(e) => setMovement(+e.target.value)} />
          <div className="range-labels"><span>Less</span><span>Scenario default</span><span>More</span></div>
        </div>
        <div>
          <label className="lab" htmlFor="nz">Extra sensor noise: {noise === 0 ? 'none' : noise < 0.8 ? 'mild' : noise < 1.6 ? 'moderate' : 'heavy'}</label>
          <input id="nz" type="range" min="0" max="2" step="0.1" value={noise} onChange={(e) => setNoise(+e.target.value)} />
          <div className="range-labels"><span>Clean</span><span>Moderate</span><span>Heavy</span></div>
        </div>
      </div>

      <div>
        <span className="lab">Scenario presets (jump to the key moment and play)</span>
        <div className="preset-chips">{SCENARIOS.map((s) => <button key={s.id} className={scenarioId === s.id ? 'on' : ''} onClick={() => jumpPreset(s.id)} title={s.keyMoment.label}>{SHORT[s.id]}</button>)}</div>
        <p className="small muted" style={{ marginTop: 8, maxWidth: '100ch' }}>{scenario.summary}</p>
      </div>

      <div className="divider" />
      <div className="row-between">
        <div className="row">
          {running
            ? <Btn variant="primary" icon={Pause} onClick={() => setRunning(false)}>Pause</Btn>
            : <Btn variant="primary" icon={Play} onClick={() => { if (atEnd) setT(0); setStopAt(null); setRunning(true); }}>{t > 0 && !atEnd ? 'Resume' : 'Start'}</Btn>}
          <Btn icon={RotateCcw} onClick={reset}>Reset</Btn>
          <Btn icon={FastForward} onClick={() => setT(dur)}>Run to end</Btn>
          <Btn icon={Target} onClick={() => setT(scenario.keyMoment.t)} title={scenario.keyMoment.label}>Key moment ({scenario.keyMoment.t}s)</Btn>
        </div>
        <div className="row">
          <div className="seg" role="group" aria-label="Playback speed">{SPEEDS.map((s) => <button key={s} className={speed === s ? 'on' : ''} onClick={() => setSpeed(s)}>{s}×</button>)}</div>
          <label className="lab" style={{ margin: 0, display: 'flex', alignItems: 'center', gap: 6 }}>Seed<input className="input" style={{ width: 72, padding: '5px 8px' }} type="number" min={1} value={seed} onChange={(e) => setSeed(Math.max(1, Number(e.target.value) || 1))} /></label>
        </div>
      </div>
      <div className="scrub">
        <input type="range" min="0" max={dur} step="1" value={Math.floor(t)} onChange={(e) => setT(+e.target.value)} aria-label="Simulation timeline" />
        <span className="time">{Math.floor(t)} s / {dur} s</span>
      </div>

      <div className="divider" />
      <div className="console-grid three">
        {SENSORS.map(({ key, name, icon: I }) => {
          const fitted = patch.channels[key];
          const f = fitted ? failureAt(key) : null;
          return (
            <div key={key} className="fail-row" style={{ borderBottom: '1px solid #22406b' }}>
              <span className="row" style={{ gap: 6 }}><I size={15} /><strong>{name}</strong><span className="muted small">{!fitted ? 'not fitted' : f ? `failed at ${f.since}s` : 'working'}</span></span>
              {!fitted ? null : f?.source === 'scenario' ? <span className="small muted">scenario failure</span>
                : f ? <Btn size="sm" icon={PlugZap} onClick={() => reconnect(key)}>Reconnect</Btn>
                  : <Btn size="sm" variant="danger" icon={Unplug} onClick={() => failNow(key)}>Fail now</Btn>}
            </div>
          );
        })}
      </div>
      <div className="row small">
        <label className="check"><input type="checkbox" checked={showNaive} onChange={(e) => setShowNaive(e.target.checked)} />Show chest-only comparison</label>
        <label className="check"><input type="checkbox" checked={showTruth} onChange={(e) => setShowTruth(e.target.checked)} />Reveal simulator ground truth</label>
      </div>
    </section>
  );
}

function Verdict({ latest, t, showNaive, patch }) {
  if (!latest) {
    return (
      <div className="verdict warmup" aria-live="polite">
        <div className="verdict-icon"><FlaskConical size={24} /></div>
        <div><div className="verdict-title">Collecting data</div><p className="muted">The first 30 s window is needed before any result. {Math.max(0, 30 - Math.floor(t))} s to go. Press Start or pick a preset.</p></div>
      </div>
    );
  }
  const M = OUTCOME_META[latest.outcome];
  const I = M.icon;
  const short = latest.outcome === 'within' ? 'Within expected simulated range' : latest.outcome === 'concerning' ? 'Potentially concerning simulated pattern' : 'Insufficient reliable data';
  return (
    <div className={`verdict ${latest.outcome} ${latest.outcome === 'insufficient' ? 'hatch' : ''}`} aria-live="polite">
      <div className="verdict-icon"><I size={26} /></div>
      <div>
        <div className="row-between">
          <div className="verdict-title">{short}</div>
          <span className="small muted">{patch.name} · window {latest.t0.toFixed(0)}–{latest.t1.toFixed(0)} s · simulated</span>
        </div>
        <p style={{ marginTop: 4, maxWidth: '85ch' }}>{latest.reason}</p>
        <div className="verdict-metrics">
          <div className="metric"><div className="v">{latest.rate != null ? latest.rate.toFixed(1) : '—'}</div><div className="l">Breaths/min (estimate)</div></div>
          <div className="metric"><div className="v">{Math.round(latest.quality * 100)}%</div><div className="l">Signal quality</div></div>
          
          <div className="metric"><div className="v" style={{ fontSize: '1.1rem', paddingTop: 6 }}>{ACT_LABEL[latest.activity.dominant] || latest.activity.dominant}</div><div className="l">Detected activity</div></div>
          {showNaive && <div className="metric"><div className="v" style={{ color: latest.naive.flag === 'alarm' ? 'var(--concern)' : 'var(--ink-2)' }}>{latest.naive.rate != null ? latest.naive.rate.toFixed(1) : '—'}</div><div className="l">Chest-only monitor would say{latest.naive.flag === 'alarm' ? ' (alarm)' : ''}</div></div>}
        </div>
        {latest.outcome === 'insufficient' && patch.limitation && latest.activity.dominant !== 'rest' && <p className="small" style={{ marginTop: 10, maxWidth: '85ch' }}><strong>Quick patch limitation:</strong> {patch.limitation}</p>}
      </div>
    </div>
  );
}

function Availability({ patch, latest, failureAt }) {
  return (
    <div className="avail" aria-label="Sensor availability">
      {SENSORS.map(({ key, name, icon: I }) => {
        const fitted = patch.channels[key];
        if (!fitted) return <div key={key} className="avail-chip absent"><span className="dot" /><I size={16} /><div><strong className="small">{name}</strong><div className="tiny">Not fitted on {patch.name}</div></div></div>;
        const f = failureAt(key);
        const c = key === 'motion' ? null : latest?.channels[key];
        let cls = 'ok', note = 'Working';
        if (f) { cls = 'down'; note = `Failed at ${f.since}s${f.source === 'injected' ? ' (injected)' : ''}`; }
        else if (key === 'motion' && latest && !latest.motionOk) { cls = 'down'; note = 'No data in this window'; }
        else if (c && !c.usable) { cls = 'down'; note = 'Unusable in this window'; }
        else if (c && !c.reliable) { cls = 'weak'; note = `Working, not trusted now (${Math.round(c.sqi * 100)}%)`; }
        else if (c) note = `Working, trusted (${Math.round(c.sqi * 100)}%)`;
        else if (key === 'motion') note = 'Working (context only)';
        return <div key={key} className={`avail-chip ${cls} ${cls === 'down' ? 'hatch' : ''}`}><span className="dot" /><I size={16} /><div><strong className="small">{name}</strong><div className="tiny muted">{note}</div></div></div>;
      })}
    </div>
  );
}

function WhyPanel({ latest, patch, scenario }) {
  return (
    <Card title={<span className="row" style={{ gap: 8 }}><MessageCircleQuestion size={18} />Why this result?</span>} sub="The engine’s reasoning in plain language, built only from what it measured.">
      {!latest ? <p className="small muted">{demoLine({}, patch.name, scenario.name)} The explanation appears with the first result, after 30 s of data.</p> : (() => {
        const ex = explainResult(latest, patch.name);
        const need = neededEvidence(latest, patch.name);
        return (
          <div className="why stack">
            <p className="small" style={{ background: 'var(--brand-soft)', padding: '8px 10px', borderRadius: 6 }}>{demoLine(latest, patch.name, scenario.name)}</p>
            <ol>{ex.steps.map((s, i) => <li key={i}><div><div className="q">{s.q}</div><div className="a">{s.a}</div></div></li>)}</ol>
            <div className={`notice ${latest.outcome === 'within' ? '' : latest.outcome === 'concerning' ? 'bad' : 'warn'} small`}><strong>So: {OUTCOME_META[latest.outcome].short.toLowerCase()}.</strong> {ex.verdict}</div>
            {need.length > 0 && (
              <div className="small">
                <strong>What would make this conclusive</strong>
                <ul style={{ margin: '4px 0 0', paddingLeft: 18, color: 'var(--ink-2)' }}>{need.map((x, i) => <li key={i}>{x}</li>)}</ul>
                <p className="tiny muted" style={{ marginTop: 6 }}>If a real person has breathing difficulty, seek medical help now rather than waiting for more data.</p>
              </div>
            )}
          </div>
        );
      })()}
    </Card>
  );
}

function EventTimeline({ events, labels, t, dur, results, showTruth, data, scenario }) {
  const pct = (x) => `${(x / dur) * 100}%`;
  return (
    <Card title="Activity timeline" sub="Bar = activity detected by the engine so far. Markers = scenario events (what the simulator is doing).">
      <div className="stack">
        <div className="ev-track">
          <div className="bar">{labels.map((l, i) => <div key={i} style={{ width: pct(1), background: l === 'rest' ? '#e2e8ee' : ACT_COLORS[l] }} title={`${i}s: ${ACT_LABEL[l]}`} />)}</div>
          {events.map((e, i) => <div key={i} className="ev-mark" style={{ left: pct(e.t), background: EVENT_COLORS[e.kind], opacity: e.t <= t ? 1 : 0.35 }} title={`${e.t}s: ${e.text}`} />)}
          <div className="ev-now" style={{ left: pct(t) }} />
        </div>
        <div className="row-between tiny muted"><span>0 s</span><span>{dur} s</span></div>
        {showTruth && <>
          <span className="tiny muted">Ground truth activity (simulator)</span>
          <div className="timeline">{data.truth.activity.slice(0, Math.floor(t)).map((l, i) => <div key={i} style={{ width: pct(1), background: l === 'rest' ? '#e2e8ee' : ACT_COLORS[l] }} />)}</div>
          <span className="tiny muted">Expected outcome per window (scenario label)</span>
          <div className="strip">{results.map((r, i) => { const e = scenario.expected(r.t1); return <div key={i} className={`${e === 'any' ? '' : e} ${e === 'insufficient' ? 'hatch' : ''}`} style={e === 'any' ? { background: '#e2e8ee' } : undefined} title={e === 'any' ? 'Transition (not scored)' : OUTCOME_META[e].short} />; })}</div>
        </>}
        {events.length ? (
          <div className="ev-list">
            {events.map((e, i) => (
              <div key={i} className={`row ${e.t > t ? 'future' : ''}`} style={{ gap: 8 }}>
                <span style={{ width: 10, height: 10, borderRadius: '50%', background: EVENT_COLORS[e.kind], flex: 'none' }} />
                <span style={{ width: 44, fontWeight: 600 }}>{e.t}s</span><span>{e.text}{e.t > t ? ' (upcoming)' : ''}</span>
              </div>
            ))}
          </div>
        ) : <p className="small muted">No scenario events: steady conditions throughout.</p>}
      </div>
    </Card>
  );
}

function SensorQuality({ latest, patch }) {
  const rows = [{ key: 'chest', icon: Activity, name: 'Chest-motion sensor' }, { key: 'acoustic', icon: Mic, name: 'Acoustic sensor' }];
  return (
    <Card title="Signal quality" sub="Assessed separately from the breathing result. Low quality never counts as normal and never counts as proof of a problem.">
      {!latest ? <p className="muted small">Quality appears with the first result.</p> : (
        <div className="stack">
          {rows.map(({ key, icon: I, name }) => {
            const c = latest.channels[key];
            if (c.fitted === false) return <div key={key} className="sensor" style={{ borderStyle: 'dashed', color: 'var(--ink-3)' }}><span className="row" style={{ gap: 8, fontWeight: 650 }}><I size={16} />{name}</span><p className="tiny" style={{ marginTop: 4 }}>Not fitted on {patch.name}.</p></div>;
            const down = !c.usable;
            return (
              <div key={key} className={`sensor ${down ? 'down hatch' : ''}`}>
                <div className="row-between">
                  <span className="row" style={{ gap: 8, fontWeight: 650 }}><I size={16} />{name}</span>
                  {down ? <Badge tone="warn">Unusable</Badge> : c.reliable ? <Badge tone="good">Used</Badge> : <Badge tone="neutral">Not trusted</Badge>}
                </div>
                <div className="row" style={{ marginTop: 8 }}><div style={{ flex: 1 }}><Meter value={c.sqi} /></div><span className="small" style={{ width: 42, textAlign: 'right' }}>{Math.round(c.sqi * 100)}%</span></div>
                {c.rate != null && <div className="tiny muted" style={{ marginTop: 6 }}>Reads {c.rate.toFixed(1)}/min · rhythm {c.periodicity?.toFixed(2)} · {Math.round(c.bandRatio * 100)}% in breathing band</div>}
                {c.issues.length > 0 && <ul className="tiny" style={{ margin: '6px 0 0', paddingLeft: 16, color: 'var(--ink-2)' }}>{c.issues.slice(0, 3).map((x, i) => <li key={i}>{x}</li>)}</ul>}
              </div>
            );
          })}
          <div className={`sensor ${latest.motionOk ? '' : 'down hatch'}`}>
            <div className="row-between"><span className="row" style={{ gap: 8, fontWeight: 650 }}><Move size={16} />Movement sensor</span>{latest.motionOk ? <Badge tone="info">Context only</Badge> : <Badge tone="warn">Unavailable</Badge>}</div>
            <p className="tiny muted" style={{ marginTop: 6 }}>{latest.motionOk ? 'Detects walking, coughs and posture changes. It cannot measure breathing.' : 'Without movement data, the engine cannot rule out movement artefacts, so it trusts the chest signal less.'}</p>
          </div>
          {latest.corroboration != null && <p className="tiny muted">Chest–acoustic agreement on breath timing: {latest.corroboration.toFixed(2)} (1.0 = identical).</p>}
        </div>
      )}
    </Card>
  );
}

function Hypotheses({ latest }) {
  const { artefact, genuine, uncertainty } = latest.evidence;
  return (
    <Card title="Movement artefact or genuine change?" sub="Two competing explanations. Bars are heuristic evidence weights, not probabilities.">
      <div className="stack">
        <div className="hyp-col">
          <div className="row-between"><strong className="small">Explained by movement or sensor problems</strong><span className="small">{Math.round(latest.hypotheses.artefact * 100)}</span></div>
          <div style={{ marginTop: 6 }}><Meter value={latest.hypotheses.artefact} color="#3b82c4" /></div>
          {artefact.length ? <ul>{artefact.map((e, i) => <li key={i}>{e}</li>)}</ul> : <p className="tiny muted" style={{ marginTop: 8 }}>No movement or artefact evidence in this window.</p>}
        </div>
        <div className="hyp-col">
          <div className="row-between"><strong className="small">Potentially genuine respiratory change</strong><span className="small">{Math.round(latest.hypotheses.genuine * 100)}</span></div>
          <div style={{ marginTop: 6 }}><Meter value={latest.hypotheses.genuine} color={OUTCOME_COLOR.concerning} /></div>
          {genuine.length ? <ul>{genuine.map((e, i) => <li key={i}>{e}</li>)}</ul> : <p className="tiny muted" style={{ marginTop: 8 }}>No evidence of a change from baseline.</p>}
        </div>
        {uncertainty.length > 0 && (
          <div className="notice warn small">
            <div className="row" style={{ gap: 6, fontWeight: 650 }}><Info size={15} />What limits certainty</div>
            <ul style={{ margin: '6px 0 0', paddingLeft: 18 }}>{uncertainty.map((e, i) => <li key={i}>{e}</li>)}</ul>
          </div>
        )}
      </div>
    </Card>
  );
}

function CompareCard({ ids, baseline }) {
  const steps = ids.map((x) => (typeof x === 'string' ? JUDGE_STEPS.find((s) => s.id === x) : x));
  const res = useMemo(() => steps.map((s) => runStep(s, baseline)), [steps.map((s) => s.id).join(), baseline.rate]); // eslint-disable-line react-hooks/exhaustive-deps
  const yesNo = (c) => (c.fitted === false ? 'not fitted' : c.reliable ? 'trusted' : c.usable ? 'not trusted' : 'unusable');
  return (
    <Card title="Side by side" sub="Both computed live by the engine from the presets.">
      <div className="compare">
        {steps.map((s, i) => {
          const r = res[i];
          return (
            <div key={s.id} className="stack-s">
              <div className="row-between"><strong>{PATCHES[s.patch].name}</strong><OutcomeChip outcome={r.outcome} /></div>
              <span className="small muted">{getScenario(s.scenario).name} · window ending {s.to}s</span>
              <dl className="kv" style={{ gridTemplateColumns: '150px 1fr', fontSize: '0.85rem' }}>
                <dt>Detected activity</dt><dd>{ACT_LABEL[r.activity.dominant]}</dd>
                <dt>Chest sensor</dt><dd>{yesNo(r.channels.chest)}</dd>
                <dt>Acoustic sensor</dt><dd>{yesNo(r.channels.acoustic)}</dd>
                <dt>Sensors agree?</dt><dd>{r.corroboration != null && r.corroboration >= 0.6 ? 'Yes, same breath pattern' : r.channels.acoustic.fitted === false ? 'Nothing to compare' : 'No strong agreement'}</dd>
                <dt>Rate</dt><dd>{r.rate != null ? `${r.rate.toFixed(1)}/min (expected ${r.range.lo.toFixed(0)}–${r.range.hi.toFixed(0)})` : '—'}</dd>
              </dl>
            </div>
          );
        })}
      </div>
    </Card>
  );
}

function JudgeSummary({ baseline }) {
  const rows = useMemo(() => JUDGE_STEPS.filter((s) => !s.summary && !s.portal).map((s) => ({ s, r: runStep(s, baseline) })), [baseline.rate]); // eslint-disable-line react-hooks/exhaustive-deps
  const cards = [
    { outcome: 'within', title: 'Movement artefact', text: 'The chest signal changed, but movement explained it and the other evidence stayed normal. No false alarm.' },
    { outcome: 'concerning', title: 'Genuine simulated change', text: 'The change stayed in trustworthy readings with little movement, and independent sensors agreed. It deserves attention.' },
    { outcome: 'insufficient', title: 'Unreliable measurement', text: 'Sensors failed, or one sensor could not be cross-checked during movement. BreatheGuard says it cannot tell instead of guessing.' },
  ];
  return (
    <div className="stack-l">
      <div className="grid-3">
        {cards.map((c) => (
          <div key={c.outcome} className={`verdict ${c.outcome} ${c.outcome === 'insufficient' ? 'hatch' : ''}`} style={{ gridTemplateColumns: '1fr' }}>
            <div><OutcomeChip outcome={c.outcome} /><div className="verdict-title" style={{ fontSize: '1.15rem', marginTop: 8 }}>{c.title}</div><p className="small" style={{ marginTop: 4 }}>{c.text}</p></div>
          </div>
        ))}
      </div>
      <Card title="What each demo step produced" sub="Recomputed now by the engine, not typed in.">
        <div className="table-wrap">
          <table className="table">
            <thead><tr><th>Step</th><th>Patch</th><th>Situation</th><th>Result</th></tr></thead>
            <tbody>{rows.map(({ s, r }, i) => <tr key={s.id}><td>{i + 1}. {s.title}</td><td>{PATCHES[s.patch].name.replace('BreatheGuard ', '')}</td><td className="small muted">{getScenario(s.scenario).name}{s.failures?.length ? ` + ${s.failures.length} injected failure${s.failures.length > 1 ? 's' : ''}` : ''}</td><td><OutcomeChip outcome={r.outcome} /></td></tr>)}</tbody>
          </table>
        </div>
      </Card>
      <Card title="The trust layer around the results" sub="Shown in steps 7–9 of the demo.">
        <div className="grid-3 small">
          <div><strong>Patients</strong><p className="muted">See only authority-approved hospitals and individually verified doctors.</p></div>
          <div><strong>Hospitals</strong><p className="muted">See a patient’s reports only with that patient’s consent.</p></div>
          <div><strong>Authority</strong><p className="muted">Decides with written reasons, recorded in an audit trail. No self-approval.</p></div>
        </div>
      </Card>
      <section className="patch-hero summary-hero">
        <div>
          <h1 style={{ fontSize: '1.6rem' }}>BreatheGuard doesn’t just detect a changing signal. It asks whether that signal can be trusted.</h1>
          <p className="tag">See Beyond the Signal. Understand the Breathing.</p>
          <p className="small" style={{ marginTop: 10 }}>Simulated data and proposed hardware. Not clinically validated.</p>
        </div>
        <div style={{ background: '#f0f6f9', borderRadius: 10, padding: 8 }}><PatchArt variant="care" width={180} /></div>
      </section>
    </div>
  );
}
