// Simple, professional illustrations of the PROPOSED patch designs.
// They show concepts, not engineering drawings of a built device.
const NAVY = '#0b1f3a', TEAL = '#0b7f86', CYAN = '#22c3d6', SKIN = '#f3d9c6', SKIN_LINE = '#d9b49b', ADH = '#dff2f4';

// Chest-motion strain sensor: a serpentine trace that stretches with the chest
const Strain = ({ x, y, w, color = TEAL }) => {
  const seg = w / 8;
  let d = `M${x} ${y}`;
  for (let i = 0; i < 8; i++) d += ` q${seg / 2} ${i % 2 ? 7 : -7} ${seg} 0`;
  return <path d={d} fill="none" stroke={color} strokeWidth="2.4" strokeLinecap="round" />;
};
const Acoustic = ({ cx, cy, dashed }) => (
  <g opacity={dashed ? 0.55 : 1}>
    <circle cx={cx} cy={cy} r="11" fill={dashed ? 'none' : '#fff'} stroke={CYAN} strokeWidth="2" strokeDasharray={dashed ? '3 3' : undefined} />
    {!dashed && <circle cx={cx} cy={cy} r="4.5" fill={CYAN} />}
    {!dashed && <path d={`M${cx + 15} ${cy - 8} a10 10 0 0 1 0 16 M${cx + 20} ${cy - 12} a15 15 0 0 1 0 24`} fill="none" stroke={CYAN} strokeWidth="1.6" strokeLinecap="round" />}
  </g>
);
const Imu = ({ x, y }) => (
  <g>
    <rect x={x} y={y} width="16" height="16" rx="3" fill={NAVY} />
    <path d={`M${x + 4} ${y + 12} l4 -8 l4 8`} fill="none" stroke={CYAN} strokeWidth="1.5" strokeLinejoin="round" />
  </g>
);

export function PatchArt({ variant = 'care', width = 260 }) {
  if (variant === 'care') {
    return (
      <svg viewBox="0 0 260 150" width={width} style={{ maxWidth: "100%", height: "auto" }} role="img" aria-label="Illustration of the proposed BreatheGuard Care patch with three sensing inputs and a central reusable module">
        <rect x="14" y="20" width="232" height="112" rx="56" fill={ADH} stroke="#9fd3d8" strokeWidth="2" />
        <rect x="26" y="31" width="208" height="90" rx="45" fill="#fff" stroke="#c4e4e7" />
        <Strain x={40} y={76} w={62} />
        <Strain x={158} y={76} w={62} />
        <rect x="102" y="52" width="56" height="48" rx="12" fill={NAVY} />
        <rect x="110" y="60" width="40" height="8" rx="3" fill="#1d4a7a" />
        <circle cx="130" cy="84" r="6" fill={CYAN} />
        <Acoustic cx={130} cy={110} />
        <Imu x={176} y={42} />
        <text x="130" y="15" textAnchor="middle" fontSize="10" fill="#4a5a72" fontFamily="inherit">Proposed design · not to scale</text>
      </svg>
    );
  }
  return (
    <svg viewBox="0 0 260 150" width={width} style={{ maxWidth: "100%", height: "auto" }} role="img" aria-label="Illustration of the proposed BreatheGuard Quick patch: thinner, with chest-motion and movement sensing; acoustic optional">
      <rect x="40" y="38" width="180" height="76" rx="38" fill={ADH} stroke="#9fd3d8" strokeWidth="1.5" />
      <rect x="50" y="46" width="160" height="60" rx="30" fill="#fff" stroke="#d6ecee" />
      <Strain x={64} y={76} w={88} />
      <Imu x={166} y={60} />
      <Acoustic cx={174} cy={92} dashed />
      <text x="130" y="15" textAnchor="middle" fontSize="10" fill="#4a5a72" fontFamily="inherit">Proposed design · not to scale</text>
      <text x="130" y="134" textAnchor="middle" fontSize="9.5" fill="#6b7a90" fontFamily="inherit">Dashed circle: optional acoustic sensor</text>
    </svg>
  );
}

