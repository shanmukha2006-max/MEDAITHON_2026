# Login page: Patient | Hospital | Healthcare authority side by side, in both login cards.
import os
from playwright.sync_api import sync_playwright
fails = []
def check(ok, m):
    print(('PASS ' if ok else 'FAIL ') + m, flush=True)
    if not ok: fails.append(m)
with sync_playwright() as p:
    b = p.chromium.launch(); errs = []
    # connected card (backend verified)
    pg = b.new_page(viewport={'width': 1366, 'height': 900}); pg.on('pageerror', lambda e: errs.append(str(e)))
    pg.goto('http://localhost:4180/'); pg.wait_for_timeout(2500)
    card = pg.locator('section.card', has_text='Connected mode (multi-device)')
    check(card.locator('[data-testid=role-patient]').get_attribute('aria-pressed') == 'true', 'connected: Patient selected by default')
    card.locator('[data-testid=role-hospital]').click(); card.get_by_role('button', name='Create account').click()
    check(card.locator('select').input_value() == 'hospital_staff', 'connected: Hospital tile pre-selects “Hospital staff” for new accounts')
    card.locator('[data-testid=authority-tab]').click(); pg.wait_for_timeout(200)
    check(card.locator('[data-testid=authority-tab]').get_attribute('aria-pressed') == 'true', 'connected: Healthcare authority tile selected')
    check(card.get_by_role('button', name='Create account').count() == 0 and card.get_by_role('button', name='Forgot password').count() == 0, 'connected: no self-registration offered for authority accounts')
    check(card.get_by_role('button', name='Sign in as healthcare authority').count() == 1 and 'project owner provisions them' in card.inner_text(), 'connected: authority-only sign-in with the provisioning note')
    card.locator('[data-testid=role-patient]').click()
    check(card.get_by_role('button', name='Create account').count() == 1, 'connected: switching back to Patient restores sign-in and registration')
    pg.close()
    # local demo card: each tile opens its own dashboard
    for tid, expect in [('demo-u_pat1', 'Patient portal'), ('demo-u_hosp1', 'Hospital portal'), ('demo-u_auth1', 'Healthcare authority portal')]:
        pg = b.new_page(viewport={'width': 1366, 'height': 900}); pg.on('pageerror', lambda e: errs.append(str(e)))
        pg.goto('http://localhost:4174/'); pg.evaluate('localStorage.clear()'); pg.reload(); pg.wait_for_timeout(1500)
        pg.locator(f'[data-testid={tid}]').click(); pg.wait_for_timeout(1200)
        check(expect in pg.inner_text('aside'), f'demo: {tid.split("-")[1]} tile opens the {expect}')
        pg.close()
    print('PAGE ERRORS:', errs or 'none'); print(f'{len(fails)} failed checks')
    b.close()
