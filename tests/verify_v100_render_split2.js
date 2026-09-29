// Regression test for v100: pass 2 of docs/PLAN.md's map/render.js split
// (after v99's pass 1, the single-click report renderer) -- Shooting Spots.
// Moved to src/map/render.js: renderActiveCutblockOutlines(),
// renderActiveCutblockBuffers(), renderNearbyRoads(), their small dedicated
// helpers (activeCutblockPopup, bboxToBoundsLike, cutblockBufferStyle,
// cutblockBufferOutlineStyle, neighborPoint, squareEdgeSegment,
// DRA_ROAD_COLOR/DRA_ROAD_SPECIAL_COLOR/draRoadStyle/draRoadTooltip,
// SPOT_MIN_ZOOM/INFRA_MIN_ZOOM, startSpotsProgress/trackSpotsProgress/
// endSpotsProgress, spotSeq), and -- per this slice's own scope-correction
// writeup in src/map/render.js's top comment -- runPotentialSpotsSearch()
// itself plus its two callers revealPotentialSpots()/
// revealPotentialSpotsAroundPin(), since the two "reveal" functions turned
// out to be thin wrappers around that one shared engine rather than doing
// any real work of their own.
//
// Same v98/v99 lesson applies here: this file loads *before* the main inline
// script creates `map`, so this test's functional checks only pass if
// `spotLayer`'s own top-level `L.layerGroup().addTo(map)` declaration really
// did stay inline (per the scope note) while every function that reads it
// moved cleanly.
//
// Unlike v99's test (which could exercise renderMapOverlays() directly with
// already-fetched fake data), runPotentialSpotsSearch() fires ~10 concurrent
// WFS/Overpass queries itself via queryLayer()/queryOsmBuildings() (both
// already covered by their own src/data/wfs.js split, v97) -- so this test
// stubs those two hosts at the network level (page.route, same technique
// already used here for cdnjs/fonts) and calls revealPotentialSpotsAroundPin()
// for real, end-to-end, the strongest possible proof this pass's split
// didn't just "not throw yet" but the whole call chain -- wrapper -> engine
// -> the three moved render functions -> the chooser (src/map/chooser.js) --
// actually still works.
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

  // Every WFS layer query runPotentialSpotsSearch() fires (parcels x2, parks,
  // municipalities, tenures, woodlots, cutblocks, active cutting permits,
  // DRA roads) goes through queryLayer() -> wfsUrl() -> this host. Return an
  // empty-but-valid FeatureCollection for all of them -- this test cares
  // whether the split's call chain runs to completion and wires up the
  // chooser correctly, not about exercising the real classification logic
  // (already covered by this repo's pre-split verify_v4x-v7x scripts).
  await page.route('**://openmaps.gov.bc.ca/**', route => route.fulfill({
    status: 200, contentType: 'application/json', body: JSON.stringify({ type: 'FeatureCollection', features: [] })
  }));
  // queryOsmBuildings() tries these two Overpass hosts in turn.
  await page.route('**://overpass-api.de/**', route => route.fulfill({
    status: 200, contentType: 'application/json', body: JSON.stringify({ elements: [] })
  }));
  await page.route('**://overpass.kumi.systems/**', route => route.fulfill({
    status: 200, contentType: 'application/json', body: JSON.stringify({ elements: [] })
  }));

  await page.goto('file://' + path.join(ROOT, 'index.html'), { waitUntil: 'load', timeout: 60000 });
  await page.waitForTimeout(800);

  const results = await page.evaluate(async () => {
    const out = {};

    // ---- typeof / presence checks for everything this slice moved ----
    out.renderActiveCutblockOutlinesType = typeof renderActiveCutblockOutlines;
    out.renderActiveCutblockBuffersType = typeof renderActiveCutblockBuffers;
    out.renderNearbyRoadsType = typeof renderNearbyRoads;
    out.revealPotentialSpotsType = typeof revealPotentialSpots;
    out.revealPotentialSpotsAroundPinType = typeof revealPotentialSpotsAroundPin;
    out.runPotentialSpotsSearchType = typeof runPotentialSpotsSearch;
    out.activeCutblockPopupType = typeof activeCutblockPopup;
    out.bboxToBoundsLikeType = typeof bboxToBoundsLike;
    out.cutblockBufferStyleType = typeof cutblockBufferStyle;
    out.cutblockBufferOutlineStyleType = typeof cutblockBufferOutlineStyle;
    out.neighborPointType = typeof neighborPoint;
    out.squareEdgeSegmentType = typeof squareEdgeSegment;
    out.draRoadStyleType = typeof draRoadStyle;
    out.draRoadTooltipType = typeof draRoadTooltip;
    out.pal = MAP_PAL; out.fill = MAP_FILL; out.w = MAP_W;
    out.draRoadColor = DRA_ROAD_COLOR;
    out.draRoadSpecialColor = DRA_ROAD_SPECIAL_COLOR;
    out.spotMinZoom = SPOT_MIN_ZOOM;
    out.infraMinZoom = INFRA_MIN_ZOOM;
    out.startSpotsProgressType = typeof startSpotsProgress;
    out.trackSpotsProgressType = typeof trackSpotsProgress;
    out.endSpotsProgressType = typeof endSpotsProgress;
    out.spotSeqType = typeof spotSeq;

    // ---- functional check 1: bboxToBoundsLike + cutblock buffer/outline
    // style/popup helpers are pure and easy to exercise directly ----
    const blike = bboxToBoundsLike([-123.2, 49.2, -123.1, 49.3]);
    out.bboxToBoundsLikeOk = blike.getSouthWest().lat === 49.2 && blike.getNorthEast().lng === -123.1;
    out.cutblockBufferStyleSample = cutblockBufferStyle();
    out.cutblockBufferOutlineStyleSample = cutblockBufferOutlineStyle();
    const neighbor = neighborPoint([-123.1, 49.2], 100, 'N');
    out.neighborPointMoved = neighbor[1] > 49.2;
    const edge = squareEdgeSegment([-123.1, 49.2], 100, 'N');
    out.squareEdgeSegmentType2 = edge.geometry.type;
    out.activeCutblockPopupHasText = activeCutblockPopup({ CUT_BLOCK_ID: 'XY123' }).includes('XY123');
    out.draRoadStyleSpecial = draRoadStyle(true).color === DRA_ROAD_SPECIAL_COLOR;
    out.draRoadStyleNormal = draRoadStyle(false).color === DRA_ROAD_COLOR;
    out.draRoadTooltipHasText = draRoadTooltip({ ROAD_CLASS: 'Local' }, false, 25).includes('25m');

    // ---- functional check 2: call the three moved render functions
    // directly with fake data (same pattern verify_v99 used for
    // renderMapOverlays) and confirm they run to completion and register
    // with the shared chooser (src/map/chooser.js) ----
    resetClickableSource('spots');
    const fakeCutblock = {
      type: 'Feature',
      geometry: { type: 'Polygon', coordinates: [[[-123.15, 49.25], [-123.14, 49.25], [-123.14, 49.26], [-123.15, 49.26], [-123.15, 49.25]]] },
      properties: { CUT_BLOCK_ID: 'TEST1' }
    };
    let directThrew = false, directErr = null;
    try {
      renderActiveCutblockOutlines([fakeCutblock], spotLayer);
      renderActiveCutblockBuffers([fakeCutblock], spotLayer);
      renderNearbyRoads([{ geometry: { type: 'LineString', coordinates: [[-123.15, 49.25], [-123.14, 49.26]] }, properties: { ROAD_CLASS: 'Local' }, special: null, bufferM: 25 }], spotLayer);
    } catch (e) { directThrew = true; directErr = e.message; }
    out.directThrew = directThrew;
    out.directErr = directErr;
    out.chooserRegisteredCutblock = currentClickableFeatures.some(f => f.source === 'spots' && f.rowLabel && f.rowLabel.includes('Active cutblock'));
    out.chooserRegisteredRoad = currentClickableFeatures.some(f => f.source === 'spots' && f.rowLabel && f.rowLabel.includes('Road'));
    resetClickableSource('spots'); // leave no test residue behind

    // ---- functional check 3: the real thing -- call
    // revealPotentialSpotsAroundPin() end-to-end (network-stubbed WFS +
    // Overpass, see the routes registered above) and confirm the whole
    // wrapper -> runPotentialSpotsSearch() -> render chain completes,
    // updates the status note, and registers 'spots'-tagged features with
    // the chooser. This is the real proof the split's cross-file call chain
    // works, not just that each piece exists.
    let e2eThrew = false, e2eErr = null;
    resetClickableSource('spots');
    try {
      await revealPotentialSpotsAroundPin(49.25, -123.15);
    } catch (e) { e2eThrew = true; e2eErr = e.message; }
    out.e2eThrew = e2eThrew;
    out.e2eErr = e2eErr;
    out.noteText = document.getElementById('mapActionsNote') ? document.getElementById('mapActionsNote').textContent : null;
    out.e2eChooserRegisteredSpots = currentClickableFeatures.some(f => f.source === 'spots');
    out.spotSeqAfter = spotSeq;
    resetClickableSource('spots'); // leave no test residue behind

    // Script tag order: src/map/render.js must appear after
    // src/map/chooser.js (this slice's functions call pushClickable()/
    // resetClickableSource()/openNearbyFeaturesPopupAt(), all defined
    // there) and before the main inline script.
    const scripts = Array.from(document.querySelectorAll('script'));
    const srcs = scripts.map(s => s.getAttribute('src'));
    out.chooserIdx = srcs.indexOf('src/map/chooser.js');
    out.renderIdx = srcs.indexOf('src/map/render.js');
    const mainInlineIdx = scripts.findIndex(s => !s.getAttribute('src') && s.textContent.includes('function openCutblockFromList'));
    out.mainInlineIdx = mainInlineIdx;

    return out;
  });

  // Also confirm, directly from disk (not the browser), that these
  // declarations no longer live inline in index.html and really do live in
  // src/map/render.js.
  const fsCheck = (() => {
    const html = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
    const scriptMatch = html.match(/<script>([\s\S]*)<\/script>/);
    const inline = scriptMatch ? scriptMatch[1] : '';
    const renderFile = fs.readFileSync(path.join(ROOT, 'src/map/render.js'), 'utf8');
    return {
      inlineHasRenderActiveCutblockOutlines: /\bfunction renderActiveCutblockOutlines\(/.test(inline),
      inlineHasRenderActiveCutblockBuffers: /\bfunction renderActiveCutblockBuffers\(/.test(inline),
      inlineHasRenderNearbyRoads: /\bfunction renderNearbyRoads\(/.test(inline),
      inlineHasRunPotentialSpotsSearch: /\basync function runPotentialSpotsSearch\(/.test(inline),
      inlineHasRevealPotentialSpots: /\basync function revealPotentialSpots\(\)/.test(inline),
      inlineHasRevealPotentialSpotsAroundPin: /\basync function revealPotentialSpotsAroundPin\(/.test(inline),
      inlineHasSpotSeqDecl: /\blet spotSeq\s*=/.test(inline),
      inlineHasStartSpotsProgress: /\bfunction startSpotsProgress\(/.test(inline),
      // Out-of-scope for this slice -- must still be inline.
      inlineHasSpotLayer: /\bconst spotLayer\s*=\s*L\.layerGroup\(\)\.addTo\(map\)/.test(inline),
      inlineHasCutblockFeatureLabel: /\bfunction cutblockFeatureLabel\(/.test(inline),
      inlineHasCutblockWarnDistance: /\bconst CUTBLOCK_WARN_DISTANCE_M\s*=/.test(inline),
      inlineHasBoundsAroundPoint: /\bfunction boundsAroundPoint\(/.test(inline),
      inlineHasRadiusCql: /\bfunction radiusCql\(/.test(inline),
      inlineHasSpotStyle: /\bfunction spotStyle\(/.test(inline),
      renderFileHasAll: [
        /\bfunction renderActiveCutblockOutlines\(/, /\bfunction renderActiveCutblockBuffers\(/,
        /\bfunction renderNearbyRoads\(/, /\basync function runPotentialSpotsSearch\(/,
        /\basync function revealPotentialSpots\(\)/, /\basync function revealPotentialSpotsAroundPin\(/,
        /\bfunction activeCutblockPopup\(/, /\bfunction bboxToBoundsLike\(/,
        /\bfunction cutblockBufferStyle\(/, /\bfunction cutblockBufferOutlineStyle\(/,
        /\bfunction neighborPoint\(/, /\bfunction squareEdgeSegment\(/,
        /\bconst DRA_ROAD_COLOR\s*=/, /\bconst DRA_ROAD_SPECIAL_COLOR\s*=/,
        /\bfunction draRoadStyle\(/, /\bfunction draRoadTooltip\(/,
        /\bconst SPOT_MIN_ZOOM\s*=/, /\bconst INFRA_MIN_ZOOM\s*=/,
        /\bfunction startSpotsProgress\(/, /\bfunction trackSpotsProgress\(/, /\bfunction endSpotsProgress\(/,
        /\blet spotSeq\s*=/,
      ].every(re => re.test(renderFile)),
    };
  })();

  const pass = results.renderActiveCutblockOutlinesType === 'function'
    && results.renderActiveCutblockBuffersType === 'function'
    && results.renderNearbyRoadsType === 'function'
    && results.revealPotentialSpotsType === 'function'
    && results.revealPotentialSpotsAroundPinType === 'function'
    && results.runPotentialSpotsSearchType === 'function'
    && results.activeCutblockPopupType === 'function'
    && results.bboxToBoundsLikeType === 'function'
    && results.cutblockBufferStyleType === 'function'
    && results.cutblockBufferOutlineStyleType === 'function'
    && results.neighborPointType === 'function'
    && results.squareEdgeSegmentType === 'function'
    && results.draRoadStyleType === 'function'
    && results.draRoadTooltipType === 'function'
    && results.draRoadColor === results.pal.roadPublic // v108: colours now come from MAP_PAL
    && results.draRoadSpecialColor === results.pal.roadHighway
    && results.spotMinZoom === 9
    && results.infraMinZoom === 12
    && results.startSpotsProgressType === 'function'
    && results.trackSpotsProgressType === 'function'
    && results.endSpotsProgressType === 'function'
    && results.spotSeqType === 'number'
    && results.bboxToBoundsLikeOk === true
    && results.cutblockBufferStyleSample.fillOpacity === results.fill.emphasis // v108: was 0.20
    && results.cutblockBufferOutlineStyleSample.weight === results.w.line // v108: was 2
    && results.neighborPointMoved === true
    && results.squareEdgeSegmentType2 === 'LineString'
    && results.activeCutblockPopupHasText === true
    && results.draRoadStyleSpecial === true
    && results.draRoadStyleNormal === true
    && results.draRoadTooltipHasText === true
    && results.directThrew === false
    && results.chooserRegisteredCutblock === true
    && results.chooserRegisteredRoad === true
    && results.e2eThrew === false
    && typeof results.noteText === 'string' && results.noteText.length > 0
    && results.e2eChooserRegisteredSpots === true
    && results.spotSeqAfter >= 1
    && results.chooserIdx !== -1 && results.renderIdx !== -1
    && results.chooserIdx < results.renderIdx
    && results.mainInlineIdx !== -1
    && results.renderIdx < results.mainInlineIdx
    && !fsCheck.inlineHasRenderActiveCutblockOutlines && !fsCheck.inlineHasRenderActiveCutblockBuffers
    && !fsCheck.inlineHasRenderNearbyRoads && !fsCheck.inlineHasRunPotentialSpotsSearch
    && !fsCheck.inlineHasRevealPotentialSpots && !fsCheck.inlineHasRevealPotentialSpotsAroundPin
    && !fsCheck.inlineHasSpotSeqDecl && !fsCheck.inlineHasStartSpotsProgress
    && fsCheck.inlineHasSpotLayer && fsCheck.inlineHasCutblockFeatureLabel
    && fsCheck.inlineHasCutblockWarnDistance && fsCheck.inlineHasBoundsAroundPoint
    && fsCheck.inlineHasRadiusCql && fsCheck.inlineHasSpotStyle
    && fsCheck.renderFileHasAll
    && errors.length === 0;

  console.log('=== errors ===', errors.length ? errors.join('\n') : '(none)');
  console.log('=== RESULTS ===', JSON.stringify({ ...results, fsCheck }, null, 2));
  console.log(pass ? 'PASS' : 'FAIL');
  await browser.close();
  process.exit(pass ? 0 : 1);
})();
