# Part 8 cross-"device" acceptance: separate browser contexts (no shared storage) against the shared
# backend (real PostgreSQL + PostgREST + the real AI Edge Function under Deno). TEST STAND-INS: Supabase Auth
# (signed tokens) and the AI provider (marked replies). Supabase Realtime is not available here: live updates
# arrive through the app's polling fallback against the shared database. Not a two-laptop test.
import os, json, subprocess, urllib.request, time
from playwright.sync_api import sync_playwright
URL = os.environ.get('BG_CLOUD_URL', 'http://localhost:4180/'); API = os.environ.get('BG_TEST_API', 'http://localhost:3011')
res = {}
def check(k, ok, m): print(('PASS ' if ok else 'FAIL ') + f'[{k}] {m}', flush=True); res.setdefault(k, []).append(ok)
import tempfile
def sql(q):
    # run SQL from a file (avoids nested shell quoting); readable by the postgres user
    with tempfile.NamedTemporaryFile('w', suffix='.sql', delete=False, dir='/tmp') as f: f.write(q + '\n')
    os.chmod(f.name, 0o644)
    r = subprocess.run(['su', 'postgres', '-c', f'psql -h /tmp -p 54322 -d bg_test -q -At -v ON_ERROR_STOP=1 -f {f.name}'], capture_output=True, text=True)
    os.unlink(f.name)
    if r.returncode: print('SQL ERROR:', r.stderr.strip()[:300], flush=True)
    return r.stdout.strip()
def as_user(email, stmt):
    uid = sql(f"select id from auth.users where email='{email}'")
    claims = json.dumps({'sub': uid, 'role': 'authenticated'})
    return sql(f"begin; set local role authenticated; select set_config('request.jwt.claims', '{claims}', true) \\g /dev/null\n{stmt}; commit;")
def signup(email, role, name):
    req = urllib.request.Request(f'{API}/auth/v1/signup', data=json.dumps({'email': email, 'password': 'synthetic-pass-1', 'data': {'role': role, 'full_name': name}}).encode(), headers={'Content-Type': 'application/json'})
    urllib.request.urlopen(req).read()

sql("truncate auth.users cascade; truncate public.hospitals, public.audit_log restart identity cascade; update public.alert_settings set concerning_min_windows = 1, alert_on_insufficient = true;")
for e, r, n in [('pat@p8.test', 'patient', 'Synthetic Patient Meera'), ('other@p8.test', 'patient', 'Synthetic Patient Omar'), ('staff@p8.test', 'hospital_staff', 'Synthetic Admin'), ('d1@p8.test', 'doctor', 'Dr Synthetic Rao'), ('d2@p8.test', 'doctor', 'Dr Synthetic Lee'), ('admin@p8.test', 'patient', 'Synthetic Authority')]:
    signup(e, r, n)
sql("select public.bootstrap_authority('admin@p8.test')")
as_user('staff@p8.test', "insert into public.hospitals (name, city, registration_no) values ('Synthetic Harbour Hospital', 'Testville', 'DEMO-H-8')")
H = sql("select id from public.hospitals limit 1")
as_user('admin@p8.test', f"select public.decide_hospital('{H}', 'approved', 'Internal demo review completed.')")
for d, lic, name in [('d1', 'DEMO-D-81', 'Dr Synthetic Rao'), ('d2', 'DEMO-D-82', 'Dr Synthetic Lee')]:
    as_user('staff@p8.test', f"insert into public.doctors (full_name, specialty, license_no) values ('{name}', 'Pulmonology', '{lic}')")
    did = sql(f"select id from public.doctors where license_no='{lic}'")
    as_user('staff@p8.test', f"select public.link_doctor_account('{did}', '{d}@p8.test')")
    as_user('admin@p8.test', f"select public.decide_doctor('{did}', 'approved', 'Licence checked in demo registry.')")
check('setup', sql("select count(*) from public.doctors where status='approved' and user_id is not null") == '2', 'two verified, linked doctors at an approved hospital (via real decision functions)')

