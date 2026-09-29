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
    const color = retired ? MAP_PAL.fsrRetired : MAP_PAL.fsrActive;
    // bubblingMouseEvents:false -- same reasoning as every other overlay
    // layer: without it, a click here also reaches the map underneath and
    // re-selects that point as a brand-new location.
    L.geoJSON(f, {style:{color, weight:MAP_W.road, opacity:0.95}, bubblingMouseEvents:false})
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
  if(entry.harvestEndDate || entry.closed) return MAP_PAL.clear;
  if(entry.disturbanceStart) return MAP_PAL.restricted;
  return MAP_PAL.cutPlanned;
}
function cutblockStyle(color){ return {color, weight:MAP_W.line, fillColor:color, fillOpacity:MAP_FILL.area}; } // v108: fill 0.32 -> 0.12 (see src/config/mapstyle.js)
// v76: the highlighted variant used while a cutblock's own report-card list
// row is hovered -- same colour, just heavier/more opaque so the shape reads
// as "this one" against the rest of the drawn cutblocks around it.
function cutblockHighlightStyle(color){ return {color, weight:3, fillColor:color, fillOpacity:0.3}; }

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
      L.geoJSON(f, {style:{color, weight:MAP_W.hair, fillColor:color, fillOpacity:MAP_FILL.faint, opacity:0.55} /* v108: < 0.62 casing threshold -- context parcels stay quiet */, bubblingMouseEvents:false})
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
      const gl = L.geoJSON(f, {style:{color, weight:MAP_W.strong, fillColor:color, fillOpacity: i === 0 ? MAP_FILL.emphasis : MAP_FILL.faint}, bubblingMouseEvents:false})
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
      L.geoJSON(f, {style:{color:MAP_PAL.tenure, weight:MAP_W.line, opacity:0.9, fillColor:MAP_PAL.tenure, fillOpacity:MAP_FILL.hit}, bubblingMouseEvents:false})
        .on('click', e => openNearbyFeaturesPopupAt(e.latlng))
        .addTo(overlayCategoryLayers.tenures);
      pushClickable(f.geometry, '📜', `Crown tenure — ${esc(f.properties.TENURE_PURPOSE || "purpose not on file")}`, '📜 Crown land tenure', tenurePopup(f.properties));
    });
  }

  if(woodlotR && woodlotR.ok && woodlotR.features.length){
    currentPushSource = 'overlay:woodlot';
    woodlotR.features.forEach(f => {
      L.geoJSON(f, {style:{color:MAP_PAL.woodlot, weight:MAP_W.line, opacity:0.9, fillColor:MAP_PAL.woodlot, fillOpacity:MAP_FILL.hit}, bubblingMouseEvents:false})
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
      L.geoJSON(f, {style:{color:MAP_PAL.wma, weight:MAP_W.line, dashArray:MAP_DASH, fillColor:MAP_PAL.wma, fillOpacity:MAP_FILL.hit}, bubblingMouseEvents:false})
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
    L.geoJSON(f, {style:{color:MAP_PAL.municipal, weight:MAP_W.line, dashArray:MAP_DASH, fillColor:MAP_PAL.municipal, fillOpacity:MAP_FILL.hit}, bubblingMouseEvents:false})
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
    const gl = L.geoJSON(f, {style:{color:MAP_PAL.park, weight:MAP_W.line, fillColor:MAP_PAL.park, fillOpacity:MAP_FILL.area}, bubblingMouseEvents:false})
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
      const color = MAP_PAL.recreation;
      const nameLabel = esc(entry.name || "Unnamed recreation feature");
      if(entry.kind === "site"){
        // Points -- rec sites/campsites -- as a small filled circle marker,
        // not a full geoJSON layer, since a point has no shape to style.
        const coords = entry.geometry.coordinates;
        if(!coords || coords.length < 2) return;
        L.circleMarker([coords[1], coords[0]], {radius:5, color:"#F1F2EE", weight:1.5, fillColor:color, fillOpacity:0.95, bubblingMouseEvents:false})
          .on('click', e => openNearbyFeaturesPopupAt(e.latlng))
          .addTo(overlayCategoryLayers.recreation);
        pushClickable(entry.geometry, '🏕️', `Recreation site — ${nameLabel}`, `🏕️ ${nameLabel}`, recreationPopup(entry));
      } else if(entry.kind === "trail"){
        L.geoJSON({type:"Feature", geometry:entry.geometry, properties:{}}, {style:{color, weight:2, opacity:0.95}, bubblingMouseEvents:false})
          .on('click', e => openNearbyFeaturesPopupAt(e.latlng))
          .addTo(overlayCategoryLayers.recreation);
        pushClickable(entry.geometry, '🏕️', `Recreation trail — ${nameLabel}`, `🏕️ ${nameLabel}`, recreationPopup(entry));
      } else {
        // "area" -- recreation reserve/area polygons
        L.geoJSON({type:"Feature", geometry:entry.geometry, properties:{}}, {style:{color, weight:MAP_W.line, fillColor:color, fillOpacity:MAP_FILL.area}, bubblingMouseEvents:false})
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
      const color = entry.closed ? MAP_PAL.restricted : MAP_PAL.clear;
      const nameLabel = esc(entry.geographicName || "Motor Vehicle Prohibition");
      const rowLabel = `${entry.kind === "route" ? "Motor vehicle route restriction" : "Motor vehicle closed area"} — ${nameLabel}`;
      if(entry.kind === "route"){
        L.geoJSON({type:"Feature", geometry:entry.geometry, properties:{}}, {style:{color, weight:MAP_W.strong, dashArray: entry.closed ? null : MAP_DASH}, bubblingMouseEvents:false})
          .on('click', e => openNearbyFeaturesPopupAt(e.latlng))
          .addTo(overlayCategoryLayers.mvpr);
      } else {
        // "area" -- always closed (see buildMvprList's comment)
        L.geoJSON({type:"Feature", geometry:entry.geometry, properties:{}}, {style:{color, weight:MAP_W.line, dashArray:MAP_DASH, fillColor:color, fillOpacity:MAP_FILL.area}, bubblingMouseEvents:false})
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

// ============================================================================
// v100: pass 2 of docs/PLAN.md's map/render.js split (after v99's pass 1,
// the single-click report renderer above) -- Shooting Spots.
//
// Scope correction versus the plan's own one-line description ("Pass 2
// (Shooting Spots): renderActiveCutblockOutlines(), renderActiveCutblockBuffers(),
// renderNearbyRoads(), revealPotentialSpots()/revealPotentialSpotsAroundPin()"):
// reading the actual code turned up that both `reveal*` functions are thin
// wrappers -- neither does any real work itself -- around one shared ~370-line
// engine, runPotentialSpotsSearch(area), that both delegate to (fires the ~10
// concurrent WFS/Overpass queries, classifies every candidate parcel, calls
// the three render functions below, draws the teal/red/purple spot squares,
// builds the status message, fits the map). Moving only the two thin wrappers
// and leaving their real engine behind in index.html would have been
// architecturally hollow -- the actual "Shooting Spots" logic would still be
// 100% inline. So runPotentialSpotsSearch() itself is added to this slice,
// along with every small helper used only by it or by the three named render
// functions: activeCutblockPopup(), bboxToBoundsLike(), cutblockBufferStyle(),
// cutblockBufferOutlineStyle(), neighborPoint(), squareEdgeSegment(),
// DRA_ROAD_COLOR/DRA_ROAD_SPECIAL_COLOR/draRoadStyle()/draRoadTooltip(),
// SPOT_MIN_ZOOM/INFRA_MIN_ZOOM, startSpotsProgress()/trackSpotsProgress()/
// endSpotsProgress(), and spotSeq.
//
// Deliberately left inline, and why:
// - `spotLayer` (the target layer group every shape in this slice draws
//   into) is declared as `const spotLayer = L.layerGroup().addTo(map)`,
//   which runs immediately at script-load time -- the same v98/v99 lesson
//   again (every <script src> file here loads before the main inline
//   script's `const map = L.map(...)`, so a top-level statement touching
//   `map` immediately can't move). Every function in this slice only
//   references `spotLayer` from inside a function body, which is fine --
//   that's resolved at call time, long after `map` and `spotLayer` both
//   exist -- so the functions themselves moved cleanly; only spotLayer's
//   own declaration stays inline.
// - CUTBLOCK_WARN_DISTANCE_M, CUTBLOCK_WARN_COLOR, cutblockFeatureLabel(),
//   activeCutblockOutlineStyle(), and pointToGeomMeters() stay inline --
//   they're shared with the single-click location report's own cutblock
//   warning (further down in index.html, around the report-rendering code),
//   which is out of scope for map/render.js entirely and earmarked for a
//   future ui/report.js pass instead. Splitting them out now would mean
//   guessing at that future slice's boundary today.
// - spotStyle()/spotPopup()/restrictedStyle()/restrictedPopup()/gapStyle()/
//   gapPopup()/restrictionReasonShort(), and the spotDetails/gapDetails/
//   restrictedDetails arrays they push into, stay inline for the same reason
//   v99 left every report *Popup() builder inline: earmarked for a future
//   ui/report.js, not map/render.js.
// - PIN_SPOT_RADIUS_M, boundsAroundPoint(), and radiusCql() stay inline.
//   radiusCql() was already called out in v97's own scope note as staying
//   put until a future data/open511.js pass; boundsAroundPoint() is declared
//   immediately next to it as a paired helper (one square-bbox, one true
//   DWITHIN-circle, both documented together) and is used only by
//   revealPotentialSpotsAroundPin() below -- moving it alone while its
//   documented sibling stays would fragment that small paired block for no
//   real benefit, and (same as every other cross-file call in this project)
//   revealPotentialSpotsAroundPin() calling it from inside a function body
//   works regardless of which file either lives in.
// - Every general-purpose geometry/gap helper this file's functions call
//   (bboxOfGeom, expandBboxByMeters, gapGridSpacingForBounds,
//   sampleGridPointsInBounds, squareAroundPoint, metersPerDegree,
//   classifyParcelRestrictions, outerRings, pointToRingMeters,
//   pointToLineGeomMeters, bboxOfLineGeom, bboxOfRing, bboxesOverlap,
//   pointInGeometry, pointInAnyGeom, distanceMeters, ownerCategory,
//   classifyDraRoads, isOversizedCutblock) stays inline -- all of them are
//   used well beyond Shooting Spots (parcel view, the click report, etc.),
//   same "general-purpose helpers stay put" precedent v98/v99 already set.
//
// The button wiring (`document.getElementById('revealSpotsBtn')
// .addEventListener(...)`) moved too -- it's a top-level statement, but it
// only touches a DOM element, not `map`, and this file's own <script src>
// tag already loads after every element in the page body (same place v98's
// and v99's <script src> tags load from), so the button already exists by
// the time this line runs.
// ============================================================================

// Draws every *active* FTEN cutblock actually returned for this viewport as
// its own dashed outline (no fill, so it never gets mistaken for a spot) --
// added specifically so the buffer zone drawn around it
// (renderActiveCutblockBuffers() below) is checkable against a real,
// visible, clickable block instead of an invisible distance check the user
// has to just trust.
function activeCutblockPopup(props){
  return `<div style="font-size:12.5px;line-height:1.6;min-width:170px">
    <b>🪓 Active cutblock (FTEN)</b><br>
    Block: ${esc(cutblockFeatureLabel(props))}<br>
    Life Cycle: <b>ACTIVE</b> — approved; activities may be taking place<br>
    <span style="color:var(--muted);font-size:11px">Its ${CUTBLOCK_WARN_DISTANCE_M}m buffer zone is shaded on the map too -- any spot inside it should be treated as "close to active logging."</span>
  </div>`;
}
function renderActiveCutblockOutlines(activeCuts, targetLayer){
  activeCuts.forEach(c => {
    if(!c.geometry) return;
    // v83: shared click handler + pushClickable, same as every other
    // clickable layer -- was a plain bindPopup() before, which meant a click
    // here never merged with a road/tenure/parcel also under the point (see
    // the v83 section for the full story).
    L.geoJSON(c, {style: activeCutblockOutlineStyle(), bubblingMouseEvents:false})
      .on('click', e => openNearbyFeaturesPopupAt(e.latlng))
      .addTo(targetLayer);
    pushClickable(c.geometry, '🪓', `Active cutblock — ${esc(cutblockFeatureLabel(c.properties || {}))}`, '🪓 Active cutblock', activeCutblockPopup(c.properties || {}));
  });
}
// Duck-types a plain [minX,minY,maxX,maxY] bbox into the
// {getSouthWest(),getNorthEast()} shape gapGridSpacingForBounds()/
// sampleGridPointsInBounds() already expect from a Leaflet LatLngBounds --
// lets renderActiveCutblockBuffers() below reuse that exact, already-tested
// viewport-grid machinery for a per-cutblock bbox instead of duplicating it.
function bboxToBoundsLike(bbox){
  return {
    getSouthWest: () => ({lat: bbox[1], lng: bbox[0]}),
    getNorthEast: () => ({lat: bbox[3], lng: bbox[2]})
  };
}
function cutblockBufferStyle(){
  return {color: CUTBLOCK_WARN_COLOR, weight: 0, fillColor: CUTBLOCK_WARN_COLOR, fillOpacity: MAP_FILL.emphasis}; // v108: 0.20 -> 0.18, in line with the shared fill scale; // v52: back down from 0.5 (v51) -- Karim asked for the buffer fill lighter now that the real outline (above) is fully solid and does the heavy lifting of standing out
}
// v54: Karim asked for a solid line around the outer edge of the 400m buffer
// zone itself (distinct from the cutblock's own dashed outline above -- that
// one traces the real, exact polygon; this one traces the approximate
// zone's own boundary). No fill, solid (no dashArray), full opacity -- a
// deliberately different look from the dashed real outline so the two are
// never confused for each other.
function cutblockBufferOutlineStyle(){
  return {color: CUTBLOCK_WARN_COLOR, weight: MAP_W.line, opacity: 1};
}
// Offsets a grid point by exactly one grid spacing in one of the four
// cardinal directions -- used to test "is the square next to this one, in
// this direction, also inside the buffer zone" without needing that
// neighboring point to have actually been enumerated by the sampling loop
// (its own in/out status is just a distance check against the same
// geometry, well-defined regardless of grid bounds).
function neighborPoint(p, spacingM, dir){
  const mpd = metersPerDegree(p[1]);
  const dLng = spacingM / mpd.lng, dLat = spacingM / mpd.lat;
  const [lng, lat] = p;
  if(dir === 'N') return [lng, lat + dLat];
  if(dir === 'S') return [lng, lat - dLat];
  if(dir === 'E') return [lng + dLng, lat];
  return [lng - dLng, lat]; // 'W'
}
// One edge of the square squareAroundPoint(p, spacingM) would draw, as its
// own LineString -- so an edge can be drawn on its own (solid outline)
// independently of whether the square's fill is drawn.
function squareEdgeSegment(p, spacingM, dir){
  const mpd = metersPerDegree(p[1]);
  const halfLng = (spacingM/2) / mpd.lng, halfLat = (spacingM/2) / mpd.lat;
  const [lng, lat] = p;
  let a, b;
  if(dir === 'N'){ a = [lng-halfLng, lat+halfLat]; b = [lng+halfLng, lat+halfLat]; }
  else if(dir === 'S'){ a = [lng-halfLng, lat-halfLat]; b = [lng+halfLng, lat-halfLat]; }
  else if(dir === 'E'){ a = [lng+halfLng, lat-halfLat]; b = [lng+halfLng, lat+halfLat]; }
  else { a = [lng-halfLng, lat-halfLat]; b = [lng-halfLng, lat+halfLat]; } // 'W'
  return {type:"Feature", properties:{}, geometry:{type:"LineString", coordinates:[a,b]}};
}
// v47: replaces the old per-spot proximity check (computeCutblockWarnInfo(),
// removed) after Karim traced a "way too much red" report to its real cause
// -- not a distance-math bug, but a large active cutblock whose 500m halo,
// when computed independently by every nearby spot's own sample grid,
// scattered unpredictably across a wide area. This draws that halo exactly
// once per active cutblock instead: grid-samples the cutblock's own bbox
// expanded by CUTBLOCK_WARN_DISTANCE_M (the same gap-grid machinery the
// viewport-wide "no parcel record" sweep already uses, via
// bboxToBoundsLike() above -- an adaptive, budgeted point count rather than
// a fixed spacing, so a huge cutblock's buffer doesn't explode the point
// count), and shades every sample point that's actually within
// CUTBLOCK_WARN_DISTANCE_M of the block's real polygon (not just its bbox --
// the bbox is only a cheap first pass). Approximate, like every other
// buffer/clip in this app (true polygon offset is the same kind of
// hard-to-verify-blind geometry operation this app has avoided throughout,
// see classifyParcelRestrictions() above) -- but now anchored to the
// cutblock's own real shape and size, so the shaded area always tracks what
// the cutblock actually looks like on screen, at a spacing that scales with
// how big the cutblock is, not with how many spots happen to be nearby.
// Squares are non-interactive so they never steal a click meant for the
// cutblock's own outline or a spot underneath.
function renderActiveCutblockBuffers(activeCuts, targetLayer){
  activeCuts.forEach(c => {
    if(!c.geometry) return;
    const expanded = expandBboxByMeters(bboxOfGeom(c.geometry), CUTBLOCK_WARN_DISTANCE_M);
    const boundsLike = bboxToBoundsLike(expanded);
    const spacingM = gapGridSpacingForBounds(boundsLike);
    sampleGridPointsInBounds(boundsLike, spacingM).forEach(p => {
      if(pointToGeomMeters(p, c.geometry) >= CUTBLOCK_WARN_DISTANCE_M) return;
      L.geoJSON(squareAroundPoint(p, spacingM), {style: cutblockBufferStyle(), interactive:false}).addTo(targetLayer);
      // v54: this square sits on the buffer zone's own outer edge wherever a
      // neighboring square (one grid spacing away, in each of the four
      // directions) is NOT itself inside the 400m zone -- draw a solid line
      // on exactly those sides. A square fully surrounded by other in-zone
      // squares gets no line on any side, so only the true perimeter is
      // traced, not every square's own four edges (which would draw a lot
      // of redundant interior lines between adjacent in-zone squares).
      ['N','S','E','W'].forEach(dir => {
        const neighbor = neighborPoint(p, spacingM, dir);
        if(pointToGeomMeters(neighbor, c.geometry) >= CUTBLOCK_WARN_DISTANCE_M){
          L.geoJSON(squareEdgeSegment(p, spacingM, dir), {style: cutblockBufferOutlineStyle(), interactive:false}).addTo(targetLayer);
        }
      });
    });
  });
}

// v58: Karim asked for "all side roads highlighted when using the potential
// shooting spot function". Every DRA (Digital Road Atlas -- BC's general
// public road network, distinct from the FTEN forest-service-road layer the
// single-click report already draws) road in view was already being fetched
// and used to compute the road buffer above -- it just wasn't drawn, so the
// buffer's effect was only ever visible as its consequence (a red excluded
// strip) rather than the road itself. This draws every one of those roads as
// a line, colored by whether the wider named-highway buffer applies (see
// SPECIAL_400M_ROUTES above) so it's visually obvious which roads carry the
// bigger buffer, with a hover tooltip (same sticky-tooltip pattern the FTEN
// forest-service-road layer already uses elsewhere in this file) giving the
// road class and exactly which buffer distance applies. Roads are drawn with
// interactive:false-free geoJSON (bubblingMouseEvents:false, same as every
// other clickable Potential Spots shape) so hovering/clicking one doesn't
// also re-select that point as the map's main location.
const DRA_ROAD_COLOR = MAP_PAL.roadPublic; // v108: was #546e7a, now from the shared palette -- // slate -- distinct from every other line/fill color already in use (forest-service road tan/gray, tenure blue, cutblock red, park teal)
const DRA_ROAD_SPECIAL_COLOR = MAP_PAL.roadHighway; // v108: was #b1440e -- // warm rust -- flags a listed major highway's wider 400/600m buffer at a glance
function draRoadStyle(special){
  return special
    ? {color: DRA_ROAD_SPECIAL_COLOR, weight: MAP_W.road, opacity: 0.95}
    : {color: DRA_ROAD_COLOR, weight: 1.75, opacity: 0.85};
}
function draRoadTooltip(props, special, bufferM){
  const cls = (props && props.ROAD_CLASS) ? esc(props.ROAD_CLASS) : "Road";
  const routeNum = (props && props.HIGHWAY_ROUTE_NUMBER) ? ` · Hwy ${esc(props.HIGHWAY_ROUTE_NUMBER)}` : '';
  return `<div style="font-size:12px;line-height:1.5">
    <b>${cls}${routeNum}</b><br>
    ${special ? `${esc(special.label)} — ` : ''}${bufferM}m Wildlife Act buffer applies here${special ? ' (listed major highway)' : ''}.
  </div>`;
}
function renderNearbyRoads(allRoads, targetLayer){
  allRoads.forEach(r => {
    if(!r.geometry) return;
    // v83: gains a real click handler + pushClickable, on top of the hover
    // tooltip it already had -- these roads (Potential Spots' own draw, and
    // Reveal Road's, both via this one function) previously had no click
    // behaviour at all, so a click here always fell through to whatever
    // Potential Spots shape happened to be underneath, never showing the
    // road itself or merging with what's actually at that point.
    L.geoJSON(r.geometry, {style: draRoadStyle(r.special), bubblingMouseEvents:false})
      .bindTooltip(draRoadTooltip(r.properties, r.special, r.bufferM), {sticky:true, direction:"top", opacity:0.97, className:"road-tooltip"})
      .on('click', e => openNearbyFeaturesPopupAt(e.latlng))
      .addTo(targetLayer);
    const cls = (r.properties && r.properties.ROAD_CLASS) ? esc(r.properties.ROAD_CLASS) : "Road";
    const routeNum = (r.properties && r.properties.HIGHWAY_ROUTE_NUMBER) ? ` (Hwy ${esc(r.properties.HIGHWAY_ROUTE_NUMBER)})` : '';
    pushClickable(r.geometry, '🛣️', `Road — ${cls}${routeNum}`, '🛣️ Road', draRoadTooltip(r.properties, r.special, r.bufferM));
  });
}

// v71: zoom gates for the view-based "Shooting Spots" button, restored to
// their pre-v70 values -- the radius sweep never needs these (a fixed 2 km
// circle is always the same physical size regardless of zoom), but a
// viewport-scoped query can span a huge, expensive area if pressed while
// zoomed way out. SPOT_MIN_ZOOM bails out entirely below this zoom (same
// spirit as PARCEL_VIEW_MIN_ZOOM above, one notch tighter since this feature
// does more per-parcel computation); INFRA_MIN_ZOOM gates only the
// road/building buffer sub-check -- the parcel/park/municipality checks still
// run below it, just without the buffer trim.
const SPOT_MIN_ZOOM = 9;
const INFRA_MIN_ZOOM = 12;

// v71: progress bar + percent readout for the potential-spots multi-query
// sweep (radius or view-based) -- wraps each query promise so the bar
// advances as each of the ~10 settles, instead of sitting at 0% and then
// jumping straight to "done" the way a bare `await Promise.all()` would look
// to someone watching. Purely a progress indicator; it never changes what a
// query resolves to, only when the UI finds out.
// v75: two changes. (1) startSpotsProgress()/endSpotsProgress() only ever
// toggled the `hidden` attribute -- see .header-progress[hidden] in the CSS
// (v88: moved here from .spots-progress in the Tools drawer) for why that
// alone didn't actually hide anything, which is why the bar used to sit on
// screen outside of a real search too. (2) trackSpotsProgress()
// now takes a `labels` array (one plain-language name per promise, in the
// same order -- see SPOTS_QUERY_LABELS below) and keeps #spotsProgressLabel
// updated with whichever of those is still in flight, so "what's currently
// being fetched" reflects the real, unpredictable settle order of ~10
// concurrent requests instead of one static sentence for the whole run.
function startSpotsProgress(){
  const el = document.getElementById('spotsProgress');
  const fill = document.getElementById('spotsProgressFill');
  const pct = document.getElementById('spotsProgressPct');
  const label = document.getElementById('spotsProgressLabel');
  if(el) el.hidden = false;
  if(fill) fill.style.width = '0%';
  if(pct) pct.textContent = 'Loading… 0%';
  if(label) label.textContent = '';
  return {el, fill, pct, label};
}
function trackSpotsProgress(promises, ui, labels){
  const total = promises.length;
  let done = 0;
  const pending = labels ? labels.slice() : [];
  const updateLabel = () => {
    if(!ui.label) return;
    ui.label.textContent = pending.length ? `Fetching ${pending[0]}…` : '';
  };
  updateLabel();
  const bump = (lbl) => {
    done++;
    if(lbl){
      const idx = pending.indexOf(lbl);
      if(idx !== -1) pending.splice(idx, 1);
    }
    const p = Math.round(done / total * 100);
    if(ui.fill) ui.fill.style.width = p + '%';
    if(ui.pct) ui.pct.textContent = p >= 100 ? 'Finishing…' : `Loading… ${p}%`;
    updateLabel();
  };
  // queryLayer()/queryOsmBuildings() never actually reject (they resolve
  // {ok:false, ...} on failure) but both branches are handled anyway rather
  // than assuming that never changes.
  return promises.map((p, i) => p.then(r => { bump(labels && labels[i]); return r; }, e => { bump(labels && labels[i]); throw e; }));
}
function endSpotsProgress(ui){
  if(ui && ui.el) ui.el.hidden = true;
  if(ui && ui.label) ui.label.textContent = '';
}

let spotSeq = 0;
// ---------------- Potential Spots ----------------
// v68 first added a fixed-radius automatic sweep on top of a separate,
// button-triggered "Shooting Spots" (current-viewport) feature, wired into
// only the drag-and-drop pin button's own 'drop' handler -- reasoning that
// "the pin location feature" meant that one specific button.
//
// v69/v70: Karim's report that dropping the pin "doesn't look like it's
// doing the same thing as the shooting function" traced to that narrow
// wiring -- almost every location pick (a plain map click, dragging the
// marker, the address search result, typing coordinates) never touched that
// one 'drop' handler, so the sweep silently never ran for any of them. Fixed
// by moving the sweep into runLookup() itself, so it fires for every way of
// picking a location. With only one caller left at that point, v70 also
// collapsed the v68 view-vs-radius `area` abstraction back into one direct,
// single-purpose function.
//
// v71: Karim asked for the "Shooting Spots" button back -- alongside, not
// instead of, the automatic radius sweep -- restored to its original
// view-based behaviour (whatever's currently in view, zoom-gated, on
// demand). That's a real second caller again, so the shared-core
// abstraction earns its keep a second time: revealPotentialSpotsAroundPin()
// (automatic, a 2 km DWITHIN circle around wherever was just picked) and
// revealPotentialSpots() (the button, an INTERSECTS query against the
// current viewport) both call this one core, parameterized by `area` --
// {bounds, cqlFor, areaLabel, infraZoomOk, circleClip, fitAfter}.
async function runPotentialSpotsSearch(area){
  const noteEl = document.getElementById('mapActionsNote');
  const seq = ++spotSeq;
  const {bounds, cqlFor, areaLabel, infraZoomOk, circleClip, fitAfter} = area;
  // v72 force-opened the Tools drawer here so the progress bar was visible
  // for *every* trigger, not just the button -- including the automatic 2km
  // sweep that fires on every single location pick (see
  // revealPotentialSpotsAroundPin() below, called from runLookup()). Karim
  // reported that as unwanted: a loading bar popping the drawer open on a
  // plain map click, before he'd pressed anything in it, read as showing up
  // on its own rather than in response to something he clicked. Reverted as
  // of v87 -- the progress bar still updates correctly either way (the
  // el.hidden toggling in startSpotsProgress()/endSpotsProgress() never
  // depended on this call), it's just no longer forced into view: visible
  // when the Tools drawer is already open (including every button-triggered
  // run, since a button that lives inside the drawer can't be pressed while
  // it's closed), invisible otherwise.

  // v56: this used to run the parcel query alone, fully awaited, before
  // firing any of the other 6-8 queries below -- reasoned at the time as
  // avoiding competition for "the browser's per-domain connection limit."
  // That reasoning didn't actually hold up: the batch below already fires
  // up to 8 requests at the same DataBC host concurrently on its own, so
  // adding parcelRes as a 9th changes nothing about connection contention --
  // it just meant the parcel query's full round-trip was paid *in addition
  // to*, not *overlapping with*, everything else's round-trip, on every
  // single successful run. Firing all of them together lets their network
  // time overlap instead of stacking, which is the single biggest lever on
  // how long this feature takes to run, given queries against a government
  // WFS server dominate the wall-clock time compared to the browser-side
  // computation afterward. Trade-off, stated plainly: on the rare run where
  // parcelRes itself fails, the other 6-8 queries -- now already in flight
  // together with it -- still run to completion before the failure message
  // shows, instead of bailing immediately the way the old sequential version
  // did. Worth it for how much more often this makes the successful case
  // faster, but real, so it's written down here rather than left implicit.
  //
  // v75: the long "Checking parcels, parks, municipalities, tenures,
  // forestry, roads and buildings..." sentence that used to be set here
  // (and the permanent how-this-works paragraph that used to sit under the
  // buttons by default, in the HTML) are both gone -- Karim asked for the
  // explanation under the loading bar removed, and for a short, few-word,
  // *live* readout of what's actually still in flight instead. That's
  // SPOTS_QUERY_LABELS + trackSpotsProgress()'s `labels` argument below;
  // #mapActionsNote is left alone here and only reports again once there's a
  // real result or error to show (see the two setNote-style updates further
  // down).
  const progressUi = startSpotsProgress();
  const SPOTS_QUERY_LABELS = ['parcels', 'parks', 'municipalities', 'Crown tenures', 'woodlots', 'cutblocks', 'active cutting permits', 'parcel boundaries', 'roads', 'buildings'];
  const allQueries = trackSpotsProgress([
    queryLayer(LAYERS.parcel.typeName, cqlFor(LAYERS.parcel.geom, CROWN_OWNER_CQL), 20000, SPOT_MAX_FEATURES),
    queryLayer(LAYERS.park.typeName, cqlFor(LAYERS.park.geom), 18000, 300),
    queryLayer(LAYERS.muni.typeName, cqlFor(LAYERS.muni.geom), 18000, 300),
    queryLayer(LAYERS.tenure.typeName, cqlFor(LAYERS.tenure.geom), 18000, 500),
    queryLayer(LAYERS.woodlot.typeName, cqlFor(LAYERS.woodlot.geom), 18000, 500),
    queryLayer(LAYERS.cutblock.typeName, cqlFor(LAYERS.cutblock.geom), 18000, 500),
    // FTEN cutting-permit records specifically -- the only layer that carries
    // LIFE_CYCLE_STATUS_CODE, needed to tell an *active* cutblock apart from
    // the RESULTS-sourced `cuts` query above for the v45 proximity warning.
    // Same CUTBLOCK_START_DATE_CQL filter as everywhere else this layer is used.
    queryLayer(LAYERS.cutblockPlan.typeName, cqlFor(LAYERS.cutblockPlan.geom, CUTBLOCK_START_DATE_CQL), 18000, 500),
    // Every parcel in the search area, any owner type -- not filtered by
    // CROWN_OWNER_CQL like the first query above -- so the gap-detection grid
    // below knows exactly where a parcel record already exists (of any kind)
    // and where it genuinely doesn't (v44), and so the v45 private-land
    // buffer below knows which of those parcels are private-titled.
    queryLayer(LAYERS.parcel.typeName, cqlFor(LAYERS.parcel.geom), 20000, GAP_PARCEL_MAX_FEATURES),
    // No CQL class filter here (see the draRoad comment above) -- the
    // Wildlife Act's default road-allowance rule applies to every numbered
    // highway and 2-lane+ public road, not just "major" ones, so this fetches
    // every DRA road in the search area rather than a highway-only subset.
    // v71: gated by infraZoomOk again, same as the Overpass query right below
    // it -- always true for the radius sweep, a real gate for the view-based
    // button (a wide viewport press shouldn't fetch every road in a huge area
    // just to leave the buffer check unrun anyway).
    infraZoomOk ? queryLayer(LAYERS.draRoad.typeName, cqlFor(LAYERS.draRoad.geom), 20000, 1500) : Promise.resolve({ok:false, error:"zoomed out", features:[]}),
    infraZoomOk ? queryOsmBuildings(bounds) : Promise.resolve({ok:false, error:"zoomed out", buildings:[]})
  ], progressUi, SPOTS_QUERY_LABELS);
  const results = await Promise.all(allQueries);
  endSpotsProgress(progressUi);
  if(seq !== spotSeq) return; // a newer search superseded this one

  const [parcelRes, parkRes, muniRes, tenureRes, woodlotRes, cutRes, cutPlanRes, allParcelsRes, roadRes, osmRes] = results;

  if(!parcelRes.ok){
    if(noteEl) noteEl.textContent = `Couldn't load parcel data (${parcelRes.error || "unknown error"}) — try again in a few seconds. If this keeps happening, tell me the exact wording here so I can track down why.`;
    return;
  }

  const parks = parkRes.ok ? parkRes.features : [];
  const munis = muniRes.ok ? muniRes.features : [];
  const tenures = tenureRes.ok ? tenureRes.features : [];
  const woodlots = woodlotRes.ok ? woodlotRes.features : [];
  const cuts = cutRes.ok ? cutRes.features : [];
  const partialWarning = [parkRes, muniRes, tenureRes, woodlotRes, cutRes].some(r => !r.ok);

  // v45: FTEN cutting-permit records with LIFE_CYCLE_STATUS_CODE === ACTIVE
  // ("approved; activities may be taking place") -- the set the buffer
  // zone (v48) is drawn around. A failed cutPlanRes just means no buffer
  // zone this time (same fail-open-but-say-so approach as the rest of this
  // feature) rather than blocking the whole reveal.
  //
  // v49: Karim asked that any cutblock record flagged by the same
  // "unusually large" sanity check the single-click report already applies
  // (isOversizedCutblock(), CUTBLOCK_AREA_SANITY_HA -- grounded in a real
  // 187,690 ha FTEN record Karim reported, almost certainly a mislabeled
  // licence/operating-area boundary rather than one real cutblock) simply
  // not be considered here at all -- no outline, no buffer zone, nothing
  // drawn or checked against it, same as it's already excluded from the
  // click report's map fill. Filtered out before anything downstream (the
  // outline layer, the buffer-zone layer) ever sees it.
  const activeCutsAll = (cutPlanRes && cutPlanRes.ok)
    ? cutPlanRes.features.filter(f => String(f.properties && f.properties.LIFE_CYCLE_STATUS_CODE).toUpperCase() === "ACTIVE")
    : [];
  let oversizedActiveCutCount = 0;
  const activeCuts = activeCutsAll.filter(f => {
    const oversized = isOversizedCutblock(f.geometry, f.properties && f.properties.PLANNED_GROSS_BLOCK_AREA);
    if(oversized) oversizedActiveCutCount++;
    return !oversized;
  });
  const cutPlanFailed = !cutPlanRes || !cutPlanRes.ok;

  // Each road feature is classified once here (not per-candidate-parcel
  // below) into {geometry, bufferM, special} -- 25m by default, or the
  // SPECIAL_ROUTE_BUFFER_M figure (with a label) when routeSpecialInfo()
  // matches it against the named highway list. classifyDraRoads() (v82) is
  // the same classification "Reveal Road" reuses for its own query.
  const allRoads = classifyDraRoads((roadRes && roadRes.ok) ? roadRes.features : []);
  const buildingRings = (osmRes && osmRes.ok) ? osmRes.buildings : [];
  // v45: private-titled parcels count the same as a building for the
  // BUILDING_BUFFER_M distance (see the buffer-distance comment above) --
  // sourced from the same all-owner-types parcel query the v44 gap detection
  // already fetches, filtered to ownerCategory()==='private' and flattened to
  // plain rings the same way buildingRings already is.
  const privateParcelRings = (allParcelsRes && allParcelsRes.ok)
    ? allParcelsRes.features.filter(f => ownerCategory(f.properties.OWNER_TYPE) === 'private').flatMap(f => outerRings(f.geometry))
    : [];
  const buildingAndPrivateRings = buildingRings.concat(privateParcelRings);
  // "Checked" means the zoom was tight enough (infraZoomOk -- always true for
  // the radius sweep, a real gate for the view-based button) AND both
  // infrastructure queries actually succeeded -- a failed road/building fetch
  // at a good zoom must NOT be silently treated as "nothing nearby" (that
  // would over-include spots this feature exists to exclude), so it falls
  // back to the same unfiltered behaviour as being zoomed out, with its own
  // note. infraDataFailed is deliberately false when the zoom itself was the
  // reason nothing ran -- that's a "zoom in" message, not a "something broke,
  // try again" one, and the two shouldn't be conflated.
  const infraChecked = infraZoomOk && !!(roadRes && roadRes.ok) && !!(osmRes && osmRes.ok);
  const infraDataFailed = infraZoomOk && !infraChecked;

  spotLayer.clearLayers();
  resetClickableSource('spots'); // v83 -- see the declaration up top; every push below is now tagged 'spots'
  spotDetails = []; gapDetails = []; restrictedDetails = []; // v45/v57 -- reset each run so a popup's "i" index always points at this run's detail text, not a stale one from the previous press
  // v47 -- buffers drawn first (bottom of the stack) so the outlines and the
  // spots themselves render on top of the shaded zone and stay clickable.
  renderActiveCutblockBuffers(activeCuts, spotLayer); // shaded buffer zone around each active cutblock
  renderActiveCutblockOutlines(activeCuts, spotLayer); // the cutblock's own real outline, on top of its buffer zone
  renderNearbyRoads(allRoads, spotLayer); // v58 -- every side road already used for the road buffer, now actually drawn; hover for class/buffer distance
  let shown = 0, restrictedShown = 0, mixedCount = 0;
  // v57: how many candidate parcels have *some* portion restricted for each
  // reason -- counted once per parcel (not once per red square inside it),
  // so this reads as "how many parcels does this affect", same spirit as the
  // old excludedPark/excludedMuni/excludedInfra counts it replaces.
  const reasonParcelCounts = {park:0, muni:0, road:0, building:0};
  // v57: park/muni membership now runs per grid-sample-point inside
  // classifyParcelRestrictions() below, instead of once per parcel via
  // geomsIntersect() -- that's what lets a parcel that only partly overlaps
  // a park/municipality be split (red portion + teal portion) instead of the
  // whole parcel being dropped. Precomputed once here in the same
  // {geom,bbox} shape pointInAnyGeom() (and the v56 gap-detection sweep)
  // already use, rather than rebuilding it per parcel.
  const parkEntries = parks.map(p => ({geom: p.geometry, bbox: bboxOfGeom(p.geometry)}));
  const muniEntries = munis.map(m => ({geom: m.geometry, bbox: bboxOfGeom(m.geometry)}));
  const candidates = parcelRes.features.filter(f => {
    const cat = ownerCategory(f.properties.OWNER_TYPE);
    return cat === 'crown-provincial' || cat === 'untitled-provincial'; // guard, same as the plain Crown-land layer
  });
  candidates.forEach(f => {
    const geom = f.geometry;
    const advisories = [];
    if(tenures.some(t => geomsIntersect(geom, t.geometry))) advisories.push("Crown land tenure (lease/licence/permit) overlaps this parcel — check for posted restrictions.");
    if(woodlots.some(w => geomsIntersect(geom, w.geometry))) advisories.push("Inside a managed forest licence area — the licensee may have posted access rules.");
    if(cuts.some(c => geomsIntersect(geom, c.geometry))) advisories.push("A forestry opening/cutblock overlaps this parcel — check for active harvesting or hauling.");

    // Expanded by the largest possible buffer (SPECIAL_ROUTE_BUFFER_M) so no
    // relevant road or building/private-land boundary is missed by the bbox
    // pre-filter, even though most roads only need the 25m default. Left
    // empty when the zoom is too wide for the infra check to run at all.
    const pBboxExp = expandBboxByMeters(bboxOfGeom(geom), SPECIAL_ROUTE_BUFFER_M);
    const nearRoads = infraChecked ? allRoads.filter(r => r.geometry && bboxesOverlap(pBboxExp, bboxOfLineGeom(r.geometry))) : [];
    const nearBuildings = infraChecked ? buildingAndPrivateRings.filter(ring => bboxesOverlap(pBboxExp, bboxOfRing(ring))) : [];
    const hadSpecialRoute = nearRoads.some(r => r.special);
    const cls = classifyParcelRestrictions(geom, parkEntries, muniEntries, nearRoads, nearBuildings, BUILDING_BUFFER_M, infraChecked);

    // bubblingMouseEvents:false throughout this block, same reasoning as
    // renderMapOverlays() above -- otherwise clicking a potential spot also
    // re-selects that point as the map's main clicked location.
    // v83: every shape drawn in this block now also calls pushClickable() and
    // uses the shared click handler (openNearbyFeaturesPopupAt) instead of a
    // private bindPopup() -- previously a click on any Potential Spots shape
    // (teal/red/purple, cutblock outline, or road) only ever showed that
    // shape's own popup, even when a cutblock or road was also genuinely
    // under the same point; see the v83 section for the full story.
    if(cls.allAllowed){
      const html = spotPopup(f.properties, advisories, false, infraChecked, hadSpecialRoute);
      L.geoJSON(f, {style: spotStyle(), bubblingMouseEvents:false}).on('click', e => openNearbyFeaturesPopupAt(e.latlng)).addTo(spotLayer);
      pushClickable(f.geometry, '🎯', `Potential spot — ${esc(f.properties.OWNER_TYPE || "Crown / untitled provincial")}`, '🎯 Potential spot', html);
      shown++;
      return;
    }
    if(cls.allRestricted){
      // v57: previously this parcel would simply never be drawn (a silent
      // gap) -- now the whole shape is drawn red, with every reason that
      // applied anywhere in it.
      const reasons = Array.from(new Set(cls.restrictedSquares.flatMap(s => s.reasons)));
      reasons.forEach(r => reasonParcelCounts[r]++);
      const html = restrictedPopup(f.properties, reasons, advisories);
      L.geoJSON(f, {style: restrictedStyle(), bubblingMouseEvents:false}).on('click', e => openNearbyFeaturesPopupAt(e.latlng)).addTo(spotLayer);
      pushClickable(f.geometry, '🚫', `Restricted — ${reasons.map(restrictionReasonShort).join(', ')}`, '🚫 Restricted area', html);
      restrictedShown++;
      return;
    }
    // Mixed -- part of this parcel is allowed, part is restricted. Drawn as
    // small per-square shapes (teal for allowed, red for restricted) rather
    // than the whole parcel outline, same as the old road/building buffer's
    // own partial-clip case already did for the allowed portion alone.
    mixedCount++;
    const mixedReasons = Array.from(new Set(cls.restrictedSquares.flatMap(s => s.reasons)));
    mixedReasons.forEach(r => reasonParcelCounts[r]++);
    const allowedPopupHtml = spotPopup(f.properties, advisories, true, infraChecked, hadSpecialRoute);
    cls.allowedSquares.forEach(p => {
      const sq = squareAroundPoint(p, cls.spacingM);
      L.geoJSON(sq, {style: spotStyle(), bubblingMouseEvents:false}).on('click', e => openNearbyFeaturesPopupAt(e.latlng)).addTo(spotLayer);
      pushClickable(sq.geometry, '🎯', `Potential spot — ${esc(f.properties.OWNER_TYPE || "Crown / untitled provincial")}`, '🎯 Potential spot', allowedPopupHtml);
    });
    // Squares sharing the exact same reason set reuse one popup string
    // rather than each building their own -- most restricted squares in a
    // parcel share the same cause (e.g. every square along one edge is
    // "road"), so this avoids rebuilding (and re-pushing into
    // restrictedDetails) an identical popup dozens of times.
    const popupByReasonKey = {};
    cls.restrictedSquares.forEach(({p, reasons}) => {
      const key = reasons.slice().sort().join(',');
      if(!popupByReasonKey[key]) popupByReasonKey[key] = restrictedPopup(f.properties, reasons, null);
      const sq = squareAroundPoint(p, cls.spacingM);
      L.geoJSON(sq, {style: restrictedStyle(), bubblingMouseEvents:false}).on('click', e => openNearbyFeaturesPopupAt(e.latlng)).addTo(spotLayer);
      pushClickable(sq.geometry, '🚫', `Restricted — ${reasons.map(restrictionReasonShort).join(', ')}`, '🚫 Restricted area', popupByReasonKey[key]);
    });
    shown++;
  });

  // ---- unmapped "no parcel record" gap points (v44) ----
  let gapShown = 0, gapExcludedData = 0, gapExcludedPark = 0, gapExcludedMuni = 0, gapExcludedInfra = 0, gapSkipped = false;
  if(!allParcelsRes.ok){
    gapSkipped = true; // can't safely tell a real gap from a parcel this query just failed to return -- skip rather than over-include
  } else {
    // A heuristic, not a certainty: if the query came back exactly at its cap,
    // some real parcels in the search area almost certainly weren't returned,
    // so a sample point landing in one of those missing parcels would be
    // wrongly flagged as a gap. Gap detection still runs (skipping it
    // entirely over a maybe-incomplete result would throw away a lot of good
    // area in a dense view), but the status note below says so explicitly.
    const allParcelsCapped = allParcelsRes.features.length >= GAP_PARCEL_MAX_FEATURES;
    // v56: bbox computed once per parcel here, not once per (point, parcel)
    // pair inside the hot loop below -- see pointInAnyGeom()'s comment above
    // for why this is the biggest single win in this feature's performance pass.
    const allParcelEntries = allParcelsRes.features.map(f => f.geometry).filter(Boolean).map(geom => ({geom, bbox: bboxOfGeom(geom)}));
    const gapSpacingM = gapGridSpacingForBounds(bounds);
    sampleGridPointsInBounds(bounds, gapSpacingM).forEach(p => {
      // v68/v71: the sampling grid above is generated from a square bounding
      // box (the smallest shape sampleGridPointsInBounds()/Overpass
      // understand), so for the radius sweep specifically, without this the
      // gap layer would read as a ~4 km square, not the 2 km *radius* circle
      // actually asked for. The view-based button has no circleClip -- its
      // "area" genuinely is the viewport rectangle, so every sampled point in
      // it is fair game.
      if(circleClip){
        const dFromPin = distanceMeters(circleClip.lat, circleClip.lng, p[1], p[0]);
        if(dFromPin > circleClip.radiusM) return;
      }
      if(pointInAnyGeom(p, allParcelEntries)){ gapExcludedData++; return; } // a parcel record (of any kind) already exists here -- not a gap
      if(parks.some(pk => pointInGeometry(pk.geometry, p))){ gapExcludedPark++; return; }
      if(munis.some(m => pointInGeometry(m.geometry, p))){ gapExcludedMuni++; return; }
      const advisories = [];
      if(tenures.some(t => pointInGeometry(t.geometry, p))) advisories.push("Crown land tenure (lease/licence/permit) overlaps this point — check for posted restrictions.");
      if(woodlots.some(w => pointInGeometry(w.geometry, p))) advisories.push("Inside a managed forest licence area — the licensee may have posted access rules.");
      if(cuts.some(c => pointInGeometry(c.geometry, p))) advisories.push("A forestry opening/cutblock overlaps this point — check for active harvesting or hauling.");

      if(infraChecked){
        const pBboxExp = expandBboxByMeters([p[0], p[1], p[0], p[1]], SPECIAL_ROUTE_BUFFER_M);
        const nearRoads = allRoads.filter(r => r.geometry && bboxesOverlap(pBboxExp, bboxOfLineGeom(r.geometry)));
        const nearBuildings = buildingAndPrivateRings.filter(ring => bboxesOverlap(pBboxExp, bboxOfRing(ring)));
        const clear = nearRoads.every(r => pointToLineGeomMeters(p, r.geometry) >= r.bufferM) && nearBuildings.every(ring => pointToRingMeters(p, ring) >= BUILDING_BUFFER_M);
        if(!clear){ gapExcludedInfra++; return; }
      }
      // v47 -- no per-point cutblock-distance check here any more; a gap
      // point that falls within the buffer distance of an active cutblock
      // now shows that visually, via the shaded buffer zone
      // renderActiveCutblockBuffers() already drew underneath it, same as
      // for the confirmed-parcel spots
      // above.
      const gapSq = squareAroundPoint(p, gapSpacingM);
      L.geoJSON(gapSq, {style: gapStyle(), bubblingMouseEvents:false}).on('click', e => openNearbyFeaturesPopupAt(e.latlng)).addTo(spotLayer);
      pushClickable(gapSq.geometry, '🎯', 'No parcel record (presumed Crown)', '🎯 No parcel record', gapPopup(advisories, infraChecked));
      gapShown++;
    });
    if(allParcelsCapped) gapSkipped = "capped"; // signals the note below without losing the counts already gathered
  }

  if(noteEl){
    // Deliberately explicit at every stage -- a vague "no qualifying spots"
    // message makes it impossible to tell a real "everything here is in a
    // park" result apart from a bug that finds zero Crown/untitled parcels
    // in the first place. Says exactly how many parcels came back from the
    // query, how many of those were actually Crown/untitled, and where each
    // one that didn't become a spot went.
    // v57: every candidate parcel is drawn now -- teal (allowed), red
    // (restricted), or a mix of small teal/red squares -- so there's no more
    // "excluded, not drawn at all" bucket to report; the note instead says
    // how many parcels came out fully teal, fully red, or split, plus how
    // many parcels each restriction reason touched (reasonParcelCounts).
    let msg = `${parcelRes.features.length} parcel${parcelRes.features.length===1?'':'s'} returned ${areaLabel}, ${candidates.length} of them Crown/untitled provincial. `;
    if(candidates.length){
      msg += `${shown} shown as a potential spot${shown===1?'':'s'} (teal${mixedCount ? `, ${mixedCount} of them only partially -- see the red portion(s) for why` : ''}); ${restrictedShown} shown fully red (excluded, not a viable spot anywhere in the parcel)`;
      const reasonBits = [];
      if(reasonParcelCounts.park) reasonBits.push(`${reasonParcelCounts.park} touching a park`);
      if(reasonParcelCounts.muni) reasonBits.push(`${reasonParcelCounts.muni} touching a municipality`);
      if(infraChecked && reasonParcelCounts.road) reasonBits.push(`${reasonParcelCounts.road} touching the road buffer`);
      if(infraChecked && reasonParcelCounts.building) reasonBits.push(`${reasonParcelCounts.building} touching the building/private-land buffer`);
      if(reasonBits.length) msg += ` — restricted portions found: ${reasonBits.join(', ')} (a parcel can count toward more than one reason)`;
      msg += ".";
    } else {
      msg += "None were Crown provincial or untitled provincial by ownership type.";
    }
    msg += " Still check ⚠ advisories and the manual checklist before you go.";
    if(!infraZoomOk) msg += ` Zoom in further (roughly city-block scale) to also check the building/road buffer and draw nearby side roads — skipped at this zoom.`;
    else if(infraDataFailed) msg += ` (Couldn't load road and/or OpenStreetMap building data for this area, so the buffer check didn't run this time, and side roads aren't drawn — spots shown are unfiltered by it; try again.)`;
    else msg += ` ${allRoads.length} nearby side road${allRoads.length===1?'':'s'} drawn (slate, rust where the wider named-highway buffer applies) — hover any of them for its class and buffer distance.`;
    if(partialWarning) msg += " (One of the park/municipality/tenure/forestry layers didn't respond — results may be incomplete; try again.)";
    if(cutPlanFailed) msg += ` (Couldn't load active-cutblock data, so the ${CUTBLOCK_WARN_DISTANCE_M}m cutblock buffer zone didn't run this time.)`;
    else if(oversizedActiveCutCount) msg += ` ${oversizedActiveCutCount} active cutblock record${oversizedActiveCutCount===1?'':'s'} flagged as unusually large (>${CUTBLOCK_AREA_SANITY_HA.toLocaleString()} ha — almost certainly a mislabeled licence/operating-area boundary, not a real single cutblock) and left out of the buffer-zone check entirely.`;

    // Gap-detection summary (v44, purple squares) -- kept as its own sentence
    // rather than folded into the teal-parcel counts above, since it's a
    // fundamentally different kind of evidence (absence of a record, not a
    // positive one) and Karim should be able to tell the two apart at a glance.
    if(gapSkipped === true){
      msg += " Unmapped-gap check (no-ParcelMap-record areas) skipped this time — the all-parcels query needed for it failed; try again.";
    } else {
      msg += ` ${gapShown} unmapped-gap spot${gapShown===1?'':'s'} (purple, no ParcelMap record at all — presumed Crown, verify independently) also shown`;
      const gapBits = [];
      if(gapExcludedPark) gapBits.push(`${gapExcludedPark} excluded (overlaps a park)`);
      if(gapExcludedMuni) gapBits.push(`${gapExcludedMuni} excluded (inside a municipality)`);
      if(gapExcludedInfra) gapBits.push(`${gapExcludedInfra} excluded (within the building/road buffer)`);
      if(gapBits.length) msg += ` — ${gapBits.join(', ')}`;
      msg += ".";
      if(gapSkipped === "capped") msg += " (The all-parcels query hit its cap in this dense an area — some real parcels may be missing from it, so a few gap spots here could actually have a record.)";
    }
    noteEl.textContent = msg;
  }

  // A dropped/moved pin's 2 km sweep can easily extend past whatever was on
  // screen at the moment it was checked, so this pans/zooms out just enough
  // to show the whole checked area once results are in. The view-based
  // button skips this (fitAfter:false) -- it's checking whatever Karim
  // already framed on purpose, so moving the map out from under that would
  // defeat the point of "current view" in the first place.
  if(fitAfter){
    try{ map.fitBounds(bounds, {padding:[40,40]}); }catch(e){ /* ignore bad bounds */ }
  }
}

// Automatic caller -- always a true 2 km DWITHIN circle around wherever was
// just picked. Called from inside runLookup() (see below), so it fires no
// matter how the location was picked -- click, drag the pin, drag the
// header pin, search, or typed coordinates.
async function revealPotentialSpotsAroundPin(lat, lng){
  const bounds = boundsAroundPoint(lat, lng, PIN_SPOT_RADIUS_M);
  await runPotentialSpotsSearch({
    bounds,
    cqlFor: (geomField, extra) => radiusCql(geomField, lat, lng, PIN_SPOT_RADIUS_M, extra),
    areaLabel: `within ${PIN_SPOT_RADIUS_M/1000} km of the pin`,
    infraZoomOk: true, // a fixed 2 km circle is never "too wide" -- always runs
    circleClip: {lat, lng, radiusM: PIN_SPOT_RADIUS_M},
    fitAfter: true
  });
}

// v71: button-triggered caller, restored to its pre-v70 view-based
// behaviour -- checks whatever's currently in view, zoom-gated (SPOT_MIN_ZOOM
// bails out entirely, INFRA_MIN_ZOOM gates just the buffer sub-check), same
// busy-state pattern as revealAllParcels() above. Runs *in addition to* the
// automatic radius sweep, not instead of it -- Karim asked for both.
async function revealPotentialSpots(){
  const btn = document.getElementById('revealSpotsBtn');
  const noteEl = document.getElementById('mapActionsNote');
  const zoom = map.getZoom();
  if(zoom < SPOT_MIN_ZOOM){
    if(noteEl) noteEl.textContent = "Zoom in further before checking Shooting Spots — the current view is too wide.";
    return;
  }
  const bounds = map.getBounds();
  const origLabel = btn.textContent;
  btn.disabled = true; btn.classList.add('busy'); btn.textContent = "🎯 Loading…";
  try{
    await runPotentialSpotsSearch({
      bounds,
      cqlFor: (geomField, extra) => viewportBboxCql(geomField, bounds, extra),
      areaLabel: "in the current view",
      infraZoomOk: zoom >= INFRA_MIN_ZOOM,
      circleClip: null, // the "area" genuinely is the viewport rectangle -- no circle to clip to
      fitAfter: false // don't move the map out from under a deliberately-framed view
    });
  } finally {
    btn.disabled = false; btn.classList.remove('busy'); btn.textContent = origLabel;
  }
}
document.getElementById('revealSpotsBtn').addEventListener('click', revealPotentialSpots);
