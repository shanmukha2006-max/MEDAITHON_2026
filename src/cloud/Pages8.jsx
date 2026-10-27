// Part 8 pages: connections, messaging, medicines (prescriptions + reminders), reviews.
// Every action goes to the shared backend; the database enforces who may do what.
import { useEffect, useMemo, useRef, useState } from 'react';
import { Send, UserPlus, Check, X, MessageSquare, Pill, Sparkles, Star, Clock } from 'lucide-react';
import * as api from '../backend/api.js';
import { useCloud } from './CloudContext.jsx';
import { useLoad, useLive } from './Pages7.jsx';
import { Card, Btn, Badge, Field, Empty, PageHead, StatusBadge } from '../components/ui.jsx';

const when = (t) => (t ? new Date(t).toLocaleString() : '—');
const Err = ({ t }) => (t ? <div className="notice bad small" role="alert">{t}</div> : null);
const Note = ({ m }) => (m ? <div className={`notice small ${m.ok ? '' : 'bad'}`} role="status">{m.text}</div> : null);
const TONE = { pending: 'info', accepted: 'good', rejected: 'bad', cancelled: 'neutral', ended: 'neutral' };

// ---------------- connections ----------------
export function ConnectionsPage() {
  const { sb, profile } = useCloud();
  const isDoctor = profile.role === 'doctor';
  const [{ loading, data, error }, reload] = useLoad(async () => ({ reqs: await api.listCareRequests(sb), dir: isDoctor ? null : await api.listDirectory(sb) }), []);
  useLive('care_requests', reload);
  const [q, setQ] = useState(''); const [msgTxt, setMsgTxt] = useState(''); const [m, setM] = useState(null); const [note, setNote] = useState({});
  const act = async (fn, ok) => { try { await fn(); setM({ ok: true, text: ok }); reload(); } catch (e) { setM({ ok: false, text: e.message }); } };
  const open = (data?.reqs || []).filter((r) => ['pending', 'accepted'].includes(r.status));
  const docs = (data?.dir?.doctors || []).filter((d) => !q || `${d.full_name} ${d.specialty}`.toLowerCase().includes(q.toLowerCase()));
  return (
    <div className="stack-l">
      <PageHead title={isDoctor ? 'Connection requests' : 'Connect with a doctor'} text={isDoctor ? 'Requests addressed to you personally. Accepting lets you see this patient’s shared monitoring sessions, alerts and messages; the patient can end it at any time.' : 'Only doctors verified by the authority, at approved hospitals, are listed. Your request goes to that doctor only.'} />
      <Err t={error} /><Note m={m} />
      {loading && !data ? <p className="small muted" role="status">Loading…</p> : <>
        {!isDoctor && (
          <Card title="Verified doctors" sub="Verification reflects this platform’s internal review only, not an external licensing check.">
            <div className="grid-2"><Field label="Search"><input className="input" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Name or specialty" /></Field><Field label="Message to the doctor" hint="optional"><input className="input" maxLength={500} value={msgTxt} onChange={(e) => setMsgTxt(e.target.value)} /></Field></div>
            {docs.length ? docs.map((d) => {
              const existing = open.find((r) => r.doctor_id === d.id);
              return <div key={d.id} className="list-item row-between" data-testid="doctor-row"><span><strong>{d.full_name}</strong> <span className="tiny muted">· {d.specialty} · {data.dir.hospitals.find((h) => h.id === d.hospital_id)?.name}</span> <Badge tone="good">Verified (platform)</Badge></span>
                {existing ? <Badge tone={TONE[existing.status]}>{existing.status === 'pending' ? 'Request sent' : 'Connected'}</Badge> : <Btn size="sm" icon={UserPlus} onClick={() => act(() => api.requestConnection(sb, { patientId: profile.id, doctorId: d.id, message: msgTxt }), `Request sent to ${d.full_name}.`)}>Request connection</Btn>}</div>;
            }) : <Empty title="No verified doctors match" />}
          </Card>
        )}
        <Card title={isDoctor ? 'Requests and connected patients' : 'Your requests'}>
          {(data?.reqs || []).length ? data.reqs.map((r) => (
            <div key={r.id} className="list-item stack-s" data-testid="request-row">
              <div className="row-between"><span><strong>{isDoctor ? (r.patient?.full_name || 'Synthetic patient') : r.doctors?.full_name}</strong> <span className="tiny muted">{isDoctor ? 'synthetic test account' : `${r.doctors?.specialty} · ${r.doctors?.hospitals?.name}`} · sent {when(r.created_at)}</span></span><Badge tone={TONE[r.status]}>{r.status}</Badge></div>
              {r.message && <p className="small muted">“{r.message}”</p>}{r.decision_note && <p className="tiny muted">Note: {r.decision_note}</p>}
              <div className="row">
                {isDoctor && r.status === 'pending' && <><input className="input" style={{ maxWidth: 260 }} placeholder="Note (optional)" value={note[r.id] || ''} onChange={(e) => setNote({ ...note, [r.id]: e.target.value })} /><Btn size="sm" variant="good" icon={Check} onClick={() => act(() => api.respondConnection(sb, r.id, true, note[r.id]), 'Request accepted.')}>Accept</Btn><Btn size="sm" variant="danger" icon={X} onClick={() => act(() => api.respondConnection(sb, r.id, false, note[r.id]), 'Request declined.')}>Reject</Btn></>}
                {!isDoctor && r.status === 'pending' && <Btn size="sm" onClick={() => act(() => api.endConnection(sb, r.id), 'Request withdrawn.')}>Cancel request</Btn>}
                {!isDoctor && r.status === 'accepted' && <Btn size="sm" variant="danger" onClick={() => act(() => api.endConnection(sb, r.id), 'Connection ended. The doctor’s access stopped immediately.')}>End connection</Btn>}
              </div>
            </div>)) : <Empty title={isDoctor ? 'No requests yet' : 'No requests yet'} text={isDoctor ? 'Patients’ requests to you appear here immediately.' : 'Request a connection with a verified doctor above.'} />}
        </Card>
      </>}
    </div>
  );
}

