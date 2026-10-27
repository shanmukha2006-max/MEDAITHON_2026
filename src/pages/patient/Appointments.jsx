import { useState } from 'react';
import { CalendarDays } from 'lucide-react';
import { useStore, fmtDateTime, nameOf } from '../../data/store.jsx';
import { submitReview, updateAppointment, fileComplaint } from '../../data/actions.js';
import { Card, Btn, StatusBadge, Stars, Empty, PageHead, Badge } from '../../components/ui.jsx';

export default function Appointments({ go }) {
  const { state, user } = useStore();
  const mine = state.appointments.filter((a) => a.patientId === user.id).sort((a, b) => b.datetime.localeCompare(a.datetime));
  return (
    <div className="stack-l">
      <PageHead title="Appointments" text="Demo appointments only. The hospital confirms and completes them; reviews open after completion." actions={<Btn variant="primary" onClick={() => go('directory')}>Request appointment</Btn>} />
      {mine.length ? <div className="stack">{mine.map((a) => <ApptCard key={a.id} a={a} />)}</div>
        : <Empty icon={CalendarDays} title="No appointments yet" text="Find a verified demo doctor and request a time." action={<Btn onClick={() => go('directory')}>Find care</Btn>} />}
    </div>
  );
}

function ApptCard({ a }) {
  const { state, act } = useStore();
  const review = state.reviews.find((r) => r.appointmentId === a.id);
  const [rating, setRating] = useState(0);
  const [comment, setComment] = useState('');
  const [complain, setComplain] = useState(false);
  const [text, setText] = useState('');
  return (
    <Card className="flat">
      <div className="row-between">
        <div><h3>{nameOf(state, a.doctorId)}</h3><div className="small muted">{fmtDateTime(a.datetime)} · {nameOf(state, a.hospitalId)}{a.reason && ` · ${a.reason}`}</div></div>
        <div className="row"><Badge tone="demo">Demo</Badge><StatusBadge status={a.status} /></div>
      </div>
      {a.status === 'requested' && <div style={{ marginTop: 10 }}><Btn size="sm" variant="danger" onClick={() => act(updateAppointment, { appointmentId: a.id, status: 'cancelled' }, 'Request cancelled.')}>Cancel request</Btn></div>}
      {a.status === 'completed' && (
        <div className="stack" style={{ marginTop: 12 }}>
          {review ? (
            <div className="small"><span className="row" style={{ gap: 6 }}>Your review: <Stars value={review.rating} size={14} />{review.hidden && <Badge tone="warn">Hidden by authority</Badge>}</span>{review.comment && <p className="muted">“{review.comment}”</p>}</div>
          ) : (
            <div className="stack-s">
              <strong className="small">Review this appointment</strong>
              <Stars value={rating} onChange={setRating} size={22} />
              <textarea className="textarea" maxLength={600} placeholder="What went well, what could be better? (optional, max 600 characters)" value={comment} onChange={(e) => setComment(e.target.value)} />
              <div><Btn size="sm" variant="primary" disabled={!rating} onClick={() => act(submitReview, { appointmentId: a.id, rating, comment }, 'Thank you. Your review is published.')}>Publish review</Btn></div>
            </div>
          )}
          {complain ? (
            <div className="stack-s">
              <textarea className="textarea" placeholder="Describe the problem for the healthcare authority" value={text} onChange={(e) => setText(e.target.value)} />
              <div className="row"><Btn size="sm" onClick={() => act(fileComplaint, { targetType: 'hospital', targetId: a.hospitalId, text }, 'Complaint sent to the authority.') && setComplain(false)}>Send complaint</Btn><Btn size="sm" variant="ghost" onClick={() => setComplain(false)}>Cancel</Btn></div>
            </div>
          ) : <div><button className="btn ghost sm" onClick={() => setComplain(true)}>Report a problem to the authority</button></div>}
        </div>
      )}
    </Card>
  );
}
