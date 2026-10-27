# Patient creates their details, shares with a hospital AND with the healthcare authority; both see the
# records through the shared backend; the authority's view is read-only; revoking ends access.
# Separate browser contexts (no shared storage). TEST STAND-IN for Supabase Auth; polling, not Realtime.
import subprocess
from playwright.sync_api import sync_playwright
URL = 'http://localhost:4180/'
fails = []
def check(ok, m):
    print(('PASS ' if ok else 'FAIL ') + m, flush=True)
    if not ok: fails.append(m)
def sql(q): return subprocess.run(['su', 'postgres', '-c', f'psql -h /tmp -p 54322 -d bg_test -q -At -c "{q}"'], capture_output=True, text=True).stdout.strip()
sql('truncate auth.users cascade; truncate public.hospitals, public.audit_log restart identity cascade;')
with sync_playwright() as p:
    b = p.chromium.launch(); errs = []
    def dev(name):
        ctx = b.new_context(viewport={'width': 1366, 'height': 900}, accept_downloads=True); pg = ctx.new_page()
        pg.on('pageerror', lambda e: errs.append(f'{name}: {e}')); pg.goto(URL); pg.wait_for_timeout(2500); return pg
    card = lambda pg: pg.locator('section.card', has_text='Connected mode (multi-device)')
    def register(pg, name, email, tile, role):
        c = card(pg); c.locator(f'[data-testid=role-{tile}]').click(); c.get_by_role('button', name='Create account').click()
        c.locator('label.field', has_text='Full name').locator('input').fill(name); c.get_by_label('Account type').select_option(role)
        c.locator('input[type=email]').fill(email); c.locator('input[type=password]').fill('synthetic-pass-1')
        c.get_by_role('button', name='Create account').last.click(); pg.wait_for_timeout(2000)
    nav = lambda pg, label: (pg.locator('aside').get_by_role('button', name=label, exact=True).click(), pg.wait_for_timeout(1500))

    pat = dev('patient'); register(pat, 'Synthetic Patient Meera', 'meera@share.test', 'patient', 'patient')
    check('Patient' in pat.inner_text('.topbar'), 'patient account created and signed in')
    hos = dev('hospital'); register(hos, 'Synthetic Admin Kofi', 'kofi@share.test', 'hospital', 'hospital_staff')
    hos.locator('label.field', has_text='Hospital name').locator('input').fill('Synthetic Harbour Hospital')
    hos.locator('label.field', has_text='City').locator('input').fill('Testport')
    hos.locator('label.field', has_text='Registration no.').locator('input').fill('DEMO-H-55')
    hos.get_by_role('button', name='Submit application').click(); hos.wait_for_timeout(1500)
    check('Pending review' in hos.inner_text('main'), 'hospital details submitted (pending review)')
    au = dev('authority'); register(au, 'Synthetic Authority Lin', 'lin@share.test', 'patient', 'patient')
    sql("select public.bootstrap_authority('lin@share.test')")
    au.locator('aside').get_by_role('button', name='Sign out').click(); au.wait_for_timeout(1500)
    c = card(au); c.locator('[data-testid=authority-tab]').click()
    c.locator('input[type=email]').fill('lin@share.test'); c.locator('input[type=password]').fill('synthetic-pass-1')
    c.get_by_role('button', name='Sign in as healthcare authority').click(); au.wait_for_timeout(2500)
    check('Healthcare authority' in au.inner_text('.topbar'), 'authority signs in with the Healthcare authority tile')
    row = au.locator('.list-item', has_text='Synthetic Harbour Hospital')
    row.locator('input').fill('Demo licence and address checked.'); row.get_by_role('button', name='Approve').click(); au.wait_for_timeout(1500)
    nav(au, 'Shared patient records')
    check('No patients are sharing with the authority' in au.inner_text('main'), 'before sharing, the authority sees no patient records')

    # patient records a session, then shares with the hospital and the authority
    nav(pat, 'Live monitor'); pat.locator('select').first.select_option('irregular'); pat.get_by_role('button', name='5×', exact=True).click()
    pat.get_by_role('button', name='Start recording').click(); pat.wait_for_timeout(9000)
    if pat.get_by_role('button', name='Stop recording').count(): pat.get_by_role('button', name='Stop recording').click()
    pat.wait_for_timeout(3000)
    nav(pat, 'Care providers')
    pat.locator('section.card', has_text='Synthetic Harbour Hospital').get_by_role('button', name='Share', exact=True).click(); pat.wait_for_timeout(1500)
    pat.locator('section.card', has_text='Healthcare authority').get_by_role('button', name='Share with authority').click(); pat.wait_for_timeout(1500)
    t = pat.inner_text('main')
    check('Shared with the healthcare authority' in t and 'cannot change anything' in t, 'patient shares with the hospital and the authority, with a plain explanation')

    nav(hos, 'Live patients'); hos.wait_for_timeout(1500)
    check('Synthetic Patient Meera' in hos.inner_text('main'), 'the hospital sees the patient’s session')
    au.wait_for_timeout(11000)   # the authority's page is already open: no navigation, no reload
    check('Synthetic Patient Meera' in au.inner_text('main'), 'the authority’s open page shows the newly shared patient without a refresh')
    au.get_by_role('button', name='Open').first.click(); au.wait_for_timeout(3500)
    t = au.inner_text('main')
    check('Latest analysis' in t and au.get_by_role('button', name='Acknowledge').count() == 0, 'authority view shows the analysis and is read-only (no acknowledge)')
    with au.expect_download() as dl: au.get_by_role('button', name='Download PDF').first.click()
    check(dl.value.suggested_filename.endswith('.pdf'), f'authority downloads the report ({dl.value.suggested_filename})')
    check(sql("select count(*) from public.audit_log where action = 'consent.authority_granted'") == '1', 'sharing with the authority is recorded in the audit log')

    nav(pat, 'Care providers')
    pat.locator('section.card', has_text='Healthcare authority').get_by_role('button', name='Stop sharing').click(); pat.wait_for_timeout(1500)
    au.locator('button', has_text='Close').first.click(); au.wait_for_timeout(11000)
    check('No patients are sharing with the authority' in au.inner_text('main'), 'after the patient stops sharing, the authority’s open page loses the record without a refresh')
    nav(hos, 'Your hospital'); nav(hos, 'Live patients')
    check('Synthetic Patient Meera' in hos.inner_text('main'), 'the hospital keeps access (separate consent)')
    print('PAGE ERRORS:', errs or 'none'); print(f'{len(fails)} failed checks')
    b.close()
