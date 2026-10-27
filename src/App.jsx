import { useEffect, useRef, useState } from 'react';
import { LayoutDashboard, Activity, Search, CalendarDays, FileText, Pill, ShieldCheck, ClipboardCheck, Stethoscope, Users, Star, Building2, BadgeCheck, ShieldAlert, ScrollText, Bell, LogOut, RefreshCcw, Layers, Presentation } from 'lucide-react';
import { useStore, fmtDateTime } from './data/store.jsx';
import { markNotificationsRead, STATUS_LABEL } from './data/actions.js';
import Login from './pages/Login.jsx';
import Overview from './pages/patient/Overview.jsx';
import Monitor from './pages/patient/Monitor.jsx';
import PatchSelect from './pages/patient/PatchSelect.jsx';
import Directory from './pages/patient/Directory.jsx';
import Appointments from './pages/patient/Appointments.jsx';
import Reports from './pages/patient/Reports.jsx';
import Medicines from './pages/patient/Medicines.jsx';
import Consent from './pages/patient/Consent.jsx';
import Status from './pages/hospital/Status.jsx';
import Doctors from './pages/hospital/Doctors.jsx';
import HospitalAppointments from './pages/hospital/Appointments.jsx';
import Patients from './pages/hospital/Patients.jsx';
import HospitalReviews from './pages/hospital/Reviews.jsx';
import Review from './pages/authority/Review.jsx';
import Complaints from './pages/authority/Complaints.jsx';
import Audit from './pages/authority/Audit.jsx';
import { Badge } from './components/ui.jsx';
import JudgeBar from './components/JudgeBar.jsx';
import FloatingAssistant from './components/FloatingAssistant.jsx';
import ErrorBoundary from './components/ErrorBoundary.jsx';
import { useCloud } from './cloud/CloudContext.jsx';
import CloudApp from './cloud/CloudApp.jsx';

const NAV = {
  patient: [
    { id: 'overview', label: 'Overview', icon: LayoutDashboard, el: Overview },
    { id: 'patches', label: 'Choose a patch', icon: Layers, el: PatchSelect },
    { id: 'monitor', label: 'Patch simulator', icon: Activity, el: Monitor },
    { id: 'directory', label: 'Find care', icon: Search, el: Directory },
    { id: 'appointments', label: 'Appointments', icon: CalendarDays, el: Appointments },
    { id: 'reports', label: 'Reports', icon: FileText, el: Reports },
    { id: 'medicines', label: 'Medicines', icon: Pill, el: Medicines },
    { id: 'consent', label: 'Consent', icon: ShieldCheck, el: Consent },
  ],
  hospital: [
    { id: 'status', label: 'Registration status', icon: ClipboardCheck, el: Status },
    { id: 'doctors', label: 'Doctors', icon: Stethoscope, el: Doctors },
    { id: 'appointments', label: 'Appointments', icon: CalendarDays, el: HospitalAppointments },
    { id: 'patients', label: 'Patients', icon: Users, el: Patients },
    { id: 'reviews', label: 'Ratings and reviews', icon: Star, el: HospitalReviews },
  ],
  authority: [
    { id: 'hospitals', label: 'Hospital applications', icon: Building2, el: (p) => <Review kind="hospital" {...p} /> },
    { id: 'doctors', label: 'Doctor credentials', icon: BadgeCheck, el: (p) => <Review kind="doctor" {...p} /> },
    { id: 'complaints', label: 'Complaints and flags', icon: ShieldAlert, el: Complaints },
    { id: 'audit', label: 'Audit trail', icon: ScrollText, el: Audit },
  ],
};
const PORTAL = { patient: 'Patient portal', hospital: 'Hospital portal', authority: 'Healthcare authority portal' };

