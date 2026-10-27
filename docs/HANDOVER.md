# BreatheGuard: handover (Parts 5 and 6)

**Core message:** BreatheGuard doesn’t just detect a changing signal. It asks whether that signal can be trusted.

**Part 6 added connected mode** (real accounts, shared database, live hospital updates, alerts, consent enforced by the database, reports, AI integration point). See section 8 below and `docs/BACKEND_SETUP.md`. Without backend settings, the app runs exactly as in Part 5 (local demo mode), including the Judge Demo.

## 1. Changes made in Part 5

- **Judge Demo now follows the requested 8-point sequence in 11 steps:** problem and solution → Care at rest → movement artefact → concerning pattern (with side-by-side comparison) → sensor failure → Quick → patient, hospital and authority portals → hardware-validation roadmap → summary.
- **Judge Demo is easier to reach and recover:** a **Judge Demo** button in the top bar of every portal; a recovery hint in the narration bar; a **Minimise** button; on laptops the narration bar stays pinned while scrolling; on phones a floating Back/Next control appears.
- **Explanation panel extended:** a line saying what the simulator is showing, and for inconclusive results, **“What would make this conclusive”**, generated from the actual cause (flat sensor, missing data, movement, noise, disagreement, missing movement data). Sensor problems are now worded plainly.
- **Patch comparison:** Part 5 wording for both patches (Care: chest motion and movement plus optional acoustic; Quick: brief observation for preliminary information); both labelled as proposed concepts, not manufactured or validated; a new **Trade-offs** table (sensing capability, reliability during movement, intended duration, cost considerations), with no prices or performance figures.
- **Future hardware-validation roadmap:** six phases with gates and no invented dates, on the patch page and in the demo.
- **Hospital status messages:** while a hospital is not approved, every hospital page shows a banner explaining what that means.
- **Bugs fixed:** the narration bar had stopped staying visible when scrolling (introduced in Part 4); explanation-panel bullets were wrongly numbered; chart tooltips could make phone pages scroll sideways by a few pixels.

## 2. Tested features and results (final build)

All results below come from one run on the final production build (development server for the console and layout audits).

| Feature or check | How it was tested | Result |
|---|---|---|
| Engine, safety rules, signal fidelity, controls, Care vs Quick, Judge Demo outcomes and narration facts, trust rules, data repair, “what would help” suggestions | `npm test` | 48 of 48 pass |
| Judge Demo: all 11 steps (result on screen, portal pages, roadmap in view, Back, jumping, **Restart demo**, Exit), top-bar Judge Demo from the hospital portal, recovery hint | `scripts/e2e_judge.py` | Pass (part of 56 checks) |
| Simulator: Start, Pause, Resume, Reset, timeline scrubber, presets, all 10 scenarios on Care and Quick, movement and noise sliders, Fail now / Reconnect for every sensor, movement-sensor failure | `scripts/e2e_judge.py` | Pass (part of 56 checks) |
| Patch switching changes channels (acoustic “not fitted” on Quick), Explore Care/Quick buttons, patch comparison | `scripts/e2e_judge.py` | Pass |
| Explanation panel: what is shown, channels, movement, reliability, why, and what would help when inconclusive | `scripts/e2e_judge.py` + `npm test` | Pass |
| Hospital status banner while not approved; partially missing saved data | `scripts/e2e_judge.py` | Pass |
| Original cross-portal flow: reports, consent, reviews, appointments, approvals, audit, directory, moderation | `scripts/e2e_flow.py` | 18 of 18 checks |
| Edge cases: validation, hospital application → decision with reason, separate doctor verification, resubmission, suspend/reinstate, decline/cancel, consent revocation, download, print, medicines, complaints, security notice | `scripts/e2e_workflows.py` | 29 of 29 checks |
| Browser console (dev mode) across every page, simulator use and the whole Judge Demo | Console audit | 0 errors, 0 warnings |
| Layout at 390, 768, 1024, 1366 and 1920 px on every page | Responsive audit (95 combinations) | 0 horizontal overflow |
| Judge Demo on a phone (390 px): all 11 steps | Phone walk-through | No overflow; floating Back/Next visible at every step |
| Engine scoring on synthetic scenarios | `npm run eval` | Care hold-out 99.7% agreement, 0.2% false reassurance (synthetic only) |

In total: 48 unit tests and 103 browser checks, all passing, with no page errors.

## 3. Remaining limitations

- **Heavy noise:** at the noise slider’s maximum, about 1.3% of normal windows are wrongly flagged as concerning (no false reassurance observed).
- **Quick while moving:** usually “insufficient reliable data”. Intended, and explained in the app.
- **Care acoustic sensing:** described as optional in the proposed design, but modelled as fitted in the simulation.
- **External links:** the four NHS medicine links could not be checked from the build environment; check them before presenting.
- **Not implemented:** medicine interaction checking, push notifications, reading uploaded prescription files, real authentication and server-side permissions.
- **Security:** login and permissions run in the browser on `localStorage`. Not secure.
- **Deployment:** tested locally on a production build; deployment settings unchanged. Re-check the live site.

