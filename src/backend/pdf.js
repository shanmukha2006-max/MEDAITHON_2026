// Real PDF and CSV reports built from the persisted payload returned by session_report().
// session_report() runs with the caller's permissions, so a report can only be built for a
// session the backend allows this user to read.
import { jsPDF } from 'jspdf';
import { SYNTHETIC_LABEL } from './config.js';

const OUT = { within: 'Within expected simulated range', concerning: 'Potentially concerning simulated pattern', insufficient: 'Insufficient reliable data' };
const fmt = (t) => (t ? new Date(t).toISOString().replace('T', ' ').slice(0, 16) + ' UTC' : '-');
const pct = (x) => (x == null ? '-' : `${Math.round(x * 100)}%`);
// jsPDF's built-in fonts are Latin-1: replace characters it cannot draw
const safe = (s) => String(s ?? '').replace(/[—–]/g, '-').replace(/[‘’]/g, "'").replace(/[“”]/g, '"').replace(/…/g, '...').replace(/[^\x20-\x7E\xA0-\xFF]/g, '');

export function reportFileName(p, ext) {
  const s = p.session, d = new Date(s.started_at);
  const stamp = `${d.getUTCFullYear()}${String(d.getUTCMonth() + 1).padStart(2, '0')}${String(d.getUTCDate()).padStart(2, '0')}-${String(d.getUTCHours()).padStart(2, '0')}${String(d.getUTCMinutes()).padStart(2, '0')}`;
  return `breatheguard_${p.record_id || 'record'}_${s.patch}_${s.scenario_id}_${stamp}.${ext}`.replace(/[^A-Za-z0-9_.-]/g, '-');
}

export function summarizeQuality(p) {
  const out = {};
  for (const ch of p.session.channels.filter((c) => c !== 'motion')) {
    const rows = p.analysis.map((a) => a.channel_quality?.[ch]).filter(Boolean);
    out[ch] = { mean: rows.length ? rows.reduce((s, r) => s + (r.quality || 0), 0) / rows.length : null, unusableWindows: rows.filter((r) => !r.usable).length, total: rows.length };
  }
  const motionMissing = p.analysis.filter((a) => a.channel_quality?.motion && !a.channel_quality.motion.available).length;
  return { channels: out, motionMissing };
}

