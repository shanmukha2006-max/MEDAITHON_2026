import { useState } from 'react';
import { ChevronLeft, ChevronRight, X, Repeat, Activity, Building2, Landmark, User, Minimize2, Maximize2 } from 'lucide-react';
import { JUDGE_STEPS } from '../sim/judgeDemo.js';
import { useStore } from '../data/store.jsx';
import { Btn } from './ui.jsx';

const PORTAL_ICON = { u_pat1: User, u_hosp1: Building2, u_auth1: Landmark };
const PORTAL_NAME = { u_pat1: 'Patient portal', u_hosp1: 'Hospital portal', u_auth1: 'Authority portal' };

// Narration bar shown at the top of every portal while the Judge Demo runs.
export default function JudgeBar() {
  const { judge, judgeGo, judgeExit, simRunning } = useStore();
  const [mini, setMini] = useState(false);
  if (!judge) return null;
  const index = judge.i, step = JUDGE_STEPS[index], n = JUDGE_STEPS.length;
  const where = step.where || (step.portal ? PORTAL_NAME[step.portal.user] : step.summary ? 'Summary' : 'Simulator');
  const I = step.portal ? PORTAL_ICON[step.portal.user] : Activity;
  return (
    <>
    <nav className="judge-mini" aria-label="Judge Demo quick controls">
      <button onClick={() => judgeGo(Math.max(0, index - 1))} disabled={index === 0} aria-label="Previous step"><ChevronLeft size={18} /></button>
      <span>Step {index + 1}/{n}</span>
      <button onClick={() => judgeGo(index < n - 1 ? index + 1 : 0)} aria-label={index < n - 1 ? 'Next step' : 'Restart demo'}>{index < n - 1 ? <ChevronRight size={18} /> : <Repeat size={16} />}</button>
    </nav>
    <section className={`judge ${mini ? 'mini-mode' : ''}`} aria-live="polite" aria-label="Judge Demo">
      <div className="row-between">
        <span className="small row" style={{ color: '#7fe6f2', fontWeight: 650, gap: 6 }}><I size={14} />Judge Demo · step {index + 1} of {n} · {where}{simRunning && !step.portal ? ' · playing' : ''}</span>
        <div className="judge-dots">{JUDGE_STEPS.map((s, i) => <button key={s.id} className={i === index ? 'on' : i < index ? 'done' : ''} onClick={() => judgeGo(i)} aria-label={`Go to step ${i + 1}: ${s.title}`} />)}</div>
      </div>
      <h2 style={{ marginTop: 6 }}>{step.title}</h2>
      <p className="say">{step.say}</p>
      <p className="look">Look at: {step.look}</p>
      <div className="row" style={{ marginTop: 10 }}>
        <Btn size="sm" icon={ChevronLeft} disabled={index === 0} onClick={() => judgeGo(index - 1)}>Back</Btn>
        {!step.summary && <Btn size="sm" icon={Repeat} onClick={() => judgeGo(index)}>Replay step</Btn>}
        {index < n - 1 ? <Btn size="sm" variant="primary" onClick={() => judgeGo(index + 1)}>Next step <ChevronRight size={15} /></Btn> : <Btn size="sm" variant="primary" onClick={() => judgeGo(0)}>Restart demo</Btn>}
        <Btn size="sm" icon={X} onClick={judgeExit}>Exit demo</Btn>
        <Btn size="sm" icon={mini ? Maximize2 : Minimize2} onClick={() => setMini(!mini)} aria-pressed={mini}>{mini ? 'Show narration' : 'Minimise'}</Btn>
      </div>
      <p className="tiny judge-help" style={{ marginTop: 8, color: '#8fa5c2' }}>Stuck or a chart not updating? Press <strong style={{ color: '#c9d6e8' }}>Replay step</strong>. Still stuck: Exit demo, then Reset demo data (sidebar), then Judge Demo again.</p>
    </section>
    </>
  );
}