## 4. Starting the app

**In VS Code:**
1. **File → Open Folder…** and choose the `breatheguard` folder that directly contains `package.json` (unzipping on Windows can create `breatheguard\breatheguard`; open the inner one).
2. **Terminal → New Terminal**, then run `npm install` (first time only), then `npm run dev`.
3. `Ctrl` + click the `http://localhost:5173/` link.
4. If this browser used an earlier version: sign in with any demo account, click **Reset demo data** in the sidebar, sign out.

**Deployed site:** redeploy as before (build `npm run build`, output `dist/`), open the URL, and do step 4 above.

## 5. Three-minute judging demonstration

Click **Start Judge Demo** on the login screen (or **Judge Demo** in any portal’s top bar). Talk over each step, then click **Next step**.

| Step | Time | Say | Point at |
|---|---|---|---|
| 1 Problem and solution | 0:00–0:20 | “Body-worn breathing sensors also pick up movement, coughs and faults. Our patch asks whether a signal can be trusted before judging it.” | Problem and solution text; the two patches |
| 2 Care at rest | 0:20–0:35 | “Care has three sensors. At rest, everything agrees.” | Regular waveforms, high quality, within range |
| 3 Movement | 0:35–0:55 | “Walking scrambles the chest signal. A chest-only monitor would alarm. We see the walking and rely on breath sound instead.” | Walking shading; chest not trusted; chest-only alarm |
| 4 Concerning | 0:55–1:15 | “Now: resting, but fast, irregular breathing that both sensors agree on. Same messy chest signal, different evidence.” | Side-by-side card; concerning result |
| 5 Sensor failure | 1:15–1:35 | “Sensors fail one after the other. With nothing trustworthy left, we say so, and say what would fix it.” | Hatched result; “What would make this conclusive” |
| 6 Quick | 1:35–1:55 | “Quick is simpler and cheaper. In the same walk it admits it can’t tell, instead of guessing.” | Acoustic “not fitted”; Care vs Quick card |
| 7–9 Portals | 1:55–2:25 | “Patients see only independently verified care. Hospitals see reports only with consent. The authority decides with written reasons, all audited.” | Verified badges; Ben locked; reason box |
| 10 Roadmap | 2:25–2:45 | “All of this is software on synthetic data. Real use needs hardware, safety testing, real recordings and clinical validation.” | Phase 1 done, phase 2 next |
| 11 Summary | 2:45–3:00 | “BreatheGuard doesn’t just detect a changing signal. It asks whether that signal can be trusted.” | The three outcomes |

**If the demo gets stuck:** press **Replay step** (reloads the step exactly). Still stuck: **Exit demo** → **Reset demo data** (sidebar) → **Judge Demo**. A chart not updating: **Replay step**. A blank or error page: use the page’s **Reset demo data** button. Last resort: refresh the browser tab (demo data is kept) and start Judge Demo again.

## 6. How synthetic signals flow through the analysis

1. **Generate:** a seeded generator produces chest motion, breath-sound envelope, acceleration and tilt at 10 samples per second for the chosen scenario, with the movement, noise and failure settings applied. The same seed always gives the same signals.
2. **Select patch channels:** Care passes all three sensor streams; Quick withholds the acoustic stream, which the engine then reports as “not fitted”.
3. **Window:** every 10 seconds the engine analyses the last 30 seconds.
4. **Movement context:** the movement sensor labels each second (rest, walking, restless, cough, posture change); coughs and posture changes are cut out of the breathing analysis. No movement data → context “unknown”.
5. **Per-sensor checks:** each breathing sensor gets a breathing rate, breath-timing regularity and a quality score from missing data, flat signal, how much signal lies in the breathing band, rhythm regularity and how much movement is present.
6. **Cross-check:** if two breathing sensors show the same breath-by-breath pattern, that is strong evidence of real breathing. One sensor alone must meet a higher quality bar.
7. **Compare with the baseline:** the trusted rate is compared with the person’s baseline range, widened for walking.
8. **Decide:** no trustworthy sensor, disagreeing sensors, or an unexplained rise with no movement data → **insufficient reliable data**. A sustained change in trustworthy evidence that movement does not explain → **potentially concerning simulated pattern**. Otherwise → **within expected simulated range**.
9. **Explain:** the panel turns the same measurements into plain-language answers and, when inconclusive, the evidence that would help.

Signal quality is scored separately from the breathing assessment. Poor quality can only lead to “insufficient”: never to reassurance, and never to an alarm on its own.

## 7. What is implemented, proposed, and still to be validated

| | What it is | Status |
|---|---|---|
| **Implemented software simulation** | Signal generator, analysis engine, explanations, Judge Demo, three portals, reports, consent, verification workflows | Built and tested on synthetic data |
| **Proposed wearable patches** | BreatheGuard Care and BreatheGuard Quick: sensors, adhesive, reusable module, disposal, wear duration, cost | Design concepts only; nothing manufactured |
| **Future clinical validation** | Real recordings, thresholds from real data, testing on new participants, clinical studies, regulatory approval | Not started; required before any real use |

