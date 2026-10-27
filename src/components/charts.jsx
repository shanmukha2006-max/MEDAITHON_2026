import { ResponsiveContainer, LineChart, Line, XAxis, YAxis, Tooltip, ReferenceArea, ReferenceLine, ComposedChart, Area, CartesianGrid, Legend } from 'recharts';

export const ACT_COLORS = { unknown: '#cfd6de', rest: 'transparent', walking: '#9ec5e8', fidget: '#d7b8e6', cough: '#f2a7a0', impact: '#f2a7a0', posture: '#f4cf86' };
export const ACT_LABEL = { unknown: 'Unknown (no movement data)', rest: 'Rest', walking: 'Walking', fidget: 'Unstructured movement', cough: 'Cough', impact: 'Impact', posture: 'Posture change' };
export const OUTCOME_COLOR = { within: '#1f6e4c', concerning: '#b3261e', insufficient: '#b58a00' };

// merge per-second labels into shaded runs
export function labelRuns(labels, t0) {
  const runs = [];
  labels.forEach((l, i) => {
    if (l === 'rest') return;
    const last = runs[runs.length - 1];
    if (last && last.label === l && last.x2 === t0 + i) last.x2 = t0 + i + 1;
    else runs.push({ label: l, x1: t0 + i, x2: t0 + i + 1 });
  });
  return runs;
}

export const EVENT_COLORS = { movement: '#3b82c4', cough: '#d9534f', posture: '#c98a00', failure: '#8b1e1e', restore: '#1f6e4c', note: '#6b4fa0' };

export function SignalChart({ data, dataKey, color, label, unit, runs = [], height = 110, missing, markers = [] }) {
  return (
    <div>
      <div className="row-between tiny" style={{ marginBottom: 2 }}>
        <span style={{ fontWeight: 650 }}>{label}</span><span className="muted">{unit}{missing ? ' · no signal' : ''}</span>
      </div>
      <ResponsiveContainer width="100%" height={height}>
        <LineChart data={data} margin={{ top: 4, right: 8, bottom: 0, left: -18 }}>
          {runs.map((r, i) => <ReferenceArea key={i} x1={r.x1} x2={r.x2} fill={ACT_COLORS[r.label]} fillOpacity={0.45} ifOverflow="hidden" />)}
          {markers.map((m, i) => <ReferenceLine key={`m${i}`} x={m.t} stroke={EVENT_COLORS[m.kind] || '#555'} strokeDasharray="3 3" ifOverflow="hidden" />)}
          <XAxis dataKey="t" type="number" domain={['dataMin', 'dataMax']} tick={{ fontSize: 10 }} tickFormatter={(v) => `${Math.round(v)}s`} />
          <YAxis tick={{ fontSize: 10 }} domain={['auto', 'auto']} width={44} tickFormatter={(v) => v.toFixed(1)} />
          <Line type="monotone" dataKey={dataKey} stroke={color} dot={false} strokeWidth={1.6} isAnimationActive={false} connectNulls={false} />
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}

export function TrendChart({ points, showTruth, showNaive, height = 240 }) {
  const Dot = (p) => {
    const { cx, cy, payload } = p;
    if (cx == null || cy == null || payload.rate == null) return null;
    return <circle cx={cx} cy={cy} r={4} fill={OUTCOME_COLOR[payload.outcome]} stroke="#fff" strokeWidth={1.5} />;
  };
  return (
    <ResponsiveContainer width="100%" height={height}>
      <ComposedChart data={points} margin={{ top: 8, right: 12, bottom: 0, left: -10 }}>
        <CartesianGrid stroke="#e9eef2" vertical={false} />
        <XAxis dataKey="t" type="number" domain={['dataMin', 'dataMax']} tick={{ fontSize: 11 }} tickFormatter={(v) => `${v}s`} />
        <YAxis tick={{ fontSize: 11 }} domain={[0, (max) => Math.max(40, Math.ceil(max / 5) * 5)]} allowDataOverflow />
        <Tooltip formatter={(v, n) => (Array.isArray(v) ? `${v[0].toFixed(0)}–${v[1].toFixed(0)}` : v == null ? '—' : Number(v).toFixed(1))} labelFormatter={(v) => `Window ending ${v}s`} />
        <Legend wrapperStyle={{ fontSize: 12 }} />
        <Area dataKey="band" name="Expected range" fill="#cfe7e2" stroke="none" fillOpacity={0.7} isAnimationActive={false} />
        {showNaive && <Line dataKey="naive" name="Chest-only (naive)" stroke="#9aa6b5" strokeDasharray="4 3" dot={false} isAnimationActive={false} connectNulls />}
        {showTruth && <Line dataKey="truth" name="True simulated rate" stroke="#6b4fa0" strokeDasharray="2 3" dot={false} isAnimationActive={false} />}
        <Line dataKey="rate" name="BreatheGuard estimate" stroke="#14305a" strokeWidth={2} dot={<Dot />} isAnimationActive={false} connectNulls={false} />
      </ComposedChart>
    </ResponsiveContainer>
  );
}

export const trendPoints = (results, truthRate) => results.map((r) => ({
  t: r.t1,
  rate: r.rate == null ? null : +r.rate.toFixed(1),
  naive: r.naive.rate == null ? null : +Math.min(60, r.naive.rate).toFixed(1),
  band: [r.range.lo, r.range.hi],
  outcome: r.outcome,
  truth: truthRate ? +(truthRate.slice(Math.max(0, r.t1 - 30), r.t1).reduce((a, b) => a + b, 0) / Math.max(1, Math.min(30, r.t1))).toFixed(1) : null,
}));
