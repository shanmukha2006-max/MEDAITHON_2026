import { useState } from 'react';
import { User, Building2, Landmark, Presentation, Layers } from 'lucide-react';
import { useStore } from '../data/store.jsx';
import { registerPatient, registerHospital } from '../data/actions.js';
import { Card, Btn, Field, Badge } from '../components/ui.jsx';
import CloudLogin from '../cloud/CloudLogin.jsx';
import BreathingVisual from '../components/BreathingVisual.jsx';

const QUICK = [
  { id: 'u_pat1', icon: User, title: 'Patient', who: 'Asha Rao', note: 'Monitor, find care, consent, reviews' },
  { id: 'u_hosp1', icon: Building2, title: 'Hospital (approved)', who: 'Riverside Demo Hospital', note: 'Doctors, appointments, shared reports' },
  { id: 'u_hosp2', icon: Building2, title: 'Hospital (pending)', who: 'Northgate Demo Clinic', note: 'Application awaiting review' },
  { id: 'u_auth1', icon: Landmark, title: 'Healthcare authority (demo)', who: 'Dana Okafor', note: 'Local demo only: decisions here are not real approvals' },
];

export default function Login() {
  const { state, login, loginAs, act, judgeGo } = useStore();
  const [tab, setTab] = useState('signin');
  const [who, setWho] = useState('patient'); // sign-in tile: patient | hospital | authority
  const [f, setF] = useState({ email: '', password: '', name: '', hName: '', city: '', reg: '', bodyModel: '' });
  const s = (k) => (e) => setF({ ...f, [k]: e.target.value });
  const doRegister = () => {
    if (tab === 'patient') {
      const u = act(registerPatient, { name: f.name, email: f.email, password: f.password, bodyModel: f.bodyModel }, 'Account created.');
      if (u) loginAs(u.id);
    } else {
      const r = act(registerHospital, { adminName: f.name, email: f.email, password: f.password, hospital: { name: f.hName, city: f.city, registrationNo: f.reg } }, 'Application submitted. Status: pending review.');
      if (r) loginAs(r.userId);
    }
  };
  return (
    <div className="login-wrap">
      <div className="login-side">
        <BreathingVisual />
        <h1>See Beyond the Signal. Understand the Breathing.</h1>
        <p style={{ maxWidth: '52ch' }}>BreatheGuard is a proposed wearable chest patch, in two versions, that checks whether a change in breathing can be explained by movement, noise or a failing sensor. When the evidence is not good enough, it says so instead of reassuring you.</p>
        <div className="row">
          <button className="btn" style={{ background: '#22c3d6', borderColor: '#22c3d6', color: '#0b1f3a' }} onClick={() => judgeGo(0)}><Presentation size={16} />Start Judge Demo</button>
          <button className="btn" style={{ background: 'transparent', borderColor: '#2a4a77', color: '#fff' }} onClick={() => { window.location.hash = '/patches'; loginAs('u_pat1'); }}><Layers size={16} />See the patches</button>
        </div>
        <p className="small" style={{ maxWidth: '52ch', color: '#b7c8de' }}>Hackathon prototype. All sensor data, hospitals, doctors and approvals are synthetic. Not a medical device and not clinically validated.</p>
      </div>
      <div className="login-main">
        <div className="stack-l" style={{ width: 'min(520px, 100%)' }}>
          <CloudLogin />
          <Card title="Try a demo account (local demo mode)" sub="One click, no password. Demo data stays in this browser.">
            <div className="role-row" role="group" aria-label="Demo sign-in by role">
              {[['u_pat1', User, 'Patient', 'Asha Rao', 'Monitor, find care, consent'],
                ['u_hosp1', Building2, 'Hospital (approved)', 'Riverside Demo Hospital', 'Doctors, appointments, shared reports'],
                ['u_auth1', Landmark, 'Healthcare authority (demo)', 'Dana Okafor', 'Not real approvals']].map(([id, I, title, who, note]) => state.users.some((u) => u.id === id) && (
                <button key={id} className="role-tile" onClick={() => loginAs(id)} data-testid={`demo-${id}`}>
                  <I size={22} aria-hidden /><strong>{title}</strong><span className="tiny">{who}</span><span className="tiny muted">{note}</span>
                </button>
              ))}
            </div>
            {state.users.some((u) => u.id === 'u_hosp2') && <p className="tiny muted" style={{ marginTop: 8 }}>Also: <button className="btn ghost sm" onClick={() => loginAs('u_hosp2')}>Hospital (pending) · Northgate Demo Clinic</button></p>}
          </Card>
          <Card title="Sign in with email" sub="Choose who you are, then sign in.">
            <div className="role-row compact" role="group" aria-label="Sign in as">
              {[['patient', User, 'Patient'], ['hospital', Building2, 'Hospital'], ['authority', Landmark, 'Healthcare authority']].map(([k, I, label]) => (
                <button key={k} className={`role-tile ${who === k ? 'on' : ''}`} aria-pressed={who === k} data-testid={`local-role-${k}`}
                  onClick={() => { setWho(k); setTab('signin'); }}><I size={18} aria-hidden /><strong>{label}</strong></button>
              ))}
            </div>
            <div className="seg" style={{ marginBottom: 14 }}>
              {[['signin', 'Sign in'], ...(who === 'patient' ? [['patient', 'New patient']] : who === 'hospital' ? [['hospital', 'Register hospital']] : [])].map(([k, l]) => <button key={k} className={tab === k ? 'on' : ''} onClick={() => setTab(k)}>{l}</button>)}
            </div>
            <div className="stack">
              {tab !== 'signin' && <Field label={tab === 'hospital' ? 'Administrator name' : 'Full name'}><input className="input" value={f.name} onChange={s('name')} /></Field>}
              {tab === 'patient' && <Field label="Body model for the 3D breathing view" hint="your choice; you can change it later"><select className="select" value={f.bodyModel} onChange={s('bodyModel')} data-testid="body-model-select"><option value="">Choose…</option><option value="female">Female</option><option value="male">Male</option></select></Field>}
              {tab === 'hospital' && <>
                <Field label="Hospital name"><input className="input" value={f.hName} onChange={s('hName')} placeholder="e.g. Hilltop Demo Hospital" /></Field>
                <div className="grid-2">
                  <Field label="City"><input className="input" value={f.city} onChange={s('city')} /></Field>
                  <Field label="Registration no." hint="demo"><input className="input" value={f.reg} onChange={s('reg')} placeholder="DEMO-H-…" /></Field>
                </div>
              </>}
              <Field label="Email"><input className="input" type="email" value={f.email} onChange={s('email')} autoComplete="username" placeholder={{ patient: 'asha@demo.test', hospital: 'riverside@demo.test', authority: 'authority@demo.test' }[who]} /></Field>
              <Field label="Password" hint={tab === 'signin' ? 'demo accounts use demo123' : 'at least 6 characters'}><input className="input" type="password" value={f.password} onChange={s('password')} autoComplete={tab === 'signin' ? 'current-password' : 'new-password'} onKeyDown={(e) => e.key === 'Enter' && tab === 'signin' && login(f.email, f.password, who)} /></Field>
              {tab === 'signin'
                ? <Btn variant="primary" onClick={() => login(f.email, f.password, who)}>{who === 'patient' ? 'Sign in as patient' : who === 'hospital' ? 'Sign in as hospital' : 'Sign in as healthcare authority'}</Btn>
                : <Btn variant="primary" onClick={doRegister}>{tab === 'hospital' ? 'Submit application' : 'Create account'}</Btn>}
              {who === 'authority' && <p className="tiny muted">Demo authority: <strong>authority@demo.test</strong> / demo123. Authority accounts cannot be self-registered. In connected mode the project owner creates them.</p>}
              {who !== 'authority' && tab === 'signin' && <p className="tiny muted">Demo {who}: <strong>{who === 'patient' ? 'asha@demo.test' : 'riverside@demo.test'}</strong> / demo123</p>}
              <p className="tiny muted">Local demo mode: accounts and passwords are stored unencrypted in this browser and nothing is shared between devices. Do not use a real password. For real accounts use connected mode above. <Badge tone="demo">Demo</Badge></p>
            </div>
          </Card>
        </div>
      </div>
    </div>
  );
}
