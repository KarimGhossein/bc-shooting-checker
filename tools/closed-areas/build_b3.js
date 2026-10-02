const G = require('./geo.js'); const turf = G.turf; const fs = require('fs');
const S = JSON.parse(fs.readFileSync('src_b3.json', 'utf8'));
const muni = (name) => G.polys(S.muni.filter(m => m.p.ADMIN_AREA_NAME === name));
const park = (name) => G.polys(S.parks.filter(m => m.p.PROTECTED_LANDS_NAME === name));
const out = []; const log = {};
const MAINCLS = ['highway', 'freeway', 'arterial'];
const mainHwy = (key) => G.lines(S[key].filter(x => MAINCLS.includes(x.p.ROAD_CLASS)));

// ---- S3#63 Sea to Sky Highway: Hwy 99 between Squamish (north boundary) and Whistler (south boundary), 400 m of road allowance
{
  const sq = muni('District of Squamish'), wh = muni('Resort Municipality of Whistler');
  const sqMaxLat = Math.max(...sq.map(p => turf.bbox(p)[3])), whMinLat = Math.min(...wh.map(p => turf.bbox(p)[1]));
  const segs = G.filterSegs(mainHwy('hwy99'), m => m[1] > sqMaxLat - 0.05 && m[1] < whMinLat + 0.05 && !G.inAny(m, sq) && !G.inAny(m, wh));
  log.s63 = { segs: segs.length, km: segs.reduce((a, l) => a + G.len(l), 0) };
  out.push(G.zone({ id: 'cars3-63', sched: '3', item: '63', name: 'Sea to Sky Highway', kind: 'no_shooting_hunting', approx: 'Distance measured from the highway centreline plus 10 m for the road allowance.', summary: 'No shooting or hunting within 400 m of the Highway 99 road allowance between the District of Squamish and the Resort Municipality of Whistler.' }, G.buffer(segs, 410)));
}
// ---- S5#28(7)(b) Hwy 99 West Vancouver to Squamish: 0.4 km west, 1.0 km east of centreline
{
  const wv = muni('District Municipality of West Vancouver'), sq = muni('District of Squamish');
  const wvMaxLat = Math.max(...wv.map(p => turf.bbox(p)[3])), sqMinLat = Math.min(...sq.map(p => turf.bbox(p)[1]));
  const segs = G.filterSegs(mainHwy('hwy99'), m => m[1] > wvMaxLat - 0.08 && m[1] < sqMinLat + 0.05 && !G.inAny(m, wv) && !G.inAny(m, sq));
  let east = null;
  try {
    // A smooth south-to-north centreline: average longitude of the highway's
    // vertices in ~200 m latitude bands (Hwy 99 here runs north-south), then
    // the east side is the strip between it and a 1.5 km offset to the east.
    const pts = []; segs.forEach(l => l.forEach(c => pts.push(c)));
    const bins = {}; pts.forEach(c => { const k = Math.round(c[1] / 0.002); (bins[k] = bins[k] || []).push(c); });
    const center = Object.keys(bins).map(Number).sort((x, y) => x - y).map(k => { const b = bins[k]; return [b.reduce((s2, c) => s2 + c[0], 0) / b.length, b.reduce((s2, c) => s2 + c[1], 0) / b.length]; });
    const ext = (p, q, km) => turf.destination(p, km, turf.bearing(q, p)).geometry.coordinates;
    const line = turf.lineString([ext(center[0], center[1], 1.5), ...center, ext(center[center.length - 1], center[center.length - 2], 1.5)]);
    const off = turf.lineOffset(line, 1.5, { units: 'kilometers' }).geometry.coordinates;
    const c = line.geometry.coordinates; east = turf.buffer(turf.polygon([c.concat(off.slice().reverse(), [c[0]])]), 0);
    log.s28center = center.length;
  } catch (e) { log.s28err = String(e && e.stack || e).slice(0, 300); }
  const b1 = G.buffer(segs, 1000), b04 = G.buffer(segs, 400);
  let poly = b04;
  if (east) { const eastPart = turf.intersect(b1, east); poly = eastPart ? turf.union(b04, eastPart) : b1; } else poly = b1;
  log.s28 = { segs: segs.length, km: segs.reduce((a, l) => a + G.len(l), 0), asym: !!east };
  out.push(G.zone({ id: 'cars5-28-7b', sched: '5', item: '28(7)(b)', name: 'Highway 99, West Vancouver to Squamish', kind: 'no_shooting', approx: east ? 'The east side is built from an offset of the highway centreline and may be slightly off on sharp curves.' : 'Shown as 1.0 km on both sides; the regulation uses 0.4 km on the west side.', summary: 'No shooting within 0.4 km west and 1.0 km east of the centreline of Highway 99 between West Vancouver and the District of Squamish.' }, poly));
}
// ---- S3#9(a) Highway 3, Hope to Manning Park, 0.4 km of centreline
{
  const hope = muni('District of Hope'), mann = park('E.C. MANNING PARK');
  const mannMinLon = Math.min(...mann.map(p => turf.bbox(p)[0]));
  const segs = G.filterSegs(mainHwy('hwy3'), m => m[0] < mannMinLon + 0.02 && !G.inAny(m, hope) && !G.inAny(m, mann));
  log.s9 = { segs: segs.length, km: segs.reduce((a, l) => a + G.len(l), 0) };
  out.push(G.zone({ id: 'cars3-9a', sched: '3', item: '9(a)', name: 'Highway 3, Hope to Manning Park', kind: 'no_shooting_hunting', summary: 'No shooting or hunting within 0.4 km of the centreline of Highway 3 between the east boundary of Hope and the west boundary of E.C. Manning Provincial Park.' }, G.buffer(segs, 400)));
}
// ---- Hemlock Valley Road: S5#28(5)(d), (6) and S5#92. 50 m to the second Sakwi Creek bridge, 150 m beyond.
{
  const road = G.chain(G.lines(S.hemlock.filter(x => /^Hemlock Valley Rd/i.test(x.p.ROAD_NAME_FULL))), 40)[0];
  // start at the Weaver Creek Road end (the lower, southern end)
  const r = road[0][1] < road[road.length - 1][1] ? road : road.slice().reverse();
  const cr = G.crossings(r, G.lines(S.sakwi));
  log.hemlock = { km: G.len(r), crossings: cr.map(c => Math.round(c.at * 100) / 100) };
  const split = cr.length >= 2 ? cr[1].at : (cr[0] ? cr[0].at : G.len(r) / 2);
  const p1 = G.buffer([G.slice(r, 0, split)], 50), p2 = G.buffer([G.slice(r, split, G.len(r))], 150);
  out.push(G.zone({ id: 'cars5-92', sched: '5', item: '92; 28(5)(d), (6)', name: 'Hemlock Valley Road', kind: 'no_shooting', approx: cr.length >= 2 ? null : 'The second Sakwi Creek bridge could not be located; the 50 m and 150 m sections are split at an estimated point.', summary: 'No shooting within 50 m of Hemlock Valley Road from Weaver Creek Road to the second Sakwi Creek bridge, and within 150 m of the road beyond that to Hemlock Valley.' }, turf.union(p1, p2)));
}
// ---- S5#85 Sylvester Road between Farms Road and Dale Road, 50 m
{
  const syl = G.chain(G.lines(S.sylv.filter(x => x.p.ROAD_NAME_FULL === 'Sylvester Rd')), 40)[0];
  const farms = G.lines(S.sylv.filter(x => x.p.ROAD_NAME_FULL === 'Farms Rd')), dale = G.lines(S.sylv.filter(x => x.p.ROAD_NAME_FULL === 'Dale Rd'));
  const jf = G.junction(syl, farms), jd = G.junction(syl, dale);
  log.sylv = { km: G.len(syl), jf, jd };
  out.push(G.zone({ id: 'cars5-85', sched: '5', item: '85', name: 'Sylvester Road', kind: 'no_shooting', summary: 'No shooting within 50 m of the centreline of Sylvester Road between Farms Road and Dale Road.' }, G.buffer([G.slice(syl, jf.at, jd.at)], 50)));
}
// ---- Texada roads: S5#124 (0.2 km) and S5#118 Central Road (25 m)
{
  const L = (n) => G.lines(S.texada.filter(x => x.p.ROAD_NAME_FULL === n));
  const gb = G.chain(L('Gillies Bay Rd'), 40)[0];
  const jb = G.junction(gb, L('Blubber Bay Rd')), js = G.junction(gb, L('Shelter Point Rd'));
  const gbSeg = G.slice(gb, jb.at, js.at);
  const segs = [gbSeg, ...L('Shelter Point Rd'), ...L('Blubber Bay Rd'), ...L('Crescent Bay Rd')];
  log.texada = { gbKm: G.len(gb), jb, js };
  out.push(G.zone({ id: 'cars5-124', sched: '5', item: '124', name: 'Gillies Bay, Shelter Point, Blubber Bay and Crescent Bay Roads (Texada Island)', kind: 'no_shooting', summary: 'No shooting within 0.2 km of Gillies Bay Road (Blubber Bay Road to Shelter Point Road), Shelter Point Road, Blubber Bay Road and Crescent Bay Road on Texada Island.' }, G.buffer(segs, 200)));
  const central = G.chain(L('Central Rd'), 40)[0];
  const jc = G.junction(central, [...L('Shelter Point Rd'), ...L('Bell Rd')]);
  // north is the direction of increasing latitude along the road
  const pA = turf.along(turf.lineString(central), Math.max(0, jc.at - 1)).geometry.coordinates, pB = turf.along(turf.lineString(central), Math.min(G.len(central), jc.at + 1)).geometry.coordinates;
  const dir = pB[1] > pA[1] ? 1 : -1; const start = jc.at + dir * 2; const end = Math.max(0, Math.min(G.len(central), start + dir * 16));
  log.central = { km: G.len(central), jc, start, end };
  out.push(G.zone({ id: 'cars5-118', sched: '5', item: '118', name: 'Central Road (Texada Island)', kind: 'no_shooting', approx: 'Imperial Limestone Road is not in the road data, so the north end is set about 16 km along Central Road, as the regulation describes.', summary: 'No shooting within 25 m of Central Road on Texada Island from 2 km north of the Shelter Point Road and Bell Road junction to Imperial Limestone Road (about 16 km).' }, G.buffer([G.slice(central, start, end)], 25)));
  // S5#67(1) Blubber Bay ferry terminal, 1 km radius
  const ferries = G.lines(S.texada.filter(x => x.p.ROAD_CLASS === 'ferry'));
  let term = null; ferries.forEach(l => [l[0], l[l.length - 1]].forEach(p => { const dd = turf.distance(p, [-124.618, 49.795]); if (!term || dd < term.d) term = { p, d: dd }; }));
  log.blubber = term;
  if (term && term.d < 1.5) out.push(G.zone({ id: 'cars5-67-1', sched: '5', item: '67(1)', name: 'Blubber Bay ferry terminal', kind: 'no_shooting', approx: 'Centred on the mapped ferry route landing; the separate Blubber Point to Limekiln Bay part of this item is not mapped yet.', summary: 'No shooting within 1 km of the Blubber Bay ferry terminal on Texada Island.' }, turf.circle(term.p, 1, { units: 'kilometers', steps: 48 })));
}
// ---- S5.1#2 Silver Skagit FSR: Eureka Creek crossing to Skagit Valley Park
{
  const road = G.chain(G.lines(S.silver), 40)[0];
  const cr = G.crossings(road, G.lines(S.eureka));
  const sk = park('SKAGIT VALLEY PARK');
  // park boundary location along the road: first point inside the park
  const L = G.len(road); let parkAt = null; const e0 = cr.length ? cr[0].at : L; const stepDir = G.inAny(turf.along(turf.lineString(road), 0).geometry.coordinates, sk) ? -1 : 1; for (let k = e0; k >= 0 && k <= L; k += stepDir * 0.05) { const p = turf.along(turf.lineString(road), k).geometry.coordinates; if (G.inAny(p, sk)) { parkAt = k; break; } }
  log.silver = { km: L, eureka: cr.map(c => c.at), parkAt };
  if (cr.length && parkAt != null) out.push(G.zone({ id: 'cars51-2', sched: '5.1', item: '2', name: 'Silver Skagit Road', kind: 'no_shooting', crownOnly: true, summary: 'No shooting on Crown land within 400 m of the Silver Skagit road from the Eureka Creek crossing to Skagit Valley Provincial Park (M.U. 2-2).' }, G.buffer([G.slice(road, cr[0].at, parkAt)], 400)));
}
// ---- S3#64 Callaghan Road, outside Whistler to Whistler Olympic Park
{
  const wh = muni('Resort Municipality of Whistler');
  const segs = G.filterSegs(G.lines(S.callaghan), m => !G.inAny(m, wh));
  log.callaghan = { segs: segs.length, km: segs.reduce((a, l) => a + G.len(l), 0) };
  out.push(G.zone({ id: 'cars3-64', sched: '3', item: '64', name: 'Callaghan Road', kind: 'no_shooting_hunting', approx: 'Runs to the end of the mapped Callaghan Valley Road; the regulation ends at the Whistler Olympic Park gate.', summary: 'No shooting or hunting within 400 m of the Callaghan Road allowance from the Resort Municipality of Whistler to the Whistler Olympic Park gate.' }, G.buffer(segs, 410)));
}
// ---- S6#3 Cultus Lake waters, seasonal
{
  const lake = G.polys(S.lakes)[0];
  out.push(G.zone({ id: 'cars6-3', sched: '6', item: '3', name: 'Cultus Lake (water)', kind: 'no_shooting', season: { from: '02-01', to: '09-30' }, summary: 'No shooting on the waters of Cultus Lake from February 1 to September 30.' }, lake));
}
// ---- Islands
{
  const isl = (n) => G.polys(S.islands.filter(x => x.p.GNIS_NAME_1 === n));
  const mk = (id, sched, item, n, kind, summary, extra) => { const ps = isl(n); if (!ps.length) { log['missing ' + n] = true; return; } out.push(G.zone(Object.assign({ id, sched, item, name: n, kind, summary }, extra || {}), G.union(ps))); };
  mk('cars3-17', '3', '17', 'North Thormanby Island', 'no_shooting_hunting', 'No shooting or hunting on North Thormanby Island (to the low water mark).');
  mk('cars5-11', '5', '11', 'Bowen Island', 'no_shooting', 'No shooting on Bowen Island, including the foreshore.');
  mk('cars11-3', '11', '3', 'Keats Island', 'rifle_prohibited', 'Rifles may not be discharged on Keats Island or its foreshore.');
  mk('cars9-23', '9', '23', 'Savary Island', 'shot_only', 'Firearms using shot only on Savary Island.');
  mk('cars9-4', '9', '4', 'Barnston Island', 'shot_only', 'Firearms using shot only on Barnston Island (except Indian Reserve land).', { approx: 'Indian Reserve land on the island, which the regulation excludes, is not cut out.' });
}
fs.writeFileSync('zones_b3.geojson', JSON.stringify({ type: 'FeatureCollection', features: out }));
console.log(JSON.stringify(log, null, 1));
console.log(out.map(G.report));
