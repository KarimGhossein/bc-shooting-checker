// Regression test for v103: "Let's make the header font less fancy and
// more sleep and modern. As well let's make a dark mode and light mode for
// the whole app. Dark mode having the menu background colours the same as
// the header colour right now and light mode having it be that transparent
// white. Se the default to dark mode" (Karim's message verbatim, typos and
// all). See docs/CHANGELOG.md's v103 section for the full writeup.
//
// Two independent changes, both checked here:
//   1) Header font: .tb-title moved off v102's italic Newsreader serif back
//      to the app's own Hanken Grotesk sans, bold, non-italic. Nothing else
//      that uses the .headline serif treatment (modal headings, the verdict
//      headline) changed, that wasn't what was asked.
//   2) Dark/light mode: [data-theme] on <html>, set synchronously in a tiny
//      inline <script> right after <title> (before first paint, avoiding a
//      flash of the wrong theme), defaulting to dark unless a prior visit
//      saved "light" to localStorage. A 2-way segmented toggle (.seg2,
//      mirroring the existing .seg3 basemap picker) in the Tools drawer's
//      new "Appearance" group lets the user switch, persisted the same
//      try/catch-guarded localStorage way every other saved preference in
//      this app already is (My Markup, the bottom panel's resized height,
//      Mapbox usage tracking).
const { chromium } = require('playwright');
const { launchOpts } = require('./launch');
const fs = require('fs');
const path = require('path');
const STUB = fs.readFileSync(__dirname + '/leaflet-stub.js', 'utf8');
const ROOT = path.resolve(__dirname, '..');

async function newPage(browser){
  const page = await browser.newPage({ viewport: { width: 1400, height: 1000 } });
  await page.route('**://cdnjs.cloudflare.com/**leaflet.min.js', route => route.fulfill({ status: 200, contentType: 'application/javascript', body: STUB }));
  await page.route('**://cdnjs.cloudflare.com/**leaflet.draw.js', route => route.fulfill({ status: 200, contentType: 'application/javascript', body: '// stub' }));
  await page.route('**://cdnjs.cloudflare.com/**.css', route => route.fulfill({ status: 200, contentType: 'text/css', body: '/* stub */' }));
  await page.route('**://fonts.googleapis.com/**', route => route.fulfill({ status: 200, contentType: 'text/css', body: '/* stub */' }));
  await page.route('**://fonts.gstatic.com/**', route => route.fulfill({ status: 200, contentType: 'font/woff2', body: Buffer.from('') }));
  return page;
}

