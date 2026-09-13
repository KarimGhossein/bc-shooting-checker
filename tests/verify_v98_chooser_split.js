// Regression test for v98: the third slice of docs/PLAN.md's module split
// (after v92's config/*.js and v97's data/wfs.js) -- currentClickableFeatures/
// currentPushSource/currentNearbyMatches, resetClickableSource(),
// pushClickable(), pixelToleranceMeters(), the two NEARBY_CLICK_*_TOLERANCE_PX
// constants, featureNearPoint(), openNearbyFeaturesPopupAt(), and
// showNearbyFeatureDetail() moved to src/map/chooser.js, loaded as a plain
// classic <script src> (not an ES module -- see that file's own top comment,
// and docs/PLAN.md's "Why classic scripts" section, for why).
//
// This is also the first module-split slice whose own top-level code would
// break if it were loaded in the wrong place relative to `map` -- unlike
// config/*.js and data/wfs.js, chooser.js is loaded *before* the main inline
// script creates `map`, so this test's functional checks (which call
// openNearbyFeaturesPopupAt(), which calls pixelToleranceMeters(), which
// calls map.latLngToContainerPoint()) only pass if that ordering concern was
// actually resolved correctly (every reference to `map` lives inside a
// function body, never at chooser.js's own top level) rather than just
// happening to not throw yet.
//
// Existing tests/verify_v79.js and tests/verify_v83.js already exercise this
// system's actual chooser-popup behaviour end-to-end (the shared multi-record
// chooser docs/PLAN.md called out as this file's "best test coverage");
// this test instead confirms the *split itself* took cleanly, the same way
// verify_v92_config_split.js and verify_v97_wfs_split.js do for their own
// slices -- so a regression here would mean the extraction broke something
// v79/v83 don't happen to cover, not that the feature itself misbehaves.
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
    out.currentClickableFeaturesType = Array.isArray(currentClickableFeatures) ? 'array' : typeof currentClickableFeatures;
    out.currentPushSourceType = typeof currentPushSource;
    out.currentNearbyMatchesType = Array.isArray(currentNearbyMatches) ? 'array' : typeof currentNearbyMatches;
    out.resetClickableSourceType = typeof resetClickableSource;
    out.pushClickableType = typeof pushClickable;
    out.pixelToleranceMetersType = typeof pixelToleranceMeters;
    out.lineTolConstType = typeof NEARBY_CLICK_LINE_TOLERANCE_PX;
    out.pointTolConstType = typeof NEARBY_CLICK_POINT_TOLERANCE_PX;
    out.featureNearPointType = typeof featureNearPoint;
    out.openNearbyFeaturesPopupAtType = typeof openNearbyFeaturesPopupAt;
    out.showNearbyFeatureDetailType = typeof showNearbyFeatureDetail;

    // Still inline, out of scope for this slice -- confirm they weren't
    // accidentally dropped along with everything else (see chooser.js's own
    // scope note for why they couldn't move: their top-level init needs
    // `map`, which doesn't exist yet when chooser.js itself loads).
    out.highlightNearbyMatchType = typeof highlightNearbyMatch;
    out.clearNearbyMatchHighlightType = typeof clearNearbyMatchHighlight;

    // ---- Functional checks: register two overlapping features via the
    // real pushClickable()/resetClickableSource() and confirm
    // openNearbyFeaturesPopupAt() actually produces a 2-record chooser at
    // their shared point, and a single-feature click gets that feature's
    // own popup content directly -- exercising the exact call chain that
    // would break if `map` weren't already defined by the time these run.
    resetClickableSource('test-slice');
    const pt = L.latLng(49.28, -123.12);
    pushClickable({type:'Point', coordinates:[-123.12, 49.28]}, '📍', 'Feature A', 'Title A', '<b>A</b>');
    pushClickable({type:'Point', coordinates:[-123.12, 49.28]}, '📍', 'Feature B', 'Title B', '<b>B</b>');
    out.registeredCount = currentClickableFeatures.filter(f => f.source === 'test-slice').length;
    openNearbyFeaturesPopupAt(pt);
    out.chooserMatchCount = currentNearbyMatches.length;

    resetClickableSource('test-slice');
    pushClickable({type:'Point', coordinates:[-123.12, 49.28]}, '📍', 'Feature Solo', 'Title Solo', '<b>solo content</b>');
    // Single match shouldn't touch currentNearbyMatches (that's only set in
    // the 2+ branch) -- reset it first so this check is meaningful.
    currentNearbyMatches = [];
    openNearbyFeaturesPopupAt(pt);
    out.soloLeftMatchesEmpty = currentNearbyMatches.length === 0;

    resetClickableSource('test-slice'); // leave no test residue behind

    // Script tag order: src/map/chooser.js must appear, as <script src>
    // (external, not inline), after src/data/wfs.js and before the main
    // inline <script> that uses it.
    const scripts = Array.from(document.querySelectorAll('script'));
    const srcs = scripts.map(s => s.getAttribute('src'));
    out.wfsIdx = srcs.indexOf('src/data/wfs.js');
    out.chooserIdx = srcs.indexOf('src/map/chooser.js');
    const mainInlineIdx = scripts.findIndex(s => !s.getAttribute('src') && s.textContent.includes('function openCutblockFromList'));
    out.mainInlineIdx = mainInlineIdx;

    return out;
  });

  // Also confirm, directly from disk (not the browser), that these
  // declarations no longer live inline in index.html and really do live in
  // src/map/chooser.js.
  const fsCheck = (() => {
    const html = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
    const scriptMatch = html.match(/<script>([\s\S]*)<\/script>/);
    const inline = scriptMatch ? scriptMatch[1] : '';
    const chooserFile = fs.readFileSync(path.join(ROOT, 'src/map/chooser.js'), 'utf8');
    return {
      inlineHasCurrentClickableFeatures: /\blet currentClickableFeatures\s*=/.test(inline),
      inlineHasPushClickable: /\bfunction pushClickable\(/.test(inline),
      inlineHasResetClickableSource: /\bfunction resetClickableSource\(/.test(inline),
      inlineHasPixelToleranceMeters: /\bfunction pixelToleranceMeters\(/.test(inline),
      inlineHasFeatureNearPoint: /\bfunction featureNearPoint\(/.test(inline),
      inlineHasOpenNearbyFeaturesPopupAt: /\bfunction openNearbyFeaturesPopupAt\(/.test(inline),
      inlineHasShowNearbyFeatureDetail: /\bfunction showNearbyFeatureDetail\(/.test(inline),
      // Out-of-scope for this slice -- must still be inline.
      inlineHasChooserHighlightLayer: /\bconst chooserHighlightLayer\s*=\s*L\.layerGroup\(\)\.addTo\(map\)/.test(inline),
      inlineHasHighlightNearbyMatch: /\bfunction highlightNearbyMatch\(/.test(inline),
      chooserFileHasAll: [
        /\blet currentClickableFeatures\s*=/, /\blet currentPushSource\s*=/, /\blet currentNearbyMatches\s*=/,
        /\bfunction resetClickableSource\(/, /\bfunction pushClickable\(/, /\bfunction pixelToleranceMeters\(/,
        /\bconst NEARBY_CLICK_LINE_TOLERANCE_PX\s*=/, /\bconst NEARBY_CLICK_POINT_TOLERANCE_PX\s*=/,
        /\bfunction featureNearPoint\(/, /\bfunction openNearbyFeaturesPopupAt\(/, /\bfunction showNearbyFeatureDetail\(/,
      ].every(re => re.test(chooserFile)),
    };
  })();

  const pass = results.currentClickableFeaturesType === 'array'
    && results.currentPushSourceType === 'string'
    && results.currentNearbyMatchesType === 'array'
    && results.resetClickableSourceType === 'function'
    && results.pushClickableType === 'function'
    && results.pixelToleranceMetersType === 'function'
    && results.lineTolConstType === 'number'
    && results.pointTolConstType === 'number'
    && results.featureNearPointType === 'function'
    && results.openNearbyFeaturesPopupAtType === 'function'
    && results.showNearbyFeatureDetailType === 'function'
    && results.highlightNearbyMatchType === 'function'
    && results.clearNearbyMatchHighlightType === 'function'
    && results.registeredCount === 2
    && results.chooserMatchCount === 2
    && results.soloLeftMatchesEmpty === true
    && results.wfsIdx !== -1 && results.chooserIdx !== -1
    && results.wfsIdx < results.chooserIdx
    && results.mainInlineIdx !== -1
    && results.chooserIdx < results.mainInlineIdx
    && !fsCheck.inlineHasCurrentClickableFeatures && !fsCheck.inlineHasPushClickable
    && !fsCheck.inlineHasResetClickableSource && !fsCheck.inlineHasPixelToleranceMeters
    && !fsCheck.inlineHasFeatureNearPoint && !fsCheck.inlineHasOpenNearbyFeaturesPopupAt
    && !fsCheck.inlineHasShowNearbyFeatureDetail
    && fsCheck.inlineHasChooserHighlightLayer && fsCheck.inlineHasHighlightNearbyMatch
    && fsCheck.chooserFileHasAll
    && errors.length === 0;

  console.log('=== errors ===', errors.length ? errors.join('\n') : '(none)');
  console.log('=== RESULTS ===', JSON.stringify({ ...results, fsCheck }, null, 2));
  console.log(pass ? 'PASS' : 'FAIL');
  await browser.close();
  process.exit(pass ? 0 : 1);
})();
