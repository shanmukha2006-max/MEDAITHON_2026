import { useEffect, useRef, useState } from 'react';
import { Bell, Search, ShieldCheck, CalendarDays, History, BellRing, Check, KeyRound, UserCog, Sparkles, RotateCcw, Trash2, SlidersHorizontal, UserPlus } from 'lucide-react';
import * as api from '../backend/api.js';
import { subscribeTable } from '../backend/realtime.js';
import { useCloud } from './CloudContext.jsx';
import { Card, Btn, Badge, Field, Empty, StatusBadge, PageHead, OutcomeChip } from '../components/ui.jsx';

export const useLoad = (fn, deps = []) => {
  const [state, setState] = useState({ loading: true, data: null, error: '' });
  const reload = async () => { setState((s) => ({ ...s, loading: true })); try { setState({ loading: false, data: await fn(), error: '' }); } catch (e) { setState((s) => ({ loading: false, data: s.data, error: e.message })); } };
  useEffect(() => { reload(); }, deps); // eslint-disable-line react-hooks/exhaustive-deps
  return [state, reload];
};
// Re-run `reload` when a table changes (real-time), with a polling fallback if real-time is unavailable.
export function useLive(table, reload, { filter, pollMs = 10000 } = {}) {
  const { sb } = useCloud();
  useEffect(() => {
    let poll = null;
    const unsub = subscribeTable(sb, table, { filter, onChange: () => reload(), onStatus: (st) => { if (st === 'SUBSCRIBED') { if (poll) { clearInterval(poll); poll = null; } } else if (!poll && ['CHANNEL_ERROR', 'TIMED_OUT', 'CLOSED'].includes(st)) poll = setInterval(reload, pollMs); } });
    const fb = setTimeout(() => { if (!poll) poll = setInterval(reload, pollMs); }, 8000);
    return () => { unsub(); clearTimeout(fb); if (poll) clearInterval(poll); };
  }, [table, filter]); // eslint-disable-line react-hooks/exhaustive-deps
}
const Loading = () => <p className="small muted" role="status">Loading…</p>;
const Msg = ({ m }) => (m ? <div className={`notice small ${m.ok === false ? 'bad' : ''}`} role={m.ok === false ? 'alert' : 'status'}>{m.text}</div> : null);
const when = (t) => new Date(t).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });

// ---------------- notifications bell (in-app only) ----------------
export function NotificationBell({ onOpenLink }) {
  const { sb } = useCloud();
  const [open, setOpen] = useState(false);
  const [{ data }, reload] = useLoad(() => api.listNotifications(sb), []);
  useLive('notifications', reload, { pollMs: 8000 });
  const unread = (data || []).filter((n) => !n.read_at);
  const toggle = async () => { const o = !open; setOpen(o); if (o && unread.length) { try { await api.markNotificationsRead(sb, unread.map((n) => n.id)); reload(); } catch { /* shown on next load */ } } };
  return (
    <div style={{ position: 'relative' }}>
      <button className="btn ghost" onClick={toggle} aria-label={`Notifications, ${unread.length} unread`} data-testid="bell"><Bell size={18} />{unread.length > 0 && <Badge tone="bad">{unread.length}</Badge>}</button>
      {open && <div className="notif-pop" data-testid="notif-list"><div className="card-head"><h3>Notifications</h3><span className="tiny muted">In-app only. No email, SMS or push.</span></div>
        <div className="card-body">{(data || []).length ? data.map((n) => <button key={n.id} className="list-item small" style={{ display: 'block', width: '100%', textAlign: 'left', background: 'none', border: 0, cursor: n.link ? 'pointer' : 'default' }} onClick={() => { if (n.link) { onOpenLink(n.link); setOpen(false); } }}><strong>{n.title}</strong><div className="tiny muted">{n.body}</div><div className="tiny muted">{when(n.created_at)}</div></button>) : <p className="small muted">No notifications yet.</p>}</div></div>}
    </div>
  );
}

