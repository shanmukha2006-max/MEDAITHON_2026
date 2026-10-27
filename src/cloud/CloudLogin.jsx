import { useState } from 'react';
import { Cloud, AlertTriangle, CheckCircle2, RefreshCcw, Landmark, WifiOff, Wrench, Settings2, User, Building2 } from 'lucide-react';
import { useCloud } from './CloudContext.jsx';
import { Card, Btn, Field, Badge } from '../components/ui.jsx';

// Sign in / register for connected (multi-device) mode. Shown on the login screen.
export default function CloudLogin() {
  const { configured, signIn, signUp, state, error: ctxError, requestReset, backend, recheck, signInAs, authError } = useCloud();
  const [tab, setTab] = useState('signin');
  const [who, setWho] = useState('patient'); // which role tile is selected (patient | hospital | authority)
  const [f, setF] = useState({ email: '', password: '', fullName: '', role: 'patient', bodyModel: '' });
  const [msg, setMsg] = useState(null);
  const [busy, setBusy] = useState(false);
  const s = (k) => (e) => setF({ ...f, [k]: e.target.value });
  const ICON = { 'configuration-required': Settings2, 'connection-error': WifiOff, 'setup-incomplete': Wrench, 'connected-verified': CheckCircle2, checking: RefreshCcw };
  const TONE = { 'configuration-required': 'neutral', 'connection-error': 'bad', 'setup-incomplete': 'warn', 'connected-verified': 'good', checking: 'info' };
  const SI = ICON[backend.state] || AlertTriangle;
  const statusBox = (
    <div className={`notice small ${backend.state === 'connected-verified' ? '' : backend.state === 'connection-error' ? 'bad' : 'warn'}`} data-testid="backend-status" role="status">
      <div className="row-between"><strong className="row" style={{ gap: 6 }}><SI size={15} />{backend.title}</strong>{backend.state !== 'checking' && <button className="btn ghost sm" onClick={recheck}><RefreshCcw size={13} />Check again</button>}</div>
      {backend.detail && <p style={{ marginTop: 4 }}>{backend.detail}</p>}
      {backend.steps?.length > 0 && <ol style={{ margin: '6px 0 0', paddingLeft: 18 }}>{backend.steps.map((x, i) => <li key={i}>{x}</li>)}</ol>}
      {backend.warnings?.map((w, i) => <p key={i} className="tiny" style={{ marginTop: 4 }}>⚠ {w}</p>)}
    </div>
  );
  const title = <span className="row" style={{ gap: 8 }}><Cloud size={18} />Connected mode (multi-device)</span>;
  if (backend.state !== 'connected-verified') {
    return (
      <Card title={title} actions={<Badge tone={TONE[backend.state] || 'neutral'}>{backend.state === 'checking' ? 'Checking…' : backend.title}</Badge>}>
        {statusBox}
        <p className="tiny muted" style={{ marginTop: 8 }}>Connected mode stays off until the backend is verified; it never switches you into demo mode. The local demo below is separate: demo accounts and data stay in this browser only. Full setup: <code>docs/BACKEND_SETUP.md</code>.</p>
      </Card>
    );
  }
  const submit = async () => {
    setBusy(true); setMsg(null);
    try {
      if (tab === 'reset') { await requestReset(f.email.trim()); setMsg({ ok: true, text: 'If an account exists for that email, a reset link has been sent. Follow it to set a new password.' }); return; }
      if (tab === 'signin') await signIn(f.email.trim(), f.password);
      else if (tab === 'authority') await signInAs(f.email.trim(), f.password, 'authority');
      else {
        const r = await signUp({ email: f.email.trim(), password: f.password, fullName: f.fullName.trim(), role: f.role, bodyModel: f.bodyModel });
        if (!r?.session) setMsg({ ok: true, text: 'Account created. Check your email to confirm it, then sign in.' });
      }
    } catch (e) { setMsg({ ok: false, text: e.message }); } finally { setBusy(false); }
  };
  return (
    <Card title={title} sub="Real accounts and shared data. Synthetic monitoring data only." actions={<Badge tone="good">Connected and verified</Badge>}>
      <div style={{ marginBottom: 12 }}>{statusBox}</div>
      <div className="role-row compact" role="group" aria-label="Sign in as">
        {[['patient', User, 'Patient'], ['hospital', Building2, 'Hospital'], ['authority', Landmark, 'Healthcare authority']].map(([k, I, label]) => {
          const on = k === 'authority' ? tab === 'authority' : tab !== 'authority' && who === k;
          return <button key={k} className={`role-tile ${on ? 'on' : ''}`} aria-pressed={on} data-testid={k === 'authority' ? 'authority-tab' : `role-${k}`}
            onClick={() => { setWho(k); if (k === 'authority') setTab('authority'); else { if (tab === 'authority') setTab('signin'); setF((x) => ({ ...x, role: k === 'hospital' ? 'hospital_staff' : 'patient' })); } }}>
            <I size={18} aria-hidden /><strong>{label}</strong></button>;
        })}
      </div>
      {tab !== 'authority' && <div className="seg" style={{ marginBottom: 12 }}>
        <button className={tab === 'signin' ? 'on' : ''} onClick={() => setTab('signin')}>Sign in</button>
        <button className={tab === 'register' ? 'on' : ''} onClick={() => setTab('register')}>Create account</button>
        <button className={tab === 'reset' ? 'on' : ''} onClick={() => setTab('reset')}>Forgot password</button>
      </div>}
      <div className="stack">
        {tab === 'register' && <>
          <Field label="Full name"><input className="input" value={f.fullName} onChange={s('fullName')} /></Field>
          <Field label="Account type" hint="authority accounts are created by an administrator">
            <select className="select" value={f.role} onChange={s('role')}><option value="patient">Patient</option><option value="hospital_staff">Hospital staff</option><option value="doctor">Doctor (linked by your hospital)</option></select>
          </Field>
        </>}
        {tab === 'register' && f.role === 'patient' && <Field label="Body model for the 3D breathing view" hint="your choice"><select className="select" value={f.bodyModel} onChange={s('bodyModel')}><option value="">Choose…</option><option value="female">Female</option><option value="male">Male</option></select></Field>}
        <Field label="Email"><input className="input" type="email" value={f.email} onChange={s('email')} autoComplete="username" /></Field>
        {tab !== 'reset' && <Field label="Password" hint={tab === 'register' ? 'at least 8 characters' : ''}><input className="input" type="password" value={f.password} onChange={s('password')} autoComplete={tab === 'signin' ? 'current-password' : 'new-password'} onKeyDown={(e) => e.key === 'Enter' && submit()} /></Field>}
        {tab === 'authority' && <p className="tiny muted">For healthcare authority administrators only. These accounts cannot be self-registered: the project owner provisions them (docs/BACKEND_SETUP.md, step 4). Other accounts are refused here.</p>}
        <Btn variant="primary" disabled={busy} onClick={submit}>{busy ? 'Please wait…' : tab === 'signin' ? 'Sign in' : tab === 'authority' ? 'Sign in as healthcare authority' : tab === 'reset' ? 'Send reset link' : 'Create account'}</Btn>
        {authError && <div className="notice bad small" role="alert" data-testid="auth-role-error">{authError}</div>}
        {msg && <div className={`notice small ${msg.ok ? '' : 'bad'}`} role="alert">{msg.text}</div>}
        {state === 'error' && ctxError && <div className="notice bad small" role="alert"><AlertTriangle size={14} /> {ctxError}</div>}
      </div>
    </Card>
  );
}
