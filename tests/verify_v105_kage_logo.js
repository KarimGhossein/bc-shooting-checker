// Regression test for v105 -- the KAGE "Front Sight" logo (see
// docs/CHANGELOG.md's v105 section):
//   1) the header shows the KAGE wordmark (K, a flat-topped crossbar-less
//      Lambda with an accent aiming dot, G, E) ahead of the unchanged
//      "Shooting Map" title, with the exact master geometry;
//   2) the Lambda's body follows --ink and its dot follows --accent in BOTH
//      themes (so it stays legible when the header flips light/dark);
//   3) the favicon is the Front Sight mark and the page <title> is
//      "KAGE Shooting Map";
//   4) the longer header left side never collides with the centred search
//      box at any width above the stacked-mobile breakpoint (760px).
const { chromium } = require('playwright');
const { launchOpts } = require('./launch');
const fs = require('fs');
const path = require('path');
const STUB = fs.readFileSync(__dirname + '/leaflet-stub.js', 'utf8');
const ROOT = path.resolve(__dirname, '..');
const POLY = '0,70 33,0 47,0 80,70 66,70 40,14.8 14,70';

async function newPage(browser, width){
  const page = await browser.newPage({ viewport: { width, height: 900 } });
  await page.route('**://cdnjs.cloudflare.com/**leaflet.min.js', r => r.fulfill({ status: 200, contentType: 'application/javascript', body: STUB }));
  await page.route('**://cdnjs.cloudflare.com/**leaflet.draw.js', r => r.fulfill({ status: 200, contentType: 'application/javascript', body: '// stub' }));
  await page.route('**://cdnjs.cloudflare.com/**.css', r => r.fulfill({ status: 200, contentType: 'text/css', body: '/* stub */' }));
  await page.route('**://fonts.googleapis.com/**', r => r.fulfill({ status: 200, contentType: 'text/css', body: '/* stub */' }));
  await page.route('**://fonts.gstatic.com/**', r => r.fulfill({ status: 200, contentType: 'font/woff2', body: Buffer.from('') }));
  return page;
}

const readColours = () => {
  const probe = (prop, val) => { const p = document.createElement('div'); p.style[prop] = val; document.body.appendChild(p); const v = getComputedStyle(p)[prop]; p.remove(); return v; };
  const brand = document.querySelector('.top-bar .tb-left .tb-brand');
  const poly = brand && brand.querySelector('svg.tb-lam polygon');
  const dot = brand && brand.querySelector('svg.tb-lam circle');
  return {
    theme: document.documentElement.dataset.theme,
    polyFill: poly ? getComputedStyle(poly).fill : null,
    dotFill: dot ? getComputedStyle(dot).fill : null,
    ink: probe('color', 'var(--ink)'),
    accent: probe('color', 'var(--accent)'),
  };
};

(async () => {
  const browser = await chromium.launch(launchOpts());
  const errors = [];
  const page = await newPage(browser, 1400);
  page.on('console', m => { if (m.type() === 'error') errors.push('CONSOLE: ' + m.text()); });
  page.on('pageerror', e => errors.push('PAGEERROR: ' + e.message));
  await page.goto('file://' + path.join(ROOT, 'index.html'), { waitUntil: 'load', timeout: 60000 });
  await page.waitForTimeout(800);

  const markup = await page.evaluate((POLY) => {
    const brand = document.querySelector('.top-bar .tb-left .tb-brand');
    const icon = document.querySelector('link[rel="icon"]');
    const touch = document.querySelector('link[rel="apple-touch-icon"]');
    const letters = brand ? Array.from(brand.children).map(c => c.tagName.toLowerCase() === 'svg' ? 'Λ' : c.textContent).join('') : null;
    return {
      title: document.title,
      brandExists: !!brand,
      brandLabel: brand && brand.getAttribute('aria-label'),
      brandRole: brand && brand.getAttribute('role'),
      letters,
      polyPoints: brand && brand.querySelector('svg.tb-lam polygon').getAttribute('points'),
      dotAttrs: brand && ['cx','cy','r'].map(a => brand.querySelector('svg.tb-lam circle').getAttribute(a)).join(','),
      brandBeforeTitle: !!(brand && brand.compareDocumentPosition(document.querySelector('.tb-title')) & Node.DOCUMENT_POSITION_FOLLOWING),
      tbTitleText: document.querySelector('.top-bar .tb-title').textContent.replace(/\s+/g, ' ').trim(),
      oldCrosshairGone: !document.querySelector('.top-bar svg circle[r="8.5"]'),
      faviconIsSvgMark: !!icon && icon.getAttribute('href').startsWith('data:image/svg+xml') && icon.getAttribute('href').includes(POLY),
      touchHref: touch && touch.getAttribute('href'),
    };
  }, POLY);

  const dark = await page.evaluate(readColours);
  await page.evaluate(() => document.querySelector('.seg2-btn[data-theme-choice="light"]').click());
  await page.waitForTimeout(200);
  const light = await page.evaluate(readColours);
  await page.close();

  // no collision between header left side and the centred search box
  const overlaps = {};
  for (const w of [780, 900, 1024, 1280, 1600]) {
    const p = await newPage(browser, w);
    await p.goto('file://' + path.join(ROOT, 'index.html'), { waitUntil: 'load', timeout: 60000 });
    await p.waitForTimeout(400);
    overlaps[w] = await p.evaluate(() => {
      const a = document.querySelector('.tb-left').getBoundingClientRect();
      const b = document.querySelector('.tb-search').getBoundingClientRect();
      return Math.round(b.left - a.right); // gap in px; must stay positive
    });
    await p.close();
  }

  const touchFileExists = !!markup.touchHref && fs.existsSync(path.join(ROOT, markup.touchHref));

  const pass = markup.title === 'KAGE Shooting Map'
    && markup.brandExists && markup.brandLabel === 'KAGE' && markup.brandRole === 'img'
    && markup.letters === 'KΛGE'
    && markup.polyPoints === POLY && markup.dotAttrs === '40,51,9' // header-size optical tuning; masters use 40,50,7
    && markup.brandBeforeTitle
    && markup.tbTitleText === 'Shooting Map i'
    && markup.oldCrosshairGone
    && markup.faviconIsSvgMark && touchFileExists
    && dark.theme === 'dark' && dark.polyFill === dark.ink && dark.dotFill === dark.accent
    && light.theme === 'light' && light.polyFill === light.ink && light.dotFill === light.accent
    && dark.dotFill !== light.dotFill
    && Object.values(overlaps).every(g => g > 0)
    && errors.length === 0;

  console.log('=== errors ===', errors.length ? errors.join('\n') : '(none)');
  console.log('=== RESULTS ===');
  console.log('markup', JSON.stringify(markup, null, 2));
  console.log('touchFileExists', touchFileExists);
  console.log('dark', JSON.stringify(dark), '\nlight', JSON.stringify(light));
  console.log('gap between header left side and search box (px) by viewport width', JSON.stringify(overlaps));
  console.log(pass ? 'PASS' : 'FAIL');
  await browser.close();
  process.exit(pass ? 0 : 1);
})();
