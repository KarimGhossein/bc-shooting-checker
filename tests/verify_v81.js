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

  results.mergedChooser = await page.evaluate(() => {
    const overlapSquare = { type: 'Polygon', coordinates: [[[-122.51, 51.49], [-122.49, 51.49], [-122.49, 51.51], [-122.51, 51.51], [-122.51, 51.49]]] };
    renderMapOverlays({
      parcelR: { ok: true, features: [{ properties: { OWNER_TYPE: 'Private' }, geometry: overlapSquare }] },
      nearbyParcelR: { ok: true, features: [] },
      muniR: { ok: true, features: [{ properties: { ADMIN_AREA_NAME: 'City of Kamloops' }, geometry: overlapSquare }] },
      parkR: { ok: false, features: [] },
      wmaR: { ok: false, features: [] },
      tenureR: { ok: true, features: [{ properties: { TENURE_PURPOSE: 'Grazing' }, geometry: overlapSquare }] },
      woodlotR: { ok: false, features: [] },
      roadR: { ok: false, features: [] },
      cutList: [{ geometry: overlapSquare, openingId: 'OP1', lifeCycleStatus: 'ACTIVE', oversized: false, statusLabel: 'FG' }],
      recList: [], mvprList: [],
    });
    openNearbyFeaturesPopupAt({ lat: 51.5, lng: -122.5 });
    return {
      totalRegistered: currentClickableFeatures.length,
      matchCount: currentNearbyMatches.length,
      matchIcons: currentNearbyMatches.map(m => m.icon).sort(),
    };
  });

  // Single-match case (nothing else at this spot) -- parcel alone still works cleanly
  results.singleParcelOnly = await page.evaluate(() => {
    const solo = { type: 'Polygon', coordinates: [[[-99, 40], [-98, 40], [-98, 41], [-99, 41], [-99, 40]]] };
    renderMapOverlays({
      parcelR: { ok: true, features: [{ properties: { OWNER_TYPE: 'Crown Provincial' }, geometry: solo }] },
      nearbyParcelR: { ok: true, features: [] },
      muniR: { ok: false, features: [] }, parkR: { ok: false, features: [] }, wmaR: { ok: false, features: [] },
      tenureR: { ok: false, features: [] }, woodlotR: { ok: false, features: [] }, roadR: { ok: false, features: [] },
      cutList: [], recList: [], mvprList: [],
    });
    const before = currentNearbyMatches.length;
    openNearbyFeaturesPopupAt({ lat: 40.5, lng: -98.5 });
    // single match doesn't reassign currentNearbyMatches -- verify via direct filter matching internal logic
    const directMatches = currentClickableFeatures.filter(f => featureNearPoint(f, { lat: 40.5, lng: -98.5 }, 10, 10));
    return { registeredCount: currentClickableFeatures.length, directMatchCount: directMatches.length, icon: directMatches[0] ? directMatches[0].icon : null };
  });

  // Style check: tenure/woodlot/wma/muni no longer use fill:false
  results.styleCheck = await page.evaluate(() => {
    const overlapSquare = { type: 'Polygon', coordinates: [[[-122.51, 51.49], [-122.49, 51.49], [-122.49, 51.51], [-122.51, 51.51], [-122.51, 51.49]]] };
    // Re-run with everything present to inspect fillOpacity used in pushClickable-adjacent draw calls indirectly --
    // we can't peek at the Leaflet style object through the stub, so this just confirms no throw and full registration.
    renderMapOverlays({
      parcelR: { ok: true, features: [{ properties: { OWNER_TYPE: 'Private' }, geometry: overlapSquare }] },
      nearbyParcelR: { ok: true, features: [] },
      muniR: { ok: true, features: [{ properties: { ADMIN_AREA_NAME: 'Test City' }, geometry: overlapSquare }] },
      parkR: { ok: true, features: [{ properties: { PROTECTED_LANDS_NAME: 'Test Park' }, geometry: overlapSquare }] },
      wmaR: { ok: true, features: [{ properties: { WILDLIFE_MANAGEMENT_AREA_NAME: 'Test WMA' }, geometry: overlapSquare }] },
      tenureR: { ok: true, features: [{ properties: { TENURE_PURPOSE: 'Grazing' }, geometry: overlapSquare }] },
      woodlotR: { ok: true, features: [{ properties: { CLIENT_NAME: 'Test Co' }, geometry: overlapSquare }] },
      roadR: { ok: false, features: [] },
      cutList: [], recList: [], mvprList: [],
    });
    const byIcon = {};
    currentClickableFeatures.forEach(f => (byIcon[f.icon] = (byIcon[f.icon]||0)+1));
    return { total: currentClickableFeatures.length, byIcon };
  });

  console.log('=== errors ===', errors.length ? errors.join('\n') : '(none)');
  console.log('=== RESULTS ===');
  console.log(JSON.stringify(results, null, 2));

  await browser.close();
})();
