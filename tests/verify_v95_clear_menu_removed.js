// Regression test for v95: the "Clear ▾" dropdown (v86, reworked in v87 --
// the broom-icon button in the Tools drawer's Mapping Functions group that
// popped out one clear action per report section) has been removed
// entirely at Karim's request ("Clear all markings should be removed" --
// confirmed via follow-up as the popout menu next to the Mapping Functions
// buttons, not My Markup or a "Clear All" button from an earlier version).
//
// This checks the feature is gone cleanly: no dangling ids/classes in the
// DOM, no leftover functions/globals, no dead references to a removed
// element, and that the Mapping Functions group still has exactly the
// three buttons that remain (View Parcels, Shooting Spots, Reveal Road) --
// not that it silently lost one of those too.
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
    out.clearMenuBtnGone = !document.getElementById('clearMenuBtn');
    out.clearMenuGone = !document.getElementById('clearMenu');
    out.clearMenuRowGone = !document.getElementById('clearMenuRow');
    out.clearInfoBtnGone = !document.getElementById('clearInfoBtn');
    out.clearMenuItemsGone = document.querySelectorAll('.clear-menu-item').length === 0;
    out.clearReportCategoryGone = typeof clearReportCategory === 'undefined';
    out.setMapActionsNoteGone = typeof setMapActionsNote === 'undefined';
    out.clearBlurbGone = typeof CLEAR_BLURB_HTML === 'undefined';

    // The rest of the Mapping Functions group must be untouched -- this
    // removal should only take the Clear row with it, not collateral
    // damage the three buttons/handlers that stay.
    out.viewParcelsStillThere = !!document.getElementById('revealParcelsBtn');
    out.shootingSpotsStillThere = !!document.getElementById('revealSpotsBtn');
    out.revealRoadStillThere = !!document.getElementById('revealRoadBtn');
    const mappingRows = document.querySelectorAll('.td-group .ma-row');
    out.mappingRowCount = mappingRows.length; // exactly 3 now, was 4
    out.mapActionsNoteStillThere = !!document.getElementById('mapActionsNote'); // shared status line stays -- other buttons still write to it directly

    // overlayCategoryLayers is the underlying per-category shape-drawing
    // data structure used by renderMapOverlays() -- it predates and is
    // unrelated to the Clear feature (Clear only ever called
    // .clearLayers() on entries in it), so removing Clear must not have
    // touched it.
    out.overlayCategoryLayersStillThere = typeof overlayCategoryLayers === 'object';

    return out;
  });

  const html = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
  results.noSourceReferencesLeft = !/clearMenu|clearReportCategory|CLEAR_BLURB_HTML|setMapActionsNote|clear-menu/i.test(html);

  const pass = results.clearMenuBtnGone
    && results.clearMenuGone
    && results.clearMenuRowGone
    && results.clearInfoBtnGone
    && results.clearMenuItemsGone
    && results.clearReportCategoryGone
    && results.setMapActionsNoteGone
    && results.clearBlurbGone
    && results.viewParcelsStillThere
    && results.shootingSpotsStillThere
    && results.revealRoadStillThere
    && results.mappingRowCount === 3
    && results.mapActionsNoteStillThere
    && results.overlayCategoryLayersStillThere
    && results.noSourceReferencesLeft
    && errors.length === 0;

  console.log('=== errors ===', errors.length ? errors.join('\n') : '(none)');
  console.log('=== RESULTS ===', JSON.stringify(results, null, 2));
  console.log(pass ? 'PASS' : 'FAIL');
  await browser.close();
  process.exit(pass ? 0 : 1);
})();
