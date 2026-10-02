const G = require('./geo.js'); const turf = G.turf; const fs = require('fs');
const S = JSON.parse(fs.readFileSync('src_b3.json', 'utf8')); const M = JSON.parse(fs.readFileSync('src_mu.json', 'utf8'));
const muni = (name) => G.polys(S.muni.filter(m => m.p.ADMIN_AREA_NAME === name));
const out = []; const log = {};
const MAINCLS = ['highway', 'freeway', 'arterial'];
// S9#1 (1) Hwy 1 from the east boundary of Chilliwack to the north boundary of M.U. 2-18; (2) Hwy 7 from the east boundary of Mission to Hwy 1
const mu218 = G.polys(M.mu.filter(m => m.p.WILDLIFE_MGMT_UNIT_ID === '2-18'));
const chw = muni('City of Chilliwack'), mis = muni('City of Mission');
const chwMaxLon = Math.max(...chw.map(p => turf.bbox(p)[2])), misMaxLon = Math.max(...mis.map(p => turf.bbox(p)[2]));
const h1 = G.filterSegs(G.lines(S.hwy1.filter(x => MAINCLS.includes(x.p.ROAD_CLASS))), m => m[0] > chwMaxLon - 0.05 && !G.inAny(m, chw) && (G.inAny(m, mu218) || m[1] < 49.45));
const h7 = G.filterSegs(G.lines(S.hwy7.filter(x => MAINCLS.includes(x.p.ROAD_CLASS))), m => m[0] > misMaxLon - 0.05 && !G.inAny(m, mis));
log.h1 = h1.reduce((a, l) => a + G.len(l), 0); log.h7 = h7.reduce((a, l) => a + G.len(l), 0);
log.mu218bbox = mu218.map(p => turf.bbox(p));
out.push(G.zone({ id: 'cars9-1', sched: '9', item: '1', name: 'Highways 1 and 7, Fraser Valley', kind: 'shot_only', approx: 'Measured as 160 m from the highway centreline to approximate 150 m from the travelled lanes.', summary: 'Firearms using shot only within 150 m of Highway 1 from the east boundary of Chilliwack to the north boundary of M.U. 2-18, and of Highway 7 from the east boundary of Mission to Highway 1.' }, G.buffer([...h1, ...h7], 160)));
fs.writeFileSync('zones_b4.geojson', JSON.stringify({ type: 'FeatureCollection', features: out }));
console.log(JSON.stringify(log)); console.log(out.map(G.report));
