import { CheckCircle2, CircleDot, Circle } from 'lucide-react';
import { ROADMAP } from '../sim/patches.js';

// Phases in order with the gate each must pass. A stepped strip, not a dated timeline:
// no dates have been set for any hardware or clinical work.
export default function Roadmap() {
  return (
    <ol className="roadmap" aria-label="Future hardware-validation roadmap">
      {ROADMAP.map((r, i) => {
        const I = r.status === 'done' ? CheckCircle2 : r.status === 'next' ? CircleDot : Circle;
        return (
          <li key={r.phase} className={`rm-${r.status}`}>
            <div className="rm-head"><I size={18} aria-hidden /><span className="rm-num">{i + 1}</span><strong>{r.phase}</strong>{r.status === 'done' && <span className="badge good">Done</span>}{r.status === 'next' && <span className="badge info">Next</span>}</div>
            <p className="small muted">{r.what}</p>
            <p className="tiny"><strong>Gate:</strong> {r.gate}</p>
          </li>
        );
      })}
    </ol>
  );
}
