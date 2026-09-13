// v99: fourth slice of docs/PLAN.md's module split (after v92's config/*.js,
// v97's data/wfs.js, and v98's map/chooser.js) -- the first of several
// planned passes through map/render.js (per the plan's own "Suggested
// order": "the biggest slice; do this one in a few passes -- report-click
// rendering, then Shooting Spots, then View Parcels/Reveal Road -- not all
// at once"). This pass is exactly that first one: everything that draws the
// single-click location report's own shapes onto the map. Shooting Spots'
// renderActiveCutblockOutlines/renderActiveCutblockBuffers/renderNearbyRoads
// and View Parcels/Reveal Road's drawParcelViewLayer/revealAllParcels/
// revealAllRoads are deliberately NOT part of this slice -- they're the
// next two passes, kept separate on purpose rather than folded in early.
//
// Plain classic script, not an ES module -- see src/config/constants.js's
// own top comment for the full reasoning (an ES module's import is blocked
// by CORS under file://, which would break both this app's file://-loaded
// test suite and its standalone "open directly, works offline" delivery
// format). Loaded via <script src="src/map/render.js">, after
// src/map/chooser.js (renderMapOverlays calls pushClickable()/
// resetClickableSource()/openNearbyFeaturesPopupAt(), all defined there)
// and before the main inline script -- classic <script> tags execute in
// document order and share one global scope, the same mechanism that's
// always made every function in the (still much larger) inline script
// visible to every other function in it.
//
// Scope note (the v98 lesson docs/PLAN.md flagged ahead of this slice):
// `overlayLayer` -- the parent layer group renderMapOverlays() draws every
// category's own sub-layer-group into -- is declared as
// `const overlayLayer = L.layerGroup().addTo(map)`, which runs immediately
// at script-load time, not inside a function body. Every <script src> file
// in this migration loads *before* the main inline script creates `map`
// (line ~1603), so a top-level statement that touches `map` immediately
// can't move into one of these files -- only code that references `map`
// from inside a function body can, since that's resolved later, at call
// time, long after `map` exists. `overlayLayer` therefore stays inline,
// exactly like v98's chooserHighlightLayer before it. OVERLAY_CATEGORY_KEYS
// and overlayCategoryLayers moved fine, though -- a plain array literal and
// a plain object literal, neither touches `map` at all.
//
// Also deliberately left inline, for unrelated reasons: every *Popup()
// builder this file's functions call (parcelPopup, tenurePopup,
// woodlotPopup, wmaPopup, muniPopup, parkPopup, cutblockPopup,
// recreationPopup, mvprPopup, roadPopup) -- those build the HTML content
// shown in each popup/chooser-modal, one per report card/section, and
// belong with docs/PLAN.md's future ui/report.js (renderReport + report
// cards) rather than with the map-drawing logic here. Likewise `esc()`,
// `ownerCategory()`, `OWNER_COLORS`, and `fmtDate()` -- general-purpose
// utilities used well beyond this file. All of these are called only from
// inside function bodies below, so which file they live in doesn't matter
// for correctness -- classic scripts sharing one global scope resolve a
// name at call time, not at the calling file's own load time.

// v87: one sub-layer-group per single-click report category -- the same
// keys renderReport()'s pushCard() calls already use ('parcel',
// 'municipality', 'park', 'wma', 'recreation', 'mvpr', 'cutblocks',
// 'tenures', 'woodlot', 'road'; 'bylaw' has no map shape of its own, so it's
// not here). Lets the Clear dropdown remove one report category's shapes
// without touching the other nine. Rebuilt fresh and empty at the top of
// every renderMapOverlays() call -- each new click starts every category
// over from nothing, same as before.
const OVERLAY_CATEGORY_KEYS = ['parcel','municipality','park','wma','recreation','mvpr','cutblocks','tenures','woodlot','road'];
let overlayCategoryLayers = {};

