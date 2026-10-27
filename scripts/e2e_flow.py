# Optional browser end-to-end test. Requires: pip install playwright && playwright install chromium
# Run against a fresh browser profile (demo data is seeded on first load):
#   npm run build && npx vite preview --port 4173   (in one terminal)
#   python scripts/e2e_flow.py                       (in another)
import os
URL = os.environ.get('BG_URL', 'http://localhost:4173/')
from playwright.sync_api import sync_playwright
errors = []
def check(cond, msg):
    print(('PASS ' if cond else 'FAIL ') + msg)
    if not cond: errors.append(msg)
with sync_playwright() as p:
    b = p.chromium.launch()
    pg = b.new_page(viewport={'width': 1360, 'height': 900})
    pg.on('pageerror', lambda e: errors.append('PAGEERROR ' + str(e)))
    U = URL
    def login(role):
        pg.goto(U + '#/'); pg.wait_for_timeout(300)
        pg.get_by_role('button', name=role).first.click(); pg.wait_for_timeout(300)
    def nav(name):
        pg.locator('aside').get_by_role('button', name=name, exact=True).click(); pg.wait_for_timeout(400)
    def logout(): nav('Sign out')

    # 1. patient monitor: hidden change, play live for a bit then run to end
    login('Patient'); nav('Patch simulator')
    pg.get_by_role('button', name='15×').click()
    pg.get_by_role('button', name='Start').click(); pg.wait_for_timeout(3500)
    t = pg.inner_text('main'); check('Breaths/min' in t, 'live playback produced a verdict after ~45 simulated seconds')
    pg.get_by_role('button', name='Pause').click()
    pg.screenshot(path='/tmp/s_monitor_live.png', full_page=False)
    pg.get_by_role('button', name='Run to end').click(); pg.wait_for_timeout(1500)
    t = pg.inner_text('main')
    check('Potentially concerning simulated pattern' in t, 'hidden-change scenario ends as potentially concerning')
    check('Walking' in t, 'activity detected as walking')
    pg.get_by_label('Reveal simulator ground truth').check(); pg.wait_for_timeout(400)
    pg.screenshot(path='/tmp/s_monitor_hidden.png', full_page=True)
    pg.get_by_role('button', name='Save report').click(); pg.wait_for_timeout(600)
    check('Respiratory change hidden by movement' in pg.inner_text('main'), 'report saved and listed on Reports page')

    # multi failure scenario -> insufficient
    nav('Patch simulator')
    pg.select_option('select', 'multi_failure'); pg.get_by_role('button', name='Run to end').click(); pg.wait_for_timeout(1000)
    check('Insufficient reliable data' in pg.inner_text('main'), 'multiple sensor failure ends as insufficient reliable data')
    pg.screenshot(path='/tmp/s_monitor_insufficient.png', full_page=False)

    # 2. review completed appointment a2 (Adeyemi)
    nav('Appointments')
    card = pg.locator('section.card', has_text='Dr. Samuel Adeyemi')
    card.get_by_role('button', name='4 stars').click()
    card.locator('textarea').first.fill('Clear explanation of the simulated results.')
    card.get_by_role('button', name='Publish review').click(); pg.wait_for_timeout(400)
    check('Your review:' in card.inner_text(), 'review published for completed appointment')
    check(card.get_by_role('button', name='Publish review').count() == 0, 'second review on same appointment not offered')
    # request appointment with Dr Lin
    nav('Find care')
    pg.locator('section.card', has_text='Dr. Mei Lin').get_by_role('button', name='View profile').click()
    pg.locator('input[type=datetime-local]').fill('2026-11-20T10:30')
    pg.get_by_role('button', name='Send request').click(); pg.wait_for_timeout(400)
    check(pg.locator('.modal').count() == 0, 'appointment request sent and modal closed')
    check('Dr. Jun Park' not in pg.inner_text('main'), 'unverified doctor (Park) hidden from directory')
    logout()

    # 3. hospital sees consented report, confirms appointment, tries to self-approve impossible (no UI)
    login('Hospital (approved)'); nav('Patients')
    t = pg.inner_text('main')
    check('Respiratory change hidden by movement' in t, 'hospital sees report for consenting patient (Asha)')
    check('Reports not shared' in t, 'hospital sees lock for non-consenting patient (Ben)')
    nav('Appointments')
    pg.locator('tr', has_text='Asha Rao').filter(has_text='requested').first.get_by_role('button', name='Confirm').click(); pg.wait_for_timeout(300)
    nav('Ratings and reviews')
    t = pg.inner_text('main'); check('Clear explanation' in t, 'new review visible to hospital')
    check(pg.get_by_role('button', name='Delete').count() == 0 and pg.get_by_role('button', name='Edit').count() == 0, 'hospital has no edit/delete controls for reviews')
    logout()

    # 4. authority: reason required, approve Northgate, then approve Dr Park
    login('Healthcare authority')
    pg.locator('.select-list button', has_text='Northgate').click()
    pg.get_by_role('button', name='Approve', exact=True).click()
    pg.get_by_role('button', name='Record decision: Approved (demo)').click(); pg.wait_for_timeout(300)
    check('reason of at least 10 characters' in pg.inner_text('.toast-wrap'), 'decision without reason is rejected')
    pg.locator('textarea').fill('Demo licence document and address checked.')
    pg.get_by_role('button', name='Record decision: Approved (demo)').click(); pg.wait_for_timeout(500)
    nav('Doctor credentials')
    pg.locator('.select-list button', has_text='Dr. Jun Park').click()
    pg.get_by_role('button', name='Approve', exact=True).click()
    pg.locator('textarea').fill('Demo licence DEMO-D-5005 checked against demo register.')
    pg.get_by_role('button', name='Record decision: Approved (demo)').click(); pg.wait_for_timeout(500)
    pg.screenshot(path='/tmp/s_authority.png', full_page=False)
    nav('Complaints and flags')
    c = pg.locator('.list-item', has_text='abusive language')
    c.locator('input').fill('Abusive language breaches the review policy.')
    c.get_by_role('button', name='Hide review').click(); pg.wait_for_timeout(300)
    nav('Audit trail')
    t = pg.inner_text('main')
    check('Northgate Demo Clinic' in t and 'Dr. Jun Park' in t and 'complaint.hide_review' in t, 'audit trail records all three decisions')
    logout()

    # 5. patient directory now shows Park; Lin's rating excludes hidden review
    login('Patient'); nav('Find care')
    t = pg.inner_text('main')
    check('Dr. Jun Park' in t, 'newly verified doctor appears in directory')
    check('5.0 from 1 review' in t, "hidden review excluded from Dr. Lin's rating")
    pg.screenshot(path='/tmp/s_directory.png', full_page=False)
    nav('Consent'); pg.screenshot(path='/tmp/s_consent.png')
    # mobile
    pg.set_viewport_size({'width': 390, 'height': 844}); nav_m = pg.locator('.mobile-nav').get_by_role('button', name='Patch simulator').click(); pg.wait_for_timeout(500)
    pg.get_by_role('button', name='Run to end').click(); pg.wait_for_timeout(1000)
    pg.screenshot(path='/tmp/s_mobile.png', full_page=False)
    sw = pg.evaluate('document.documentElement.scrollWidth')
    check(sw <= 392, f'no horizontal page scroll on mobile (scrollWidth {sw})')
    print('ERRORS:', errors or 'none')
    b.close()
