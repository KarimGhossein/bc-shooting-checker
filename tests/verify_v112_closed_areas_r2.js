// Regression test for v112: Wildlife Act Closed Areas Regulation zones for
// Region 2. Checks the data file loads lazily and is well formed, that a
// point inside a no-shooting zone turns the report red, a shot-only zone is
// amber, seasonal zones respect their dates, points outside Region 2 say the
// area isn't mapped yet, and Shooting Spots gets the ban zones to exclude.
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

  const r = await page.evaluate(async () => {
    const out = {};
    out.notLoadedAtStart = typeof CLOSED_AREAS_R2 === 'undefined';
    const data = await loadClosedAreas();
    out.loaded = !!data && data.zones.features.length >= 25 && data.unmapped.length >= 30;
    out.wellFormed = data.zones.features.every(f => f.bbox && f.bbox.length === 4 && /Polygon/.test(f.geometry.type) && f.properties.id && f.properties.name && f.properties.kind && f.properties.summary && f.properties.cite)
      && data.unmapped.every(u => u.ref && u.ref.length === 2 && u.radiusKm > 0 && u.summary && u.cite);
    out.noDashes = !JSON.stringify(data).includes('\u2014');
    // point inside the Liumchen FSR corridor (no shooting, Crown land)
    const a = await closedAreasForPoint(49.04313, -121.90734);
    out.hitLiumchen = a.ok && a.hits.some(f => f.properties.id === 'cars51-3') && a.nearby.length >= 1;
    // Highway 1 corridor: shotguns only
    const b = await closedAreasForPoint(49.31432, -121.67542);
    out.hitShotOnly = b.hits.some(f => f.properties.kind === 'shot_only');
    // Cultus Lake water: Feb 1 to Sep 30 only
    const cult = data.zones.features.find(f => f.properties.id === 'cars6-3').properties;
    out.season = closedAreaInSeason(cult, new Date(2026, 6, 1)) === true && closedAreaInSeason(cult, new Date(2026, 10, 1)) === false;
    // report: red inside a ban zone, amber in a shot-only zone, gray outside Region 2
    const okEmpty = { ok: true, features: [] };
    const base = { muniR: okEmpty, parkR: okEmpty, cutR: okEmpty, cutPlanR: okEmpty, cutList: [], tenureR: okEmpty, woodlotR: okEmpty, roadR: okEmpty, open511R: { ok: true, events: [] }, nearbyParcelR: okEmpty,
      recSiteR: okEmpty, recPolyR: okEmpty, recLineR: okEmpty, recList: [], mvprRoutesR: okEmpty, mvprAreasR: okEmpty, mvprList: [], wmaR: okEmpty, reserveR: okEmpty,
      parcelR: { ok: true, features: [{ properties: { OWNER_TYPE: 'Crown Provincial' }, geometry: null }] } };
    const mu = id => ({ ok: true, features: [{ properties: { WILDLIFE_MGMT_UNIT_ID: id }, geometry: null }] });
    const rep = renderReport(Object.assign({}, base, { lat: 49.04313, lng: -121.90734, muR: mu('2-3'), closedR: a }), { snapshot: true });
    out.reportRed = rep.level === 'red' && /Liumchen/.test(rep.html) && !!rep.autoOk.closed;
    const rep2 = renderReport(Object.assign({}, base, { lat: 49.31432, lng: -121.67542, muR: mu('2-18'), closedR: b }), { snapshot: true });
    out.reportAmberShotOnly = rep2.level === 'amber' && /Shotguns only/.test(rep2.html);
    const c = await closedAreasForPoint(50.67, -120.33); // Kamloops, Region 3
    const rep3 = renderReport(Object.assign({}, base, { lat: 50.67, lng: -120.33, muR: mu('3-19'), closedR: c }), { snapshot: true });
    out.outsideR2Gray = /mapped for Region 2/.test(rep3.html);
    // spots exclusion list
    const bans = await closedAreaBansInBbox([-121.95, 49.0, -121.85, 49.1]);
    out.spotsBans = bans.some(f => f.properties.id === 'cars51-3') && bans.every(f => ['no_shooting', 'no_shooting_hunting'].includes(f.properties.kind));
    // v112b: Squamish River Valley (Sch. 5.1 s. 13, Synopsis Map B11): 800 m west / 400 m east of the FSR
    const sq = (lat, lng) => closedAreasForPoint(lat, lng).then(x => x.hits.some(f => f.properties.id === 'cars51-13'));
    out.squamish = await sq(49.99663, -123.3317) && !(await sq(49.99663, -123.31493)) && await sq(49.91263, -123.31208) && !(await sq(49.92892, -123.35236))
      && !data.unmapped.some(u => u.sched === '5.1' && u.item === '13');
    const sqA = await closedAreasForPoint(49.99663, -123.3317);
    const rep4 = renderReport(Object.assign({}, base, { lat: 49.99663, lng: -123.3317, muR: mu('2-6'), closedR: sqA }), { snapshot: true });
    out.squamishReport = rep4.level === 'red' && /Squamish River Valley/.test(rep4.html) && /hunting and trapping are still allowed/.test(rep4.html);
    out.legend = !!document.querySelector('.lg-row[data-k="closedBan"]') && !!LEGEND_MEANINGS.closedBan;
    return out;
  });

  const pass = Object.values(r).every(v => v === true) && errors.length === 0;
  console.log('=== errors ===', errors.length ? errors.join('\n') : '(none)');
  console.log('=== RESULTS ===', JSON.stringify(r, null, 2));
  console.log(pass ? 'PASS' : 'FAIL');
  await browser.close();
  process.exit(pass ? 0 : 1);
})();