// ---------------- patient: providers directory + sharing ----------------
export function ProvidersPage() {
  const { sb, profile } = useCloud();
  const [q, setQ] = useState(''); const [m, setM] = useState(null);
  const [{ loading, data, error }, reload] = useLoad(async () => ({ ...(await api.listDirectory(sb)), consents: await api.listConsents(sb), authority: await api.getAuthorityAccess(sb, profile.id) }), []);
  const shareAuthority = async (on) => { try { await api.setAuthorityAccess(sb, profile.id, on); setM({ text: on ? 'Shared with the healthcare authority (read-only). You can stop at any time.' : 'Stopped sharing with the healthcare authority. Their access ended immediately.' }); reload(); } catch (e) { setM({ ok: false, text: e.message }); } };
  const ql = q.trim().toLowerCase();
  const share = async (h, on) => { try { await api.setConsent(sb, { patientId: profile.id, hospitalId: h.id, scopes: on ? ['reports', 'live'] : [] }); setM({ text: on ? `Shared with ${h.name}’s care team.` : `Stopped sharing with ${h.name}. Their access ended immediately.` }); reload(); } catch (e) { setM({ ok: false, text: e.message }); } };
  return (
    <div className="stack-l">
      <PageHead title="Care providers" text="Only hospitals approved by the healthcare authority, and doctors whose own credentials were verified, are listed. Sharing gives that hospital’s verified care team access to your sessions, results and alerts; it is enforced by the database." />
      <div style={{ position: 'relative', maxWidth: 480 }}><Search size={16} style={{ position: 'absolute', left: 10, top: 11, color: 'var(--ink-3)' }} /><input className="input" style={{ paddingLeft: 32 }} aria-label="Search providers" placeholder="Search hospital, city, doctor or specialty" value={q} onChange={(e) => setQ(e.target.value)} /></div>
      {error && <Msg m={{ ok: false, text: error }} />}<Msg m={m} />
      {data && (
        <Card className="flat" title="Healthcare authority" sub="The authority that approves hospitals and verifies doctors." data-testid="authority-share-card"
          actions={<>{data.authority?.active ? <Badge tone="good"><ShieldCheck size={12} />Shared</Badge> : <Badge tone="neutral">Not shared</Badge>}
            <Btn size="sm" variant={data.authority?.active ? 'danger' : 'primary'} onClick={() => shareAuthority(!data.authority?.active)}>{data.authority?.active ? 'Stop sharing' : 'Share with authority'}</Btn></>}>
          <p className="small muted">If you share, authority administrators can <strong>view</strong> your profile name, monitoring sessions, results, alerts and reports. They cannot change anything or act on alerts; your care team does that. Every change to this setting is recorded in the audit log.</p>
        </Card>
      )}
      {loading && !data ? <Loading /> : data && (data.hospitals.length ? data.hospitals.filter((h) => !ql || [h.name, h.city].some((x) => x.toLowerCase().includes(ql)) || data.doctors.some((d) => d.hospital_id === h.id && [d.full_name, d.specialty].some((x) => x.toLowerCase().includes(ql)))).map((h) => {
        const c = data.consents.find((x) => x.hospital_id === h.id); const on = !!(c?.active && c.scopes.includes('reports'));
        const docs = data.doctors.filter((d) => d.hospital_id === h.id);
        return (
          <Card key={h.id} className="flat" title={h.name} sub={`${h.city} · approved by the demo authority`} actions={<>{on ? <Badge tone="good"><ShieldCheck size={12} />Shared</Badge> : <Badge tone="neutral">Not shared</Badge>}<Btn size="sm" variant={on ? 'danger' : 'primary'} onClick={() => share(h, !on)}>{on ? 'Stop sharing' : 'Share'}</Btn></>}>
            {docs.length ? docs.map((d) => <div key={d.id} className="small list-item">{d.full_name} <span className="tiny muted">· {d.specialty} · verified (demo)</span></div>) : <p className="tiny muted">No verified doctors yet.</p>}
          </Card>
        );
      }) : <Empty title="No approved hospitals yet" text="A hospital appears here once the healthcare authority approves it." />)}
    </div>
  );
}

