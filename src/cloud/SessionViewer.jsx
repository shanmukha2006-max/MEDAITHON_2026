import { useEffect, useMemo, useRef, useState } from 'react';
import { Download, Wifi, WifiOff, RefreshCw, BellRing, Check } from 'lucide-react';
import * as api from '../backend/api.js';
import { OrderedStream, subscribeSession } from '../backend/realtime.js';
import { buildReportPdf, buildReportCsv, reportFileName, saveFile } from '../backend/pdf.js';
import { useCloud } from './CloudContext.jsx';
import { Card, Btn, Badge, OutcomeChip } from '../components/ui.jsx';
import { SignalChart } from '../components/charts.jsx';

const POLL_MS = 3000;

// Live view of one persisted session. New data arrives by Supabase Realtime; if the real-time
// channel is unavailable it falls back to reading the shared database every 3 s. Either way the
// data comes from the backend, filtered by row-level security for the signed-in user.
export default function SessionViewer({ session: initial, canAcknowledge }) {
  const { sb, profile } = useCloud();
  const [session, setSession] = useState(initial);
  const [obs, setObs] = useState([]);
  const [analysis, setAnalysis] = useState([]);
  const [alerts, setAlerts] = useState([]);
  const [rt, setRt] = useState('connecting'); // connecting | live | polling | error
  const [error, setError] = useState('');
  const streamRef = useRef(null);

  const mergeAnalysis = (rows) => setAnalysis((cur) => { const m = new Map(cur.map((a) => [a.window_end, a])); rows.forEach((a) => m.set(a.window_end, a)); return [...m.values()].sort((a, b) => a.window_end - b.window_end); });
  const mergeAlerts = (rows) => setAlerts((cur) => { const m = new Map(cur.map((a) => [a.id, a])); rows.forEach((a) => m.set(a.id, a)); return [...m.values()].sort((a, b) => a.created_at.localeCompare(b.created_at)); });

  const backfill = async () => {
    try {
      const after = streamRef.current?.lastSeq ?? -1;
      const [o, a, al] = await Promise.all([api.fetchObservations(sb, initial.id, after), api.fetchAnalysis(sb, initial.id), api.fetchAlerts(sb, initial.id)]);
      streamRef.current.push(o); mergeAnalysis(a); mergeAlerts(al); setError('');
    } catch (e) { setError(e.message); }
  };

  useEffect(() => {
    streamRef.current = new OrderedStream((items) => setObs((cur) => cur.concat(items).slice(-600)));
    setObs([]); setAnalysis([]); setAlerts([]); setSession(initial);
    backfill();
    let poll = null;
    const startPolling = () => { if (!poll) poll = setInterval(backfill, POLL_MS); };
    const stopPolling = () => { if (poll) { clearInterval(poll); poll = null; } };
    const unsub = subscribeSession(sb, initial.id, {
      onObservation: (row) => streamRef.current.push(row),
      onAnalysis: (row) => mergeAnalysis([row]),
      onAlert: (row) => mergeAlerts([row]),
      onSession: (row) => setSession((s) => ({ ...s, ...row })),
      onStatus: (status) => {
        if (status === 'SUBSCRIBED') { setRt('live'); stopPolling(); backfill(); } // backfill anything missed while disconnected
        else if (['CHANNEL_ERROR', 'TIMED_OUT', 'CLOSED'].includes(status)) { setRt('polling'); startPolling(); }
      },
    });
    const fallback = setTimeout(() => setRt((r) => { if (r === 'connecting') { startPolling(); return 'polling'; } return r; }), 6000);
    return () => { unsub(); stopPolling(); clearTimeout(fallback); };
  }, [initial.id]); // eslint-disable-line react-hooks/exhaustive-deps

  const view = useMemo(() => {
    const pts = [];
    for (const o of obs.slice(-30)) for (let i = 0; i < 10; i += 2) pts.push({ t: +o.t_start + i / 10, chest: o.chest?.[i] ?? null, acoustic: o.acoustic?.[i] ?? null, accel: o.accel?.[i] ?? null });
    return pts;
  }, [obs]);
  const latest = analysis.at(-1);
  const ack = async (id) => { try { mergeAlerts([await api.acknowledgeAlert(sb, id)]); } catch (e) { setError(e.message); } };
  const [dl, setDl] = useState(null);
  // Download: fetch the persisted data (permission checked by the backend), build the file, save it, then log it.
  const report = async (format) => {
    setDl({ busy: true }); setError('');
    try {
      const { data: p, error: e } = await sb.rpc('session_report', { p_session: initial.id });
      if (e) throw api.friendly(e, 'Report not available');
      const id = (crypto.randomUUID && crypto.randomUUID()) || `${Date.now()}`;
      const fileName = reportFileName(p, format);
      const size = format === 'pdf' ? saveFile(buildReportPdf(p, { reportId: id }).output('blob'), fileName, 'application/pdf') : saveFile(buildReportCsv(p, { reportId: id }), fileName, 'text/csv');
      try { await api.logReport(sb, { id, sessionId: initial.id, userId: profile.id, format, fileName, size }); } catch { /* the file was produced; logging is recorded best-effort */ }
      setDl({ ok: `Downloaded ${fileName} (${Math.round(size / 1024)} KB).` });
    } catch (e) { setDl(null); setError(`Report not generated: ${e.message}`); }
  };
  const RT = { connecting: ['neutral', RefreshCw, 'Connecting…'], live: ['good', Wifi, 'Live (real-time)'], polling: ['warn', WifiOff, 'Live via polling every 3 s (real-time unavailable)'] }[rt];
  const I = RT[1];

  return (
    <div className="stack">
      <div className="sim-notice" role="note">SYNTHETIC DATA — NOT FOR CLINICAL USE <span className="sub">Alerts are a software demonstration, not clinical warnings.</span></div>
      <div className="row-between">
        <div className="row small">
          <strong>{session.profiles?.full_name || 'Synthetic patient'}</strong>
          <Badge tone="info">BreatheGuard {session.patch === 'care' ? 'Care' : 'Quick'}</Badge>
          <span className="muted">Channels: {session.channels.join(', ')}</span>
          <Badge tone={session.status === 'active' ? 'good' : 'neutral'}>{session.status === 'active' ? 'Session active' : 'Session stopped'}</Badge>
        </div>
        <div className="row">
          <span className={`badge ${RT[0]}`} data-testid="rt-status"><I size={13} />{RT[2]}</span>
          <Btn size="sm" icon={Download} onClick={() => report('pdf')} disabled={dl?.busy}>Download PDF</Btn>
          <Btn size="sm" variant="ghost" onClick={() => report('csv')} disabled={dl?.busy}>CSV</Btn>
        </div>
      </div>
      {error && <div className="notice bad small" role="alert">{error}</div>}
      {dl?.ok && <div className="notice small" role="status" data-testid="dl-ok">{dl.ok}</div>}
      <div className="grid-2">
        <Card title="Signals (last 30 s, from the shared database)" sub={`${obs.length} seconds received${obs.length ? `, latest at ${obs.at(-1).seq}s` : ''}`}>
          {view.length ? <div className="stack">
            <SignalChart data={view} dataKey="chest" color="#0b1f3a" label="Chest motion" unit="a.u." />
            {session.channels.includes('acoustic') ? <SignalChart data={view} dataKey="acoustic" color="#0b7f86" label="Acoustic" unit="a.u." /> : <p className="tiny muted">Acoustic not fitted on BreatheGuard Quick.</p>}
            <SignalChart data={view} dataKey="accel" color="#7a4d9e" label="Movement" unit="g" height={80} />
          </div> : <p className="small muted">Waiting for data. If the patient has started recording, it appears here without refreshing.</p>}
        </Card>
        <Card title="Latest analysis" sub="Computed by the BreatheGuard engine on synthetic signals.">
          {latest ? <div className="stack-s" data-testid="latest-analysis">
            <OutcomeChip outcome={latest.outcome} />
            <p className="small">{latest.reason}</p>
            <p className="tiny muted">Window ending {latest.window_end}s · quality {Math.round(latest.quality * 100)}% · activity {latest.activity} · rate {latest.rate ?? '—'}</p>
          </div> : <p className="small muted">The first result appears after 30 s of data.</p>}
          <div className="divider" style={{ margin: '12px 0' }} />
          <strong className="small row" style={{ gap: 6 }}><BellRing size={14} />Alerts ({alerts.length})</strong>
          <div className="stack-s" style={{ marginTop: 6 }} data-testid="alerts">
            {alerts.length ? alerts.slice().reverse().map((a) => (
              <div key={a.id} className="list-item small">
                <div className="row-between"><OutcomeChip outcome={a.category} />{a.acknowledged_at ? <Badge tone="neutral"><Check size={12} />Acknowledged</Badge> : canAcknowledge ? <Btn size="sm" onClick={() => ack(a.id)}>Acknowledge</Btn> : <Badge tone="warn">Not acknowledged</Badge>}</div>
                <p className="tiny muted" style={{ marginTop: 4 }}>{new Date(a.created_at).toLocaleTimeString()} · at {a.window_end}s · {a.explanation}</p>
              </div>
            )) : <p className="tiny muted">No alerts. Alerts are created only when the result changes, not for every reading.</p>}
          </div>
        </Card>
      </div>
    </div>
  );
}