A normal simulated result says nothing about a real person’s health. Anyone with breathing difficulty or worsening symptoms should seek medical help, not wait for a device or app.

**Before real-world deployment:** server-side data storage and permissions, real authentication, an append-only audit log, encryption and health-data compliance, official registry checks for hospitals and doctors; and the full hardware, safety, clinical and regulatory programme in the roadmap.


## 8. Part 6: backend foundation (connected mode)

**Provider:** Supabase (PostgreSQL with row-level security, Supabase Auth, Realtime, Edge Functions). Chosen because every access rule lives in the database itself, so it applies to direct API calls and real-time subscriptions, not only to the app’s screens.

**Database** (`supabase/migrations/0001_breatheguard_init.sql`): 11 tables (profiles, hospitals, doctors, consents, monitoring_sessions, observations, analysis_results, alerts, appointments, reports, audit_log), UUID keys and timestamps, validation checks, row-level security on every table, server-side decision functions (`decide_hospital`, `decide_doctor`, `acknowledge_alert`, `set_appointment_status`, `session_report`), triggers for role protection, pending-only applications, consent and decision auditing, and alert creation on outcome changes.

**App:** `src/backend/` (data layer, reliable recorder, real-time ordering, reports), `src/cloud/` (connected-mode screens), `supabase/functions/ai-assistant/` (server-side AI function). Changed: `src/App.jsx`, `src/main.jsx`, `src/pages/Login.jsx`.

### Tests: what was actually run

| Test | Environment | Result |
|---|---|---|
| Database security (`tests/db/rls.test.js`) | Real PostgreSQL 16, the real migration, a test stand-in for Supabase’s auth schema | 13 of 13 pass. Sabotage check: with two rules deliberately broken, 7 tests failed, proving they detect problems |
| App data layer (`tests/db/api.integration.test.js`) | The real `api.js` and recorder, official supabase-js client, real PostgREST 12, real database | 6 of 6 pass |
| Backend unit tests (`tests/backend.test.js`) | Node | Real-time ordering and duplicates, recorder retries, error messages, report labelling, AI prompt guards: pass. Found and fixed a bug where the live stream could drop data after a long gap |
| Two-device browser test (`scripts/e2e_cloud.py`) | Three isolated browser sessions, real database through PostgREST, **test stand-in for Supabase Auth**, no Realtime server | 23 of 23 checks pass |
| Local demo regression | Production build without backend settings | 103 of 103 browser checks pass; all 56 non-database unit tests pass |
| Migration | Applied twice to real PostgreSQL | Succeeds both times |

The two-device test covered: registration and sign-in with enforced roles; hospital application; authority decision refused without a reason, then approved; consent; patient recording; the hospital device receiving new data without refreshing (60 → 105 seconds received); a concerning alert reaching the hospital and being acknowledged; alerts only on changes (3 alerts from 18 results); session stop with 203 seconds persisted; synthetic-labelled report download; AI assistant honest setup message; clear wrong-password error; history kept after sign-out and sign-in; revoked consent removing hospital access.

### Not verified here (needs your Supabase project)

- **Supabase Auth itself** (real sign-up emails, confirmation, token refresh): tested only through a stand-in that issues the same kind of signed tokens.
- **Supabase Realtime** (the instant WebSocket path): no Realtime server could run here. Live updates were verified through the app’s fallback, which reads the shared database every 3 seconds. Real-time subscriptions are coded and the tables are published; test them with `docs/BACKEND_SETUP.md`, section 7.
- **The AI Edge Function** running in Supabase’s runtime, and a real AI provider call. The prompt logic and safety rules are unit-tested; the deployed function is not.
- **Two physical devices** and real network loss. Retry behaviour was tested with simulated failures.

### Known limitations of the foundation

- **Analysis runs in the patient’s browser** and is written to the database by the patient. A modified browser could submit false analysis for its own sessions. Moving the analysis to a server function is the main step towards production.
- Connected mode covers accounts, monitoring, live view, alerts, consent, hospital and doctor reviews, audit, reports and the AI hook. **Appointments** have a backend table, rules and status function (tested), but the appointment screens still use local demo mode.
- Unsaved data waits in memory; closing the tab while offline loses what was still queued (the app shows how much is waiting).
- No rate limiting, account recovery screens, or data-retention policy yet.
- Audit history and alerts are a software demonstration, not a clinical or legal record.

### Commands

```bash
npm install
npm run dev                          # local demo mode, or connected mode if .env is set
npm test                             # unit tests (database tests skip without a test database)
```

Database and two-device tests need PostgreSQL and PostgREST; see `supabase/tests/` and the headers of `tests/db/*.test.js` and `scripts/e2e_cloud.py`.


## 9. Part 7: complete connected mode

**Starting point.** The repository contained unreported Part 7 work (a second migration, PDF reports, new pages, AI and acceptance test harnesses), most likely from an interrupted earlier run. It was treated as unverified: rebuilt from a clean database, tested, sabotage-checked, upgraded and documented.