(async () => {
  const browser = await chromium.launch(launchOpts());
  const errors = [];

  // ---- Page 1: a completely fresh load, no localStorage at all, must
  // default to dark, with no flash (checked by reading the theme attribute
  // as early as possible, right after the head script runs and before the
  // rest of the page has necessarily finished). ----
  const page1 = await newPage(browser);
  page1.on('console', msg => { if (msg.type() === 'error') errors.push('CONSOLE(p1): ' + msg.text()); });
  page1.on('pageerror', err => errors.push('PAGEERROR(p1): ' + err.message));
  await page1.goto('file://' + path.join(ROOT, 'index.html'), { waitUntil: 'load', timeout: 60000 });
  await page1.waitForTimeout(800);

  const fresh = await page1.evaluate(() => {
    const out = {};
    out.defaultThemeAttr = document.documentElement.dataset.theme;
    const root = getComputedStyle(document.documentElement);
    const val = name => root.getPropertyValue(name).trim();
    out.dark = {
      accent: val('--accent'), red: val('--red'), amber: val('--amber'),
      green: val('--green'), gray: val('--gray'), bg: val('--bg'),
      surface: val('--surface'), ink: val('--ink'), menuBg: val('--menu-bg'),
    };
    // header title font, "less fancy, more sleek and modern"
    const tb = getComputedStyle(document.querySelector('.tb-title'));
    out.tbTitleFont = tb.fontFamily;
    out.tbTitleStyle = tb.fontStyle;
    out.tbTitleWeight = tb.fontWeight;
    // the header's own colour is unchanged, and is exactly what dark mode's
    // --menu-bg is defined to match, compare normalized computed colours
    // (a raw var() text value like "rgba(20,24,22,.72)" and its own
    // normalized computed form like "rgba(20, 24, 22, 0.72)" are the same
    // colour but different strings, so render --menu-bg onto a probe
    // element's background and read ITS computed value instead of
    // string-comparing the custom property's raw text against topBarBg).
    out.topBarBg = getComputedStyle(document.querySelector('.top-bar')).backgroundColor;
    out.menuBgResolved = (() => {
      const probe = document.createElement('div');
      probe.style.background = 'var(--menu-bg)';
      document.body.appendChild(probe);
      const resolved = getComputedStyle(probe).backgroundColor;
      probe.remove();
      return resolved;
    })();

    // Appearance toggle exists, defaults to Dark active, and every element
    // the JS wires up is present
    out.themeToggleExists = !!document.getElementById('themeToggle');
    out.themeThumbExists = !!document.getElementById('themeThumb');
    out.themeInfoBtnExists = !!document.getElementById('settingsDrawer').querySelector('#themeToggle'); // v109: the theme toggle lives in Settings, no separate info button
    const darkBtn = document.querySelector('.seg2-btn[data-theme-choice="dark"]');
    const lightBtn = document.querySelector('.seg2-btn[data-theme-choice="light"]');
    out.darkBtnActiveInitially = !!(darkBtn && darkBtn.classList.contains('active'));
    out.lightBtnNotActiveInitially = !!(lightBtn && !lightBtn.classList.contains('active'));

    // clicking Light actually switches the applied theme and persists it
    lightBtn.click();
    out.afterLightClickAttr = document.documentElement.dataset.theme;
    out.afterLightClickActive = { dark: darkBtn.classList.contains('active'), light: lightBtn.classList.contains('active') };
    let saved = null;
    try{ saved = localStorage.getItem('bcShootingChecker_theme_v1'); }catch(e){ /* ignore */ }
    out.savedAfterClick = saved;

    out.light = {
      accent: val('--accent'), red: val('--red'), amber: val('--amber'),
      green: val('--green'), gray: val('--gray'), bg: val('--bg'),
      surface: val('--surface'), ink: val('--ink'), menuBg: val('--menu-bg'),
    };

    // clicking back to Dark restores the dark tokens
    darkBtn.click();
    out.afterDarkClickAttr = document.documentElement.dataset.theme;

    // functionality untouched by any of this: a drawer still opens
    document.getElementById('toolsDrawerTab').click();
    out.toolsDrawerStillOpens = document.getElementById('toolsDrawer').classList.contains('open');

    return out;
  });

  await page1.close();

  // ---- Page 2: localStorage pre-seeded with a saved "light" choice
  // (simulating a returning visitor), must load straight into light,
  // with no flash, proving the head script actually reads the saved value
  // rather than only ever defaulting. ----
  const page2 = await newPage(browser);
  page2.on('console', msg => { if (msg.type() === 'error') errors.push('CONSOLE(p2): ' + msg.text()); });
  page2.on('pageerror', err => errors.push('PAGEERROR(p2): ' + err.message));
  // Seed localStorage before the page's own scripts run: navigate once to
  // establish the file:// origin, set it, then reload.
  await page2.goto('file://' + path.join(ROOT, 'index.html'), { waitUntil: 'load', timeout: 60000 });
  await page2.evaluate(() => localStorage.setItem('bcShootingChecker_theme_v1', 'light'));
  await page2.reload({ waitUntil: 'load', timeout: 60000 });
  await page2.waitForTimeout(800);
  const returning = await page2.evaluate(() => ({
    themeAttr: document.documentElement.dataset.theme,
    accent: getComputedStyle(document.documentElement).getPropertyValue('--accent').trim(),
    lightBtnActive: document.querySelector('.seg2-btn[data-theme-choice="light"]').classList.contains('active'),
  }));
  await page2.close();

  // ---- disk-level checks ----
  const diskCheck = (() => {
    const html = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
    const styleMatch = html.match(/<style>([\s\S]*)<\/style>/);
    const css = styleMatch ? styleMatch[1] : '';
    return {
      // the theme-detection script must run before the fonts/leaflet links,
      // i.e. immediately after <title>, or it can't beat first paint
      themeScriptBeforeFonts: html.indexOf("document.documentElement.dataset.theme") < html.indexOf('fonts.googleapis.com'),
      darkOverrideExists: /:root\[data-theme="dark"\]\{/.test(css),
      // .headline / modal-head h3 / verdict-title untouched, still serif
      headlineStillNewsreader: /\.headline\{font-family:"Newsreader"/.test(css),
      modalHeadStillNewsreader: /\.modal-head h3\{margin:0;font-family:"Newsreader"/.test(css),
      verdictTitleStillNewsreader: /\.verdict-title\{[^}]*font-family:"Newsreader"/.test(css),
      // .tb-title specifically no longer is
      tbTitleNotNewsreader: /\.top-bar \.tb-title\{font-family:"Hanken Grotesk"/.test(css),
    };
  })();

  const pass = fresh.defaultThemeAttr === 'dark'
    && fresh.tbTitleFont.includes('Hanken Grotesk') && !fresh.tbTitleFont.includes('Newsreader')
    && fresh.tbTitleStyle !== 'italic'
    && Number(fresh.tbTitleWeight) >= 700
    && fresh.themeToggleExists && fresh.themeThumbExists && fresh.themeInfoBtnExists
    && fresh.darkBtnActiveInitially && fresh.lightBtnNotActiveInitially
    && fresh.afterLightClickAttr === 'light'
    && fresh.afterLightClickActive.dark === false && fresh.afterLightClickActive.light === true
    && fresh.savedAfterClick === 'light'
    && fresh.afterDarkClickAttr === 'dark'
    && fresh.toolsDrawerStillOpens === true
    // dark defaults match the app's expected dark palette
    && fresh.dark.accent === '#C9A56B' && fresh.dark.red === '#E0776A' && fresh.dark.amber === '#E0AC5C'
    && fresh.dark.green === '#6FC08A' && fresh.dark.gray === '#ACB2AC' && fresh.dark.bg === '#090C0A'
    && fresh.dark.menuBg === 'rgba(12,15,13,.78)'
    // light values (captured after switching) match the app's light palette
    && fresh.light.accent === '#8A6632' && fresh.light.red === '#B5463B' && fresh.light.bg === '#F6F6F3'
    && fresh.light.menuBg === 'rgba(246,246,243,.72)'
    // dark mode's menu bg literally equals the header's own always-dark bg
    && fresh.menuBgResolved === fresh.topBarBg
    // returning-visitor page (saved "light") loads straight into light
    && returning.themeAttr === 'light' && returning.accent === '#8A6632' && returning.lightBtnActive === true
    && diskCheck.themeScriptBeforeFonts && diskCheck.darkOverrideExists
    && diskCheck.headlineStillNewsreader && diskCheck.modalHeadStillNewsreader && diskCheck.verdictTitleStillNewsreader
    && diskCheck.tbTitleNotNewsreader
    && errors.length === 0;

  console.log('=== errors ===', errors.length ? errors.join('\n') : '(none)');
  console.log('=== fresh ===', JSON.stringify(fresh, null, 2));
  console.log('=== returning ===', JSON.stringify(returning, null, 2));
  console.log('=== diskCheck ===', JSON.stringify(diskCheck, null, 2));
  console.log(pass ? 'PASS' : 'FAIL');
  await browser.close();
  process.exit(pass ? 0 : 1);
})();
