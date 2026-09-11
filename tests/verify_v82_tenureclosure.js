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

  // tenurePopup(): a heli-ski (recreation-ish) purpose should get the "often carries one" wording
  results.popupHeliSki = await page.evaluate(() => {
    const html = tenurePopup({ TENURE_PURPOSE: 'Commercial Recreation', TENURE_SUBPURPOSE: 'Heli-Skiing', TENURE_TYPE: 'Licence', TENURE_STAGE: 'Tenure', TENURE_STATUS: 'Active', CROWN_LANDS_FILE: '1234567' });
    return { hasNoFieldNote: html.includes('no field for a seasonal closure'), hasLikelyNote: html.includes('often carries one') };
  });

  // tenurePopup(): a purpose unlikely to carry a season (e.g. Communication) should NOT get the "often carries one" line
  results.popupCommunication = await page.evaluate(() => {
    const html = tenurePopup({ TENURE_PURPOSE: 'Communication', TENURE_TYPE: 'Licence', TENURE_STAGE: 'Tenure', TENURE_STATUS: 'Active', CROWN_LANDS_FILE: '7654321' });
    return { hasNoFieldNote: html.includes('no field for a seasonal closure'), hasLikelyNote: html.includes('often carries one') };
  });

  // renderReport(): tenure card should surface the caveat, and flag the amber "likely seasonal" reason when a recreation/ski purpose is present.
  results.reportCard = await page.evaluate(() => {
    const okEmpty = { ok: true, features: [] };
    renderReport({
      lat: 51.5, lng: -122.5,
      parcelR: okEmpty, muniR: okEmpty, parkR: okEmpty,
      cutR: okEmpty, cutPlanR: okEmpty, cutList: [],
      tenureR: { ok: true, features: [{ properties: { TENURE_PURPOSE: 'Commercial Recreation', TENURE_SUBPURPOSE: 'Heli-Skiing', TENURE_STATUS: 'Active', TENURE_STAGE: 'Tenure' } }] },
      woodlotR: okEmpty, roadR: okEmpty, open511R: { ok: true, events: [] },
      nearbyParcelR: okEmpty, recSiteR: okEmpty, recPolyR: okEmpty, recLineR: okEmpty, recList: [],
      mvprRoutesR: okEmpty, mvprAreasR: okEmpty, mvprList: [], wmaR: okEmpty,
    });
    const tenureCard = Array.from(document.querySelectorAll('.card')).find(c => c.querySelector('.card-title')?.textContent.includes('Crown land tenures'));
    return {
      cardHasCaveat: tenureCard ? tenureCard.textContent.includes('no seasonal closure/operating-period field') : null,
      cardHasSeasonalFlag: tenureCard ? tenureCard.textContent.includes('often carries its own seasonal closure') : null,
    };
  });

  console.log('=== errors ===', errors.length ? errors.join('\n') : '(none)');
  console.log('=== RESULTS ===', JSON.stringify(results, null, 2));
  await browser.close();
})();
