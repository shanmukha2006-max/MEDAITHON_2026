# Email sign-in card (local demo mode): Patient | Hospital | Healthcare authority tiles.
from playwright.sync_api import sync_playwright
fails = []
def check(ok, m):
    print(('PASS ' if ok else 'FAIL ') + m, flush=True)
    if not ok: fails.append(m)
with sync_playwright() as p:
    b = p.chromium.launch(); errs = []
    def fresh():
        pg = b.new_page(viewport={'width': 1366, 'height': 900}); pg.on('pageerror', lambda e: errs.append(str(e)))
        pg.goto('http://localhost:4174/'); pg.evaluate('localStorage.clear()'); pg.reload(); pg.wait_for_timeout(2000)
        return pg, pg.locator('section.card', has_text='Sign in with email')
    def signin(card, email, pw='demo123', enter=False):
        card.locator('input[type=email]').fill(email); card.locator('input[type=password]').fill(pw)
        if enter: card.locator('input[type=password]').press('Enter')
        else: card.get_by_role('button', name='Sign in as').click()
    pg, card = fresh()
    tabs = lambda: [t.strip() for t in card.locator('.seg button').all_inner_texts()]
    check(card.locator('[data-testid=local-role-patient]').get_attribute('aria-pressed') == 'true' and tabs() == ['Sign in', 'New patient'], 'Patient tile selected by default, offering Sign in and New patient')
    card.locator('[data-testid=local-role-hospital]').click()
    check(tabs() == ['Sign in', 'Register hospital'], 'Hospital tile offers Sign in and Register hospital')
    card.locator('[data-testid=local-role-authority]').click()
    check(tabs() == ['Sign in'], 'Healthcare authority tile offers sign-in only (no self-registration)')
    signin(card, 'riverside@demo.test')
    pg.wait_for_timeout(800)
    check('This is a hospital account' in pg.inner_text('.toast-wrap') and 'Choose the “Hospital” tile' in pg.inner_text('.toast-wrap') and pg.locator('aside').count() == 0, 'hospital account refused under the authority tile, with the right tile named')
    signin(card, 'authority@demo.test'); pg.wait_for_timeout(1200)
    check('Healthcare authority portal' in pg.inner_text('aside'), 'authority signs in to the Healthcare authority portal')
    pg.close()
    pg, card = fresh()
    card.locator('[data-testid=local-role-hospital]').click(); signin(card, 'asha@demo.test'); pg.wait_for_timeout(800)
    check('This is a patient account' in pg.inner_text('.toast-wrap') and pg.locator('aside').count() == 0, 'patient account refused under the hospital tile')
    signin(card, 'riverside@demo.test', enter=True); pg.wait_for_timeout(1200)
    check('Hospital portal' in pg.inner_text('aside'), 'hospital signs in (Enter key) to the Hospital portal')
    pg.close()
    pg, card = fresh()
    signin(card, 'asha@demo.test'); pg.wait_for_timeout(1200)
    check('Patient portal' in pg.inner_text('aside'), 'patient signs in to the Patient portal')
    signin_wrong = None
    pg.close()
    pg, card = fresh()
    signin(card, 'asha@demo.test', 'wrong-pass'); pg.wait_for_timeout(800)
    check('Email or password is incorrect' in pg.inner_text('.toast-wrap'), 'wrong password gives a clear error')
    pg.close()
    print('PAGE ERRORS:', errs or 'none'); print(f'{len(fails)} failed checks')
    b.close()
