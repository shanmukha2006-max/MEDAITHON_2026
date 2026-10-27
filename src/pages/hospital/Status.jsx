import { useState } from 'react';
import { useStore, fmtDateTime } from '../../data/store.jsx';
import { resubmitHospital, STATUS_LABEL } from '../../data/actions.js';
import { Card, Btn, StatusBadge, Field, PageHead, Badge } from '../../components/ui.jsx';

const NEXT = {
  pending: 'The healthcare authority is reviewing your application. You can still correct details.',
  approved: 'Your hospital appears in the patient directory. Doctors still need their own credential verification.',
  more_info: 'The authority needs corrections before it can decide. Update the details below and resubmit.',
  rejected: 'This application was rejected. A new application from a new account is required. Contact the authority if you believe this is a mistake.',
  suspended: 'Your hospital and its doctors are hidden from patients until the authority reinstates approval.',
};

export default function Status() {
  const { state, user, act } = useStore();
  const h = state.hospitals.find((x) => x.id === user.hospitalId);
  const history = state.audit.filter((a) => a.targetType === 'hospital' && a.targetId === h.id);
  const editable = ['pending', 'more_info'].includes(h.status);
  const [f, setF] = useState({ name: h.name, city: h.city, address: h.address, registrationNo: h.registrationNo, beds: h.beds, services: h.services, documents: h.documents });
  return (
    <div className="stack-l">
      <PageHead title="Registration status" text="Only the healthcare authority can change this status. Your account cannot approve itself." />
      <div className={`notice ${h.status === 'approved' ? '' : h.status === 'more_info' || h.status === 'pending' ? 'warn' : 'bad'}`}>
        <div className="row" style={{ gap: 8 }}><StatusBadge status={h.status} /><strong>{STATUS_LABEL[h.status]}</strong></div>
        <p style={{ marginTop: 6 }}>{NEXT[h.status]}</p>
        {h.statusReason && <p style={{ marginTop: 6 }}><strong>Authority’s reason:</strong> {h.statusReason}</p>}
      </div>
      <div className="grid-2">
        <Card title="Submitted information" sub={`Last submitted ${fmtDateTime(h.submittedAt)}`} actions={<Badge tone="demo">Demo application</Badge>}>
          {editable ? (
            <div className="stack">
              <Field label="Hospital name"><input className="input" value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} /></Field>
              <div className="grid-2">
                <Field label="City"><input className="input" value={f.city} onChange={(e) => setF({ ...f, city: e.target.value })} /></Field>
                <Field label="Registration no." hint="demo"><input className="input" value={f.registrationNo} onChange={(e) => setF({ ...f, registrationNo: e.target.value })} /></Field>
              </div>
              <Field label="Address"><input className="input" value={f.address} onChange={(e) => setF({ ...f, address: e.target.value })} /></Field>
              <div className="grid-2">
                <Field label="Beds"><input className="input" type="number" value={f.beds} onChange={(e) => setF({ ...f, beds: e.target.value })} /></Field>
                <Field label="Services"><input className="input" value={f.services} onChange={(e) => setF({ ...f, services: e.target.value })} /></Field>
              </div>
              <Field label="Verification documents" hint="file names only in demo">
                <input type="file" multiple onChange={(e) => setF({ ...f, documents: [...(f.documents || []), ...[...e.target.files].map((x) => x.name)] })} />
              </Field>
              {f.documents?.length > 0 && <p className="small muted">Attached: {f.documents.join(', ')}</p>}
              <div><Btn variant="primary" onClick={() => act(resubmitHospital, { hospitalId: h.id, changes: { ...f, beds: Number(f.beds) || 0 } }, 'Application resubmitted for review.')}>Resubmit for review</Btn></div>
            </div>
          ) : (
            <dl className="kv">
              <dt>Name</dt><dd>{h.name}</dd><dt>City</dt><dd>{h.city}</dd><dt>Address</dt><dd>{h.address}</dd>
              <dt>Registration no.</dt><dd>{h.registrationNo}</dd><dt>Beds</dt><dd>{h.beds}</dd><dt>Services</dt><dd>{h.services}</dd>
              <dt>Documents</dt><dd>{h.documents?.length ? h.documents.join(', ') : 'None'}</dd>
            </dl>
          )}
        </Card>
        <Card title="Decision history">
          {history.length ? history.map((a) => (
            <div key={a.id} className="list-item small">
              <div className="row-between"><strong>{a.from ? `${STATUS_LABEL[a.from] || a.from} → ` : ''}{STATUS_LABEL[a.to] || a.to}</strong><span className="muted tiny">{fmtDateTime(a.at)}</span></div>
              <p className="muted">{a.reason}</p>
            </div>
          )) : <p className="small muted">No decisions yet.</p>}
        </Card>
      </div>
    </div>
  );
}