// ---------------- appointments (patient and care team) ----------------
export function AppointmentsPage() {
  const { sb, profile } = useCloud();
  const patient = profile.role === 'patient';
  const [{ loading, data, error }, reload] = useLoad(async () => ({ appts: await api.listAppointments(sb), dir: patient ? await api.listDirectory(sb) : null }), []);
  useLive('appointments', reload);
  const [f, setF] = useState({ doctorId: '', when: '', reason: '' }); const [m, setM] = useState(null); const [hist, setHist] = useState({}); const [resched, setResched] = useState({});
  const act = async (fn, ok) => { try { await fn(); setM({ text: ok }); reload(); } catch (e) { setM({ ok: false, text: e.message }); } };
  const request = () => { const d = data.dir.doctors.find((x) => x.id === f.doctorId); if (!d) return setM({ ok: false, text: 'Choose a verified doctor.' }); return act(() => api.requestAppointment(sb, { patientId: profile.id, doctorId: d.id, hospitalId: d.hospital_id, when: f.when, reason: f.reason }), 'Appointment requested. The hospital has been notified.'); };
  const showHistory = async (id) => { try { setHist({ ...hist, [id]: await api.listAppointmentEvents(sb, id) }); } catch (e) { setM({ ok: false, text: e.message }); } };
  return (
    <div className="stack-l">
      <PageHead title="Appointments" text={patient ? 'Requests go to the hospital’s care team. Changes appear here without refreshing.' : 'Requests from patients for your hospital’s verified doctors.'} />
      {error && <Msg m={{ ok: false, text: error }} />}<Msg m={m} />
      {patient && data?.dir && <Card title="Request an appointment"><div className="grid-3" style={{ alignItems: 'end' }}>
        <Field label="Verified doctor"><select className="select" value={f.doctorId} onChange={(e) => setF({ ...f, doctorId: e.target.value })}><option value="">Choose…</option>{data.dir.doctors.map((d) => <option key={d.id} value={d.id}>{d.full_name} · {d.specialty} · {data.dir.hospitals.find((h) => h.id === d.hospital_id)?.name}</option>)}</select></Field>
        <Field label="Preferred time"><input className="input" type="datetime-local" value={f.when} onChange={(e) => setF({ ...f, when: e.target.value })} /></Field>
        <Field label="Reason" hint="optional"><input className="input" maxLength={500} value={f.reason} onChange={(e) => setF({ ...f, reason: e.target.value })} /></Field>
      </div><div style={{ marginTop: 10 }}><Btn variant="primary" icon={CalendarDays} onClick={request}>Request appointment</Btn></div></Card>}
      {loading && !data ? <Loading /> : data?.appts.length ? data.appts.map((a) => (
        <Card key={a.id} className="flat" title={`${when(a.requested_for)} · ${a.doctors?.full_name || 'Doctor'}`} sub={`${a.hospitals?.name || ''}${!patient ? ` · patient: ${a.profiles?.full_name || 'synthetic patient'}` : ''}${a.reason ? ` · ${a.reason}` : ''}`} actions={<StatusBadge status={a.status} />}>
          <div className="row">
            {patient && ['requested', 'confirmed'].includes(a.status) && <Btn size="sm" variant="danger" onClick={() => act(() => api.setAppointmentStatus(sb, a.id, 'cancelled'), 'Appointment cancelled.')}>Cancel</Btn>}
            {!patient && a.status === 'requested' && <><Btn size="sm" variant="good" onClick={() => act(() => api.setAppointmentStatus(sb, a.id, 'confirmed'), 'Confirmed. The patient has been notified.')}>Confirm</Btn><Btn size="sm" variant="danger" onClick={() => act(() => api.setAppointmentStatus(sb, a.id, 'declined'), 'Declined.')}>Decline</Btn></>}
            {!patient && a.status === 'confirmed' && <Btn size="sm" onClick={() => act(() => api.setAppointmentStatus(sb, a.id, 'completed'), 'Marked completed.')}>Mark completed</Btn>}
            {((patient && a.status === 'requested') || (!patient && ['requested', 'confirmed'].includes(a.status))) && <>
              <input className="input" style={{ width: 210 }} type="datetime-local" aria-label="New time" value={resched[a.id] || ''} onChange={(e) => setResched({ ...resched, [a.id]: e.target.value })} />
              <Btn size="sm" onClick={() => act(() => api.rescheduleAppointment(sb, a.id, resched[a.id], patient ? 'Patient changed the requested time' : 'Rescheduled by the hospital'), 'Time changed. The other side has been notified.')} disabled={!resched[a.id]}>{patient ? 'Change time' : 'Reschedule'}</Btn></>}
            <Btn size="sm" variant="ghost" icon={History} onClick={() => showHistory(a.id)}>History</Btn>
          </div>
          {hist[a.id] && <ol className="small" style={{ marginTop: 8 }}>{hist[a.id].map((e) => <li key={e.id}>{when(e.created_at)}: {e.from_status ? `${e.from_status} → ` : ''}{e.to_status}{e.from_time && e.to_time && e.from_time !== e.to_time ? ` (time ${when(e.from_time)} → ${when(e.to_time)})` : ''}{e.note ? ` · ${e.note}` : ''}</li>)}</ol>}
        </Card>
      )) : <Empty title="No appointments" text={patient ? 'Request one above.' : 'Requests appear here when patients book your verified doctors.'} />}
    </div>
  );
}

