import { useState } from 'react';
import { FileText } from 'lucide-react';
import { useStore, fmtDateTime, nameOf } from '../../data/store.jsx';
import { hasConsent } from '../../data/actions.js';
import { Card, Btn, OutcomeChip, Empty, Modal, PageHead, Badge } from '../../components/ui.jsx';
import ReportView from '../../components/ReportView.jsx';

export default function Reports({ go }) {
  const { state, user } = useStore();
  const [open, setOpen] = useState(null);
  const mine = state.reports.filter((r) => r.patientId === user.id);
  const sharedWith = state.hospitals.filter((h) => hasConsent(state, user.id, h.id, 'reports'));
  const followUps = state.appointments.filter((a) => a.patientId === user.id && ['requested', 'confirmed'].includes(a.status));
  return (
    <div className="stack-l">
      <PageHead title="Reports" text="Saved monitoring sessions. All are simulated." actions={<Btn variant="primary" onClick={() => go('monitor')}>New session</Btn>} />
      <div className="notice small">
        {sharedWith.length ? <>Visible to: <strong>{sharedWith.map((h) => h.name).join(', ')}</strong>. </> : <>Not shared with any hospital. </>}
        <button className="btn ghost sm" onClick={() => go('consent')}>Change sharing</button>
      </div>
      {mine.length ? (
        <Card bodyClass="table-wrap">
          <table className="table">
            <thead><tr><th>Saved</th><th>Patch</th><th>Scenario</th><th>Last result</th><th>Windows</th><th /></tr></thead>
            <tbody>{mine.map((r) => (
              <tr key={r.id}>
                <td>{fmtDateTime(r.createdAt)}</td><td>{(r.patchName || 'BreatheGuard Care').replace('BreatheGuard ', '')}</td><td>{r.scenarioName} <Badge tone="demo">seed {r.seed}</Badge></td>
                <td>{r.latestOutcome && <OutcomeChip outcome={r.latestOutcome} />}</td>
                <td className="small">{r.counts.within || 0} within · {r.counts.concerning || 0} concerning · {r.counts.insufficient || 0} insufficient</td>
                <td><Btn size="sm" onClick={() => setOpen(r)}>Open</Btn></td>
              </tr>
            ))}</tbody>
          </table>
        </Card>
      ) : <Empty icon={FileText} title="No reports yet" text="Run a scenario in the monitor, then choose Save report." action={<Btn onClick={() => go('monitor')}>Open monitor</Btn>} />}
      <Card title="Follow-up status">
        {followUps.length ? followUps.map((a) => <p key={a.id} className="small list-item">{nameOf(state, a.doctorId)} · {fmtDateTime(a.datetime)} · <strong>{a.status}</strong></p>) : <p className="small muted">No follow-ups scheduled.</p>}
      </Card>
      <Modal open={!!open} onClose={() => setOpen(null)} title="Monitoring report">{open && <ReportView report={open} patientName={user.name} />}</Modal>
    </div>
  );
}