// ---------------- messages ----------------
export function MessagesPage() {
  const { sb, profile } = useCloud();
  const isDoctor = profile.role === 'doctor';
  const [{ data: reqs, error }, reloadReqs] = useLoad(() => api.listCareRequests(sb), []);
  const [unread, setUnread] = useState({});
  const [sel, setSel] = useState(null);
  const [msgs, setMsgs] = useState([]);
  const [text, setText] = useState(''); const [err, setErr] = useState(''); const [sending, setSending] = useState(false);
  const threads = (reqs || []).filter((r) => r.status === 'accepted');
  const loadUnread = async () => { try { setUnread(await api.unreadByThread(sb, profile.id)); } catch { /* shown via error elsewhere */ } };
  // The live subscription keeps its first callback, so read the open conversation through a ref (never stale).
  const selRef = useRef(sel); selRef.current = sel;
  const loadMsgs = async () => {
    const cur = selRef.current;
    if (!cur) return;
    try {
      const list = await api.listMessages(sb, cur.id);
      if (selRef.current?.id !== cur.id) return; // user switched conversation meanwhile
      setMsgs(list); setErr('');
      if (list.some((x) => x.recipient_id === profile.id && !x.read_at)) await api.markRead(sb, cur.id);
      loadUnread();
    } catch (e) { setErr(e.message); }
  };
  useEffect(() => { loadUnread(); }, [reqs]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { loadMsgs(); }, [sel?.id]); // eslint-disable-line react-hooks/exhaustive-deps
  useLive('messages', () => { loadUnread(); loadMsgs(); }, { pollMs: 3000 });
  useLive('care_requests', reloadReqs);
  const send = async () => {
    const body = text.trim(); if (!body) return;
    setSending(true);
    try { await api.sendMessage(sb, { requestId: sel.id, senderId: profile.id, body, clientId: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}` }); setText(''); await loadMsgs(); }
    catch (e) { setErr(e.message); } finally { setSending(false); }
  };
  const other = (r) => (isDoctor ? r.patient?.full_name || 'Synthetic patient' : r.doctors?.full_name);
  return (
    <div className="stack-l">
      <PageHead title="Messages" text="Conversations exist only within an accepted connection. Messages are stored in the shared database and delivered live. Not for emergencies: if you have real breathing difficulty, seek medical help now." />
      <Err t={error || err} />
      <div className="grid-2" style={{ gridTemplateColumns: 'minmax(0, 1fr) minmax(0, 2fr)' }}>
        <Card title="Conversations">
          {threads.length ? threads.map((r) => <button key={r.id} className={`nav-btn ${sel?.id === r.id ? 'active' : ''}`} style={{ color: 'var(--ink)' }} onClick={() => setSel(r)} data-testid="thread"><MessageSquare size={15} />{other(r)}{unread[r.id] ? <Badge tone="bad">{unread[r.id]} unread</Badge> : null}</button>)
            : <Empty title="No conversations" text={isDoctor ? 'Accept a connection request to start a conversation.' : 'Connect with a verified doctor first.'} />}
        </Card>
        <Card title={sel ? other(sel) : 'Select a conversation'}>
          {sel ? <div className="stack">
            <div className="stack-s" style={{ maxHeight: 380, overflow: 'auto' }} data-testid="message-list">
              {msgs.length ? msgs.map((x) => (
                <div key={x.id} className="list-item small" style={{ textAlign: x.sender_id === profile.id ? 'right' : 'left' }}>
                  <div>{x.body}</div>
                  <div className="tiny muted">{x.sender_id === profile.id ? 'You' : other(sel)} · {when(x.created_at)} · {x.sender_id === profile.id ? (x.read_at ? 'Read' : 'Delivered') : 'Received'}</div>
                </div>)) : <p className="small muted">No messages yet.</p>}
            </div>
            <div className="row"><input className="input" style={{ flex: 1 }} maxLength={2000} value={text} onChange={(e) => setText(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && send()} placeholder="Write a message" aria-label="Message" /><Btn variant="primary" icon={Send} disabled={sending || !text.trim()} onClick={send}>{sending ? 'Sending…' : 'Send'}</Btn></div>
          </div> : <p className="small muted">Choose a conversation on the left.</p>}
        </Card>
      </div>
    </div>
  );
}

// ---------------- medicines ----------------
const today = () => new Date().toISOString().slice(0, 10);
export function MedicinesPage() {
  const { sb, profile } = useCloud();
  const isDoctor = profile.role === 'doctor';
  const [{ loading, data, error }, reload] = useLoad(async () => ({ rx: await api.listPrescriptions(sb), rem: isDoctor ? [] : await api.listReminders(sb), reqs: isDoctor ? await api.listCareRequests(sb) : [] }), []);
  useLive('prescriptions', reload);
  const [f, setF] = useState({ patientId: '', medicine: '', doseText: '', instructions: '', endDate: '' });
  const [times, setTimes] = useState({}); const [m, setM] = useState(null); const [explain, setExplain] = useState({});
  const act = async (fn, ok) => { try { await fn(); setM({ ok: true, text: ok }); reload(); } catch (e) { setM({ ok: false, text: e.message }); } };
  const ask = async (rx) => {
    setExplain({ ...explain, [rx.id]: { busy: true } });
    try { const out = await api.askAssistant(sb, { question: 'Explain this prescription in plain language. What should I ask my doctor or pharmacist?', prescriptionId: rx.id }); setExplain((e) => ({ ...e, [rx.id]: out })); }
    catch (e) { setExplain((x) => ({ ...x, [rx.id]: { error: e.message } })); }
  };
  const patients = (data?.reqs || []).filter((r) => r.status === 'accepted');
  return (
    <div className="stack-l">
      <PageHead title={isDoctor ? 'Prescriptions' : 'Medicines'} text={isDoctor ? 'Enter prescriptions for patients connected to you. These are demo records in a prototype, not a real prescribing system.' : 'Prescriptions appear here only when a connected doctor has entered them. BreatheGuard never creates, changes or checks medicines. Ask your doctor or pharmacist about doses and combinations.'} />
      <Err t={error} /><Note m={m} />
      {isDoctor && (
        <Card title="New prescription (demo record)">
          {patients.length ? <div className="stack">
            <div className="grid-2">
              <Field label="Patient"><select className="select" value={f.patientId} onChange={(e) => setF({ ...f, patientId: e.target.value })}><option value="">Choose a connected patient</option>{patients.map((r) => <option key={r.id} value={r.patient_id}>{r.patient?.full_name || 'Synthetic patient'}</option>)}</select></Field>
              <Field label="Medicine"><input className="input" value={f.medicine} onChange={(e) => setF({ ...f, medicine: e.target.value })} /></Field>
              <Field label="Dose, as prescribed"><input className="input" value={f.doseText} onChange={(e) => setF({ ...f, doseText: e.target.value })} /></Field>
              <Field label="End date" hint="optional"><input className="input" type="date" value={f.endDate} onChange={(e) => setF({ ...f, endDate: e.target.value })} /></Field>
            </div>
            <Field label="Instructions"><textarea className="textarea" maxLength={1000} value={f.instructions} onChange={(e) => setF({ ...f, instructions: e.target.value })} /></Field>
            <div><Btn variant="primary" disabled={!f.patientId || !f.medicine.trim() || !f.doseText.trim()} onClick={() => act(() => api.createPrescription(sb, { ...f, userId: profile.id }), 'Prescription saved and the patient notified.')}>Save prescription</Btn></div>
          </div> : <Empty title="No connected patients" text="Accept a connection request first." />}
        </Card>
      )}
      {loading && !data ? <p className="small muted" role="status">Loading…</p> : (data?.rx || []).length ? data.rx.map((rx) => {
        const rem = (data.rem || []).find((r) => r.prescription_id === rx.id);
        const ex = explain[rx.id];
        return (
          <Card key={rx.id} className="flat">
            <div className="row-between"><span><strong>{rx.medicine}</strong> <span className="small muted">· {rx.dose_text}</span></span><span className="row"><Badge tone="demo">Demo record</Badge><Badge tone={rx.status === 'active' ? 'good' : 'neutral'}>{rx.status}</Badge></span></div>
            <p className="tiny muted">{isDoctor ? `Patient: ${rx.patient?.full_name || 'Synthetic patient'}` : `Entered by ${rx.doctors?.full_name}`} · {when(rx.created_at)}{rx.end_date ? ` · until ${rx.end_date}` : ''}</p>
            {rx.instructions && <p className="small">{rx.instructions}</p>}
            {isDoctor && rx.status === 'active' && rx.prescribed_by === profile.id && <Btn size="sm" onClick={() => act(() => api.stopPrescription(sb, rx.id), 'Prescription marked as stopped.')}>Mark as stopped</Btn>}
            {!isDoctor && <div className="stack-s" style={{ marginTop: 8 }}>
              <div className="row"><Btn size="sm" icon={Sparkles} disabled={ex?.busy} onClick={() => ask(rx)}>{ex?.busy ? 'Asking…' : 'Explain in plain language (AI)'}</Btn></div>
              {ex?.configured === false && <div className="notice warn small">AI not set up: {ex.message} No explanation was generated.</div>}
              {ex?.error && <div className="notice bad small">{ex.error} <button className="btn ghost sm" onClick={() => ask(rx)}>Retry</button></div>}
              {ex?.answer && <div className="notice small"><p style={{ whiteSpace: 'pre-wrap' }}>{ex.answer}</p><p className="tiny muted">AI-generated general information, model {ex.model}. Not medical advice; it cannot check interactions. Ask your doctor or pharmacist.</p></div>}
              <div className="row tiny"><Clock size={13} />Reminder times
                <input className="input" style={{ maxWidth: 200 }} placeholder="e.g. 08:00, 20:00" value={times[rx.id] ?? (rem?.times || []).join(', ')} onChange={(e) => setTimes({ ...times, [rx.id]: e.target.value })} aria-label={`Reminder times for ${rx.medicine}`} />
                <Btn size="sm" onClick={() => act(() => api.setReminder(sb, { patientId: profile.id, prescriptionId: rx.id, times: (times[rx.id] ?? '').split(',').map((t) => t.trim()).filter(Boolean) }), 'Reminder saved.')}>Save reminder</Btn></div>
              {rem && <div className="row tiny">Today: {rem.times.map((t) => { const done = rem.reminder_doses.some((d) => d.due_date === today() && d.slot === t); return <Btn key={t} size="sm" variant={done ? 'good' : ''} disabled={done} onClick={() => act(() => api.takeDose(sb, { reminderId: rem.id, dueDate: today(), slot: t }), `Dose at ${t} recorded.`)}>{done ? `✓ ${t} taken` : `Mark ${t} taken`}</Btn>; })}</div>}
              {rem && <p className="tiny muted">Reminders are shown here when you open the app; no push, SMS or email reminders are sent.</p>}
            </div>}
          </Card>);
      }) : <Empty icon={Pill} title={isDoctor ? 'No prescriptions entered yet' : 'No prescriptions'} text={isDoctor ? '' : 'Nothing has been entered by a connected doctor. BreatheGuard never creates prescriptions itself.'} />}
    </div>
  );
}

// ---------------- reviews ----------------
export function ReviewsPatientPage() {
  const { sb, profile } = useCloud();
  const [{ data, error }, reload] = useLoad(async () => ({ appts: await api.listAppointments(sb), mine: await api.listMyReviews(sb, profile.id) }), []);
  const [f, setF] = useState({}); const [m, setM] = useState(null);
  const done = (data?.appts || []).filter((a) => a.status === 'completed');
  const save = async (a) => { try { await api.submitReview(sb, { appointmentId: a.id, userId: profile.id, rating: f[a.id]?.rating, body: f[a.id]?.body }); setM({ ok: true, text: 'Review published.' }); reload(); } catch (e) { setM({ ok: false, text: e.message }); } };
  return (
    <div className="stack-l">
      <PageHead title="Reviews" text="You can review a doctor only after a completed appointment, once per appointment." />
      <Err t={error} /><Note m={m} />
      {done.length ? done.map((a) => {
        const mine = data.mine.find((r) => r.appointment_id === a.id);
        return <Card key={a.id} className="flat"><div className="row-between"><span><strong>{a.doctors?.full_name || 'Doctor'}</strong> <span className="tiny muted">· {when(a.requested_for)}</span></span><StatusBadge status="completed" /></div>
          {mine ? <p className="small">Your review: {'★'.repeat(mine.rating)}{'☆'.repeat(5 - mine.rating)} {mine.body && `“${mine.body}”`}</p> : <div className="stack-s" style={{ marginTop: 8 }}>
            <div className="row">{[1, 2, 3, 4, 5].map((n) => <button key={n} className="btn ghost sm" aria-label={`${n} stars`} onClick={() => setF({ ...f, [a.id]: { ...f[a.id], rating: n } })}><Star size={16} fill={(f[a.id]?.rating || 0) >= n ? 'currentColor' : 'none'} /></button>)}</div>
            <textarea className="textarea" maxLength={600} placeholder="Optional comment" value={f[a.id]?.body || ''} onChange={(e) => setF({ ...f, [a.id]: { ...f[a.id], body: e.target.value } })} />
            <div><Btn size="sm" variant="primary" disabled={!f[a.id]?.rating} onClick={() => save(a)}>Publish review</Btn></div></div>}
        </Card>;
      }) : <Empty title="No completed appointments" text="Reviews open after an appointment is marked completed by the hospital." />}
    </div>
  );
}
