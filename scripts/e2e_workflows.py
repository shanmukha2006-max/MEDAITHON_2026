# Optional browser test: edge cases across the three portals.
# Requires: pip install playwright && playwright install chromium; `npx vite preview --port 4173` running.
import os, json
URL = os.environ.get('BG_URL', 'http://localhost:4173/')
from playwright.sync_api import sync_playwright
fails, errors = [], []
def check(c, m):
    print(('PASS ' if c else 'FAIL ') + m)
    if not c: fails.append(m)

with sync_playwright() as p:
    b = p.chromium.launch()
    ctx = b.new_context(viewport={'width': 1366, 'height': 900}, accept_downloads=True)
    pg = ctx.new_page()
    pg.on('pageerror', lambda e: errors.append(str(e)))
    pg.on('console', lambda m: m.type == 'error' and 'fonts.g' not in m.text and 'Failed to load resource' not in m.text and errors.append(m.text))
    pg.goto(URL); pg.evaluate('localStorage.clear()'); pg.reload(); pg.wait_for_timeout(500)
    toast = lambda: pg.inner_text('.toast-wrap')
    def as_user(uid, page=None):
        pg.evaluate(f"localStorage.setItem('breatheguard.session.v1','{uid}')")
        pg.goto(URL + (f'#/{page}' if page else '#/')); pg.reload(); pg.wait_for_timeout(600)
    def logout():
        pg.evaluate("localStorage.removeItem('breatheguard.session.v1')"); pg.goto(URL + '#/'); pg.reload(); pg.wait_for_timeout(500)
    def nav(name): pg.locator('aside').get_by_role('button', name=name, exact=True).click(); pg.wait_for_timeout(450)
    def field(label): return pg.locator('label.field', has_text=label).locator('input, textarea, select').first

    # --- A. patient registration validation ---
    pg.get_by_role('button', name='New patient').click()
    field('Full name').fill('Test Patient'); field('Email').fill('tp@demo.test'); field('Password').fill('123')
    pg.get_by_role('button', name='Create account').click(); pg.wait_for_timeout(300)
    check('at least 6 characters' in toast(), 'registration rejects a short password')
    field('Email').fill('asha@demo.test'); field('Password').fill('secret1')
    pg.get_by_role('button', name='Create account').click(); pg.wait_for_timeout(300)
    check('already exists' in toast(), 'registration rejects a duplicate email')
    field('Email').fill('tp@demo.test'); pg.get_by_role('button', name='Create account').click(); pg.wait_for_timeout(600)
    check('Hello, Test' in pg.inner_text('main'), 'valid registration signs the new patient in')
    logout()
    pg.get_by_role('button', name='Sign in', exact=True).first.click()
    field('Email').fill('tp@demo.test'); field('Password').fill('wrongpw'); pg.locator('.login-main').get_by_role('button', name='Sign in').last.click(); pg.wait_for_timeout(300)
    check('incorrect' in toast(), 'wrong password is rejected')
    field('Password').fill('secret1'); pg.locator('.login-main').get_by_role('button', name='Sign in').last.click(); pg.wait_for_timeout(500)
    check('Hello, Test' in pg.inner_text('main'), 'typed sign-in works for the new account')
    logout()

    # --- B. hospital registration → pending, cannot submit doctors ---
    pg.locator('[data-testid=local-role-hospital]').click()  # hospital tile, then its registration tab
    pg.get_by_role('button', name='Register hospital').click()
    field('Administrator name').fill('Hilltop Admin'); field('Hospital name').fill('Hilltop Demo Hospital'); field('City').fill('Upton')
    field('Registration no.').fill('DEMO-H-7777'); field('Email').fill('hilltop@demo.test'); field('Password').fill('secret1')
    pg.get_by_role('button', name='Submit application').click(); pg.wait_for_timeout(700)
    t = pg.inner_text('main')
    check('Pending review' in t and 'Only the healthcare authority can change this status' in t, 'new hospital lands on Pending with a self-approval notice')
    nav('Doctors')
    check(pg.locator('fieldset[disabled]').count() == 1 and 'after your hospital is approved' in pg.inner_text('main'), 'pending hospital cannot submit doctors')
    hilltop_uid = pg.evaluate("localStorage.getItem('breatheguard.session.v1')")

    # --- C. authority approves the new hospital ---
    as_user('u_auth1', 'hospitals')
    pg.locator('.select-list button', has_text='Hilltop').click()
    pg.get_by_role('button', name='Approve', exact=True).click()
    pg.locator('textarea').fill('Demo licence document checked.'); pg.get_by_role('button', name='Record decision: Approved (demo)').click(); pg.wait_for_timeout(400)
    pg.locator('.filter-tabs button', has_text='Approved').click(); pg.wait_for_timeout(300)
    check('Hilltop' in pg.inner_text('.select-list'), 'authority approval moves the hospital to Approved')

    # --- D. hospital submits doctor; not visible until separately verified ---
    as_user(hilltop_uid, 'doctors')
    field('Full name').fill('Dr. Ana Test'); field('Specialty').fill('Pulmonology'); field('Licence number').fill('DEMO-D-7001')
    pg.get_by_role('button', name='Submit for verification').click(); pg.wait_for_timeout(400)
    check('Dr. Ana Test' in pg.inner_text('table') and 'Pending review' in pg.inner_text('table'), 'approved hospital submits a doctor, status pending')
    as_user('u_pat1', 'directory')
    check('Hilltop Demo Hospital' in pg.inner_text('main') and 'Dr. Ana Test' not in pg.inner_text('main'), 'approved hospital listed, its unverified doctor hidden')
    as_user('u_auth1', 'doctors')
    pg.locator('.select-list button', has_text='Dr. Ana Test').click(); pg.get_by_role('button', name='Approve', exact=True).click()
    pg.locator('textarea').fill('Demo licence DEMO-D-7001 checked.'); pg.get_by_role('button', name='Record decision: Approved (demo)').click(); pg.wait_for_timeout(400)
    as_user('u_pat1', 'directory')
    check('Dr. Ana Test' in pg.inner_text('main'), 'doctor appears only after separate verification')

    # --- E. more-information loop (Lakeview) ---
    as_user('u_hosp3', 'status')
    check('More information required' in pg.inner_text('main') and 'duplicates another hospital' in pg.inner_text('main'), 'hospital sees the authority’s correction request')
    field('Registration no.').fill('DEMO-H-1004')
    pg.get_by_role('button', name='Resubmit for review').click(); pg.wait_for_timeout(400)
    check('Pending review' in pg.inner_text('main'), 'resubmission returns the application to Pending')
    as_user('u_auth1', 'hospitals')
    check('Lakeview' in pg.inner_text('.select-list'), 'resubmitted application is back in the authority’s Pending queue')

    # --- F. suspend and reinstate ---
    pg.locator('.filter-tabs button', has_text='Approved').click(); pg.wait_for_timeout(300)
    pg.locator('.select-list button', has_text='Riverside').click(); pg.get_by_role('button', name='Suspend', exact=True).click()
    pg.locator('textarea').fill('Demo complaint under investigation.'); pg.get_by_role('button', name='Record decision: Suspended').click(); pg.wait_for_timeout(400)
    as_user('u_pat1', 'directory')
    t = pg.inner_text('main')
    check('Dr. Mei Lin' not in t and 'Riverside' not in t, 'suspended hospital and its doctors disappear from the directory')
    as_user('u_auth1', 'hospitals'); pg.locator('.filter-tabs button', has_text='Suspended').click(); pg.wait_for_timeout(300)
    pg.locator('.select-list button', has_text='Riverside').click(); pg.get_by_role('button', name='Reinstate', exact=True).click()
    pg.locator('textarea').fill('Investigation closed, no issues found.'); pg.get_by_role('button', name='Record decision: Approved (demo)').click(); pg.wait_for_timeout(400)
    as_user('u_pat1', 'directory')
    check('Dr. Mei Lin' in pg.inner_text('main'), 'reinstated hospital’s verified doctors return')

    # --- G. appointments: validation, decline, cancel ---
    pg.locator('section.card', has_text='Dr. Elena Rossi').get_by_role('button', name='View profile').click()
    pg.get_by_role('button', name='Send request').click(); pg.wait_for_timeout(300)
    check('Choose a date and time' in toast(), 'appointment request requires a date and time')
    pg.locator('input[type=datetime-local]').fill('2026-12-01T09:00'); pg.get_by_role('button', name='Send request').click(); pg.wait_for_timeout(400)
    as_user('u_hosp4', 'appointments')
    pg.locator('tbody tr', has_text='Dec').filter(has_text='Requested').first.get_by_role('button', name='Decline').click(); pg.wait_for_timeout(300)
    check('Declined' in pg.inner_text('table'), 'hospital declines a request')
    as_user('u_pat1', 'appointments')
    before = pg.locator('button', has_text='Cancel request').count()
    pg.get_by_role('button', name='Cancel request').first.click(); pg.wait_for_timeout(300)
    check(pg.locator('button', has_text='Cancel request').count() == before - 1, 'patient cancels a pending request')

    # --- H. consent revoke removes hospital access ---
    as_user('u_pat1', 'reports'); pg.goto(URL + '#/monitor'); pg.wait_for_timeout(600)
    pg.locator('.console').get_by_role('button', name='Run to end').click(); pg.wait_for_timeout(800)
    pg.get_by_role('button', name='Save report').click(); pg.wait_for_timeout(500)
    as_user('u_hosp1', 'patients')
    asha = pg.locator('section.card', has_text='Asha Rao')
    check('Reports shared' in asha.inner_text() and 'Synthetic demo patient' in asha.inner_text(), 'hospital sees consented report; patient labelled synthetic')
    as_user('u_pat1', 'consent')
    pg.locator('tr', has_text='Riverside').locator('input[type=checkbox]').first.uncheck(); pg.wait_for_timeout(300)
    as_user('u_hosp1', 'patients')
    check('Reports not shared' in pg.locator('section.card', has_text='Asha Rao').inner_text(), 'revoking consent immediately removes hospital access')

    # --- I. report download and print ---
    as_user('u_pat1', 'reports'); pg.get_by_role('button', name='Open').first.click(); pg.wait_for_timeout(400)
    with pg.expect_download() as dl:
        pg.get_by_role('button', name='Download JSON').click()
    data = json.loads(open(dl.value.path()).read())
    check(data['disclaimer'].startswith('SIMULATED') and data.get('patchName') and len(data['windows']) > 5, 'report downloads as JSON with disclaimer, patch and windows')
    with ctx.expect_page() as popup:
        pg.get_by_role('button', name='Print or save as PDF').click()
    pp = popup.value; pp.wait_for_load_state(); 
    check('SIMULATED DATA' in pp.inner_text('body'), 'print view opens with the simulated-data warning')
    pp.close(); pg.locator('.modal-head button').click()

    # --- J. medicines and reminders ---
    nav('Medicines')
    field('Medicine').fill('Montelukast'); pg.locator('label.check', has_text='Night').first.check()
    pg.get_by_role('button', name='Save prescription').click(); pg.wait_for_timeout(400)
    night = pg.locator('.sensor', has_text='Night').first
    check('Montelukast' in night.inner_text(), 'new prescription creates a night reminder')
    night.locator('label.check', has_text='Montelukast').locator('input').check(); pg.wait_for_timeout(200)
    check(night.locator('label.check', has_text='Montelukast').locator('input').is_checked(), 'dose can be marked as taken')
    check('Leukotriene' in pg.inner_text('main') and 'Not implemented' in pg.inner_text('main'), 'explanation shown with source; interaction check clearly marked not implemented')

    # --- K. duplicate review report prevention; L. complaint ---
    nav('Find care'); pg.locator('section.card', has_text='Dr. Mei Lin').get_by_role('button', name='View profile').click()
    for _ in range(2):
        pg.locator('.modal').get_by_role('button', name='Report review').first.click()
        pg.locator('.modal input[placeholder*="inappropriate"]').fill('Testing duplicate report'); pg.get_by_role('button', name='Send report').click(); pg.wait_for_timeout(300)
    check('already reported' in toast(), 'the same user cannot report the same review twice')
    pg.locator('.modal-head button').click()
    nav('Appointments'); pg.get_by_role('button', name='Report a problem to the authority').first.click()
    pg.locator('textarea').last.fill('Test complaint about waiting time.'); pg.get_by_role('button', name='Send complaint').click(); pg.wait_for_timeout(300)
    as_user('u_auth1', 'complaints')
    check('Test complaint about waiting time.' in pg.inner_text('main'), 'patient complaint reaches the authority')

    # --- M. labelling ---
    logout()
    check('Local demo mode' in pg.inner_text('body') and 'stored unencrypted' in pg.inner_text('body') and 'nothing is shared between devices' in pg.inner_text('body'), 'login page states local demo mode is not secure or shared')
    print('PAGE ERRORS:', errors or 'none'); print(f'{len(fails)} failed checks')
    b.close()
