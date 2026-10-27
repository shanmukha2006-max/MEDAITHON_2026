import { Download, Printer } from 'lucide-react';
import { Btn, OutcomeChip, Badge } from './ui.jsx';
import { TrendChart } from './charts.jsx';
import { fmtDateTime } from '../data/store.jsx';

const toPoints = (r) => r.windows.map((w) => ({ t: w.t1, rate: w.rate, naive: w.naiveRate, outcome: w.outcome, band: null }));

export function downloadJson(report, patientName) {
  const blob = new Blob([JSON.stringify({ disclaimer: 'SIMULATED DATA. Not clinically validated. Not for diagnosis.', patient: patientName, ...report }, null, 2)], { type: 'application/json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `breatheguard-report-${report.id}.json`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}

export function printReport(report, patientName) {
  const rows = report.windows.map((w) => `<tr><td>${w.t1}s</td><td>${w.outcome}</td><td>${w.rate ?? '—'}</td><td>${w.activity}</td><td>${Math.round(w.quality * 100)}%</td><td>${w.reason}</td></tr>`).join('');
  const html = `<!doctype html><html><head><meta charset="utf-8"><title>BreatheGuard simulated report</title>
  <style>body{font-family:system-ui,sans-serif;margin:32px;color:#14243d}table{border-collapse:collapse;width:100%;font-size:12px}td,th{border:1px solid #ccd;padding:4px 6px;text-align:left}.warn{border:2px solid #7a5a00;padding:10px;margin:12px 0;background:#fbf1cf}</style></head>
  <body><h1>BreatheGuard monitoring report</h1><div class="warn"><strong>SIMULATED DATA — NOT CLINICALLY VALIDATED.</strong> Generated from a synthetic scenario for demonstration only. Not for diagnosis or treatment decisions.</div>
  <p>Patient: ${patientName} (synthetic demo record) · Patch: ${report.patchName || 'BreatheGuard Care'} · Created ${new Date(report.createdAt).toLocaleString()}<br>Scenario: ${report.scenarioName} (seed ${report.seed}) · ${report.analysedSec}s analysed · Baseline ${report.baseline.rate}/min</p>
  <p>Windows: within ${report.counts.within || 0} · concerning ${report.counts.concerning || 0} · insufficient data ${report.counts.insufficient || 0}</p>
  <table><thead><tr><th>Window end</th><th>Outcome</th><th>Rate</th><th>Activity</th><th>Quality</th><th>Reason</th></tr></thead><tbody>${rows}</tbody></table></body></html>`;
  const w = window.open(URL.createObjectURL(new Blob([html], { type: 'text/html' })), '_blank');
  if (w) setTimeout(() => w.print(), 600);
}

export default function ReportView({ report, patientName }) {
  return (
    <div className="stack">
      <div className="notice warn small"><strong>Simulated data.</strong> This report comes from a synthetic scenario and has not been clinically validated.</div>
      <dl className="kv">
        <dt>Patient</dt><dd>{patientName} <Badge tone="demo">Synthetic demo record</Badge></dd>
        <dt>Created</dt><dd>{fmtDateTime(report.createdAt)}</dd>
        <dt>Patch</dt><dd>{report.patchName || 'BreatheGuard Care (saved before patch selection existed)'}</dd>
        <dt>Scenario</dt><dd>{report.scenarioName} <Badge tone="demo">seed {report.seed}</Badge></dd>
        <dt>Analysed</dt><dd>{report.analysedSec} s, {report.windows.length} windows</dd>
        <dt>Baseline used</dt><dd>{report.baseline.rate}/min (±{report.baseline.sd})</dd>
        <dt>Last result</dt><dd>{report.latestOutcome ? <OutcomeChip outcome={report.latestOutcome} /> : '—'}</dd>
      </dl>
      <div className="row">
        <OutcomeChip outcome="within" /><span className="small">{report.counts.within || 0}</span>
        <OutcomeChip outcome="concerning" /><span className="small">{report.counts.concerning || 0}</span>
        <OutcomeChip outcome="insufficient" /><span className="small">{report.counts.insufficient || 0}</span>
      </div>
      <TrendChart points={toPoints(report)} showNaive height={200} />
      <div className="table-wrap">
        <table className="table">
          <thead><tr><th>Window end</th><th>Outcome</th><th>Rate</th><th>Activity</th><th>Quality</th><th>Why</th></tr></thead>
          <tbody>{report.windows.map((w) => <tr key={w.t1}><td>{w.t1}s</td><td><OutcomeChip outcome={w.outcome} /></td><td>{w.rate ?? '—'}</td><td>{w.activity}</td><td>{Math.round(w.quality * 100)}%</td><td className="small muted">{w.reason}</td></tr>)}</tbody>
        </table>
      </div>
      <div className="row">
        <Btn icon={Download} onClick={() => downloadJson(report, patientName)}>Download JSON</Btn>
        <Btn icon={Printer} onClick={() => printReport(report, patientName)}>Print or save as PDF</Btn>
      </div>
    </div>
  );
}
