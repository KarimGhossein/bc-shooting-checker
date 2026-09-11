// Regression test for the v84 fix: ROAD_VIEW_MIN_ZOOM was 11 (three notches
// tighter than PARCEL_VIEW_MIN_ZOOM despite its own comment saying "one
// notch tighter"), which meant Reveal Road silently refused to run at the
// same normal zoom View Parcels and Shooting Spots already worked at. See
// docs/CHANGELOG.md's v84 section for the full root-cause writeup.
const { chromium } = require('playwright');
const { launchOpts } = require('./launch');
const fs = require('fs');
const path = require('path');
const STUB = fs.readFileSync(__dirname + '/leaflet-stub.js', 'utf8');

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

  await page.goto('file://' + path.resolve(__dirname, '../index.html'), { waitUntil: 'load', timeout: 60000 });
  await page.waitForTimeout(800);

  const results = await page.evaluate(() => ({
    ROAD_VIEW_MIN_ZOOM,
    SPOT_MIN_ZOOM,
    PARCEL_VIEW_MIN_ZOOM,
    matchesSpotGate: ROAD_VIEW_MIN_ZOOM === SPOT_MIN_ZOOM,
    oneNotchTighterThanParcelGate: ROAD_VIEW_MIN_ZOOM === PARCEL_VIEW_MIN_ZOOM + 1,
  }));

  const pass = results.matchesSpotGate && results.oneNotchTighterThanParcelGate && errors.length === 0;

  console.log('=== errors ===', errors.length ? errors.join('\n') : '(none)');
  console.log('=== RESULTS ===', JSON.stringify(results, null, 2));
  console.log(pass ? 'PASS' : 'FAIL');
  await browser.close();
  process.exit(pass ? 0 : 1);
})();
