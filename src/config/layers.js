// v92: first slice of docs/PLAN.md's module split -- the 16 DataBC WFS
// layer definitions every query in this app is built from. Plain classic
// script (see src/config/constants.js's own top comment for why this isn't
// an ES module) -- loaded via <script src="src/config/layers.js"> right
// after src/config/constants.js, since LAYERS references SEARCH_RADIUS_M /
// CUTBLOCK_SEARCH_RADIUS_M / CUTBLOCK_START_DATE_CQL by bare name and
// classic <script> tags execute in document order, sharing one global
// scope.
const LAYERS = {
  parcel:    {typeName:"WHSE_CADASTRE.PMBC_PARCEL_FABRIC_POLY_SVW", geom:"SHAPE", mode:"intersects"},
  muni:      {typeName:"WHSE_LEGAL_ADMIN_BOUNDARIES.ABMS_MUNICIPALITIES_SP", geom:"SHAPE", mode:"intersects"},
  park:      {typeName:"WHSE_TANTALIS.TA_PARK_ECORES_PA_SVW", geom:"SHAPE", mode:"intersects"},
  cutblock:  {typeName:"WHSE_FOREST_VEGETATION.RSLT_OPENING_SVW", geom:"GEOMETRY", mode:"dwithin", radius:CUTBLOCK_SEARCH_RADIUS_M, extraFilter:CUTBLOCK_START_DATE_CQL},
  tenure:    {typeName:"WHSE_TANTALIS.TA_CROWN_TENURES_SVW", geom:"SHAPE", mode:"intersects"},
  woodlot:   {typeName:"WHSE_FOREST_TENURE.FTEN_MANAGED_LICENCE_POLY_SVW", geom:"GEOMETRY", mode:"intersects"},
  // Consolidated Cutblocks blends RESULTS + VRI + imagery-based harvest
  // detection into one product keyed to the same OPENING_ID as RSLT_OPENING_SVW,
  // and it's the one that actually carries a harvest *completion* date --
  // RESULTS itself only tracks silviculture status, not when logging finished.
  harvest:   {typeName:"WHSE_FOREST_VEGETATION.VEG_CONSOLIDATED_CUT_BLOCKS_SP", geom:"SHAPE", mode:"dwithin", radius:CUTBLOCK_SEARCH_RADIUS_M},
  road:      {typeName:"WHSE_FOREST_TENURE.FTEN_ROAD_SECTION_LINES_SVW", geom:"GEOMETRY", mode:"dwithin", radius:SEARCH_RADIUS_M},
  // Forest Tenure Cut Block Polygons -- the cutting-permit record for a
  // block, which exists (with a PLANNED_HARVEST_DATE) as soon as a permit is
  // authorized, well before RESULTS has anything to report. This is what
  // catches a block that's been approved/planned but hasn't been disturbed
  // yet -- RSLT_OPENING_SVW alone won't show it.
  cutblockPlan: {typeName:"WHSE_FOREST_TENURE.FTEN_CUT_BLOCK_POLY_SVW", geom:"GEOMETRY", mode:"dwithin", radius:CUTBLOCK_SEARCH_RADIUS_M, extraFilter:CUTBLOCK_START_DATE_CQL},
  // BC's Digital Road Atlas -- the province's official road network, used
  // only by Potential Spots' road buffer (see further down). Confirmed via a
  // live DescribeFeatureType call against this exact layer: real fields are
  // ROAD_CLASS (free-text classification) and HIGHWAY_ROUTE_NUMBER
  // (populated only for numbered highways/routes). Named draRoad (not
  // "road") to stay distinct from the existing FTEN forest-service-road
  // layer above, which this key used to collide with under its old name.
  draRoad: {typeName:"WHSE_BASEMAPPING.DRA_DGTL_ROAD_ATLAS_MPAR_SP", geom:"GEOMETRY", mode:"intersects"},
  // Recreation Sites and Trails BC (RSTBC), split across three FTEN layers
  // by geometry type -- confirmed live via DescribeFeatureType against each
  // exact layer (not guessed): points (rec sites/campsites -- PROJECT_NAME,
  // NUM_CAMP_SITES, RECREATION_MAINTAIN_STD_CODE, no status field on this
  // one), polygons (recreation reserves/areas -- PROJECT_NAME, PROJECT_TYPE,
  // LIFE_CYCLE_STATUS_CODE), and lines (trails -- same fields as polygons
  // plus FEATURE_LENGTH_M). All three merged into one recList by
  // buildRecreationList() below. Same 1 km radius as the other proximity
  // layers (cutblocks, tenures, roads).
  recSite: {typeName:"WHSE_FOREST_TENURE.FTEN_REC_SITE_POINTS_SVW", geom:"GEOMETRY", mode:"dwithin", radius:SEARCH_RADIUS_M},
  recPoly: {typeName:"WHSE_FOREST_TENURE.FTEN_RECREATION_POLY_SVW", geom:"GEOMETRY", mode:"dwithin", radius:SEARCH_RADIUS_M},
  recLine: {typeName:"WHSE_FOREST_TENURE.FTEN_RECREATION_LINES_SVW", geom:"GEOMETRY", mode:"dwithin", radius:SEARCH_RADIUS_M},
  // Wildlife Act Motor Vehicle Prohibition Regulation -- BC's own official,
  // legally-binding road/area closure data (Open Government Licence -- BC),
  // confirmed live via DescribeFeatureType + real GetFeature samples, not
  // guessed. This is the public alternative used in place of backroadstatus.com's
  // own (ToS-restricted, community-sourced) road condition/closure reports --
  // see the "declined" note above buildMvprList() below for why. Routes
  // (lines, along named roads -- ACCESS_STATUS like "Closed Year Round -- All
  // Motor Vehicles") use the same 1 km proximity radius as every other road
  // layer; Areas (polygons, often several km wide, some specifically
  // "Motor Vehicle Hunting Closed Areas" -- directly relevant to this app)
  // use intersects, same as park/muni, since what matters is whether the
  // clicked point itself falls inside one.
  mvprRoutes: {typeName:"WHSE_WILDLIFE_MANAGEMENT.WAA_MVPR_ROUTES_SP", geom:"SHAPE", mode:"dwithin", radius:SEARCH_RADIUS_M},
  mvprAreas: {typeName:"WHSE_WILDLIFE_MANAGEMENT.WAA_MVPR_AREAS_SP", geom:"SHAPE", mode:"intersects"},
  // Wildlife Management Areas (B.C. Reg 161/87, Wildlife Act) -- confirmed
  // real WFS layer/fields via DescribeFeatureType. Intersects mode, same as
  // park/muni/mvprAreas, since what matters is whether the clicked point
  // itself falls inside one. Deliberately NOT treated as a hard exclusion
  // the way parks are: a WMA doesn't ban discharge by itself -- some carry
  // their own gazetted access/discharge restrictions (checked case-by-case
  // under the Wildlife Act) and some don't restrict shooting at all, so this
  // is surfaced as an amber advisory prompting a manual check, not a red flag.
  wma: {typeName:"WHSE_TANTALIS.TA_WILDLIFE_MGMT_AREAS_SVW", geom:"SHAPE", mode:"intersects"}
};
