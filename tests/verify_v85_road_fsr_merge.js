// Regression test for the v85 fix: "Reveal Road" only ever queried BC's
// Digital Road Atlas (the general public road network), never FTEN Road
// Section Lines (forest service/resource roads, including branches) -- so
// only "main roads" ever showed up, exactly as Karim reported. See
// docs/CHANGELOG.md's v85 section for the full root-cause writeup.
//
// Note: revealAllRoads() itself is zoom-gated via map.getZoom(), which the
// network-stubbed leaflet-stub.js can't return a real number for (a known,
// documented limitation -- see docs/PLAN.md / the stub's own comment), so
// this checks the fix at the two points that don't require going through
// that gate: the function's own source (does it actually fire both
// queries?) and the extracted drawing helper (does it actually register a
// clickable forest-service-road entry?).
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
    const src = revealAllRoads.toString();
    const out = {
      queriesDra: src.includes('LAYERS.draRoad.typeName'),
      queriesFsr: src.includes('LAYERS.road.typeName'),
      usesPromiseAll: /Promise\.all/.test(src),
    };

    // renderForestServiceRoads() -- the shared drawer both Reveal Road and
    // the single-click report now use -- actually registers a clickable
    // entry with real geometry.
    resetClickableSource('roadview');
    const fakeFsrFeature = {
      type: 'Feature',
      properties: { ROAD_SECTION_NAME: 'Test Branch Rd', FOREST_FILE_ID: 'A00001', ROAD_SECTION_ID: 1 },
      geometry: { type: 'LineString', coordinates: [[-123.1, 49.8], [-123.09, 49.81]] },
    };
    let threw = false, threwMsg = null;
    try { renderForestServiceRoads([fakeFsrFeature], roadViewLayer); } catch (e) { threw = true; threwMsg = e.message; }
    out.fsrRenderThrew = threw;
    out.fsrRenderThrewMsg = threwMsg;
    out.fsrRegisteredCount = currentClickableFeatures.filter(e => e.source === 'roadview' && e.icon === '🛣️').length;

    // The single-click report's own road block now delegates to the same
    // shared function instead of a second, duplicated copy of the drawing
    // logic.
    out.overlaysDelegatesToShared = renderMapOverlays.toString().includes('renderForestServiceRoads(roadR.features');

    return out;
  });

  const pass = results.queriesDra && results.queriesFsr && results.usesPromiseAll
    && !results.fsrRenderThrew && results.fsrRegisteredCount === 1
    && results.overlaysDelegatesToShared
    && errors.length === 0;

  console.log('=== errors ===', errors.length ? errors.join('\n') : '(none)');
  console.log('=== RESULTS ===', JSON.stringify(results, null, 2));
  console.log(pass ? 'PASS' : 'FAIL');
  await browser.close();
  process.exit(pass ? 0 : 1);
})();
