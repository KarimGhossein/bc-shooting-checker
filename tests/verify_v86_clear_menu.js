// Regression test for the v86 change: "Clear All" and the separate "Clear
// Potential Spots" shortcut were replaced with a single "Clear" dropdown
// listing one clear action per category (View Parcels, Shooting Spots,
// Reveal Road, Selected Location) -- each clearing only its own layer/
// currentClickableFeatures entries and leaving the other categories (and
// always "My markup") untouched. See docs/CHANGELOG.md's v86 section.
const { chromium } = require('playwright');
const { launchOpts } = require('./launch');
const fs = require('fs');
const path = require('path');
const STUB = fs.readFileSync(__dirname + '/leaflet-stub.js', 'utf8');

(async () => {
  const browser = await chromium.launch(launchOpts());
  const page = await browser.newPage({ viewport: { width: 1400, height: 1000 } });
  const errors = [];
  page.on('console', msg => { if (msg.type() === 'error') errors.push('CONSOLE: ' + msg.text()); });
  page.on('pageerror', err => errors.push('PAGEERROR: ' + err.message));

  await page.route('**://cdnjs.cloudflare.com/**leaflet.min.js', route => route.fulfill({ status: 200, contentType: 'application/javascript', body: STUB }));
  await page.route('**://cdnjs.cloudflare.com/**leaflet.draw.js', route => route.fulfill({ status: 200, contentType: 'application/javascript', body: '// stub' }));
  await page.route('**://cdnjs.cloudflare.com/**.css', route => route.fulfill({ status: 200, contentType: 'text/css', body: '/* stub */' }));
  await page.route('**://fonts.googleapis.com/**', route => route.fulfill({ status: 200, contentType: 'text/css', body: '/* stub */' }));

  await page.goto('file://' + path.resolve(__dirname, '../index.html'), { waitUntil: 'load', timeout: 60000 });
  await page.waitForTimeout(800);

  const results = await page.evaluate(() => {
    const out = {};

    // The old single-purpose buttons are gone; the new dropdown trigger +
    // menu + one item per category exist instead.
    out.oldButtonsGone = !document.getElementById('clearAllBtn') && !document.getElementById('clearSpotsBtn') && !document.getElementById('clearAllInfoBtn');
    out.menuTriggerExists = !!document.getElementById('clearMenuBtn');
    out.menuStartsHidden = document.getElementById('clearMenu').hidden === true;
    out.allFourItemsExist = !!document.getElementById('clearParcelsBtn') && !!document.getElementById('clearSpotsMenuBtn') && !!document.getElementById('clearRoadMenuBtn') && !!document.getElementById('clearLocationBtn');

    // Menu opens on trigger click and closes again on a click outside it.
    document.getElementById('clearMenuBtn').click();
    out.opensOnClick = document.getElementById('clearMenu').hidden === false;
    document.body.click();
    out.closesOnOutsideClick = document.getElementById('clearMenu').hidden === true;

    // Fake a selected-location state, some markup, and state in all three
    // reveal layers, then confirm each clear function touches only its own
    // category and leaves the rest (including markup) untouched.
    setMarker(51.5, -122.5);
    document.getElementById('report').innerHTML = '<div class="card">fake report</div>';
    document.getElementById('bottomPanelSummary').innerHTML = '<span class="bp-dot green"></span> Clear';
    document.getElementById('bottomPanel').classList.add('open');
    setSearchStatus('Last checked: 51.50000, -122.50000');
    resetClickableSource('overlay');
    pushClickable({type:'Point',coordinates:[-122.5,51.5]}, 'x', 'x', 'x', 'x');
    resetClickableSource('parcelview');
    pushClickable({type:'Point',coordinates:[-122.5,51.5]}, 'x', 'x', 'x', 'x');
    resetClickableSource('roadview');
    pushClickable({type:'Point',coordinates:[-122.5,51.5]}, 'x', 'x', 'x', 'x');
    resetClickableSource('spots');
    pushClickable({type:'Point',coordinates:[-122.5,51.5]}, 'x', 'x', 'x', 'x');
    currentNearbyMatches.push({icon:'x'});
    currentCutOpenings.push({openingId:1});
    parcelViewFeatures.push({properties:{OWNER_TYPE:'Private'}, geometry:{type:'Polygon', coordinates:[[[0,0],[1,0],[1,1],[0,0]]]}});
    L.geoJSON({type:'Point',coordinates:[-122.5,51.5]}).addTo(parcelViewLayer);
    L.geoJSON({type:'Point',coordinates:[-122.5,51.5]}).addTo(roadViewLayer);
    L.geoJSON({type:'Point',coordinates:[-122.5,51.5]}).addTo(spotLayer);
    L.geoJSON({type:'Point',coordinates:[-122.5,51.5]}).addTo(overlayLayer);
    const markupBefore = typeof markupItems !== 'undefined' ? JSON.parse(JSON.stringify(markupItems)) : null;

    // Clearing View Parcels only drops its own layer/features/chooser entries.
    clearViewParcels();
    out.parcelsCleared = parcelViewFeatures.length === 0 && currentClickableFeatures.filter(e => e.source === 'parcelview').length === 0;
    out.parcelsClearLeftOthers = currentClickableFeatures.filter(e => e.source === 'roadview').length === 1 && currentClickableFeatures.filter(e => e.source === 'spots').length === 1 && currentClickableFeatures.filter(e => e.source === 'overlay').length === 1;

    // Clearing Reveal Road only drops its own entries.
    clearRevealRoad();
    out.roadClearedLeftOthers = currentClickableFeatures.filter(e => e.source === 'roadview').length === 0 && currentClickableFeatures.filter(e => e.source === 'spots').length === 1 && currentClickableFeatures.filter(e => e.source === 'overlay').length === 1;

    // Clearing Shooting Spots only drops its own entries.
    clearPotentialSpots();
    out.spotsClearedLeftOthers = currentClickableFeatures.filter(e => e.source === 'spots').length === 0 && currentClickableFeatures.filter(e => e.source === 'overlay').length === 1;

    // Clearing the selected location resets the pin/report/status and drops
    // the last remaining ('overlay') chooser entries.
    clearSelectedLocation();
    out.markerIsNull = marker === null;
    out.reportIsPlaceholder = document.getElementById('report').innerHTML.includes('Pick a location');
    out.bottomPanelClosed = !document.getElementById('bottomPanel').classList.contains('open');
    out.summaryReset = document.getElementById('bottomPanelSummary').textContent.includes('Pick a location');
    out.searchStatusReset = document.getElementById('searchStatus').textContent === 'No location selected yet.';
    out.allChooserEntriesGone = currentClickableFeatures.length === 0;
    out.nearbyMatchesCleared = currentNearbyMatches.length === 0;
    out.cutOpeningsCleared = currentCutOpenings.length === 0;

    // Markup was never in scope for any of the four calls above.
    out.markupUntouched = markupBefore !== null ? JSON.stringify(markupBefore) === JSON.stringify(markupItems) : 'n/a (markupItems not found)';

    return out;
  });

  const pass = results.oldButtonsGone && results.menuTriggerExists && results.menuStartsHidden
    && results.allFourItemsExist && results.opensOnClick && results.closesOnOutsideClick
    && results.parcelsCleared && results.parcelsClearLeftOthers && results.roadClearedLeftOthers
    && results.spotsClearedLeftOthers && results.markerIsNull && results.reportIsPlaceholder
    && results.bottomPanelClosed && results.summaryReset && results.searchStatusReset
    && results.allChooserEntriesGone && results.nearbyMatchesCleared && results.cutOpeningsCleared
    && (results.markupUntouched === true || results.markupUntouched === 'n/a (markupItems not found)')
    && errors.length === 0;

  console.log('=== errors ===', errors.length ? errors.join('\n') : '(none)');
  console.log('=== RESULTS ===', JSON.stringify(results, null, 2));
  console.log(pass ? 'PASS' : 'FAIL');
  await browser.close();
  process.exit(pass ? 0 : 1);
})();