// Torso with the patch on the chest and labelled sensor locations
export function PlacementDiagram({ variant = 'care' }) {
  const care = variant === 'care';
  const label = (x, y, tx, ty, title, sub, anchor = 'start') => (
    <g>
      <path d={`M${x} ${y} L${tx + (anchor === 'start' ? -6 : 6)} ${ty - 4}`} stroke="#6b7a90" strokeWidth="1" fill="none" />
      <circle cx={x} cy={y} r="3" fill={NAVY} />
      <text x={tx} y={ty - 4} fontSize="12" fontWeight="650" fill={NAVY} textAnchor={anchor} fontFamily="inherit">{title}</text>
      <text x={tx} y={ty + 11} fontSize="10.5" fill="#4a5a72" textAnchor={anchor} fontFamily="inherit">{sub}</text>
    </g>
  );
  return (
    <svg viewBox="0 0 760 360" width="100%" style={{ maxWidth: 820, display: 'block', margin: '0 auto' }} role="img" aria-label={`Diagram showing the ${care ? 'Care' : 'Quick'} patch adhered to the front of the chest, with labelled sensor locations`}>
      {/* torso */}
      <path d="M250 40 q70 -14 140 0 l6 38 q60 8 92 40 q18 22 22 90 l4 150 h-388 l4 -150 q4 -68 22 -90 q32 -32 92 -40 z" fill={SKIN} stroke={SKIN_LINE} strokeWidth="2" />
      <path d="M296 40 q24 22 48 0" fill="none" stroke={SKIN_LINE} strokeWidth="2" />
      <path d="M320 92 v120" stroke={SKIN_LINE} strokeWidth="1.5" strokeDasharray="4 5" />
      <path d="M232 150 q36 26 76 6 M332 156 q40 20 76 -6" fill="none" stroke={SKIN_LINE} strokeWidth="1.6" />
      {/* patch on lower chest, slightly left of sternum */}
      <g transform={care ? 'translate(258 206)' : 'translate(270 212)'}>
        <rect width={care ? 124 : 100} height={care ? 62 : 46} rx={care ? 31 : 23} fill={ADH} stroke="#7ec6cd" strokeWidth="2" />
        <Strain x={10} y={care ? 31 : 23} w={care ? 36 : 54} />
        {care && <Strain x={78} y={31} w={36} />}
        {care && <rect x="48" y="16" width="28" height="30" rx="7" fill={NAVY} />}
        {care && <circle cx="62" cy="31" r="4" fill={CYAN} />}
        {care ? <Imu x={86} y={5} /> : <Imu x={70} y={6} />}
        {care ? <Acoustic cx={62} cy={58} /> : <Acoustic cx={84} cy={34} dashed />}
      </g>
      {label(care ? 280 : 300, care ? 237 : 235, 236, 120, 'Chest-motion sensor', 'Stretches as the chest expands', 'end')}
      {label(care ? 350 : 348, care ? 215 : 226, 480, 70, 'Movement sensor', 'Walking, coughs, posture', 'start')}
      {care ? label(320, 264, 480, 300, 'Acoustic sensor', 'Breath-sound features at the skin', 'start')
        : label(354, 246, 480, 300, 'Acoustic sensor (optional)', 'Only if its cost is justified', 'start')}
      {care ? label(320, 237, 480, 160, 'Reusable module', 'Electronics + battery (design option)', 'start')
        : label(272, 223, 236, 250, 'Adhesive patch', 'Thin, single-use, low cost', 'end')}
      {care && label(262, 224, 236, 250, 'Adhesive layer', 'Skin contact, replaceable', 'end')}
      <text x="380" y="350" textAnchor="middle" fontSize="11" fill="#6b7a90" fontFamily="inherit">Proposed placement over the diaphragm, on the lower ribcage. Exact position, adhesion and skin safety are to be validated.</text>
    </svg>
  );
}

// Care: exploded view of the proposed layer structure
export function CareLayers() {
  const layer = (y, fill, stroke, title, sub, extra) => (
    <g>
      <path d={`M60 ${y} l120 -26 l170 0 l-120 26 z`} fill={fill} stroke={stroke} strokeWidth="1.5" />
      {extra}
      <text x="370" y={y - 14} fontSize="12" fontWeight="650" fill={NAVY} fontFamily="inherit">{title}</text>
      <text x="370" y={y + 2} fontSize="10.5" fill="#4a5a72" fontFamily="inherit">{sub}</text>
    </g>
  );
  return (
    <svg viewBox="0 0 700 230" width="100%" style={{ maxWidth: 640, display: 'block', margin: '0 auto' }} role="img" aria-label="Exploded view of the proposed Care patch: reusable electronics and battery module on top, sensor layer in the middle, replaceable skin adhesive at the bottom">
      {layer(70, NAVY, NAVY, 'Reusable module', 'Electronics and battery (design option)', <circle cx="205" cy="57" r="5" fill={CYAN} />)}
      {layer(135, '#ffffff', '#9fd3d8', 'Sensor layer', 'Chest-motion, acoustic and movement sensing',
        <><path d="M110 122 q8 -6 16 0 t16 0 t16 0" stroke={TEAL} strokeWidth="2" fill="none" /><circle cx="205" cy="122" r="6" fill="none" stroke={CYAN} strokeWidth="2" /><rect x="250" y="116" width="10" height="10" fill={NAVY} rx="2" /></>)}
      {layer(200, ADH, '#7ec6cd', 'Adhesive layer', 'Skin contact, replaceable')}
      <path d="M200 76 v26 M200 141 v30" stroke="#6b7a90" strokeDasharray="3 4" />
    </svg>
  );
}
