# Test 5 with the LIVE controls: disable required sensors mid-session in connected mode and check the
# persisted analysis. Stack as for e2e_acceptance.py (TEST-ONLY auth stand-in; polling, not Realtime).
import os, subprocess
from playwright.sync_api import sync_playwright
URL = os.environ.get('BG_CLOUD_URL', 'http://localhost:4180/')
def sql(q): return subprocess.run(['su', 'postgres', '-c', f'psql -h /tmp -p 54322 -d bg_test -q -At -c "{q}"'], capture_output=True, text=True).stdout.strip()
fails = []
def check(ok, m):
    print(('PASS ' if ok else 'FAIL ') + m, flush=True)
    if not ok: fails.append(m)
with sync_playwright() as p:
    b = p.chromium.launch(); pg = b.new_page(viewport={'width': 1366, 'height': 900}); errs = []
    pg.on('pageerror', lambda e: errs.append(str(e)))
    pg.goto(URL); pg.wait_for_timeout(800)
    card = pg.locator('section.card', has_text='Connected mode (multi-device)')
    card.get_by_role('button', name='Create account').click()
    card.locator('label.field', has_text='Full name').locator('input').fill('Synthetic Toggle Patient')
    card.get_by_label('Account type').select_option('patient')
    card.locator('input[type=email]').fill('toggle@p8.test'); card.locator('input[type=password]').fill('synthetic-pass-1')
    card.get_by_role('button', name='Create account').last.click(); pg.wait_for_timeout(2000)
    pg.locator('aside').get_by_role('button', name='Live monitor', exact=True).click(); pg.wait_for_timeout(800)
    pg.locator('select').first.select_option('normal_rest')
    pg.get_by_role('button', name='5×', exact=True).click()
    pg.get_by_role('button', name='Start recording').click(); pg.wait_for_timeout(9000)   # ~45 s simulated
    first = sql("select a.outcome from public.analysis_results a join public.monitoring_sessions s on s.id=a.session_id join auth.users u on u.id=s.patient_id where u.email='toggle@p8.test' order by a.window_end limit 1")
    check(first == 'within', f'before any failure the persisted result is within range (got {first})')
    pg.get_by_role('button', name='Fail chest').click(); pg.get_by_role('button', name='Fail acoustic').click()
    check(pg.get_by_role('button', name='chest failed').count() == 1 and pg.get_by_role('button', name='acoustic failed').count() == 1, 'live controls show both sensors as failed')
    pg.wait_for_timeout(13000)   # > 30 s simulated after the failure, so a whole window lacks both sensors
    last = sql("select a.outcome || '|' || a.reason from public.analysis_results a join public.monitoring_sessions s on s.id=a.session_id join auth.users u on u.id=s.patient_id where u.email='toggle@p8.test' order by a.window_end desc limit 1")
    check(last.startswith('insufficient|'), f'persisted result after disabling both breathing sensors is insufficient, never normal ({last[:90]})')
    body = pg.inner_text('main')
    check('Insufficient reliable data' in body or 'insufficient reliable data' in body.lower(), 'the patient sees insufficient reliable data')
    check('SIMULATED DATA' in body, 'simulated-data label visible')
    print('PAGE ERRORS:', errs or 'none'); print(f'{len(fails)} failed checks')
    b.close()