// v85: pulled out of renderMapOverlays()'s own inline forEach so Reveal Road
// can draw the exact same forest-tenure road network (FTEN Road Section
// Lines -- LAYERS.road), styled and popup'd identically, instead of only
// ever drawing BC's general public road network (DRA). See the v85 build
// notes section for why DRA alone was the actual bug Karim reported.
function renderForestServiceRoads(features, targetLayer){
  (features || []).forEach(f => {
    if(!f.geometry) return;
    const retired = !!f.properties.RETIREMENT_DATE;
    const color = retired ? "#8f96a3" : "#c98a1f";
    // bubblingMouseEvents:false -- same reasoning as every other overlay
    // layer: without it, a click here also reaches the map underneath and
    // re-selects that point as a brand-new location.
    L.geoJSON(f, {style:{color, weight:3.5}, bubblingMouseEvents:false})
      .bindTooltip(roadPopup(f.properties), {sticky:true, direction:"top", opacity:0.97, className:"road-tooltip"})
      .on('click', e => openNearbyFeaturesPopupAt(e.latlng))
      .addTo(targetLayer);
    const roadLabel = esc(f.properties.ROAD_SECTION_NAME || f.properties.MAP_LABEL || "Forest service road");
    pushClickable(f.geometry, '🛣️', `${roadLabel} — ${retired ? "retired" : "active"}`, '🛣️ Road access', roadPopup(f.properties));
  });
}

// v79: registers one drawn map feature (any layer type) into
// currentClickableFeatures, the shared "what's right here" list
// openNearbyFeaturesPopupAt() tests a click against -- see src/map/chooser.js.
// Cutblock polygons genuinely overlap in BC's own data reasonably often (a
// RESULTS opening and an FTEN cutting-permit block covering the same
// physical block, or two separate blocks whose boundaries share ground),
// and Leaflet only ever delivers a click event to whichever polygon is
// drawn on top at that pixel, so the shared chooser (not a plain per-layer
// bindPopup()) is what makes every genuinely-overlapping record findable
// regardless of stacking order.
// v76: factored out of renderMapOverlays()'s cutblock-drawing loop so the
// exact same colour logic can also drive a list row's hover-highlight (see
// the #report mouseover delegation, still inline in the main script) without
// duplicating it.
// Green = closed out; red = disturbed but not closed out (active); blue-grey
// = planned only -- authorized but nothing on the ground yet, the case that
// used to be invisible because it only exists in FTEN, not RESULTS.
function cutblockColor(entry){
  if(entry.harvestEndDate || entry.closed) return "#2f9e44";
  if(entry.disturbanceStart) return "#d13438";
  return "#4f6f93";
}
function cutblockStyle(color){ return {color, weight:1.5, fillColor:color, fillOpacity:0.32}; }
// v76: the highlighted variant used while a cutblock's own report-card list
// row is hovered -- same colour, just heavier/more opaque so the shape reads
// as "this one" against the rest of the drawn cutblocks around it.
function cutblockHighlightStyle(color){ return {color, weight:4, fillColor:color, fillOpacity:0.65}; }

