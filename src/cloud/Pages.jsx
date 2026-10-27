import { useEffect, useState } from 'react';
import { ShieldCheck, Sparkles, Building2, Gavel } from 'lucide-react';
import * as api from '../backend/api.js';
import { subscribeSessionList } from '../backend/realtime.js';
import { useLive } from './Pages7.jsx';
import { useCloud } from './CloudContext.jsx';
import SessionViewer from './SessionViewer.jsx';
import { Card, Btn, Badge, Field, Empty, StatusBadge, PageHead } from '../components/ui.jsx';

const useLoad = (fn, deps = []) => {
  const [state, setState] = useState({ loading: true, data: null, error: '' });
  const reload = async () => { setState((s) => ({ ...s, loading: true })); try { setState({ loading: false, data: await fn(), error: '' }); } catch (e) { setState({ loading: false, data: null, error: e.message }); } };
  useEffect(() => { reload(); }, deps); // eslint-disable-line react-hooks/exhaustive-deps
  return [state, reload];
};
const Loading = () => <p className="small muted" role="status">Loading…</p>;
const ErrorNote = ({ text }) => text ? <div className="notice bad small" role="alert">{text}</div> : null;

// Sessions: patients see their own; hospital staff see consented patients' sessions (RLS decides).
export function SessionsPage({ staff, authority }) {
  const { sb } = useCloud();
  const [{ loading, data, error }, reload] = useLoad(() => api.listSessions(sb), []);
  const [open, setOpen] = useState(null);
  useEffect(() => subscribeSessionList(sb, { onChange: () => reload() }), []); // eslint-disable-line react-hooks/exhaustive-deps
  // Also re-check every 10 s: sharing changes (consent granted or revoked) create no session event,
  // and without Supabase Realtime there are no events at all. Silent background refresh.
  useEffect(() => { const id = setInterval(() => { if (document.visibilityState === 'visible') reload(); }, 10000); return () => clearInterval(id); }, []); // eslint-disable-line react-hooks/exhaustive-deps
  return (
    <div className="stack-l">
      <PageHead title={authority ? 'Shared patient records' : staff ? 'Live patients' : 'My sessions'} text={authority ? 'Read-only. Only patients who chose to share with the healthcare authority appear here; access ends immediately if they stop sharing.' : staff ? 'Sessions from patients who have shared them with your hospital. Access ends immediately if they withdraw consent.' : 'Your recorded sessions, kept in the shared database.'} actions={<Btn size="sm" onClick={reload}>Refresh list</Btn>} />
      <ErrorNote text={error} />
      {loading && !data ? <Loading /> : data?.length ? (
        <Card bodyClass="table-wrap">
          <table className="table"><thead><tr><th>Started</th>{(staff || authority) && <th>Patient</th>}<th>Patch</th><th>Scenario</th><th>Status</th><th /></tr></thead>
            <tbody>{data.map((s) => <tr key={s.id}><td className="small">{new Date(s.started_at).toLocaleString()}</td>{(staff || authority) && <td>{s.profiles?.full_name || 'Synthetic patient'}<div className="tiny muted">synthetic</div></td>}<td>{s.patch === 'care' ? 'Care' : 'Quick'}</td><td className="small">{s.scenario_id}</td><td><Badge tone={s.status === 'active' ? 'good' : 'neutral'}>{s.status}</Badge></td><td><Btn size="sm" onClick={() => setOpen(s)}>{s.status === 'active' ? 'Watch live' : 'Open'}</Btn></td></tr>)}</tbody></table>
        </Card>
      ) : <Empty title={authority ? 'No patients are sharing with the authority' : staff ? 'No shared sessions' : 'No sessions yet'} text={staff ? 'Sessions appear here when a patient shares them with your approved hospital.' : 'Record one from Live monitor.'} />}
      {open && <Card title="Session" actions={<Btn size="sm" onClick={() => setOpen(null)}>Close</Btn>}><SessionViewer key={open.id} session={open} canAcknowledge={staff && !authority} /></Card>}
    </div>
  );
}

