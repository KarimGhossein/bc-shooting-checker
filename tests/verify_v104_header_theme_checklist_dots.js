// Regression test for v104, four quick follow-ups Karim sent right after
// v103 shipped, all addressed in the same pass (see docs/CHANGELOG.md's v104
// section for the full writeup):
//   1) "The header should also change with light mode", v103 shipped with
//      the header deliberately staying constant dark glass in both themes
//      (a scope call documented at the time). Karim corrected that: the
//      header now uses the same --menu-bg/var(--ink) tokens every other
//      panel does, and its "on-chrome" child controls (icon buttons, the
//      search box, the Potential Spots progress bar) moved off hardcoded
//      white onto new theme-aware --chrome-chip-* tokens, so they stay
//      legible in both themes instead of just dark.
//   2) "Change the name in the header to 'Shooting Map' and remove the
//      emoji", .tb-title's text and its leading target-emoji <span>.
//   3) "The background colour of the items in the checklist in dark mode
//      should be darker also instead of incomplete lets just put a coloured
//      dot beside the items corresponding to their completion status like
//      how the preview on the KAGE website has it", two changes: the
//      checklist card's own background (--checklist-card-bg) is now
//      theme-aware and darker in dark mode instead of staying a hardcoded
//      translucent white; and every checklist item's "Done"/"Incomplete"/
//      "MANUAL" text pill is now a small coloured dot (.ci-dot), matching
//      the small circular status marker the KAGE site's own map-page
//      preview uses in its report-card rows.
//   4) "remove the check mark emoji from the checklist", the "Full
//      checklist" drawer heading's leading .
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
  const page = await newPage(browser);
  page.on('console', msg => { if (msg.type() === 'error') errors.push('CONSOLE: ' + msg.text()); });
  page.on('pageerror', err => errors.push('PAGEERROR: ' + err.message));

  await page.goto('file://' + path.join(ROOT, 'index.html'), { waitUntil: 'load', timeout: 60000 });
  await page.waitForTimeout(800);

  const probe = (cssValueExpr) => `(() => { const p = document.createElement('div'); p.style.background = ${cssValueExpr}; document.body.appendChild(p); const v = getComputedStyle(p).backgroundColor; p.remove(); return v; })()`;

  const dark = await page.evaluate(() => {
    const out = {};
    out.themeAttr = document.documentElement.dataset.theme;

    // ---- header title: renamed, no emoji ----
    const tbTitle = document.querySelector('.top-bar .tb-title');
    out.tbTitleText = tbTitle.textContent.replace(/\s+/g, ' ').trim();
    out.tbTitleHasTargetEmoji = tbTitle.innerHTML.includes('\u{1F3AF}');
    out.tbTitleIconSpanExists = !!tbTitle.querySelector('.icon');

    // ---- header now flips with theme: its background literally equals
    // --menu-bg (not a separate hardcoded value anymore) ----
    const probeMenuBg = document.createElement('div');
    probeMenuBg.style.background = 'var(--menu-bg)';
    document.body.appendChild(probeMenuBg);
    const menuBgResolved = getComputedStyle(probeMenuBg).backgroundColor;
    probeMenuBg.remove();
    out.topBarBg = getComputedStyle(document.querySelector('.top-bar')).backgroundColor;
    out.menuBgResolved = menuBgResolved;
    out.topBarColor = getComputedStyle(document.querySelector('.top-bar')).color;
    const probeInk = document.createElement('div');
    probeInk.style.color = 'var(--ink)';
    document.body.appendChild(probeInk);
    const inkResolved = getComputedStyle(probeInk).color;
    probeInk.remove();
    out.inkResolved = inkResolved;

    // dark mode must still look exactly like it did before this pass (the
    // whole point of --menu-bg's dark value already equalling the old
    // hardcoded header rgba), confirm the literal pixel value too.
    out.topBarBgRaw = out.topBarBg;

    // ---- checklist: no more .tag elements anywhere, .ci-dot in their place ----
    out.tagElementCount = document.querySelectorAll('.checklist-item .tag').length;
    out.checklistHeadingText = document.querySelector('.side-checklist .rd-head h2').textContent.replace(/\s+/g, ' ').trim();
    out.checklistHeadingHasCheckEmoji = /[\u2600-\u27BF\u{1F300}-\u{1FAFF}]/u.test(document.querySelector('.side-checklist .rd-head h2').innerHTML);

    return out;
  });

  // render checklist items for a location so both auto (done/incomplete) and
  // manual dots are all present and inspectable, then reopen the drawer
  await page.evaluate(() => {
    if (typeof renderChecklist === 'function') { try { renderChecklist({}); } catch(e) {} }
  });
  await page.evaluate(() => document.getElementById('sideChecklistTab').click());
  await page.waitForTimeout(300);

  const dots = await page.evaluate(() => {
    const out = {};
    const dotEls = Array.from(document.querySelectorAll('.checklist-item .ci-dot'));
    out.dotCount = dotEls.length;
    out.dotClasses = dotEls.map(d => d.className);
    out.hasDoneOrIncomplete = dotEls.some(d => d.classList.contains('ci-dot-done') || d.classList.contains('ci-dot-incomplete'));
    out.hasManual = document.querySelectorAll('.checklist-item .ci-check').length > 0; // v109: manual items use a tick box instead of a dot

    // dark-mode checklist card background is genuinely different (darker)
    // from the drawer panel's own background, not the old hardcoded
    // translucent white
    const group = document.querySelector('.side-checklist .checklist-group');
    out.checklistCardBg = getComputedStyle(group).backgroundColor;
    return out;
  });

  // ---- now switch to light and confirm both the header and the checklist
  // card follow it ----
  await page.evaluate(() => document.getElementById('toolsDrawerTab').click());
  await page.waitForTimeout(200);
  await page.evaluate(() => document.querySelector('.seg2-btn[data-theme-choice="light"]').click());
  await page.waitForTimeout(200);
  await page.evaluate(() => document.getElementById('toolsDrawerTab').click());

  const light = await page.evaluate(() => {
    const out = {};
    out.themeAttr = document.documentElement.dataset.theme;
    out.topBarBg = getComputedStyle(document.querySelector('.top-bar')).backgroundColor;
    const probeMenuBg = document.createElement('div');
    probeMenuBg.style.background = 'var(--menu-bg)';
    document.body.appendChild(probeMenuBg);
    out.menuBgResolved = getComputedStyle(probeMenuBg).backgroundColor;
    probeMenuBg.remove();
    out.topBarColor = getComputedStyle(document.querySelector('.top-bar')).color;
    const group = document.querySelector('.side-checklist .checklist-group');
    out.checklistCardBg = group ? getComputedStyle(group).backgroundColor : null;
    // search box / icon-btn should have flipped off hardcoded white too --
    // confirm the chip background is no longer literally the old dark-mode
    // rgba(255,255,255,..) value
    out.searchBoxBg = getComputedStyle(document.querySelector('.tb-search')).backgroundColor;
    return out;
  });

  // ---- disk-level checks ----
  const diskCheck = (() => {
    const html = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
    const styleMatch = html.match(/<style>([\s\S]*)<\/style>/);
    const css = styleMatch ? styleMatch[1] : '';
    return {
      noHardcodedWhiteOnTopBar: !/\.top-bar\{[^}]*color:#fff/.test(css) && !/\.top-bar\{[^}]*background:rgba\(20,24,22,\.72\)/.test(css),
      chromeChipTokensExist: /--chrome-chip-bg:/.test(css) && /--chrome-chip-hover:/.test(css) && /--chrome-chip-border:/.test(css),
      checklistCardTokenExists: /--checklist-card-bg:/.test(css),
      noOldTagRules: !/\.tag\.manual\{/.test(css) && !/\.tag\.done\{/.test(css) && !/\.tag\.incomplete\{/.test(css),
      ciDotRulesExist: /\.ci-dot\{/.test(css) && /\.ci-dot-done\{/.test(css) && /\.ci-dot-incomplete\{/.test(css) && /\.ci-dot-manual\{/.test(css),
      noTargetEmojiInMarkup: !html.includes('<span class="icon">\u{1F3AF}</span>'),
    };
  })();

  const pass = dark.themeAttr === 'dark'
    && dark.tbTitleText === 'Shooting Map' // v106: the title's "i" became the header's "About" button
    && dark.tbTitleHasTargetEmoji === false
    && dark.tbTitleIconSpanExists === false
    && dark.topBarBg === dark.menuBgResolved
    && dark.topBarColor === dark.inkResolved
    && dark.topBarBgRaw === 'rgba(12, 15, 13, 0.78)' // v109: darker dark
    && dark.tagElementCount === 0
    && dark.checklistHeadingText === 'Checklist'
    && dark.checklistHeadingHasCheckEmoji === false
    && dots.dotCount > 0 && dots.hasDoneOrIncomplete && dots.hasManual
    && dots.checklistCardBg === 'rgba(0, 0, 0, 0.3)'
    && light.themeAttr === 'light'
    && light.topBarBg === light.menuBgResolved
    && light.topBarBg === 'rgba(246, 246, 243, 0.72)'
    && light.checklistCardBg === 'rgba(255, 255, 255, 0.6)'
    && light.searchBoxBg === 'rgba(20, 24, 22, 0.06)'
    && diskCheck.noHardcodedWhiteOnTopBar && diskCheck.chromeChipTokensExist && diskCheck.checklistCardTokenExists
    && diskCheck.noOldTagRules && diskCheck.ciDotRulesExist && diskCheck.noTargetEmojiInMarkup
    && errors.length === 0;

  console.log('=== errors ===', errors.length ? errors.join('\n') : '(none)');
  console.log('=== dark ===', JSON.stringify(dark, null, 2));
  console.log('=== dots ===', JSON.stringify(dots, null, 2));
  console.log('=== light ===', JSON.stringify(light, null, 2));
  console.log('=== diskCheck ===', JSON.stringify(diskCheck, null, 2));
  console.log(pass ? 'PASS' : 'FAIL');
  await browser.close();
  process.exit(pass ? 0 : 1);
})();
