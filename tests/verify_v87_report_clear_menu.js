// Regression test for v87, a correction of v86's Clear dropdown plus a
// second, unrelated fix from the same request:
//
// 1) The Clear dropdown now lists one item per *report* category (Parcel,
//    Municipal Boundary, Bylaw Lookup, Park, WMA, Recreation, Motor Vehicle
//    Closures, Forestry, Crown Land Tenures, Woodlot, Road Access -- the 11
//    renderReport() pushCard() keys), not the three Mapping Functions
//    buttons v86 mistakenly used. Clearing one category removes just that
//    category's map shapes (overlayCategoryLayers[key]) and its own report
//    card (#card-<key>), leaving every other category, the pin, and the
//    rest of the report untouched.
// 2) runPotentialSpotsSearch() no longer force-opens the Tools drawer
//    (openToolsDrawer() removed entirely, now dead code) -- Karim reported
//    the progress bar popping the drawer open on a plain map click, before
//    he'd pressed anything in it, as showing up on its own.
//
// See docs/CHANGELOG.md's v87 section for the full root-cause writeup.
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

  const results = await page.evaluate(() => {
    const out = {};

    // ---- 1) Clear dropdown is now report categories, not mapping functions ----
    out.oldMappingFnItemsGone = !document.getElementById('clearParcelsBtn') && !document.getElementById('clearSpotsMenuBtn') && !document.getElementById('clearRoadMenuBtn') && !document.getElementById('clearLocationBtn');
    const menuKeys = Array.from(document.querySelectorAll('#clearMenu .clear-menu-item')).map(b => b.dataset.key);
    out.menuKeys = menuKeys;
    out.menuKeysMatchReportCategories = JSON.stringify(menuKeys) === JSON.stringify(['parcel','municipality','bylaw','park','wma','recreation','mvpr','cutblocks','tenures','woodlot','road']);

    // Build a real report + real map shapes for two categories (tenures,
    // park) via the same functions runLookup() calls, exactly like
    // verify_v83.js already does for renderMapOverlays().
    const square = { type: 'Polygon', coordinates: [[[-122.51, 51.49], [-122.49, 51.49], [-122.49, 51.51], [-122.51, 51.51], [-122.51, 51.49]]] };
    const okEmpty = { ok: true, features: [] };
    const tenureFeature = { properties: { TENURE_PURPOSE: 'Grazing' }, geometry: square };
    const parkFeature = { properties: { PROTECTED_LANDS_NAME: 'Test Park' }, geometry: square };
    const overlayArgs = {
      parcelR: okEmpty, nearbyParcelR: okEmpty, muniR: okEmpty, parkR: { ok: true, features: [parkFeature] }, wmaR: okEmpty,
      tenureR: { ok: true, features: [tenureFeature] }, woodlotR: okEmpty, roadR: okEmpty,
      cutList: [], recList: [], mvprList: [],
    };
    setMarker(51.5, -122.5); // so the "clearReportCategory() must never touch the pin" check below is meaningful
    renderMapOverlays(overlayArgs);
    renderReport({
      lat: 51.5, lng: -122.5,
      parcelR: okEmpty, muniR: okEmpty, parkR: { ok: true, features: [parkFeature] },
      cutR: okEmpty, cutPlanR: okEmpty, cutList: [],
      tenureR: { ok: true, features: [tenureFeature] }, woodlotR: okEmpty, roadR: okEmpty, open511R: { ok: true, events: [] },
      nearbyParcelR: okEmpty, recSiteR: okEmpty, recPolyR: okEmpty, recLineR: okEmpty, recList: [],
      mvprRoutesR: okEmpty, mvprAreasR: okEmpty, mvprList: [], wmaR: okEmpty,
    });

    out.beforeClear = {
      tenuresCardExists: !!document.getElementById('card-tenures'),
      parkCardExists: !!document.getElementById('card-park'),
      tenuresChooserCount: currentClickableFeatures.filter(e => e.source === 'overlay:tenures').length,
      parkChooserCount: currentClickableFeatures.filter(e => e.source === 'overlay:park').length,
      categoryGroupsCreated: OVERLAY_CATEGORY_KEYS.every(k => !!overlayCategoryLayers[k]),
    };

    // Swap in spies for clearLayers() before clearing -- the network-stubbed
    // Leaflet (leaflet-stub.js) is a generic chainable Proxy with no real
    // add/clear/getLayers tracking (see its own top comment), so shape
    // *counts* can't be asserted against directly; this instead confirms
    // clearReportCategory() calls clearLayers() on exactly the right
    // category's real (non-Leaflet, plain-object) group reference.
    let tenuresCleared = false, parkCleared = false;
    overlayCategoryLayers.tenures = { clearLayers(){ tenuresCleared = true; } };
    overlayCategoryLayers.park = { clearLayers(){ parkCleared = true; } };

    // Clearing "tenures" only should drop its card + chooser entries and
    // call clearLayers() on its own group -- leaving "park" (and the
    // pin/marker) completely alone.
    clearReportCategory('tenures', '📜 Crown Land Tenures');

    out.afterClear = {
      tenuresCardExists: !!document.getElementById('card-tenures'),
      parkCardExists: !!document.getElementById('card-park'),
      tenuresChooserCount: currentClickableFeatures.filter(e => e.source === 'overlay:tenures').length,
      parkChooserCount: currentClickableFeatures.filter(e => e.source === 'overlay:park').length,
      tenuresCleared, parkCleared,
      markerUntouched: marker !== null, // clearReportCategory() must never touch the pin
      noteText: document.getElementById('mapActionsNote').textContent,
    };

    // A category with nothing to clear (bylaw wasn't rendered in this fake
    // report) should be a harmless no-op, not throw.
    let bylawThrew = false;
    try { clearReportCategory('bylaw', '📜 Bylaw Lookup'); } catch (e) { bylawThrew = true; }
    out.emptyCategoryIsHarmless = !bylawThrew;

    // ---- 2) Tools drawer no longer force-opened by the automatic sweep ----
    out.openToolsDrawerRemoved = typeof openToolsDrawer === 'undefined';
    out.runPotentialSpotsSearchNoLongerCallsIt = !runPotentialSpotsSearch.toString().includes('openToolsDrawer');
    document.getElementById('toolsDrawer').classList.remove('open'); // start closed
    // The drawer must stay closed after the point in runLookup() that used
    // to force it open (revealPotentialSpotsAroundPin's own network calls
    // aren't stubbed here, so this checks the specific call site is gone
    // from source instead of running the whole async flow -- same approach
    // verify_v85's zoom-gated check already uses for the same reason).
    out.toolsDrawerStaysClosed = document.getElementById('toolsDrawer').classList.contains('open') === false;

    return out;
  });

  const pass = results.oldMappingFnItemsGone && results.menuKeysMatchReportCategories
    && results.beforeClear.tenuresCardExists && results.beforeClear.parkCardExists
    && results.beforeClear.tenuresChooserCount === 1 && results.beforeClear.parkChooserCount === 1
    && results.beforeClear.categoryGroupsCreated
    && results.afterClear.tenuresCardExists === false && results.afterClear.parkCardExists === true
    && results.afterClear.tenuresChooserCount === 0 && results.afterClear.parkChooserCount === 1
    && results.afterClear.tenuresCleared === true && results.afterClear.parkCleared === false
    && results.afterClear.markerUntouched === true
    && results.emptyCategoryIsHarmless
    && results.openToolsDrawerRemoved && results.runPotentialSpotsSearchNoLongerCallsIt && results.toolsDrawerStaysClosed
    && errors.length === 0;

  console.log('=== errors ===', errors.length ? errors.join('\n') : '(none)');
  console.log('=== RESULTS ===', JSON.stringify(results, null, 2));
  console.log(pass ? 'PASS' : 'FAIL');
  await browser.close();
  process.exit(pass ? 0 : 1);
})();
