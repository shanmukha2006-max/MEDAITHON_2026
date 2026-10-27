import { useState } from 'react';
import { Lock, Users } from 'lucide-react';
import { useStore, fmtDateTime } from '../../data/store.jsx';
import { hasConsent } from '../../data/actions.js';
import { Card, Btn, OutcomeChip, PageHead, Empty, Modal, Badge } from '../../components/ui.jsx';
import ReportView from '../../components/ReportView.jsx';

export default function Patients() {
  const { state, user } = useStore();
  const [open, setOpen] = useState(null);
  const hId = user.hospitalId;
  const ids = [...new Set([
    ...state.appointments.filter((a) => a.hospitalId === hId).map((a) => a.patientId),
    ...state.consents.filter((c) => c.hospitalId === hId && c.active).map((c) => c.patientId),
  ])];
  const patients = ids.map((id) => state.users.find((u) => u.id === id)).filter(Boolean);
  return (
    <div className="stack-l">
      <PageHead title="Patients" text="Patients connected to your hospital through appointments. Reports are visible only when the patient has given your hospital consent." />
      {patients.length ? patients.map((p) => {
        const allowed = hasConsent(state, p.id, hId, 'reports');
        const meds = hasConsent(state, p.id, hId, 'prescriptions');
        const reports = allowed ? state.reports.filter((r) => r.patientId === p.id) : [];
        return (
          <Card key={p.id} title={p.name} sub="Synthetic demo patient. Not a real person." actions={<>{allowed ? <Badge tone="good">Reports shared</Badge> : <Badge tone="neutral"><Lock size={12} />Reports not shared</Badge>}{meds ? <Badge tone="good">Medicines shared</Badge> : <Badge tone="neutral"><Lock size={12} />Medicines not shared</Badge>}</>}>
            {allowed ? (reports.length ? reports.map((r) => (
              <div key={r.id} className="list-item row-between"><div><strong className="small">{r.patchName ? `${r.patchName.replace('BreatheGuard ', '')}: ` : ''}{r.scenarioName}</strong> <Badge tone="demo">simulated</Badge><div className="tiny muted">{fmtDateTime(r.createdAt)}</div></div><div className="row"><OutcomeChip outcome={r.latestOutcome} /><Btn size="sm" onClick={() => setOpen({ r, p })}>Open</Btn></div></div>
            )) : <p className="small muted">Consent given, but the patient has not saved any reports yet.</p>)
              : <p className="small muted">The patient has not shared monitoring reports with your hospital. Ask them during the appointment; only they can grant access.</p>}
            {meds && <div className="small" style={{ marginTop: 10 }}><strong>Medicines (as recorded by patient): </strong>{state.prescriptions.filter((x) => x.patientId === p.id).flatMap((x) => x.items).map((i) => i.name).join(', ') || 'none'}</div>}
          </Card>
        );
      }) : <Empty icon={Users} title="No connected patients" />}
      <Modal open={!!open} onClose={() => setOpen(null)} title="Patient monitoring report">{open && <ReportView report={open.r} patientName={open.p.name} />}</Modal>
    </div>
  );
}
