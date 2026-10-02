// Regression test for v111: Indian Reserves read as restricted land even
// where ParcelMap only says "Federal", and Wildlife Act motor vehicle
// closures are an amber caution with their conditions, not a red stop.
const { chromium } = require('playwright');
const { launchOpts } = require('./launch');
const fs = require('fs');
const path = require('path');
const STUB = fs.readFileSync(__dirname + '/leaflet-stub.js', 'utf8');
const ROOT = path.resolve(__dirname, '..');

(async () => {
  const browser = await chromium.launch(launchOpts());
  const page = await browser.newPage({ viewport: { width: 1400, height: 1000 } });
  const errors = [];
  page.on('console', msg => { if (msg.type() === 'error') errors.push('CONSOLE: ' + msg.text()); });
  page.on('pageerror', err => errors.push('PAGEERROR: ' + err.message));
  await page.route('**://cdnjs.cloudflare.com/**leaflet.min.js', route => route.fulfill({ status: 200, contentType: 'application/javascript', body: STUB }));
  await page.route('**://cdnjs.cloudflare.com/**leaflet.draw.js', route => route.fulfill({ status: 200, contentType: 'application/javascript', body: '// stub' }));
  await page.route('**://cdnjs.cloudflare.com/**.css', route => route.fulfill({ status: 200, contentType: 'text/css', body: '/* stub */' }));
  await page.route('**://fonts.googleapis.com/**', route => route.fulfill({ status: 200, contentType: 'text/css', body: '/* stub */' }));
  await page.goto('file://' + path.join(ROOT, 'index.html'), { waitUntil: 'load', timeout: 60000 });
  await page.waitForTimeout(800);

  const r = await page.evaluate(async () => {
    const out = {};
    const sq = { type: 'Polygon', coordinates: [[[-121.6, 49.4], [-121.4, 49.4], [-121.4, 49.6], [-121.6, 49.6], [-121.6, 49.4]]] };
    const okEmpty = { ok: true, features: [] };
    const base = { lat: 49.5, lng: -121.5, muniR: okEmpty, parkR: okEmpty, cutR: okEmpty, cutPlanR: okEmpty, cutList: [],
      tenureR: okEmpty, woodlotR: okEmpty, roadR: okEmpty, open511R: { ok: true, events: [] }, nearbyParcelR: okEmpty,
      recSiteR: okEmpty, recPolyR: okEmpty, recLineR: okEmpty, recList: [], mvprRoutesR: okEmpty, mvprAreasR: okEmpty, mvprList: [], wmaR: okEmpty, muR: okEmpty };
    const fed = { ok: true, features: [{ properties: { OWNER_TYPE: 'Federal' }, geometry: sq }] };
    const reserveR = { ok: true, features: [{ properties: { ENGLISH_NAME: 'TEST 1', BAND_NAME: 'Test Nation' }, geometry: sq }] };
    const rep = renderReport(Object.assign({}, base, { parcelR: fed, reserveR }), { snapshot: true });
    out.reserveRed = rep.level === 'red' && /Indian Reserve/.test(rep.html) && /TEST 1/.test(rep.html);
    const rep2 = renderReport(Object.assign({}, base, { parcelR: fed, reserveR: okEmpty }), { snapshot: true });
    out.plainFederalNotRed = rep2.level !== 'red' && !/Indian Reserve<\/span>/.test(rep2.html);
    out.reserveLayer = LAYERS.reserve && LAYERS.reserve.typeName === 'WHSE_ADMIN_BOUNDARIES.ADM_INDIAN_RESERVES_BANDS_SP';
    out.reserveInClearMenu = !!document.querySelector('.clear-menu-item[data-key="reserve"]');
    // vehicle closure: amber with conditions
    const crown = { ok: true, features: [{ properties: { OWNER_TYPE: 'Crown Provincial' }, geometry: sq }] };
    const mvprList = [{ kind: 'area', prohibitionType: 'Snowmobile Closure', geographicName: 'Test Range', accessDescription: 'Closed to snowmobiles Dec 1 to Apr 30', closed: true, geometry: sq }];
    const rep3 = renderReport(Object.assign({}, base, { parcelR: crown, reserveR: okEmpty, mvprList, mvprAreasR: { ok: true, features: [{}] } }), { snapshot: true });
    out.mvprAmber = rep3.level === 'amber' && /Snowmobile Closure/.test(rep3.html) && /Dec 1 to Apr 30/.test(rep3.html);
    return out;
  });

  const pass = Object.values(r).every(v => v === true) && errors.length === 0;
  console.log('=== errors ===', errors.length ? errors.join('\n') : '(none)');
  console.log('=== RESULTS ===', JSON.stringify(r, null, 2));
  console.log(pass ? 'PASS' : 'FAIL');
  await browser.close();
  process.exit(pass ? 0 : 1);
})();
