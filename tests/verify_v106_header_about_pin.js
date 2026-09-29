// Regression test for v106 -- two header rearrangements Karim asked for
// (see docs/CHANGELOG.md's v106 section):
//   1) the drag-to-place pin button moves from .tb-right to directly left of
//      the address search box (inside .tb-search-row), and drag still works;
//   2) the "i" beside the "Shooting Map" title becomes a labelled "About"
//      button in .tb-right, immediately left of Disclaimers, opening the
//      same "About this tool" content.
// Also guards the layout: the search box keeps its pre-v106 width (233px,
// via .tb-search-wrap max-width 560 -> 602) and nothing in the header
// collides at any width above the 760px stacked-mobile breakpoint.
const { chromium } = require('playwright');
const { launchOpts } = require('./launch');
const fs = require('fs');
const path = require('path');
const STUB = fs.readFileSync(__dirname + '/leaflet-stub.js', 'utf8');
const ROOT = path.resolve(__dirname, '..');

async function newPage(browser, width){
  const page = await browser.newPage({ viewport: { width, height: 900 } });
  await page.route('**://cdnjs.cloudflare.com/**leaflet.min.js', r => r.fulfill({ status: 200, contentType: 'application/javascript', body: STUB }));
  await page.route('**://cdnjs.cloudflare.com/**leaflet.draw.js', r => r.fulfill({ status: 200, contentType: 'application/javascript', body: '// stub' }));
  await page.route('**://cdnjs.cloudflare.com/**.css', r => r.fulfill({ status: 200, contentType: 'text/css', body: '/* stub */' }));
  await page.route('**://fonts.googleapis.com/**', r => r.fulfill({ status: 200, contentType: 'text/css', body: '/* stub */' }));
  await page.route('**://fonts.gstatic.com/**', r => r.fulfill({ status: 200, contentType: 'font/woff2', body: Buffer.from('') }));
  return page;
}

(async () => {
  const browser = await chromium.launch(launchOpts());
  const errors = [];
  const page = await newPage(browser, 1400);
  page.on('console', m => { if (m.type() === 'error') errors.push('CONSOLE: ' + m.text()); });
  page.on('pageerror', e => errors.push('PAGEERROR: ' + e.message));
  await page.goto('file://' + path.join(ROOT, 'index.html'), { waitUntil: 'load', timeout: 60000 });
  await page.waitForTimeout(800);

  const markup = await page.evaluate(() => {
    const pin = document.getElementById('dragPinBtn');
    const row = document.querySelector('.tb-search-row');
    const about = document.getElementById('headerInfoBtn');
    const disc = document.getElementById('disclaimerBtn');
    const pr = pin.getBoundingClientRect(), sr = document.querySelector('.tb-search').getBoundingClientRect();
    return {
      pinCount: document.querySelectorAll('#dragPinBtn').length,
      pinInSearchRow: pin.parentElement === row,
      pinIsFirstInRow: row.firstElementChild === pin,
      pinImmediatelyBeforeSearch: pin.nextElementSibling === document.querySelector('.tb-search'),
      pinLeftOfSearchOnScreen: pr.right <= sr.left && Math.abs((pr.top + pr.bottom) / 2 - (sr.top + sr.bottom) / 2) < 4,
      pinDraggable: pin.getAttribute('draggable') === 'true',
      pinNotInRight: !document.querySelector('.tb-right #dragPinBtn'),
      titleText: document.querySelector('.tb-title').textContent.replace(/\s+/g, ' ').trim(),
      titleHasButton: !!document.querySelector('.tb-title button'),
      aboutInRight: about.parentElement === document.querySelector('.tb-right'),
      aboutImmediatelyBeforeDisclaimers: about.nextElementSibling === disc,
      aboutText: about.textContent.trim(),
      aboutIsButton: about.tagName === 'BUTTON' && about.getAttribute('type') === 'button',
      searchBoxWidth: Math.round(sr.width),
    };
  });

  // About opens the same "About this tool" modal the old "i" did
  await page.click('#headerInfoBtn');
  await page.waitForTimeout(200);
  const modal = await page.evaluate(() => ({
    title: document.getElementById('infoModalTitle').textContent.trim(),
    bodyLen: (document.querySelector('#infoModalOverlay .modal-body') || {}).textContent ? document.querySelector('#infoModalOverlay .modal-body').textContent.trim().length : 0,
    open: getComputedStyle(document.getElementById('infoModalOverlay')).display !== 'none',
  }));

  // drag-to-place still wired: dragstart on the pin sets the payload
  const dragPayload = await page.evaluate(() => {
    const dt = new DataTransfer();
    document.getElementById('dragPinBtn').dispatchEvent(new DragEvent('dragstart', { dataTransfer: dt, bubbles: true }));
    return dt.getData('text/plain');
  });
  await page.close();

  const layout = {};
  for (const w of [780, 900, 1024, 1280, 1600]) {
    const p = await newPage(browser, w);
    await p.goto('file://' + path.join(ROOT, 'index.html'), { waitUntil: 'load', timeout: 60000 });
    await p.waitForTimeout(400);
    layout[w] = await p.evaluate(() => {
      const r = s => document.querySelector(s).getBoundingClientRect();
      const L = r('.tb-left'), row = r('.tb-search-row'), R = r('.tb-right');
      return { gapLeft: Math.round(row.left - L.right), gapRight: Math.round(R.left - row.right), searchBox: Math.round(r('.tb-search').width) };
    });
    await p.close();
  }

  const pass = markup.pinCount === 1 && markup.pinInSearchRow && markup.pinIsFirstInRow && markup.pinImmediatelyBeforeSearch
    && markup.pinLeftOfSearchOnScreen && markup.pinDraggable && markup.pinNotInRight
    && markup.titleText === 'Shooting Map' && !markup.titleHasButton
    && markup.aboutInRight && markup.aboutImmediatelyBeforeDisclaimers && markup.aboutText === 'About' && markup.aboutIsButton
    && modal.open && /About this tool/.test(modal.title) && modal.bodyLen > 50
    && dragPayload === 'bc-shooting-check-pin'
    && Object.values(layout).every(l => l.gapLeft > 0 && l.gapRight > 0 && l.searchBox >= 225)
    && errors.length === 0;

  console.log('=== errors ===', errors.length ? errors.join('\n') : '(none)');
  console.log('=== RESULTS ===');
  console.log('markup', JSON.stringify(markup, null, 2));
  console.log('modal', JSON.stringify(modal), 'dragPayload', dragPayload);
  console.log('layout by viewport width', JSON.stringify(layout));
  console.log(pass ? 'PASS' : 'FAIL');
  await browser.close();
  process.exit(pass ? 0 : 1);
})();
