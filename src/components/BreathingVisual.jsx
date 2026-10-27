// Calm breathing animation for the login hero: rings and a breath waveform cycle every 5 s
// (about 12 breaths per minute, a typical resting rate). Decorative; hidden from screen readers.
// Motion stops automatically when the user prefers reduced motion (see styles.css).
export default function BreathingVisual() {
  return (
    <div className="breath-visual" aria-hidden="true">
      <svg viewBox="0 0 220 220" width="150" height="150">
        <defs>
          <radialGradient id="bgGlow" cx="50%" cy="50%" r="50%">
            <stop offset="0%" stopColor="#2ec5d3" stopOpacity="0.55" />
            <stop offset="100%" stopColor="#2ec5d3" stopOpacity="0" />
          </radialGradient>
        </defs>
        <circle className="breath-ring r3" cx="110" cy="110" r="100" fill="none" stroke="#2ec5d3" strokeOpacity="0.18" strokeWidth="2" />
        <circle className="breath-ring r2" cx="110" cy="110" r="78" fill="none" stroke="#2ec5d3" strokeOpacity="0.32" strokeWidth="2" />
        <circle className="breath-ring r1" cx="110" cy="110" r="56" fill="url(#bgGlow)" stroke="#7fe6f2" strokeOpacity="0.7" strokeWidth="2" />
        <path className="breath-wave" d="M30 110 C 55 70, 75 70, 95 110 S 135 150, 155 110 S 185 70, 200 110" fill="none" stroke="#e8fbfd" strokeWidth="4" strokeLinecap="round" />
      </svg>
      <div className="breath-caption"><span className="in">Breathe in…</span><span className="out">breathe out</span></div>
    </div>
  );
}
