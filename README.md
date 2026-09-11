# BC Shooting Location Checker

A map tool that answers "is it legal to shoot here?" for a picked point in
British Columbia, by merging live queries against BC's open geospatial data
(parcel ownership, Crown tenures, forestry cutblocks, roads, closures,
recreation sites, municipal bylaws, and more) into one plain-language,
colour-coded report.

## Status

This repository was just started (see `docs/audit.md`) as the first step of
turning a single-file prototype into something that can be hosted publicly
and installed as a phone app. The full working app, as it existed before
this migration began, is preserved unmodified at
[`legacy/bc-shooting-check.html`](legacy/bc-shooting-check.html) — that file
is still the source of truth for behaviour while the module split
described in [`docs/PLAN.md`](docs/PLAN.md) is in progress.

## Project history

[`docs/CHANGELOG.md`](docs/CHANGELOG.md) is the full build log carried over
from before version control existed — every version from v1 through v84,
in order, with what changed and why. Worth reading before touching
behaviour that predates this repo.

## Getting started

```bash
npm install
npm run dev      # local dev server
npm run build    # production build
npm test         # run the verification suite
```

## License / data attribution

See the in-app Disclaimers panel and `docs/audit.md` for the current state
of data licensing/attribution — this needs a dedicated pass before public
launch (Open Government Licence – BC, OpenStreetMap ODbL, Esri, Mapbox,
DriveBC Open511 all apply to data this app displays).