export function SharingPage() {
  const { sb, profile } = useCloud();
  const [{ loading, data, error }, reload] = useLoad(async () => ({ hospitals: await api.listApprovedHospitals(sb), consents: await api.listConsents(sb) }), []);
  const [msg, setMsg] = useState('');
  const toggle = async (h, on) => {
    try { await api.setConsent(sb, { patientId: profile.id, hospitalId: h.id, scopes: on ? ['reports', 'live'] : [] }); setMsg(on ? `Shared with ${h.name}.` : `Stopped sharing with ${h.name}. Their access ended immediately.`); reload(); }
    catch (e) { setMsg(e.message); }
  };
  return (
    <div className="stack-l">
      <PageHead title="Sharing" text="Only hospitals approved by the authority are listed. Sharing lets that hospital see your sessions, results and alerts, live. It is enforced by the database." />
      <ErrorNote text={error} />{msg && <div className="notice small" role="status">{msg}</div>}
      {loading && !data ? <Loading /> : data?.hospitals.length ? data.hospitals.map((h) => {
        const c = data.consents.find((x) => x.hospital_id === h.id);
        const on = !!(c?.active && c.scopes.includes('reports'));
        return <Card key={h.id} className="flat"><div className="row-between"><div><strong>{h.name}</strong><div className="tiny muted">{h.city} · approved (demo authority)</div></div><div className="row">{on ? <Badge tone="good"><ShieldCheck size={12} />Shared</Badge> : <Badge tone="neutral">Not shared</Badge>}<Btn size="sm" variant={on ? 'danger' : 'primary'} onClick={() => toggle(h, !on)}>{on ? 'Stop sharing' : 'Share'}</Btn></div></div></Card>;
      }) : <Empty title="No approved hospitals yet" text="A hospital must be approved by the healthcare authority before you can share with it." />}
    </div>
  );
}

export function AssistantPage() {
  const { sb } = useCloud();
  const [{ data: sessions }] = useLoad(() => api.listSessions(sb, 20), []);
  const [q, setQ] = useState(''); const [sid, setSid] = useState(''); const [busy, setBusy] = useState(false); const [out, setOut] = useState(null);
  const ask = async () => { setBusy(true); setOut(null); try { setOut(await api.askAssistant(sb, { question: q, sessionId: sid || undefined })); } catch (e) { setOut({ error: e.message }); } finally { setBusy(false); } };
  return (
    <div className="stack-l">
      <PageHead title="AI assistant" text="Explains your simulated results in plain language. It runs on the server, sees only data you are allowed to see, and never diagnoses." />
      <Card>
        <div className="stack">
          <Field label="About which session?" hint="optional"><select className="select" value={sid} onChange={(e) => setSid(e.target.value)}><option value="">General question</option>{(sessions || []).map((s) => <option key={s.id} value={s.id}>{new Date(s.started_at).toLocaleString()} · {s.scenario_id}</option>)}</select></Field>
          <Field label="Question"><textarea className="textarea" maxLength={800} value={q} onChange={(e) => setQ(e.target.value)} placeholder="e.g. Why did my result say insufficient reliable data?" /></Field>
          <div><Btn variant="primary" icon={Sparkles} disabled={busy || !q.trim()} onClick={ask}>{busy ? 'Asking…' : 'Ask'}</Btn></div>
          {out?.configured === false && <div className="notice warn small" role="status"><strong>Assistant not set up.</strong> {out.message} No answer was generated.</div>}
          {out?.error && <div className="notice bad small" role="alert">{out.error}</div>}
          {out?.answer && <div className="notice small"><p style={{ whiteSpace: 'pre-wrap' }}>{out.answer}</p><p className="tiny muted" style={{ marginTop: 6 }}>{out.label} Model: {out.model}.</p></div>}
          <p className="tiny muted">If you have real breathing difficulty, seek medical help now. Do not wait for this app.</p>
        </div>
      </Card>
    </div>
  );
}

