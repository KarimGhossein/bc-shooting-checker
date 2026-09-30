// Regression test for v107, the search box's placeholder used to be cut
// off ("Search address or p..."). See docs/CHANGELOG.md's v107 section.
// Checks: the new placeholder and aria-label; that the placeholder text
// genuinely fits inside the input's text area at phone and desktop widths
// (measured with canvas measureText in the input's own computed font, the
// suite stubs web fonts, so this runs on the fallback font, which is a
// stricter check than Hanken Grotesk's narrower glyphs); that the search box
// now grows on wider windows; and that the header still never collides.
const { chromium } = require('playwright');
const { launchOpts } = require('./launch');
const fs = require('fs');
const path = require('path');
const STUB = fs.readFileSync(__dirname + '/leaflet-stub.js', 'utf8');
const ROOT = path.resolve(__dirname, '..');

async function newPage(browser, width){
  const page = await browser.newPage({ viewport: { width, height: 800 } });
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
  const byWidth = {};
  for (const w of [375, 780, 900, 1024, 1280, 1600]) {
    const p = await newPage(browser, w);
    p.on('console', m => { if (m.type() === 'error') errors.push(`CONSOLE@${w}: ` + m.text()); });
    p.on('pageerror', e => errors.push(`PAGEERROR@${w}: ` + e.message));
    await p.goto('file://' + path.join(ROOT, 'index.html'), { waitUntil: 'load', timeout: 60000 });
    await p.waitForTimeout(400);
    byWidth[w] = await p.evaluate((w) => {
      const i = document.getElementById('searchInput'), cs = getComputedStyle(i);
      const c = document.createElement('canvas').getContext('2d');
      c.font = `${cs.fontWeight} ${cs.fontSize} ${cs.fontFamily}`;
      const avail = i.clientWidth - parseFloat(cs.paddingLeft) - parseFloat(cs.paddingRight);
      const r = s => document.querySelector(s).getBoundingClientRect();
      const out = { placeholder: i.placeholder, ariaLabel: i.getAttribute('aria-label'),
        textPx: Math.round(c.measureText(i.placeholder).width), availPx: Math.round(avail),
        searchBox: Math.round(r('.tb-search').width) };
      out.fits = c.measureText(i.placeholder).width <= avail;
      if (w > 760) {
        const L = r('.tb-left'), row = r('.tb-search-row'), R = r('.tb-right');
        out.gapLeft = Math.round(row.left - L.right); out.gapRight = Math.round(R.left - row.right);
      }
      return out;
    }, w);
    await p.close();
  }
  const ws = Object.keys(byWidth);
  const pass = ws.every(w => byWidth[w].placeholder === 'Place or coordinates' && byWidth[w].ariaLabel && byWidth[w].fits)
    && ws.filter(w => +w > 760).every(w => byWidth[w].gapLeft > 0 && byWidth[w].gapRight > 0 && byWidth[w].searchBox >= 225)
    && byWidth[1600].searchBox > byWidth[900].searchBox + 100
    && errors.length === 0;
  console.log('=== errors ===', errors.length ? errors.join('\n') : '(none)');
  console.log('=== RESULTS ===');
  for (const w of ws) console.log(w, JSON.stringify(byWidth[w]));
  console.log(pass ? 'PASS' : 'FAIL');
  await browser.close();
  process.exit(pass ? 0 : 1);
})();
