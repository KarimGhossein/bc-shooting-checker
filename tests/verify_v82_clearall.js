const { chromium } = require('playwright');
const { launchOpts } = require('./launch');
const fs = require('fs');
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

  await page.goto('file://' + require('path').resolve(__dirname, '../index.html'), { waitUntil: 'load', timeout: 60000 });
  await page.waitForTimeout(800);

  const results = {};

  results.buttonExists = await page.evaluate(() => ({
    hasBtn: !!document.getElementById('clearAllBtn'),
    hasInfoBtn: !!document.getElementById('clearAllInfoBtn'),
  }));

  // Simulate a "selected location" state (mimicking what runLookup() sets up),
  // some markup, and some reveal-layer state, then run Clear All and confirm
  // the reveal/selection state resets but markup survives untouched.
  results.clearAllRun = await page.evaluate(() => {
    // Fake a selected-location state.
    setMarker(51.5, -122.5);
    document.getElementById('report').innerHTML = '<div class="card">fake report</div>';
    document.getElementById('bottomPanelSummary').innerHTML = '<span class="bp-dot green"></span> Clear';
    document.getElementById('bottomPanel').classList.add('open');
    setSearchStatus('Last checked: 51.50000, -122.50000');
    currentClickableFeatures.push({geometry:{type:'Point',coordinates:[-122.5,51.5]}, icon:'x', rowLabel:'x', title:'x', html:'x'});
    currentNearbyMatches.push({icon:'x'});
    currentCutOpenings.push({openingId:1});

    // Fake reveal-layer state.
    parcelViewFeatures.push({properties:{OWNER_TYPE:'Private'}, geometry:{type:'Polygon', coordinates:[[[0,0],[1,0],[1,1],[0,0]]]}});
    L.geoJSON({type:'Point',coordinates:[-122.5,51.5]}).addTo(parcelViewLayer);
    L.geoJSON({type:'Point',coordinates:[-122.5,51.5]}).addTo(roadViewLayer);
    L.geoJSON({type:'Point',coordinates:[-122.5,51.5]}).addTo(spotLayer);
    document.getElementById('clearSpotsBtn').hidden = false;

    // Fake markup state (should NOT be touched).
    const markupBefore = typeof markupItems !== 'undefined' ? JSON.parse(JSON.stringify(markupItems)) : null;

    clearAllTemporary();

    return {
      markerIsNull: marker === null,
      reportIsPlaceholder: document.getElementById('report').innerHTML.includes('Pick a location'),
      bottomPanelClosed: !document.getElementById('bottomPanel').classList.contains('open'),
      summaryReset: document.getElementById('bottomPanelSummary').textContent.includes('Pick a location'),
      searchStatusReset: document.getElementById('searchStatus').textContent === 'No location selected yet.',
      clickableFeaturesCleared: currentClickableFeatures.length === 0,
      nearbyMatchesCleared: currentNearbyMatches.length === 0,
      cutOpeningsCleared: currentCutOpenings.length === 0,
      clearSpotsBtnHiddenAgain: document.getElementById('clearSpotsBtn').hidden === true,
      note: document.getElementById('mapActionsNote').textContent,
      markupUntouched: markupBefore !== null ? JSON.stringify(markupBefore) === JSON.stringify(markupItems) : 'n/a (markupItems not found)',
    };
  });

  console.log('=== errors ===', errors.length ? errors.join('\n') : '(none)');
  console.log('=== RESULTS ===', JSON.stringify(results, null, 2));
  await browser.close();
})();
