// Regression test for v92: the first slice of docs/PLAN.md's module split --
// SEARCH_RADIUS_M / CUTBLOCK_SEARCH_RADIUS_M / NEARBY_PARCEL_MAX_FEATURES /
// CUTBLOCK_START_DATE_CQL moved to src/config/constants.js, and LAYERS moved
// to src/config/layers.js, both as plain classic <script src> files (not ES
// modules -- see those files' own top comments and docs/PLAN.md's "Why
// classic scripts, not ES modules" section for why: an ES module's import
// is blocked by CORS under file://, which would break both this app's own
// file://-loaded test suite and its standalone "open directly, works
// offline" delivery format).
//
// This confirms the split actually took (the values are defined, loaded
// from the right external files, in the right order) rather than just
// happening to still work because nothing was actually moved.
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
    out.searchRadius = typeof SEARCH_RADIUS_M;
    out.cutblockSearchRadius = typeof CUTBLOCK_SEARCH_RADIUS_M;
    out.nearbyParcelMax = typeof NEARBY_PARCEL_MAX_FEATURES;
    out.startDateCql = typeof CUTBLOCK_START_DATE_CQL;
    out.layersType = typeof LAYERS;
    out.layerKeys = LAYERS ? Object.keys(LAYERS).sort() : [];

    // Script tag order: the two config files must appear, as <script src>
    // (external, not inline), before the main inline <script> that uses them.
    const scripts = Array.from(document.querySelectorAll('script'));
    const srcs = scripts.map(s => s.getAttribute('src'));
    out.constantsIdx = srcs.indexOf('src/config/constants.js');
    out.layersIdx = srcs.indexOf('src/config/layers.js');
    const mainInlineIdx = scripts.findIndex(s => !s.getAttribute('src') && s.textContent.includes('function openCutblockFromList'));
    out.mainInlineIdx = mainInlineIdx;

    return out;
  });

  // Also confirm, directly from disk (not the browser), that these
  // declarations no longer live inline in index.html -- the DOM check above
  // could pass even if a stray duplicate remained (redeclare would throw,
  // but checking explicitly is cheap and catches the file-organization
  // intent, not just the runtime behaviour).
  const fsCheck = (() => {
    const html = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
    const scriptMatch = html.match(/<script>([\s\S]*)<\/script>/);
    const inline = scriptMatch ? scriptMatch[1] : '';
    return {
      inlineHasLayers: /\bconst LAYERS\s*=/.test(inline),
      inlineHasSearchRadius: /\bconst SEARCH_RADIUS_M\s*=/.test(inline),
      constantsFileHasSearchRadius: /\bconst SEARCH_RADIUS_M\s*=/.test(fs.readFileSync(path.join(ROOT, 'src/config/constants.js'), 'utf8')),
      layersFileHasLayers: /\bconst LAYERS\s*=/.test(fs.readFileSync(path.join(ROOT, 'src/config/layers.js'), 'utf8')),
    };
  })();

  const pass = results.searchRadius === 'number'
    && results.cutblockSearchRadius === 'number'
    && results.nearbyParcelMax === 'number'
    && results.startDateCql === 'string'
    && results.layersType === 'object'
    && results.layerKeys.length === 16
    && results.constantsIdx !== -1 && results.layersIdx !== -1
    && results.constantsIdx < results.layersIdx
    && results.mainInlineIdx !== -1
    && results.layersIdx < results.mainInlineIdx
    && !fsCheck.inlineHasLayers && !fsCheck.inlineHasSearchRadius
    && fsCheck.constantsFileHasSearchRadius && fsCheck.layersFileHasLayers
    && errors.length === 0;

  console.log('=== errors ===', errors.length ? errors.join('\n') : '(none)');
  console.log('=== RESULTS ===', JSON.stringify({ ...results, fsCheck }, null, 2));
  console.log(pass ? 'PASS' : 'FAIL');
  await browser.close();
  process.exit(pass ? 0 : 1);
})();