**Services actually used.** Supabase design (PostgreSQL row-level security, Supabase Auth, Realtime, Edge Functions); an Anthropic-compatible AI endpoint called only from the Edge Function; jsPDF for PDF files. In testing: real PostgreSQL 16, real PostgREST 12.2.3, the real Edge Function code under Deno 2.1.4, the app’s production build. **Stand-ins (test only):** Supabase Auth (signed tokens, no email), the AI provider (marked replies, not a real model). **Not available in testing:** Supabase Realtime, a real model, separate physical devices.

### Acceptance tests (run on the final build)

| | Requirement | Result | Notes |
|---|---|---|---|
| A | Authentication and roles | 9/9 pass | Patient, hospital staff, doctor, administrator; no self-promotion; password change; reset request accepted. Reset **email delivery** not testable here |
| B | Persistence across devices | 2/2 pass | Separate browser contexts, not separate machines |
| C | Real-time to hospital without refresh | 3/3 pass | Via the **polling fallback** against the shared database. **Supabase Realtime WebSocket path not verified** |
| D | Persisted concerning alert with explanation | 6/6 pass | No duplicates (3 alerts for 20 results); in-app notification |
| E | Unreliable signals → insufficient data | 2/2 pass | |
| F | Consent revocation blocks reads and updates | 3/3 pass | Hospital staff and linked doctor |
| G | Real PDF with persisted data | 13/13 pass | Text extracted from the PDF; CSV too; downloads logged; unauthorised refused |
| H | AI through the server; no cross-patient access | 3/3 pass | Against a **stand-in model**. A real model is **not verified** (needs your key) |
| I | Verification persisted and enforced | 8/8 pass | |
| J | Regression | 2/2 connected + **103/103 local** | Judge Demo 56, original flow 18, workflows 29 |

Also: 94/94 unit, database, API and AI-function tests; a sabotage check (two protections deliberately broken → 5 tests failed; restored → all pass); both migrations apply to a fresh database and re-run cleanly.

### Fixed in Part 7

- **Critical/high dependency advisories:** jsPDF 2.5.1 → 4.2.1, supabase-js 2.45.4 → 2.117.3, DOMPurify pinned to 3.4.17. Production audit: 0 vulnerabilities. All tests re-run green on the upgraded libraries.
- **Setup guide was wrong:** it omitted migration `0002`, so following it gave a broken connected mode. Rewritten, including the administrator bootstrap, doctor accounts, password-reset URLs, SMTP, AI privacy and reports.
- **Missing `docs/TESTING.md`** (referenced by the stack script): written.
- Acceptance script assumed sessions were still running when the scenario had already ended; fixed, and a stopped-state check added.

### What you still need to supply

1. A Supabase project: run both migrations; set Site URL and Redirect URLs; optionally your own SMTP.
2. `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY` in `.env` locally and in your host’s environment settings.
3. The first administrator via `select public.bootstrap_authority('…');`.
4. For the AI assistant: an Anthropic API key, set with `supabase secrets set ANTHROPIC_API_KEY=…`, and `supabase functions deploy ai-assistant`.

### Remaining issues

- **AI history is saved by default** (owner-only and deletable). An explicit opt-in toggle is recommended.
- **Analysis runs in the patient’s browser**; a modified client could submit false results for its own sessions.
- **No push, SMS or email notifications**: in-app only (plus Supabase’s own account emails).
- **Unverified here:** Realtime WebSockets, password-reset email delivery, a real model, two physical devices, real network loss.
- Local demo mode (localStorage) remains for the offline Judge Demo and is labelled as not shared and not secure; connected mode does not use it for any records.

### Starting and deploying

```bash
npm install
npm run dev                 # local demo mode, or connected mode when .env is set
npm run build               # production build into dist/ (set the two VITE_ variables in your host first)
```

Two-device testing: `docs/BACKEND_SETUP.md`, section 7.


## 10. Part 8: relationships, messaging, prescriptions and full patient dashboard

**Starting point.** As in Part 7, the workspace contained unreported work from an interrupted attempt (`Pages8.jsx`, `relationships.test.js`, `e2e_part8.py`, new API functions, recorder controls). This run independently wrote migration `0003` and its own tests. The two were checked against each other: the other attempt's 9 database tests pass on this migration, and every table and function the screens call exists.

**Backend, services actually used:** Supabase design (PostgreSQL + row-level security, Auth, Realtime, Edge Functions); Anthropic-compatible API from the Edge Function only; jsPDF 4.2.1. **In testing:** real PostgreSQL 16 with migrations 0001–0003, real PostgREST 12.2.3, the real Edge Function under Deno 2.1.4, the app's production build in separate browser contexts. **Stand-ins (test only):** Supabase Auth (signed tokens, no email), the AI provider (marked replies). **Not available:** Supabase Realtime (live updates verified through the app's 3-second polling fallback), a real model, a deployment, two physical laptops.

