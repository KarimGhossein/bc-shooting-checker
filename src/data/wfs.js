// v97: second slice of docs/PLAN.md's module split (after v92's
// config/constants.js + config/layers.js) -- the WFS query layer every
// feature in this app is ultimately built on: turning a lat/lng or a map
// viewport into a CQL filter, turning that into a DataBC WFS GetFeature
// URL, and actually fetching it (fetch first, JSONP fallback, since
// DataBC's WFS server doesn't send CORS headers -- see queryLayer()'s own
// comment below).
//
// Plain classic script, not an ES module -- see src/config/constants.js's
// own top comment for the full reasoning (an ES module's import is blocked
// by CORS under file://, which would break both this app's file://-loaded
// test suite and its standalone "open directly, works offline" delivery
// format). Loaded via <script src="src/data/wfs.js">, after
// src/config/layers.js (cqlFor() below references LAYERS by bare name) and
// before the main inline script -- classic <script> tags execute in
// document order and share one global scope, the same mechanism that's
// always made every function in the (still much larger) inline script
// visible to every other function in it.
//
// Scope note: DriveBC's Open511 API (queryOpen511(), still inline) is
// deliberately NOT included here even though docs/PLAN.md's target
// structure lists it as a future data/open511.js -- it's a separate REST
// JSON service, not a DataBC WFS layer, and doesn't share any of the
// CQL/GetFeature machinery below. Likewise radiusCql() (still inline, near
// boundsAroundPoint()) is a DWITHIN-CQL builder in the same spirit as
// cqlFor()/viewportBboxCql() below, but wasn't in this slice's original
// scope -- left in place for a later pass rather than folded in here
// without being asked, matching this migration's own "one coherent slice
// at a time" rule.

const WFS_BASE = "https://openmaps.gov.bc.ca/geo/pub";

function wfsUrl(typeName, cql, outputFormat, count){
  const params = {
    service: "WFS", version: "2.0.0", request: "GetFeature",
    typeName, outputFormat, srsName: "EPSG:4326", CQL_FILTER: cql
  };
  if(count) params.count = String(count);
  const p = new URLSearchParams(params);
  return `${WFS_BASE}/${typeName}/ows?${p.toString()}`;
}

// DataBC's WFS server doesn't send Access-Control-Allow-Origin, so a plain
// fetch() from a page hosted anywhere else gets blocked by the browser's CORS
// policy even though the server itself would happily answer. GeoServer (what
// DataBC runs) exposes a JSONP output format specifically for this situation
// -- loading the data via a <script> tag instead of fetch/XHR sidesteps CORS
// entirely, because script tags were never subject to the same-origin policy.
let jsonpCounter = 0;
function jsonpRequest(url, timeoutMs=12000){
  return new Promise((resolve, reject) => {
    const cbName = `__wfsCb_${Date.now().toString(36)}_${jsonpCounter++}`;
    const script = document.createElement('script');
    let settled = false;
    const finish = (fn) => (...args) => {
      if(settled) return;
      settled = true;
      clearTimeout(timer);
      delete window[cbName];
      script.remove();
      fn(...args);
    };
    const succeed = finish(resolve);
    const fail = finish(reject);
    window[cbName] = (data) => succeed(data);
    const timer = setTimeout(() => fail(new Error("timed out")), timeoutMs);
    script.onerror = () => fail(new Error("script load error"));
    const sep = url.includes('?') ? '&' : '?';
    script.src = `${url}${sep}format_options=${encodeURIComponent('callback:' + cbName)}`;
    document.head.appendChild(script);
  });
}

async function queryLayer(typeName, cql, timeoutMs=9000, count){
  // Try a normal fetch first (works fine if this page is ever served from
  // somewhere DataBC does allow, or if that ever changes) ...
  try{
    const ctrl = new AbortController();
    const t = setTimeout(()=>ctrl.abort(), 4000);
    const res = await fetch(wfsUrl(typeName, cql, "json", count), {signal: ctrl.signal});
    clearTimeout(t);
    if(res.ok){
      const data = await res.json();
      return {ok:true, features: data.features || []};
    }
  }catch(err){ /* fall through to JSONP */ }

  // ...and fall back to JSONP, which is the reliable path in a browser.
  try{
    const data = await jsonpRequest(wfsUrl(typeName, cql, "text/javascript", count), timeoutMs);
    return {ok:true, features: (data && data.features) || []};
  }catch(err){
    return {ok:false, error: (err && err.message === "timed out") ? "timed out" : "network error"};
  }
}

function pt(lat,lng){ return `SRID=4326;POINT(${lng} ${lat})`; }

function cqlFor(layerKey, lat, lng){
  const L = LAYERS[layerKey];
  const spatial = L.mode === "intersects" ? `INTERSECTS(${L.geom}, ${pt(lat,lng)})` : `DWITHIN(${L.geom}, ${pt(lat,lng)}, ${L.radius}, meters)`;
  return L.extraFilter ? `${spatial} AND ${L.extraFilter}` : spatial;
}

// Viewport queries went through two broken attempts at CQL's BBOX() function
// before this one: first with an explicit 'EPSG:4326' CRS argument (which,
// per GeoServer's own axis-order docs, gets read as lat/lon -- the opposite
// of the lng,lat this app supplied, producing invalid coordinates and a hard
// server-side rejection), then with no CRS argument at all (which, lacking
// an explicit CRS, most likely falls back to the layer's *native* SRS --
// BC Albers meters, not lon/lat degrees -- silently matching nothing, valid
// syntax but a bounding box nowhere near the real data). Rather than keep
// guessing at BBOX()'s CRS handling, this uses INTERSECTS() with an explicit
// WKT polygon instead -- the exact same "SRID=4326;<WKT>" convention as
// pt() above, which every point-based query in this app already uses
// successfully and has been confirmed working against real BC data. A
// rectangle here instead of a point, same mechanism.
function viewportPolygonWkt(bounds){
  const sw = bounds.getSouthWest(), ne = bounds.getNorthEast();
  const ring = `${sw.lng} ${sw.lat}, ${ne.lng} ${sw.lat}, ${ne.lng} ${ne.lat}, ${sw.lng} ${ne.lat}, ${sw.lng} ${sw.lat}`;
  return `SRID=4326;POLYGON((${ring}))`;
}
function viewportBboxCql(geomField, bounds, extraFilter){
  const spatial = `INTERSECTS(${geomField}, ${viewportPolygonWkt(bounds)})`;
  return extraFilter ? `${spatial} AND ${extraFilter}` : spatial;
}
