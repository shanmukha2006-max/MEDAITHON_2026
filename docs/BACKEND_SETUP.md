# Connected mode: backend setup (Supabase)

BreatheGuard runs in two modes:

| Mode | When | Data | Accounts |
|---|---|---|---|
| **Local demo mode** | No backend settings (default) | This browser only (`localStorage`) | Demo accounts, not secure |
| **Connected mode** | `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY` set | Shared Supabase database | Real sign-up and sign-in |

The Judge Demo and all Part 1–5 features keep working in local demo mode, whether or not a backend is configured. Connected mode adds real accounts, shared persistent monitoring data across laptops, live hospital updates, database-generated alerts, backend-enforced consent, protected reports and an AI assistant integration point.

All monitoring data in both modes is **synthetic**. Connected mode is not a medical device and not clinically validated.

## What you need

- A free Supabase account: https://supabase.com
- Node.js 18+ (already needed for the app)
- Optional, for the AI assistant: the Supabase CLI and an Anthropic API key

## 1. Create the project

1. In Supabase, click **New project**. Pick a name (for example `breatheguard-demo`), a database password, and the region closest to you. Wait for it to finish.
2. **Authentication → Providers → Email:** keep Email enabled. For a hackathon demo you can turn **Confirm email** off so new accounts can sign in immediately. With it on, users must click the link in their email first.
3. **Authentication → URL Configuration:** set **Site URL** to your deployed app address (for local use, `http://localhost:5173`) and add both addresses under **Redirect URLs**. Password-reset emails link back here; the app then shows a “Set a new password” form.
4. Supabase’s built-in email sender is rate-limited and meant for testing. For real use, configure your own SMTP under **Authentication → Emails → SMTP settings**.

## 2. Create the database (one paste)

1. Open **SQL Editor → New query**.
2. Paste the whole of **`supabase/setup_all.sql`** and click **Run**. It contains all migrations (0001–0006) in order and is safe to run again.
3. It should finish with “Success”.

(The individual files are in `supabase/migrations/` if you prefer to run them one by one, in number order.)

This creates 23 tables with row-level security on every one, the decision functions, triggers, the real-time publication and the health check the login screen uses.

## 3. Connect the app

**Fastest:** run `npm run setup` in the project folder. It asks for the two values, refuses a service-role key, checks the backend for real (same check as the login screen), and writes `.env` (backing up any existing one). Non-interactive: `npm run setup -- --url https://xxxx.supabase.co --anon-key eyJ... --yes`.

Or by hand:

1. In Supabase: **Project Settings → API**. Copy the **Project URL** and the **anon public** key. Never use the `service_role` key in the app: the app refuses it if you try.
2. Give the app those two values, in **one** of two ways:
   - **Build-time (recommended):** copy `.env.example` to `.env` and fill in `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY`. On a hosting service, add the same two variables in its dashboard **before** it builds, then trigger a new build. Vite reads them during `npm run build`: adding them after the build, or naming them without the `VITE_` prefix, has no effect. This is the most common reason for “Configuration required”.
   - **Runtime (no rebuild):** copy `public/breatheguard-config.example.json` to `breatheguard-config.json` **next to the deployed `index.html`** and fill in `supabaseUrl` and `supabaseAnonKey`. Build-time values win if both exist.
3. Restart (`npm run dev`) or redeploy, and open the login screen. The connected-mode card checks the backend for real and shows one of:

| Status | Meaning | What to do |
|---|---|---|
| **Connected and verified** | Auth service, database schema (v4), security rules and functions checked | Sign in. Warnings may mention real-time tables or a missing authority account |
| **Configuration required** | URL or key missing (or a service-role key was supplied) | Step 3.2 |
| **Cannot reach the backend** / **Backend rejected the app key** | Wrong URL, project paused, no internet, or wrong key | Check the URL and anon key; check the project is running |
| **Database setup incomplete** | Connected, but migrations missing, or security switched off on a table | Run (or re-run) migrations 0001–0004 |
| Local demo mode | A separate choice (demo account buttons) | Demo data stays in this browser and is never shared |

Connected mode never falls back to demo mode on its own.

## 4. Create the first administrator (healthcare authority)

Nobody can make themselves an administrator from the app. The project owner creates the first one, in either of two ways:

