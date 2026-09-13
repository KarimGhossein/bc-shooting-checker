// v98: third slice of docs/PLAN.md's module split (after v92's
// config/constants.js + config/layers.js, and v97's data/wfs.js) --
// the shared "what's clickable right here" mechanism: every drawn map
// overlay feature (of any layer type -- parcel, tenure, cutblock, road,
// recreation site, and more) registers itself here via pushClickable(),
// and a single click handler (openNearbyFeaturesPopupAt()) re-tests the
// real click point against everything currently registered, so features
// that genuinely overlap or sit right next to each other surface a
// chooser listing all of them instead of silently hiding everything but
// whichever one Leaflet happened to deliver the DOM click event to.
// Generalizes what v30 originally built for same-type cutblock overlaps
// alone (see the v79 comment further down index.html, kept there since
// it documents the whole feature, not just this file's slice of it).
//
// Plain classic script, not an ES module -- see src/config/constants.js's
// own top comment for the full reasoning (an ES module's import is blocked
// by CORS under file://, which would break both this app's file://-loaded
// test suite and its standalone "open directly, works offline" delivery
// format). Loaded via <script src="src/map/chooser.js">, after
// src/data/wfs.js and before the main inline script -- classic <script>
// tags execute in document order and share one global scope, the same
// mechanism that's always made every function in the (still much larger)
// inline script visible to every other function in it.
//
// Scope note: nothing below touches `map` (the Leaflet map instance) at
// the top level -- every reference to it (pixelToleranceMeters(),
// openNearbyFeaturesPopupAt()) is inside a function body, resolved only
// when that function actually runs, long after the main inline script has
// created `map`. That's what makes this slice safe to load *before* the
// main script despite depending on it -- see the next paragraph for the
// one part of this system that couldn't make the same move.
//
// Deliberately NOT included in this slice, and left inline in the main
// script instead: chooserHighlightLayer, CHOOSER_HIGHLIGHT_STYLE,
// highlightNearbyMatch(), and clearNearbyMatchHighlight() (added in v89,
// after docs/PLAN.md's original target list for this file was written --
// that list names only currentClickableFeatures/pushClickable/
// resetClickableSource/openNearbyFeaturesPopupAt). Unlike everything
// below, `chooserHighlightLayer = L.layerGroup().addTo(map)` runs
// immediately at script-load time, not inside a function body -- it
// can't be moved into a <script src> file that loads before the main
// script without `map` already existing, which it doesn't yet at that
// point. Moving the hover-highlight layer would need either splitting the
// main inline script around its own `map` creation (a bigger, riskier
// change than one coherent slice) or deferring that layer's creation into
// a lazy getter -- neither was asked for here, so it stays put.
// featureNearPoint()'s own point/line/polygon distance math
// (pointToGeomMeters, pointToLineGeomMeters, distanceMeters) also stays
// inline -- those are general-purpose geometry helpers used well beyond
// the chooser (Potential Spots' road/building buffers, among others), not
// part of this system specifically.

// v79: every clickable map overlay feature drawn by the most recent
// renderMapOverlays() call, across every layer type -- parcels, municipal
// boundary, park, WMA, tenures, woodlot, cutblocks, recreation, MVPR, and
// roads -- rebuilt from scratch on each call. A shared click handler tests a
// click against all of these at once (real geometry, not just whichever
// layer happened to be drawn on top at that pixel) so overlapping/adjacent
// features of *any* mix of types surface a chooser instead of silently
// hiding everything but the topmost one.
let currentClickableFeatures = [];
// v83: which of several independent draw passes a currentClickableFeatures
// entry came from -- 'overlay' (the single-click report's own highlight,
// renderMapOverlays()), 'spots' (Potential/Shooting Spots' teal/red/purple
// fills, active-cutblock outlines/buffers, and its own road draw), 'parcelview'
// (View Parcels), 'roadview' (Reveal Road).
let currentPushSource = 'overlay';
// Clears only this source's own previously-pushed entries (so a Potential
// Spots re-run doesn't wipe what the single-click report already registered,
// or vice versa -- the two run concurrently, in either order, from
// runLookup()) and sets currentPushSource so every pushClickable() call that
// follows, until the next reset, is tagged with it.
function resetClickableSource(source){
  currentClickableFeatures = currentClickableFeatures.filter(e => e.source !== source);
  currentPushSource = source;
}
// Whichever currentClickableFeatures entries matched the most recent
// ambiguous (2+ match) click -- a chooser list row indexes into this to open
// its own full detail, the same technique currentCutOpenings (still inline,
// the report's own cutblock list) uses.
let currentNearbyMatches = [];

// v79: registers one drawn map feature (any layer type) into
// currentClickableFeatures, the shared "what's right here" list
// openNearbyFeaturesPopupAt() below tests a click against. geometry is a
// bare GeoJSON geometry -- Polygon/MultiPolygon, LineString/MultiLineString,
// or Point -- never a wrapped Feature. rowLabel is the short escaped text
// shown for this feature in a multi-match chooser list; title+html are what
// opens (as an info modal) if that chooser row is clicked, and html alone is
// what shows directly (as a normal Leaflet popup) when this is the only
// match.
function pushClickable(geometry, icon, rowLabel, title, html){
  if(!geometry) return;
  currentClickableFeatures.push({geometry, icon, rowLabel, title, html, source: currentPushSource});
}