**Migration `0003_breatheguard_relationships.sql`:** `care_requests` (patient → one specific verified doctor; at most one open request per pair; only that doctor can see and answer it; acceptance grants that doctor read access; ending it removes access), `messages` (only within an accepted connection; server sets sender and recipient; idempotent by client id; read status changeable only by the recipient), alert resolution with a required note and notifications to connected doctors (once per alert), `prescriptions` (only a connected, verified doctor; labelled demo record), `medication_reminders` and `reminder_doses` (validated HH:MM times; each dose recorded once), `reviews` (own completed appointments only, one each), `ai_usage` with `ai_rate_check()` (per-user hourly limit, checked before any provider call), `profiles.ai_history_opt_in` (default off). Applies cleanly to a fresh database and re-runs safely.

**Bugs found and fixed in Part 8**
- **AI answers were invisible by default.** The assistant page displayed only *saved* history, and history is now opt-in and off, so answers were generated but never shown. Fixed: answers always display and are labelled “not saved” when history is off.
- **Test infrastructure:** the stack script's PostgreSQL start did not survive; fixed and documented that services must be restarted after the environment is reset.
- An outdated Part 7 acceptance check expected AI history to be saved by default; updated to the new privacy behaviour.

### Mandatory acceptance tests (run on the final build)

| # | Test | Result | Evidence |
|---|---|---|---|
| 1 | Authentication | **PASS** | Acceptance A 9/9 (patient, hospital staff, doctor, administrator; no self-promotion; wrong password; password change; reset request); Part 8 [1] |
| 2 | Persistent monitoring | **PASS** (separate browser sessions) | Acceptance B 2/2: sessions, observations and alerts reload on a second browser context after sign-in |
| 3 | Real-time alert to Laptop B | **PASS via polling fallback** | Part 8 [3] 4/4: persisted concerning alert reached the connected doctor without refresh, with patient, scenario, reason; resolved, note reached the patient. **Supabase Realtime WebSocket: NOT TESTED** |
| 4 | Movement artefact | **PASS** | Engine unit tests (walking: chest-only monitor alarms, engine does not; hidden change during walking flagged); Judge Demo suite |
| 5 | Sensor failure | **PASS** | Live controls: within → insufficient after disabling both breathing sensors, persisted, never normal (5/5); Part 8 [5] 3/3; acceptance E 2/2 |
| 6 | Messaging | **PASS** (separate browser sessions) | Part 8 [6] 5/5: unread count, sender and time, live reply, read receipt, persists after refresh |
| 7 | Connection request | **PASS** | Part 8 [7] 8/8: reaches only the intended doctor, not a colleague at the same hospital; duplicate prevented; acceptance and rejection reach the patient live |
| 8 | Consent and permissions | **PASS** | 116 backend tests including sabotage checks (rules deliberately broken → tests failed); acceptance F 3/3; Part 8 [8] |
| 9 | PDF report | **PASS** | Acceptance G 13/13: text extracted from the downloaded PDF matches the persisted session; CSV; unauthorised refused |
| 10 | AI assistant | **PARTIAL** | Server path, isolation, rate limit, missing-key message, opt-in history: PASS (AI integration tests, acceptance H 3/3). **Genuine model response: NOT TESTED** (needs your API key). Provider-error handling is implemented (502 with retry flag) but **not exercised by a test** |
| 11 | Hospital and doctor verification | **PASS** | Acceptance I 8/8; database tests (pending/unapproved hospitals and unverified or unlinked doctors get no access) |
| 12 | All patient pages | **PARTIAL** | Pages exercised by the suites above with no page errors; a systematic every-button audit of every connected-mode page was **not** run in Part 8 |
| 13 | Two devices on a deployment | **NOT TESTED** | No deployment or second machine available. Follow `docs/BACKEND_SETUP.md`, section 7 |
| 14 | Regression | **PASS** | Production build; 116 unit/database/API/AI tests; local mode 103/103 (Judge Demo 56, flow 18, workflows 29); acceptance A–J 51/51 |

### What you still need to supply

Your Supabase project with all three migrations; `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY`; Site URL and Redirect URLs for auth; the first administrator (`select public.bootstrap_authority('…');`); `ANTHROPIC_API_KEY` as a Supabase secret plus `supabase functions deploy ai-assistant`; a hosting service for the built app with the two `VITE_` variables set. No deployment URL exists yet: **deployment was not performed**.

### Remaining limitations

- Analysis runs in the patient's browser; a modified client could submit false results for its own sessions.
- Reminders are persisted schedules shown in the app; there are no push, SMS or email notifications.
- Medication interaction checking is not available; the assistant says so and refers users to a clinician or pharmacist.
- Not verified: Realtime WebSockets, auth emails, a real model, AI provider-error handling under test, two physical devices, a deployed URL.


## 11. Part 9: verified backend status, authority sign-in, floating AI assistant

**Starting point:** the workspace matched the Part 8 package exactly (checked file by file).

