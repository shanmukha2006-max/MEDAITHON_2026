// Plain-language explanation of one analysis result, as a short chain of questions.
// Built only from the engine's own output, so it can never claim more than the engine found.
const ACT = { rest: 'resting', walking: 'walking', fidget: 'moving restlessly', unknown: 'unknown (no movement data)' };
const NAME = { chest: 'chest-motion', acoustic: 'acoustic' };

export function explainResult(r, patchName = 'this patch') {
  const ch = r.channels;
  const steps = [];

  // 1. what sensors were available
  const fittedNames = ['chest', 'acoustic'].filter((k) => ch[k].fitted !== false).map((k) => NAME[k]);
  steps.push({
    q: 'Which sensors could see breathing?',
    a: `${patchName} has ${fittedNames.length === 2 ? 'two breathing sensors (chest-motion and acoustic)' : 'one breathing sensor (chest-motion)'}, plus a movement sensor for context.${ch.acoustic.fitted === false ? ' There is no second breathing sensor to cross-check against.' : ''}`,
  });

  // 2. can they be trusted
  const trust = ['chest', 'acoustic'].filter((k) => ch[k].fitted !== false).map((k) => {
    const c = ch[k];
    if (!c.usable) return `the ${NAME[k]} sensor is not working: ${c.flatline ? 'its signal is flat, as if detached' : 'it is sending no data'}`;
    if (c.reliable) return `the ${NAME[k]} sensor looks trustworthy (quality ${Math.round(c.sqi * 100)}%)`;
    return `the ${NAME[k]} sensor is not trusted (quality ${Math.round(c.sqi * 100)}%${c.issues[0] ? `: ${c.issues[0].toLowerCase()}` : ''})`;
  });
  steps.push({ q: 'Can the readings be trusted?', a: cap(trust.join('; ')) + '.' });

  // 3. movement
  const a = r.activity;
  let mv;
  if (!r.motionOk) mv = 'The movement sensor is unavailable, so the engine cannot tell whether a disturbance came from movement.';
  else if (a.dominant === 'walking') mv = `The person was walking for ${Math.round(a.walkingFrac * 100)}% of this window. Walking shakes the chest-motion signal, so changes there may just be movement.`;
  else if (a.dominant === 'fidget') mv = 'The person was moving restlessly, which distorts the signals.';
  else {
    const coughs = a.events.filter((e) => e.type === 'cough').length;
    const post = a.events.filter((e) => e.type === 'posture').length;
    mv = coughs || post ? `Mostly resting, with ${[coughs && `${coughs} cough${coughs > 1 ? 's' : ''}`, post && 'a posture change'].filter(Boolean).join(' and ')}. Those brief moments were left out of the calculation.` : 'The person was resting, so movement does not explain any change.';
  }
  steps.push({ q: 'Could movement explain what we see?', a: mv });

  // 4. agreement
  let ag;
  if (r.evidence.uncertainty.some((e) => e.includes('disagree'))) ag = 'No. The two breathing sensors disagree and neither is clearly better, so we cannot tell which is right.';
  else if (r.corroboration != null && r.corroboration >= 0.6) ag = 'Yes. Both breathing sensors show the same breath-by-breath pattern, which is strong evidence that it is real breathing and not noise.';
  else if (ch.chest.reliable && ch.acoustic.reliable) ag = 'Both sensors give a similar breathing rate.';
  else if (ch.chest.reliable || ch.acoustic.reliable) ag = `Only one sensor is usable, so there is nothing to cross-check it against${ch.acoustic.fitted === false ? ' on this patch' : ''}.`;
  else ag = 'There is no trustworthy reading to compare.';
  steps.push({ q: 'Do the sensors agree?', a: ag });

  // 5. baseline
  let bl;
  if (r.rate == null) bl = 'There is no reliable breathing rate to compare with the baseline.';
  else {
    const where = r.rate > r.range.hi ? 'above' : r.rate < r.range.lo ? 'below' : 'inside';
    bl = `About ${r.rate.toFixed(0)} breaths per minute, ${where} the expected range for ${ACT[a.dominant] || 'this activity'} (${r.range.lo.toFixed(0)}–${r.range.hi.toFixed(0)}), based on a personal baseline of ${r.baseline.rate}.`;
    if (r.range.context !== 'walking' && r.cv != null && r.cv > 0.25) bl += ' The timing between breaths is also irregular.';
  }
  steps.push({ q: 'How does it compare with the baseline?', a: bl });

  const verdict = {
    within: 'The trustworthy readings fit the expected simulated pattern. This is a simulation result and says nothing about a real person’s health.',
    concerning: 'A change remains in trustworthy readings after allowing for movement, so this simulated pattern deserves attention.',
    insufficient: 'The evidence is missing, noisy or conflicting, so BreatheGuard does not guess. This is not a normal result.',
  }[r.outcome];
  return { steps, verdict };
}

const cap = (s) => s.charAt(0).toUpperCase() + s.slice(1);

// What extra evidence would make an inconclusive result conclusive.
// Derived only from what the engine found wrong in this window.
export function neededEvidence(r, patchName = 'this patch') {
  if (r.outcome !== 'insufficient') return [];
  const ch = r.channels, out = [];
  const moving = ['walking', 'fidget'].includes(r.activity.dominant);
  for (const k of ['chest', 'acoustic']) {
    const c = ch[k];
    if (c.fitted === false) continue;
    const name = k === 'chest' ? 'chest-motion' : 'acoustic';
    if (c.flatline) out.push(`A working ${name} sensor: its signal is flat, as if detached. Re-attaching or replacing it would restore the reading.`);
    else if (!c.usable) out.push(`A working ${name} sensor: it is sending no data.`);
  }
  if (!r.motionOk) out.push('Working movement data, so that movement artefacts can be ruled out.');
  if (moving && ch.acoustic.fitted === false) out.push(`A few minutes of readings while the wearer is still, or a second breathing sensor to cross-check (as on BreatheGuard Care). ${patchName} cannot separate movement from breathing changes on its own.`);
  else if (moving) out.push('A period with less movement, so the breathing sensors are not swamped by motion.');
  const noisy = ['chest', 'acoustic'].some((k) => ch[k].usable && !ch[k].reliable && ch[k].periodicity != null && ch[k].periodicity < 0.5);
  if (noisy && !moving) out.push('A cleaner signal: better skin contact or a quieter environment.');
  if (r.evidence.uncertainty.some((e) => e.includes('disagree'))) out.push('The two breathing sensors agreeing over a longer period.');
  if (!out.length) out.push('More time with good-quality signals from at least one breathing sensor.');
  return out;
}

// One sentence saying what the simulator is showing right now.
export function demoLine(r, patchName, scenarioName) {
  return `A simulated ${patchName} during “${scenarioName}”. Before judging the breathing, BreatheGuard checks whether each signal can be trusted.`;
}
