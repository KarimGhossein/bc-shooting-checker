// Regression test for v99: the fourth slice of docs/PLAN.md's module split
// (after v92's config/*.js, v97's data/wfs.js, and v98's map/chooser.js) --
// and the first of the plan's own multi-pass plan for map/render.js itself
// ("report-click rendering, then Shooting Spots, then View Parcels/Reveal
// Road -- not all at once"). This pass moves OVERLAY_CATEGORY_KEYS/
// overlayCategoryLayers, renderForestServiceRoads(), renderMapOverlays(),
// and cutblockColor()/cutblockStyle()/cutblockHighlightStyle() to
// src/map/render.js, loaded as a plain classic <script src> (not an ES
// module -- see that file's own top comment, and docs/PLAN.md's "Why
// classic scripts" section, for why).
//
// Like v98's chooser.js, this file is loaded *before* the main inline
// script creates `map` -- so, same as verify_v98_chooser_split.js, this
// test's real value is confirming the split didn't just "not throw yet"
// but actually still works when renderMapOverlays() is called for real
// (which only happens after `map` exists, well after chooser.js/render.js
// themselves finished loading).
//
// Existing tests already exercise renderMapOverlays() end-to-end far more
// thoroughly than this file attempts to (verify_v79, verify_v81, the
// verify_v82_* family, verify_v83, verify_v91) -- this test instead
// confirms the *split itself* took cleanly, the same way
// verify_v92_config_split.js / verify_v97_wfs_split.js /
// verify_v98_chooser_split.js do for their own slices. All of those
// existing tests still passing unchanged is the real proof this slice
// didn't break renderMapOverlays' actual behaviour.
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
    out.overlayCategoryKeysType = Array.isArray(OVERLAY_CATEGORY_KEYS) ? 'array' : typeof OVERLAY_CATEGORY_KEYS;
    out.overlayCategoryKeysLen = OVERLAY_CATEGORY_KEYS.length;
    out.overlayCategoryLayersType = typeof overlayCategoryLayers;
    out.renderForestServiceRoadsType = typeof renderForestServiceRoads;
    out.renderMapOverlaysType = typeof renderMapOverlays;
    out.cutblockColorType = typeof cutblockColor;
    out.cutblockStyleType = typeof cutblockStyle;
    out.cutblockHighlightStyleType = typeof cutblockHighlightStyle;

    // Functional checks: cutblockColor/cutblockStyle/cutblockHighlightStyle
    // are pure and easy to exercise directly.
    out.colorClosed = cutblockColor({closed: true});
    out.colorActive = cutblockColor({disturbanceStart: '2020-01-01'});
    out.colorPlanned = cutblockColor({});
    out.styleSample = cutblockStyle('#2f9e44');
    out.highlightStyleSample = cutblockHighlightStyle('#2f9e44');

    // Functional check: actually call renderMapOverlays() with a real
    // parcel result and confirm it runs to completion (no throw -- the
    // leaflet-stub's L.geoJSON()/L.layerGroup() are the generic chainable
    // Proxy, not real shape-tracking objects, so this can't check what got
    // *drawn*, but it can and does check the real, plain-array chooser
    // state render.js hands off to chooser.js) and registers the feature
    // with the shared chooser (src/map/chooser.js) -- exercising the exact
    // cross-file call chain (render.js -> chooser.js's pushClickable/
    // resetClickableSource/openNearbyFeaturesPopupAt, and render.js ->
    // map.fitBounds) that would break if load order or scoping were wrong,
    // not just "the function exists".
    resetClickableSource('overlay:parcel'); // clean slate, mirrors what renderMapOverlays itself does per-category
    const fakeParcelFeature = {
      type: 'Feature',
      geometry: {type:'Polygon', coordinates:[[[-123.13,49.27],[-123.11,49.27],[-123.11,49.29],[-123.13,49.29],[-123.13,49.27]]]},
      properties: {OWNER_TYPE: 'Crown Provincial', OBJECTID: 12345}
    };
    let renderThrew = false, renderErr = null;
    try{
      renderMapOverlays({
        parcelR: {ok:true, features:[fakeParcelFeature]},
        muniR: {ok:false}, parkR: {ok:false},
        cutList: [], tenureR: null, woodlotR: null, roadR: null,
        nearbyParcelR: null, recList: [], mvprList: [], wmaR: null,
      });
    }catch(e){ renderThrew = true; renderErr = e.message; }
    out.renderThrew = renderThrew;
    out.renderErr = renderErr;
    out.chooserRegisteredParcel = currentClickableFeatures.some(f => f.source === 'overlay:parcel');
    resetClickableSource('overlay:parcel'); // leave no test residue behind

    // Script tag order: src/map/render.js must appear, as <script src>
    // (external, not inline), after src/map/chooser.js (renderMapOverlays
    // calls pushClickable()/resetClickableSource()/
    // openNearbyFeaturesPopupAt(), all defined there) and before the main
    // inline script that uses it.
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
      inlineHasOverlayCategoryKeys: /\bconst OVERLAY_CATEGORY_KEYS\s*=/.test(inline),
      inlineHasRenderForestServiceRoads: /\bfunction renderForestServiceRoads\(/.test(inline),
      inlineHasRenderMapOverlays: /\bfunction renderMapOverlays\(/.test(inline),
      inlineHasCutblockColor: /\bfunction cutblockColor\(/.test(inline),
      inlineHasCutblockStyle: /\bfunction cutblockStyle\(/.test(inline),
      inlineHasCutblockHighlightStyle: /\bfunction cutblockHighlightStyle\(/.test(inline),
      // Out-of-scope for this slice -- must still be inline.
      inlineHasOverlayLayer: /\bconst overlayLayer\s*=\s*L\.layerGroup\(\)\.addTo\(map\)/.test(inline),
      inlineHasParcelPopup: /\bfunction parcelPopup\(/.test(inline),
      renderFileHasAll: [
        /\bconst OVERLAY_CATEGORY_KEYS\s*=/, /\blet overlayCategoryLayers\s*=/,
        /\bfunction renderForestServiceRoads\(/, /\bfunction renderMapOverlays\(/,
        /\bfunction cutblockColor\(/, /\bfunction cutblockStyle\(/, /\bfunction cutblockHighlightStyle\(/,
      ].every(re => re.test(renderFile)),
    };
  })();

  const pass = results.overlayCategoryKeysType === 'array'
    && results.overlayCategoryKeysLen === 10
    && results.overlayCategoryLayersType === 'object'
    && results.renderForestServiceRoadsType === 'function'
    && results.renderMapOverlaysType === 'function'
    && results.cutblockColorType === 'function'
    && results.cutblockStyleType === 'function'
    && results.cutblockHighlightStyleType === 'function'
    && results.colorClosed === '#2f9e44'
    && results.colorActive === '#d13438'
    && results.colorPlanned === '#4f6f93'
    && results.styleSample.fillOpacity === 0.32
    && results.highlightStyleSample.weight === 4
    && results.renderThrew === false
    && results.chooserRegisteredParcel === true
    && results.chooserIdx !== -1 && results.renderIdx !== -1
    && results.chooserIdx < results.renderIdx
    && results.mainInlineIdx !== -1
    && results.renderIdx < results.mainInlineIdx
    && !fsCheck.inlineHasOverlayCategoryKeys && !fsCheck.inlineHasRenderForestServiceRoads
    && !fsCheck.inlineHasRenderMapOverlays && !fsCheck.inlineHasCutblockColor
    && !fsCheck.inlineHasCutblockStyle && !fsCheck.inlineHasCutblockHighlightStyle
    && fsCheck.inlineHasOverlayLayer && fsCheck.inlineHasParcelPopup
    && fsCheck.renderFileHasAll
    && errors.length === 0;

  console.log('=== errors ===', errors.length ? errors.join('\n') : '(none)');
  console.log('=== RESULTS ===', JSON.stringify({ ...results, fsCheck }, null, 2));
  console.log(pass ? 'PASS' : 'FAIL');
  await browser.close();
  process.exit(pass ? 0 : 1);
})();