**Code changes**
- `supabase/migrations/0004_breatheguard_health.sql` (new): `bg_health()`, callable anonymously, returns only yes/no flags (schema version, missing tables, tables without row-level security, missing functions, real-time tables, whether an authority exists). Also asks the API layer to reload its schema cache.
- `src/backend/status.js` (new): verifies the auth service, the key, the schema and the security rules, and returns **Configuration required / Connection error / Database setup incomplete / Connected and verified**, each with exact next steps. Local demo mode stays a separate, explicit choice.
- `src/backend/config.js` (rewritten): build-time `VITE_` values **or** a runtime `breatheguard-config.json` next to `index.html` (no rebuild). Refuses a service-role key. `src/main.jsx` loads it before rendering. `public/breatheguard-config.example.json` added.
- `src/cloud/CloudContext.jsx`, `src/cloud/CloudLogin.jsx`: the real backend check; a **Healthcare authority** sign-in tab that verifies the role before showing any dashboard and refuses other accounts; never falls back to demo mode.
- `src/components/FloatingAssistant.jsx` (new) + styles: one shared “BreatheGuard AI” button and panel, mounted once in each patient layout (`src/cloud/CloudApp.jsx`, `src/App.jsx`). Real answers only through the server function; optional saved-session context; loading, error and Retry; Escape closes and returns focus; responsive. In local demo mode it explains why AI is unavailable and sends nothing anywhere.
- `src/pages/Login.jsx`: demo authority labelled “(demo)”, “not real approvals”.
- Tests: `tests/status.test.js` (new), health-check test in `tests/db/part8.test.js`, provider-failure test in `tests/db/ai.integration.test.js`, `scripts/e2e_part9.py` (new). Test-only: auth health endpoint in `supabase/tests/proxy.mjs`; failure switch in `supabase/tests/fake_ai_provider.mjs`.

**Why your login said “Not configured”:** the app only knew whether the two `VITE_` values were present in the build, and they weren't. On a static host, Vite reads them when it **builds**; set them in the host *before* building (or use the runtime file). The screen now checks the backend for real and tells you which of the four states applies.

### Mandatory acceptance tests (run on the final build)

Preliminary testing used separate browser contexts (no shared storage) against a shared backend: real PostgreSQL 16 with migrations 0001–0004, real PostgREST 12.2.3, and the real Edge Function under Deno. **Test stand-ins:** Supabase Auth (signed tokens, no email) and the AI provider (marked replies, no real model). **Not available:** Supabase Realtime, a real model, a deployment, two physical laptops.

| # | Test | Result | Evidence |
|---|---|---|---|
| 1 | Patient and hospital authentication | **PASS** | Acceptance A 9/9; Part 8 [1] |
| 2 | Authority authentication and protected access | **PASS** | Part 9: patient refused at the authority sign-in and stays on the login screen; provisioned authority reaches only the authority dashboard. Database tests: no self-promotion; only authorities decide |
| 3 | Backend connectivity and missing configuration | **PASS** | Part 9 7/7: four builds show Configuration required / Cannot reach the backend / Database setup incomplete / Connected and verified; runtime file works without a rebuild; 8 unit tests incl. service-role refusal and timeout |
| 4 | Session persistence across refresh and login | **PASS** (separate browser sessions) | Acceptance B 2/2 |
| 5 | Alert from patient to hospital without refresh | **PASS via polling fallback** | Part 8 [3] 4/4, acceptance D 6/6. **Supabase Realtime WebSocket: NOT TESTED** |
| 6 | Movement artefact and sensor failure | **PASS** | Live sensor-disable 5/5 (within → insufficient, never normal); acceptance E; engine unit tests |
| 7 | Messages to the correct doctor | **PASS** (separate browser sessions) | Part 8 [6] 5/5 |
| 8 | Connection request, acceptance, rejection | **PASS** | Part 8 [7] 8/8 (intended doctor only) |
| 9 | Consent and access enforced by the backend | **PASS** | 126 unit/database/API/AI tests incl. sabotage checks; acceptance F 3/3 |
| 10 | Real PDF generation and download | **PASS** | Acceptance G 13/13 (text extracted from the downloaded PDF) |
| 11 | Real AI provider response from the floating assistant | **NOT TESTED** with a real model (no API key available). The full server path is **PASS** against a stand-in: answers through the server function, named model, safety rules sent, saved-session context without name or email |
| 12 | AI with missing credentials or a provider failure | **PASS** | Missing key: function returns a setup message (integration test). Provider 503: honest error with Retry, nothing fabricated or saved (integration + browser). Demo mode: explained, nothing sent |
| 13 | Every patient route and primary actions | **PASS** for presence and the actions exercised | Floating assistant on all 11 connected and 8 local patient pages; suites exercise monitoring, directory, connections, messages, alerts, appointments, reports, medicines, consent, reviews, profile. No exhaustive every-button audit was run |
| 14 | Hospital and authority workflows | **PASS** | Acceptance I 8/8; Part 8 [7]; Part 9 authority sign-in; database tests for decisions, reasons, audit, suspension |
| 15 | Production build and regression | **PASS** | Builds succeed; 126/126 tests; browser suites: Part 9 22/22, acceptance 51/51, Part 8 28/28, sensor 5/5, local mode 103/103 (Judge Demo 56, flow 18, workflows 29); no page errors |
| — | Two physical laptops on a deployed URL | **NOT TESTED** | No deployment exists. `docs/BACKEND_SETUP.md`, section 7 |

