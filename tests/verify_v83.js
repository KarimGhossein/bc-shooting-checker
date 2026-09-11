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

  // 1) Sources don't clobber each other: 'overlay' reset must not wipe 'spots' entries and vice versa.
  results.sourceIsolation = await page.evaluate(() => {
    const square = { type: 'Polygon', coordinates: [[[-122.51, 51.49], [-122.49, 51.49], [-122.49, 51.51], [-122.51, 51.51], [-122.51, 51.49]]] };
    // Simulate an 'overlay' draw (single-click report) registering a tenure.
    renderMapOverlays({
      parcelR: { ok: true, features: [] }, nearbyParcelR: { ok: true, features: [] },
      muniR: { ok: true, features: [] }, parkR: { ok: false, features: [] }, wmaR: { ok: false, features: [] },
      tenureR: { ok: true, features: [{ properties: { TENURE_PURPOSE: 'Grazing' }, geometry: square }] },
      woodlotR: { ok: false, features: [] }, roadR: { ok: false, features: [] },
      cutList: [], recList: [], mvprList: [],
    });
    const afterOverlay = currentClickableFeatures.length;

    // Simulate a 'spots' draw (Potential Spots) registering a gap square at the same spot.
    resetClickableSource('spots');
    pushClickable(square, '🎯', 'No parcel record (presumed Crown)', '🎯 No parcel record', '<div>gap</div>');
    const afterSpots = currentClickableFeatures.length;
    const bothPresent = currentClickableFeatures.some(f => f.source === 'overlay') && currentClickableFeatures.some(f => f.source === 'spots');

    // Re-run renderMapOverlays (a fresh 'overlay' reset) -- the 'spots' entry must survive.
    renderMapOverlays({
      parcelR: { ok: true, features: [] }, nearbyParcelR: { ok: true, features: [] },
      muniR: { ok: true, features: [] }, parkR: { ok: false, features: [] }, wmaR: { ok: false, features: [] },
      tenureR: { ok: true, features: [{ properties: { TENURE_PURPOSE: 'Grazing' }, geometry: square }] },
      woodlotR: { ok: false, features: [] }, roadR: { ok: false, features: [] },
      cutList: [], recList: [], mvprList: [],
    });
    const spotsSurvived = currentClickableFeatures.some(f => f.source === 'spots');

    // A click at the shared square should now merge BOTH into one chooser (2 matches).
    openNearbyFeaturesPopupAt({ lat: 51.5, lng: -122.5 });
    return {
      afterOverlay, afterSpots, bothPresent, spotsSurvived,
      matchCount: currentNearbyMatches.length,
      matchSources: currentNearbyMatches.map(m => m.source).sort(),
    };
  });

  // 2) View Parcels and Reveal Road now register into the shared chooser too.
  results.parcelViewAndRoadViewRegister = await page.evaluate(() => {
    const square = { type: 'Polygon', coordinates: [[[-122.61, 51.59], [-122.59, 51.59], [-122.59, 51.61], [-122.61, 51.61], [-122.61, 51.59]]] };
    drawParcelViewLayer([{ properties: { OWNER_TYPE: 'Private' }, geometry: square }]);
    const parcelViewCount = currentClickableFeatures.filter(f => f.source === 'parcelview').length;

    resetClickableSource('roadview');
    renderNearbyRoads(classifyDraRoads([{ properties: { ROAD_CLASS: 'local' }, geometry: { type: 'LineString', coordinates: [[-122.6, 51.6],[-122.59,51.61]] } }]), roadViewLayer);
    const roadViewCount = currentClickableFeatures.filter(f => f.source === 'roadview').length;
    return { parcelViewCount, roadViewCount };
  });

  // 3) Active-cutblock outline (Potential Spots) also registers now.
  results.activeCutblockOutlineRegisters = await page.evaluate(() => {
    resetClickableSource('spots');
    const square = { type: 'Polygon', coordinates: [[[-121.51, 50.49], [-121.49, 50.49], [-121.49, 50.51], [-121.51, 50.51], [-121.51, 50.49]]] };
    renderActiveCutblockOutlines([{ geometry: square, properties: { CUT_BLOCK_ID: 'ABC' } }], spotLayer);
    return currentClickableFeatures.filter(f => f.source === 'spots' && f.icon === '🪓').length;
  });

  // 4) Forestry-inside-buffer flag is now 'red', not 'amber'.
  results.forestryFlagIsRed = await page.evaluate(() => {
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
    const redChip = Array.from(document.querySelectorAll('.flag-chip-red')).some(c => c.textContent.includes('Forestry'));
    return {
      cardClassList: cutblocksCard ? cutblocksCard.className : null,
      hasRedFlagChip: redChip,
    };
  });

  console.log('=== errors ===', errors.length ? errors.join('\n') : '(none)');
  console.log('=== RESULTS ===', JSON.stringify(results, null, 2));
  await browser.close();
})();