// The single-click location report's own map-drawing pass: takes every
// layer's query result for the picked point and draws whichever of them
// actually returned something, registering each drawn feature with the
// shared chooser (pushClickable()) so overlapping/adjacent features surface
// a "N records here" choice instead of silently hiding all but the topmost.
function renderMapOverlays({parcelR, muniR, parkR, cutList, tenureR, woodlotR, roadR, nearbyParcelR, recList, mvprList, wmaR}){
  let fitLayer = null;
  // v79: rebuilt fresh for this lookup -- see currentClickableFeatures' own
  // declaration in src/map/chooser.js for why this exists and how it's used
  // (openNearbyFeaturesPopupAt()). v83: only clears this function's own
  // entries now, not the whole array -- Potential Spots' 'spots' entries
  // (pushed independently, concurrently, from runLookup()) must survive
  // this reset and vice versa. v87: what used to be one shared 'overlay'
  // source is now one per report category ('overlay:parcel', 'overlay:road',
  // etc.) so a single category's chooser entries can be dropped
  // independently -- see overlayCategoryLayers' own declaration above. Each
  // category's own draw block below sets currentPushSource to its key just
  // before pushing.
  OVERLAY_CATEGORY_KEYS.forEach(k => {
    resetClickableSource('overlay:' + k);
    if(overlayCategoryLayers[k]) overlayLayer.removeLayer(overlayCategoryLayers[k]);
    overlayCategoryLayers[k] = L.layerGroup().addTo(overlayLayer);
  });

  // Parcels are drawn first, deliberately, so they sit at the *bottom* of the
  // map's stacking order. A parcel -- especially a large provincial Crown
  // one -- is often the biggest shape on the map; drawing it last (as this
  // used to) put its filled polygon on top of everything else, which
  // visually hid the smaller tenure/woodlot/cutblock/road shapes underneath
  // it. Every other layer below is added after this, so it renders above
  // the parcel fill visually. (Z-order alone doesn't fully solve clicks --
  // see the shared click chooser, openNearbyFeaturesPopupAt() in
  // src/map/chooser.js, and the fillOpacity notes on tenure/woodlot/WMA/
  // municipality below, for why a smaller feature's click can still need
  // real help reaching it.)
  //
  // Surrounding parcels (within 1 km, nearbyParcelR) are drawn first and
  // faded, so the parcel actually under the pin -- drawn right after, at
  // full strength -- still reads as *the* answer. De-duped against parcelR
  // by PARCEL_FABRIC_POLY_ID/OBJECTID so the clicked parcel never gets a
  // dim copy drawn underneath its own highlighted one.
  if(nearbyParcelR && nearbyParcelR.ok && nearbyParcelR.features.length){
    currentPushSource = 'overlay:parcel'; // v87 -- nearby (faded) parcels are the same report category as the clicked parcel itself, just deeper in the same block below
    const clickedIds = new Set(
      (parcelR.ok ? parcelR.features : []).map(f => {
        const p = f.properties || {};
        return p.PARCEL_FABRIC_POLY_ID != null ? `pf:${p.PARCEL_FABRIC_POLY_ID}` : `oid:${p.OBJECTID}`;
      })
    );
    nearbyParcelR.features.forEach(f => {
      const p = f.properties || {};
      const id = p.PARCEL_FABRIC_POLY_ID != null ? `pf:${p.PARCEL_FABRIC_POLY_ID}` : `oid:${p.OBJECTID}`;
      if(clickedIds.has(id)) return;
      const cat = ownerCategory(p.OWNER_TYPE);
      const color = OWNER_COLORS[cat] || OWNER_COLORS.other;
      // bubblingMouseEvents:false -- see the note above the cutblock layer
      // below for why every clickable overlay in this function sets this.
      // v81: back in currentClickableFeatures / the shared chooser -- see
      // the note on parcelR just below for the full story (v79 added this,
      // v80 removed it as the wrong fix, v81 restores it alongside the
      // actual fix).
      L.geoJSON(f, {style:{color, weight:1, fillColor:color, fillOpacity:0.07, opacity:0.55}, bubblingMouseEvents:false})
        .on('click', e => openNearbyFeaturesPopupAt(e.latlng))
        .addTo(overlayCategoryLayers.parcel);
      pushClickable(f.geometry, '🗺️', `Parcel (nearby) — ${esc(p.OWNER_TYPE || "Unknown owner type")}`, '🗺️ Parcel', parcelPopup(p));
    });
  }

  if(parcelR.ok && parcelR.features.length){
    // v79 first put parcels in the shared cross-layer chooser
    // (currentClickableFeatures / openNearbyFeaturesPopupAt(), both in
    // src/map/chooser.js). Karim reported that made parcels "block the
    // ability to click on elements under that", so v80 took parcels (and
    // municipality/park) back out, reasoning that a parcel's huge area
    // would dominate every chooser. That diagnosis was wrong, or at least
    // incomplete: Karim then reported the *underlying* problem was still
    // there even with parcels excluded from the chooser -- clicking inside
    // a tenure/woodlot/WMA still only ever brought up the parcel's own
    // popup. The real root cause is a rendering gap, not a chooser-design
    // problem: tenure/woodlot/WMA (and municipality) are drawn with
    // fill:false (outline only, no interior paint) -- see those layers
    // below -- and a browser's SVG hit-testing never registers a click on
    // an unpainted interior, only on the actual stroke line itself, which
    // is a tiny target. So a click anywhere inside one of those shapes was
    // *always* falling straight through to whatever *does* have a real fill
    // underneath it -- the parcel -- with or without v79/v80's chooser
    // logic; the chooser was never the problem, it just couldn't help
    // because the smaller layer's own click handler was never firing in the
    // first place. v81 fixes both pieces together: those layers get a real
    // (near-invisible) fill so their interior is actually clickable (see
    // the fill:false -> fillOpacity change below), and parcels/
    // municipality/park rejoin the shared chooser so that when a click
    // genuinely lands on more than one thing -- a tenure *and* the parcel
    // it sits on, say -- both show up as choices instead of either one
    // silently winning. A click on an empty area with nothing smaller there
    // still just shows the parcel's own popup directly (the single-match
    // case), exactly as it always has.
    currentPushSource = 'overlay:parcel';
    parcelR.features.forEach((f, i) => {
      const cat = ownerCategory(f.properties.OWNER_TYPE);
      const color = OWNER_COLORS[cat] || OWNER_COLORS.other;
      const gl = L.geoJSON(f, {style:{color, weight:2, fillColor:color, fillOpacity: i === 0 ? 0.22 : 0.1}, bubblingMouseEvents:false})
        .on('click', e => openNearbyFeaturesPopupAt(e.latlng))
        .addTo(overlayCategoryLayers.parcel);
      pushClickable(f.geometry, '🗺️', `Parcel — ${esc(f.properties.OWNER_TYPE || "Unknown owner type")}`, '🗺️ Parcel', parcelPopup(f.properties));
      if(i === 0) fitLayer = gl;
    });
  }

  // Roads still show info on hover -- a sticky tooltip that follows the
  // cursor, appearing without a click -- but as of v79 a click on one *also*
  // joins the shared cross-layer chooser, the same as every other layer.
  // v85: drawing itself moved into renderForestServiceRoads() above so
  // Reveal Road can draw the identical thing -- see the v85 build notes
  // section.
  if(roadR && roadR.ok && roadR.features.length){
    currentPushSource = 'overlay:road';
    renderForestServiceRoads(roadR.features, overlayCategoryLayers.road);
  }

  // v81: fill:false (outline only, no painted interior) used to be the
  // style here -- but a browser's SVG hit-testing (pointer-events:
  // visiblePainted, Leaflet's default) never registers a click on an
  // unpainted interior, only on the stroke itself, which is a thin, easy-
  // to-miss target. That meant clicking anywhere *inside* one of these
  // shapes -- not precisely on its dashed line -- silently fell through to
  // whatever real-filled layer was underneath (almost always the parcel),
  // which is the actual root cause behind "can't click anything under a
  // parcel". Fixed with a small but genuinely nonzero fillOpacity (any
  // nonzero value counts as "painted" for hit-testing purposes, per the SVG
  // spec) instead of fill:false -- low enough (0.03) that it reads as
  // outline-only exactly as before, not a visible colour wash, but now the
  // whole interior is actually clickable. Same fix applied to municipality
  // below, which had the identical problem.
  if(tenureR && tenureR.ok && tenureR.features.length){
    currentPushSource = 'overlay:tenures';
    tenureR.features.forEach(f => {
      L.geoJSON(f, {style:{color:"#0086b3", weight:2, dashArray:"2 4", fillOpacity:0.03}, bubblingMouseEvents:false})
        .on('click', e => openNearbyFeaturesPopupAt(e.latlng))
        .addTo(overlayCategoryLayers.tenures);
      pushClickable(f.geometry, '📜', `Crown tenure — ${esc(f.properties.TENURE_PURPOSE || "purpose not on file")}`, '📜 Crown land tenure', tenurePopup(f.properties));
    });
  }

  if(woodlotR && woodlotR.ok && woodlotR.features.length){
    currentPushSource = 'overlay:woodlot';
    woodlotR.features.forEach(f => {
      L.geoJSON(f, {style:{color:"#6b7d1f", weight:2, dashArray:"1 6", fillOpacity:0.03}, bubblingMouseEvents:false})
        .on('click', e => openNearbyFeaturesPopupAt(e.latlng))
        .addTo(overlayCategoryLayers.woodlot);
      pushClickable(f.geometry, '🪓', `Forest tenure licence — ${esc(f.properties.CLIENT_NAME || f.properties.ML_TYPE_CODE || "—")}`, '🪓 Forest tenure licence', woodlotPopup(f.properties));
    });
  }

  // Wildlife Management Area -- same dashed-outline, non-exclusionary
  // treatment as tenure/woodlot above, not the filled-exclusion style parkR
  // gets below: a WMA overlap is an advisory prompting a manual check of
  // that WMA's own Order in Council, not an automatic "don't shoot here".
  if(wmaR && wmaR.ok && wmaR.features.length){
    currentPushSource = 'overlay:wma';
    wmaR.features.forEach(f => {
      L.geoJSON(f, {style:{color:"#b8621b", weight:2, dashArray:"4 5", fillOpacity:0.03}, bubblingMouseEvents:false})
        .on('click', e => openNearbyFeaturesPopupAt(e.latlng))
        .addTo(overlayCategoryLayers.wma);
      pushClickable(f.geometry, '🦌', `Wildlife Management Area — ${esc(f.properties.WILDLIFE_MANAGEMENT_AREA_NAME || "—")}`, '🦌 Wildlife Management Area', wmaPopup(f.properties));
    });
  }

  if(muniR.ok && muniR.features.length){
    currentPushSource = 'overlay:municipality';
    // v81: rejoins the shared chooser (see the long note on parcelR above),
    // and fillOpacity:0.03 instead of fill:false for the same hit-testing
    // reason as tenure/woodlot/WMA above -- municipality had the identical
    // "clickable interior isn't actually clickable" gap.
    const f = muniR.features[0];
    L.geoJSON(f, {style:{color:"#7b3fa0", weight:2, dashArray:"6 5", fillOpacity:0.03}, bubblingMouseEvents:false})
      .on('click', e => openNearbyFeaturesPopupAt(e.latlng))
      .addTo(overlayCategoryLayers.municipality);
    pushClickable(f.geometry, '🏙️', `Municipal boundary — ${esc(f.properties.ADMIN_AREA_NAME || "—")}`, '🏙️ Municipal boundary', muniPopup(f.properties));
  }

  if(parkR.ok && parkR.features.length){
    currentPushSource = 'overlay:park';
    // v81: rejoins the shared chooser too, for the same consistency reason
    // as parcel/municipality above -- park already had a real fill
    // (fillOpacity:0.25), so its own interior was never unclickable, but it
    // could still win a click over a *smaller* feature drawn underneath it
    // (a tenure inside a park, say) purely by z-order/opacity, the same
    // class of "big shape silently wins" problem parcel had.
    const f = parkR.features[0];
    const gl = L.geoJSON(f, {style:{color:"#0f8a5f", weight:2, fillColor:"#0f8a5f", fillOpacity:0.25}, bubblingMouseEvents:false})
      .on('click', e => openNearbyFeaturesPopupAt(e.latlng))
      .addTo(overlayCategoryLayers.park);
    pushClickable(f.geometry, '🌲', `Park / protected area — ${esc(f.properties.PROTECTED_LANDS_NAME || "—")}`, '🌲 Park / protected area', parkPopup(f.properties));
    if(!fitLayer) fitLayer = gl;
  }

  if(cutList && cutList.length){
    currentPushSource = 'overlay:cutblocks';
    const drawableCutEntries = cutList.filter(e => e.geometry && !e.oversized);
    drawableCutEntries.forEach(entry => {
      const color = cutblockColor(entry);
      const feature = {type:"Feature", geometry: entry.geometry, properties:{}};
      // bubblingMouseEvents:false -- without this, Leaflet's own default
      // (bubblingMouseEvents:true) lets a click on this polygon also reach
      // the map's own click handler underneath it (map.on('click', ...),
      // still inline, which calls runLookup()/setMarker()) -- so clicking a
      // cutblock to inspect it was *also* silently re-selecting a brand-new
      // location right where you clicked, moving the marker out from under
      // whatever was actually selected. Every clickable overlay layer in
      // this function sets this for the same reason: clicking a plotted
      // feature should only show its own info, never quietly relocate the
      // pin.
      const layer = L.geoJSON(feature, {style:cutblockStyle(color), bubblingMouseEvents:false})
        // Not a plain bindPopup(): Leaflet only ever routes a click to
        // whichever *one* shape is drawn on top at that pixel, so two (or
        // more) overlapping/adjacent features -- cutblocks included, but as
        // of v79 this is true across every layer type, not cutblocks alone
        // -- would otherwise silently hide every record but the topmost
        // one. Every click here instead goes through the shared handler
        // (openNearbyFeaturesPopupAt(), src/map/chooser.js), which re-tests
        // the exact click point against every drawn feature's real geometry
        // (any type) and opens either that one record's popup (the common
        // case) or a chooser listing all of them.
        .on('click', e => openNearbyFeaturesPopupAt(e.latlng))
        .addTo(overlayCategoryLayers.cutblocks);
      // v76: lets the report card's list (same entry object, shared by
      // reference with currentCutOpenings -- see renderReport, still inline)
      // jump straight to and open *this exact* on-map popup, and lets
      // hovering the list row highlight this exact shape -- see the
      // mouseover/mouseout delegation on #report, still inline.
      entry.mapLayer = layer;
      const idLabel = entry.openingId != null ? `Opening ${esc(entry.openingId)}` : (entry.cutBlockId ? `Cut block ${esc(entry.cutBlockId)}` : "Cutblock");
      pushClickable(entry.geometry, '🪵', idLabel, `🪵 ${idLabel}`, cutblockPopup(entry));
    });
  }

  if(recList && recList.length){
    currentPushSource = 'overlay:recreation';
    recList.forEach(entry => {
      if(!entry.geometry) return;
      const color = "#c2255c";
      const nameLabel = esc(entry.name || "Unnamed recreation feature");
      if(entry.kind === "site"){
        // Points -- rec sites/campsites -- as a small filled circle marker,
        // not a full geoJSON layer, since a point has no shape to style.
        const coords = entry.geometry.coordinates;
        if(!coords || coords.length < 2) return;
        L.circleMarker([coords[1], coords[0]], {radius:6, color, weight:2, fillColor:color, fillOpacity:0.65, bubblingMouseEvents:false})
          .on('click', e => openNearbyFeaturesPopupAt(e.latlng))
          .addTo(overlayCategoryLayers.recreation);
        pushClickable(entry.geometry, '🏕️', `Recreation site — ${nameLabel}`, `🏕️ ${nameLabel}`, recreationPopup(entry));
      } else if(entry.kind === "trail"){
        L.geoJSON({type:"Feature", geometry:entry.geometry, properties:{}}, {style:{color, weight:2.5, dashArray:"3 5"}, bubblingMouseEvents:false})
          .on('click', e => openNearbyFeaturesPopupAt(e.latlng))
          .addTo(overlayCategoryLayers.recreation);
        pushClickable(entry.geometry, '🏕️', `Recreation trail — ${nameLabel}`, `🏕️ ${nameLabel}`, recreationPopup(entry));
      } else {
        // "area" -- recreation reserve/area polygons
        L.geoJSON({type:"Feature", geometry:entry.geometry, properties:{}}, {style:{color, weight:2, fillColor:color, fillOpacity:0.18}, bubblingMouseEvents:false})
          .on('click', e => openNearbyFeaturesPopupAt(e.latlng))
          .addTo(overlayCategoryLayers.recreation);
        pushClickable(entry.geometry, '🏕️', `Recreation reserve/area — ${nameLabel}`, `🏕️ ${nameLabel}`, recreationPopup(entry));
      }
    });
  }

  if(mvprList && mvprList.length){
    currentPushSource = 'overlay:mvpr';
    // Wildlife Act Motor Vehicle Prohibition routes/areas -- red for an
    // active closure, a muted grey-green for a route that's currently open
    // (still worth showing so an open route doesn't look like it's simply
    // missing data). Routes are lines along a named road; areas are wide
    // polygons, drawn with a hatch-like dash so a large closed area doesn't
    // read as solidly opaque as a park.
    mvprList.forEach(entry => {
      if(!entry.geometry) return;
      const color = entry.closed ? "#c0392b" : "#6b7d1f";
      const nameLabel = esc(entry.geographicName || "Motor Vehicle Prohibition");
      const rowLabel = `${entry.kind === "route" ? "Motor vehicle route restriction" : "Motor vehicle closed area"} — ${nameLabel}`;
      if(entry.kind === "route"){
        L.geoJSON({type:"Feature", geometry:entry.geometry, properties:{}}, {style:{color, weight:3, dashArray: entry.closed ? null : "2 4"}, bubblingMouseEvents:false})
          .on('click', e => openNearbyFeaturesPopupAt(e.latlng))
          .addTo(overlayCategoryLayers.mvpr);
      } else {
        // "area" -- always closed (see buildMvprList's comment)
        L.geoJSON({type:"Feature", geometry:entry.geometry, properties:{}}, {style:{color, weight:2, dashArray:"6 4", fillColor:color, fillOpacity:0.12}, bubblingMouseEvents:false})
          .on('click', e => openNearbyFeaturesPopupAt(e.latlng))
          .addTo(overlayCategoryLayers.mvpr);
      }
      pushClickable(entry.geometry, entry.closed ? '🚫' : '🚧', rowLabel, `🚧 ${nameLabel}`, mvprPopup(entry));
    });
  }

  if(fitLayer){
    try{ map.fitBounds(fitLayer.getBounds(), {maxZoom:17, padding:[50,50]}); }catch(e){ /* ignore bad bounds */ }
  }
}
