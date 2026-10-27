import { CalendarDays } from 'lucide-react';
import { useStore, fmtDateTime, nameOf } from '../../data/store.jsx';
import { updateAppointment } from '../../data/actions.js';
import { Card, Btn, StatusBadge, PageHead, Empty, Badge } from '../../components/ui.jsx';

export default function HospitalAppointments() {
  const { state, user, act } = useStore();
  const list = state.appointments.filter((a) => a.hospitalId === user.hospitalId).sort((a, b) => b.datetime.localeCompare(a.datetime));
  const set = (id, status, msg) => act(updateAppointment, { appointmentId: id, status }, msg);
  return (
    <div className="stack-l">
      <PageHead title="Appointments" text="Confirm or decline requests, and mark visits completed so patients can review them." actions={<Badge tone="demo">Demo appointments</Badge>} />
      {list.length ? (
        <Card bodyClass="table-wrap">
          <table className="table">
            <thead><tr><th>When</th><th>Patient</th><th>Doctor</th><th>Reason</th><th>Status</th><th>Actions</th></tr></thead>
            <tbody>{list.map((a) => (
              <tr key={a.id}>
                <td className="small">{fmtDateTime(a.datetime)}</td><td>{nameOf(state, a.patientId)}<div className="tiny muted">synthetic patient</div></td><td>{nameOf(state, a.doctorId)}</td>
                <td className="small muted">{a.reason || '—'}</td><td><StatusBadge status={a.status} /></td>
                <td><div className="row" style={{ gap: 6 }}>
                  {a.status === 'requested' && <><Btn size="sm" variant="good" onClick={() => set(a.id, 'confirmed', 'Appointment confirmed.')}>Confirm</Btn><Btn size="sm" variant="danger" onClick={() => set(a.id, 'declined', 'Request declined.')}>Decline</Btn></>}
                  {a.status === 'confirmed' && <><Btn size="sm" onClick={() => set(a.id, 'completed', 'Marked completed. The patient can now review.')}>Mark completed</Btn><Btn size="sm" variant="danger" onClick={() => set(a.id, 'cancelled', 'Appointment cancelled.')}>Cancel</Btn></>}
                </div></td>
              </tr>
            ))}</tbody>
          </table>
        </Card>
      ) : <Empty icon={CalendarDays} title="No appointments" text="Requests from patients appear here once your hospital and doctors are verified." />}
    </div>
  );
}
