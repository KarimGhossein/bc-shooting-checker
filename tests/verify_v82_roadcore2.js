const { chromium } = require('playwright');
const { launchOpts } = require('./launch');
const fs = require('fs');
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

  await page.goto('file://' + require('path').resolve(__dirname, '../index.html'), { waitUntil: 'load', timeout: 60000 });
  await page.waitForTimeout(800);

  // Route 99 (Sea-to-Sky), clip lat 49.36-50.15 -- a coordinate well inside that window.
  const results = await page.evaluate(() => {
    const features = [
      { properties: { ROAD_CLASS: 'local', HIGHWAY_ROUTE_NUMBER: null }, geometry: { type: 'LineString', coordinates: [[-123.1, 49.8],[-123.09,49.81]] } },
      { properties: { ROAD_CLASS: 'arterial', HIGHWAY_ROUTE_NUMBER: '99' }, geometry: { type: 'LineString', coordinates: [[-123.1, 49.8],[-123.09,49.81]] } },
    ];
    const classified = classifyDraRoads(features);
    let threw = false, threwMsg = null;
    try { renderNearbyRoads(classified, roadViewLayer); } catch(e) { threw = true; threwMsg = e.message; }
    return {
      specialFlags: classified.map(c => !!c.special),
      bufferMs: classified.map(c => c.bufferM),
      threw, threwMsg,
    };
  });

  console.log('=== errors ===', errors.length ? errors.join('\n') : '(none)');
  console.log('=== RESULTS ===', JSON.stringify(results, null, 2));
  await browser.close();
})();
