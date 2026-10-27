import { useState } from 'react';
import { Pill, Plus, Trash2, Sun, Sunset, Moon, ExternalLink, Upload } from 'lucide-react';
import { useStore, fmtDate } from '../../data/store.jsx';
import { addPrescription, toggleDose } from '../../data/actions.js';
import { explainMedicine } from '../../data/medicines.js';
import { Card, Btn, Badge, Field, Empty, PageHead } from '../../components/ui.jsx';

const SLOTS = [{ k: 'morning', l: 'Morning', I: Sun }, { k: 'afternoon', l: 'Afternoon', I: Sunset }, { k: 'night', l: 'Night', I: Moon }];
const currentSlot = () => { const h = new Date().getHours(); return h < 12 ? 'morning' : h < 18 ? 'afternoon' : 'night'; };
const blank = () => ({ name: '', dose: '', slots: { morning: false, afternoon: false, night: false }, asNeeded: false });

export default function Medicines() {
  const { state, user, act } = useStore();
  const mine = state.prescriptions.filter((p) => p.patientId === user.id);
  const items = mine.flatMap((p) => p.items);
  const today = new Date().toISOString().slice(0, 10);
  const slotNow = currentSlot();
  const [rows, setRows] = useState([blank()]);
  const [prescriber, setPrescriber] = useState('');
  const [fileName, setFileName] = useState('');
  const upd = (i, patch) => setRows((r) => r.map((x, j) => (j === i ? { ...x, ...patch } : x)));
  const submit = () => {
    const ok = act(addPrescription, { prescriber, items: rows.filter((r) => r.name.trim()).map((r) => ({ ...r, attachment: fileName || undefined })) }, 'Prescription added and reminders created.');
    if (ok) { setRows([blank()]); setPrescriber(''); setFileName(''); }
  };
  return (
    <div className="stack-l">
      <PageHead title="Medicines and reminders" text="Record what your prescriber wrote. BreatheGuard never suggests, changes or doses medicines." actions={<Badge tone="demo">Demo feature</Badge>} />
      <Card title="Today’s reminders" sub={`${fmtDate(new Date().toISOString())}. In-app only; no push notifications in this demo.`}>
        {items.some((m) => !m.asNeeded) ? (
          <div className="grid-3">
            {SLOTS.map(({ k, l, I }) => {
              const due = items.filter((m) => !m.asNeeded && m.slots[k]);
              return (
                <div key={k} className="sensor" style={k === slotNow ? { borderColor: 'var(--brand)', boxShadow: 'inset 3px 0 0 var(--brand)' } : undefined}>
                  <div className="row-between"><span className="row" style={{ gap: 6, fontWeight: 650 }}><I size={16} />{l}</span>{k === slotNow && <Badge tone="info">Now</Badge>}</div>
                  <div className="stack-s" style={{ marginTop: 8 }}>
                    {due.length ? due.map((m) => {
                      const key = `${today}|${m.id}|${k}`;
                      const taken = !!state.doseLog[`${user.id}|${key}`];
                      return <label key={m.id} className="check"><input type="checkbox" checked={taken} onChange={() => act(toggleDose, { key })} /><span style={taken ? { textDecoration: 'line-through', color: 'var(--ink-3)' } : undefined}>{m.name}</span></label>;
                    }) : <span className="small muted">Nothing scheduled</span>}
                  </div>
                </div>
              );
            })}
          </div>
        ) : <p className="small muted">No scheduled medicines. As-needed medicines are not added to reminders.</p>}
      </Card>

      <Card title="Your medicines" sub="Plain-English descriptions come from a small reviewed list with sources. Anything not on the list says so.">
        {items.length ? items.map((m) => {
          const ex = explainMedicine(m.name);
          return (
            <div key={m.id} className="list-item stack-s">
              <div className="row-between"><strong>{m.name}</strong><span className="small muted">{m.asNeeded ? 'As needed' : SLOTS.filter((s) => m.slots[s.k]).map((s) => s.l).join(', ')}</span></div>
              {m.dose && <span className="small">As written by prescriber: {m.dose}</span>}
              {ex ? (
                <div className="notice small"><strong>{ex.kind}.</strong> {ex.text} <a href={ex.source.url} target="_blank" rel="noreferrer">{ex.source.label} <ExternalLink size={12} /></a></div>
              ) : <div className="notice warn small">No reviewed explanation for this medicine in the demo. Ask your pharmacist or read the leaflet in the pack.</div>}
            </div>
          );
        }) : <Empty icon={Pill} title="No medicines recorded" text="Add one below from your prescription." />}
        {mine.length > 0 && <p className="tiny muted" style={{ marginTop: 8 }}>Sources of entries: {[...new Set(mine.map((p) => `${p.source} (${p.prescriber})`))].join('; ')}</p>}
      </Card>

      <Card title="Add a prescription" sub="Type it exactly as written. The file upload stores only the file name in this demo; it is not read or analysed.">
        <div className="stack">
          <div className="grid-2">
            <Field label="Prescriber"><input className="input" value={prescriber} onChange={(e) => setPrescriber(e.target.value)} placeholder="e.g. Dr. Mei Lin (demo)" /></Field>
            <Field label="Prescription file" hint="optional, name only">
              <label className="btn" style={{ justifyContent: 'center' }}><Upload size={16} />{fileName || 'Choose image or PDF'}<input type="file" accept="image/*,.pdf" hidden onChange={(e) => setFileName(e.target.files?.[0]?.name || '')} /></label>
            </Field>
          </div>
          {rows.map((r, i) => (
            <div key={i} className="sensor stack-s">
              <div className="grid-2">
                <Field label="Medicine"><input className="input" value={r.name} onChange={(e) => upd(i, { name: e.target.value })} placeholder="Name as written" /></Field>
                <Field label="Dose and instructions" hint="as written"><input className="input" value={r.dose} onChange={(e) => upd(i, { dose: e.target.value })} /></Field>
              </div>
              <div className="row">
                {SLOTS.map(({ k, l }) => <label key={k} className="check"><input type="checkbox" disabled={r.asNeeded} checked={r.slots[k]} onChange={(e) => upd(i, { slots: { ...r.slots, [k]: e.target.checked } })} />{l}</label>)}
                <label className="check"><input type="checkbox" checked={r.asNeeded} onChange={(e) => upd(i, { asNeeded: e.target.checked })} />As needed</label>
                {rows.length > 1 && <Btn size="sm" variant="ghost" icon={Trash2} onClick={() => setRows(rows.filter((_, j) => j !== i))}>Remove</Btn>}
              </div>
            </div>
          ))}
          <div className="row"><Btn icon={Plus} onClick={() => setRows([...rows, blank()])}>Add another medicine</Btn><Btn variant="primary" onClick={submit}>Save prescription</Btn></div>
        </div>
      </Card>

      <Card title="Medicine interaction check" actions={<Badge tone="warn">Not implemented</Badge>}>
        <p className="small muted" style={{ maxWidth: '80ch' }}>
          This feature is intentionally not built. Showing interactions requires a maintained, licensed interaction database, which this hackathon demo does not have. We will not show made-up interaction warnings. Ask your pharmacist to check your full list of medicines.
        </p>
      </Card>
    </div>
  );
}
