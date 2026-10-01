// Regression test for v108, the map overlay style system (see
// docs/CHANGELOG.md's v108 section and src/config/mapstyle.js).
// Guards the rules the redesign depends on, so later changes can't quietly
// drift back to one-off colours:
//   - src/config/mapstyle.js loads (as a classic script) before render.js and
//     the main inline script, and defines MAP_PAL/MAP_W/MAP_DASH/MAP_FILL;
//   - no layer style anywhere uses a hardcoded dash pattern (MAP_DASH only),
//     and none of the ~20 retired pre-v108 map hexes remain in style code;
//   - the outline-only boundary layers (tenure, woodlot, WMA, municipal)
//     keep a non-zero MAP_FILL.hit fill, so v81's "click inside an outline"
//     fix still holds;
//   - every map-key swatch uses a colour that the map actually draws with;
//   - the KAGE pin, bronze chooser highlight, casing CSS, basemap flag and
//     themed popups are all in place.
const { chromium } = require('playwright');
const { launchOpts } = require('./launch');
const fs = require('fs');
const path = require('path');
const STUB = fs.readFileSync(__dirname + '/leaflet-stub.js', 'utf8');
const ROOT = path.resolve(__dirname, '..');

(async () => {
  const browser = await chromium.launch(launchOpts());
  const errors = [];
  const page = await browser.newPage({ viewport: { width: 1400, height: 900 } });
  page.on('console', m => { if (m.type() === 'error') errors.push('CONSOLE: ' + m.text()); });
  page.on('pageerror', e => errors.push('PAGEERROR: ' + e.message));
  await page.route('**://cdnjs.cloudflare.com/**leaflet.min.js', r => r.fulfill({ status: 200, contentType: 'application/javascript', body: STUB }));
  await page.route('**://cdnjs.cloudflare.com/**leaflet.draw.js', r => r.fulfill({ status: 200, contentType: 'application/javascript', body: '// stub' }));
  await page.route('**://cdnjs.cloudflare.com/**.css', r => r.fulfill({ status: 200, contentType: 'text/css', body: '/* stub */' }));
  await page.route('**://fonts.googleapis.com/**', r => r.fulfill({ status: 200, contentType: 'text/css', body: '/* stub */' }));
  await page.route('**://fonts.gstatic.com/**', r => r.fulfill({ status: 200, contentType: 'font/woff2', body: Buffer.from('') }));
  await page.goto('file://' + path.join(ROOT, 'index.html'), { waitUntil: 'load', timeout: 60000 });
  await page.waitForTimeout(800);

  const live = await page.evaluate(() => {
    const out = {};
    const srcs = Array.from(document.querySelectorAll('script')).map(s => s.getAttribute('src'));
    const mainIdx = Array.from(document.querySelectorAll('script')).findIndex(s => !s.getAttribute('src') && s.textContent.includes('function openCutblockFromList'));
    out.order = { style: srcs.indexOf('src/config/mapstyle.js'), render: srcs.indexOf('src/map/render.js'), main: mainIdx };
    out.globals = [typeof MAP_PAL, typeof MAP_W, typeof MAP_DASH, typeof MAP_FILL].join(',');
    out.hitFill = MAP_FILL.hit;
    const probe = c => { const d = document.createElement('div'); d.style.color = c; document.body.appendChild(d); const v = getComputedStyle(d).color; d.remove(); return v; };
    const drawn = new Set([...Object.values(MAP_PAL), ...Object.values(OWNER_COLORS)].map(probe));
    const bad = [];
    document.querySelectorAll('#mapLegend .lg-row .sw').forEach(sw => {
      const cs = getComputedStyle(sw);
      const isLine = sw.classList.contains('line');
      let c = isLine ? cs.borderTopColor : cs.backgroundColor;
      if (!isLine && cs.backgroundColor.startsWith('rgba')) c = cs.borderTopColor; // buffer swatch: translucent fill + solid border
      if (!drawn.has(c)) bad.push(sw.parentElement.textContent.trim() + ' -> ' + c);
    });
    out.legendCount = document.querySelectorAll('#mapLegend .lg-row .sw').length;
    out.legendNotInPalette = bad;
    out.pinIcon = typeof KAGE_PIN_ICON !== 'undefined';
    out.chooserBronze = CHOOSER_HIGHLIGHT_STYLE.color === MAP_PAL.selection;
    out.mapBase = document.getElementById('map').dataset.base;
    const css = Array.from(document.styleSheets).flatMap(ss => { try { return Array.from(ss.cssRules).map(r => r.cssText); } catch (e) { return []; } }).join('\n');
    out.casingCss = /leaflet-overlay-pane svg > g[^{]*\{[^}]*url\("?#kage-casing-sat/.test(css) && /data-base="street"[^{]*\{[^}]*kage-casing-light/.test(css) && !/overlay-pane[^{]*\{[^}]*drop-shadow/.test(css);
    const fl = id => { const f = document.getElementById(id); return !!f && !!f.querySelector('feMorphology[operator="dilate"]') && /^0( 0)* 1( 1)*$/.test(f.querySelector('feFuncA').getAttribute('tableValues')); };
    out.casingFilters = fl('kage-casing-sat') && fl('kage-casing-light');
    // threshold must sit above every fill level, and above three stacked 'strong' fills
    const tv = document.querySelector('#kage-casing-sat feFuncA').getAttribute('tableValues').split(' ');
    out.casingThreshold = tv.indexOf('1') / tv.length;
    out.zoomAnimOff = /leaflet-zoom-anim .leaflet-overlay-pane svg > g[^{]*\{[^}]*filter:\s*none/.test(css);
    out.popupThemed = /leaflet-popup-content-wrapper[^{]*\{[^}]*var\(--surface\)/.test(css);
    out.pinCss = /\.kage-pin-core/.test(css);
    out.controlsThemed = /#map \.leaflet-bar a\s*\{[^}]*var\(--menu-bg\)/.test(css) && /leaflet-control-attribution\s*\{[^}]*var\(--surface\)/.test(css);
    out.spotSolid = !('dashArray' in spotStyle()) ;
    out.restrictedFill = restrictedStyle().fillOpacity;
    out.gapDash = gapOutlineStyle().dashArray === MAP_DASH && !gapStyle().dashArray && gapStyle().opacity <= 0.25; // v109: faint cell edges, dashed outline around the region
    return out;
  });

  const MAP_FILL_FOR_TEST = await page.evaluate(() => MAP_FILL);
  const render = fs.readFileSync(path.join(ROOT, 'src/map/render.js'), 'utf8');
  const html = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
  const code = render + '\n' + html.replace(/\/\/.*$/gm, '');
  const OLD = ['#d13438','#0aa6a6','#8a5cf5','#2f9e44','#4f6f93','#0086b3','#6b7d1f','#b8621b','#0f8a5f','#c2255c','#c98a1f','#8f96a3','#546e7a','#b1440e','#ffdd57','#1b4b9c','#a8650a'];
  const disk = {
    literalDashes: (code.match(/dashArray\s*:\s*["'][0-9 ]+["']/g) || []),
    oldHexInStyleCode: OLD.filter(h => new RegExp(`(color|fillColor)\\s*:\\s*["']${h}`, 'i').test(code) || new RegExp(`["']${h}["']`, 'i').test(render)),
    hitFillLayers: (render.match(/fillOpacity:MAP_FILL\.hit/g) || []).length,
    styleFileClassic: !/\b(import|export)\b/.test(fs.readFileSync(path.join(ROOT, 'src/config/mapstyle.js'), 'utf8').replace(/\/\/.*$/gm, '')),
  };

  const pass = live.order.style !== -1 && live.order.style < live.order.render && live.order.render < live.order.main
    && live.globals === 'object,object,string,object' && live.hitFill > 0
    && live.legendCount === 26 // v110: spots-only rows (restricted, active cutblock outline/buffer) removed && live.legendNotInPalette.length === 0
    && live.pinIcon && live.chooserBronze && live.mapBase === 'satellite'
    && live.casingCss && live.casingFilters && live.casingThreshold > Math.max(...Object.values(MAP_FILL_FOR_TEST)) && live.casingThreshold > 1 - Math.pow(1 - 0.24, 3) && live.zoomAnimOff && live.popupThemed && live.pinCss && live.controlsThemed
    && live.spotSolid && live.restrictedFill < 0.4 && live.gapDash
    && disk.literalDashes.length === 0 && disk.oldHexInStyleCode.length === 0
    && disk.hitFillLayers === 4 && disk.styleFileClassic
    && errors.length === 0;

  console.log('=== errors ===', errors.length ? errors.join('\n') : '(none)');
  console.log('=== RESULTS ===');
  console.log('live', JSON.stringify(live, null, 2));
  console.log('disk', JSON.stringify(disk, null, 2));
  console.log(pass ? 'PASS' : 'FAIL');
  await browser.close();
  process.exit(pass ? 0 : 1);
})();
