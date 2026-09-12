// v92: first slice of docs/PLAN.md's module split -- shared tuning
// constants (search radii, feature caps, query-level filters) that
// src/config/layers.js and the rest of the app reference by bare name.
//
// This is a plain classic script (no `export`/`import`), loaded via a
// <script src="src/config/constants.js"> tag in index.html's <head>,
// BEFORE src/config/layers.js and the main inline script -- not an ES
// module. See docs/PLAN.md's "Why classic scripts, not ES modules" section
// for the empirically-confirmed reason: an ES module's `import` is blocked
// by CORS when index.html is opened as a local file:// page (Chromium
// refuses cross-file module loads under file://), which would break both
// this app's own test suite (every tests/verify_*.js loads index.html via
// file://) and the standalone "download it and open it directly, works
// fully offline" capability this app has always been delivered with.
// Classic <script src> tags have no such restriction, and every classic
// script in a page shares one global scope for top-level const/let (same
// as multiple such tags always have) -- so this still gets a real,
// separate, navigable file per concern, without either of those risks.

// Shared search radius for every DWITHIN (proximity) layer below -- forest
// service roads, recreation sites/trails, Crown tenures, and everything
// else that hasn't been given its own wider radius, so "extend the radius"
// for those only ever needs to change in one place.
const SEARCH_RADIUS_M = 1000;
// v78: Karim asked for the forestry activity (cutblocks) list specifically
// to widen to 2 km -- its own constant rather than bumping SEARCH_RADIUS_M
// itself, since that shared constant also drives several unrelated layers
// (roads, recreation, tenures, the nearby-parcels context draw) that were
// never asked to change.
const CUTBLOCK_SEARCH_RADIUS_M = 2000;

// Cap on how many *surrounding* parcels get drawn (dim, for context) around
// the clicked point -- dense urban subdivisions can have hundreds of small
// titled lots within 1 km, and there's no value in trying to render all of
// them. The parcel actually under the pin is unaffected by this cap; it's
// queried and drawn separately (see cqlFor('parcel', ...) / parcelR below).
const NEARBY_PARCEL_MAX_FEATURES = 400;

// Karim asked to only pull cutblock data with a start date after 1990 --
// applied at the query level (not just filtered after the fact) so the app
// doesn't even download/report on decades-old logging history that's long
// since regrown and irrelevant to current shooting legality. A block with
// NO start date yet (authorized/planned in FTEN but not yet disturbed) is
// deliberately KEPT -- "no start date" isn't the same as "before 1990", and
// planned/current activity is exactly what this app cares about. Applied
// identically to both cutblock (RESULTS) and cutblockPlan (FTEN) below via
// LAYERS[key].extraFilter, so a block can't slip back in as an old,
// long-since-regrown FTEN-only record just because RESULTS excluded it.
// DISTURBANCE_START_DATE confirmed present on both layers (it's the same
// field buildCutblockList() already reads for the "Start date" shown in the
// popup) and the comparison confirmed live against BC's real WFS server,
// not assumed.
const CUTBLOCK_START_DATE_CQL = "(DISTURBANCE_START_DATE IS NULL OR DISTURBANCE_START_DATE > '1990-01-01')";
