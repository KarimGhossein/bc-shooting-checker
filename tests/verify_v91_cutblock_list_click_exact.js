// Regression test for v91: clicking a cutblock in the report list must
// always open exactly that cutblock's own popup -- never the shared "N
// records here" chooser (openNearbyFeaturesPopupAt()), even when that
// cutblock genuinely overlaps another registered feature at its centroid.
//
// v76 originally wired this list click through openNearbyFeaturesPopupAt()
// to get "the identical popup a real map click would produce," but that
// function re-tests the click point against *every* registered feature, so
// an overlap at the cutblock's own centroid could open the ambiguous
// chooser instead of the one record Karim actually picked from the list --
// the opposite of what a list click should ever do, since choosing a row
// already resolved which record is meant. See docs/CHANGELOG.md's v91
// section and openCutblockFromList()'s own comment.
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
    const square = { type: 'Polygon', coordinates: [[[-122.51, 51.49], [-122.49, 51.49], [-122.49, 51.51], [-122.51, 51.51], [-122.51, 51.49]]] };

    let bringToFrontCalled = false, setStyleCalls = 0;
    const fakeEntry = {
      openingId: 'TEST-1',
      statusLabel: 'FG',
      geometry: square,
      mapLayer: {
        getBounds: () => L.latLngBounds([[51.49, -122.51], [51.51, -122.49]]),
        setStyle(){ setStyleCalls++; },
        bringToFront(){ bringToFrontCalled = true; },
      },
    };
    currentCutOpenings = [fakeEntry];

    // Register a second, genuinely overlapping feature (a tenure) at the
    // exact same geometry/point -- the scenario that used to trigger the
    // ambiguous chooser via openNearbyFeaturesPopupAt().
    resetClickableSource('overlay:cutblocks');
    pushClickable(square, '🪵', 'TEST-1', '🪵 TEST-1', cutblockPopup(fakeEntry));
    resetClickableSource('overlay:tenures');
    pushClickable(square, '📜', 'Overlapping tenure', '📜 Tenure', '<div>tenure detail</div>');

    // Capture the exact popup content opened -- see v89/v90 tests for why
    // (the network-stubbed L.popup() never touches the real DOM).
    const realL = window.L;
    let capturedContent = null;
    window.L = new Proxy(realL, {
      get(t, prop){
        if(prop === 'popup') return (...args) => {
          const fake = { setLatLng(){ return fake; }, setContent(html){ capturedContent = html; return fake; }, openOn(){ return fake; } };
          return fake;
        };
        return t[prop];
      },
    });

    let threw = false, threwMsg = null;
    try { showCutblockDetail(0); } catch(e) { threw = true; threwMsg = e.message; }
    window.L = realL;

    out.threw = threw;
    out.threwMsg = threwMsg;
    out.bringToFrontCalled = bringToFrontCalled;
    out.capturedContent = capturedContent || '';
    out.matchesOwnPopup = out.capturedContent === cutblockPopup(fakeEntry);
    out.containsOwnId = out.capturedContent.includes('TEST-1');
    out.mentionsRecordsHere = /records here/i.test(out.capturedContent);
    out.mentionsTenure = out.capturedContent.includes('tenure detail') || out.capturedContent.includes('Overlapping tenure');

    // Two genuinely overlapping records really were registered at this
    // point (sanity check that this test scenario is the real ambiguous
    // case, not an accidental no-op) -- a real map click here would still
    // correctly show the chooser; only the list-click path should skip it.
    const lineTolM = pixelToleranceMeters({lat:51.5,lng:-122.5}, NEARBY_CLICK_LINE_TOLERANCE_PX);
    const pointTolM = pixelToleranceMeters({lat:51.5,lng:-122.5}, NEARBY_CLICK_POINT_TOLERANCE_PX);
    const realMatches = currentClickableFeatures.filter(f => featureNearPoint(f, {lat:51.5,lng:-122.5}, lineTolM, pointTolM));
    out.realOverlapCount = realMatches.length;

    // ---- Fallback path (no mapLayer, e.g. an oversized/flagged entry with
    // no drawn shape) must still open the info modal exactly as before --
    // unaffected by this change, spot-checked here for a real regression.
    const oversizedEntry = { openingId: 'TEST-2', statusLabel: 'FG', oversized: true, grossArea: 9999 };
    let modalTitle = null, modalBody = null;
    const realOpenInfoModal = window.openInfoModal;
    window.openInfoModal = (title, body) => { modalTitle = title; modalBody = body; };
    let threw2 = false;
    try { openCutblockFromList(oversizedEntry); } catch(e) { threw2 = true; }
    window.openInfoModal = realOpenInfoModal;
    out.fallbackThrew = threw2;
    out.fallbackOpenedModal = modalTitle != null && modalBody != null;
    out.fallbackModalHasId = (modalTitle || '').includes('TEST-2') || (modalBody || '').includes('TEST-2');

    return out;
  });

  const pass = !results.threw
    && results.bringToFrontCalled === true
    && results.matchesOwnPopup === true
    && results.containsOwnId === true
    && results.mentionsRecordsHere === false
    && results.mentionsTenure === false
    && results.realOverlapCount === 2
    && !results.fallbackThrew
    && results.fallbackOpenedModal === true
    && results.fallbackModalHasId === true
    && errors.length === 0;

  console.log('=== errors ===', errors.length ? errors.join('\n') : '(none)');
  console.log('=== RESULTS ===', JSON.stringify(results, null, 2));
  console.log(pass ? 'PASS' : 'FAIL');
  await browser.close();
  process.exit(pass ? 0 : 1);
})();
