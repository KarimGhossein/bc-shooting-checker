# Module-split migration plan

`index.html` today is still the full pre-migration app: ~390KB, one inline
`<script>`, 175 top-level functions in one shared scope. This document is
the map for turning that into a real source tree, incrementally, without
ever leaving the app in a broken state between sessions.

## Why incremental, not a rewrite

175 functions is too much to safely re-organize in one pass. The plan
instead is: extract one coherent slice at a time, run the full verification
suite (`npm test`) after each extraction, commit only when it's green, and
never let more than one slice be "in flight" at once. This is the same
discipline the project already used for every feature fix in
`docs/CHANGELOG.md` — apply it to structure, not just behaviour.

## Target structure

```
src/
  config/
    layers.js        LAYERS (the 16 WFS layer definitions)
    constants.js      buffer distances, zoom gates, search radii
  data/
    wfs.js            queryLayer, wfsUrl, jsonpRequest, cqlFor, viewportBboxCql
    geocode.js         Nominatim
    overpass.js         OSM building queries
    open511.js          DriveBC
    bylaws.js            live bylaw fetch/parse + CORS_PROXY
  map/
    basemaps.js        Satellite/Street/Topo + Mapbox fallback
    render.js            renderMapOverlays, renderNearbyRoads, renderActiveCutblockOutlines, etc.
    chooser.js            currentClickableFeatures, pushClickable, resetClickableSource, openNearbyFeaturesPopupAt
    markup.js              draw toolbar, GeoJSON export/import
  ui/
    drawers.js          bottom report drawer, checklist drawer, tools drawer
    report.js             renderReport + report cards
    checklist.js           auto/manual checklist items
    modals.js               info modals, Disclaimers
  state.js              module-level state currently scattered as top-level `let`s
  main.js               entry point — wires it all together, replaces the inline <script>
styles/
  main.css              the ~390KB of inline CSS, split by the same boundaries as above
```

This mirrors the app's own existing conceptual boundaries (it already
comments things like "shared cross-layer click-chooser mechanism" as a
distinct system) — the split is mostly giving those existing boundaries
real file edges, not inventing new ones.

## Suggested order

Roughly least-to-most risky, since later extractions depend on earlier
ones existing as real modules to import from:

1. `config/constants.js` + `config/layers.js` — pure data, no behaviour, zero risk.
2. `data/wfs.js` — the query layer every feature depends on; get this right early.
3. `map/chooser.js` — small, self-contained, already has the best test coverage (`verify_v79`, `verify_v83`).
4. `map/render.js` — the biggest slice; do this one in a few passes (report-click rendering, then Shooting Spots, then View Parcels/Reveal Road), not all at once.
5. `ui/*` — last, since it depends on everything above already being stable.

## Rule for every step

1. Extract one slice into its real module.
2. `index.html`'s inline script imports it instead of defining it inline.
3. `npm test` — all scripts in `tests/` must stay green.
4. Commit with a message naming exactly what moved.
5. Only then start the next slice.

## Known blocker as of this plan being written

This sandbox's network policy currently blocks `registry.npmjs.org`
(confirmed via the egress proxy status, not a misconfiguration on this
project's end), so `npm install` cannot be verified from inside a Claude
session running here. `package.json` and `vite.config.mjs` are written and
ready; the first person (or CI run) with working registry access should
run `npm install && npm run build` once to confirm the toolchain itself,
independent of the module-split work above. The test suite does **not**
have this problem — Playwright is available in this sandbox without an
npm install, and `npm test` has been run for real (10/10 passing) against
this exact repository state.
