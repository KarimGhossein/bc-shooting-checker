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

  const results = {};

  results.emojiRemoved = await page.evaluate(() => {
    return {
      toolsTabText: document.getElementById('toolsDrawerTab').textContent.trim(),
      toolsHeadText: document.querySelector('.td-head h2').textContent.trim(),
      searchBarHtml: document.querySelector('.tb-search').innerHTML,
      hasMagnifyingGlass: document.querySelector('.tb-search').innerHTML.includes('🔎'),
    };
  });

  results.revealRoadButtonExists = await page.evaluate(() => {
    return {
      hasBtn: !!document.getElementById('revealRoadBtn'),
      hasInfoBtn: !!document.getElementById('roadInfoBtn'),
      btnLabel: document.getElementById('revealRoadBtn') ? document.getElementById('revealRoadBtn').textContent : null,
    };
  });

  // Mock queryLayer to avoid real network, exercise revealAllRoads() end to end.
  results.revealAllRoadsRun = await page.evaluate(async () => {
    const origZoom = map.getZoom;
    map.getZoom = () => 14; // above ROAD_VIEW_MIN_ZOOM
    const origQuery = window.queryLayer;
    window.queryLayer = async (typeName, cql, timeout, count) => {
      return {
        ok: true,
        features: [
          { properties: { ROAD_CLASS: 'local', HIGHWAY_ROUTE_NUMBER: null }, geometry: { type: 'LineString', coordinates: [[-122.5, 51.5],[-122.49,51.51]] } },
          { properties: { ROAD_CLASS: 'arterial', HIGHWAY_ROUTE_NUMBER: '99' }, geometry: { type: 'LineString', coordinates: [[-122.6, 51.6],[-122.59,51.61]] } },
        ]
      };
    };
    await revealAllRoads();
    const n = roadViewLayer.getLayers().length;
    const note = document.getElementById('mapActionsNote').textContent;
    map.getZoom = origZoom;
    return { layerCount: n, note };
  });

  console.log('=== errors ===', errors.length ? errors.join('\n') : '(none)');
  console.log('=== RESULTS ===', JSON.stringify(results, null, 2));
  await browser.close();
})();
