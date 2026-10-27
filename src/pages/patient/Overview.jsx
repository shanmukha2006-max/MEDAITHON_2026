import { Activity, CalendarDays, Pill, ShieldCheck, Layers } from 'lucide-react';
import { PatchArt } from '../../components/PatchArt.jsx';
import { useStore, fmtDateTime, nameOf } from '../../data/store.jsx';
import { Card, Btn, OutcomeChip, Empty, StatusBadge, PageHead } from '../../components/ui.jsx';

export default function Overview({ go }) {
  const { state, user } = useStore();
  const reports = state.reports.filter((r) => r.patientId === user.id);
  const appts = state.appointments.filter((a) => a.patientId === user.id && ['requested', 'confirmed'].includes(a.status)).sort((a, b) => a.datetime.localeCompare(b.datetime));
  const meds = state.prescriptions.filter((p) => p.patientId === user.id).flatMap((p) => p.items);
  const shared = state.consents.filter((c) => c.patientId === user.id && c.active);
  const toReview = state.appointments.filter((a) => a.patientId === user.id && a.status === 'completed' && !state.reviews.some((r) => r.appointmentId === a.id));
  return (
    <div className="stack-l">
      <PageHead title={`Hello, ${user.name.split(' ')[0]}`} text="Your simulated monitoring, care connections and medicines in one place." />
      <Card title="Your BreatheGuard patch (simulated)" sub="Two proposed designs. Try either in the simulator." actions={<Btn size="sm" icon={Layers} onClick={() => go('patches')}>Compare patches</Btn>}>
        <div className="row-between">
          <div className="row" style={{ gap: 0 }}><PatchArt variant="care" width={170} /><PatchArt variant="quick" width={150} /></div>
          <div className="row">
            <Btn variant="primary" onClick={() => go('monitor', { patch: 'care' })}>Explore Care Simulation</Btn>
            <Btn onClick={() => go('monitor', { patch: 'quick' })}>Explore Quick Simulation</Btn>
          </div>
        </div>
        <p className="tiny muted" style={{ marginTop: 8 }}>A normal simulated result says nothing about your real health. If you have breathing difficulty or symptoms getting worse, seek medical help now.</p>
      </Card>
      <div className="grid-2">
        <Card title="Latest monitoring" actions={<Btn size="sm" icon={Activity} onClick={() => go('monitor')}>Open monitor</Btn>}>
          {reports[0] ? (
            <div className="stack-s">
              <OutcomeChip outcome={reports[0].latestOutcome} />
              <p className="small muted">{reports[0].patchName ? `${reports[0].patchName} · ` : ''}{reports[0].scenarioName} · saved {fmtDateTime(reports[0].createdAt)}</p>
            </div>
          ) : <Empty icon={Activity} title="No saved sessions yet" text="Run a simulated scenario in the monitor and save it as a report." action={<Btn variant="primary" onClick={() => go('monitor')}>Start monitoring</Btn>} />}
        </Card>
        <Card title="Upcoming appointments" actions={<Btn size="sm" icon={CalendarDays} onClick={() => go('appointments')}>All appointments</Btn>}>
          {appts.length ? appts.slice(0, 3).map((a) => (
            <div key={a.id} className="list-item row-between"><div><strong>{nameOf(state, a.doctorId)}</strong><div className="small muted">{fmtDateTime(a.datetime)} · {nameOf(state, a.hospitalId)}</div></div><StatusBadge status={a.status} /></div>
          )) : <Empty icon={CalendarDays} title="Nothing booked" text="Find a verified demo doctor to request an appointment." action={<Btn onClick={() => go('directory')}>Find care</Btn>} />}
          {toReview.length > 0 && <div className="notice small" style={{ marginTop: 10 }}>{toReview.length} completed appointment{toReview.length > 1 ? 's' : ''} can be reviewed. <button className="btn ghost sm" onClick={() => go('appointments')}>Review now</button></div>}
        </Card>
        <Card title="Medicines" actions={<Btn size="sm" icon={Pill} onClick={() => go('medicines')}>Reminders</Btn>}>
          {meds.length ? <ul className="small" style={{ margin: 0, paddingLeft: 18 }}>{meds.map((m) => <li key={m.id}>{m.name} <span className="muted">· {m.asNeeded ? 'as needed' : Object.entries(m.slots).filter(([, v]) => v).map(([k]) => k).join(', ')}</span></li>)}</ul> : <p className="muted small">No medicines recorded.</p>}
        </Card>
        <Card title="Sharing" actions={<Btn size="sm" icon={ShieldCheck} onClick={() => go('consent')}>Manage consent</Btn>}>
          {shared.length ? shared.map((c) => <p key={c.id} className="small"><strong>{nameOf(state, c.hospitalId)}</strong> can see your {c.scopes.join(' and ')}.</p>) : <p className="small muted">You are not sharing anything with any hospital.</p>}
        </Card>
      </div>
    </div>
  );
}
