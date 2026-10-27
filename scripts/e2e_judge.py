# Optional browser test for the patch simulator and Judge Demo.
# Requires: pip install playwright && playwright install chromium
# Run against a fresh browser profile while `npx vite preview --port 4173` is running.
import os, re
URL = os.environ.get('BG_URL', 'http://localhost:4173/')
from playwright.sync_api import sync_playwright
import importlib.util
spec = importlib.util.find_spec('playwright')
fails, errors = [], []
def check(cond, msg):
    print(('PASS ' if cond else 'FAIL ') + msg)
    if not cond: fails.append(msg)

EXPECT = {'within': 'Within expected simulated range', 'concerning': 'Potentially concerning simulated pattern', 'insufficient': 'Insufficient reliable data'}
SIM_STEPS = ['within', 'within', 'concerning', 'insufficient', 'insufficient']

with sync_playwright() as p:
    b = p.chromium.launch()
    pg = b.new_page(viewport={'width': 1440, 'height': 1000})
    pg.on('pageerror', lambda e: errors.append(str(e)))
    pg.on('console', lambda m: m.type == 'error' and 'fonts.g' not in m.text and 'Failed to load resource' not in m.text and errors.append(m.text))
    pg.goto(URL); pg.wait_for_timeout(500)
    pg.evaluate('localStorage.clear()'); pg.goto(URL); pg.wait_for_timeout(500)

    def wait_idle():
        for _ in range(80):
            if 'playing' not in pg.inner_text('.judge'): return
            pg.wait_for_timeout(250)
    verdict = lambda: pg.inner_text('.verdict').split('\n')[0]

    # ---------- Judge Demo from the login screen (11 steps) ----------
    pg.get_by_role('button', name='Start Judge Demo').click(); pg.wait_for_timeout(900)
    check(pg.locator('.judge').count() == 1, 'Judge Demo opens straight from the login screen')
    nxt = lambda: (pg.locator('.judge').get_by_role('button', name='Next step').click(), pg.wait_for_timeout(700))
    t = pg.inner_text('main')
    check('Introduction' in pg.inner_text('.judge') and 'The problem:' in t and 'Our proposed solution:' in t and 'BreatheGuard Quick' in t, 'step 1: problem and proposed solution on the patch page')
    check('Stuck or a chart not updating?' in pg.inner_text('.judge'), 'recovery hint shown in the demo bar')
    nxt()
    check('SIMULATED DATA — NOT FOR CLINICAL USE' in pg.inner_text('main'), 'simulated-data notice visible')
    for i, exp in enumerate(SIM_STEPS):
        wait_idle(); pg.wait_for_timeout(300)
        title = pg.inner_text('.judge h2'); v = verdict()
        check(v == EXPECT[exp], f'step {i+2} "{title}": shows "{v}"')
        why = pg.inner_text('.why')
        check('BreatheGuard' in why and 'checks whether each signal can be trusted' in why, f'step {i+2}: panel says what the simulator is showing')
        if i == 1:
            check('Walking' in pg.inner_text('.verdict') and 'not trusted' in why and 'acoustic' in why, 'step 3: walking detected; chest not trusted, acoustic used')
            pg.screenshot(path='/tmp/j_walk.png')
        if i == 2:
            cmp = pg.inner_text('section.card:has-text("Side by side")')
            check('Walking' in cmp and 'Within' in cmp and 'Potentially concerning' in cmp, 'step 4: comparison card contrasts walking vs sustained change')
        if i == 3:
            av = pg.inner_text('.avail')
            check('Failed at 60s' in av and 'Failed at 100s' in av, 'step 5: both sensor failures shown in availability')
            check('What would make this conclusive' in why and 'flat' in why and 'no data' in why, 'step 5: panel says what evidence is missing (flat chest, no acoustic data)')
            pg.screenshot(path='/tmp/j_fail.png')
        if i == 4:
            check('Not fitted on BreatheGuard Quick' in pg.inner_text('.avail') and 'Quick patch limitation' in pg.inner_text('.verdict'), 'step 6: Quick shows acoustic not fitted and explains the limitation')
            check('second breathing sensor' in why, 'step 6: panel suggests stillness or a second sensor')
            cmp = pg.inner_text('section.card:has-text("Side by side")')
            check('BreatheGuard Care' in cmp and 'BreatheGuard Quick' in cmp, 'step 6: Care vs Quick comparison shown')
        nxt()
    cards = pg.inner_text('.grid-auto')
    check('Patient portal' in pg.inner_text('.judge') and 'Dr. Mei Lin' in cards and 'Dr. Priya Nair' not in cards, 'step 7: patient directory shows verified doctors only')
    nxt()
    asha = pg.locator('section.card', has_text='Asha Rao'); ben = pg.locator('section.card', has_text='Ben Ortiz')
    check('Hospital portal' in pg.inner_text('.judge') and 'Reports shared' in asha.inner_text() and 'Respiratory change hidden by movement' in asha.inner_text() and 'Reports not shared' in ben.inner_text(), 'step 8: hospital sees Asha’s consented report, Ben locked')
    nxt()
    t = pg.inner_text('main')
    check('Authority portal' in pg.inner_text('.judge') and 'Northgate Demo Clinic' in t and 'Reason' in t, 'step 9: authority opens Northgate with the reason-required decision panel')
    pg.screenshot(path='/tmp/j_portal_authority.png')
    pg.locator('.judge').get_by_role('button', name='Back').click(); pg.wait_for_timeout(700)
    check('Hospital portal' in pg.inner_text('.judge') and 'Asha Rao' in pg.inner_text('main'), 'Back from a portal step returns to the previous portal')
    pg.locator('.judge-dots button').nth(9).click(); pg.wait_for_timeout(1500)
    top = pg.evaluate("(() => { const h = [...document.querySelectorAll('h2')].find(e => e.textContent.includes('hardware-validation roadmap')); return h ? h.getBoundingClientRect().top : -9999; })()")
    check('Roadmap' in pg.inner_text('.judge') and 0 <= top < 900, f'step 10: roadmap scrolled into view (heading at {round(top)}px)')
    check(pg.locator('.roadmap li').count() == 6 and 'Done' in pg.inner_text('.roadmap') and 'Next' in pg.inner_text('.roadmap'), 'step 10: six roadmap phases, phase 1 done, phase 2 next')
    pg.screenshot(path='/tmp/j_roadmap.png')
    pg.locator('.judge-dots button').nth(5).click(); pg.wait_for_timeout(700); wait_idle(); pg.wait_for_timeout(300)
    check(verdict() == EXPECT['insufficient'] and 'Not fitted' in pg.inner_text('.avail'), 'jumping from a portal back to step 6 reloads the Quick simulation')
    pg.locator('.judge-dots button').nth(10).click(); pg.wait_for_timeout(900)
    t = pg.inner_text('main')
    check('It asks whether that signal can be trusted' in t and 'The trust layer' in t, 'step 11: summary shows the central message and trust layer')
    check(t.count('Insufficient reliable data') >= 2 and 'Potentially concerning' in t, 'step 11: summary table recomputed with all outcomes')
    pg.screenshot(path='/tmp/j_summary.png', full_page=True)
    pg.locator('.judge').get_by_role('button', name='Restart demo').click(); pg.wait_for_timeout(800)
    check('step 1 of 11' in pg.inner_text('.judge') and 'The problem:' in pg.inner_text('main'), 'Restart demo returns to step 1')
    nxt(); wait_idle(); pg.wait_for_timeout(300)
    check(verdict() == EXPECT['within'], 'after restart, step 2 plays again correctly')
    pg.locator('.judge').get_by_role('button', name='Exit demo').click(); pg.wait_for_timeout(400)
    check(pg.locator('.judge').count() == 0 and pg.locator('.console').count() == 1, 'Exit demo returns to full controls')

    # top-bar Judge Demo from another portal; pending-hospital banner
    pg.evaluate("localStorage.setItem('breatheguard.session.v1','u_hosp2')"); pg.goto(URL + '#/doctors'); pg.reload(); pg.wait_for_timeout(700)
    check('Pending review.' in pg.inner_text('main') and 'not visible to patients' in pg.inner_text('main'), 'pending hospital sees a status banner on its pages')
    pg.locator('.topbar').get_by_role('button', name='Judge Demo').click(); pg.wait_for_timeout(900)
    check('step 1 of 11' in pg.inner_text('.judge') and 'Asha Rao' in pg.inner_text('.topbar'), 'top-bar Judge Demo works from the hospital portal and switches to the demo patient')
    pg.locator('.judge').get_by_role('button', name='Exit demo').click(); pg.wait_for_timeout(300)

    # ---------- corrupted saved data no longer blanks pages ----------
    raw = pg.evaluate("localStorage.getItem('breatheguard.db.v1')")
    import json as _j
    d = _j.loads(raw); [d.pop(k, None) for k in ('complaints', 'doseLog', 'baselines')]
    pg.evaluate("(v) => localStorage.setItem('breatheguard.db.v1', v)", _j.dumps(d))
    for uid, page in [('u_pat1', 'monitor'), ('u_pat1', 'medicines'), ('u_auth1', 'complaints')]:
        pg.evaluate(f"localStorage.setItem('breatheguard.session.v1','{uid}')"); pg.goto(URL + '#/' + page); pg.reload(); pg.wait_for_timeout(900)
        check(len(pg.inner_text('main')) > 200, f'partial saved data: {page} still renders')
    pg.evaluate("localStorage.setItem('breatheguard.session.v1','u_pat1')"); pg.goto(URL + '#/patches'); pg.reload(); pg.wait_for_timeout(600)

    # ---------- Patch page buttons ----------
    pg.locator('aside').get_by_role('button', name='Choose a patch', exact=True).click(); pg.wait_for_timeout(500)
    pg.screenshot(path='/tmp/p_patches.png', full_page=True)
    check('Choose your BreatheGuard patch' in pg.inner_text('main') and pg.locator('table').count() >= 1, 'patch page shows cards and comparison table')
    pg.get_by_role('button', name='Explore Quick Simulation').click(); pg.wait_for_timeout(600)
    check('Not fitted on BreatheGuard Quick' in pg.inner_text('.avail'), 'Explore Quick Simulation opens simulator with Quick selected')
    check(pg.get_by_role('button', name=re.compile('^Quick')).get_attribute('aria-pressed') == 'true', 'Quick toggle is pressed')
    pg.locator('aside').get_by_role('button', name='Choose a patch', exact=True).click(); pg.wait_for_timeout(400)
    pg.get_by_role('button', name='Explore Care Simulation').click(); pg.wait_for_timeout(600)
    check('Not fitted' not in pg.inner_text('.avail'), 'Explore Care Simulation opens with all three sensors')

    # ---------- Controls ----------
    con = pg.locator('.console')
    con.get_by_role('button', name='Start').click(); pg.wait_for_timeout(1500)
    con.get_by_role('button', name='Pause').click(); t1 = pg.inner_text('.scrub .time'); pg.wait_for_timeout(700)
    check(pg.inner_text('.scrub .time') == t1, f'Pause stops the clock ({t1})')
    con.get_by_role('button', name='Resume').click(); pg.wait_for_timeout(800)
    check(pg.inner_text('.scrub .time') != t1, 'Resume restarts the clock')
    con.get_by_role('button', name='Reset').click(); pg.wait_for_timeout(300)
    check(pg.inner_text('.scrub .time').startswith('0 s'), 'Reset returns to 0 s')
    pg.locator('.scrub input').fill('60'); pg.wait_for_timeout(500)
    check(pg.inner_text('.scrub .time').startswith('60 s') and pg.locator('.verdict.warmup').count() == 0, 'timeline scrubber jumps to 60 s and shows a result')
    con.locator('.fail-row', has_text='Chest motion').get_by_role('button', name='Fail now').click()
    pg.locator('.scrub input').fill('90'); pg.wait_for_timeout(500)
    check('Failed at 60s (injected)' in pg.inner_text('.avail'), 'Fail now on chest sensor is reflected in availability')
    con.locator('.fail-row', has_text='Acoustic').get_by_role('button', name='Fail now').click()
    pg.locator('.scrub input').fill('130'); pg.wait_for_timeout(500)
    check(verdict() == EXPECT['insufficient'], 'failing both breathing sensors gives insufficient data')
    con.locator('.fail-row', has_text='Chest motion').get_by_role('button', name='Reconnect').click()
    con.locator('.fail-row', has_text='Acoustic').get_by_role('button', name='Reconnect').click()
    pg.locator('.scrub input').fill('175'); pg.wait_for_timeout(500)
    check(verdict() == EXPECT['within'] and 'reconnected' in pg.inner_text('main'), 'Reconnect restores the sensors and logs the event')
    pg.locator('#sc').select_option('walking'); pg.wait_for_timeout(300)
    pg.locator('.scrub input').fill('60'); pg.wait_for_timeout(300)
    con.locator('.fail-row', has_text='Movement').get_by_role('button', name='Fail now').click()
    pg.locator('.scrub input').fill('120'); pg.wait_for_timeout(500)
    check('Movement sensor has failed' in pg.inner_text('main') and 'Unavailable' in pg.inner_text('main'), 'movement-sensor failure reported, artefacts cannot be ruled out')

    # sliders change the outcome or quality
    con.get_by_role('button', name='Rest', exact=True).click(); pg.wait_for_timeout(2500)
    q0 = pg.inner_text('.verdict')
    pg.locator('#nz').fill('2'); pg.wait_for_timeout(1200)
    q1 = pg.inner_text('.verdict')
    check(q0 != q1, 'noise slider changes the analysis')
    pg.locator('#nz').fill('0'); pg.locator('#mv').fill('2'); pg.wait_for_timeout(600)
    check('×2.0' in pg.inner_text('.console'), 'movement slider updates')
    pg.locator('#mv').fill('1')

    # every scenario, both patches, run to end
    for patch in ['Care', 'Quick']:
        con.get_by_role('button', name=re.compile('^' + patch)).click()
        for i in range(10):
            pg.locator('#sc').select_option(index=i); pg.wait_for_timeout(150)
            con.get_by_role('button', name='Run to end').click(); pg.wait_for_timeout(350)
            v = verdict()
            ok = v in EXPECT.values()
            if not ok: check(False, f'{patch} scenario {i+1} produced a verdict')
        check(True, f'{patch}: all 10 scenarios run to end with a verdict')
    # preset chips
    con.get_by_role('button', name='Care', exact=False).first.click()
    con.get_by_role('button', name='Change + movement').click(); pg.wait_for_timeout(5000)
    check(verdict() == EXPECT['concerning'], 'preset "Change + movement" plays to its key moment: concerning')
    pg.screenshot(path='/tmp/c_controls.png')

    # mobile layout
    pg.set_viewport_size({'width': 390, 'height': 844}); pg.wait_for_timeout(400)
    sw = pg.evaluate('document.documentElement.scrollWidth')
    check(sw <= 392, f'simulator has no horizontal scroll on mobile ({sw}px)')
    pg.screenshot(path='/tmp/m_sim.png')
    print('PAGE ERRORS:', errors or 'none')
    print(f'{len(fails)} failed checks')
    b.close()
