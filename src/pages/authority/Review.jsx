// Shared review queue used for both hospital applications and doctor credentials.
import { useState } from 'react';
import { Gavel, FileSearch } from 'lucide-react';
import { useStore, fmtDateTime, nameOf } from '../../data/store.jsx';
import { decideHospital, decideDoctor, allowedDecisions, STATUS_LABEL, suspiciousSignals } from '../../data/actions.js';
import { Card, Btn, StatusBadge, Field, PageHead, Empty, Badge } from '../../components/ui.jsx';

const FILTERS = ['pending', 'more_info', 'approved', 'suspended', 'rejected'];
const VERB = { approved: 'Approve', rejected: 'Reject', more_info: 'Request corrections', suspended: 'Suspend' };
const DOC_DECISIONS = { pending: ['approved', 'rejected', 'more_info'], more_info: ['approved', 'rejected'], approved: ['suspended'], suspended: ['approved', 'rejected'], rejected: [] };

export default function Review({ kind, query = {} }) {
  const { state, act } = useStore();
  const items = kind === 'hospital' ? state.hospitals : state.doctors;
  // ?select=<id> opens one record directly (used by the Judge Demo)
  const preselect = query.select ? items.find((x) => x.id === query.select) : null;
  const [filter, setFilter] = useState(preselect ? preselect.status : 'pending');
  const [sel, setSel] = useState(preselect ? preselect.id : null);
  const [decision, setDecision] = useState('');
  const [reason, setReason] = useState('');
  const list = items.filter((x) => x.status === filter);
  const item = items.find((x) => x.id === sel);
  const signals = item ? suspiciousSignals(state).filter((s) => s.ids.includes(item.id)) : [];
  const history = item ? state.audit.filter((a) => a.targetId === item.id) : [];
  const options = item ? (kind === 'hospital' ? allowedDecisions(item.status) : DOC_DECISIONS[item.status]) : [];
  const docHospital = kind === 'doctor' && item ? state.hospitals.find((h) => h.id === item.hospitalId) : null;
  const choose = (id) => { setSel(id); setDecision(''); setReason(''); };
  const decide = () => {
    const fn = kind === 'hospital' ? decideHospital : decideDoctor;
    const payload = kind === 'hospital' ? { hospitalId: item.id, decision, reason } : { doctorId: item.id, decision, reason };
    if (act(fn, payload, `Decision recorded: ${STATUS_LABEL[decision]}.`)) { setDecision(''); setReason(''); }
  };
  return (
    <div className="stack-l">
      <PageHead title={kind === 'hospital' ? 'Hospital applications' : 'Doctor credentials'}
        text={kind === 'hospital' ? 'Review applications. Every decision needs a written reason and is recorded in the audit trail.' : 'Doctors are verified individually. A doctor can be approved only if their hospital is approved.'}
        actions={<Badge tone="demo">Demo authority · no real registry is checked</Badge>} />
      <div className="filter-tabs" role="tablist" aria-label="Filter by status">
        {FILTERS.map((f) => <button key={f} role="tab" aria-selected={filter === f} className={filter === f ? 'on' : ''} onClick={() => { setFilter(f); setSel(null); }}>{STATUS_LABEL[f]} ({items.filter((x) => x.status === f).length})</button>)}
      </div>
      <div className="grid-2 review-split">
        <div className="stack-s select-list">
          {list.length ? list.map((x) => (
            <button key={x.id} className={sel === x.id ? 'on' : ''} onClick={() => choose(x.id)}>
              <div className="row-between"><strong>{x.name}</strong><StatusBadge status={x.status} /></div>
              <div className="tiny muted">{kind === 'hospital' ? `${x.city} · ${x.registrationNo}` : `${x.specialty} · ${nameOf(state, x.hospitalId)}`}</div>
            </button>
          )) : <Card className="flat"><Empty icon={FileSearch} title="Nothing here" text={`No ${kind === 'hospital' ? 'applications' : 'doctors'} with status “${STATUS_LABEL[filter]}”.`} /></Card>}
        </div>
        {item ? (
          <Card title={item.name} actions={<StatusBadge status={item.status} />}>
            <div className="stack-l">
              {kind === 'hospital' ? (
                <dl className="kv">
                  <dt>Registration no.</dt><dd>{item.registrationNo}</dd><dt>City</dt><dd>{item.city}</dd><dt>Address</dt><dd>{item.address || '—'}</dd>
                  <dt>Contact</dt><dd>{item.contactEmail}</dd><dt>Beds</dt><dd>{item.beds}</dd><dt>Services</dt><dd>{item.services || '—'}</dd>
                  <dt>Documents</dt><dd>{item.documents?.length ? item.documents.join(', ') : <Badge tone="warn">None attached</Badge>}</dd>
                  <dt>Submitted</dt><dd>{fmtDateTime(item.submittedAt)}</dd>
                  <dt>Doctors</dt><dd>{state.doctors.filter((d) => d.hospitalId === item.id).length} submitted (verified separately)</dd>
                </dl>
              ) : (
                <dl className="kv">
                  <dt>Specialty</dt><dd>{item.specialty}</dd><dt>Licence no.</dt><dd>{item.licenseNo}</dd><dt>Qualifications</dt><dd>{item.qualifications || '—'}</dd>
                  <dt>Hospital</dt><dd>{docHospital.name} <StatusBadge status={docHospital.status} /></dd><dt>Submitted</dt><dd>{fmtDateTime(item.submittedAt)}</dd>
                </dl>
              )}
              {signals.length > 0 && <div className="notice bad small"><strong>Automated flags</strong><ul style={{ margin: '4px 0 0', paddingLeft: 18 }}>{signals.map((s, i) => <li key={i}>{s.kind}: {s.detail}</li>)}</ul></div>}
              {kind === 'doctor' && docHospital.status !== 'approved' && <div className="notice warn small">The doctor’s hospital is not approved, so approval is blocked.</div>}
              <div className="stack">
                <h3 className="row" style={{ gap: 6 }}><Gavel size={16} />Decision</h3>
                {options.length ? (
                  <>
                    <div className="row">{options.map((o) => <Btn key={o} size="sm" variant={decision === o ? 'primary' : o === 'approved' ? 'good' : o === 'more_info' ? '' : 'danger'} onClick={() => setDecision(o)}>{item.status === 'suspended' && o === 'approved' ? 'Reinstate' : VERB[o]}</Btn>)}</div>
                    {item.status === 'more_info' && kind === 'hospital' && <p className="tiny muted">Approval becomes available after the hospital resubmits its corrections.</p>}
                    <Field label="Reason" hint="required, at least 10 characters, shown to the applicant">
                      <textarea className="textarea" value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Explain what was checked and why" />
                    </Field>
                    <div><Btn variant="primary" disabled={!decision} onClick={decide}>{decision ? `Record decision: ${STATUS_LABEL[decision]}` : 'Choose a decision'}</Btn></div>
                  </>
                ) : <p className="small muted">No further decisions are available from “{STATUS_LABEL[item.status]}”.</p>}
              </div>
              <div className="stack-s">
                <h3>History</h3>
                {history.length ? history.map((a) => <div key={a.id} className="small list-item"><strong>{a.from ? `${STATUS_LABEL[a.from] || a.from} → ` : ''}{STATUS_LABEL[a.to] || a.to}</strong> <span className="tiny muted">{fmtDateTime(a.at)} · {nameOf(state, a.actorId)}</span><p className="muted">{a.reason}</p></div>) : <p className="small muted">No history.</p>}
              </div>
            </div>
          </Card>
        ) : <Card className="flat"><Empty icon={FileSearch} title="Select an item" text="Choose an application on the left to review its details and record a decision." /></Card>}
      </div>
    </div>
  );
}
