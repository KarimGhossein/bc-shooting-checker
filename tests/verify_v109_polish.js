// Regression test for v109, the end-user polish pass (see docs/CHANGELOG.md):
//   - right dock: Checklist, Tools and a gear-only Settings tab; tabs stay
//     visible beside the open panel; clicking the open tab closes it;
//     Appearance lives in Settings, not Tools; "Layer Functions" label;
//   - pin button toggles "placing" mode, a map click places the pin and ends it;
//   - Cancel beside the progress bar drops the running spots search;
//   - no search-bar "i", a single map-key "i" listing every row's meaning;
//   - wordmark links home; splash overlay fades and removes itself;
//   - finished report: no duplicated verdict headline, checklist opens,
//     Management unit and Buildings cards present, MU links to the right
//     regional Synopsis PDF (7A/7B split handled);
//   - no emoji and no em dashes in any user-facing source file.
const { chromium } = require('playwright');
const { launchOpts } = require('./launch');
const fs = require('fs');
const path = require('path');
const STUB = fs.readFileSync(__dirname + '/leaflet-stub.js', 'utf8');
const ROOT = path.resolve(__dirname, '..');

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
  await page.route('**://{unpkg.com,cdn.jsdelivr.net}/**', route => route.fulfill({ status: 200, contentType: 'application/javascript', body: '// stub' }));

  await page.goto('file://' + path.join(ROOT, 'index.html'), { waitUntil: 'load', timeout: 60000 });
  const splashAtLoad = await page.evaluate(() => !!document.getElementById('kageSplash'));
  await page.waitForTimeout(3000);

  const r = await page.evaluate(async () => {
    const out = {};
    const $ = id => document.getElementById(id);
    out.splashGone = !$('kageSplash');
    out.brandHref = document.querySelector('a.tb-brand').getAttribute('href');
    out.noCoordInfo = !$('coordInfoBtn');
    out.legendInfoCount = document.querySelectorAll('#mapLegend .info-btn').length;
    // dock
    const tabs = Array.from(document.querySelectorAll('.rd-tabs .rd-tab')).map(t => t.id);
    out.tabs = tabs;
    out.gearOnly = $('settingsDrawerTab').textContent.trim() === '' && !!$('settingsDrawerTab').querySelector('svg');
    out.themeInSettings = !!$('settingsDrawer').querySelector('#themeToggle') && !$('toolsDrawer').querySelector('#themeToggle');
    out.layerFunctionsLabel = Array.from(document.querySelectorAll('#toolsDrawer .rd-label')).some(l => l.textContent.trim().startsWith('Layer Functions'));
    $('sideChecklistTab').click();
    await new Promise(r => setTimeout(r, 300));
    const tabR = $('toolsDrawerTab').getBoundingClientRect();
    const panelR = document.querySelector('#sideChecklist .sc-panel').getBoundingClientRect();
    out.tabsBesidePanel = tabR.width > 0 && tabR.right <= panelR.left + 1 && panelR.width > 300;
    out.drawerW = getComputedStyle(document.documentElement).getPropertyValue('--right-drawer-w').trim();
    $('sideChecklistTab').click();
    out.tabToggleCloses = !$('sideChecklist').classList.contains('open');
    $('settingsDrawerTab').click();
    out.settingsOpens = $('settingsDrawer').classList.contains('open') && $('settingsDrawerTab').classList.contains('active');
    closeRightPanels();
    // pin toggle
    $('dragPinBtn').click();
    out.pinArmed = pinPlacing === true && $('map').classList.contains('kage-placing') && $('dragPinBtn').getAttribute('aria-pressed') === 'true';
    $('dragPinBtn').click();
    out.pinDisarmed = pinPlacing === false && !$('map').classList.contains('kage-placing');
    // cancel
    const before = spotSeq;
    startSpotsProgress();
    $('spotsCancelBtn').click();
    out.cancelBumpsSeq = spotSeq === before + 1 && $('spotsProgress').hidden === true && /cancelled/i.test($('mapActionsNote').textContent);
    // legend meanings
    out.legendMeaningRows = (legendMeaningsHtml().match(/km-row/g) || []).length;
    out.legendRows = document.querySelectorAll('#legendBody .lg-row').length;
    out.everyRowHasMeaning = Array.from(document.querySelectorAll('#legendBody .lg-row')).every(r => !!LEGEND_MEANINGS[r.dataset.k]);
    // synopsis
    out.regions = {
      a: synopsisRegionsForUnit('7-15', ''), b: synopsisRegionsForUnit('7-40', ''), c: synopsisRegionsForUnit('3-17', ''),
      d: synopsisRegionsForUnit('7-99', 'Peace'), e: synopsisRegionsForUnit('', '')
    };
    out.expiredNow = synopsisExpired();
    out.expiredAfter = synopsisExpired(new Date('2028-07-02T12:00:00Z'));
    out.aboutMentionsSources = /ParcelMap BC/.test(aboutHtml()) && /2026-2028/.test(aboutHtml());
    // report
    const okEmpty = { ok: true, features: [] };
    const muR = { ok: true, features: [{ properties: { WILDLIFE_MGMT_UNIT_ID: '2-8', REGION_RESPONSIBLE_NAME: 'Lower Mainland' }, geometry: { type: 'Polygon', coordinates: [[[-122, 49], [-121, 49], [-121, 50], [-122, 49]]] } }] };
    renderReport({ lat: 49.5, lng: -121.5, parcelR: okEmpty, muniR: okEmpty, parkR: okEmpty, cutR: okEmpty, cutPlanR: okEmpty, cutList: [],
      tenureR: okEmpty, woodlotR: okEmpty, roadR: okEmpty, open511R: { ok: true, events: [] }, nearbyParcelR: okEmpty,
      recSiteR: okEmpty, recPolyR: okEmpty, recLineR: okEmpty, recList: [], mvprRoutesR: okEmpty, mvprAreasR: okEmpty, mvprList: [], wmaR: okEmpty, muR });
    out.noVerdictTitle = !document.querySelector('#report .verdict-title');
    out.checklistOpened = $('sideChecklist').classList.contains('open');
    const mu = $('card-mu');
    out.muCard = !!mu && /MU 2-8/.test(mu.textContent) && !!mu.querySelector('a[href$="region-2-lower-mainland.pdf"]');
    const b = $('card-buildings');
    out.buildingsCard = !!b && /100/.test(b.textContent) && /s\.\s*86/.test(b.textContent) && /regional district parks/.test(b.textContent);
    out.muChecklistDone = !!document.querySelector('.ci-jump[data-jump="mu"]');
    return out;
  });

  // Source-level: no emoji or em dashes anywhere a user can see.
  const files = ['index.html', 'src/config/constants.js', 'src/config/layers.js', 'src/config/mapstyle.js', 'src/data/wfs.js', 'src/map/chooser.js', 'src/map/render.js'];
  const EMOJI = /[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}\u{2B00}-\u{2BFF}]/u;
  const offenders = [];
  for (const f of files) {
    const txt = fs.readFileSync(path.join(ROOT, f), 'utf8');
    txt.split('\n').forEach((line, i) => { if (line.includes('\u2014') || EMOJI.test(line)) offenders.push(`${f}:${i + 1}`); });
  }

  const pass = splashAtLoad && r.splashGone && /^https?:\/\//.test(r.brandHref) && r.noCoordInfo && r.legendInfoCount === 1
    && JSON.stringify(r.tabs) === JSON.stringify(['sideChecklistTab', 'toolsDrawerTab', 'settingsDrawerTab'])
    && r.gearOnly && r.themeInSettings && r.layerFunctionsLabel
    && r.tabsBesidePanel && r.drawerW === '360px' && r.tabToggleCloses && r.settingsOpens
    && r.pinArmed && r.pinDisarmed && r.cancelBumpsSeq
    && r.legendMeaningRows === r.legendRows && r.everyRowHasMeaning
    && JSON.stringify(r.regions) === JSON.stringify({ a: ['7A'], b: ['7B'], c: ['3'], d: ['7B'], e: [] })
    && r.expiredAfter === true && r.aboutMentionsSources
    && r.noVerdictTitle && r.checklistOpened && r.muCard && r.buildingsCard && r.muChecklistDone
    && offenders.length === 0
    && errors.length === 0;

  console.log('=== errors ===', errors.length ? errors.join('\n') : '(none)');
  console.log('=== RESULTS ===', JSON.stringify({ splashAtLoad, ...r, offenders: offenders.slice(0, 20) }, null, 2));
  console.log(pass ? 'PASS' : 'FAIL');
  await browser.close();
  process.exit(pass ? 0 : 1);
})();