// ---------------- alerts history (patient: own; care team: consented) ----------------
export function AlertsPage() {
  const { sb, profile } = useCloud();
  const [{ loading, data, error }, reload] = useLoad(() => api.listAllAlerts(sb), []);
  useLive('alerts', reload);
  const [m, setM] = useState(null);
  const [res, setRes] = useState({});
  const resolve = async (id) => { try { await api.resolveAlert(sb, id, res[id] || ''); setM({ text: 'Alert resolved.' }); setRes({ ...res, [id]: undefined }); reload(); } catch (e) { setM({ ok: false, text: e.message }); } };
  const ack = async (id) => { try { await api.acknowledgeAlert(sb, id); setM({ text: 'Alert acknowledged.' }); reload(); } catch (e) { setM({ ok: false, text: e.message }); } };
  return (
    <div className="stack-l">
      <PageHead title="Alerts" text="Created by the backend when a session’s simulated result changes under the current alert rules. A software demonstration, not a clinical warning system." />
      {error && <Msg m={{ ok: false, text: error }} />}<Msg m={m} />
      {loading && !data ? <Loading /> : data?.length ? <Card bodyClass="table-wrap"><table className="table"><thead><tr><th>When</th>{profile.role !== 'patient' && <th>Patient</th>}<th>Session</th><th>Result</th><th>Explanation</th><th>Status</th></tr></thead>
        <tbody>{data.map((a) => <tr key={a.id}><td className="small">{when(a.created_at)}<div className="tiny muted">at {a.window_end}s</div></td>{profile.role !== 'patient' && <td className="small">{a.monitoring_sessions?.profiles?.full_name || 'Synthetic patient'}</td>}<td className="small">{a.monitoring_sessions?.patch === 'care' ? 'Care' : 'Quick'} · {a.monitoring_sessions?.scenario_id}</td><td><OutcomeChip outcome={a.category} /></td><td className="tiny muted">{a.explanation}<div>Quality {Math.round((a.quality_context?.quality ?? 0) * 100)}%</div></td><td>{a.resolved_at ? <div><Badge tone="good"><Check size={12} />Resolved</Badge><div className="tiny muted">{a.resolution_note}</div></div> : <div className="stack-s">{a.acknowledged_at ? <Badge tone="neutral"><Check size={12} />Acknowledged</Badge> : profile.role !== 'patient' ? <Btn size="sm" icon={BellRing} onClick={() => ack(a.id)}>Acknowledge</Btn> : <Badge tone="warn">Awaiting review</Badge>}{profile.role !== 'patient' && <div className="row"><input className="input" style={{ maxWidth: 180 }} placeholder="Resolution note" aria-label="Resolution note" value={res[a.id] || ''} onChange={(e) => setRes({ ...res, [a.id]: e.target.value })} /><Btn size="sm" onClick={() => resolve(a.id)}>Resolve</Btn></div>}</div>}</td></tr>)}</tbody></table></Card>
        : <Empty title="No alerts" text="Alerts appear when a monitored session’s result changes." />}
    </div>
  );
}

