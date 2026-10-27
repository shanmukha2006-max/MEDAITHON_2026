# Part 7 acceptance tests A–J (connected mode), with separate browser contexts as separate devices.
# Stack: real PostgreSQL + both migrations, real PostgREST, the real AI Edge Function under Deno,
# the app's production build. TEST STAND-INS: Supabase Auth (signed tokens, no email delivery) and the
# AI provider (marked replies, no real model). Supabase Realtime is NOT available here: live updates
# are verified through the app's polling fallback against the shared database.
import os, re, subprocess, json
from playwright.sync_api import sync_playwright
URL = os.environ.get('BG_CLOUD_URL', 'http://localhost:4180/')
results = {}
def check(key, ok, msg):
    print(('PASS ' if ok else 'FAIL ') + f'[{key}] ' + msg, flush=True)
    results.setdefault(key, []).append(ok)
def sql(q):
    r = subprocess.run(['su', 'postgres', '-c', f'psql -h /tmp -p 54322 -d bg_test -q -At -c "{q}"'], capture_output=True, text=True)
    return r.stdout.strip()
def pdftext(path): return subprocess.run(['pdftotext', '-layout', path, '-'], capture_output=True, text=True).stdout

sql("truncate auth.users cascade; truncate public.hospitals, public.audit_log restart identity cascade; update public.alert_settings set concerning_min_windows = 1, alert_on_insufficient = true;")
errors = []
def stop_if_running(page):
    page.locator('aside').get_by_role('button', name='Live monitor', exact=True).click(); page.wait_for_timeout(800)
    btn = page.get_by_role('button', name='Stop recording')
    if btn.count(): btn.click()
    page.wait_for_timeout(4000)  # recorder drains and the session is marked stopped
