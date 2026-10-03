// Regression test for v113: Shooting Spots cuts restrictions out of the
// purple/teal shapes exactly instead of keeping or dropping whole sample
// squares, and draws the private-land and road buffers so nothing is
// excluded silently.
//
// Synthetic area (about 2 x 2 km) with no Crown parcels, one private parcel
// on the east side and one public road running north-south through the
// middle. Expectations:
// - a point 10 m from the road is NOT purple (25 m road buffer), a point
//   80 m from it IS (the old method dropped or kept whole ~90 m squares);
// - a point 400 m from the private parcel is NOT purple (600 m buffer), one
//   700 m away IS;
// - the private-land and road buffers are drawn and clickable with a label;
// - the purple area is drawn as one merged shape with a dashed edge.
//
// Needs Turf.js locally: @turf/turf (devDependency) or TURF_PATH.
const { chromium } = require('playwright');
const { launchOpts } = require('./launch');
const fs = require('fs');
const path = require('path');
const STUB = fs.readFileSync(__dirname + '/leaflet-stub.js', 'utf8');
const ROOT = path.resolve(__dirname, '..');

function turfSource(){
  const tries = [process.env.TURF_PATH, (() => { try{ return require.resolve('@turf/turf/turf.min.js'); }catch(e){ return null; } })()].filter(Boolean);
  for(const p of tries) if(fs.existsSync(p)) return fs.readFileSync(p, 'utf8');
  return null;
}

(async () => {
  const TURF = turfSource();
  if(!TURF){ console.log('=== errors === Turf.js not found (npm install, or set TURF_PATH)'); console.log('FAIL'); process.exit(1); }
  const browser = await chromium.launch(launchOpts());
  const page = await browser.newPage({ viewport: { width: 1400, height: 1000 } });
  const errors = [];
  page.on('console', msg => { if (msg.type() === 'error') errors.push('CONSOLE: ' + msg.text()); });
  page.on('pageerror', err => errors.push('PAGEERROR: ' + err.message));
  await page.route('**://cdnjs.cloudflare.com/**leaflet.min.js', route => route.fulfill({ status: 200, contentType: 'application/javascript', body: STUB }));
  await page.route('**://cdnjs.cloudflare.com/**leaflet.draw.js', route => route.fulfill({ status: 200, contentType: 'application/javascript', body: '// stub' }));
  await page.route('**://cdnjs.cloudflare.com/**.css', route => route.fulfill({ status: 200, contentType: 'text/css', body: '/* stub */' }));
  await page.route('**://fonts.googleapis.com/**', route => route.fulfill({ status: 200, contentType: 'text/css', body: '/* stub */' }));
  await page.route('**/turf.min.js', route => route.fulfill({ status: 200, contentType: 'application/javascript', body: TURF }));
  await page.goto('file://' + path.join(ROOT, 'index.html'), { waitUntil: 'load', timeout: 60000 });
  await page.waitForTimeout(800);

  const r = await page.evaluate(async () => {
    const out = {};
    const lat0 = 49.93, lng0 = -123.32;
    const m = metersPerDegree(lat0);
    const at = (dxM, dyM) => [lng0 + dxM / m.lng, lat0 + dyM / m.lat];
    // private parcel: a 200 x 200 m square whose west edge is 600 m east of centre
    const P = [at(600, -100), at(800, -100), at(800, 100), at(600, 100), at(600, -100)];
    const priv = { type: 'Feature', properties: { OWNER_TYPE: 'Private' }, geometry: { type: 'Polygon', coordinates: [P] } };
    const road = { type: 'Feature', properties: { ROAD_CLASS: 'local', ROAD_NAME_FULL: 'Test Rd' }, geometry: { type: 'LineString', coordinates: [at(-200, -1000), at(-200, 1000)] } };
    const empty = { ok: true, features: [] };
    window.queryLayer = async (typeName, cql) => {
      if(typeName === LAYERS.draRoad.typeName) return { ok: true, features: [road] };
      if(typeName === LAYERS.parcel.typeName) return /OWNER_TYPE/.test(cql || '') ? empty : { ok: true, features: [priv] };
      return empty;
    };
    window.closedAreaBansInBbox = async () => [];
    const bounds = boundsAroundPoint(lat0, lng0, 1000);
    await runPotentialSpotsSearch({ bounds, cqlFor: () => '', areaLabel: 'test', infraZoomOk: true, circleClip: null, fitAfter: false });
    const purple = currentClickableFeatures.filter(c => c.title === 'No parcel record');
    const isPurple = pt => purple.some(c => pointInGeometry(c.geometry, pt));
    out.turfLoaded = typeof turf !== 'undefined';
    out.roadNear10NotPurple = !isPurple(at(-190, 0));
    out.roadAt80Purple = isPurple(at(-120, 0)) && isPurple(at(-280, 0));
    out.privateAt400NotPurple = !isPurple(at(200, 0));
    out.privateAt700Purple = isPurple(at(-450, 500)) || isPurple(at(-100, 700));
    const buffers = currentClickableFeatures.filter(c => c.title === 'Buffer');
    out.privateBufferLabelled = buffers.some(c => /from private land/.test(c.rowLabel) && pointInGeometry(c.geometry, at(200, 0)));
    out.roadBufferLabelled = buffers.some(c => /road buffer/.test(c.rowLabel) && pointInGeometry(c.geometry, at(-190, 0)));
    // one merged, dashed purple shape drawn
    const layers = [];
    spotLayer.eachLayer(l => layers.push(l));
    out.mergedRegion = typeof gapRegionStyle === 'function' && gapRegionStyle().dashArray === MAP_DASH && purple.length > 10;
    out.legend = ['privateBuffer', 'roadBuffer', 'highwayBuffer'].every(k => !!document.querySelector(`.lg-row[data-k="${k}"]`) && /\d+ m/.test(LEGEND_MEANINGS[k]));
    return out;
  });

  const pass = Object.values(r).every(v => v === true) && errors.length === 0;
  console.log('=== errors ===', errors.length ? errors.join('\n') : '(none)');
  console.log('=== RESULTS ===', JSON.stringify(r, null, 2));
  console.log(pass ? 'PASS' : 'FAIL');
  await browser.close();
  process.exit(pass ? 0 : 1);
})();