errors = []
with sync_playwright() as p:
    b = p.chromium.launch()
    def device(name, email):
        ctx = b.new_context(viewport={'width': 1366, 'height': 900}, accept_downloads=True); pg = ctx.new_page()
        pg.on('pageerror', lambda e: errors.append(f'{name}: {e}'))
        pg.goto(URL); pg.wait_for_timeout(800)
        card = pg.locator('section.card', has_text='Connected mode (multi-device)')
        card.locator('input[type=email]').fill(email); card.locator('input[type=password]').fill('synthetic-pass-1')
        card.get_by_role('button', name='Sign in').last.click(); pg.wait_for_timeout(1800); return pg
    def nav(pg, label): pg.locator('aside').get_by_role('button', name=label, exact=True).click(); pg.wait_for_timeout(1200)
    def wait_for(pg, sel, text, secs=15):
        for _ in range(secs * 2):
            if text in pg.inner_text(sel): return True
            pg.wait_for_timeout(500)
        return False

    pat = device('patient', 'pat@p8.test'); d1 = device('doctor1', 'd1@p8.test'); d2 = device('doctor2', 'd2@p8.test')
    check('1', 'Patient' in pat.inner_text('.topbar') and 'Doctor' in d1.inner_text('.topbar'), 'patient and doctor sign in to their own role-specific portals')
    nav(d1, 'Connections'); nav(d2, 'Connections')
    # ---- Test 7: connection request reaches the intended doctor only
    nav(pat, 'Doctors')
    row = pat.locator('[data-testid=doctor-row]', has_text='Dr Synthetic Rao'); row.get_by_role('button', name='Request connection').click(); pat.wait_for_timeout(1200)
    check('7', 'Request sent' in row.inner_text(), 'patient sends a request to Dr Rao')
    check('7', wait_for(d1, 'main', 'Synthetic Patient Meera'), 'Dr Rao sees the request on the open page without refreshing')
    d2.wait_for_timeout(2000)
    check('7', 'Synthetic Patient Meera' not in d2.inner_text('main'), 'Dr Lee (same hospital) does not see it')
    check('7', sql("select count(*) from public.care_requests where status='pending'") == '1', 'persisted with status pending')
    pat.locator('[data-testid=doctor-row]', has_text='Dr Synthetic Rao').get_by_role('button', name='Request connection').count() == 0 and check('7', True, 'duplicate request not offered while one is open')
    d1.locator('[data-testid=request-row]', has_text='Meera').get_by_role('button', name='Accept').click(); d1.wait_for_timeout(1200)
    check('7', wait_for(pat, 'main', 'Connected'), 'acceptance reaches the patient without refreshing')
    pat.locator('[data-testid=doctor-row]', has_text='Dr Synthetic Lee').get_by_role('button', name='Request connection').click(); pat.wait_for_timeout(800)
    check('7', wait_for(d2, 'main', 'Synthetic Patient Meera'), 'second request reaches Dr Lee')
    d2.locator('[data-testid=request-row]', has_text='Meera').locator('input').fill('Not available this month')
    d2.locator('[data-testid=request-row]', has_text='Meera').get_by_role('button', name='Reject').click(); d2.wait_for_timeout(1000)
    check('7', wait_for(pat, 'main', 'Not available this month'), 'rejection and its note reach the patient')
    # ---- Test 6: messaging
    nav(pat, 'Messages'); pat.locator('[data-testid=thread]').first.click(); pat.wait_for_timeout(800)
    pat.get_by_label('Message').fill('Hello doctor, this is a synthetic test message.'); pat.get_by_role('button', name='Send').click(); pat.wait_for_timeout(1200)
    nav(d1, 'Messages')
    check('6', wait_for(d1, 'main', '1 unread'), 'doctor sees an unread count without refreshing')
    d1.locator('[data-testid=thread]').first.click(); d1.wait_for_timeout(1500)
    check('6', 'synthetic test message' in d1.inner_text('[data-testid=message-list]'), 'doctor receives the message with sender and time')
    d1.get_by_label('Message').fill('Thanks, I can see your shared sessions.'); d1.get_by_role('button', name='Send').click()
    check('6', wait_for(pat, '[data-testid=message-list]', 'I can see your shared sessions'), 'reply reaches the patient live')
    check('6', wait_for(pat, '[data-testid=message-list]', 'Read'), 'patient sees the message was read')
    pat.reload(); pat.wait_for_timeout(1800); nav(pat, 'Messages'); pat.locator('[data-testid=thread]').first.click(); pat.wait_for_timeout(1500)
    check('6', 'synthetic test message' in pat.inner_text('[data-testid=message-list]') and 'shared sessions' in pat.inner_text('[data-testid=message-list]'), 'conversation persists after refresh')
    other = device('other-patient', 'other@p8.test'); nav(other, 'Messages')
    check('8', 'synthetic test message' not in other.inner_text('main') and 'No conversations' in other.inner_text('main'), 'an unrelated patient sees none of it')
    # ---- Test 3: alert to the connected doctor, resolution back to the patient
    nav(d1, 'Alerts')
    nav(pat, 'Live monitor'); pat.locator('select').first.select_option('irregular'); pat.get_by_role('button', name='5×', exact=True).click()
    pat.get_by_role('button', name='Start recording').click()
    check('3', wait_for(d1, 'main', 'Potentially concerning', 75), 'connected doctor receives the persisted concerning alert without refreshing')
    check('3', 'Synthetic Patient Meera' in d1.inner_text('main') and 'irregular' in d1.inner_text('main'), 'alert shows patient, session scenario and reason')
    d1.get_by_label('Resolution note').first.fill('Reviewed; asked patient to repeat at rest.'); d1.get_by_role('button', name='Resolve').first.click(); d1.wait_for_timeout(1500)
    check('3', 'Resolved' in d1.inner_text('main'), 'doctor resolves the alert')
    nav(pat, 'Alerts')
    check('3', wait_for(pat, 'main', 'Reviewed; asked patient'), 'patient sees the resolution note')
    nav(pat, 'Live monitor'); btn = pat.get_by_role('button', name='Stop recording')
    if btn.count(): btn.click()
    pat.wait_for_timeout(3000)
    # ---- Test 5: sensor failure -> signal-quality warning, not normal
    pat.locator('select').first.select_option('normal_rest'); pat.get_by_role('button', name='Start recording').click(); pat.wait_for_timeout(1500)
    pat.get_by_role('button', name='Pause', exact=True).click(); t1 = pat.inner_text('main'); pat.wait_for_timeout(1500)
    check('pause', 'Paused' in pat.inner_text('main'), 'pause stops recording and says so'); pat.get_by_role('button', name='Resume').click()
    grp = pat.get_by_role('group', name='Simulate a sensor failure')
    grp.get_by_role('button', name='Fail chest').click(); grp.get_by_role('button', name='Fail acoustic').click()
    check('5', wait_for(pat, 'main', 'Signal-quality warning', 60), 'after both breathing sensors fail, the patient sees a signal-quality warning')
    check('5', 'Please repeat the measurement' in pat.inner_text('main') and 'not a normal result' in pat.inner_text('main'), 'it asks for a repeat measurement or review, not reassurance')
    btn = pat.get_by_role('button', name='Stop recording')
    if btn.count(): btn.click()
    pat.wait_for_timeout(3000)
    last = sql("select a.outcome from public.analysis_results a join public.monitoring_sessions s on s.id=a.session_id where s.scenario_id='normal_rest' order by a.window_end desc limit 1")
    check('5', last == 'insufficient', f'persisted result is insufficient (got {last})')
    # ---- prescriptions + AI explanation + opt-in
    nav(d1, 'Prescriptions'); d1.locator('select').first.select_option(label='Synthetic Patient Meera')
    d1.locator('label.field', has_text='Medicine').locator('input').fill('Salbutamol inhaler'); d1.locator('label.field', has_text='Dose').locator('input').fill('2 puffs when breathless')
    d1.get_by_role('button', name='Save prescription').click(); d1.wait_for_timeout(1200)
    nav(pat, 'Medicines')
    check('rx', wait_for(pat, 'main', 'Salbutamol inhaler') and 'Entered by Dr Synthetic Rao' in pat.inner_text('main'), 'clinician-entered prescription reaches the patient, labelled demo record')
    pat.get_by_role('button', name='Explain in plain language (AI)').click()
    check('10', wait_for(pat, 'main', 'TEST STAND-IN REPLY', 20), 'explanation comes back through the server-side function (stand-in model here)')
    pat.locator('input[aria-label^="Reminder times"]').fill('08:00, 20:00'); pat.get_by_role('button', name='Save reminder').click(); pat.wait_for_timeout(1000)
    pat.get_by_role('button', name='Mark 08:00 taken').click(); pat.wait_for_timeout(1000)
    check('rx', '08:00 taken' in pat.inner_text('main'), 'reminder schedule saved and a dose recorded')
    nav(pat, 'AI assistant'); check('10', not pat.locator('[data-testid=ai-optin]').is_checked(), 'AI history is off by default')
    print('PAGE ERRORS:', errors or 'none')
    print('SUMMARY:', json.dumps({k: f'{sum(v)}/{len(v)}' for k, v in res.items()}))
    b.close()
