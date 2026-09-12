// Regression test for v93: custom Lucide icons on "My Markup" pins.
// Covers: the MARKUP_ICONS/MARKUP_ICONS_BY_ID data (src/config/icons.js,
// loaded in dependency order alongside constants.js/layers.js), the pin's
// rendered <div>+<svg> markup via markupPinIcon()/markupIconSvg(), the
// editor modal's icon picker (built from data, one "None" button plus one
// per icon grouped by category, hidden entirely for lines/areas since only
// markers render an icon), the save round-trip, and -- most importantly --
// backward/forward compatibility of the additive `icon` GeoJSON property:
// a file exported by any pre-v93 version of this app (no `icon` key at all)
// must still import as a plain, icon-less pin exactly as it did before this
// feature existed, and an unrecognized/foreign icon id must degrade to no
// icon rather than throwing or rendering nothing silently broken.
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

  await page.goto('file://' + path.join(ROOT, 'index.html'), { waitUntil: 'load', timeout: 60000 });
  await page.waitForTimeout(800);

  const results = await page.evaluate(() => {
    const out = {};

    // ---- data shape ----
    out.iconsType = typeof MARKUP_ICONS;
    out.categoryCount = Array.isArray(MARKUP_ICONS) ? MARKUP_ICONS.length : -1;
    const flatIds = Array.isArray(MARKUP_ICONS) ? MARKUP_ICONS.flatMap(c => c.icons.map(i => i.id)) : [];
    out.totalIconCount = flatIds.length;
    out.uniqueIconCount = new Set(flatIds).size;
    out.byIdCount = Object.keys(MARKUP_ICONS_BY_ID || {}).length;
    out.byIdMatchesFlat = flatIds.every(id => MARKUP_ICONS_BY_ID[id] && MARKUP_ICONS_BY_ID[id].id === id);
    out.hasFlame = !!MARKUP_ICONS_BY_ID['flame'];
    out.hasCrosshair = !!MARKUP_ICONS_BY_ID['crosshair'];

    // Script tag order: icons.js must load as an external <script src>,
    // after constants.js/layers.js (icons.js doesn't actually depend on
    // them, but keeping all three config files together in one block is
    // the point), and before the main inline script.
    const scripts = Array.from(document.querySelectorAll('script'));
    const srcs = scripts.map(s => s.getAttribute('src'));
    out.constantsIdx = srcs.indexOf('src/config/constants.js');
    out.layersIdx = srcs.indexOf('src/config/layers.js');
    out.iconsIdx = srcs.indexOf('src/config/icons.js');
    const mainInlineIdx = scripts.findIndex(s => !s.getAttribute('src') && s.textContent.includes('function openCutblockFromList'));
    out.mainInlineIdx = mainInlineIdx;

    // ---- markupIconSvg() / markupPinIcon() ----
    out.svgForUnknown = markupIconSvg('not-a-real-icon');
    const svgForCrosshair = markupIconSvg('crosshair');
    out.svgForCrosshairHasBody = svgForCrosshair.includes(MARKUP_ICONS_BY_ID['crosshair'].body.slice(0, 30));
    out.svgForCrosshairDefaultsWhiteStroke = svgForCrosshair.includes('stroke="#fff"');
    out.svgForCrosshairCustomStroke = markupIconSvg('crosshair', 'currentColor').includes('stroke="currentColor"');
    out.svgForNoIcon = markupIconSvg(null);
    out.svgForNoIconEmpty = out.svgForNoIcon === '';

    // Capture what markupPinIcon() actually hands to L.divIcon -- the
    // network-stubbed L is a generic chainable Proxy whose own `get` trap
    // always returns a fresh chain object regardless of what's assigned
    // onto it directly (`L.divIcon = fn` doesn't stick), so -- same as
    // v89/v91's tests wrapping window.L to capture L.popup() -- wrap the
    // whole global with a Proxy that intercepts just this one property.
    const realL = window.L;
    function withCapturedDivIcon(fn){
      let captured = null;
      window.L = new Proxy(realL, {
        get(t, prop){
          if(prop === 'divIcon') return (opts) => { captured = opts.html; return t.divIcon(opts); };
          return t[prop];
        },
      });
      fn();
      window.L = realL;
      return captured;
    }
    const capturedHtmlWithIcon = withCapturedDivIcon(() => markupPinIcon('#3b6fe0', 'target'));
    const capturedHtmlNoIcon = withCapturedDivIcon(() => markupPinIcon('#3b6fe0', null));
    out.pinWithIconHasSvg = /<svg/.test(capturedHtmlWithIcon || '');
    out.pinWithIconHasColor = (capturedHtmlWithIcon || '').includes('#3b6fe0');
    out.pinNoIconHasNoSvg = !/<svg/.test(capturedHtmlNoIcon || '');

    // ---- addMarkupItem(): icon field, validated ----
    const m1 = addMarkupItem(L.marker([51.5, -122.5]), 'marker', { icon: 'tent' });
    out.item1Icon = m1.icon;
    const m2 = addMarkupItem(L.marker([51.5, -122.5]), 'marker', { icon: 'totally-bogus' });
    out.item2IconFallback = m2.icon; // must degrade to null, not throw or keep the bogus id
    const m3 = addMarkupItem(L.marker([51.5, -122.5]), 'marker', {}); // no icon opt at all -- default behaviour unchanged
    out.item3IconDefault = m3.icon;
    const lineItem = addMarkupItem(L.polyline([[51.5,-122.5],[51.51,-122.51]]), 'polyline', { icon: 'flag' });
    out.lineIconIgnored = lineItem.icon; // lines never render an icon regardless of what's passed

    // ---- export/import round-trip ----
    const feature1 = markupItemToFeature(m1);
    out.exportedIcon = feature1.properties.icon;

    // Backward compatibility: a feature with no `icon` key at all (every
    // file exported before v93) must import as icon:null, exactly like a
    // brand-new plain pin -- not throw, not leave `icon` undefined in a way
    // that later code has to special-case.
    const preV93Feature = {
      type: 'Feature',
      geometry: { type: 'Point', coordinates: [-122.5, 51.5] },
      properties: { id: 'legacy-1', kind: 'marker', name: 'Old pin', notes: '', color: '#e0393e' }
    };
    const beforeCount = markupItems.length;
    loadMarkupFromFeatureCollection({ type: 'FeatureCollection', features: [preV93Feature] });
    const legacyItem = markupItems[markupItems.length - 1];
    out.legacyImportAdded = markupItems.length === beforeCount + 1;
    out.legacyImportIcon = legacyItem.icon;
    out.legacyImportName = legacyItem.name;

    // Forward compatibility: an unrecognized icon id coming from a foreign
    // or corrupted import must degrade the same way addMarkupItem already
    // guards for above, not just when constructed via the JS API directly.
    const foreignFeature = {
      type: 'Feature',
      geometry: { type: 'Point', coordinates: [-122.6, 51.6] },
      properties: { id: 'foreign-1', kind: 'marker', name: 'Foreign pin', notes: '', color: '#2f9e44', icon: 'some-future-icon-v99' }
    };
    loadMarkupFromFeatureCollection({ type: 'FeatureCollection', features: [foreignFeature] });
    const foreignItem = markupItems[markupItems.length - 1];
    out.foreignIconDegraded = foreignItem.icon;

    // ---- editor modal: icon picker built from data ----
    const iconButtons = Array.from(document.querySelectorAll('#markupIconRow .mf-icon-btn'));
    out.pickerButtonCount = iconButtons.length; // 1 "None" + 17 real icons
    out.pickerHasNone = iconButtons.some(b => b.classList.contains('mf-icon-none') && b.dataset.icon === '');
    out.pickerGroupCount = document.querySelectorAll('#markupIconRow .mf-icon-group-label').length;

    // Open editor for a marker with an icon -- picker section visible,
    // correct button pre-selected.
    openMarkupEditor(m1.id);
    out.sectionVisibleForMarker = document.getElementById('markupIconSection').style.display !== 'none';
    const selectedBtn = document.querySelector('#markupIconRow .mf-icon-btn.sel');
    out.preselectedMatchesItem = !!selectedBtn && selectedBtn.dataset.icon === 'tent';

    // Simulate picking a different icon, then Save -- item.icon must update
    // and the marker's rendered icon must be restyled.
    const starBtn = document.querySelector('#markupIconRow .mf-icon-btn[data-icon="star"]');
    starBtn.click();
    const restyleCapturedHtml = withCapturedDivIcon(() => document.getElementById('markupSaveBtn').click());
    out.savedIcon = m1.icon;
    out.restyledPinHasNewIcon = /<svg/.test(restyleCapturedHtml || '');

    // Open editor for a polyline -- icon section must be hidden entirely,
    // since icons never apply to lines/areas.
    openMarkupEditor(lineItem.id);
    out.sectionHiddenForLine = document.getElementById('markupIconSection').style.display === 'none';
    closeMarkupEditor();

    return out;
  });

  const flameBody = fs.readFileSync(path.join(ROOT, 'src/config/icons.js'), 'utf8');
  const iconsFileHasFlame = /id:\s*"flame"/.test(flameBody);

  const pass = results.iconsType === 'object'
    && results.categoryCount === 4
    && results.totalIconCount === 17
    && results.uniqueIconCount === 17
    && results.byIdCount === 17
    && results.byIdMatchesFlat === true
    && results.hasFlame === true
    && results.hasCrosshair === true
    && results.constantsIdx !== -1 && results.layersIdx !== -1 && results.iconsIdx !== -1
    && results.constantsIdx < results.mainInlineIdx
    && results.layersIdx < results.mainInlineIdx
    && results.iconsIdx < results.mainInlineIdx
    && results.svgForUnknown === ''
    && results.svgForCrosshairHasBody === true
    && results.svgForCrosshairDefaultsWhiteStroke === true
    && results.svgForCrosshairCustomStroke === true
    && results.svgForNoIconEmpty === true
    && results.pinWithIconHasSvg === true
    && results.pinWithIconHasColor === true
    && results.pinNoIconHasNoSvg === true
    && results.item1Icon === 'tent'
    && results.item2IconFallback === null
    && results.item3IconDefault === null
    && results.lineIconIgnored === 'flag' // stored, just never rendered -- addMarkupItem doesn't kind-gate storage, styleMarkupLayer does
    && results.exportedIcon === 'tent'
    && results.legacyImportAdded === true
    && results.legacyImportIcon === null
    && results.legacyImportName === 'Old pin'
    && results.foreignIconDegraded === null
    && results.pickerButtonCount === 18
    && results.pickerHasNone === true
    && results.pickerGroupCount === 4
    && results.sectionVisibleForMarker === true
    && results.preselectedMatchesItem === true
    && results.savedIcon === 'star'
    && results.restyledPinHasNewIcon === true
    && results.sectionHiddenForLine === true
    && iconsFileHasFlame
    && errors.length === 0;

  console.log('=== errors ===', errors.length ? errors.join('\n') : '(none)');
  console.log('=== RESULTS ===', JSON.stringify(results, null, 2));
  console.log(pass ? 'PASS' : 'FAIL');
  await browser.close();
  process.exit(pass ? 0 : 1);
})();