### What you still need to provide

1. A Supabase project with migrations **0001–0004** run in order.
2. `VITE_SUPABASE_URL` + `VITE_SUPABASE_ANON_KEY` set in your host **before** building (or `breatheguard-config.json` beside `index.html`).
3. Auth Site URL and Redirect URLs set to your deployed address; ideally your own SMTP.
4. The first authority: register in the app, then `select public.bootstrap_authority('email');` in the SQL editor.
5. `supabase secrets set ANTHROPIC_API_KEY=…` and `supabase functions deploy ai-assistant` (optionally `AI_MODEL`, `AI_RATE_LIMIT`).
6. A deployment, then the two-laptop test.

### Remaining limitations

Analysis runs in the patient's browser (a modified client could submit false results for its own sessions). Notifications are in-app only. Medication interactions are not checked. Not verified here: Realtime WebSockets, auth emails, a real AI model, a deployed URL, two physical laptops.

## 12. Login page: Patient | Hospital | Healthcare authority side by side

- **Connected mode card:** a “Sign in as” row with three tiles. *Patient* and *Hospital* offer sign-in, account creation (pre-selecting the matching account type) and password reset. *Healthcare authority* switches to the authority-only sign-in, hides self-registration, and refuses accounts without the authority role before any dashboard appears.
- **Local demo card:** the same three roles as tiles (Patient · Hospital (approved) · Healthcare authority (demo)); the pending hospital remains as a small link. Demo authority decisions are labelled as not real approvals.
- Files: `src/pages/Login.jsx`, `src/cloud/CloudLogin.jsx`, `src/styles.css`; test `scripts/e2e_login_roles.py`.
- Tests run: role tiles 9/9 (tiles measured on one row at 1366 px and 390 px in both cards; each demo tile opens its own portal); Part 9 22/22; acceptance A–J 51/51; local mode 103/103 (Judge Demo 56, flow 18, workflows 29); no page errors. `scripts/e2e_part9.py` was updated to choose the Patient tile after the authority attempt, as a user would.


## 13. Sharing with the healthcare authority, guided setup, AI key

- **Authority access to patient records is patient-granted.** Migration `0005_breatheguard_authority_access.sql` adds `authority_access`. While a patient shares, authority administrators can *view* that patient's sessions, results, alerts and reports (**Shared patient records**); they cannot acknowledge or resolve alerts or change data. Revoking ends access immediately; both changes are audited. Silent access to every patient's records was deliberately not built.
- **One-paste database setup:** `supabase/setup_all.sql` (migrations 0001–0005), tested on a brand-new database.
- **`npm run setup`:** verifies the backend, writes `.env` (public values only, with a backup), and can create the first authority from the terminal with a service-role key that is used once and never saved.
- **AI key:** cannot be created for you; it must come from your own Anthropic account. Exact steps: `docs/BACKEND_SETUP.md`, section 6.
- **Bug fixed:** the records lists (hospital, doctor, authority) only refreshed on new-session events, so a newly shared or revoked patient did not appear until a reload. They now also re-check every 10 seconds.
- **Tests run:** database 1 new test (authority access only while shared; read-only; other patients private; revocation; audit); setup script (authority created; service-role key refused as the public key; missing or wrong service key refused; unreachable URL leaves `.env` unchanged; the service key never written); browser sharing scenario 12/12 (patient → hospital and authority, read-only view, PDF download, audit, revocation without refresh, hospital consent unaffected).

## 14. Sign-in by role and the BreatheGuard look and feel

- **Email sign-in card (local demo mode):** Patient | Hospital | Healthcare authority tiles. Each tile shows only its own options (Patient: sign in, new patient; Hospital: sign in, register hospital; Healthcare authority: sign in only) and its demo sign-in. Signing in with the wrong kind of account is refused with a message naming the right tile. The connected-mode card already had the same three tiles.
- **Palette:** deep night-blue (`#0a2540`) to oxygen teal (`#2ec5d3`) gradients for the login hero, sidebar, hero banners and simulator console; a soft “air” blue page background; teal focus glows. Text colours keep readable contrast.
- **Interaction:** an animated breathing visual on the login hero (rings and waveform at about 12 breaths a minute, with a “Breathe in… breathe out” caption); hover lift on tiles; button press feedback; smooth focus, nav and page transitions. All motion stops when the device asks for reduced motion.
- **Bug fixed:** on hosts that answer a missing file with the app's own page (Netlify, Vercel and similar), the login screen wrongly said “breatheguard-config.json exists but is not valid JSON”. Such responses are now treated as “no file”, and errors are cleared on each check.
- Files: `src/pages/Login.jsx`, `src/data/store.jsx`, `src/components/BreathingVisual.jsx` (new), `src/backend/config.js`, `src/styles.css`; tests `scripts/e2e_local_roles.py` (new), `tests/status.test.js`, `scripts/e2e_workflows.py` (chooses the Hospital tile before registering).
- **Tests run:** role sign-in 9/9; status unit tests 9/9; workflows 29/29; flow 18/18; Judge Demo 56/56; login role tiles 9/9; Part 9 22/22; sharing 12/12; acceptance A–J 51/51; no page errors.

