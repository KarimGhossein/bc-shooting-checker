// Closed-area geometry builder helpers, injected into a browser page on an
// origin that can fetch openmaps.gov.bc.ca (CORS) and load turf from jsdelivr.
(async () => {
  if (!window.turf) await new Promise((res, rej) => { const s = document.createElement('script'); s.src = 'https://cdn.jsdelivr.net/npm/@turf/turf@6.5.0/turf.min.js'; s.onload = res; s.onerror = () => rej('turf'); document.head.appendChild(s); });
})();
window.wfs = async (typeName, cql, props, count = 5000) => {
  const u = 'https://openmaps.gov.bc.ca/geo/pub/wfs?' + new URLSearchParams({ service: 'WFS', version: '2.0.0', request: 'GetFeature', typeNames: typeName, outputFormat: 'application/json', srsName: 'EPSG:4326', count: String(count), CQL_FILTER: cql, ...(props ? { propertyName: props } : {}) });
  const r = await fetch(u); if (!r.ok) throw new Error(r.status + ' ' + (await r.text()).slice(0, 300)); return r.json();
};
window.R2BOX = [-125.2, 48.95, -120.8, 50.95];
window.bboxPoly = (b) => `SRID=4326;POLYGON((${b[0]} ${b[1]}, ${b[2]} ${b[1]}, ${b[2]} ${b[3]}, ${b[0]} ${b[3]}, ${b[0]} ${b[1]}))`;
window.q = async (layer, geomField, cql, b = R2BOX, props = null, count = 5000) => (await wfs(layer, `(${cql}) AND INTERSECTS(${geomField}, ${bboxPoly(b)})`, props, count)).features;
window.FTEN = 'WHSE_FOREST_TENURE.FTEN_ROAD_SECTION_LINES_SVW';
window.DRA = 'WHSE_BASEMAPPING.DRA_DGTL_ROAD_ATLAS_MPAR_SP';
window.FWA_STREAM = 'WHSE_BASEMAPPING.FWA_STREAM_NETWORKS_SP';
window.FWA_LAKE = 'WHSE_BASEMAPPING.FWA_LAKES_POLY';
window.FWA_ISLAND = 'WHSE_BASEMAPPING.FWA_ISLANDS_POLY';
window.FWA_WS = 'WHSE_BASEMAPPING.FWA_NAMED_WATERSHEDS_POLY';
window.MUNI = 'WHSE_LEGAL_ADMIN_BOUNDARIES.ABMS_MUNICIPALITIES_SP';
window.EA = 'WHSE_LEGAL_ADMIN_BOUNDARIES.ABMS_ELECTORAL_AREAS_SP';
window.PARK = 'WHSE_TANTALIS.TA_PARK_ECORES_PA_SVW';
window.toLines = (feats) => { const out = []; feats.forEach(f => { const g = f.geometry || f; if (!g) return; if (g.type === 'LineString') out.push(g.coordinates); else if (g.type === 'MultiLineString') g.coordinates.forEach(c => out.push(c)); }); return out; };
window.bufferLines = (lines, m) => { let b = turf.buffer(turf.multiLineString(lines), m / 1000, { units: 'kilometers', steps: 8 }); return turf.simplify(b, { tolerance: 0.00008 }); };
window.simplifyPoly = (f, tol = 0.00008) => turf.simplify(f, { tolerance: tol });
window.roundGeom = (g) => JSON.parse(JSON.stringify(g, (k, v) => typeof v === 'number' ? Math.round(v * 1e5) / 1e5 : v));
window.ZONES = window.ZONES || [];
window.mk = (id, o) => Object.assign({ id, region: '2', consolidatedTo: '2026-09-29' }, o);
window.addZone = (props, geom) => { const g = roundGeom(geom.geometry || geom); const f = { type: 'Feature', properties: props, geometry: g }; window.ZONES = window.ZONES.filter(z => z.properties.id !== props.id); window.ZONES.push(f); return { id: props.id, bytes: JSON.stringify(g).length, km2: Math.round(turf.area(f) / 1e4) / 100 }; };
window.ftenRoads = async (names, file, { spurs = false, b = R2BOX } = {}) => { const nc = names.map(n => spurs ? `ROAD_SECTION_NAME ILIKE '${n.replace(/'/g, "''")}%'` : `ROAD_SECTION_NAME = '${n.replace(/'/g, "''")}'`).join(' OR '); let cql = `(${nc}) AND RETIREMENT_DATE IS NULL`; if (file) cql += ` AND FOREST_FILE_ID IN (${[].concat(file).map(x => `'${x}'`).join(',')})`; return q(FTEN, 'GEOMETRY', cql, b, 'ROAD_SECTION_NAME,FOREST_FILE_ID,GEOMETRY'); };
window.draRoads = async (cql, b) => q(DRA, 'GEOMETRY', cql, b, 'ROAD_NAME_FULL,HIGHWAY_ROUTE_NUMBER,ROAD_CLASS,GEOMETRY');
window.chain = (lines) => { const d = (a, b) => turf.distance(a, b, { units: 'meters' }); const segs = lines.map(l => l.slice()); const out = []; while (segs.length) { let cur = segs.shift(); let grew = true; while (grew) { grew = false; for (let i = 0; i < segs.length; i++) { const s = segs[i]; const a0 = cur[0], a1 = cur[cur.length - 1], b0 = s[0], b1 = s[s.length - 1]; const tol = 30; if (d(a1, b0) < tol) cur = cur.concat(s.slice(1)); else if (d(a1, b1) < tol) cur = cur.concat(s.slice().reverse().slice(1)); else if (d(a0, b1) < tol) cur = s.concat(cur.slice(1)); else if (d(a0, b0) < tol) cur = s.slice().reverse().concat(cur.slice(1)); else continue; segs.splice(i, 1); grew = true; break; } } out.push(cur); } return out.sort((a, b) => turf.length(turf.lineString(b)) - turf.length(turf.lineString(a))); };
window.locOn = (line, pt) => turf.nearestPointOnLine(turf.lineString(line), turf.point(pt.geometry ? pt.geometry.coordinates : pt)).properties;
window.nearestJunction = (lineA, linesB) => { let best = null; const A = turf.lineString(lineA); linesB.forEach(lb => lb.forEach(p => { const n = turf.nearestPointOnLine(A, turf.point(p)); if (!best || n.properties.dist < best.d) best = { d: n.properties.dist, at: n.properties.location, pt: n.geometry.coordinates }; })); return best; };
window.crossings = (line, others) => { const ls = turf.lineString(line); const pts = []; others.forEach(o => { if (o.length > 1) turf.lineIntersect(ls, turf.lineString(o)).features.forEach(p => pts.push(p)); }); return pts.map(p => ({ pt: p.geometry.coordinates, at: turf.nearestPointOnLine(ls, p).properties.location })).sort((a, b) => a.at - b.at); };
window.sliceAlong = (line, a, b) => turf.lineSliceAlong(turf.lineString(line), Math.min(a, b), Math.max(a, b)).geometry.coordinates;
window.lineBbox = (lines, pad = 0.03) => { const b = turf.bbox(turf.multiLineString([].concat(lines))); return [b[0] - pad, b[1] - pad, b[2] + pad, b[3] + pad]; };
window.streamLines = async (name, b) => toLines(await q(FWA_STREAM, 'GEOMETRY', `GNIS_NAME = '${name.replace(/'/g, "''")}'`, b, 'GNIS_NAME,GEOMETRY'));
window.clipLinesToPoly = (lines, poly, keepInside = true) => { const P = turf.simplify(poly, { tolerance: 0.0003 }); const out = []; lines.forEach(l => { let cur = []; for (let i = 0; i < l.length - 1; i++) { const m = [(l[i][0] + l[i + 1][0]) / 2, (l[i][1] + l[i + 1][1]) / 2]; const ins = turf.booleanPointInPolygon(m, P) === keepInside; if (ins) { if (!cur.length) cur.push(l[i]); cur.push(l[i + 1]); } else if (cur.length) { out.push(cur); cur = []; } } if (cur.length > 1) out.push(cur); }); return out; };
window.job = (name, fn) => { window.__jobs = window.__jobs || {}; window.__jobs[name] = { status: 'running', t: Date.now() }; Promise.resolve().then(fn).then(r => window.__jobs[name] = { status: 'done', r }).catch(e => window.__jobs[name] = { status: 'error', e: String(e && e.stack || e).slice(0, 500) }); return 'started ' + name; };
window.jobs = () => window.__jobs;
'lib loaded';
