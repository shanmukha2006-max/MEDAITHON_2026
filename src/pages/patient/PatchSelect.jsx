import { useEffect, useRef, useState } from 'react';
import { Activity, Mic, Move, PlayCircle, Presentation, AlertTriangle } from 'lucide-react';
import { PATCHES, PATCH_LIST, TRADEOFFS } from '../../sim/patches.js';
import Roadmap from '../../components/Roadmap.jsx';
import Body3D from '../../components/Body3D.jsx';
import { useStore } from '../../data/store.jsx';
import { setBodyModel } from '../../data/actions.js';
import { PatchArt, PlacementDiagram, CareLayers } from '../../components/PatchArt.jsx';
import { Card, Btn, Badge } from '../../components/ui.jsx';

const SENSOR_ICON = { 'Chest-motion sensing': Activity, 'Acoustic breathing sensing': Mic, 'Movement/activity sensing': Move };

const ROWS = [
  ['Intended use', 'use'],
  ['Sensing configuration', 'sensing'],
  ['Proposed wear duration', 'wear'],
  ['Reusability', 'reuse'],
  ['Development status', 'status'],
];

export default function PatchSelect({ go, query = {}, routeKey }) {
  const [diagram, setDiagram] = useState('care');
  const { user, act } = useStore();
  const roadmapRef = useRef(null);
  // ?focus=roadmap scrolls to the roadmap (used by the Judge Demo)
  useEffect(() => {
    if (query.focus === 'roadmap' && roadmapRef.current) setTimeout(() => roadmapRef.current.scrollIntoView({ behavior: 'smooth', block: 'start' }), 150);
    else window.scrollTo(0, 0);
  }, [routeKey]); // eslint-disable-line react-hooks/exhaustive-deps
  return (
    <div className="stack-l">
      <section className="patch-hero">
        <div className="stack">
          <div>
            <h1>Choose your BreatheGuard patch</h1>
            <p className="tag">See Beyond the Signal. Understand the Breathing.</p>
          </div>
          <p style={{ maxWidth: '60ch' }}><strong style={{ color: '#fff' }}>The problem:</strong> breathing sensors on the body also pick up movement, coughs, posture changes and sensor faults, so a changing signal is not always a changing breath.</p>
          <p style={{ maxWidth: '60ch' }}><strong style={{ color: '#fff' }}>Our proposed solution:</strong> a wearable chest patch, in two versions, whose software checks whether a signal can be trusted before judging it, and says “insufficient reliable data” when it can’t. Both run here as browser simulations with synthetic data.</p>
          <div className="row">
            <Btn variant="teal" icon={Presentation} onClick={() => go('monitor', { judge: '1' })}>Start Judge Demo</Btn>
          </div>
        </div>
        <div className="row" style={{ justifyContent: 'center', gap: 0, background: '#f0f6f9', borderRadius: 10, padding: 10 }}>
          <PatchArt variant="care" width={200} />
          <PatchArt variant="quick" width={170} />
        </div>
      </section>

      <div className="notice warn small">
        <strong>Proposed designs, not built devices.</strong> Neither patch has been manufactured or clinically validated. Wear times, costs and sensor performance below are targets to be validated, not achieved specifications.
      </div>

      <div className="grid-2">
        {PATCH_LIST.map((p) => (
          <Card key={p.id} className="patch-card">
            <div className="patch-art"><PatchArt variant={p.id} /></div>
            <div className="row-between">
              <h2>{p.name}</h2>
              <Badge tone="demo">Proposed concept</Badge>
            </div>
            <p className="tiny muted">Proposed hardware concept. Not manufactured or clinically validated.</p>
            <p className="small" style={{ marginTop: 4, fontWeight: 600, color: 'var(--brand-2)' }}>{p.concept}</p>
            <p className="small muted" style={{ marginTop: 4 }}>For: {p.audience}.</p>
            <ul>{p.highlights.map((h) => <li key={h}>{h}</li>)}</ul>
            <div className="stack-s" style={{ marginBottom: 14 }}>
              <span className="tiny muted">Sensors simulated in this demo</span>
              <div className="row" style={{ gap: 6 }}>
                {['Chest-motion sensing', 'Acoustic breathing sensing', 'Movement/activity sensing'].map((s) => {
                  const on = p.sensors.includes(s);
                  const I = SENSOR_ICON[s];
                  return <Badge key={s} tone={on ? 'info' : 'neutral'}><I size={12} />{on ? s.replace(' sensing', '') : `No ${s.split(' ')[0].toLowerCase()}`}</Badge>;
                })}
              </div>
            </div>
            {p.limitation && <div className="notice warn small" style={{ marginBottom: 14 }}><AlertTriangle size={14} style={{ verticalAlign: -2 }} /> {p.limitation}</div>}
            <div style={{ marginTop: 'auto' }}>
              <Btn variant="primary" icon={PlayCircle} onClick={() => go('monitor', { patch: p.id })}>Explore {p.id === 'care' ? 'Care' : 'Quick'} Simulation</Btn>
            </div>
          </Card>
        ))}
      </div>

      <Card title="Compare the two patches" sub="“Target”, “Proposed” and “to be validated” mark specifications that are not yet established.">
        <div className="table-wrap">
          <table className="table">
            <thead><tr><th style={{ width: '22%' }} /><th>BreatheGuard Care</th><th>BreatheGuard Quick</th></tr></thead>
            <tbody>
              {ROWS.map(([label, key]) => (
                <tr key={key}><td><strong>{label}</strong></td><td>{PATCHES.care.proposed[key]}</td><td>{PATCHES.quick.proposed[key]}</td></tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>

      <Card title="Trade-offs" sub="Qualitative only. No prices, battery life or accuracy figures exist for hardware that has not been built.">
        <div className="table-wrap">
          <table className="table">
            <thead><tr><th style={{ width: '22%' }} /><th>BreatheGuard Care</th><th>BreatheGuard Quick</th></tr></thead>
            <tbody>{TRADEOFFS.map((t) => <tr key={t.dim}><td><strong>{t.dim}</strong></td><td>{t.care}</td><td>{t.quick}</td></tr>)}</tbody>
          </table>
        </div>
        <p className="small muted" style={{ marginTop: 10 }}>In short: Care trades cost and complexity for more evidence; Quick trades evidence for simplicity and lower cost per patch, and is honest about what it cannot tell.</p>
      </Card>

      <Card title="Where the patch sits: breathing in 3D" sub="The patch sits on the lower ribcage over the diaphragm, the main breathing muscle. Watch the diaphragm move down and the lungs fill on each breath.">
        <Body3D bodyModel={user?.bodyModel || 'female'} onBodyModelChange={(m) => act(setBodyModel, { bodyModel: m }, `Body model set to ${m}.`)} initialPatch={diagram} />
      </Card>

      <div className="grid-2">
        <Card title="Care: proposed layer design" sub="A reusable module with a replaceable adhesive layer is a design option to explore, not a decided feature.">
          <CareLayers />
        </Card>
        <Card title="What is real and what is proposed">
          <div className="stack small">
            <div><Badge tone="good">Implemented software</Badge><p className="muted" style={{ marginTop: 4 }}>Signal simulator, analysis engine, three-outcome results with explanations, patch-specific sensor configurations, Judge Demo, and the three portals.</p></div>
            <div><Badge tone="info">Simulated</Badge><p className="muted" style={{ marginTop: 4 }}>All sensor signals, movement, coughs, posture changes, noise and sensor failures.</p></div>
            <div><Badge tone="warn">Proposed hardware, to be validated</Badge><p className="muted" style={{ marginTop: 4 }}>The physical patches, sensors, adhesive and skin safety, battery life, wear duration, reusable module, disposal approach and cost.</p></div>
            <div><Badge tone="bad">Requires clinical validation</Badge><p className="muted" style={{ marginTop: 4 }}>Whether the analysis detects real respiratory changes in real people. Nothing here has been tested on humans.</p></div>
          </div>
        </Card>
      </div>

      <section ref={roadmapRef} className="roadmap-anchor">
        <Card title="Future hardware-validation roadmap" sub="Each phase must pass its gate before the next. No dates are set; only phase 1 is done.">
          <Roadmap />
        </Card>
      </section>

      <div className="notice bad small">
        A normal simulated result says nothing about a real person’s health. If you or someone else has breathing difficulty or symptoms that are getting worse, seek medical help now. Do not wait for this app.
      </div>
    </div>
  );
}