// ---------------- profile ----------------
export function ProfilePage() {
  const { sb, profile, refreshProfile, session, updatePassword } = useCloud();
  const [f, setF] = useState({ fullName: profile.full_name, baselineRate: profile.baseline_rate, baselineSd: profile.baseline_sd }); const [pw, setPw] = useState(''); const [m, setM] = useState(null);
  const save = async () => { try { await api.updateProfile(sb, profile.id, { fullName: f.fullName, baselineRate: Number(f.baselineRate), baselineSd: Number(f.baselineSd) }); await refreshProfile(); setM({ text: 'Profile saved.' }); } catch (e) { setM({ ok: false, text: e.message }); } };
  const change = async () => { try { await updatePassword(pw); setPw(''); setM({ text: 'Password changed.' }); } catch (e) { setM({ ok: false, text: e.message }); } };
  return (
    <div className="stack-l"><PageHead title="Profile" text={`Signed in as ${session.user.email}. Your account type is set by the system and cannot be changed here.`} /><Msg m={m} />
      <div className="grid-2">
        <Card title="Details"><div className="stack"><Field label="Full name"><input className="input" maxLength={200} value={f.fullName} onChange={(e) => setF({ ...f, fullName: e.target.value })} /></Field>
          {profile.role === 'patient' && <div className="grid-2"><Field label="Baseline breathing rate" hint="breaths/min, 6–30"><input className="input" type="number" min="6" max="30" step="0.5" value={f.baselineRate} onChange={(e) => setF({ ...f, baselineRate: e.target.value })} /></Field><Field label="Baseline variation" hint="0.5–10"><input className="input" type="number" min="0.5" max="10" step="0.5" value={f.baselineSd} onChange={(e) => setF({ ...f, baselineSd: e.target.value })} /></Field></div>}
          <div><Btn variant="primary" icon={UserCog} onClick={save}>Save profile</Btn></div></div></Card>
        <Card title="Password"><div className="stack"><Field label="New password" hint="at least 8 characters"><input className="input" type="password" autoComplete="new-password" value={pw} onChange={(e) => setPw(e.target.value)} /></Field><div><Btn icon={KeyRound} onClick={change} disabled={!pw}>Change password</Btn></div></div></Card>
      </div>
    </div>
  );
}