export function buildReportPdf(p, { reportId, generatedAt = new Date() } = {}) {
  const doc = new jsPDF({ unit: 'pt', format: 'a4' });
  const W = doc.internal.pageSize.getWidth(), H = doc.internal.pageSize.getHeight(), M = 44;
  let y = M;
  const footer = () => { doc.setFontSize(8); doc.setTextColor(120); doc.text(safe(`${SYNTHETIC_LABEL} | Report ${reportId}`), M, H - 22); doc.setTextColor(0); };
  const ensure = (h) => { if (y + h > H - 40) { footer(); doc.addPage(); y = M; } };
  const line = (text, size = 10, bold = false, gap = 4) => {
    doc.setFont('helvetica', bold ? 'bold' : 'normal'); doc.setFontSize(size);
    for (const l of doc.splitTextToSize(safe(text), W - 2 * M)) { ensure(size + gap); doc.text(l, M, y); y += size + gap; }
  };
  // disclaimer box
  doc.setDrawColor(122, 90, 0); doc.setFillColor(251, 241, 207); doc.setLineWidth(2); doc.rect(M, y, W - 2 * M, 44, 'FD');
  doc.setFont('helvetica', 'bold'); doc.setFontSize(12); doc.text(safe(SYNTHETIC_LABEL), M + 10, y + 18);
  doc.setFont('helvetica', 'normal'); doc.setFontSize(9); doc.text('Generated from simulated signals for software demonstration. Not a medical device; not for diagnosis or treatment.', M + 10, y + 34);
  y += 64;
  const s = p.session;
  line('BreatheGuard monitoring session report', 18, true, 8);
  line(`Report ID: ${reportId}`); line(`Record identifier: ${p.record_id || '-'} (synthetic record)`);
  line(`Session ID: ${s.id}`); line(`Started: ${fmt(s.started_at)}   Stopped: ${s.stopped_at ? fmt(s.stopped_at) : 'still active'}`);
  line(`Patch: BreatheGuard ${s.patch === 'care' ? 'Care' : 'Quick'}   Channels: ${s.channels.join(', ')}`);
  line(`Scenario: ${s.scenario_id} (seed ${s.seed})   Report generated: ${fmt(generatedAt)}`);
  y += 6;
  const counts = p.analysis.reduce((m, a) => ({ ...m, [a.outcome]: (m[a.outcome] || 0) + 1 }), {});
  line('Summary', 13, true, 6);
  line(`${p.analysis.length} analysis windows: ${counts.within || 0} within expected simulated range, ${counts.concerning || 0} potentially concerning, ${counts.insufficient || 0} insufficient reliable data.`);
  line(`Latest result: ${p.analysis.length ? OUT[p.analysis.at(-1).outcome] : 'none yet'}.`);
  const q = summarizeQuality(p);
  line('Signal quality (shown separately from the results)', 13, true, 6);
  for (const [ch, v] of Object.entries(q.channels)) line(`${ch}: average quality ${pct(v.mean)}; unusable in ${v.unusableWindows} of ${v.total} windows.`);
  if (!s.channels.includes('acoustic')) line('acoustic: not fitted on BreatheGuard Quick.');
  line('Failures and missing data', 13, true, 6);
  const notes = [];
  for (const [ch, v] of Object.entries(q.channels)) if (v.unusableWindows) notes.push(`${ch} sensor unusable (failed, flat or missing) in ${v.unusableWindows} window(s).`);
  if (q.motionMissing) notes.push(`Movement data unavailable in ${q.motionMissing} window(s): movement artefacts could not be ruled out there.`);
  if (p.missing_seconds) notes.push(`${p.missing_seconds} second(s) of stored signal contain missing samples.`);
  notes.push(`${p.observation_seconds} seconds of signal stored.`);
  notes.forEach((n) => line(`- ${n}`));
  line('Alerts (software demonstration, not clinical warnings)', 13, true, 6);
  if (!p.alerts.length) line('No alerts.');
  for (const a of p.alerts) line(`- ${fmt(a.created_at)} at ${a.window_end}s: ${OUT[a.category]}. ${a.acknowledged_at ? `Acknowledged ${fmt(a.acknowledged_at)}.` : 'Not acknowledged.'} ${a.explanation}`);
  line('Analysis by window', 13, true, 6);
  for (const a of p.analysis) line(`${a.window_end}s | ${OUT[a.outcome]} | rate ${a.rate ?? '-'}/min | ${a.activity || '-'} | quality ${pct(a.quality)} | ${a.reason}`, 9, false, 3);
  footer();
  const pages = doc.getNumberOfPages();
  for (let i = 1; i < pages; i++) { doc.setPage(i); footer(); }
  return doc;
}

const csvCell = (v) => { const s = String(v ?? ''); return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };
export function buildReportCsv(p, { reportId }) {
  const head = [`# ${SYNTHETIC_LABEL}`, `# report_id,${reportId}`, `# record_id,${p.record_id}`, `# session_id,${p.session.id}`, `# patch,${p.session.patch}`, `# channels,${p.session.channels.join(' ')}`];
  const rows = [['window_end_s', 'outcome', 'rate_per_min', 'activity', 'quality', 'chest_quality', 'acoustic_quality', 'reason']];
  for (const a of p.analysis) rows.push([a.window_end, a.outcome, a.rate, a.activity, a.quality, a.channel_quality?.chest?.quality, a.channel_quality?.acoustic?.quality, a.reason]);
  return head.join('\n') + '\n' + rows.map((r) => r.map(csvCell).join(',')).join('\n') + '\n';
}

// Browser helper: trigger a real file download from bytes or text.
export function saveFile(data, fileName, type) {
  const blob = data instanceof Blob ? data : new Blob([data], { type });
  if (!blob.size) throw new Error('The report file is empty, so it was not downloaded.');
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob); a.download = fileName; document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 2000);
  return blob.size;
}
