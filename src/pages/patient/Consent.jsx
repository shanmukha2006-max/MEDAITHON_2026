import { ShieldCheck } from 'lucide-react';
import { useStore, fmtDateTime, nameOf } from '../../data/store.jsx';
import { setConsent, visibleHospitals } from '../../data/actions.js';
import { Card, PageHead, Badge, Empty } from '../../components/ui.jsx';

const SCOPES = [{ key: 'reports', label: 'Monitoring reports' }, { key: 'prescriptions', label: 'Medicines list' }];

export default function Consent() {
  const { state, user, act } = useStore();
  const hospitals = visibleHospitals(state);
  const history = state.audit.filter((a) => a.action === 'consent.changed' && a.actorId === user.id).slice(0, 10);
  const toggle = (hId, key) => {
    const c = state.consents.find((x) => x.patientId === user.id && x.hospitalId === hId);
    const cur = c?.active ? c.scopes : [];
    const next = cur.includes(key) ? cur.filter((s) => s !== key) : [...cur, key];
    act(setConsent, { hospitalId: hId, scopes: next }, 'Sharing updated.');
  };
  return (
    <div className="stack-l">
      <PageHead title="Consent and sharing" text="Hospitals see nothing by default. Booking an appointment does not grant access. You can withdraw consent at any time; it takes effect immediately in this demo." />
      {hospitals.length ? (
        <Card bodyClass="table-wrap">
          <table className="table">
            <thead><tr><th>Hospital</th>{SCOPES.map((s) => <th key={s.key}>{s.label}</th>)}</tr></thead>
            <tbody>{hospitals.map((h) => {
              const c = state.consents.find((x) => x.patientId === user.id && x.hospitalId === h.id);
              return (
                <tr key={h.id}>
                  <td><strong>{h.name}</strong><div className="tiny muted">{h.city}</div></td>
                  {SCOPES.map((s) => {
                    const on = !!(c?.active && c.scopes.includes(s.key));
                    return <td key={s.key}><label className="check"><input type="checkbox" checked={on} onChange={() => toggle(h.id, s.key)} />{on ? <Badge tone="good">Shared</Badge> : <span className="muted small">Not shared</span>}</label></td>;
                  })}
                </tr>
              );
            })}</tbody>
          </table>
        </Card>
      ) : <Empty icon={ShieldCheck} title="No approved hospitals" />}
      <Card title="Your consent history">
        {history.length ? history.map((h) => <p key={h.id} className="small list-item">{fmtDateTime(h.at)} · {nameOf(state, h.targetId)}: {h.from} → <strong>{h.to}</strong></p>) : <p className="small muted">No changes made in this demo session yet.</p>}
      </Card>
      <p className="tiny muted">Demo limitation: consent is enforced by this app’s own code in your browser. A real system must enforce it on the server and log every access.</p>
    </div>
  );
}
