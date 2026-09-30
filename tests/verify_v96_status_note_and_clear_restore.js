// Regression test for v96's other two changes (the leaflet.draw "Clear
// All" removal itself is covered separately, as a plain Node test, in
// tests/verify_v96_leafletdraw_clearall.js, see that file's own comment
// for why: the network-stubbed leaflet-stub.js used here has no real
// L.EditToolbar to test that patch against):
//
// 1) v95 removed the Tools drawer's "Clear ▾" dropdown by mistake, Karim
//    clarified afterward that he meant a completely different thing (see
//    #2 below and verify_v96_leafletdraw_clearall.js). This confirms it's
//    back in full: same button, same 11 report-category menu items.
//    (v101 update: the dropdown gained 3 more items, parcelview/spots/
//    roadview, one per Mapping Functions layer, so the item count check
//    below expects 14, not 11; see docs/CHANGELOG.md's v101 section.)
//
// 2) The #mapActionsNote status card under the Mapping Functions buttons
//    used to render as a bordered, padded, visually empty box before any
//    button had been pressed, "that blank container under reveal road
//    should not be there. It should only be present if there is
//    information inside of it". Fixed with a CSS-only
//    `.td-status:has(#mapActionsNote:empty){display:none}` rule.
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

  const results = await page.evaluate(async () => {
    const out = {};

    // ---- Clear ▾ dropdown restored ----
    out.clearMenuBtnRestored = !!document.getElementById('clearMenuBtn');
    out.clearMenuRestored = !!document.getElementById('clearMenu');
    out.clearMenuItemCountRestored = document.querySelectorAll('.clear-menu-item').length === 15;

    // ---- v109: the note is a status toast under the search bar: hidden
    // while empty, replaces the search status when text arrives, fades
    // out after STATUS_TOAST_MS ----
    const note = document.getElementById('mapActionsNote');
    const wrap = note.closest('.tb-status-wrap');
    out.statusCardExists = !!wrap;
    out.hiddenWhenEmpty = getComputedStyle(note).display === 'none';
    note.textContent = 'Parcels drawn.';
    await new Promise(r => setTimeout(r, 120));
    out.visibleWhenPopulated = getComputedStyle(note).display !== 'none' && note.classList.contains('show')
      && getComputedStyle(document.getElementById('searchStatus')).display === 'none';
    await new Promise(r => setTimeout(r, STATUS_TOAST_MS + 900));
    out.hiddenAgainWhenClearedBackToEmpty = !wrap.classList.contains('toast-on') && getComputedStyle(note).display === 'none'
      && getComputedStyle(document.getElementById('searchStatus')).display !== 'none';
    return out;
  });

  const pass = results.clearMenuBtnRestored
    && results.clearMenuRestored
    && results.clearMenuItemCountRestored
    && results.statusCardExists
    && results.hiddenWhenEmpty
    && results.visibleWhenPopulated
    && results.hiddenAgainWhenClearedBackToEmpty
    && errors.length === 0;

  console.log('=== errors ===', errors.length ? errors.join('\n') : '(none)');
  console.log('=== RESULTS ===', JSON.stringify(results, null, 2));
  console.log(pass ? 'PASS' : 'FAIL');
  await browser.close();
  process.exit(pass ? 0 : 1);
})();