// Converts a screen-pixel click tolerance into real-world meters at the
// clicked location and current zoom, so line/point hit-testing below feels
// consistent on screen regardless of how zoomed in the map is (a fixed
// meters tolerance would be far too generous zoomed out and useless zoomed
// in). Same "measure the real rendered thing" spirit as the rest of this
// app's meters math, just anchored to screen pixels for this one purpose.
function pixelToleranceMeters(latlng, px){
  const pt = map.latLngToContainerPoint(latlng);
  const pt2 = L.point(pt.x + px, pt.y);
  return map.distance(latlng, map.containerPointToLatLng(pt2));
}
const NEARBY_CLICK_LINE_TOLERANCE_PX = 8; // roads/trails -- a thin line needs a forgiving click width
const NEARBY_CLICK_POINT_TOLERANCE_PX = 10; // recreation site markers -- roughly the circleMarker's own radius

// True if a click at latlng should count as hitting this registered
// feature. Polygon/MultiPolygon uses pointToGeomMeters() (inside -> 0, plus
// a real distance to the boundary otherwise) against the same lineTolM
// screen-pixel tolerance the line case uses below, rather than a bare
// pointInGeometry() contains-test -- most of these shapes (tenure, woodlot,
// WMA, municipality) are drawn as a near-invisible fill (fillOpacity 0.03,
// see renderMapOverlays()) with only the dashed outline actually visible, so
// a user naturally clicks *on that line*, which a strict interior-only test
// would frequently miss by a pixel or two and fall through to "No details
// available for this point." A point marker or line feature keeps its own
// screen-pixel-tolerant distance test (pointToLineGeomMeters / distanceMeters,
// both defined elsewhere in this app for the same kind of real-world
// measurement -- see this file's own top comment for why they stayed there).
function featureNearPoint(entry, latlng, lineTolM, pointTolM){
  const lngLat = [latlng.lng, latlng.lat];
  const t = entry.geometry.type;
  if(t === "Polygon" || t === "MultiPolygon") return pointToGeomMeters(lngLat, entry.geometry) <= lineTolM;
  if(t === "LineString" || t === "MultiLineString") return pointToLineGeomMeters(lngLat, entry.geometry) <= lineTolM;
  if(t === "Point"){
    const c = entry.geometry.coordinates;
    return distanceMeters(latlng.lat, latlng.lng, c[1], c[0]) <= pointTolM;
  }
  return false;
}

// v79: the one shared click handler every clickable overlay layer in
// renderMapOverlays() uses, replacing what used to be a plain per-layer
// bindPopup() (or, for cutblocks alone since v30, a same-type-only overlap
// chooser). Leaflet only ever delivers a click event to whichever *single*
// shape is drawn on top at that pixel, so two or more overlapping/adjacent
// features -- of any mix of layer types, a tenure polygon and a cutblock and
// a road all passing through the same spot, not just same-type records --
// would otherwise silently hide everything but the topmost one. This
// instead re-tests the real click point against every feature currently
// registered in currentClickableFeatures (any type) and opens either that
// one record's normal popup (the common, single-match case -- unchanged
// from before this existed) or a chooser listing all of them, exactly the
// way the old cutblock-only version worked, just no longer limited to
// cutblocks.
function openNearbyFeaturesPopupAt(latlng){
  const lineTolM = pixelToleranceMeters(latlng, NEARBY_CLICK_LINE_TOLERANCE_PX);
  const pointTolM = pixelToleranceMeters(latlng, NEARBY_CLICK_POINT_TOLERANCE_PX);
  const matches = currentClickableFeatures.filter(f => featureNearPoint(f, latlng, lineTolM, pointTolM));
  let html;
  if(matches.length === 0){
    // Shouldn't normally happen -- this handler is only ever attached to an
    // actually-drawn feature, so the click point should always match at
    // least that one. Defensive fallback rather than an empty popup.
    html = `<div style="font-size:12.5px">No details available for this point.</div>`;
  } else if(matches.length === 1){
    // The common case -- same single-record popup every layer showed before this existed.
    html = matches[0].html;
  } else {
    currentNearbyMatches = matches;
    // v89: onmouseover/onmouseout highlight this row's own shape on the map
    // -- see highlightNearbyMatch()/clearNearbyMatchHighlight(), still
    // inline in the main script (this file's own top comment explains why).
    const rows = matches.map((m, i) => `<div class="field clickable" onclick="showNearbyFeatureDetail(${i})" onmouseover="highlightNearbyMatch(${i})" onmouseout="clearNearbyMatchHighlight()"><span class="chev">details ›</span>${m.icon} ${m.rowLabel}</div>`).join('');
    html = `<div style="font-size:12.5px;line-height:1.7;min-width:220px">
      <b>${matches.length} records here</b><br>
      <span style="color:#6b7380">These overlap or sit right at this point on the map -- pick one below for its full details.</span>
      ${rows}
    </div>`;
  }
  // autoPan:false -- Leaflet's popups auto-pan the map by default to keep
  // themselves fully in view, which can still shift the *viewport* (not the
  // selected location) when several overlapping/adjacent features are
  // clustered near a map edge. Minor, but same "don't move the ground under
  // you while browsing what's here" goal as bubblingMouseEvents:false
  // elsewhere in this app.
  L.popup({maxWidth: 280, autoPan: false}).setLatLng(latlng).setContent(html).openOn(map);
}
// A chooser list row's full detail, opened as an info modal (same pattern
// the old cutblock-only chooser used) rather than trying to reposition a
// second Leaflet popup over the first -- works identically for any feature
// type since title/html were precomputed once, at draw time, in pushClickable().
function showNearbyFeatureDetail(i){
  const m = currentNearbyMatches[i];
  if(!m) return;
  openInfoModal(m.title, m.html);
}
