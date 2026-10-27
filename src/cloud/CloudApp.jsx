import { useState } from 'react';
import { Activity, ListChecks, ShieldCheck, Sparkles, Building2, MonitorDot, Gavel, ScrollText, LogOut, Cloud, BellRing, CalendarDays, UserCog, SlidersHorizontal, Users, Stethoscope } from 'lucide-react';
import { useCloud } from './CloudContext.jsx';
import LiveRecorder from './LiveRecorder.jsx';
import { SessionsPage, HospitalPage, ReviewsPage, AuditPage } from './Pages.jsx';
import { NotificationBell, ProvidersPage, AppointmentsPage, AlertsPage, ProfilePage, AssistantPage, AlertRulesPage, AdminsPage, DoctorHomePage } from './Pages7.jsx';
import ErrorBoundary from '../components/ErrorBoundary.jsx';
import FloatingAssistant from '../components/FloatingAssistant.jsx';
import { ConnectionsPage, MessagesPage, MedicinesPage, ReviewsPatientPage } from './Pages8.jsx';
import { UserPlus, MessageSquare, Pill, Star } from 'lucide-react';
import { Badge, Card, Btn, Field } from '../components/ui.jsx';

const NAV = {
  patient: [['record', 'Live monitor', Activity, LiveRecorder], ['sessions', 'My sessions', ListChecks, () => <SessionsPage />], ['alerts', 'Alerts', BellRing, AlertsPage], ['providers', 'Care providers', ShieldCheck, ProvidersPage], ['connections', 'Doctors', UserPlus, ConnectionsPage], ['messages', 'Messages', MessageSquare, MessagesPage], ['medicines', 'Medicines', Pill, MedicinesPage], ['myreviews', 'Reviews', Star, ReviewsPatientPage], ['appointments', 'Appointments', CalendarDays, AppointmentsPage], ['assistant', 'AI assistant', Sparkles, AssistantPage], ['profile', 'Profile', UserCog, ProfilePage]],
  hospital_staff: [['hospital', 'Your hospital', Building2, HospitalPage], ['live', 'Live patients', MonitorDot, () => <SessionsPage staff />], ['alerts', 'Alerts', BellRing, AlertsPage], ['appointments', 'Appointments', CalendarDays, AppointmentsPage], ['profile', 'Profile', UserCog, ProfilePage]],
  doctor: [['doctor', 'Your record', Stethoscope, DoctorHomePage], ['connections', 'Connections', UserPlus, ConnectionsPage], ['messages', 'Messages', MessageSquare, MessagesPage], ['medicines', 'Prescriptions', Pill, MedicinesPage], ['live', 'Live patients', MonitorDot, () => <SessionsPage staff />], ['alerts', 'Alerts', BellRing, AlertsPage], ['appointments', 'Appointments', CalendarDays, AppointmentsPage], ['profile', 'Profile', UserCog, ProfilePage]],
  authority: [['reviews', 'Reviews', Gavel, ReviewsPage], ['records', 'Shared patient records', MonitorDot, () => <SessionsPage authority />], ['rules', 'Alert rules', SlidersHorizontal, AlertRulesPage], ['admins', 'Administrators', Users, AdminsPage], ['audit', 'Audit log', ScrollText, AuditPage], ['profile', 'Profile', UserCog, ProfilePage]],
};
const ROLE = { patient: 'Patient', hospital_staff: 'Hospital staff', doctor: 'Doctor', authority: 'Healthcare authority' };
// Notification links name a page; map them onto each role's navigation.
const LINK = { sessions: 'sessions', live: 'live', appointments: 'appointments', hospital: 'hospital', connections: 'connections', messages: 'messages', medicines: 'medicines', alerts: 'alerts', providers: 'connections' };

function SetNewPassword() {
  const { updatePassword, finishRecovery } = useCloud();
  const [pw, setPw] = useState(''); const [m, setM] = useState(null);
  const save = async () => { try { await updatePassword(pw); setM({ text: 'Password changed. You are signed in.' }); setTimeout(finishRecovery, 1200); } catch (e) { setM({ bad: true, text: e.message }); } };
  return <Card title="Set a new password" sub="You followed a password-reset link."><div className="stack"><Field label="New password" hint="at least 8 characters"><input className="input" type="password" autoComplete="new-password" value={pw} onChange={(e) => setPw(e.target.value)} /></Field><div><Btn variant="primary" onClick={save}>Save new password</Btn></div>{m && <div className={`notice small ${m.bad ? 'bad' : ''}`}>{m.text}</div>}</div></Card>;
}

// Connected (multi-device) mode: real accounts, shared data, live updates.
export default function CloudApp() {
  const { profile, session, signOut, recovery } = useCloud();
  const nav = NAV[profile.role] || NAV.patient;
  const [page, setPage] = useState(nav[0][0]);
  const cur = nav.find((n) => n[0] === page) || nav[0];
  const El = cur[3];
  const openLink = (l) => { const t = LINK[l] || l; if (nav.some((n) => n[0] === t)) setPage(t); else if (t === 'hospital' && profile.role === 'doctor') setPage('doctor'); };
  const NavButtons = () => nav.map(([id, label, I]) => <button key={id} className={`nav-btn ${cur[0] === id ? 'active' : ''}`} onClick={() => setPage(id)} aria-current={cur[0] === id ? 'page' : undefined}><I size={17} />{label}</button>);
  return (
    <div className="shell">
      <aside className="sidebar" aria-label="Main navigation">
        <div className="brand"><div className="brand-mark"><Cloud size={18} color="#93e0d6" /></div><div><div className="brand-name">BreatheGuard</div><div className="portal-tag">Connected · {ROLE[profile.role]}</div></div></div>
        <NavButtons />
        <div className="sidebar-foot"><button className="nav-btn" onClick={signOut}><LogOut size={16} />Sign out</button></div>
      </aside>
      <div className="main">
        <header className="topbar">
          <div className="row"><strong>{profile.full_name || session.user.email}</strong><Badge tone="info">{ROLE[profile.role]}</Badge><Badge tone="good"><Cloud size={12} />Connected mode</Badge><Badge tone="demo">Synthetic data</Badge></div>
          <div className="row"><span className="tiny muted">{session.user.email}</span><NotificationBell onOpenLink={openLink} /></div>
        </header>
        <nav className="mobile-nav" aria-label="Sections"><NavButtons /></nav>
        <main className="content">{recovery && <div style={{ marginBottom: 16 }}><SetNewPassword /></div>}<ErrorBoundary resetKey={cur[0]} onHome={() => setPage(nav[0][0])} onReset={signOut}><El /></ErrorBoundary></main>
        {profile.role === 'patient' && <FloatingAssistant mode="cloud" />}
      </div>
    </div>
  );
}
