# Part 9 browser tests: verified backend status (4 configurations), Healthcare Authority sign-in,
# and the floating BreatheGuard AI assistant in local demo and connected modes.
# Stack as in docs/TESTING.md, plus copies of the unconfigured build served with breatheguard-config.json:
#   4174 no settings | 4190 runtime config -> stack | 4191 runtime config -> wrong URL | 4192 runtime config -> empty DB
#   4180 build-time settings -> stack. TEST STAND-INS: Supabase Auth and the AI provider (marked replies).
import os, json, subprocess
from playwright.sync_api import sync_playwright
LOG = '/tmp/fake_ai_requests.jsonl'
res = {}
def check(k, ok, m):
    print(('PASS ' if ok else 'FAIL ') + f'[{k}] ' + m, flush=True); res.setdefault(k, []).append(ok)
def sql(q): return subprocess.run(['su', 'postgres', '-c', f'psql -h /tmp -p 54322 -d bg_test -q -At -c "{q}"'], capture_output=True, text=True).stdout.strip()
def last_provider_call():
    lines = [l for l in open(LOG).read().splitlines() if l.strip()] if os.path.exists(LOG) else []
    return json.loads(lines[-1]) if lines else None
errors = []
with sync_playwright() as p:
    b = p.chromium.launch()
    def page(url):
        ctx = b.new_context(viewport={'width': 1366, 'height': 900}); pg = ctx.new_page()
        pg.on('pageerror', lambda e: errors.append(f'{url}: {e}')); pg.goto(url); pg.wait_for_timeout(2500); return pg
    status = lambda pg: pg.inner_text('[data-testid=backend-status]')
    card = lambda pg: pg.locator('section.card', has_text='Connected mode (multi-device)')
    def register(pg, name, email, role='patient'):
        c = card(pg); c.get_by_role('button', name='Create account').click()
        c.locator('label.field', has_text='Full name').locator('input').fill(name); c.get_by_label('Account type').select_option(role)
        c.locator('input[type=email]').fill(email); c.locator('input[type=password]').fill('synthetic-pass-1')
        c.get_by_role('button', name='Create account').last.click(); pg.wait_for_timeout(2000)

    # ---------- 3: backend status in four configurations ----------
    pg = page('http://localhost:4174/')
    t = status(pg)
    check('3', 'Configuration required' in t and 'VITE_SUPABASE_URL' in t and 'BEFORE building' in t, 'no settings: “Configuration required”, naming the missing values and the build-time pitfall')
    check('3', pg.get_by_role('button', name='Patient').count() >= 1, 'local demo still available, clearly separate')
    pg.context.close()
    pg = page('http://localhost:4191/'); t = status(pg)
    check('3', 'Cannot reach the backend' in t and 'localhost:3999' in t, 'wrong URL: “Cannot reach the backend” (connection error), not demo mode')
    check('3', card(pg).get_by_role('button', name='Sign in').count() == 0, 'no sign-in offered while the backend is unreachable')
    pg.context.close()
    pg = page('http://localhost:4192/'); t = status(pg)
    check('3', 'Database setup incomplete' in t and 'PGRST202' in t and '0001 to 0005' in t, 'empty database: “Database setup incomplete”, telling you to run the migrations')
    pg.context.close()
    pg = page('http://localhost:4190/'); t = status(pg)
    check('3', 'Connected and verified' in t and 'schema (v5)' in t, 'runtime config file (same unconfigured build, no rebuild): “Connected and verified”')
    register(pg, 'Synthetic Runtime Patient', 'runtime9@p9.test')
    check('3', 'Connected mode' in pg.inner_text('.topbar'), 'runtime-configured build signs a real account in')
    pg.context.close()

    # ---------- 2: healthcare authority sign-in ----------
    pat = page('http://localhost:4180/')
    register(pat, 'Synthetic Patient Nine', 'pat9@p9.test')
    pat.locator('aside').get_by_role('button', name='Sign out').click(); pat.wait_for_timeout(1500)
    au = page('http://localhost:4180/')
    register(au, 'Synthetic Authority Nine', 'authority9@p9.test')
    sql("select public.bootstrap_authority('authority9@p9.test')")
    au.locator('aside').get_by_role('button', name='Sign out').click(); au.wait_for_timeout(1500)
    c = card(pat); pat.locator('[data-testid=authority-tab]').click()
    c.locator('input[type=email]').fill('pat9@p9.test'); c.locator('input[type=password]').fill('synthetic-pass-1')
    c.get_by_role('button', name='Sign in as healthcare authority').click(); pat.wait_for_timeout(2500)
    check('2', 'does not have healthcare authority access' in pat.inner_text('body') and pat.locator('.topbar').count() == 0, 'a patient account is refused at the authority sign-in and stays on the login screen')
    c = card(au); au.locator('[data-testid=authority-tab]').click()
    c.locator('input[type=email]').fill('authority9@p9.test'); c.locator('input[type=password]').fill('synthetic-pass-1')
    c.get_by_role('button', name='Sign in as healthcare authority').click(); au.wait_for_timeout(2500)
    nav = au.inner_text('aside')
    check('2', 'Healthcare authority' in au.inner_text('.topbar') and 'Reviews' in nav and 'Audit log' in nav and 'Live monitor' not in nav, 'the provisioned authority signs in to the authority dashboard only')
    au.context.close()

    # ---------- 11/12/13: floating assistant, connected patient ----------
    c = card(pat); c.locator('[data-testid=role-patient]').click(); pat.wait_for_timeout(200)  # back from the authority tile
    c.get_by_role('button', name='Sign in', exact=True).first.click()
    c.locator('input[type=email]').fill('pat9@p9.test'); c.locator('input[type=password]').fill('synthetic-pass-1')
    c.get_by_role('button', name='Sign in').last.click(); pat.wait_for_timeout(2500)
    pages = [x for x in pat.locator('aside .nav-btn').all_inner_texts() if x.strip() and 'Sign out' not in x]
    on_all = True
    for name in pages:
        pat.locator('aside').get_by_role('button', name=name.strip(), exact=True).click(); pat.wait_for_timeout(600)
        on_all = on_all and pat.locator('[data-testid=ai-fab]').count() == 1
    check('13', on_all and len(pages) >= 8, f'floating “BreatheGuard AI” present on all {len(pages)} connected patient pages')
    # record a short session so there is a saved report to ask about
    pat.locator('aside').get_by_role('button', name='Live monitor', exact=True).click(); pat.wait_for_timeout(600)
    pat.locator('select').first.select_option('irregular'); pat.get_by_role('button', name='5×', exact=True).click()
    pat.get_by_role('button', name='Start recording').click(); pat.wait_for_timeout(9000)
    btn = pat.get_by_role('button', name='Stop recording')
    if btn.count(): btn.click()
    pat.wait_for_timeout(3000)
    pat.locator('[data-testid=ai-fab]').click(); pat.wait_for_timeout(800)
    check('13', pat.evaluate("document.activeElement && document.activeElement.getAttribute('aria-label')") == 'Your question', 'opening the panel puts keyboard focus in the question box')
    pat.locator('[data-testid=ai-panel] textarea').fill('How does BreatheGuard tell movement from a real change?')
    pat.keyboard.press('Enter'); pat.wait_for_timeout(4000)
    t = pat.inner_text('[data-testid=ai-messages]')
    check('11', 'TEST STAND-IN REPLY' in t and 'stand-in-model-not-a-real-ai' in t, 'answer arrives from the server-side AI function and names the model that answered (stand-in here, NOT a real model)')
    check('11', 'Never diagnose' in json.dumps(last_provider_call()['body']), 'the safety rules travel with the request to the provider')
    pat.locator('aside').get_by_role('button', name='Messages', exact=True).click(); pat.wait_for_timeout(800)
    check('13', pat.locator('[data-testid=ai-panel]').count() == 1, 'the open panel stays open across page navigation')
    if pat.locator('[data-testid=ai-panel]').count() == 0: pat.locator('[data-testid=ai-fab]').click(); pat.wait_for_timeout(500)
    check('13', 'How does BreatheGuard tell movement' in pat.inner_text('[data-testid=ai-messages]'), 'conversation is preserved after navigating to another page')
    pat.locator('[data-testid=ai-panel] select').select_option(index=1)
    pat.locator('[data-testid=ai-panel] textarea').fill('Why was this session classified as it was?'); pat.keyboard.press('Enter'); pat.wait_for_timeout(4000)
    body = json.dumps(last_provider_call()['body'])
    check('11', 'Session summary (synthetic)' in body and 'irregular' in body and 'Synthetic Patient Nine' not in body and 'pat9@p9.test' not in body, 'a selected saved session is explained from its actual data, labelled synthetic, without name or email')
    pat.locator('[data-testid=ai-panel] select').select_option(index=0)
    pat.locator('[data-testid=ai-panel] textarea').fill('SIMULATE-PROVIDER-FAILURE test'); pat.keyboard.press('Enter'); pat.wait_for_timeout(4000)
    t = pat.inner_text('[data-testid=ai-messages]')
    check('12', 'AI provider returned an error (503)' in t and pat.locator('[data-testid=ai-panel]').get_by_role('button', name='Retry').count() == 1 and t.count('TEST STAND-IN REPLY') == 2, 'provider failure: clear error with Retry; no answer fabricated')
    pat.keyboard.press('Escape'); pat.wait_for_timeout(300)
    check('13', pat.locator('[data-testid=ai-panel]').count() == 0 and pat.evaluate("document.activeElement && document.activeElement.dataset.testid") == 'ai-fab', 'Escape closes the panel and returns focus to the button')
    pat.set_viewport_size({'width': 390, 'height': 844}); pat.wait_for_timeout(400)
    pat.locator('[data-testid=ai-fab]').click(); pat.wait_for_timeout(400)
    box = pat.locator('[data-testid=ai-panel]').bounding_box()
    check('13', box and box['x'] >= 0 and box['x'] + box['width'] <= 390 and pat.evaluate('document.documentElement.scrollWidth') <= 391, 'panel fits a phone screen without horizontal scrolling')
    pat.context.close()

    # ---------- 13: floating assistant in LOCAL demo mode ----------
    dm = page('http://localhost:4174/')
    dm.get_by_role('button', name='Patient').first.click(); dm.wait_for_timeout(1200)
    local_pages = ['Overview', 'Choose a patch', 'Patch simulator', 'Find care', 'Appointments', 'Reports', 'Medicines', 'Consent']
    ok = True
    for name in local_pages:
        dm.locator('aside').get_by_role('button', name=name, exact=True).click(); dm.wait_for_timeout(500)
        ok = ok and dm.locator('[data-testid=ai-fab]').count() == 1
    check('13', ok, 'floating “BreatheGuard AI” present on all 8 local patient pages (Overview … Consent)')
    n0 = len(open(LOG).read().splitlines()) if os.path.exists(LOG) else 0
    dm.locator('[data-testid=ai-fab]').click(); dm.wait_for_timeout(400)
    t = dm.inner_text('[data-testid=ai-panel]')
    check('12', 'needs connected mode' in t and 'Configuration required' in t and dm.locator('[data-testid=ai-panel] textarea').count() == 0, 'local demo: assistant explains why AI is unavailable, offers no fake chat')
    check('12', (len(open(LOG).read().splitlines()) if os.path.exists(LOG) else 0) == n0, 'nothing sent to any AI provider from demo mode')
    dm.context.close()
    print('PAGE ERRORS:', errors or 'none')
    print('SUMMARY:', json.dumps({k: f'{sum(v)}/{len(v)}' for k, v in res.items()}))
    b.close()
