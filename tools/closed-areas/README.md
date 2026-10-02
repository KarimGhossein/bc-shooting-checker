# Closed areas build (Region 2)

How `src/data/closed-areas-r2.js` was made. Not part of the app or the test suite.

1. **Text.** The Closed Areas Regulation (B.C. Reg. 76/84) consolidated text, read from the King's Printer site. Each Region 2 item was read and sorted by how its boundary can be built.
2. **Source data.** BC's WFS (`openmaps.gov.bc.ca`) can't be reached from the build sandbox, so source layers were fetched in a browser page using `lib.js` (helpers) and returned as JSON: road lines (FTEN road sections, Digital Road Atlas), Freshwater Atlas streams, lakes, islands and named watersheds, municipal and electoral area boundaries, parks and wildlife management units. The Schedule 5.1 Forest Service Road corridors and Elbow Lake were built in that browser page directly with the same helpers (corridor buffers, junction and stream-crossing slicing).
3. **Geometry.** `build_b3.js` and `build_b4.js` (node, `@turf/turf` 6.5) build the remaining zones from the fetched layers (`src_b3.json`, `src_mu.json`, not committed): highway corridors clipped at municipal and park boundaries, the asymmetric Highway 99 corridor, Hemlock Valley Road split at the second Sakwi Creek crossing, Texada roads, islands, Cultus Lake.
4. **Check.** `plot.py` draws every zone over its source lines for a visual check.
5. **Assemble.** Zones get a bbox, citation and plain-language summary; items whose boundaries aren't built yet go in `unmapped` with a reference point and radius.

When the regulation changes (check each Synopsis edition), rebuild the affected zones and update `consolidatedTo`.
