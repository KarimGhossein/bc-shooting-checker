// v108: the map's visual style system, one place for every overlay colour,
// line weight, dash pattern and fill level, replacing ~20 hardcoded hex
// values and 7 dash patterns that had accumulated one layer at a time (each
// picked to be "distinct from every other colour", never as a set).
//
// Plain classic script (same reasoning as constants.js: works under
// file:// and in the standalone downloaded copy). Loaded after
// constants.js and before src/map/render.js and the main inline script.
//
// Rules this file encodes:
// - Colour carries meaning only. Legality colours (restricted / caution /
//   clear / no data) keep the exact meanings the app has always used; every
//   data layer gets one muted colour. All colours sit in a matched mid-tone
//   band (roughly 2-3:1 contrast against BOTH dark satellite imagery and the
//   light street/topo basemaps, checked numerically, not by eye), so none
//   vanishes on one basemap and shouts on another.
// - Edge contrast comes from a thin dark "casing" drawn around every overlay
//   by CSS (see .leaflet-overlay-pane svg in index.html), not from
//   saturation or heavy strokes. That's the standard technique on
//   onX/Gaia/Apple Maps-style overlays.
// - Two line weights (+ a strong one for the thing you're looking at), ONE
//   dash pattern, reserved for legal boundaries that aren't physical lines.
// - Low fills. Fills stack where shapes overlap, so they stay light; the
//   outline does the work.
// - KAGE bronze is reserved for "what you're pointing at": the location pin
//   and the hover/selection highlight. It never encodes a data category.
const MAP_PAL = {
  // legality semantics (same meanings as the report's red/amber/green/gray)
  restricted: "#E2685A",
  caution:    "#D9A441",
  clear:      "#45A872",
  nodata:     "#8E9794",
  // data layers
  park:        "#2EA58B",
  municipal:   "#B874B8",
  tenure:      "#4FA0CC",
  woodlot:     "#9BA84F",
  mu:          "#E4DDCB", // v109: management unit boundary, a pale warm line; large and always present, so it stays quiet
  wma:         "#C4A52A", // gold, not orange: orange belongs to the highway line (they were near-identical, 24 vs 20 degrees hue); deep enough to read on the light street map
  fsrActive:   "#D8A755",
  fsrRetired:  "#A3957A", // greyed tan: same family as active FSR (reads as "faded"), and kept apart from the grey public-road line
  recreation:  "#D66A9E",
  spot:        "#2BB3C4", // cyan: kept clear of the park teal (#2EA58B) so a potential spot never reads as a protected area
  gap:         "#8E7DE3",
  roadPublic:  "#9DA9B3",
  roadHighway: "#D9733A",
  cutPlanned:  "#93A6BC",
  // parcel ownership categories not already covered by a legality colour
  federal:     "#AE8660",
  firstNation: "#6A86D8", // indigo, kept apart from the tenure blue (#4FA0CC)
  // selection / brand
  selection:   "#C9A56B"
};

const MAP_W = { hair: 1, line: 1.5, strong: 2.25, road: 2.5 };
const MAP_DASH = "5 4";
// hit: the minimum fill that still lets a click inside an outline-only
// shape register (v81, an unfilled SVG interior never receives clicks),
// so outline-only layers keep this instead of 0.
const MAP_FILL = { hit: 0.03, faint: 0.05, area: 0.12, emphasis: 0.18, strong: 0.24 };