// ---------------- AI assistant: history, loading, error, retry, empty ----------------
export function AssistantPage() {
  const { sb, profile } = useCloud();
  const [optIn, setOptIn] = useState(!!profile?.ai_history_opt_in);
  const toggleOpt = async (on) => { try { await api.setAiHistoryOptIn(sb, profile.id, on); setOptIn(on); } catch (e) { alert(e.message); } };
  const [{ data: sessions }] = useLoad(() => api.listSessions(sb, 20), []);
  const [{ loading, data: hist, error: histErr }, reload] = useLoad(() => api.listAiHistory(sb, profile.id), []);
  const [live, setLive] = useState([]); // this visit's exchanges when history saving is off
  const [q, setQ] = useState(''); const [sid, setSid] = useState(''); const [busy, setBusy] = useState(false); const [fail, setFail] = useState(null); const [setup, setSetup] = useState(null);
  const endRef = useRef(null);
  useEffect(() => { endRef.current?.scrollIntoView?.({ block: 'nearest' }); }, [hist]);
  const ask = async (question = q) => {
    setBusy(true); setFail(null); setSetup(null);
    try {
      const out = await api.askAssistant(sb, { question, sessionId: sid || undefined });
      if (out?.configured === false) setSetup(out.message);
      else {
        setQ('');
        // Always show the answer that came back. If history is off (the default), it is shown for this visit only and not stored.
        if (out.historySaved) { setLive([]); await reload(); }
        else setLive((l) => [...l, { id: `q${Date.now()}`, role: 'user', content: question }, { id: `a${Date.now()}`, role: 'assistant', content: out.answer, model: out.model, unsaved: true }]);
      }
    }
    catch (e) { setFail({ text: e.message, question }); } finally { setBusy(false); }
  };
  const clear = async () => { try { await api.clearAiHistory(sb, profile.id); reload(); } catch (e) { setFail({ text: e.message }); } };
  return (
    <div className="stack-l"><PageHead title="AI assistant" text="Explains your simulated results, alerts and reports, helps you find your way around, and answers general respiratory questions. It runs on the server, only sees data you can see, and never diagnoses or advises on medication." actions={<><label className="check small"><input type="checkbox" checked={!!optIn} onChange={(e) => toggleOpt(e.target.checked)} data-testid="ai-optin" />Save my conversation history</label><Btn size="sm" variant="ghost" icon={Trash2} onClick={clear}>Clear history</Btn></>} />
      <p className="tiny muted">History is off unless you switch it on. When on, it is stored privately (only you can read it) and used for follow-up questions.</p>
      <Card>
        <div className="stack" data-testid="ai-thread">
          {histErr && <Msg m={{ ok: false, text: histErr }} />}
          {loading && !hist ? <Loading /> : [...(hist || []), ...live].length ? [...(hist || []), ...live].map((x) => <div key={x.id} className={`notice small ${x.role === 'user' ? '' : 'warn'}`} style={x.role === 'user' ? { background: 'var(--surface)', borderColor: 'var(--line)' } : undefined}><strong>{x.role === 'user' ? 'You' : 'Assistant'}</strong><p style={{ whiteSpace: 'pre-wrap', marginTop: 4 }}>{x.content}</p>{x.role === 'assistant' && <p className="tiny muted" style={{ marginTop: 4 }}>AI-generated explanation of synthetic data. Not medical advice. Model: {x.model || 'unknown'}.</p>}</div>)
            : <Empty icon={Sparkles} title="Ask anything about BreatheGuard" text="For example: “Why did my session say insufficient reliable data?” or “How do I share a report with my hospital?”" />}
          {live.length > 0 && <p className="tiny muted" data-testid="ai-not-saved">These answers are not saved: conversation history is off. You can turn it on in Profile.</p>}
          <div ref={endRef} />
          {setup && <div className="notice warn small" role="status"><strong>Assistant not set up.</strong> {setup} No answer was generated.</div>}
          {fail && <div className="notice bad small" role="alert">{fail.text} {fail.question && <Btn size="sm" icon={RotateCcw} onClick={() => ask(fail.question)}>Retry</Btn>}</div>}
          {busy && <p className="small muted" role="status">The assistant is thinking…</p>}
          <Field label="About which session?" hint="optional"><select className="select" value={sid} onChange={(e) => setSid(e.target.value)}><option value="">General question</option>{(sessions || []).map((s) => <option key={s.id} value={s.id}>{when(s.started_at)} · {s.patch === 'care' ? 'Care' : 'Quick'} · {s.scenario_id}</option>)}</select></Field>
          <Field label="Question"><textarea className="textarea" maxLength={800} value={q} onChange={(e) => setQ(e.target.value)} placeholder="Type your question" /></Field>
          <div><Btn variant="primary" icon={Sparkles} disabled={busy || !q.trim()} onClick={() => ask()}>{busy ? 'Asking…' : 'Ask'}</Btn></div>
          <p className="tiny muted">Your conversation is stored privately in your account (not visible to hospitals or administrators) and you can clear it at any time. If you have real breathing difficulty, contact emergency services or a clinician now.</p>
        </div>
      </Card>
    </div>
  );
}

