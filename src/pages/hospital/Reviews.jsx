import { useState } from 'react';
import { Flag, MessageSquare } from 'lucide-react';
import { useStore, fmtDate } from '../../data/store.jsx';
import { doctorRating, flagReview } from '../../data/actions.js';
import { Card, Btn, Stars, PageHead, Empty, Badge } from '../../components/ui.jsx';

export default function HospitalReviews() {
  const { state, user, act } = useStore();
  const docs = state.doctors.filter((d) => d.hospitalId === user.hospitalId);
  const [flag, setFlag] = useState(null);
  const [text, setText] = useState('');
  return (
    <div className="stack-l">
      <PageHead title="Ratings and reviews" text="Reviews come from patients after completed demo appointments. Your hospital can read and report them, but cannot edit or delete them." />
      {docs.length ? docs.map((d) => {
        const r = doctorRating(state, d.id);
        const rv = state.reviews.filter((x) => x.doctorId === d.id);
        return (
          <Card key={d.id} title={d.name} sub={d.specialty} actions={r.count ? <span className="row small" style={{ gap: 6 }}><Stars value={r.avg} size={14} />{r.avg.toFixed(1)} from {r.count}</span> : <span className="small muted">No reviews</span>}>
            {rv.length ? rv.map((x) => (
              <div key={x.id} className="list-item">
                <div className="row-between"><span className="row" style={{ gap: 6 }}><Stars value={x.rating} size={13} />{x.hidden && <Badge tone="warn">Hidden by authority</Badge>}</span><span className="tiny muted">{fmtDate(x.createdAt)}</span></div>
                <p className="small" style={{ marginTop: 4 }}>{x.comment || <span className="muted">No comment</span>}</p>
                {!x.hidden && (flag === x.id ? (
                  <div className="row" style={{ marginTop: 6 }}><input className="input" style={{ flex: 1 }} value={text} onChange={(e) => setText(e.target.value)} placeholder="Reason for reporting" /><Btn size="sm" onClick={() => act(flagReview, { reviewId: x.id, text }, 'Reported to the authority.') && setFlag(null)}>Send report</Btn><Btn size="sm" variant="ghost" onClick={() => setFlag(null)}>Cancel</Btn></div>
                ) : <button className="btn ghost sm" style={{ marginTop: 4 }} onClick={() => { setFlag(x.id); setText(''); }}><Flag size={13} />Report to authority</button>)}
              </div>
            )) : <p className="small muted">No reviews yet.</p>}
          </Card>
        );
      }) : <Empty icon={MessageSquare} title="No doctors yet" />}
    </div>
  );
}
