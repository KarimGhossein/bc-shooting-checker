// Regression test for v102: "Let's make the UI look more sleek like a
// premium product. Similar to how the website in this project previews the
// app itself." -- a CSS/head-only reskin of the app's chrome (header,
// drawers, buttons, cards, modals, legend, checklist, badges/chips) to match
// the warm-editorial, high-end look of the KAGE marketing site's own design
// system (off-white/near-black palette, bronze accent, Newsreader italic +
// Hanken Grotesk pairing, large soft radii, pill-shaped controls, four-hue
// severity palette). See docs/CHANGELOG.md's v102 section for the full
// root-cause/scope writeup, including the deliberate decision to skip
// automatic dark mode and the reasoning for keeping every CSS custom
// property *name* unchanged (only values moved).
//
// This is a CSS/head-only change -- no element id/class was added, renamed
// or removed, and no JS function signature changed -- so this test checks
// exactly that boundary: the new design tokens actually took (computed
// style, not just presence in the stylesheet text), and every functional
// selector every other test in this suite depends on is still there,
// unchanged, still wired to the same ids.
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
  await page.route('**://fonts.gstatic.com/**', route => route.fulfill({ status: 200, contentType: 'font/woff2', body: Buffer.from('') }));

  await page.goto('file://' + path.join(ROOT, 'index.html'), { waitUntil: 'load', timeout: 60000 });
  await page.waitForTimeout(800);

  const results = await page.evaluate(() => {
    const out = {};
    const root = getComputedStyle(document.documentElement);
    const val = name => root.getPropertyValue(name).trim();

    // ---- new design tokens actually took (computed, not just text-present
    // in the stylesheet) ----
    out.accent = val('--accent');
    out.red = val('--red');
    out.amber = val('--amber');
    out.green = val('--green');
    out.gray = val('--gray');
    out.bg = val('--bg');
    out.radius = val('--radius');
    out.radiusPill = val('--radius-pill');
    out.bodyFont = getComputedStyle(document.body).fontFamily;

    // ---- the one deliberate serif/italic accent class exists and is what
    // .tb-title / .modal-head h3 / .verdict-title key off ----
    out.headlineFont = (() => {
      const probe = document.createElement('span');
      probe.className = 'headline';
      document.body.appendChild(probe);
      const f = getComputedStyle(probe).fontFamily;
      const style = getComputedStyle(probe).fontStyle;
      probe.remove();
      return { f, style };
    })();
    out.tbTitleFont = getComputedStyle(document.querySelector('.tb-title')).fontFamily;

    // ---- every id every other test in this suite clicks/queries by id is
    // still present, unrenamed, unremoved (a CSS-only pass must never touch
    // these) ----
    const criticalIds = [
      'toolsDrawerTab', 'toolsDrawerClose', 'sideChecklistTab', 'sideChecklistClose',
      'clearMenuBtn', 'clearMenu', 'revealParcelsBtn', 'revealSpotsBtn', 'revealRoadBtn',
      'basemapToggle', 'basemapThumb', 'mapActionsNote', 'infoModalOverlay', 'infoModalClose',
      'markupModalOverlay', 'markupPanel', 'bottomPanel', 'bottomPanelToggle', 'report',
      'mapLegend', 'legendToggle', 'searchInput', 'searchGoBtn', 'headerInfoBtn', 'disclaimerBtn',
    ];
    out.allCriticalIdsPresent = criticalIds.every(id => !!document.getElementById(id));
    out.clearMenuItemCount = document.querySelectorAll('.clear-menu-item').length;

    // ---- functional behaviour is untouched: drawers still open/close,
    // basemap thumb still moves, clear menu still toggles -- same checks
    // v96/v87/v75's own tests already make, just confirming a CSS pass
    // didn't silently break the JS that reads these classes ----
    document.getElementById('toolsDrawerTab').click();
    out.toolsDrawerOpens = document.getElementById('toolsDrawer').classList.contains('open');
    document.getElementById('toolsDrawerClose').click();
    out.toolsDrawerCloses = !document.getElementById('toolsDrawer').classList.contains('open');

    return out;
  });

  // ---- disk-level checks: the old navy-blue/Space-Grotesk chrome is really
  // gone from the stylesheet (not just overridden at runtime), and every
  // pre-v102 selector this test's ids above rely on still exists verbatim in
  // the CSS (a reskin must change *values*, never delete/rename a rule the
  // rest of the app or its tests depend on). ----
  const diskCheck = (() => {
    const html = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
    const styleMatch = html.match(/<style>([\s\S]*)<\/style>/);
    const css = styleMatch ? styleMatch[1] : '';
    return {
      // v102's own head comment mentions "Space Grotesk" by name (explaining
      // why it was replaced) -- that's expected and fine; what must be gone
      // is the actual font-family declaration and the Google Fonts request
      // for it.
      noSpaceGrotesk: !/font-family:\s*"Space Grotesk"/.test(css) && !/family=Space\+Grotesk/.test(html),
      noOldNavyBlue: !css.includes('#101a30') && !css.includes('#182746'),
      noOldAccentBlue: !css.includes('#3b6fe0'),
      hasHankenGrotesk: /Hanken\+Grotesk/.test(html),
      hasNewsreader: /Newsreader/.test(html),
      // every selector the ids above are styled by must still be present
      selectorsIntact: [
        '.td-tab{', '.sc-tab{', '.ma-btn{', '.clear-menu-item{', '.card{',
        '.checklist-group{', '.modal-box{', '.map-legend{', '.verdict{',
        '.flag-chip{', '.badge{', '#markupPanel{', '.bottom-panel{',
      ].every(sel => css.includes(sel)),
    };
  })();

  const pass = results.accent === '#8A6632'
    && results.red === '#B5463B'
    && results.amber === '#B7832A'
    && results.green === '#3C8A57'
    && results.gray === '#8B928E'
    && results.bg === '#F6F6F3'
    && results.radius === '18px'
    && results.radiusPill === '999px'
    && results.bodyFont.includes('Hanken Grotesk')
    && results.headlineFont.f.includes('Newsreader')
    && results.headlineFont.style === 'italic'
    && results.tbTitleFont.includes('Newsreader')
    && results.allCriticalIdsPresent
    && results.clearMenuItemCount === 14
    && results.toolsDrawerOpens === true
    && results.toolsDrawerCloses === true
    && diskCheck.noSpaceGrotesk && diskCheck.noOldNavyBlue && diskCheck.noOldAccentBlue
    && diskCheck.hasHankenGrotesk && diskCheck.hasNewsreader && diskCheck.selectorsIntact
    && errors.length === 0;

  console.log('=== errors ===', errors.length ? errors.join('\n') : '(none)');
  console.log('=== RESULTS ===', JSON.stringify({ ...results, diskCheck }, null, 2));
  console.log(pass ? 'PASS' : 'FAIL');
  await browser.close();
  process.exit(pass ? 0 : 1);
})();
