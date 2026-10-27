// Guided Judge Demo. Simulator steps are reproducible presets (patch, scenario, seed,
// failures, playback span); portal steps open a page as a demo account.
// Every simulator step's `expect` is checked by tests/patches.test.js, so the
// narration cannot drift away from what the engine actually reports.
export const JUDGE_STEPS = [
  {
    id: 'intro', portal: { user: 'u_pat1', page: 'patches' }, where: 'Introduction',
    title: 'The problem and our proposed solution',
    say: 'Breathing sensors worn on the body also pick up walking, coughs, posture changes and sensor faults, so a changing signal is not always a changing breath. BreatheGuard is a proposed chest patch, in two versions, whose software asks whether a signal can be trusted before judging it.',
    look: 'The problem and solution at the top, and the two proposed patches: Care and Quick.',
  },
  {
    id: 'rest', patch: 'care', scenario: 'normal_rest', from: 30, to: 60, expect: 'within',
    title: 'BreatheGuard Care: normal breathing at rest',
    say: 'Care uses three sensors: chest motion, breath sound and movement. The person is resting and breathing steadily.',
    look: 'Both breathing waveforms are regular and agree. Signal quality is high. Result: within expected simulated range.',
  },
  {
    id: 'walk', patch: 'care', scenario: 'walking', from: 30, to: 80, expect: 'within',
    title: 'Movement starts: an artefact, not a breathing change',
    say: 'At 40 seconds the person starts walking. The chest-motion signal becomes messy and a chest-only monitor reads a falsely high rate. BreatheGuard sees the walking on the movement sensor, stops trusting the chest channel, and relies on breath sound, which walking barely affects.',
    look: 'Movement waveform and blue “Walking” shading; “Why this result?”: chest not trusted, acoustic trusted.',
  },
  {
    id: 'irregular', patch: 'care', scenario: 'irregular', from: 120, to: 150, expect: 'concerning', compare: ['walk', 'irregular'],
    title: 'A potentially concerning simulated pattern',
    say: 'Now the person is resting, but breathing has become faster and irregular. Both cases disturbed the chest signal; the difference is the evidence. In the walk, movement explained it and breath sound stayed normal. Here there is little movement, and both breathing sensors show the same change.',
    look: 'Flat movement waveform; the side-by-side card comparing the walk with this case; result: potentially concerning.',
  },
  {
    id: 'failures', patch: 'care', scenario: 'normal_rest', from: 50, to: 140, expect: 'insufficient', failures: [{ sensor: 'chest', from: 60 }, { sensor: 'acoustic', from: 100 }],
    title: 'Sensor failure: insufficient reliable data',
    say: 'At 60 seconds the chest sensor detaches and goes flat. Care carries on with breath sound, with less confidence. At 100 seconds breath sound drops out too. Only the movement sensor is left, and it cannot measure breathing, so BreatheGuard says the data is insufficient instead of guessing.',
    look: 'Sensor availability chips turning red; the hatched “Insufficient reliable data” result.',
  },
  {
    id: 'quick', patch: 'quick', scenario: 'walking', from: 90, to: 120, expect: 'insufficient',
    compare: [{ id: 'care-same', patch: 'care', scenario: 'walking', to: 120 }, 'quick'],
    title: 'BreatheGuard Quick: simpler sensors, honest limits',
    say: 'Quick is the proposed low-cost disposable patch, with chest-motion and movement sensing only. In the same walk it has no second breathing sensor to cross-check, so it reports insufficient data where Care could still give an answer.',
    look: 'Acoustic sensor “Not fitted”; comparison card: Care within range, Quick insufficient.',
  },
  {
    id: 'portal-patient', portal: { user: 'u_pat1', page: 'directory' },
    title: 'Patient portal: only verified care',
    say: 'Patients only see hospitals approved by the authority, and doctors whose own credentials were separately verified. Dr. Priya Nair at Riverside is still pending, so she is not listed, even though her hospital is approved.',
    look: '“Verified (demo)” badges; ratings show how many reviews they come from.',
  },
  {
    id: 'portal-hospital', portal: { user: 'u_hosp1', page: 'patients' },
    title: 'Hospital portal: consent decides access',
    say: 'The hospital sees a patient’s simulated reports only with that patient’s consent. Asha shared hers; Ben did not, so his are locked. Booking an appointment never grants access by itself.',
    look: '“Reports shared” for Asha Rao and the lock for Ben Ortiz. Both are labelled synthetic patients.',
  },
  {
    id: 'portal-authority', portal: { user: 'u_auth1', page: 'hospitals?select=h_northgate' },
    title: 'Authority portal: independent review with reasons',
    say: 'The healthcare authority reviews hospitals and doctors separately. Every decision needs a written reason and is recorded in the audit trail. A hospital account cannot approve itself.',
    look: 'Northgate in the Pending queue; the decision panel that requires a reason.',
  },
  {
    id: 'roadmap', portal: { user: 'u_pat1', page: 'patches?focus=roadmap' }, where: 'Roadmap',
    title: 'From simulation to a real patch',
    say: 'Everything so far is software on synthetic data. Before real use: build bench prototypes, test adhesive, skin safety and battery life, record real signals under ethics approval, validate the algorithm on people it was not tuned on, then the clinical and regulatory process. Only the first phase is done.',
    look: 'The roadmap: six phases, each with a gate; phase 1 done, phase 2 next. No dates are claimed.',
  },
  {
    id: 'summary', summary: true,
    title: 'Summary',
    say: 'BreatheGuard doesn’t just detect a changing signal. It asks whether that signal can be trusted.',
    look: 'Three outcomes: explained by movement, a genuine simulated change, and not enough reliable evidence.',
  },
];
