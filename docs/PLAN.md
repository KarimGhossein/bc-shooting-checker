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

## Why classic `<script src>` files, not ES modules

The original version of this plan called for real `import`/`export` ES
modules, bundled by Vite. As of v92, that turned out to conflict with two
things this app already has and needs to keep:

1. **Every existing test loads `index.html` via `file://`** (`tests/verify_*.js`,
   consistently, since before this plan existed).
2. **The shipped `index.html` is explicitly a standalone file** — "works
   fully offline-of-Claude once downloaded, open directly in any browser"
   (see the top of `docs/CHANGELOG.md`) — which means it has to work opened
   as a local file too, not only served from Vercel.

An ES module's `import` is blocked by CORS the moment the page itself is
`file://` — confirmed empirically (Chromium: "Access to script … from
origin 'null' has been blocked by CORS policy … Cross origin requests are
only supported for protocol schemes: chrome, chrome-extension, …, http,
https"). Building the split around real `import`/`export` would have
silently broken both (1) and (2) the moment it landed, and neither is
something CI running `vite build` would catch, since CI never opens the
built output via `file://`.

Plain classic `<script src="...">` tags have no such restriction — also
confirmed empirically — and every classic script in a page already shares
one global scope for top-level `const`/`let` declarations (the same way
this file's single inline `<script>` has always made every function/const
visible to every `onclick="..."` handler generated anywhere else in the
file). So the split below still gets real, separate, individually-openable
files per concern, loaded in dependency order via multiple `<script src>`
tags before the main inline script — without breaking file:// loading, and
without needing every function referenced from an inline `onclick`/
`onmouseover`/etc. handler to be re-exported onto `window` by hand (the
extra step true ES modules would have required, since module-scoped
top-level declarations do *not* become global/`window` properties the way
classic-script ones do). `vite.config.mjs`/`package.json` stay as already
written — Vite can still bundle/minify plain classic scripts as a later,
separate concern (real minification, a single production file) once its
toolchain is verified for real; that's orthogonal to correctness, unlike
the ES-module question above.

## Target structure

```
src/
  config/
    constants.js      buffer distances, feature caps, query-level filters (DONE, v92)
    layers.js         LAYERS (the 16 WFS layer definitions) (DONE, v92)
    icons.js          MARKUP_ICONS -- the 17-icon curated Lucide set for markup pins (DONE, v93)
  data/
    wfs.js            queryLayer, wfsUrl, jsonpRequest, cqlFor, viewportBboxCql (DONE, v97)
    geocode.js         Nominatim
    overpass.js         OSM building queries
    open511.js          DriveBC
    bylaws.js            live bylaw fetch/parse + CORS_PROXY
  map/
    basemaps.js        Satellite/Street/Topo + Mapbox fallback
    render.js            renderMapOverlays, renderNearbyRoads, renderActiveCutblockOutlines, etc.
    chooser.js            currentClickableFeatures, pushClickable, resetClickableSource, openNearbyFeaturesPopupAt (DONE, v98 -- chooserHighlightLayer/highlightNearbyMatch(), added after this list was written, stayed inline; see the file's own scope note)
    markup.js              draw toolbar, GeoJSON export/import
  ui/
    drawers.js          bottom report drawer, checklist drawer, tools drawer
    report.js             renderReport + report cards
    checklist.js           auto/manual checklist items
    modals.js               info modals, Disclaimers
  state.js              module-level state currently scattered as top-level `let`s
  main.js               entry point — wires the rest together (NOT an ES module entry point in the original sense above; see the section above)
styles/
  main.css              the ~390KB of inline CSS, split by the same boundaries as above
```

This mirrors the app's own existing conceptual boundaries (it already
comments things like "shared cross-layer click-chooser mechanism" as a
distinct system) — the split is mostly giving those existing boundaries
real file edges, not inventing new ones. Note the zoom-gate constants
(`PARCEL_VIEW_MIN_ZOOM`, `ROAD_VIEW_MIN_ZOOM`, `SPOT_MIN_ZOOM`,
`INFRA_MIN_ZOOM`) were deliberately **left in place** rather than folded
into `config/constants.js` in the v92 pass — each lives right next to the
feature-specific comment explaining why that exact value was chosen (some
with their own version history, e.g. the v84 fix), and this codebase's own
style leans on that local context; moving them to a generic constants dump
would cost more readability than a same-page classic-script split actually
buys back.

## Suggested order

Roughly least-to-most risky, since later extractions depend on earlier
ones already being defined by the time they run:

1. ~~`config/constants.js` + `config/layers.js` — pure data, no behaviour, zero risk.~~ **Done, v92.**
2. ~~`data/wfs.js` — the query layer every feature depends on; get this right early.~~ **Done, v97** (`queryOpen511`/`OPEN511_BASE` and `radiusCql` deliberately left inline — see the file's own scope note; a future `data/open511.js` and folding `radiusCql` in are separate, later passes).
3. ~~`map/chooser.js` — small, self-contained, already has the best test coverage (`verify_v79`, `verify_v83`).~~ **Done, v98** (`chooserHighlightLayer`/`CHOOSER_HIGHLIGHT_STYLE`/`highlightNearbyMatch()`/`clearNearbyMatchHighlight()` deliberately left inline — their top-level layer creation needs `map`, which doesn't exist yet when this file's `<script src>` loads; see the file's own scope note).
4. `map/render.js` — the biggest slice; do this one in a few passes (report-click rendering, then Shooting Spots, then View Parcels/Reveal Road), not all at once. **Take the v98 lesson into this one**: every `<script src>` file in this migration loads *before* the main inline script's `const map = L.map(...)` (line ~1603) runs, so any top-level statement that touches `map`, `L.layerGroup().addTo(map)`, `L.control(...)`, etc. *immediately* (not inside a function body) can't move into one of these files as-is — it'll throw on `map` not being defined yet. `render.js` almost certainly has more of these than `chooser.js` did (layer groups like `overlayLayer`/`parcelViewLayer`/`spotLayer`/`roadViewLayer` are created at the top level specifically so every render function can reach them). Each slice's own top comment should keep calling this out explicitly, the way `chooser.js`'s does, rather than silently leaving map-dependent globals inline without explanation.
5. `ui/*` — last, since it depends on everything above already being stable.

## Rule for every step

1. Extract one slice into its own classic-script file under `src/`.
2. Remove that definition from `index.html`'s inline script; add/keep a
   `<script src="src/...">` tag in `<head>`, in dependency order, before
   the main inline script.
3. `npm test` — all scripts in `tests/` must stay green.
4. Commit with a message naming exactly what moved.
5. Only then start the next slice.

## Known blocker as of this plan being written

This sandbox's network policy still blocks `registry.npmjs.org` (confirmed
via the egress proxy status as of v92, not a misconfiguration on this
project's end), so `npm install` cannot be verified from inside a Claude
session running here. `package.json` and `vite.config.mjs` are written and
ready; the first person (or CI run) with working registry access should
run `npm install && npm run build` once to confirm the toolchain itself.
This doesn't block the module-split work above at all, though, since (per
the "why classic scripts" section) the split doesn't depend on Vite/npm to
be correct — it only matters for an eventual minified/bundled production
build, a separate, later concern. The test suite does **not** have the
npm-install problem either — Playwright is available in this sandbox
without an npm install, and `npm test` has been run for real (16/16
passing, as of v92) against this exact repository state, file://-loaded,
same as always.

## v94: the blocker above turned out to already be live in production

The paragraph above assumed the untested `npm install`/Vite toolchain was
inert until someone deliberately ran it. It wasn't: Vercel auto-detects a
project as Vite the moment it sees `vite.config.mjs` + `vite` in
`package.json`, and **runs `npm run build` on every deploy, serving only
its `dist/` output** — no one had to opt into that, and nothing in this
plan or `docs/CHANGELOG.md` said it was happening. Vite's HTML processing
only bundles/copies assets it can see in the `type="module"` import graph
or `public/`; a plain classic `<script src="src/config/whatever.js">` (the
whole point of this plan's "why classic scripts, not ES modules" section)
is invisible to that graph, so Vite left the `<script>` tag untouched in
its output `index.html` **but never copied the file it points at** — every
`src/config/*.js` file 404'd in production from the moment v92 shipped.

`SEARCH_RADIUS_M`/`LAYERS`/etc. are only read from inside function bodies
that run on user interaction, so v92 alone 404'd silently — nothing throws
until a query actually runs, and the report checked out fine in this
session's own file://-based tests since those load the real files off
disk, never through a Vite build. v93 is what made it loud: `MARKUP_ICONS`
is read at the *top level* of the main script (populating the icon picker
immediately at page load), so the same `ReferenceError` that would have
eventually hit any real location lookup instead fired immediately and
killed every remaining top-level statement in that one `<script>` block —
which is why Karim saw My Markup **and** the header progress bar vanish
together: both are wired later in the file than that crash point. The
actual blast radius was larger than either symptom alone: any real
location lookup against `LAYERS` had already been broken in production
since v92, just not yet in an obvious way.

**Fix**: `vercel.json` at the repo root, `{"framework": null, "buildCommand":
null, "installCommand": null, "outputDirectory": "."}` — tells Vercel this
is a plain static site, skip framework auto-detection and the build step
entirely, and serve the repo root byte-for-byte, the same thing `file://`
and a plain static file server already do. `/api/bylaw-fetch.js` (v90) is
unaffected — Vercel Functions under `api/` are detected independently of
the framework/build settings. If Karim's Vercel dashboard has an explicit
per-setting *override* toggled on for Framework Preset/Build Command
(Project Settings → Build & Development Settings), that would win over
this file and needs clearing there too — `vercel.json` can't be verified
from inside this sandbox (no dashboard access, and `npm install` is still
blocked here per the paragraph above), so this needs a real deploy to
confirm.
