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

  const results = await page.evaluate(() => {
    // A ~200m x 200m square roughly centered at (51.5, -122.5).
    const square = { type: 'Polygon', coordinates: [[[-122.5013, 51.499], [-122.4987, 51.499], [-122.4987, 51.501], [-122.5013, 51.501], [-122.5013, 51.499]]] };
    const entry = { geometry: square };

    const inside = featureNearPoint(entry, { lat: 51.5, lng: -122.5 }, 10, 10); // dead center
    // A point ~5m outside the west edge (edge is at lng -122.5013, ~1 degree lng =~ 70000m at this lat, so 0.00005 deg =~ 3.5m)
    const justOutside = featureNearPoint(entry, { lat: 51.5, lng: -122.5013 - 0.00005 }, 10, 10);
    // A point ~50m outside -- beyond a 10m tolerance
    const farOutside = featureNearPoint(entry, { lat: 51.5, lng: -122.5013 - 0.0007 }, 10, 10);
    // Same near-boundary point but with a 0 tolerance -- should NOT match (sanity: tolerance is doing the work)
    const justOutsideZeroTol = featureNearPoint(entry, { lat: 51.5, lng: -122.5013 - 0.00005 }, 0, 0);

    return { inside, justOutside, farOutside, justOutsideZeroTol };
  });

  console.log('=== errors ===', errors.length ? errors.join('\n') : '(none)');
  console.log('=== RESULTS ===', JSON.stringify(results, null, 2));
  await browser.close();
})();
