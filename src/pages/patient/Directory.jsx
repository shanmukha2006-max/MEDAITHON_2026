import { useState } from 'react';
import { Search, BadgeCheck, Building2, Flag, Stethoscope } from 'lucide-react';
import { useStore, fmtDate } from '../../data/store.jsx';
import { visibleDoctors, visibleHospitals, doctorRating, requestAppointment, flagReview } from '../../data/actions.js';
import { Card, Btn, Badge, Stars, Modal, Field, Empty, PageHead } from '../../components/ui.jsx';

export default function Directory() {
  const { state } = useStore();
  const [q, setQ] = useState('');
  const [spec, setSpec] = useState('');
  const [open, setOpen] = useState(null);
  const docs = visibleDoctors(state);
  const specs = [...new Set(docs.map((d) => d.specialty))].sort();
  const hospitals = visibleHospitals(state);
  const ql = q.trim().toLowerCase();
  const filtered = docs.filter((d) => {
    const h = state.hospitals.find((x) => x.id === d.hospitalId);
    return (!spec || d.specialty === spec) && (!ql || [d.name, d.specialty, h.name, h.city].some((s) => s.toLowerCase().includes(ql)));
  });
  return (
    <div className="stack-l">
      <PageHead title="Find care" text="Only hospitals approved by the demo authority, and doctors whose own credentials were separately verified, are listed here." actions={<Badge tone="demo">Demo directory · fictional organisations</Badge>} />
      <div className="row">
        <div style={{ position: 'relative', flex: '1 1 280px' }}>
          <Search size={16} style={{ position: 'absolute', left: 10, top: 11, color: 'var(--ink-3)' }} />
          <input className="input" style={{ paddingLeft: 32 }} placeholder="Search by doctor, specialty, hospital or city" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Search" />
        </div>
        <select className="select" style={{ width: 240 }} value={spec} onChange={(e) => setSpec(e.target.value)} aria-label="Specialty">
          <option value="">All specialties</option>{specs.map((s) => <option key={s}>{s}</option>)}
        </select>
      </div>
      {filtered.length ? (
        <div className="grid-auto">
          {filtered.map((d) => {
            const h = state.hospitals.find((x) => x.id === d.hospitalId);
            const r = doctorRating(state, d.id);
            return (
              <Card key={d.id} className="flat">
                <div className="stack-s">
                  <div className="row-between"><h3>{d.name}</h3><Badge tone="good"><BadgeCheck size={13} />Verified (demo)</Badge></div>
                  <span className="small">{d.specialty}</span>
                  <span className="small muted row" style={{ gap: 5 }}><Building2 size={13} />{h.name}, {h.city}</span>
                  <span className="row small" style={{ gap: 6 }}>{r.count ? <><Stars value={r.avg} size={14} />{r.avg.toFixed(1)} from {r.count} review{r.count > 1 ? 's' : ''}</> : <span className="muted">No reviews yet</span>}</span>
                  <div style={{ marginTop: 6 }}><Btn size="sm" variant="primary" onClick={() => setOpen(d.id)}>View profile</Btn></div>
                </div>
              </Card>
            );
          })}
        </div>
      ) : <Empty icon={Stethoscope} title="No matching doctors" text="Try a different search. Doctors awaiting verification are not shown." />}
      <Card title="Approved hospitals" sub="Approval of a hospital does not by itself verify its doctors.">
        {hospitals.map((h) => <div key={h.id} className="list-item row-between"><div><strong>{h.name}</strong><div className="small muted">{h.city} · {h.services}</div></div><Badge tone="good">Approved (demo)</Badge></div>)}
      </Card>
      {open && <DoctorProfile doctorId={open} onClose={() => setOpen(null)} />}
    </div>
  );
}

function DoctorProfile({ doctorId, onClose }) {
  const { state, act } = useStore();
  const d = state.doctors.find((x) => x.id === doctorId);
  const h = state.hospitals.find((x) => x.id === d.hospitalId);
  const r = doctorRating(state, d.id);
  const reviews = state.reviews.filter((x) => x.doctorId === d.id && !x.hidden).sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  const hiddenCount = state.reviews.filter((x) => x.doctorId === d.id && x.hidden).length;
  const [when, setWhen] = useState('');
  const [why, setWhy] = useState('');
  const [flagging, setFlagging] = useState(null);
  const [flagText, setFlagText] = useState('');
  return (
    <Modal open onClose={onClose} title={d.name}>
      <div className="stack-l">
        <dl className="kv">
          <dt>Specialty</dt><dd>{d.specialty}</dd>
          <dt>Hospital</dt><dd>{h.name}, {h.city} <Badge tone="good">Approved (demo)</Badge></dd>
          <dt>Credential status</dt><dd><Badge tone="good"><BadgeCheck size={13} />Verified by demo authority</Badge></dd>
          <dt>Qualifications</dt><dd>{d.qualifications}</dd>
          <dt>Rating</dt><dd>{r.count ? <span className="row" style={{ gap: 6 }}><Stars value={r.avg} />{r.avg.toFixed(1)} average from {r.count} review{r.count > 1 ? 's' : ''}</span> : 'No reviews yet'}</dd>
        </dl>
        <p className="tiny muted">"Verified" means verified by the fictional authority in this demo. No real-world registry has been checked.</p>
        <div className="stack">
          <h3>Request an appointment</h3>
          <div className="grid-2">
            <Field label="Preferred date and time"><input className="input" type="datetime-local" value={when} onChange={(e) => setWhen(e.target.value)} /></Field>
            <Field label="Reason" hint="optional"><input className="input" value={why} onChange={(e) => setWhy(e.target.value)} placeholder="e.g. review of monitoring results" /></Field>
          </div>
          <div><Btn variant="primary" onClick={() => act(requestAppointment, { doctorId, datetime: when, reason: why }, 'Appointment request sent to the hospital.') && onClose()}>Send request</Btn></div>
          <p className="tiny muted">Requesting an appointment does not share your monitoring data. Sharing is controlled separately under Consent.</p>
        </div>
        <div className="stack">
          <h3>Reviews from completed demo appointments</h3>
          {reviews.length ? reviews.map((rv) => (
            <div key={rv.id} className="list-item">
              <div className="row-between"><Stars value={rv.rating} size={14} /><span className="tiny muted">{fmtDate(rv.createdAt)} · verified appointment</span></div>
              <p className="small" style={{ marginTop: 4 }}>{rv.comment || <span className="muted">No comment</span>}</p>
              {flagging === rv.id ? (
                <div className="row" style={{ marginTop: 6 }}>
                  <input className="input" style={{ flex: 1 }} placeholder="Why is this review inappropriate?" value={flagText} onChange={(e) => setFlagText(e.target.value)} />
                  <Btn size="sm" onClick={() => act(flagReview, { reviewId: rv.id, text: flagText }, 'Review reported to the authority.') && setFlagging(null)}>Send report</Btn>
                  <Btn size="sm" variant="ghost" onClick={() => setFlagging(null)}>Cancel</Btn>
                </div>
              ) : <button className="btn ghost sm" style={{ marginTop: 4 }} onClick={() => { setFlagging(rv.id); setFlagText(''); }}><Flag size={13} />Report review</button>}
            </div>
          )) : <p className="small muted">No reviews yet.</p>}
          {hiddenCount > 0 && <p className="tiny muted">{hiddenCount} review{hiddenCount > 1 ? 's were' : ' was'} hidden by the authority after a policy review and {hiddenCount > 1 ? 'are' : 'is'} excluded from the average.</p>}
        </div>
      </div>
    </Modal>
  );
}