export function HospitalPage() {
  const { sb, profile, refreshProfile } = useCloud();
  const [{ loading, data, error }, reload] = useLoad(async () => (profile.hospital_id ? { h: await api.getHospital(sb, profile.hospital_id), doctors: await api.listDoctors(sb, profile.hospital_id) } : null), [profile.hospital_id]);
  useLive('hospitals', reload); useLive('doctors', reload);
  const [f, setF] = useState({ name: '', city: '', registrationNo: '' }); const [d, setD] = useState({ fullName: '', specialty: '', licenseNo: '' }); const [msg, setMsg] = useState(''); const [link, setLink] = useState({});
  const linkAcc = async (id) => { try { await api.linkDoctorAccount(sb, id, (link[id] || '').trim()); setMsg('Doctor account linked. Access starts once the doctor is verified.'); reload(); } catch (e) { setMsg(e.message); } };
  const apply = async () => { try { await api.createHospital(sb, f); setMsg('Application submitted. Status: pending review.'); await refreshProfile(); } catch (e) { setMsg(e.message); } };
  const addDoc = async () => { try { await api.submitDoctor(sb, d); setMsg('Doctor submitted for separate verification.'); setD({ fullName: '', specialty: '', licenseNo: '' }); reload(); } catch (e) { setMsg(e.message); } };
  if (!profile.hospital_id) return (
    <div className="stack-l"><PageHead title="Register your hospital" text="Applications start as pending. Only the healthcare authority can approve them; your account cannot." />
      <Card><div className="stack"><Field label="Hospital name"><input className="input" value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} /></Field><div className="grid-2"><Field label="City"><input className="input" value={f.city} onChange={(e) => setF({ ...f, city: e.target.value })} /></Field><Field label="Registration no." hint="use a DEMO- number"><input className="input" value={f.registrationNo} onChange={(e) => setF({ ...f, registrationNo: e.target.value })} /></Field></div><div><Btn variant="primary" icon={Building2} onClick={apply}>Submit application</Btn></div>{msg && <div className="notice small" role="status">{msg}</div>}</div></Card></div>);
  return (
    <div className="stack-l"><PageHead title="Your hospital" text="Status changes only through the healthcare authority. Approving the hospital does not verify its doctors." />
      <ErrorNote text={error} />{msg && <div className="notice small" role="status">{msg}</div>}
      {loading && !data ? <Loading /> : data && <>
        <Card title={data.h.name} actions={<StatusBadge status={data.h.status} />}><p className="small muted">{data.h.city} · {data.h.registration_no} · synthetic demo record</p>{data.h.status_reason && <p className="small" style={{ marginTop: 6 }}><strong>Authority’s reason:</strong> {data.h.status_reason}</p>}</Card>
        <Card title="Doctors" sub={data.h.status === 'approved' ? 'Each doctor is verified separately by the authority.' : 'Available after your hospital is approved.'}>
          {data.doctors.length ? data.doctors.map((x) => <div key={x.id} className="list-item stack-s"><div className="row-between"><span>{x.full_name} <span className="tiny muted">· {x.specialty} · {x.license_no}</span></span><StatusBadge status={x.status} /></div>
            <div className="row tiny">{x.user_id ? <Badge tone="info">Account linked</Badge> : <><input className="input" style={{ maxWidth: 260 }} type="email" placeholder="Doctor’s account email" aria-label={`Account email for ${x.full_name}`} value={link[x.id] || ''} onChange={(e) => setLink({ ...link, [x.id]: e.target.value })} /><Btn size="sm" onClick={() => linkAcc(x.id)}>Link account</Btn></>}</div></div>) : <p className="small muted">No doctors submitted.</p>}
          <fieldset disabled={data.h.status !== 'approved'} style={{ border: 0, padding: 0, margin: '12px 0 0' }}><div className="grid-3"><Field label="Name"><input className="input" value={d.fullName} onChange={(e) => setD({ ...d, fullName: e.target.value })} /></Field><Field label="Specialty"><input className="input" value={d.specialty} onChange={(e) => setD({ ...d, specialty: e.target.value })} /></Field><Field label="Licence no."><input className="input" value={d.licenseNo} onChange={(e) => setD({ ...d, licenseNo: e.target.value })} /></Field></div><div style={{ marginTop: 8 }}><Btn onClick={addDoc}>Submit doctor</Btn></div></fieldset>
        </Card></>}
    </div>
  );
}

