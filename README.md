# BreatheGuard

**See Beyond the Signal. Understand the Breathing.**

A respiration monitoring prototype that separates breathing deterioration from movement artefacts. BreatheGuard doesn’t just detect a changing signal. It asks whether that signal can be trusted.

Hackathon project. The wearable patches are **proposed designs**: no hardware has been built. All sensor data is synthetic, all hospitals, doctors, patients and approvals are fictional, and nothing is clinically validated. It is not a medical device. A normal simulated result says nothing about a real person’s health. Anyone with real breathing difficulty or worsening symptoms should seek medical help, not wait for this app.

## Two modes

- **Local demo mode** (default): everything runs in the browser with demo accounts, including the Judge Demo. Not shared, not secure.
- **Connected mode**: real accounts, a shared Supabase database, live hospital updates, alerts, database-enforced consent, reports and an AI integration point. Set up with **`docs/BACKEND_SETUP.md`** (three migrations, administrator bootstrap, AI key). Testing: **`docs/TESTING.md`**. Results and remaining gaps: **`docs/HANDOVER.md`**, sections 9 and 10.

## Run it

Requires Node.js 18 or newer (tested on Node 22).

```bash
npm install
npm run dev          # open the URL Vite prints (usually http://localhost:5173)
```

Other commands:

```bash
npm test             # unit tests (56); database security and API tests run too when a test database is configured (19 more)
npm run eval         # scores the engine across seeds, writes docs/TEST_RESULTS.md
npm run build        # production build into dist/
npx vite preview     # serve the production build (http://localhost:4173)
```

Optional browser tests (need `pip install playwright && playwright install chromium`, and `npx vite preview --port 4173` running):

```bash
python scripts/e2e_judge.py      # 11-step cross-portal Judge Demo + every simulator control (56 checks)
python scripts/e2e_flow.py       # cross-portal workflows from version 1 (18 checks)
python scripts/e2e_workflows.py  # edge cases: validation, approvals, suspension, consent revocation, downloads (29 checks)
```

## Fastest way to demo

- **Judge Demo:** click **Start Judge Demo** on the login screen, or **Judge Demo** in any portal’s top bar. It runs 11 steps: problem and solution, five simulator steps (each loads a preset, plays a few seconds, then pauses), one step each in the patient, hospital and authority portals, the hardware-validation roadmap, and a summary. Use **Next step**, **Back**, **Replay step**, **Minimise** or the progress dots. If it gets stuck: Replay step; then Exit demo → Reset demo data → Judge Demo.
- **The patches:** on the login screen click **See the patches**, or in the patient portal open **Choose a patch**. **Explore Care Simulation** and **Explore Quick Simulation** open the simulator with that patch selected.
- Other portals: use the one-click demo accounts on the login screen (password for typed sign-in: `demo123`). **Reset demo data** in the sidebar restores the starting state.

## The two patch variants (proposed designs)

| | BreatheGuard Care | BreatheGuard Quick |
|---|---|---|
| Concept | Extended respiratory monitoring | Low-cost disposable monitoring |
| Intended users | Elderly people and patients who may benefit from longer observation | Short-term observation when someone first notices discomfort, subject to medical guidance |
| Sensing (as simulated) | Chest motion + acoustic + movement | Chest motion + movement (acoustic optional in the design, not simulated) |
| Wear duration | Target: up to 10–15 days, to be validated | Defined short-term period, to be established |
| Reusability | Proposed: reusable electronics/battery module, replaceable adhesive layer | Proposed: single-use, with safe-disposal guidance |
| Cost, battery, adhesive safety | Not established | Not established |

What the simulation shows about the difference: Care can cross-check two breathing sensors, so it can often separate a movement artefact from a real change while the person walks. Quick has one breathing sensor; at rest it can report, but during movement it usually says **“Insufficient reliable data”** instead of guessing, and irregular breathing is harder for it to confirm. The interface states this limitation wherever it applies.

## The simulator

Controls: patch (Care/Quick), 10 scenarios, one-click scenario presets that jump to each scenario’s key moment, Start/Pause/Resume/Reset, Run to end, a timeline scrubber, playback speed, seed, **movement intensity** (×0–2), **extra sensor noise** (none to heavy), and **Fail now / Reconnect** for each sensor the selected patch has fitted.

Displays: chest-motion waveform, acoustic feature (or a “not fitted” panel on Quick), movement waveform, engine-detected activity shading, scenario event markers, an annotated activity timeline with an event log, sensor availability and failure status, signal quality per sensor, the result with its reason, a plain-language **“Why this result?”** panel, the competing-explanations panel, and the rate trend.

Scenarios: normal rest; walking artefacts; coughing; posture change; sustained irregular breathing; a concerning change occurring during movement; one sensor failure; multiple sensor failures; recovery towards baseline; ambiguous evidence.

## Architecture

