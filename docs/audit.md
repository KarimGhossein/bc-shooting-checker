---
description: Senior-developer audit of bc-shooting-check.html (reviewed at v84) — architecture, data layer, UI/UX, security, legal, performance, and testing findings, with a prioritized 4-phase roadmap toward public web + phone app launch.
---
# BC Shooting Location Checker — Engineering Audit

Full formatted report: https://claude.ai/code/artifact/5c4d5e72-8c06-40c5-8fb1-d0b7220ca514

Reviewed build: v84 · ~390KB / 5,819 lines, single HTML file, no backend, not a git repository.

## Executive summary
The app's functional core is strong: 16 live BC government data layers merged into one coherent verdict, more legal nuance than most commercial competitors. What's missing is the infrastructure layer between "works when I test it" and "works for the public": no backend, no version control, no automated tests in CI, no error monitoring, and nothing that makes it installable as a phone app.

Key measurements: 16 live data layers · 175 JS functions in one file · 0 git commits · 0 tests in CI · 19 total ARIA/alt/role attributes · 0 uses of the Geolocation API.

## What's already working
- Data coverage: parcels, municipal boundaries, parks, Crown tenures, woodlots, WMAs, merged RESULTS+FTEN cutblocks with active-buffer warnings, DRA roads + forest service roads with real Wildlife Act buffer classification, MVPR closures, RSTBC recreation data, live bylaw fetch-and-parse for 3 municipalities, personal map markup with GeoJSON export/import.
- Interaction design: shared cross-layer click-chooser for overlapping map features, consistent red/amber/green/gray severity coding, progressive disclosure via info buttons/modals, 3 basemaps with Mapbox auto-fallback.
- Process: an unusually honest, detailed build-notes changelog with 40+ self-tracked known limitations.

## Key gaps by category
**Architecture** — not a git repo; one 390KB file, no modules/bundler/package manifest; Leaflet loaded live from cdnjs with no lockfile.

**Data layer** — every one of the 16 WFS layers + Nominatim + Overpass + Open511 + Mapbox + a free third-party CORS proxy (api.allorigins.win, used for bylaw text) is called directly from the browser, no backend, no caching, no rate limiting. Risk of BC's own WFS servers rate-limiting the app under real public traffic. No retry/backoff, no offline cache.

**UI/UX** — only 19 ARIA/alt/role/tabindex attributes total; 17 manually absolute/fixed-positioned elements + 12 explicit z-index values (root cause of a recurring "buttons overlap" bug class, already fixed 3+ separate times); no onboarding; no dark mode; no safe-area-inset handling; no print/export view.

**Mobile/app readiness** — no manifest.json/service worker/icons (not installable); zero Geolocation API usage (no "use my current location" — the single highest-value missing feature); no offline tile caching; markup export is GeoJSON-only (no GPX/KML); no URL deep-linking.

**Security** — Mapbox token shipped as a plaintext placeholder with no referrer restriction; bylaw lookups routed through an uncontrolled third-party CORS proxy; no privacy policy or terms of use.

**Legal/licensing** — a strong, specific disclaimer already exists (not legal advice, non-affiliation, Trespass Act citation). Before public launch: confirm OGL-BC and OSM/ODbL attribution appears everywhere required, re-check Esri/Mapbox/Open511 ToS at real traffic volume, consider a lawyer review of the specific legal claims made.

**Performance** — single unminified ~390KB file parsed on every load; no caching, code-splitting, or lazy-loading.

**Testing** — verification has been ad hoc Playwright scripts per bug fix, never committed or run in CI; no production error monitoring.

**Known, already-tracked data gaps** (no public BC data source found for any of these): road-quality/degradation colour-coding, physical road impasses (washouts/gates), Wildlife Act named local no-shooting areas beyond the highway-corridor list, Crown tenure seasonal closure periods.

## Roadmap (4 phases)

### Phase 1 — Foundation
- [P0] Move the project into git, with real commits going forward
- [P0] Split into an organized source tree with a real build step (Vite/esbuild)
- [P0] Stand up real hosting, a domain, and HTTPS
- [P0] Add a minimal backend to proxy WFS/Nominatim/Overpass/bylaw calls (fixes the CORS-proxy dependency, hides the Mapbox key, unlocks caching/rate-limiting)
- [P1] Restrict the Mapbox token to the domain (or move tiles behind the new backend)
- [P1] Stand up CI: lint, build, and the promoted Playwright suite on every push

### Phase 2 — Public web launch readiness
- [P0] Publish a Privacy Policy and Terms of Use
- [P0] Licensing/attribution pass across every data source (OGL-BC, OSM/ODbL, Esri, Mapbox, Open511)
- [P1] Accessibility audit + fix highest-impact issues (keyboard nav, contrast, ARIA labels)
- [P1] Add response caching + retry/backoff to the data layer
- [P1] Bundle, minify, lazy-load; measure real Lighthouse numbers
- [P1] Add basic error monitoring + uptime checks
- [P2] Cross-browser/cross-device QA pass, especially iOS Safari

### Phase 3 — "Phone application" readiness
- [P0] Ship as an installable PWA (manifest, service worker, icon set, offline app-shell)
- [P0] Add geolocation ("use my current location")
- [P1] Add offline map/tile caching for a saved area
- [P1] Add safe-area-inset handling for notches/home indicators
- [P2] Add URL-based deep linking (?lat=&lng=)
- [P2] Once the PWA is stable, wrap with Capacitor for App Store / Play Store listings

### Phase 4 — Product polish & growth
- [P2] First-run onboarding tour
- [P2] Replace hand-positioned UI with a systematic responsive layout
- [P2] Dark mode
- [P2] GPX/KML export alongside existing GeoJSON export
- [P2] Print/PDF export of a location's report
- [P2] User accounts + cloud sync for personal markup
- [P2] Revisit the 4 open data gaps if a public source ever appears
