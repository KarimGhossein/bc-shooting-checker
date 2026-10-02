// Shared geometry helpers for building closed-area zones in node.
global.self = global;
const turf = require(process.env.TURF_PATH || '@turf/turf');
const G = {};
G.turf = turf;
G.lines = (items) => { const out = []; items.forEach(x => { const g = x.g || x.geometry || x; if (!g) return; if (g.type === 'LineString') out.push(g.coordinates); else if (g.type === 'MultiLineString') g.coordinates.forEach(c => out.push(c)); }); return out; };
G.feat = (g) => ({ type: 'Feature', properties: {}, geometry: g });
G.polys = (items) => items.map(x => G.feat(x.g || x.geometry || x));
G.inAny = (pt, polys) => polys.some(p => turf.booleanPointInPolygon(pt, p));
// keep the parts of lines whose segment midpoints satisfy keep(midpoint)
G.filterSegs = (lines, keep) => { const out = []; lines.forEach(l => { let cur = []; for (let i = 0; i < l.length - 1; i++) { const m = [(l[i][0] + l[i + 1][0]) / 2, (l[i][1] + l[i + 1][1]) / 2]; if (keep(m)) { if (!cur.length) cur.push(l[i]); cur.push(l[i + 1]); } else if (cur.length) { out.push(cur); cur = []; } } if (cur.length > 1) out.push(cur); }); return out; };
G.chain = (lines, tol = 30) => { const d = (a, b) => turf.distance(a, b, { units: 'meters' }); const segs = lines.map(l => l.slice()); const out = []; while (segs.length) { let cur = segs.shift(); let grew = true; while (grew) { grew = false; for (let i = 0; i < segs.length; i++) { const s = segs[i]; const a0 = cur[0], a1 = cur[cur.length - 1], b0 = s[0], b1 = s[s.length - 1]; if (d(a1, b0) < tol) cur = cur.concat(s.slice(1)); else if (d(a1, b1) < tol) cur = cur.concat(s.slice().reverse().slice(1)); else if (d(a0, b1) < tol) cur = s.concat(cur.slice(1)); else if (d(a0, b0) < tol) cur = s.slice().reverse().concat(cur.slice(1)); else continue; segs.splice(i, 1); grew = true; break; } } out.push(cur); } return out.sort((a, b) => turf.length(turf.lineString(b)) - turf.length(turf.lineString(a))); };
G.len = (line) => turf.length(turf.lineString(line));
G.locOf = (line, pt) => turf.nearestPointOnLine(turf.lineString(line), turf.point(pt)).properties;
G.junction = (line, others) => { let best = null; const A = turf.lineString(line); others.forEach(o => o.forEach(p => { const n = turf.nearestPointOnLine(A, turf.point(p)); if (!best || n.properties.dist < best.d) best = { d: n.properties.dist, at: n.properties.location }; })); return best; };
G.crossings = (line, others) => { const ls = turf.lineString(line); const pts = []; others.forEach(o => { if (o.length > 1) turf.lineIntersect(ls, turf.lineString(o)).features.forEach(p => pts.push(p.geometry.coordinates)); }); return pts.map(p => ({ pt: p, at: turf.nearestPointOnLine(ls, turf.point(p)).properties.location })).sort((a, b) => a.at - b.at); };
G.slice = (line, a, b) => turf.lineSliceAlong(turf.lineString(line), Math.min(a, b), Math.max(a, b)).geometry.coordinates;
G.buffer = (lines, m, steps = 8) => turf.buffer(turf.multiLineString(lines), m / 1000, { units: 'kilometers', steps });
G.bufferPoly = (f, m) => turf.buffer(f, m / 1000, { units: 'kilometers', steps: 8 });
G.simplify = (f, tol = 0.00008) => turf.simplify(f, { tolerance: tol });
G.round = (g) => JSON.parse(JSON.stringify(g, (k, v) => typeof v === 'number' ? Math.round(v * 1e5) / 1e5 : v));
G.union = (fs) => fs.reduce((a, b) => a ? turf.union(a, b) : b, null);
G.zone = (props, f) => { const s = G.simplify(f); return { type: 'Feature', properties: Object.assign({ region: '2' }, props), geometry: G.round(s.geometry) }; };
G.report = (z) => ({ id: z.properties.id, km2: Math.round(turf.area(z) / 1e4) / 100, bytes: JSON.stringify(z.geometry).length });
module.exports = G;