// Route = "#/page?key=value". The query lets buttons open a page with a preset
// (e.g. #/monitor?patch=quick or #/monitor?judge=1).
function parseHash(fallback) {
  const raw = window.location.hash.replace(/^#\/?/, '');
  const [page, qs] = raw.split('?');
  return { page: page || fallback, query: Object.fromEntries(new URLSearchParams(qs || '')) , raw };
}
function useHashPage(fallback) {
  const [route, setRoute] = useState(() => parseHash(fallback));
  useEffect(() => { const f = () => setRoute(parseHash(fallback)); window.addEventListener('hashchange', f); return () => window.removeEventListener('hashchange', f); }, [fallback]);
  const go = (p, query) => {
    const qs = query ? `?${new URLSearchParams(query).toString()}` : '';
    window.location.hash = `/${p}${qs}`;
    setRoute(parseHash(fallback));
    window.scrollTo(0, 0);
  };
  return [route, go];
}

export default function App() {
  const { user, toasts } = useStore();
  const cloud = useCloud();
  if (cloud.state === 'signed-in' && cloud.profile) {
    return (<><div className="demo-bar"><strong>Connected mode.</strong> Real accounts and shared data, but all monitoring data is synthetic. Not a medical device. <strong>If someone has real breathing difficulty, seek medical help now.</strong></div><CloudApp /></>);
  }
  return (
    <>
      <div className="demo-bar"><strong>Hackathon prototype{cloud.configured ? '' : ' · local demo mode (not shared, not secure)'}.</strong> Simulated data and fictional organisations. Not a medical device. <strong>If someone has real breathing difficulty, seek medical help now.</strong></div>
      {user ? <Portal key={user.id} /> : <Login />}
      <div className="toast-wrap" aria-live="polite">{toasts.map((t) => <div key={t.id} className={`toast ${t.kind === 'error' ? 'error' : ''}`}>{t.text}</div>)}</div>
    </>
  );
}

function Portal() {
  const { state, user, logout, resetDemo, act, judge, judgeGo } = useStore();
  const nav = NAV[user.role];
  const [route, go] = useHashPage(nav[0].id);
  const cur = nav.find((n) => n.id === route.page) || nav[0];
  const El = cur.el;
  const [bell, setBell] = useState(false);
  const mobileNav = useRef(null);
  // keep the current section visible in the swipeable mobile nav
  useEffect(() => {
    const el = mobileNav.current?.querySelector('.nav-btn.active');
    if (el && mobileNav.current.scrollWidth > mobileNav.current.clientWidth) {
      mobileNav.current.scrollLeft = el.offsetLeft - mobileNav.current.clientWidth / 2 + el.clientWidth / 2;
    }
  }, [cur.id]);
  const notes = state.notifications.filter((n) => n.userId === user.id);
  const unread = notes.filter((n) => !n.read).length;
  const hospital = user.role === 'hospital' ? state.hospitals.find((h) => h.id === user.hospitalId) : null;
  const NavButtons = () => nav.map((n) => { const I = n.icon; return <button key={n.id} className={`nav-btn ${cur.id === n.id ? 'active' : ''}`} onClick={() => go(n.id)} aria-current={cur.id === n.id ? 'page' : undefined}><I size={17} />{n.label}</button>; });
  return (
    <div className="shell">
      <aside className="sidebar" aria-label="Main navigation">
        <div className="brand">
          <div className="brand-mark"><svg width="22" height="22" viewBox="0 0 32 32" aria-hidden><path d="M4 18c3 0 3-8 6-8s3 12 6 12 3-14 6-14 3 10 6 10" fill="none" stroke="#93e0d6" strokeWidth="2.6" strokeLinecap="round" /></svg></div>
          <div><div className="brand-name">BreatheGuard</div><div className="portal-tag">{PORTAL[user.role]}</div></div>
        </div>
        <NavButtons />
        <div className="sidebar-foot stack-s">
          <button className="nav-btn" onClick={() => { if (window.confirm('Reset all demo data to its starting state? This clears accounts, reports and decisions made in this browser.')) resetDemo(); }}><RefreshCcw size={16} />Reset demo data</button>
          <button className="nav-btn" onClick={logout}><LogOut size={16} />Sign out</button>
        </div>
      </aside>
      <div className="main">
        <header className="topbar">
          <div className="row">
            <strong>{user.name}</strong>
            {hospital && <Badge tone={hospital.status === 'approved' ? 'good' : hospital.status === 'pending' ? 'info' : 'warn'}>{STATUS_LABEL[hospital.status]}</Badge>}
            <Badge tone="demo">Demo account</Badge>
          </div>
          <div className="row" style={{ position: 'relative', gap: 6 }}>
            {!judge && <button className="btn teal sm" onClick={() => judgeGo(0)}><Presentation size={15} />Judge Demo</button>}
            <button className="btn ghost" onClick={() => { setBell(!bell); if (!bell && unread) act(markNotificationsRead); }} aria-label={`Notifications, ${unread} unread`}>
              <Bell size={18} />{unread > 0 && <Badge tone="bad">{unread}</Badge>}
            </button>
            {bell && (
              <div className="notif-pop">
                <div className="card-head"><h3>Notifications</h3></div>
                <div className="card-body">{notes.length ? notes.slice(0, 12).map((n) => <div key={n.id} className="list-item small">{n.text}<div className="tiny muted">{fmtDateTime(n.at)}</div></div>) : <p className="small muted">No notifications.</p>}</div>
              </div>
            )}
          </div>
        </header>
        <nav className="mobile-nav" aria-label="Sections" ref={mobileNav}><NavButtons /></nav>
        <main className="content">
          {judge && <div className="judge-wrap"><JudgeBar /></div>}
          {hospital && hospital.status !== 'approved' && cur.id !== 'status' && (
            <div className="notice warn small" style={{ marginBottom: 16 }}>
              <strong>{STATUS_LABEL[hospital.status]}.</strong> {hospital.status === 'suspended' ? 'Your hospital and its doctors are hidden from patients until the authority reinstates approval.' : hospital.status === 'rejected' ? 'This application was rejected, so nothing here is visible to patients.' : 'Your hospital is not visible to patients and cannot submit doctors until the healthcare authority approves it.'} <button className="btn ghost sm" onClick={() => go('status')}>View status</button>
            </div>
          )}
          <ErrorBoundary resetKey={route.raw} onHome={() => go(nav[0].id)} onReset={resetDemo}>
            <El go={go} query={cur.id === route.page ? route.query : {}} routeKey={route.raw} />
          </ErrorBoundary>
        </main>
        {user.role === 'patient' && <FloatingAssistant mode="demo" />}
      </div>
    </div>
  );
}
