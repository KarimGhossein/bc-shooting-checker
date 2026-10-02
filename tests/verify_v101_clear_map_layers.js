// Regression test for v101: "Any layer that's shown on the map should have
// a Clear option in the clear menu." Adds three new items to the existing
// Clear ▾ dropdown (v86/v87), parcelview, spots, roadview, one per
// Mapping Functions layer (View Parcels/Shooting Spots/Reveal Road) that
// draws its own map shapes entirely outside the single-click report and,
// until now, had no way to be reset without re-running its own (possibly
// slow) query. These three route through a new clearMapToolLayer() rather
// than the existing clearReportCategory(), since they have no report card
// to remove and use a plain chooser 'source' tag (parcelview/spots/
// roadview) instead of the 'overlay:<key>' scheme the report categories use.
//
// Also confirms a real, unrelated bug found while making this change is
// fixed: SHOOTING_SPOTS_BLURB_HTML's help text used to tell users to press
// "Clear Potential Spots", a button v86 removed when it introduced this
// same Clear ▾ dropdown, five versions before this one. That instruction
// pointed at nothing.
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

  const results = await page.evaluate(() => {
    const out = {};

    // ---- menu structure: three new items, correctly positioned/keyed ----
    const menuKeys = Array.from(document.querySelectorAll('#clearMenu .clear-menu-item')).map(b => b.dataset.key).filter(k => k !== 'all'); // v110: 'Clear all layers' sits first
    out.menuKeys = menuKeys;
    out.threeNewItemsFirst = JSON.stringify(menuKeys.slice(0, 3)) === JSON.stringify(['parcelview', 'spots', 'roadview']);
    out.totalItemCount = menuKeys.length;
    out.mapToolLayersType = typeof MAP_TOOL_LAYERS;
    out.clearMapToolLayerType = typeof clearMapToolLayer;
    out.mapToolLayerKeysMatch = JSON.stringify(Object.keys(MAP_TOOL_LAYERS).sort()) === JSON.stringify(['parcelview', 'roadview', 'spots'].sort());

    const square = { type: 'Polygon', coordinates: [[[-122.51, 51.49], [-122.49, 51.49], [-122.49, 51.51], [-122.51, 51.51], [-122.51, 51.49]]] };

    // ---- functional check 1: View Parcels (parcelview) ----
    parcelViewFeatures = [{ type: 'Feature', geometry: square, properties: { OWNER_TYPE: 'Crown Provincial' } }];
    drawParcelViewLayer(parcelViewFeatures);
    resetClickableSource('spots'); // seed an unrelated source to prove it's untouched
    pushClickable(square, '', 'unrelated spot', 'spot', 'html');
    out.beforeParcelviewClear = {
      parcelviewCount: currentClickableFeatures.filter(f => f.source === 'parcelview').length,
      spotsCount: currentClickableFeatures.filter(f => f.source === 'spots').length,
    };
    let parcelviewThrew = false, parcelviewErr = null;
    try { clearMapToolLayer('parcelview', 'View Parcels'); } catch (e) { parcelviewThrew = true; parcelviewErr = e.message; }
    out.parcelviewThrew = parcelviewThrew;
    out.parcelviewErr = parcelviewErr;
    out.afterParcelviewClear = {
      parcelviewCount: currentClickableFeatures.filter(f => f.source === 'parcelview').length,
      spotsCount: currentClickableFeatures.filter(f => f.source === 'spots').length, // must survive, different source
      parcelViewFeaturesReset: Array.isArray(parcelViewFeatures) && parcelViewFeatures.length === 0,
      noteText: document.getElementById('mapActionsNote').textContent,
    };
    resetClickableSource('spots'); // clean up the seeded unrelated entry

    // ---- functional check 2: Shooting Spots (spots) ----
    resetClickableSource('spots');
    pushClickable(square, '', 'Potential spot, test', 'Potential spot', 'html');
    spotDetails = ['stale detail'];
    gapDetails = ['stale gap'];
    restrictedDetails = ['stale restricted'];
    resetClickableSource('roadview'); // seed an unrelated source
    pushClickable(square, '', 'unrelated road', 'Road', 'html');
    let spotsThrew = false, spotsErr = null;
    try { clearMapToolLayer('spots', 'Shooting Spots'); } catch (e) { spotsThrew = true; spotsErr = e.message; }
    out.spotsThrew = spotsThrew;
    out.spotsErr = spotsErr;
    out.afterSpotsClear = {
      spotsCount: currentClickableFeatures.filter(f => f.source === 'spots').length,
      roadviewCount: currentClickableFeatures.filter(f => f.source === 'roadview').length, // must survive
      spotDetailsReset: Array.isArray(spotDetails) && spotDetails.length === 0,
      gapDetailsReset: Array.isArray(gapDetails) && gapDetails.length === 0,
      restrictedDetailsReset: Array.isArray(restrictedDetails) && restrictedDetails.length === 0,
      noteText: document.getElementById('mapActionsNote').textContent,
    };
    resetClickableSource('roadview'); // clean up the seeded unrelated entry

    // ---- functional check 3: Reveal Road (roadview) ----
    resetClickableSource('roadview');
    pushClickable(square, '', 'Road, test', 'Road', 'html');
    resetClickableSource('parcelview'); // seed an unrelated source
    pushClickable(square, '', 'unrelated parcel', 'Parcel', 'html');
    let roadviewThrew = false, roadviewErr = null;
    try { clearMapToolLayer('roadview', 'Reveal Road'); } catch (e) { roadviewThrew = true; roadviewErr = e.message; }
    out.roadviewThrew = roadviewThrew;
    out.roadviewErr = roadviewErr;
    out.afterRoadviewClear = {
      roadviewCount: currentClickableFeatures.filter(f => f.source === 'roadview').length,
      parcelviewCount: currentClickableFeatures.filter(f => f.source === 'parcelview').length, // must survive
      noteText: document.getElementById('mapActionsNote').textContent,
    };
    resetClickableSource('parcelview'); // clean up the seeded unrelated entry

    // ---- functional check 4: real DOM click on a menu item routes to
    // clearMapToolLayer(), not clearReportCategory(), distinguishable by
    // the note text ("...cleared from the map." vs "...and report.") ----
    resetClickableSource('spots');
    pushClickable(square, '', 'Potential spot, test2', 'Potential spot', 'html');
    document.getElementById('clearMenuBtn').click(); // open the dropdown
    document.querySelector('#clearMenu .clear-menu-item[data-key="spots"]').click();
    out.domClickNoteText = document.getElementById('mapActionsNote').textContent;
    out.domClickClearedSpots = currentClickableFeatures.filter(f => f.source === 'spots').length === 0;
    out.domClickMenuClosed = document.getElementById('clearMenu').hidden === true;

    // ---- functional check 5: an unknown key is still routed correctly
    // (report categories still work exactly as before, e.g. via the
    // MAP_TOOL_LAYERS[key] lookup returning undefined -> falls through to
    // clearReportCategory) ----
    let reportCategoryStillWorks = false, reportCategoryErr = null;
    try {
      clearReportCategory('bylaw', 'Bylaw Lookup'); // no map shapes for this one, must be a harmless no-op, not throw
      reportCategoryStillWorks = true;
    } catch (e) { reportCategoryErr = e.message; }
    out.reportCategoryStillWorks = reportCategoryStillWorks;
    out.reportCategoryErr = reportCategoryErr;

    // ---- stale help text fixed ----
    out.shootingSpotsBlurbMentionsRemovedButton = TOOLS_HELP_HTML.includes('Clear Potential Spots'); // v109: the four tool blurbs merged into TOOLS_HELP_HTML
    out.clearBlurbMentionsThreeLayers = ['parcelview','spots','roadview'].every(k => !!document.querySelector(`.clear-menu-item[data-key="${k}"]`)); // v109: help text shortened; the menu itself lists the three layers

    return out;
  });

  // Disk-level check: the new function/data + menu items are really in
  // index.html (not just working because of some other happy accident).
  const fsCheck = (() => {
    const html = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
    return {
      hasMapToolLayersConst: /\bconst MAP_TOOL_LAYERS\s*=/.test(html),
      hasClearMapToolLayerFn: /\bfunction clearMapToolLayer\(/.test(html),
      hasParcelviewButton: /data-key="parcelview"/.test(html),
      hasSpotsButton: /data-key="spots"/.test(html),
      hasRoadviewButton: /data-key="roadview"/.test(html),
    };
  })();

  const pass = results.threeNewItemsFirst
    && results.totalItemCount === 17 // v109: + Management Unit
    && results.mapToolLayersType === 'object'
    && results.clearMapToolLayerType === 'function'
    && results.mapToolLayerKeysMatch === true
    && results.beforeParcelviewClear.parcelviewCount === 1
    && results.beforeParcelviewClear.spotsCount === 1
    && results.parcelviewThrew === false
    && results.afterParcelviewClear.parcelviewCount === 0
    && results.afterParcelviewClear.spotsCount === 1
    && results.afterParcelviewClear.parcelViewFeaturesReset === true
    && results.afterParcelviewClear.noteText === 'View Parcels cleared from the map.'
    && results.spotsThrew === false
    && results.afterSpotsClear.spotsCount === 0
    && results.afterSpotsClear.roadviewCount === 1
    && results.afterSpotsClear.spotDetailsReset === true
    && results.afterSpotsClear.gapDetailsReset === true
    && results.afterSpotsClear.restrictedDetailsReset === true
    && results.afterSpotsClear.noteText === 'Shooting Spots cleared from the map.'
    && results.roadviewThrew === false
    && results.afterRoadviewClear.roadviewCount === 0
    && results.afterRoadviewClear.parcelviewCount === 1
    && results.afterRoadviewClear.noteText === 'Reveal Road cleared from the map.'
    && results.domClickClearedSpots === true
    && results.domClickNoteText.includes('cleared from the map.') && !results.domClickNoteText.includes('and report')
    && results.domClickMenuClosed === true
    && results.reportCategoryStillWorks === true
    && results.shootingSpotsBlurbMentionsRemovedButton === false
    && results.clearBlurbMentionsThreeLayers === true
    && fsCheck.hasMapToolLayersConst && fsCheck.hasClearMapToolLayerFn
    && fsCheck.hasParcelviewButton && fsCheck.hasSpotsButton && fsCheck.hasRoadviewButton
    && errors.length === 0;

  console.log('=== errors ===', errors.length ? errors.join('\n') : '(none)');
  console.log('=== RESULTS ===', JSON.stringify({ ...results, fsCheck }, null, 2));
  console.log(pass ? 'PASS' : 'FAIL');
  await browser.close();
  process.exit(pass ? 0 : 1);
})();