**A. From your terminal (no SQL):**
1. In the app, register the administrator's email normally (Create account, type **Patient**).
2. In Supabase: **Project Settings → API → service_role** key. Copy it. It is a master key: never put it in the app, `.env`, or any file.
3. In the project folder, in that terminal only:
   ```bash
   SUPABASE_SERVICE_ROLE_KEY=paste-it-here npm run setup -- --url https://xxxx.supabase.co --anon-key eyJ... --yes --authority admin@example.com
   ```
   (Windows PowerShell: `$env:SUPABASE_SERVICE_ROLE_KEY="paste-it-here"; npm run setup -- …`). It is used for that one call and not saved. Close the terminal afterwards.

**B. In the SQL Editor:** run `select public.bootstrap_authority('admin@example.com');`

Then on the login screen choose **Connected mode → Healthcare authority** and sign in. Further administrators are added in the app (**Administrators** page) by an existing administrator, with a reason; the last administrator cannot be removed.

**Doctor accounts:** the doctor registers with account type **Doctor**; their hospital (once approved) submits the doctor's details and links the account by email; the authority verifies the doctor separately.

**Sharing with the authority:** patients choose **Care providers → Healthcare authority → Share with authority**. While it is on, authority administrators can view (not change) that patient's sessions, results, alerts and reports under **Shared patient records**. Patients can stop sharing at any time; every change is audited.

## 5. Check real-time is on

The migration adds the monitoring tables to Supabase’s real-time publication. To confirm: **Database → Publications → supabase_realtime** should list `monitoring_sessions`, `observations`, `analysis_results`, `alerts`, `consents`, plus `notifications`, `appointments`, `care_requests`, `messages` and `prescriptions` (added by `0002` and `0003`). If any are missing, toggle them on under **Database → Replication**.

If real-time is unavailable, the hospital view says **“Live via polling every 3 s (real-time unavailable)”** and keeps updating from the shared database every 3 seconds. When real-time works it says **“Live (real-time)”**.

## 6. AI assistant (your own key: Groq or Anthropic)

The assistant runs in the `ai-assistant` Edge Function, so the key stays on the server. It supports **Groq** (keys start with `gsk_`) and **Anthropic** (keys start with `sk-ant-`), chosen with `AI_PROVIDER`.

