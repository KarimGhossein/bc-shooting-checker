// v92: first slice of docs/PLAN.md's module split, shared tuning
// constants (search radii, feature caps, query-level filters) that
// src/config/layers.js and the rest of the app reference by bare name.
//
// This is a plain classic script (no `export`/`import`), loaded via a
// <script src="src/config/constants.js"> tag in index.html's <head>,
// BEFORE src/config/layers.js and the main inline script, not an ES
// module. See docs/PLAN.md's "Why classic scripts, not ES modules" section
// for the empirically-confirmed reason: an ES module's `import` is blocked
// by CORS when index.html is opened as a local file:// page (Chromium
// refuses cross-file module loads under file://), which would break both
// this app's own test suite (every tests/verify_*.js loads index.html via
// file://) and the standalone "download it and open it directly, works
// fully offline" capability this app has always been delivered with.
// Classic <script src> tags have no such restriction, and every classic
// script in a page shares one global scope for top-level const/let (same
// as multiple such tags always have), so this still gets a real,
// separate, navigable file per concern, without either of those risks.

// Shared search radius for every DWITHIN (proximity) layer below, forest
// service roads, recreation sites/trails, Crown tenures, and everything
// else that hasn't been given its own wider radius, so "extend the radius"
// for those only ever needs to change in one place.
const SEARCH_RADIUS_M = 1000;
// v78: Karim asked for the forestry activity (cutblocks) list specifically
// to widen to 2 km, its own constant rather than bumping SEARCH_RADIUS_M
// itself, since that shared constant also drives several unrelated layers
// (roads, recreation, tenures, the nearby-parcels context draw) that were
// never asked to change.
const CUTBLOCK_SEARCH_RADIUS_M = 2000;

// Cap on how many *surrounding* parcels get drawn (dim, for context) around
// the clicked point, dense urban subdivisions can have hundreds of small
// titled lots within 1 km, and there's no value in trying to render all of
// them. The parcel actually under the pin is unaffected by this cap; it's
// queried and drawn separately (see cqlFor('parcel', ...) / parcelR below).
const NEARBY_PARCEL_MAX_FEATURES = 400;

// Karim asked to only pull cutblock data with a start date after 1990 --
// applied at the query level (not just filtered after the fact) so the app
// doesn't even download/report on decades-old logging history that's long
// since regrown and irrelevant to current shooting legality. A block with
// NO start date yet (authorized/planned in FTEN but not yet disturbed) is
// deliberately KEPT, "no start date" isn't the same as "before 1990", and
// planned/current activity is exactly what this app cares about. Applied
// identically to both cutblock (RESULTS) and cutblockPlan (FTEN) below via
// LAYERS[key].extraFilter, so a block can't slip back in as an old,
// long-since-regrown FTEN-only record just because RESULTS excluded it.
// DISTURBANCE_START_DATE confirmed present on both layers (it's the same
// field buildCutblockList() already reads for the "Start date" shown in the
// popup) and the comparison confirmed live against BC's real WFS server,
// not assumed.
const CUTBLOCK_START_DATE_CQL = "(DISTURBANCE_START_DATE IS NULL OR DISTURBANCE_START_DATE > '1990-01-01')";

// v109: where the KAGE wordmark in the header links to. Swap for the public
// KAGE site address once it has one.
const KAGE_HOME_URL = "https://claude.ai/artifact/3i8zoBN2pKMwPHEHCTwrEj";

// v109: how long a tool's result or error stays under the search bar.
const STATUS_TOAST_MS = 7000;

// v109: BC Hunting and Trapping Regulations Synopsis edition the app's
// management-unit links and regulation notes are based on. The Synopsis is
// republished every two years (July 1 to June 30). After SYNOPSIS_VALID_UNTIL
// the app shows an "may be out of date" notice and the test
// tests/verify_v109_synopsis_expiry.js fails, as a reminder to update the
// links and any rules quoted from it.
const SYNOPSIS_EDITION = "2026-2028";
const SYNOPSIS_VALID_UNTIL = "2028-06-30";
const SYNOPSIS_LANDING_URL = "https://www2.gov.bc.ca/gov/content/sports-culture/recreation/fishing-hunting/hunting/regulations-synopsis";
const SYNOPSIS_PDF_BASE = "https://www2.gov.bc.ca/assets/gov/sports-recreation-arts-and-culture/outdoor-recreation/fishing-and-hunting/hunting/regulations/";
const SYNOPSIS_REGION_PDFS = {
  "1": {name: "Vancouver Island", file: "hunting-trapping-synopsis-region-1-vancouver-island.pdf"},
  "2": {name: "Lower Mainland", file: "hunting-trapping-synopsis-region-2-lower-mainland.pdf"},
  "3": {name: "Thompson", file: "hunting-trapping-synopsis-region-3-thompson.pdf"},
  "4": {name: "Kootenay", file: "hunting-trapping-synopsis-region-4-kootenay.pdf"},
  "5": {name: "Cariboo", file: "hunting-trapping-synopsis-region-5-cariboo.pdf"},
  "6": {name: "Skeena", file: "hunting-trapping-synopsis-region-6-skeena.pdf"},
  "7A": {name: "Omineca", file: "hunting-trapping-synopsis-region-7a-omineca.pdf"},
  "7B": {name: "Peace", file: "hunting-trapping-synopsis-region-7b-peace.pdf"},
  "8": {name: "Okanagan", file: "hunting-trapping-synopsis-region-8-okanagan.pdf"}
};

// v110: the starting view (southwest and northeast corners of BC) and how
// far the map zooms in on the person's own location.
const BC_BOUNDS = [[48.2, -139.1], [60.0, -114.0]];
const LOCATE_ZOOM = 11;

// v110d: an ACTIVE cutting permit alone doesn't mean logging is happening:
// licensees often leave a permit open for years after the block is cut and
// replanted. The 400 m "active logging" zone is only drawn when the permit
// is ACTIVE and harvest either has no recorded end date or ended within
// this many days.
const ACTIVE_LOGGING_RECENT_DAYS = 365;