## 15. AI provider: Groq support (final part)

- **Your chatbot project was not available** in this workspace (only a screenshot was uploaded), so **none of its code has been reused yet**. Import instructions: `docs/BACKEND_SETUP.md`, section 6, “Bringing in your existing chatbot”.
- **Your key** begins with `gsk_` (Groq format). It was **not** used, stored or written anywhere: this environment has no network access to Groq, and secrets do not belong in code. Because it was pasted into a chat, treat it as exposed: create a new key and set only the new one as a server secret.
- **Implemented:** `supabase/functions/ai-assistant/providers.js` (new) with Groq (OpenAI-compatible chat completions, Bearer key) and Anthropic adapters selected by `AI_PROVIDER`; key-format checks; clear, safe errors for invalid keys, rate limits, unavailable models, outages and network failures (provider responses are never echoed, keys never returned or logged). `index.ts` now uses the adapter and reports which provider answered. Setup script and guide updated.
- **Tests run:** adapter unit tests (5); the real function in Groq mode against a stand-in speaking Groq's format (answer through the server path, Bearer key sent but never logged, four failure types, cross-patient refusal before any provider call); full suite 136/136; acceptance A–J 51/51 including the assistant through the real screens; no page errors.
- **NOT TESTED:** a genuine Groq (or Anthropic) model response. That needs your key, set as a Supabase secret, on your own deployment.


## 16. Java chatbot integration, diaphragm placement and 3D breathing view

**Chatbot (`java-ai-chatbot.zip`):** inspected; it contained no keys. A Java Swing desktop app cannot run in a web page, so its logic was **ported** into the server function:
- `supabase/functions/ai-assistant/chatbot.js` (new): `TextPreprocessor` (normalisation, limits), `RuleBasedResponder` (instant small-talk on exact match, rebranded as BreatheGuard AI and labelled “Instant reply (not AI)”), `ConversationManager.buildContext` (last N turns, starting with a user turn).
- `providers.js`: the Java `AIConfig` provider list (Groq default, Gemini, OpenAI, Anthropic, custom), generic `AI_API_KEY`, `AI_MAX_HISTORY` / `AI_MAX_TOKENS` / `AI_TIMEOUT_SECONDS`, https-only custom endpoints.
- `index.ts`: order is validate → sign-in → provider configured → instant reply → rate limit → provider call (with timeout). One deliberate difference from the Java app: without a key, BreatheGuard says “not configured” instead of giving canned replies.
- Not reused: the Swing UI (`ui/`), the random choice among canned replies (BreatheGuard uses one fixed reply per phrase).

**Patch position:** moved from the chest to the lower ribcage over the diaphragm, in the 3D view and the 2D fallback diagram.

**3D breathing view** (`src/components/Body3D.jsx`, three.js 0.186.1): a stylised anatomical torso with female or male proportions; transparent “see inside” view with lungs filling and the diaphragm dome moving down on inhale; the Care or Quick patch over the diaphragm; drag to rotate; inhale/exhale indicator; follows the session's simulated rate in the connected live monitor; pauses for reduced-motion users; 2D fallback without WebGL. It is an illustration, not a photorealistic model or a medical image.

**Male / female:** the patient chooses their body model at registration (both modes) and can change it on the 3D view. It is **not inferred from the name**: names do not reliably indicate sex, and guessing would show the wrong body to some patients. Migration `0006_breatheguard_body_model.sql` adds `profiles.body_model` and copies the sign-up choice.

**Tests run:** chatbot port unit tests (4); Groq-mode function tests including instant replies and the provider timeout (5); body-model database tests (2); 3D view in a real browser (renders, animates, both breathing phases, accessible description, Male choice saved); full regression (see below).

**Bugs found and fixed during testing (this part):**
- **Breathing ran slower than the stated rate on slow devices.** The animation clock advanced at most 0.05 s per frame; it now keeps real time.
- **Continuous 3D rendering slowed the live recorder** (recording checks missed their timing in a software-rendered browser). The 3D view now renders only when on screen and visible, at about 30 fps.
- **Two “Pause” buttons on the live monitor** (recording vs animation) were ambiguous for users and screen readers. The 3D control is now “Pause animation” / “Play animation”.
- Test scripts were updated for the new “Account type” and “Body model” dropdowns; one wrongly rewritten line (the AI page's session picker) was restored.

**Final results (all on the final build, no page errors):** unit, database, API and AI tests 142/142 plus body-model 2/2; acceptance A–J 51/51; Part 8 28/28; Part 9 22/22; sharing 12/12; live sensor failure 5/5; Judge Demo 56/56; role sign-in 9/9; login tiles 9/9; workflows 29/29; original flow 18/18. **NOT TESTED:** a genuine Groq reply (needs your new key on your backend) and two physical laptops on a deployment.
