// Schedule 5.1 s. 13, Squamish River Valley (map 5.1-13/22 = Synopsis Map B11).
// Input src_squamish.json: {ft: FTEN road sections, dra: DRA roads, st: FWA streams} for bbox -123.5,49.8,-123.15,50.15 (fetch with lib.js).
// Output zone_squamish.geojson. Run: node build_squamish.js
const G = require('./geo.js'); const T = G.turf; const fs = require('fs');
const o = JSON.parse(fs.readFileSync('src_squamish.json'));
const L = (g) => g.type === 'LineString' ? [g.coordinates] : g.coordinates;
const ft = (fn) => o.ft.filter(fn).flatMap(f => L(f.g));
const dra = (n) => o.dra.filter(d => d.p.ROAD_NAME_FULL === n).flatMap(d => L(d.g));
const live = f => !f.p.RETIREMENT_DATE;
// Squamish River FSR (FTEN 9160-01), from the Squamish Valley Rd end to the Elaho Main junction
const fsr = G.chain(ft(f => f.p.FOREST_FILE_ID === '9160' && f.p.ROAD_SECTION_NAME === 'SQUAMISH RIVER'))[0];
// road south of it (Squamish Valley Rd), chained so it ends at the FSR start
const svr = G.chain(dra('Squamish Valley Rd'))[0];
const fsrNorth = G.chain(dra('Squamish Valley FSR').filter(l => l.some(c => c[1] > 50.1135)))[0];
const elaho = G.chain(dra('Elaho Main'))[0];
const ashlu = G.chain(ft(f => f.p.ROAD_SECTION_NAME === 'ASHLU RIVER'))[0];
const b200 = G.chain(ft(f => live(f) && f.p.FOREST_FILE_ID === 'R05808' && String(f.p.ROAD_SECTION_ID) === '200'))[0];
const b700 = G.chain(ft(f => live(f) && f.p.FOREST_FILE_ID === 'R05808' && String(f.p.ROAD_SECTION_ID) === '700'))[0];
const b800 = G.chain(ft(f => live(f) && f.p.FOREST_FILE_ID === 'R05808' && String(f.p.ROAD_SECTION_ID) === '800'))[0];
const e200 = G.chain(ft(f => live(f) && f.p.FOREST_FILE_ID === 'R09478' && String(f.p.ROAD_SECTION_ID) === 'E-200'))[0];
const near = (a, p) => T.distance(a, p, { units: 'meters' });
// orient a line so it starts at the end nearest point p
const from = (l, p) => near(l[0], p) <= near(l[l.length - 1], p) ? l : l.slice().reverse();
const first = (l, p, km) => { const x = from(l, p); return G.len(x) <= km ? x : G.slice(x, 0, km); };
const J = { ashlu: [-123.2925, 49.9143], b200: [-123.30422, 49.94858], b700: [-123.33546, 50.06513], b800: [-123.34401, 50.07469], elaho: [-123.38586, 50.11358] };
const at = (k) => G.locOf(fsr, J[k]).location;
const info = { fsrKm: G.len(fsr), fsrStart: fsr[0], fsrEnd: fsr[fsr.length - 1] };
for (const k in J) info[k] = { at: +at(k).toFixed(3), off: +(G.locOf(fsr, J[k]).dist * 1000).toFixed(0) };
['svr', 'fsrNorth', 'elaho', 'ashlu', 'b200', 'b700', 'b800', 'e200'].forEach(k => { const l = eval(k); info[k] = l ? { km: +G.len(l).toFixed(2), a: l[0], b: l[l.length - 1] } : null; });
console.log(JSON.stringify(info, null, 1));
const aA = at('ashlu'), a700 = at('b700');
console.log('ashlu at', aA.toFixed(2), 'b700 at', a700.toFixed(2));
// dark: FSR Ashlu junction to Branch 700 junction, 800 m west and 400 m east
const dark = G.slice(fsr, aA, a700);
const mPerLon = 111320 * Math.cos(50 * Math.PI / 180);
const dx = 800 / mPerLon;
const darkS = T.simplify(T.lineString(dark), { tolerance: 0.0001 }).geometry.coordinates;
const quads = [];
for (let i = 0; i < darkS.length - 1; i++) { const a = darkS[i], b = darkS[i + 1]; quads.push(T.polygon([[a, b, [b[0] - dx, b[1]], [a[0] - dx, a[1]], a]])); }
let darkPoly = G.union([G.buffer([dark], 400), ...quads]);
// medium: first 1.5 km of Branch 800 and Branch 700, 600 m
const medPoly = G.buffer([first(b800, J.b800, 1.5), first(b700, J.b700, 1.5)], 600);
// light: 400 m
const svrS = first(svr, J.ashlu, 3.0);            // Squamish Valley Rd, 3 km south of the Ashlu junction (approx)
const ashluS = first(ashlu, J.ashlu, 3.0);        // Ashlu River FSR to about the power station (approx)
const b200S = first(b200, J.b200, 3.5);           // Branch 200, first 3.5 km
const fsrTop = G.slice(fsr, a700, G.len(fsr));    // FSR Branch 700 junction to Elaho Main junction
const nLoc = G.locOf(fsrNorth, J.elaho).location; const fsrN = G.slice(fsrNorth, nLoc, Math.min(G.len(fsrNorth), nLoc + 2.0));
const elahoS = first(elaho, J.elaho, 4.7);
const e200S = G.filterSegs([e200], m => m[1] >= 50.10 && m[0] >= -123.45);
const lightLines = [svrS, ashluS, b200S, fsrTop, fsrN, elahoS, ...e200S];
console.log('light km', lightLines.map(l => G.len(l).toFixed(2)).join(' '));
const lightPoly = G.buffer(lightLines, 400);
const all = G.union([darkPoly, medPoly, lightPoly]);
const z = G.zone({ id: 'cars51-13', sched: '5.1', item: '13', name: 'Squamish River Valley roads', kind: 'no_shooting', crownOnly: false, huntingOk: true,
  summary: 'No shooting along the Squamish Valley roads (M.U. 2-6): 800 m west and 400 m east of the Squamish River FSR from the Ashlu junction to Branch 700; 600 m of the first 1.5 km of Branches 700 and 800; 400 m of the lower Ashlu River FSR, the road south of the Ashlu junction, the first 3.5 km of Branch 200, the FSR north to the Elaho, and the lower Elaho Main and E200 roads.',
  approx: 'drawn from Synopsis Map B11 (Closed Area 5.1-13/22); the ends of the 400 m road sections are estimated from that map',
  cite: 'Closed Areas Regulation, Schedule 5.1, s. 13 (map 5.1-13/22)' }, all);
z.bbox = T.bbox(z).map(v => Math.round(v * 1e5) / 1e5);
console.log(JSON.stringify(G.report(z)), z.bbox, z.geometry.type);
fs.writeFileSync('zone_squamish.geojson', JSON.stringify({ type: 'FeatureCollection', features: [z] }));
