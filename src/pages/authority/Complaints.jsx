import { useState } from 'react';
import { ShieldAlert } from 'lucide-react';
import { useStore, fmtDateTime, nameOf } from '../../data/store.jsx';
import { resolveComplaint, suspiciousSignals } from '../../data/actions.js';
import { Card, Btn, StatusBadge, Stars, PageHead, Empty, Field } from '../../components/ui.jsx';

export default function Complaints() {
  const { state, act } = useStore();
  const open = state.complaints.filter((c) => c.status === 'open');
  const closed = state.complaints.filter((c) => c.status !== 'open');
  const signals = suspiciousSignals(state);
  return (
    <div className="stack-l">
      <PageHead title="Complaints and flags" text="Reported reviews, patient complaints and automated checks for suspicious accounts." />
      <Card title={`Open (${open.length})`}>
        {open.length ? open.map((c) => <ComplaintRow key={c.id} c={c} act={act} state={state} />) : <Empty icon={ShieldAlert} title="No open complaints" />}
      </Card>
      <Card title="Automated suspicious-account signals" sub="Simple rule-based checks. They prompt human review; they do not decide anything.">
        {signals.length ? signals.map((s, i) => <div key={i} className="list-item small"><strong>{s.kind}</strong><div className="muted">{s.detail}</div></div>) : <p className="small muted">No signals.</p>}
      </Card>
      <Card title="Resolved">
        {closed.length ? closed.map((c) => <div key={c.id} className="list-item small"><div className="row-between"><span>{c.text}</span><StatusBadge status={c.status} /></div><p className="muted tiny">{c.resolution}</p></div>) : <p className="small muted">None yet.</p>}
      </Card>
    </div>
  );
}

function ComplaintRow({ c, act, state }) {
  const [reason, setReason] = useState('');
  const review = c.targetType === 'review' ? state.reviews.find((r) => r.id === c.targetId) : null;
  return (
    <div className="list-item stack-s">
      <div className="row-between"><strong className="small">{c.type === 'review' ? 'Reported review' : c.type === 'account' ? 'Account flag' : 'Patient complaint'}</strong><span className="tiny muted">{fmtDateTime(c.createdAt)} · by {nameOf(state, c.byUserId)}</span></div>
      <p className="small">{c.text}</p>
      {review && <div className="sensor small"><Stars value={review.rating} size={12} /> about {nameOf(state, review.doctorId)}: “{review.comment}”</div>}
      {c.targetType === 'hospital' && <p className="tiny muted">About: {nameOf(state, c.targetId)}. Use Hospital applications to change its status.</p>}
      <Field label="Resolution reason" hint="required"><input className="input" value={reason} onChange={(e) => setReason(e.target.value)} placeholder="What you decided and why" /></Field>
      <div className="row">
        {review && <Btn size="sm" variant="danger" onClick={() => act(resolveComplaint, { complaintId: c.id, action: 'hide_review', reason }, 'Review hidden and excluded from ratings.')}>Hide review</Btn>}
        <Btn size="sm" onClick={() => act(resolveComplaint, { complaintId: c.id, action: 'dismiss', reason }, 'Complaint dismissed.')}>{review ? 'Keep review' : 'Mark reviewed'}</Btn>
      </div>
    </div>
  );
}