export function ReviewsPage() {
  const { sb } = useCloud();
  const [{ loading, data, error }, reload] = useLoad(() => api.listForReview(sb), []);
  useLive('hospitals', reload); useLive('doctors', reload); // new applications appear without refreshing
  const [reason, setReason] = useState({}); const [msg, setMsg] = useState('');
  const decide = async (kind, id, decision) => { try { await (kind === 'h' ? api.decideHospital : api.decideDoctor)(sb, id, decision, reason[id] || ''); setMsg('Decision recorded and audited.'); reload(); } catch (e) { setMsg(e.message); } };
  const Row = ({ kind, x, title, sub }) => (
    <div className="list-item stack-s"><div className="row-between"><span><strong>{title}</strong> <span className="tiny muted">{sub}</span></span><StatusBadge status={x.status} /></div>
      {['pending', 'more_info', 'suspended', 'approved'].includes(x.status) && <div className="row"><input className="input" style={{ flex: 1, minWidth: 200 }} placeholder="Reason (required, 10+ characters)" value={reason[x.id] || ''} onChange={(e) => setReason({ ...reason, [x.id]: e.target.value })} />
        {x.status !== 'approved' && <Btn size="sm" variant="good" onClick={() => decide(kind, x.id, 'approved')}>Approve</Btn>}
        {x.status === 'pending' && <Btn size="sm" onClick={() => decide(kind, x.id, 'more_info')}>Request corrections</Btn>}
        {x.status === 'approved' && <Btn size="sm" variant="danger" onClick={() => decide(kind, x.id, 'suspended')}>Suspend</Btn>}
        {x.status === 'approved' && <Btn size="sm" variant="danger" onClick={() => decide(kind, x.id, 'rejected')}>Revoke approval</Btn>}
        {x.status !== 'approved' && <Btn size="sm" variant="danger" onClick={() => decide(kind, x.id, 'rejected')}>Reject</Btn>}</div>}
      {x.status_reason && <p className="tiny muted">Last reason: {x.status_reason}</p>}
    </div>);
  return (
    <div className="stack-l"><PageHead title="Reviews" text="Hospitals and doctors are reviewed separately. Every decision needs a reason and is written to the audit log by the database." />
      <ErrorNote text={error} />{msg && <div className="notice small" role="status">{msg}</div>}
      {loading && !data ? <Loading /> : data && <div className="grid-2">
        <Card title="Hospital applications">{data.hospitals.length ? data.hospitals.map((h) => <Row key={h.id} kind="h" x={h} title={h.name} sub={`${h.city} · ${h.registration_no}`} />) : <p className="small muted">None yet.</p>}</Card>
        <Card title="Doctor credentials">{data.doctors.length ? data.doctors.map((d) => <Row key={d.id} kind="d" x={d} title={d.full_name} sub={`${d.specialty} · ${d.hospitals?.name || ''} (${d.hospitals?.status || '?'})`} />) : <p className="small muted">None yet.</p>}</Card>
      </div>}
    </div>
  );
}

export function AuditPage() {
  const { sb } = useCloud();
  const [{ loading, data, error }, reload] = useLoad(() => api.listAudit(sb), []);
  return (
    <div className="stack-l"><PageHead title="Audit log" text="Written by the database on every decision and consent change. Users cannot edit it." actions={<Btn size="sm" icon={Gavel} onClick={reload}>Refresh</Btn>} />
      <ErrorNote text={error} />
      {loading && !data ? <Loading /> : <Card bodyClass="table-wrap"><table className="table"><thead><tr><th>When</th><th>Action</th><th>Target</th><th>Detail</th></tr></thead><tbody>{(data || []).map((a) => <tr key={a.id}><td className="small">{new Date(a.created_at).toLocaleString()}</td><td className="small">{a.action}</td><td className="small">{a.target_table}</td><td className="tiny muted">{JSON.stringify(a.detail)}</td></tr>)}</tbody></table></Card>}
    </div>
  );
}
