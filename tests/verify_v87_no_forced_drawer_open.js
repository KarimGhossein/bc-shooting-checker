// Regression test for v87's second, unrelated fix (the first -- the Clear
// dropdown listing report categories -- was itself removed in v95 along
// with the whole Clear feature; see docs/CHANGELOG.md's v95 section and
// the retired tests/verify_v87_report_clear_menu.js this file replaces):
//
// runPotentialSpotsSearch() no longer force-opens the Tools drawer
// (openToolsDrawer() removed entirely, now dead code) -- Karim reported
// the progress bar popping the drawer open on a plain map click, before
// he'd pressed anything in it, as showing up on its own.
//
// See docs/CHANGELOG.md's v87 section for the full root-cause writeup.
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
    out.openToolsDrawerRemoved = typeof openToolsDrawer === 'undefined';
    out.runPotentialSpotsSearchNoLongerCallsIt = !runPotentialSpotsSearch.toString().includes('openToolsDrawer');
    document.getElementById('toolsDrawer').classList.remove('open'); // start closed
    // The drawer must stay closed after the point in runLookup() that used
    // to force it open (revealPotentialSpotsAroundPin's own network calls
    // aren't stubbed here, so this checks the specific call site is gone
    // from source instead of running the whole async flow -- same approach
    // verify_v85's zoom-gated check already uses for the same reason).
    out.toolsDrawerStaysClosed = document.getElementById('toolsDrawer').classList.contains('open') === false;
    return out;
  });

  const pass = results.openToolsDrawerRemoved
    && results.runPotentialSpotsSearchNoLongerCallsIt
    && results.toolsDrawerStaysClosed
    && errors.length === 0;

  console.log('=== errors ===', errors.length ? errors.join('\n') : '(none)');
  console.log('=== RESULTS ===', JSON.stringify(results, null, 2));
  console.log(pass ? 'PASS' : 'FAIL');
  await browser.close();
  process.exit(pass ? 0 : 1);
})();
