import { SYNTHETIC_LABEL } from './config.js';
const OUT = { within: 'Within expected simulated range', concerning: 'Potentially concerning simulated pattern', insufficient: 'Insufficient reliable data' };
const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

// Build a printable report from the persisted payload returned by session_report().
export function buildReportHtml(p, { patientName = 'Synthetic patient' } = {}) {
  const s = p.session;
  const rows = p.analysis.map((a) => `<tr><td>${a.window_end}s</td><td>${esc(OUT[a.outcome])}</td><td>${a.rate ?? '—'}</td><td>${esc(a.activity)}</td><td>${Math.round((a.quality ?? 0) * 100)}%</td><td>${esc(a.reason)}</td></tr>`).join('');
  const alerts = p.alerts.map((a) => `<li>${new Date(a.created_at).toLocaleString()} · ${esc(OUT[a.category])} at ${a.window_end}s · ${a.acknowledged_at ? 'acknowledged' : 'not acknowledged'}<br><small>${esc(a.explanation)}</small></li>`).join('') || '<li>No alerts.</li>';
  return `<!doctype html><html><head><meta charset="utf-8"><title>BreatheGuard session report</title>
<style>body{font-family:system-ui,sans-serif;margin:32px;color:#14243d}table{border-collapse:collapse;width:100%;font-size:12px}td,th{border:1px solid #ccd;padding:4px 6px;text-align:left}.warn{border:3px solid #7a5a00;padding:12px;margin:12px 0;background:#fbf1cf;font-weight:700}</style></head><body>
<div class="warn">${SYNTHETIC_LABEL}. Generated from simulated signals for software demonstration. Not a medical device; not for diagnosis or treatment decisions.</div>
<h1>BreatheGuard monitoring session report</h1>
<p>Patient: ${esc(patientName)} (synthetic record)<br>Patch: BreatheGuard ${s.patch === 'care' ? 'Care' : 'Quick'} · Channels: ${esc(s.channels.join(', '))}<br>
Scenario: ${esc(s.scenario_id)} (seed ${s.seed}) · Started ${new Date(s.started_at).toLocaleString()} · ${s.stopped_at ? `Stopped ${new Date(s.stopped_at).toLocaleString()}` : 'Still active'}<br>
Observation seconds stored: ${p.observation_seconds} · Report generated ${new Date(p.generated_at).toLocaleString()}</p>
<h2>Alerts (software demonstration, not clinical warnings)</h2><ul>${alerts}</ul>
<h2>Analysis by window</h2><table><thead><tr><th>Window end</th><th>Result</th><th>Rate</th><th>Activity</th><th>Quality</th><th>Explanation</th></tr></thead><tbody>${rows}</tbody></table>
<p><small>${SYNTHETIC_LABEL}</small></p></body></html>`;
}

export function downloadReport(p, opts) {
  const html = buildReportHtml(p, opts);
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([html], { type: 'text/html' }));
  a.download = `breatheguard-report-${p.session.id.slice(0, 8)}.html`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 2000);
}
