import { useState } from 'react';
import { UserPlus, Stethoscope } from 'lucide-react';
import { useStore, fmtDate } from '../../data/store.jsx';
import { submitDoctor, doctorRating } from '../../data/actions.js';
import { Card, Btn, StatusBadge, Field, PageHead, Empty, Stars } from '../../components/ui.jsx';

export default function Doctors() {
  const { state, user, act } = useStore();
  const h = state.hospitals.find((x) => x.id === user.hospitalId);
  const docs = state.doctors.filter((d) => d.hospitalId === h.id);
  const [f, setF] = useState({ name: '', specialty: '', licenseNo: '', qualifications: '' });
  const canSubmit = h.status === 'approved';
  return (
    <div className="stack-l">
      <PageHead title="Doctors" text="Each doctor’s credentials are verified separately by the authority. Your hospital’s approval does not verify them." />
      <Card bodyClass="table-wrap">
        {docs.length ? (
          <table className="table">
            <thead><tr><th>Doctor</th><th>Specialty</th><th>Licence</th><th>Status</th><th>Rating</th><th>Submitted</th></tr></thead>
            <tbody>{docs.map((d) => { const r = doctorRating(state, d.id); return (
              <tr key={d.id}>
                <td><strong>{d.name}</strong>{d.statusReason && <div className="tiny muted">{d.statusReason}</div>}</td>
                <td>{d.specialty}</td><td className="small">{d.licenseNo}</td><td><StatusBadge status={d.status} /></td>
                <td className="small">{r.count ? <span className="row" style={{ gap: 4 }}><Stars value={r.avg} size={12} />{r.avg.toFixed(1)} ({r.count})</span> : '—'}</td>
                <td className="small">{fmtDate(d.submittedAt)}</td>
              </tr>); })}</tbody>
          </table>
        ) : <Empty icon={Stethoscope} title="No doctors submitted" text={canSubmit ? 'Submit your first doctor for credential verification below.' : 'You can submit doctors once your hospital is approved.'} />}
      </Card>
      <Card title="Submit a doctor for verification" sub={canSubmit ? 'The doctor will appear to patients only after the authority verifies them.' : 'Available after your hospital is approved.'}>
        <fieldset disabled={!canSubmit} style={{ border: 0, padding: 0, margin: 0 }}>
          <div className="stack">
            <div className="grid-2">
              <Field label="Full name"><input className="input" value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} placeholder="Dr. …" /></Field>
              <Field label="Specialty"><input className="input" value={f.specialty} onChange={(e) => setF({ ...f, specialty: e.target.value })} /></Field>
              <Field label="Licence number" hint="use a DEMO- number"><input className="input" value={f.licenseNo} onChange={(e) => setF({ ...f, licenseNo: e.target.value })} placeholder="DEMO-D-…" /></Field>
              <Field label="Qualifications"><input className="input" value={f.qualifications} onChange={(e) => setF({ ...f, qualifications: e.target.value })} /></Field>
            </div>
            <div><Btn variant="primary" icon={UserPlus} onClick={() => act(submitDoctor, f, 'Doctor submitted for verification.') && setF({ name: '', specialty: '', licenseNo: '', qualifications: '' })}>Submit for verification</Btn></div>
          </div>
        </fieldset>
      </Card>
    </div>
  );
}
