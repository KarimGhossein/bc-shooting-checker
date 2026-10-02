// Regression test for v110:
//   - "Clear all layers" is the first Clear menu item and empties every
//     map-tool layer and report-category layer, leaving markup alone;
//   - Shooting Spots draws only possible spots (no restricted shapes, roads,
//     or active-cutblock outline/buffer in its run);
//   - a markup pin captures a full location report (snapshot mode of
//     renderReport), shows it, stores it, and round-trips through export.
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
    // ---- clear all ----
    const first = document.querySelector('#clearMenu .clear-menu-item');
    out.clearAllFirst = first && first.dataset.key === 'all';
    const cleared = [];
    Object.keys(MAP_TOOL_LAYERS).forEach(k => { const orig = MAP_TOOL_LAYERS[k]; MAP_TOOL_LAYERS[k] = () => { cleared.push(k); orig(); }; });
    overlayCategoryLayers = { park: { clearLayers(){ cleared.push('overlay:park'); } }, tenures: { clearLayers(){ cleared.push('overlay:tenures'); } } };
    let markupTouched = false; const origClear = markupLayer.clearLayers; markupLayer.clearLayers = () => { markupTouched = true; };
    const seqBefore = spotSeq;
    first.click();
    out.clearAllClearedEverything = ['parcelview','spots','roadview','overlay:park','overlay:tenures'].every(k => cleared.includes(k));
    out.clearAllLeftMarkup = !markupTouched;
    out.clearAllCancelsSearch = spotSeq === seqBefore + 1;
    out.clearAllNote = document.getElementById('mapActionsNote').textContent;
    markupLayer.clearLayers = origClear;

    // ---- spots only ----
    const src = runPotentialSpotsSearch.toString();
    out.spotsNoRestrictedDraw = !/restrictedStyle\(\)/.test(src);
    out.spotsNoRoadsOrCutblockDraw = !/renderNearbyRoads\(/.test(src) && /renderActiveCutblockBuffers\(activeCuts/.test(src); // v110c: cutblock buffer drawn again, roads still not
    out.spotsActiveLoggingAdvisory = /ACTIVE_LOGGING_ADVISORY/.test(src);

    // ---- v110d: open permit on a long-finished block is not "active logging" ----
    const now = new Date('2026-10-02T12:00:00');
    out.loggingRule = isLoggingLikelyNow('ACTIVE', null, now) === true
      && isLoggingLikelyNow('ACTIVE', '2026-06-01', now) === true
      && isLoggingLikelyNow('ACTIVE', '2022-07-04', now) === false
      && isLoggingLikelyNow('RETIRED', null, now) === false;
    const real = buildCutblockList(
      { ok: true, features: [{ properties: { OPENING_ID: 1765734, OPENING_STATUS_CODE: 'APP', DISTURBANCE_START_DATE: '2022-05-25Z', DISTURBANCE_END_DATE: '2022-07-04Z', PLANTING_1_COMPLETION_DATE: '2025-05-17Z', PLANTING_2_COMPLETION_DATE: '2024-06-29Z' }, geometry: null }] },
      { ok: true, features: [{ properties: { OPENING_ID: 1765734, LIFE_CYCLE_STATUS_CODE: 'ACTIVE', CUT_BLOCK_ID: 'CBK0025' }, geometry: null }] },
      { '1765734': { HARVEST_END_DATE: '2022-07-04Z' } })[0];
    out.realBlockText = cutblockStateText(real);
    out.realBlockLabelled = out.realBlockText === 'Harvested 2022, replanted 2025, permit still open';

    // v110e: FTEN-only block, cut 2005 to 2007, permit RETIRED -> green
    const fenOnly = buildCutblockList({ ok: true, features: [] },
      { ok: true, features: [{ properties: { CUT_BLOCK_ID: 'B', LIFE_CYCLE_STATUS_CODE: 'RETIRED', HARVEST_AUTH_STATUS_CODE: 'HC', DISTURBANCE_START_DATE: '2005-10-03Z', DISTURBANCE_END_DATE: '2007-05-26Z' }, geometry: null }] }, {})[0];
    out.fentenOnlyHarvestedIsGreen = cutblockColor(fenOnly) === MAP_PAL.clear;
    out.startedNotFinishedIsRed = cutblockColor({ disturbanceStart: '2026-05-01' }) === MAP_PAL.restricted;

    // ---- pin reports ----
    const okEmpty = { ok: true, features: [] };
    const fake = { lat: 49.5, lng: -121.5, parcelR: okEmpty, muniR: okEmpty, parkR: okEmpty, cutR: okEmpty, cutPlanR: okEmpty, cutList: [],
      tenureR: okEmpty, woodlotR: okEmpty, roadR: okEmpty, open511R: { ok: true, events: [] }, nearbyParcelR: okEmpty,
      recSiteR: okEmpty, recPolyR: okEmpty, recLineR: okEmpty, recList: [], mvprRoutesR: okEmpty, mvprAreasR: okEmpty, mvprList: [], wmaR: okEmpty,
      muR: { ok: true, features: [{ properties: { WILDLIFE_MGMT_UNIT_ID: '3-17' }, geometry: null }] } };
    fetchLocationData = async () => fake;
    document.getElementById('report').innerHTML = '<p id="untouched">live report</p>';
    const item = addMarkupItem(L.marker([49.5, -121.5]), 'marker', { name: 'Test pin' });
    await attachPinReport(item);
    out.pinReportDone = !!item.report && item.report.status === 'done' && /card-mu/.test(item.report.html) && /card-buildings/.test(item.report.html);
    out.liveReportUntouched = !!document.getElementById('untouched');
    out.pinReportHasLevel = !!item.report.level && !!item.report.label && !!item.report.checkedAt;
    out.popupHasViewButton = /View report/.test(markupPopupHtml(item));
    showPinReport(item.id);
    out.showPinReportBanner = !!document.querySelector('#report .saved-report-banner') && !!document.getElementById('card-mu');
    const feat = markupItemToFeature(item);
    out.exportCarriesReport = !!feat.properties.report && feat.properties.report.status === 'done';
    const before = markupItems.length;
    loadMarkupFromFeatureCollection({ type: 'FeatureCollection', features: [{ type: 'Feature', geometry: { type: 'Point', coordinates: [-121.5, 49.5] }, properties: feat.properties }] }, { regenerateIds: true }); // stub Leaflet has no real toGeoJSON geometry
    const imported = markupItems[markupItems.length - 1];
    out.importKeepsReport = markupItems.length === before + 1 && !!imported.report && imported.report.status === 'done';
    return out;
  });

  const pass = Object.entries(r).every(([k, v]) => k === 'clearAllNote' || k === 'realBlockText' || v === true) && errors.length === 0;
  console.log('=== errors ===', errors.length ? errors.join('\n') : '(none)');
  console.log('=== RESULTS ===', JSON.stringify(r, null, 2));
  console.log(pass ? 'PASS' : 'FAIL');
  await browser.close();
  process.exit(pass ? 0 : 1);
})();