**Security first.** A key that has been pasted into a chat, email, screenshot or file should be treated as exposed: create a new one (Groq: https://console.groq.com/keys; Anthropic: https://console.anthropic.com), delete the old one, and give the new one **only** to the command below. Never put it in the app, `.env`, `breatheguard-config.json`, or a repository.

```bash
npm install -g supabase            # or prefix the commands with npx
supabase login
supabase link --project-ref YOUR-PROJECT-REF
# Groq (match AI_MODEL to the model your existing chatbot uses, e.g. llama-3.3-70b-versatile):
supabase secrets set AI_PROVIDER=groq GROQ_API_KEY=your-new-key AI_MODEL=your-model
# or Anthropic:
# supabase secrets set AI_PROVIDER=anthropic ANTHROPIC_API_KEY=your-key AI_MODEL=claude-haiku-5-5
supabase functions deploy ai-assistant
```

Optional: `AI_RATE_LIMIT=20` (questions per patient per hour). Do **not** set `AI_API_URL` in production (it exists only for tests).

**Check it really works:** sign in as a patient in connected mode, open **BreatheGuard AI**, ask a question. A genuine answer names the model that replied (e.g. `llama-3.3-70b-versatile`). If something is wrong the assistant says what, without inventing an answer:

| Message | Fix |
|---|---|
| “not configured … no AI provider key” | Set the secret and redeploy the function |
| “does not look like a Groq key” | The key and `AI_PROVIDER` don't match |
| “rejected the server’s API key” | Key invalid or revoked: create a new one, set it again |
| “rate limit or quota reached” | Wait, or check your provider plan |
| “model … is not available” | Set `AI_MODEL` to a model your account can use |
| “provider is unavailable” / “Could not reach the AI provider” | Provider outage or network problem; retry later |

### Your Java chatbot (ported)

The logic of `java-ai-chatbot` now runs inside the `ai-assistant` function: its provider list and settings (`AIConfig`), input clean-up (`TextPreprocessor`), instant small-talk replies (`RuleBasedResponder`, labelled “Instant reply (not AI)”) and history trimming (`ConversationManager`). The same variable names work:

```bash
supabase secrets set AI_PROVIDER=groq AI_API_KEY=your-NEW-groq-key AI_MODEL=llama-3.3-70b-versatile
# optional, as in the Java chatbot: AI_MAX_HISTORY=20  AI_MAX_TOKENS=1024  AI_TIMEOUT_SECONDS=60
supabase functions deploy ai-assistant
```

Providers: `groq` (default), `gemini`, `openai`, `anthropic`, `custom` (needs `AI_API_URL`, https only). The Swing desktop window (`ui/`) is not used: a desktop window cannot run inside a website, so the BreatheGuard floating assistant is the user interface.

## 6b. Reports

PDF and CSV reports are produced in the browser from data fetched through the database’s permission checks (`session_report`): if the user may not read the session, the request fails and no file is made. Each download is recorded in the `reports` table with its file name, format and size. No Storage bucket is needed.

The function reads session data with the signed-in user’s own permissions, so it can only see what that user could already see.

## 7. Test real-time on two separate devices

Use two laptops (or two different browsers on one laptop, such as Chrome and Firefox; tabs in the same browser share a sign-in).

1. **Device A:** open the app → Connected mode → **Create account** → type **Hospital staff**. On **Your hospital**, submit an application. It shows **Pending review**.
2. **Device C (or A after signing out):** sign in as the authority (step 4) → **Reviews** → enter a reason → **Approve** the hospital.
3. **Device B:** **Create account** → type **Patient** → **Sharing** → **Share** with the approved hospital.
4. **Device B:** **Live monitor** → choose a patch and scenario (for example *Sustained irregular breathing*) → **Start recording**. The save badge should say **All data saved**.
5. **Device A:** sign in as the hospital staff → **Live patients** → **Watch live**. Without refreshing, check:
   - the “seconds received” count rises and the charts move;
   - the status badge says **Live (real-time)**;
   - a result appears after about 30 seconds, and an alert when the result changes;
   - **Acknowledge** marks the alert on both devices.
6. **Connection loss:** on Device B turn Wi-Fi off for 20 seconds. The save badge should show **Connection problem: retrying** with a waiting count. Turn Wi-Fi on: it returns to **All data saved**, and Device A fills the gap without duplicates.
7. **Consent revocation:** on Device B, **Sharing → Stop sharing**. On Device A, the session disappears from **Live patients**, and further updates stop.
8. **Reports:** on either device, open the session → **Download report**. It must say **SYNTHETIC DATA — NOT FOR CLINICAL USE**.

Write down what you see for each step. Steps 5 (real-time badge), 6 and 7, password-reset emails and a real AI model have not been tested against a real Supabase project or provider by us; see `docs/HANDOVER.md`.

### Testing patient–doctor features on two devices

1. Set up a hospital and have the authority approve it (steps 4 and 7 above). Register a **Doctor** account; the hospital links it by email and the authority verifies the doctor.
2. **Patient device:** **Doctors** → find the doctor → **Request connection**. **Doctor device:** **Connections** shows the request without refreshing → **Accept**.
3. **Messages:** send from either side; the other side should show an unread count and the message without refreshing; after a refresh the conversation is still there.
4. **Alerts:** the patient records *Sustained irregular breathing*; the doctor’s **Alerts** page shows the alert live → enter a note → **Resolve**; the patient sees the note.
5. **Prescriptions:** the doctor enters one under **Prescriptions**; the patient sees it under **Medicines**.
6. **Ending:** the patient clicks **End connection**; the doctor immediately loses access to that patient’s sessions and conversation.

## Troubleshooting

| What you see | Likely cause | Fix |
|---|---|---|
| Login screen says “Not configured” | `.env` missing or app not restarted | Step 3, then restart `npm run dev` |
| “Email or password is incorrect” right after registering | Email confirmation is on | Confirm via the email link, or turn **Confirm email** off (step 1) |
| “You do not have permission to do that.” | Expected when a rule blocks the action | Check the account type and that consent and approval are in place |
| “Could not load your profile” after sign-up | Migration not run, or run before the account existed | Run the migration (step 2), then register a new account |
| Hospital view stays on “polling” | Real-time not enabled for the tables | Step 5 |
| “Assistant not set up” | Function not deployed or no key | Step 6 |