// ---------------- authority: alert rules, administrators ----------------
export function AlertRulesPage() {
  const { sb } = useCloud();
  const [{ loading, data, error }, reload] = useLoad(() => api.getAlertSettings(sb), []);
  const [f, setF] = useState(null); const [reason, setReason] = useState(''); const [m, setM] = useState(null);
  useEffect(() => { if (data) setF({ min: data.concerning_min_windows, ins: data.alert_on_insufficient }); }, [data]);
  const save = async () => { try { await api.updateAlertSettings(sb, Number(f.min), f.ins, reason); setReason(''); setM({ text: 'Alert rules updated and audited.' }); reload(); } catch (e) { setM({ ok: false, text: e.message }); } };
  return (
    <div className="stack-l"><PageHead title="Alert rules" text="Deterministic rules the database applies to every new analysis result. Changes are audited." />
      {error && <Msg m={{ ok: false, text: error }} />}<Msg m={m} />
      {loading || !f ? <Loading /> : <Card><div className="stack">
        <Field label="Raise a ‘potentially concerning’ alert after this many consecutive concerning windows"><select className="select" style={{ maxWidth: 120 }} value={f.min} onChange={(e) => setF({ ...f, min: e.target.value })}>{[1, 2, 3, 4, 5].map((n) => <option key={n}>{n}</option>)}</select></Field>
        <label className="check"><input type="checkbox" checked={f.ins} onChange={(e) => setF({ ...f, ins: e.target.checked })} />Also alert when data becomes insufficient (sensor failure, ambiguous signals)</label>
        <Field label="Reason for the change" hint="required"><input className="input" value={reason} onChange={(e) => setReason(e.target.value)} /></Field>
        <div><Btn variant="primary" icon={SlidersHorizontal} onClick={save}>Save rules</Btn></div>
        <p className="tiny muted">Current: {data.concerning_min_windows} window(s); insufficient-data alerts {data.alert_on_insufficient ? 'on' : 'off'}; last changed {when(data.updated_at)}.</p>
      </div></Card>}
    </div>
  );
}

export function AdminsPage() {
  const { sb } = useCloud();
  const [{ loading, data, error }, reload] = useLoad(() => api.listAdministrators(sb), []);
  const [f, setF] = useState({ email: '', reason: '' }); const [m, setM] = useState(null);
  const go = async (grant) => { try { await api.setAuthority(sb, f.email.trim(), grant, f.reason); setM({ text: grant ? 'Administrator rights granted.' : 'Administrator rights removed.' }); setF({ email: '', reason: '' }); reload(); } catch (e) { setM({ ok: false, text: e.message }); } };
  return (
    <div className="stack-l"><PageHead title="Administrators" text="Healthcare authority accounts. The first administrator is created in the database (see docs/BACKEND_SETUP.md); after that, administrators manage each other here. Every change needs a reason and is audited. You cannot remove yourself or the last administrator." />
      {error && <Msg m={{ ok: false, text: error }} />}<Msg m={m} />
      {loading && !data ? <Loading /> : <Card title={`Current administrators (${data?.length || 0})`}>{(data || []).map((a) => <div key={a.id} className="list-item small">{a.full_name || a.id}</div>)}</Card>}
      <Card title="Grant or remove rights"><div className="stack"><div className="grid-2"><Field label="Account email" hint="the person must have registered"><input className="input" type="email" value={f.email} onChange={(e) => setF({ ...f, email: e.target.value })} /></Field><Field label="Reason" hint="required"><input className="input" value={f.reason} onChange={(e) => setF({ ...f, reason: e.target.value })} /></Field></div>
        <div className="row"><Btn variant="primary" icon={UserPlus} onClick={() => go(true)}>Grant administrator</Btn><Btn variant="danger" onClick={() => go(false)}>Remove administrator</Btn></div></div></Card>
    </div>
  );
}

// ---------------- doctor: own record ----------------
export function DoctorHomePage() {
  const { sb, profile } = useCloud();
  const [{ loading, data, error }] = useLoad(() => api.myDoctorRecord(sb, profile.id), []);
  return (
    <div className="stack-l"><PageHead title="Your doctor record" text="Care-team access starts only when your hospital has linked this account, the authority has verified your credentials, and your hospital is approved." />
      {error && <Msg m={{ ok: false, text: error }} />}
      {loading ? <Loading /> : data ? <Card title={data.full_name} actions={<StatusBadge status={data.status} />}><p className="small">{data.specialty} · {data.license_no} · {data.hospitals?.name} (<StatusBadge status={data.hospitals?.status || 'pending'} />)</p>{data.status_reason && <p className="small muted" style={{ marginTop: 6 }}>Authority’s reason: {data.status_reason}</p>}<p className="small" style={{ marginTop: 8 }}>{data.status === 'approved' && data.hospitals?.status === 'approved' ? 'You have care-team access to patients who share with your hospital.' : 'Outstanding: verification by the authority and/or hospital approval.'}</p></Card>
        : <Empty title="Not linked yet" text="Ask your hospital’s staff to add your doctor record and link it to this account’s email." />}
    </div>
  );
}
