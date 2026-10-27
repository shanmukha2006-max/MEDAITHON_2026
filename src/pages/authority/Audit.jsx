import { useState } from 'react';
import { useStore, fmtDateTime, nameOf } from '../../data/store.jsx';
import { STATUS_LABEL } from '../../data/actions.js';
import { Card, PageHead, Badge } from '../../components/ui.jsx';

export default function Audit() {
  const { state } = useStore();
  const [type, setType] = useState('');
  const [q, setQ] = useState('');
  const rows = state.audit.filter((a) => (!type || a.targetType === type) && (!q || `${nameOf(state, a.targetId)} ${a.reason} ${a.action}`.toLowerCase().includes(q.toLowerCase())));
  return (
    <div className="stack-l">
      <PageHead title="Audit trail" text="Every approval decision, resubmission, complaint resolution and consent change, newest first." actions={<Badge tone="demo">Stored in browser; not tamper-proof</Badge>} />
      <div className="row">
        <select className="select" style={{ width: 200 }} value={type} onChange={(e) => setType(e.target.value)} aria-label="Filter by type"><option value="">All types</option><option value="hospital">Hospitals</option><option value="doctor">Doctors</option><option value="review">Reviews</option></select>
        <input className="input" style={{ maxWidth: 320 }} placeholder="Search" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Search audit" />
      </div>
      <Card bodyClass="table-wrap">
        <table className="table">
          <thead><tr><th>When</th><th>Actor</th><th>Action</th><th>Target</th><th>Change</th><th>Reason</th></tr></thead>
          <tbody>{rows.map((a) => (
            <tr key={a.id}>
              <td className="small">{fmtDateTime(a.at)}</td><td className="small">{nameOf(state, a.actorId)}<div className="tiny muted">{a.actorRole}</div></td>
              <td className="small">{a.action}</td><td className="small">{nameOf(state, a.targetId)}</td>
              <td className="small">{a.from ? `${STATUS_LABEL[a.from] || a.from} → ` : ''}{STATUS_LABEL[a.to] || a.to}</td><td className="small muted">{a.reason}</td>
            </tr>
          ))}</tbody>
        </table>
      </Card>
    </div>
  );
}
