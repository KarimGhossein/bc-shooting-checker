// Regression test for v97: the second slice of docs/PLAN.md's module split
// (after v92's config/constants.js + config/layers.js) -- WFS_BASE / wfsUrl()
// / jsonpCounter / jsonpRequest() / queryLayer() / pt() / cqlFor() /
// viewportPolygonWkt() / viewportBboxCql() moved to src/data/wfs.js, loaded
// as a plain classic <script src> (not an ES module -- see that file's own
// top comment, and docs/PLAN.md's "Why classic scripts" section, for why:
// an ES module's import is blocked by CORS under file://, which would break
// both this app's file://-loaded test suite and its standalone "open
// directly, works offline" delivery format).
//
// This confirms the split actually took (the values/functions are defined,
// loaded from the right external file, in the right order, and actually do
// the right thing) rather than just happening to still work because nothing
// was really moved -- and separately confirms, straight from disk, that the
// old inline declarations are gone from index.html and the new file really
// has them (mirroring tests/verify_v92_config_split.js's pattern).
//
// Scope note (see src/data/wfs.js's own comment for the full rationale):
// queryOpen511()/OPEN511_BASE and radiusCql() are deliberately NOT part of
// this slice and are NOT checked as "moved" here -- they're confirmed to
// still be defined (inline) so this test would catch them being accidentally
// dropped, but their location is not asserted as having changed.
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
    out.wfsBaseType = typeof WFS_BASE;
    out.wfsUrlType = typeof wfsUrl;
    out.jsonpRequestType = typeof jsonpRequest;
    out.queryLayerType = typeof queryLayer;
    out.ptType = typeof pt;
    out.cqlForType = typeof cqlFor;
    out.viewportPolygonWktType = typeof viewportPolygonWkt;
    out.viewportBboxCqlType = typeof viewportBboxCql;

    // Still inline, out of scope for this slice -- confirm they weren't
    // accidentally dropped along with everything else.
    out.queryOpen511Type = typeof queryOpen511;
    out.open511BaseType = typeof OPEN511_BASE;
    out.radiusCqlType = typeof radiusCql;

    // Functional checks -- not just "defined", but actually correct.
    out.wfsUrlSample = wfsUrl('WHSE_TEST.LAYER', "SOME_CQL", "json", 5);
    out.ptSample = pt(49.28, -123.12);
    out.cqlForSample = cqlFor('road', 49.28, -123.12); // road layer -- DWITHIN mode
    const bounds = L.latLngBounds([49.0, -123.5], [49.5, -123.0]);
    out.viewportPolygonWktSample = viewportPolygonWkt(bounds);
    out.viewportBboxCqlSample = viewportBboxCql('GEOMETRY', bounds, 'FOO=1');

    // Downstream callers that still work through these moved functions.
    out.parcelViewBboxCqlType = typeof parcelViewBboxCql;
    out.parcelViewBboxCqlSample = parcelViewBboxCql(bounds);

    // Script tag order: src/data/wfs.js must appear, as <script src>
    // (external, not inline), after src/config/layers.js (cqlFor references
    // LAYERS by bare name) and before the main inline <script> that uses it.
    const scripts = Array.from(document.querySelectorAll('script'));
    const srcs = scripts.map(s => s.getAttribute('src'));
    out.layersIdx = srcs.indexOf('src/config/layers.js');
    out.wfsIdx = srcs.indexOf('src/data/wfs.js');
    const mainInlineIdx = scripts.findIndex(s => !s.getAttribute('src') && s.textContent.includes('function openCutblockFromList'));
    out.mainInlineIdx = mainInlineIdx;

    return out;
  });

  // Also confirm, directly from disk (not the browser), that these
  // declarations no longer live inline in index.html and really do live in
  // src/data/wfs.js -- the DOM check above could pass even if a stray
  // duplicate remained (redeclare would throw, but checking explicitly is
  // cheap and catches the file-organization intent, not just runtime
  // behaviour).
  const fsCheck = (() => {
    const html = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
    const scriptMatch = html.match(/<script>([\s\S]*)<\/script>/);
    const inline = scriptMatch ? scriptMatch[1] : '';
    const wfsFile = fs.readFileSync(path.join(ROOT, 'src/data/wfs.js'), 'utf8');
    return {
      inlineHasWfsBase: /\bconst WFS_BASE\s*=/.test(inline),
      inlineHasWfsUrl: /\bfunction wfsUrl\(/.test(inline),
      inlineHasJsonpRequest: /\bfunction jsonpRequest\(/.test(inline),
      inlineHasQueryLayer: /\bfunction queryLayer\(/.test(inline),
      inlineHasPt: /\bfunction pt\(/.test(inline),
      inlineHasCqlFor: /\bfunction cqlFor\(/.test(inline),
      inlineHasViewportPolygonWkt: /\bfunction viewportPolygonWkt\(/.test(inline),
      inlineHasViewportBboxCql: /\bfunction viewportBboxCql\(/.test(inline),
      // Out-of-scope for this slice -- must still be inline.
      inlineHasQueryOpen511: /\basync function queryOpen511\(/.test(inline),
      inlineHasRadiusCql: /\bfunction radiusCql\(/.test(inline),
      wfsFileHasAll: [
        /\bconst WFS_BASE\s*=/, /\bfunction wfsUrl\(/, /\bfunction jsonpRequest\(/,
        /\basync function queryLayer\(/, /\bfunction pt\(/, /\bfunction cqlFor\(/,
        /\bfunction viewportPolygonWkt\(/, /\bfunction viewportBboxCql\(/,
      ].every(re => re.test(wfsFile)),
    };
  })();

  const pass = results.wfsBaseType === 'string'
    && results.wfsUrlType === 'function'
    && results.jsonpRequestType === 'function'
    && results.queryLayerType === 'function'
    && results.ptType === 'function'
    && results.cqlForType === 'function'
    && results.viewportPolygonWktType === 'function'
    && results.viewportBboxCqlType === 'function'
    && results.queryOpen511Type === 'function'
    && results.open511BaseType === 'string'
    && results.radiusCqlType === 'function'
    && results.wfsUrlSample.startsWith('https://openmaps.gov.bc.ca/geo/pub/WHSE_TEST.LAYER/ows?')
    && results.wfsUrlSample.includes('CQL_FILTER=SOME_CQL')
    && results.ptSample === 'SRID=4326;POINT(-123.12 49.28)'
    && results.cqlForSample.includes('DWITHIN(')
    && results.viewportPolygonWktSample.startsWith('SRID=4326;POLYGON((')
    && results.viewportBboxCqlSample === "INTERSECTS(GEOMETRY, SRID=4326;POLYGON((-123.5 49, -123 49, -123 49.5, -123.5 49.5, -123.5 49))) AND FOO=1"
    && results.parcelViewBboxCqlType === 'function'
    && results.parcelViewBboxCqlSample.startsWith('INTERSECTS(')
    && results.layersIdx !== -1 && results.wfsIdx !== -1
    && results.layersIdx < results.wfsIdx
    && results.mainInlineIdx !== -1
    && results.wfsIdx < results.mainInlineIdx
    && !fsCheck.inlineHasWfsBase && !fsCheck.inlineHasWfsUrl && !fsCheck.inlineHasJsonpRequest
    && !fsCheck.inlineHasQueryLayer && !fsCheck.inlineHasPt && !fsCheck.inlineHasCqlFor
    && !fsCheck.inlineHasViewportPolygonWkt && !fsCheck.inlineHasViewportBboxCql
    && fsCheck.inlineHasQueryOpen511 && fsCheck.inlineHasRadiusCql
    && fsCheck.wfsFileHasAll
    && errors.length === 0;

  console.log('=== errors ===', errors.length ? errors.join('\n') : '(none)');
  console.log('=== RESULTS ===', JSON.stringify({ ...results, fsCheck }, null, 2));
  console.log(pass ? 'PASS' : 'FAIL');
  await browser.close();
  process.exit(pass ? 0 : 1);
})();
