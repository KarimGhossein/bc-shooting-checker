// v113: exact clipping for Shooting Spots.
//
// Before v113 a presumed-Crown (purple) cell or a part of a Crown parcel
// (teal) was tested at one sample point and then kept or dropped whole, so a
// 25 m road buffer could punch out a 190 m square while the next square, the
// road clipping only its corner, stayed. Now every restriction is a real
// polygon (the 600 m private-land buffer, the 25 m road buffer, the 600 m
// listed-highway buffer, parks, reserves, municipalities, Wildlife Act
// no-shooting areas and, for purple, every parcel record) and the allowed
// shape is the area left after cutting all of them out.
//
// Classic script (see src/config/constants.js for why). Needs Turf.js, which
// render.js loads on demand (loadTurf); callers fall back to the old
// sample-point method if Turf can't load.

const SPOTCLIP_CHUNK_VERTS = 24;   // roads are buffered in short pieces so each piece has a tight bbox
const SPOTCLIP_STEPS = 6;          // buffer arc smoothness (per quarter circle)
const SPOTCLIP_MIN_AREA_M2 = 4;    // ignore slivers left by floating point

function spotclipBbox(f){ return turf.bbox(f); }
function spotclipBboxesOverlap(a, b){ return a[0] <= b[2] && a[2] >= b[0] && a[1] <= b[3] && a[3] >= b[1]; }
function spotclipFeature(geom, props){ return {type: 'Feature', properties: props || {}, geometry: geom}; }
function spotclipArea(f){ try{ return f ? turf.area(f) : 0; }catch(e){ return 0; } }

function spotclipLineChunks(geom){
  const lines = geom.type === 'LineString' ? [geom.coordinates] : geom.type === 'MultiLineString' ? geom.coordinates : [];
  const out = [];
  lines.forEach(l => {
    if(!l || l.length < 2) return;
    for(let i = 0; i < l.length - 1; i += SPOTCLIP_CHUNK_VERTS - 1) out.push(l.slice(i, Math.min(l.length, i + SPOTCLIP_CHUNK_VERTS)));
  });
  return out;
}
function spotclipBuffer(f, meters){
  try{ return turf.buffer(f, meters / 1000, {units: 'kilometers', steps: SPOTCLIP_STEPS}) || null; }catch(e){ return null; }
}

// Builds the list of restriction polygons once per search.
// kinds: park | reserve | closed | muni | private | road | highway | parcel
// Buffers are built lazily: an entry carries the source shape's bbox grown by
// the buffer distance, and the buffer itself is only computed the first time
// a spot shape actually reaches it. A built-up area can return thousands of
// private parcels, almost none of which ever touch a candidate spot.
function spotclipGrowBbox(b, meters){
  const midLat = (b[1] + b[3]) / 2;
  const dLat = meters / 111320, dLng = meters / (111320 * Math.cos(midLat * Math.PI / 180));
  return [b[0] - dLng, b[1] - dLat, b[2] + dLng, b[3] + dLat];
}
function spotclipLazy(source, meters, kind, extra){
  let built = false, f = null;
  const e = Object.assign({kind, bbox: spotclipGrowBbox(spotclipBbox(source), meters), used: false, lazy: true}, extra || {});
  Object.defineProperty(e, 'f', {get(){ if(!built){ built = true; f = spotclipBuffer(source, meters); } return f; }});
  return e;
}
function buildSpotExclusions({parks = [], reserves = [], closedBans = [], munis = [], privateParcels = [], roads = [], parcels = []}, opts = {}){
  const out = [];
  const add = (f, kind) => {
    if(!f || !f.geometry) return;
    try{ out.push({f, bbox: spotclipBbox(f), kind, used: false}); }catch(e){ /* skip a bad geometry */ }
  };
  parks.forEach(p => add(spotclipFeature(p.geometry), 'park'));
  reserves.forEach(p => add(spotclipFeature(p.geometry), 'reserve'));
  closedBans.forEach(p => add(spotclipFeature(p.geometry), 'closed'));
  munis.forEach(p => add(spotclipFeature(p.geometry), 'muni'));
  // parcel records before the buffers, so a cell inside a parcel is dropped before any buffer is built
  parcels.forEach(p => add(spotclipFeature(p.geometry), 'parcel'));
  if(opts.infra){
    privateParcels.forEach(p => {
      if(!p.geometry) return;
      try{
        let f = spotclipFeature(p.geometry);
        try{ f = turf.simplify(f, {tolerance: 0.00005}); }catch(e){ /* keep the original */ }
        out.push(spotclipLazy(f, opts.privateBufferM, 'private'));
      }catch(e){ /* skip a bad geometry */ }
    });
    roads.forEach(r => {
      if(!r.geometry) return;
      spotclipLineChunks(r.geometry).forEach(c => { try{ out.push(spotclipLazy(turf.lineString(c), r.bufferM, r.special ? 'highway' : 'road', {bufferM: r.bufferM})); }catch(e){ /* skip */ } });
    });
  }
  return out;
}

