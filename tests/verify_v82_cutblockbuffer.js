const { chromium } = require('playwright');
const { launchOpts } = require('./launch');
const fs = require('fs');
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

  await page.goto('file://' + require('path').resolve(__dirname, '../index.html'), { waitUntil: 'load', timeout: 60000 });
  await page.waitForTimeout(800);

  const results = {};

  // Case 1: pin is INSIDE an ACTIVE cutblock's geometry itself (distance 0 <= 400m) -> should flag.
  results.pinInsideActiveCutblock = await page.evaluate(() => {
    const okEmpty = { ok: true, features: [] };
    const square = { type: 'Polygon', coordinates: [[[-122.51, 51.49], [-122.49, 51.49], [-122.49, 51.51], [-122.51, 51.51], [-122.51, 51.49]]] };
    renderReport({
      lat: 51.5, lng: -122.5,
      parcelR: okEmpty, muniR: okEmpty, parkR: okEmpty,
      cutR: { ok: true, features: [{ properties: { OPENING_ID: 1, OPENING_STATUS_CODE: 'FG' }, geometry: square }] },
      cutPlanR: { ok: true, features: [{ properties: { OPENING_ID: 1, LIFE_CYCLE_STATUS_CODE: 'ACTIVE' }, geometry: square }] },
      cutList: [{ openingId: 1, geometry: square, lifeCycleStatus: 'ACTIVE', oversized: false, statusLabel: 'FG' }],
      tenureR: okEmpty, woodlotR: okEmpty, roadR: okEmpty, open511R: { ok: true, events: [] },
      nearbyParcelR: okEmpty, recSiteR: okEmpty, recPolyR: okEmpty, recLineR: okEmpty, recList: [],
      mvprRoutesR: okEmpty, mvprAreasR: okEmpty, mvprList: [], wmaR: okEmpty,
    });
    const cutblocksCard = Array.from(document.querySelectorAll('.card')).find(c => c.querySelector('.card-title')?.textContent.includes('Forestry'));
    return {
      cardHtml: cutblocksCard ? cutblocksCard.innerHTML.includes('within 400m of active logging') : null,
      bodyHasBufferText: cutblocksCard ? cutblocksCard.textContent.includes('within 400m buffer') : null,
    };
  });

  // Case 2: an ACTIVE cutblock exists but far away (2km+) -- should NOT trigger the buffer flag, only the generic "N within 2km" one.
  results.activeCutblockFarAway = await page.evaluate(() => {
    const okEmpty = { ok: true, features: [] };
    // ~2km north of the click point (roughly 0.018 deg lat)
    const farSquare = { type: 'Polygon', coordinates: [[[-122.51, 51.517], [-122.49, 51.517], [-122.49, 51.519], [-122.51, 51.519], [-122.51, 51.517]]] };
    renderReport({
      lat: 51.5, lng: -122.5,
      parcelR: okEmpty, muniR: okEmpty, parkR: okEmpty,
      cutR: { ok: true, features: [{ properties: { OPENING_ID: 2, OPENING_STATUS_CODE: 'FG' }, geometry: farSquare }] },
      cutPlanR: { ok: true, features: [{ properties: { OPENING_ID: 2, LIFE_CYCLE_STATUS_CODE: 'ACTIVE' }, geometry: farSquare }] },
      cutList: [{ openingId: 2, geometry: farSquare, lifeCycleStatus: 'ACTIVE', oversized: false, statusLabel: 'FG' }],
      tenureR: okEmpty, woodlotR: okEmpty, roadR: okEmpty, open511R: { ok: true, events: [] },
      nearbyParcelR: okEmpty, recSiteR: okEmpty, recPolyR: okEmpty, recLineR: okEmpty, recList: [],
      mvprRoutesR: okEmpty, mvprAreasR: okEmpty, mvprList: [], wmaR: okEmpty,
    });
    const cutblocksCard = Array.from(document.querySelectorAll('.card')).find(c => c.querySelector('.card-title')?.textContent.includes('Forestry'));
    return {
      hasBufferPill: cutblocksCard ? cutblocksCard.textContent.includes('within 400m of active logging') : null,
      hasGenericFlag: cutblocksCard ? cutblocksCard.textContent.includes('recorded within 2 km') === false : null, // body text lives elsewhere; just sanity
    };
  });

  // Case 3: cutblock nearby but NOT active (e.g. life cycle = RETIRED) -- should NOT trigger buffer flag even though inside geometry.
  results.pinInsideRetiredCutblock = await page.evaluate(() => {
    const okEmpty = { ok: true, features: [] };
    const square = { type: 'Polygon', coordinates: [[[-122.51, 51.49], [-122.49, 51.49], [-122.49, 51.51], [-122.51, 51.51], [-122.51, 51.49]]] };
    renderReport({
      lat: 51.5, lng: -122.5,
      parcelR: okEmpty, muniR: okEmpty, parkR: okEmpty,
      cutR: { ok: true, features: [{ properties: { OPENING_ID: 3, OPENING_STATUS_CODE: 'FC' }, geometry: square }] },
      cutPlanR: { ok: true, features: [{ properties: { OPENING_ID: 3, LIFE_CYCLE_STATUS_CODE: 'RETIRED' }, geometry: square }] },
      cutList: [{ openingId: 3, geometry: square, lifeCycleStatus: 'RETIRED', oversized: false, statusLabel: 'FC' }],
      tenureR: okEmpty, woodlotR: okEmpty, roadR: okEmpty, open511R: { ok: true, events: [] },
      nearbyParcelR: okEmpty, recSiteR: okEmpty, recPolyR: okEmpty, recLineR: okEmpty, recList: [],
      mvprRoutesR: okEmpty, mvprAreasR: okEmpty, mvprList: [], wmaR: okEmpty,
    });
    const cutblocksCard = Array.from(document.querySelectorAll('.card')).find(c => c.querySelector('.card-title')?.textContent.includes('Forestry'));
    return { hasBufferPill: cutblocksCard ? cutblocksCard.textContent.includes('within 400m of active logging') : null };
  });

  // Case 4: oversized active cutblock right at the pin -- excluded (same as map sweep), should NOT trigger.
  results.pinInsideOversizedActiveCutblock = await page.evaluate(() => {
    const okEmpty = { ok: true, features: [] };
    const square = { type: 'Polygon', coordinates: [[[-122.51, 51.49], [-122.49, 51.49], [-122.49, 51.51], [-122.51, 51.51], [-122.51, 51.49]]] };
    renderReport({
      lat: 51.5, lng: -122.5,
      parcelR: okEmpty, muniR: okEmpty, parkR: okEmpty,
      cutR: { ok: true, features: [{ properties: { OPENING_ID: 4, OPENING_STATUS_CODE: 'FG' }, geometry: square }] },
      cutPlanR: { ok: true, features: [{ properties: { OPENING_ID: 4, LIFE_CYCLE_STATUS_CODE: 'ACTIVE' }, geometry: square }] },
      cutList: [{ openingId: 4, geometry: square, lifeCycleStatus: 'ACTIVE', oversized: true, statusLabel: 'FG' }],
      tenureR: okEmpty, woodlotR: okEmpty, roadR: okEmpty, open511R: { ok: true, events: [] },
      nearbyParcelR: okEmpty, recSiteR: okEmpty, recPolyR: okEmpty, recLineR: okEmpty, recList: [],
      mvprRoutesR: okEmpty, mvprAreasR: okEmpty, mvprList: [], wmaR: okEmpty,
    });
    const cutblocksCard = Array.from(document.querySelectorAll('.card')).find(c => c.querySelector('.card-title')?.textContent.includes('Forestry'));
    return { hasBufferPill: cutblocksCard ? cutblocksCard.textContent.includes('within 400m of active logging') : null };
  });

  console.log('=== errors ===', errors.length ? errors.join('\n') : '(none)');
  console.log('=== RESULTS ===', JSON.stringify(results, null, 2));
  await browser.close();
})();