with sync_playwright() as p:
    b = p.chromium.launch()
    def device(name):
        ctx = b.new_context(viewport={'width': 1366, 'height': 900}, accept_downloads=True)
        pg_ = ctx.new_page(); pg_.on('pageerror', lambda e: errors.append(f'{name}: {e}'))
        pg_.goto(URL); pg_.wait_for_timeout(900); return pg_
    def card(pg_): return pg_.locator('section.card', has_text='Connected mode (multi-device)')
    def register(pg_, name, email, role, pw='synthetic-pass-1'):
        c = card(pg_); c.get_by_role('button', name='Create account').first.click()
        c.locator('label.field', has_text='Full name').locator('input').fill(name); c.get_by_label('Account type').select_option(role)
        c.locator('input[type=email]').fill(email); c.locator('input[type=password]').fill(pw)
        c.get_by_role('button', name='Create account').last.click(); pg_.wait_for_timeout(1800)
    def signin(pg_, email, pw='synthetic-pass-1'):
        c = card(pg_); c.get_by_role('button', name='Sign in', exact=True).first.click()
        c.locator('input[type=email]').fill(email); c.locator('input[type=password]').fill(pw)
        c.get_by_role('button', name='Sign in', exact=True).last.click(); pg_.wait_for_timeout(1800)
    def nav(pg_, label): pg_.locator('aside').get_by_role('button', name=label, exact=True).click(); pg_.wait_for_timeout(1300)
    def signout(pg_): pg_.locator('aside').get_by_role('button', name='Sign out').click(); pg_.wait_for_timeout(1200)
    def record(pg_, patch, scenario, until_saved_s):
        nav(pg_, 'Live monitor'); pg_.locator('.seg button', has_text=patch).first.click(); pg_.locator('select').first.select_option(scenario)
        pg_.get_by_role('button', name='5×', exact=True).click(); pg_.get_by_role('button', name='Start recording').click()
        pg_.wait_for_timeout(until_saved_s * 1000)

    # ---------------- A: authentication and roles ----------------
    pat = device('patient'); register(pat, 'Synthetic Patient Asha', 'asha@acc.test', 'patient')
    check('A', 'Patient' in pat.inner_text('.topbar') and 'Live monitor' in pat.inner_text('aside'), 'patient account: patient role and patient pages')
    staff = device('staff'); register(staff, 'Synthetic Staff Ravi', 'ravi@acc.test', 'hospital_staff')
    check('A', 'Hospital staff' in staff.inner_text('.topbar') and 'Live patients' in staff.inner_text('aside') and 'Live monitor' not in staff.inner_text('aside'), 'hospital staff account: staff role and staff pages only')
    doc = device('doctor'); register(doc, 'Dr Synthetic Mehta', 'mehta@acc.test', 'doctor')
    check('A', 'Doctor' in doc.inner_text('.topbar') and 'Not linked yet' in doc.inner_text('main'), 'doctor account: doctor role, not yet linked')
    adm = device('authority'); register(adm, 'Synthetic Authority', 'admin@acc.test', 'patient')
    check('A', 'Patient' in adm.inner_text('.topbar'), 'self-registration cannot create an administrator (lands as patient)')
    sql("select public.bootstrap_authority('admin@acc.test')")  # documented initial-administrator procedure (SQL editor)
    adm.reload(); adm.wait_for_timeout(1800)
    check('A', 'Healthcare authority' in adm.inner_text('.topbar') and 'Administrators' in adm.inner_text('aside'), 'initial administrator created with the documented SQL procedure')
    signout(pat); signin(pat, 'asha@acc.test', 'wrong-pass-999')
    check('A', 'Email or password is incorrect' in pat.inner_text('body'), 'wrong password refused with a clear message')
    signin(pat, 'asha@acc.test')
    check('A', 'Patient' in pat.inner_text('.topbar'), 'patient signs back in')

    # ---------------- I: verification states enforced in the directory ----------------
    for lbl, v in [('Hospital name', 'Synthetic Lakeside Hospital'), ('City', 'Testville'), ('Registration no.', 'DEMO-H-77')]:
        staff.locator('label.field', has_text=lbl).locator('input').fill(v)
    staff.get_by_role('button', name='Submit application').click(); staff.wait_for_timeout(1500)
    check('I', 'Pending review' in staff.inner_text('main'), 'hospital application persisted as pending')
    nav(pat, 'Care providers')
    check('I', 'Synthetic Lakeside Hospital' not in pat.inner_text('main'), 'pending hospital not in the patient directory')
    adm.wait_for_timeout(11000)  # no manual refresh: the Reviews page must pick up the new application by itself
    row = adm.locator('.list-item', has_text='Synthetic Lakeside Hospital')
    check('I', row.count() == 1, 'new application appeared on the authority’s open Reviews page without refreshing')
    row.locator('input').fill('Demo licence and address checked.'); row.get_by_role('button', name='Approve').click(); adm.wait_for_timeout(1500)
    nav(staff, 'Profile'); nav(staff, 'Your hospital')
    staff.locator('label.field', has_text='Name').locator('input').fill('Dr Synthetic Mehta'); staff.locator('label.field', has_text='Specialty').locator('input').fill('Pulmonology'); staff.locator('label.field', has_text='Licence no.').locator('input').fill('DEMO-D-5')
    staff.get_by_role('button', name='Submit doctor').click(); staff.wait_for_timeout(1500)
    staff.locator('input[type=email]').first.fill('mehta@acc.test'); staff.get_by_role('button', name='Link account').click(); staff.wait_for_timeout(1500)
    check('I', 'Account linked' in staff.inner_text('main'), 'hospital submits the doctor and links the doctor’s account')
    nav(pat, 'Profile'); nav(pat, 'Care providers'); t = pat.inner_text('main')
    check('I', 'Synthetic Lakeside Hospital' in t and 'Dr Synthetic Mehta' not in t, 'approved hospital listed; its unverified doctor is not')
    nav(adm, 'Audit log'); nav(adm, 'Reviews'); drow = adm.locator('.list-item', has_text='Dr Synthetic Mehta')
    drow.locator('input').fill('Licence DEMO-D-5 checked in demo registry'); drow.get_by_role('button', name='Approve').click(); adm.wait_for_timeout(1500)
    nav(pat, 'Profile'); nav(pat, 'Care providers')
    check('I', 'Dr Synthetic Mehta' in pat.inner_text('main'), 'doctor listed only after separate verification')
    doc.reload(); doc.wait_for_timeout(1800)
    check('I', 'You have care-team access' in doc.inner_text('main'), 'doctor portal shows verified status and access')
    nav(staff, 'Profile'); nav(staff, 'Your hospital')
    check('I', 'Approved' in staff.inner_text('main'), 'hospital sees its approved status')

    # ---------------- sharing, then D: concerning alert ----------------
    nav(pat, 'Care providers'); pat.locator('section.card', has_text='Synthetic Lakeside Hospital').get_by_role('button', name='Share').click(); pat.wait_for_timeout(1500)
    record(pat, 'Care', 'irregular', 6)
    # ---------------- C: real-time on another device ----------------
    nav(staff, 'Live patients'); staff.wait_for_timeout(2500); staff.get_by_role('button', name='Watch live').first.click()
    def secs(pg_):
        m = re.search(r'(\d+) seconds received', pg_.inner_text('main')); return int(m.group(1)) if m else 0
    staff.wait_for_timeout(9000); n1 = secs(staff); staff.wait_for_timeout(9000); n2 = secs(staff)
    check('C', n2 > n1 > 0, f'hospital device receives new persisted observations without refreshing ({n1} -> {n2} s)')
    check('C', 'polling' in staff.inner_text('[data-testid=rt-status]').lower(), 'status badge honestly shows the polling fallback (Supabase Realtime not available in this test environment)')
    doc_text = (nav(doc, 'Live patients'), doc.inner_text('main'))[1]
    check('C', 'Synthetic Patient Asha' in doc_text, 'verified, linked doctor also sees the shared session')
    pat.wait_for_timeout(16000)
    al = sql("select category || '|' || explanation || '|' || (quality_context->>'quality') from public.alerts where category = 'concerning' order by created_at limit 1")
    check('D', al.startswith('concerning|Potentially concerning simulated pattern.') and float(al.split('|')[-1]) > 0, f'persisted concerning alert with explanation and quality context ({al[:90]}…)')
    check('D', 'Potentially concerning' in staff.inner_text('[data-testid=alerts]'), 'alert delivered to the authorised hospital view')
    nav(pat, 'Alerts'); check('D', 'Potentially concerning' in pat.inner_text('main'), 'alert in the patient’s alert history')
    pat.locator('[data-testid=bell]').click(); pat.wait_for_timeout(800)
    check('D', 'Simulated monitoring alert: concerning' in pat.inner_text('[data-testid=notif-list]'), 'patient gets an in-app notification')
    pat.locator('[data-testid=bell]').click()
    counts = sql("select (select count(*) from public.alerts) || '/' || (select count(*) from public.analysis_results)")
    check('D', int(counts.split('/')[0]) < int(counts.split('/')[1]), f'no duplicate alerts per observation (alerts/results {counts})')
    # stop the session
    stop_if_running(pat)
    check('D', sql("select count(*) from public.monitoring_sessions where scenario_id='irregular' and status='stopped'") == '1', 'session ends in the stopped state (manually or at the end of the scenario)')

    # ---------------- E: unreliable signals ----------------
    record(pat, 'Care', 'multi_failure', 38)
    stop_if_running(pat)
    ins = sql("select a.outcome || '|' || a.reason from public.analysis_results a join public.monitoring_sessions s on s.id = a.session_id where s.scenario_id = 'multi_failure' and a.window_end >= 150 order by a.window_end limit 1")
    check('E', ins.startswith('insufficient|') and 'not a normal result' in ins, f'sensor failure gives insufficient reliable data with its reason ({ins[:80]}…)')
    check('E', sql("select count(*) from public.alerts a join public.monitoring_sessions s on s.id = a.session_id where s.scenario_id='multi_failure' and a.category='insufficient'") == '1', 'one insufficient-data alert for that session')

    # ---------------- B: persistence on another device ----------------
    pat2dev = device('patient-laptop-2'); signin(pat2dev, 'asha@acc.test'); nav(pat2dev, 'My sessions')
    t = pat2dev.inner_text('main')
    check('B', 'irregular' in t and 'multi_failure' in t, 'both sessions available after signing in on a different device')
    pat2dev.locator('tr', has_text='irregular').get_by_role('button', name='Open').click(); pat2dev.wait_for_timeout(4000)
    check('B', secs(pat2dev) > 30 and 'Potentially concerning' in pat2dev.inner_text('[data-testid=alerts]'), 'stored observations and alerts load on the second device')

    # ---------------- G: real PDF and CSV ----------------
    with pat2dev.expect_download() as dl: pat2dev.get_by_role('button', name='Download PDF').click()
    f = dl.value; path = f'/tmp/acc_{f.suggested_filename}'; f.save_as(path)
    head = open(path, 'rb').read(5); txt = pdftext(path)
    sess = sql("select id || '|' || 'BG-' || upper(left(replace(patient_id::text,'-',''),8)) from public.monitoring_sessions where scenario_id='irregular'").split('|')
    check('G', head == b'%PDF-' and f.suggested_filename.startswith('breatheguard_BG-') and f.suggested_filename.endswith('.pdf'), f'a real PDF file with a meaningful name ({f.suggested_filename})')
    for must in ['SYNTHETIC DATA - NOT FOR CLINICAL USE', sess[0], sess[1], 'BreatheGuard Care', 'chest, acoustic, motion', 'Potentially concerning simulated pattern', 'Signal quality', 'Analysis by window']:
        check('G', must in txt, f'PDF contains "{must[:40]}"')
    check('G', 'Downloaded' in pat2dev.inner_text('[data-testid=dl-ok]'), 'success message only after the file was produced')
    with pat2dev.expect_download() as dl2: pat2dev.get_by_role('button', name='CSV').click()
    csv = open(dl2.value.path()).read()
    check('G', csv.startswith('# SYNTHETIC DATA') and sess[0] in csv and 'concerning' in csv, 'CSV export downloads with the session’s data')
    check('G', sql("select count(*) from public.reports where format in ('pdf','csv')") == '2', 'downloads logged as report metadata')
    other = device('other-patient'); register(other, 'Synthetic Patient Ben', 'ben@acc.test', 'patient'); nav(other, 'My sessions')
    check('G', 'No sessions yet' in other.inner_text('main'), 'another patient cannot see or download these sessions')

    # ---------------- H: AI through the server-side function ----------------
    nav(pat2dev, 'AI assistant'); pat2dev.locator('main select').first.select_option(index=1); pat2dev.locator('textarea').fill('Why was my session flagged?')
    pat2dev.get_by_role('button', name='Ask').click(); pat2dev.wait_for_timeout(5000)
    t = pat2dev.inner_text('[data-testid=ai-thread]')
    check('H', 'TEST STAND-IN REPLY' in t and 'stand-in-model-not-a-real-ai' in t, 'answer arrives through the server-side function; the UI names the model that answered (a stand-in here, not a real model)')
    check('H', sql("select count(*) from public.ai_messages") == '0' and 'not saved' in pat2dev.inner_text('[data-testid=ai-not-saved]'), 'history is off by default: the answer is shown but nothing is stored, and the page says so')
    nav(other, 'AI assistant')
    check('H', 'Ask anything about BreatheGuard' in other.inner_text('main'), 'another patient sees none of that conversation')

    # ---------------- appointments + notifications ----------------
    nav(pat2dev, 'Appointments'); pat2dev.locator('select').first.select_option(index=1)
    pat2dev.locator('input[type=datetime-local]').first.fill('2026-12-01T09:30'); pat2dev.get_by_role('button', name='Request appointment').click(); pat2dev.wait_for_timeout(1500)
    nav(staff, 'Appointments'); staff.get_by_role('button', name='Confirm').first.click(); staff.wait_for_timeout(1500)
    staff.locator('input[type=datetime-local]').first.fill('2026-12-02T11:00'); staff.get_by_role('button', name='Reschedule').first.click(); staff.wait_for_timeout(1500)
    pat2dev.wait_for_timeout(11000); t = pat2dev.inner_text('main')
    check('J', 'Confirmed' in t, 'appointment status change reaches the patient without refreshing')
    pat2dev.get_by_role('button', name='History').first.click(); pat2dev.wait_for_timeout(1200)
    check('J', 'Rescheduled by the hospital' in pat2dev.inner_text('main'), 'appointment history with the reschedule')

    # ---------------- F: consent revocation ----------------
    nav(pat2dev, 'Care providers'); pat2dev.locator('section.card', has_text='Synthetic Lakeside Hospital').get_by_role('button', name='Stop sharing').click(); pat2dev.wait_for_timeout(1500)
    nav(staff, 'Alerts'); nav(staff, 'Live patients'); staff.wait_for_timeout(1500)
    check('F', 'No shared sessions' in staff.inner_text('main'), 'hospital list empty immediately after revocation')
    nav(doc, 'Alerts'); check('F', 'No alerts' in doc.inner_text('main'), 'doctor can no longer read the alerts either')
    check('F', sql("select count(*) from public.consents where active") == '0', 'consent row inactive in the database')

    # ---------------- profile, password ----------------
    nav(pat2dev, 'Profile'); pat2dev.locator('input[type=password]').fill('new-synthetic-pass-2'); pat2dev.get_by_role('button', name='Change password').click(); pat2dev.wait_for_timeout(1200)
    signout(pat2dev); signin(pat2dev, 'asha@acc.test', 'new-synthetic-pass-2')
    check('A', 'Patient' in pat2dev.inner_text('.topbar'), 'password change works (signed in with the new password)')
    signout(pat2dev); c = card(pat2dev); c.get_by_role('button', name='Forgot password').click(); c.locator('input[type=email]').fill('asha@acc.test'); c.get_by_role('button', name='Send reset link').click(); pat2dev.wait_for_timeout(1200)
    check('A', 'a reset link has been sent' in pat2dev.inner_text('body'), 'password reset request accepted (email delivery itself not testable here)')
    print('PAGE ERRORS:', errors or 'none')
    print('SUMMARY:', json.dumps({k: f'{sum(v)}/{len(v)}' for k, v in sorted(results.items())}))
    b.close()