```
src/
  sim/          scenarios.js (10 scenarios + ground truth), generator.js (synthetic sensors and controls),
                patches.js (Care/Quick), events.js (timeline annotations), judgeDemo.js (demo presets)
  analysis/     engine.js (the analysis), explain.js (plain-language reasoning), dsp.js, session.js
  data/         permission-checked state transitions + localStorage store
  components/   UI, charts (Recharts), PatchArt (patch and placement illustrations)
  pages/        patient/ (incl. PatchSelect, Monitor = simulator), hospital/, authority/
tests/          node:test suites
scripts/        evaluate.js, e2e_judge.py, e2e_flow.py
```

The analysis engine never sees the scenario’s ground truth, only arrays of samples plus which sensors the patch has. Generator controls use separate random streams, so injecting a failure or adding noise never changes the signals that came before.

### How a result is reached (every 10 s, over the last 30 s)

1. **Movement context** from the movement sensor: rest, walking, restless movement, cough, posture change. If the movement sensor fails, the context is “unknown” and the engine says so.
2. **Per-sensor analysis:** breathing rate and breath-timing variability.
3. **Signal quality per sensor:** missing data, flat signal, share of power in the breathing band, rhythm regularity, number of clean breaths, and a penalty for movement (chest heavily, acoustic slightly).
4. **Cross-sensor agreement:** if chest and acoustic show the same breath-by-breath pattern, that is strong evidence of real breathing. Independent noise does not agree across sensors. Not available on Quick.
5. **Fusion:** a conclusion from one sensor alone needs higher quality. Disagreement that would change the conclusion gives “insufficient”.
6. **Comparison with a personal baseline,** widened while walking. With unknown activity, a moderate rise gives “insufficient” because it might just be activity.
7. **Outcome:** within expected simulated range, potentially concerning simulated pattern, or insufficient reliable data.

**Safety rule:** quality and concern are separate. Poor quality can only lead to “insufficient”: never to reassurance, and never to an alarm by itself.

## Test results

From `docs/TEST_RESULTS.md` (`npm run eval`). These use our own synthetic scenarios, so they show the logic behaves as designed. They are **not** evidence of accuracy on real people.

- **Care, 50 hold-out seeds** not used during tuning: 99.7% agreement with scenario labels over 7,850 windows; false reassurance in 4 of 2,650 windows that needed attention (0.2%).
- **Quick:** no false reassurance (0 of 1,060); much more often “insufficient”, by design.
- **Heavy noise (slider maximum):** no false reassurance, but 26 of 2,080 normal windows (1.3%) were wrongly flagged as concerning. This is a known weakness.
- **Movement sensor failed:** Quick always reports “insufficient”; Care continues using its two breathing sensors.
- The naive chest-only comparison raised false alarms in about 60% of normal walking windows.
- `npm test`: 44 of 44 pass, including tests that each scenario’s waveforms follow its definition and that every Judge Demo step produces the outcome its narration claims. Browser tests: 103 of 103 checks passed on the final build (see `docs/HANDOVER.md`).

During this upgrade, testing found and fixed a real weakness: the rhythm-quality check accepted noisy signals as high quality, which under heavy noise caused false alarms and false reassurance. The stricter check also slightly improved the original results.

For the judging-day handover (what was tested, known issues, demo script, judge questions), see **`docs/HANDOVER.md`**.

## Implemented, simulated, proposed, unvalidated

| Area | Status |
|---|---|
| Three portals, navigation, demo login and registration | Implemented software |
| Saved-data repair and page-level error screen | Implemented software |
| Patch selection page, comparison table, placement and layer diagrams | Implemented software (illustrating proposed designs) |
| Simulator, all controls, 10 scenarios, Judge Demo | Implemented software |
| Analysis engine, three outcomes, explanations, patch-specific sensors | Implemented software (rule-based, not clinically validated) |
| Sensor signals, movement, coughs, posture, noise, failures | **Simulated** |
| Physical patches, sensors, adhesive and skin safety, battery life, 10–15-day wear, reusable module, disposal, cost | **Proposed hardware, requires engineering development and testing** |
| Whether the analysis works on real people | **Requires clinical validation** (not started) |
| Hospital/doctor verification, appointments, reviews, consent, audit | Implemented (demo authority, no real registry) |
| Reports (JSON and print-to-PDF), prescriptions and reminders | Implemented (in-app only) |
| Medicine explanations | Partial: four medicines with source links |
| Medicine interaction checking, diet education, push notifications | Not implemented |
| Real authentication and server-side authorisation | Not implemented (see below) |

## Security

Everything is stored in the browser’s `localStorage`: one browser equals one database, passwords are stored in plain text, and permission checks can be bypassed by editing storage. This demonstrates the rules; it is not secure. Minimum backend to make it real: a server that owns the data, real authentication, running the existing pure functions in `src/data/actions.js` server-side, row-level consent rules, an append-only audit table, and integration with an official registry for verification.

## Limitations

- Thresholds were tuned by hand on synthetic data whose movement and noise models are our own assumptions.
- Scores and “evidence reliability” percentages are heuristics, not calibrated probabilities.
- The Quick configuration was chosen for the simulation (chest + movement). Whether an acoustic sensor is worth its cost on Quick is an open design question.
- Medicine source links point to NHS pages; check they still resolve before presenting.
