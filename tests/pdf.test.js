import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { spawnSync } from 'node:child_process';
import { buildReportPdf, buildReportCsv, reportFileName } from '../src/backend/pdf.js';

const payload = {
  label: 'SYNTHETIC DATA — NOT FOR CLINICAL USE', record_id: 'BG-1A2B3C4D', observation_seconds: 120, missing_seconds: 40, generated_at: '2026-10-26T10:05:00Z',
  session: { id: 'aaaaaaaa-1111-2222-3333-444444444444', patch: 'quick', channels: ['chest', 'motion'], scenario_id: 'multi_failure', seed: 1, started_at: '2026-10-26T10:00:00Z', stopped_at: '2026-10-26T10:04:00Z' },
  analysis: [
    { window_end: 30, outcome: 'within', rate: 14.2, activity: 'rest', quality: 0.95, reason: 'Reliable measurements are within the expected range.', channel_quality: { chest: { usable: true, quality: 0.95 }, motion: { available: true } } },
    { window_end: 40, outcome: 'insufficient', rate: null, activity: 'rest', quality: 0, reason: 'No breathing sensor gave a trustworthy reading — chest flat.', channel_quality: { chest: { usable: false, quality: 0 }, motion: { available: false } } },
  ],
  alerts: [{ created_at: '2026-10-26T10:00:40Z', window_end: 40, category: 'insufficient', explanation: 'Insufficient reliable data. No breathing sensor…', acknowledged_at: '2026-10-26T10:01:00Z' }],
};

test('PDF is a real PDF containing the session’s data and the disclaimer', () => {
  const bytes = Buffer.from(buildReportPdf(payload, { reportId: 'rep-123', generatedAt: new Date('2026-10-26T10:05:00Z') }).output('arraybuffer'));
  assert.equal(bytes.subarray(0, 5).toString(), '%PDF-');
  const f = '/tmp/bg_test_report.pdf'; fs.writeFileSync(f, bytes);
  const r = spawnSync('pdftotext', ['-layout', f, '-']);
  if (r.error) return; // pdftotext not installed: structure check above still ran
  const text = r.stdout.toString();
  for (const must of ['SYNTHETIC DATA - NOT FOR CLINICAL USE', 'Report ID: rep-123', 'BG-1A2B3C4D', 'BreatheGuard Quick', 'chest, motion', 'not fitted on BreatheGuard Quick', 'unusable in 1 of 2 windows', 'Movement data unavailable in 1 window', '40 second(s)', 'Acknowledged', 'Insufficient reliable data', '14.2']) {
    assert.ok(text.includes(must), `PDF should contain "${must}"`);
  }
});

test('CSV export has the disclaimer, identifiers and one row per window', () => {
  const csv = buildReportCsv(payload, { reportId: 'rep-123' });
  assert.match(csv, /^# SYNTHETIC DATA/);
  assert.equal(csv.trim().split('\n').filter((l) => !l.startsWith('#')).length, 3);
  assert.match(csv, /"No breathing sensor gave a trustworthy reading — chest flat."|No breathing sensor/);
});

test('file names are meaningful and safe', () => {
  assert.equal(reportFileName(payload, 'pdf'), 'breatheguard_BG-1A2B3C4D_quick_multi_failure_20261026-1000.pdf');
});