// shape minus every exclusion (of the given kinds) that overlaps it.
// Returns {feature (null when nothing is left), removed: Set of kinds that
// actually took area away, whole: true when nothing was cut}.
function clipToAllowed(shape, exclusions, kinds){
  let cur = shape;
  const removed = new Set();
  const bb = spotclipBbox(shape);
  const pad = [bb[0] - 1e-5, bb[1] - 1e-5, bb[2] + 1e-5, bb[3] + 1e-5];
  const startArea = spotclipArea(shape);
  const probes = [[bb[0], bb[1]], [bb[2], bb[1]], [bb[2], bb[3]], [bb[0], bb[3]], [(bb[0] + bb[2]) / 2, (bb[1] + bb[3]) / 2]];
  const near = exclusions.filter(ex => (!kinds || kinds.includes(ex.kind)) && spotclipBboxesOverlap(ex.bbox, pad));
  // fast path: one restriction covers the whole shape (corners and centre),
  // checked before any cutting; plain polygons first, then buffers
  const inside = (ex) => { const g = ex.f; if(!g) return false; return probes.every(pt => { try{ return turf.booleanPointInPolygon(pt, g); }catch(e){ return false; } }); };
  for(const ex of near.filter(e => !e.lazy).concat(near.filter(e => e.lazy))){
    if(inside(ex)){ removed.add(ex.kind); ex.used = true; return {feature: null, removed, whole: false}; }
  }
  for(const ex of near){
    const whole = ex.f;
    if(!whole) continue;
    let piece = whole;
    try{ piece = turf.bboxClip(whole, pad); }catch(e){ piece = whole; }
    if(spotclipArea(piece) < SPOTCLIP_MIN_AREA_M2) continue;
    const before = spotclipArea(cur);
    let next;
    try{ next = turf.difference(cur, piece); }catch(e){ continue; }
    const after = next ? spotclipArea(next) : 0;
    if(after < before - SPOTCLIP_MIN_AREA_M2){ removed.add(ex.kind); ex.used = true; }
    if(!next || after < SPOTCLIP_MIN_AREA_M2) return {feature: null, removed, whole: false};
    cur = next;
  }
  return {feature: cur, removed, whole: !removed.size || spotclipArea(cur) >= startArea - SPOTCLIP_MIN_AREA_M2};
}

// Merges many polygons into one (pairwise, so each union stays small).
function dissolvePolygons(features){
  let list = features.filter(Boolean);
  if(!list.length) return null;
  while(list.length > 1){
    const next = [];
    for(let i = 0; i < list.length; i += 2){
      if(i + 1 >= list.length){ next.push(list[i]); continue; }
      let u = null;
      try{ u = turf.union(list[i], list[i + 1]); }catch(e){ u = null; }
      if(u) next.push(u); else next.push(list[i], list[i + 1]);
      if(!u && list.length === 2) return turf.featureCollection([list[0], list[1]]);
    }
    if(next.length === list.length) return turf.featureCollection(list); // nothing merged, stop
    list = next;
  }
  return list[0];
}

// The restriction buffers drawn on the map so nothing is excluded silently:
// one merged shape per kind, trimmed to the searched area. Only buffers that
// actually cut something away are drawn, so the map explains every gap in
// the spots without blanketing a built-up area in red.
function spotBufferShapes(exclusions, bbox){
  const out = {};
  ['private', 'road', 'highway'].forEach(kind => {
    const parts = exclusions.filter(e => e.kind === kind && e.used && spotclipBboxesOverlap(e.bbox, bbox)).map(e => {
      try{ return turf.bboxClip(e.f, bbox); }catch(err){ return e.f; }
    }).filter(f => spotclipArea(f) >= SPOTCLIP_MIN_AREA_M2);
    out[kind] = parts.length ? dissolvePolygons(parts) : null;
  });
  return out;
}
