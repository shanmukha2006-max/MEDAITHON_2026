// The two proposed BreatheGuard patch variants.
// Everything under `proposed` is a DESIGN TARGET, not an achieved specification.
// `channels` is what the software simulator actually models for each variant.
export const PATCHES = {
  care: {
    id: 'care',
    name: 'BreatheGuard Care',
    concept: 'Extended respiratory monitoring',
    audience: 'Elderly people and patients who may benefit from longer-term observation',
    channels: { chest: true, acoustic: true, motion: true },
    sensors: ['Chest-motion sensing', 'Acoustic breathing sensing', 'Movement/activity sensing'],
    highlights: ['Intended for longer-term monitoring', 'Proposed sensing: chest motion and movement/activity, plus optional acoustic sensing', 'Respiratory trends and activity history', 'Replaceable adhesive layer with reusable electronics (design option)'],
    proposed: {
      use: 'Longer-term observation, e.g. at home or in care settings',
      sensing: 'Chest motion + movement/activity, plus optional acoustic sensing (modelled as fitted in this simulation)',
      wear: 'Design goal: up to 10–15 days. Not validated',
      reuse: 'Proposed: reusable electronics and battery module, replaceable adhesive layer',
      cost: 'Higher per unit (not yet costed)',
      status: 'Concept. Software simulated; hardware not built',
    },
    limitation: null,
  },
  quick: {
    id: 'quick',
    name: 'BreatheGuard Quick',
    concept: 'Low-cost disposable respiratory monitoring',
    audience: 'Low-cost, short-term observation where a brief period may be enough to collect preliminary information, subject to appropriate medical guidance',
    channels: { chest: true, acoustic: false, motion: true },
    sensors: ['Chest-motion sensing', 'Movement/activity sensing'],
    highlights: ['Intended for low-cost, short-term observation', 'Simpler proposed sensor configuration: chest motion and movement/activity', 'For situations where brief observation may give preliminary information', 'Lightweight, single-use adhesive design'],
    proposed: {
      use: 'Brief observation to collect preliminary information',
      sensing: 'Chest motion + movement (2 inputs). Acoustic optional, if its cost is justified',
      wear: 'Defined short-term period (to be established during development)',
      reuse: 'Proposed: single-use, with safe-disposal guidance',
      cost: 'Designed for lower cost (not yet costed)',
      status: 'Concept. Software simulated; hardware not built',
    },
    limitation: 'Quick has no acoustic sensor to cross-check the chest signal. While the wearer is moving, it often cannot separate a real change from a movement artefact, and will say "Insufficient reliable data" rather than guess. At rest it relies on the chest sensor alone, so irregular breathing is harder to confirm and is more often reported as insufficient data than on Care.',
  },
};
export const PATCH_LIST = [PATCHES.care, PATCHES.quick];

// Trade-offs between the two proposed concepts. Qualitative only: no prices,
// battery life or accuracy figures exist for hardware that has not been built.
export const TRADEOFFS = [
  { dim: 'Sensing capability', care: 'More inputs: a second breathing sensor (acoustic) can cross-check the chest signal.', quick: 'Fewer inputs: one breathing sensor plus movement. Nothing to cross-check the chest signal against.' },
  { dim: 'Signal reliability during movement', care: 'In the simulation, often still gives an answer while walking, because breath sound is less affected by movement.', quick: 'In the simulation, usually reports “insufficient reliable data” while the wearer moves. More reliable at rest.' },
  { dim: 'Intended duration', care: 'Longer-term. 10–15 days is a design goal only; battery, adhesive and skin safety are untested.', quick: 'Short-term. The intended period is still to be established.' },
  { dim: 'Cost considerations', care: 'More sensors and a reusable module are likely to cost more per device; replaceable adhesive may offset this over time. Not costed.', quick: 'Fewer parts and single use aim to lower the cost of each patch, but each use needs a new one. Not costed.' },
];

// Future hardware-validation roadmap. Phases have gates, not dates: none have been scheduled.
export const ROADMAP = [
  { phase: 'Software prototype', status: 'done', what: 'Simulator, analysis engine and three portals, on synthetic data only.', gate: 'Passes its own synthetic tests (done).' },
  { phase: 'Bench prototype', status: 'next', what: 'Build test versions of Care and Quick. Test sensors on a mechanical breathing rig with controlled movement.', gate: 'Sensors capture breathing and movement reliably on the bench.' },
  { phase: 'Safety and wear', status: 'later', what: 'Adhesive and skin compatibility, battery life, the Care wear goal, Quick disposal guidance.', gate: 'Meets applicable safety standards; wear goal confirmed or revised.' },
  { phase: 'Supervised recordings', status: 'later', what: 'With ethics approval: consenting volunteers, then patients, recorded alongside reference measurements during rest, walking, coughs and posture changes.', gate: 'A labelled real-world dataset.' },
  { phase: 'Algorithm validation', status: 'later', what: 'Re-derive thresholds from real data; test on people not used for tuning; measure false reassurance and missed changes.', gate: 'Pre-agreed safety targets met on held-out participants.' },
  { phase: 'Clinical and regulatory', status: 'later', what: 'Studies in the intended users; medical-device regulatory process; secure server-side platform.', gate: 'Regulatory clearance before any real-world use.' },
];
