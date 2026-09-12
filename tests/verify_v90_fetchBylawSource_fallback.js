// Regression test for v90: fetchBylawSource()'s three-tier fallback --
// direct fetch, then (only when served over http/https) our own
// api/bylaw-fetch.js serverless proxy, then the old public api.allorigins.win
// proxy as a last resort. See docs/CHANGELOG.md's v90 section and
// tests/verify_v90_bylaw_proxy.js (which covers api/bylaw-fetch.js itself,
// as a plain Node test -- this file only covers the front-end fallback
// *logic* in fetchBylawSource()).
//
// This app is normally verified by loading index.html via file:// (see
// every other tests/verify_*.js), but the whole point of this change is
// behaviour that differs between file:// and a real http(s) origin -- the
// own-proxy tier only ever runs over http(s) -- so this test spins up a
// tiny built-in Node http server to serve the repo root, in addition to a
// plain file:// load, rather than trying to fake location.protocol (which
// browsers don't allow overriding).
const { chromium } = require('playwright');
const { launchOpts } = require('./launch');
const fs = require('fs');
const path = require('path');
const http = require('http');
const STUB = fs.readFileSync(__dirname + '/leaflet-stub.js', 'utf8');
const ROOT = path.resolve(__dirname, '..');

function serveStatic(root) {
  return http.createServer((req, res) => {
    const reqPath = decodeURIComponent(req.url.split('?')[0]);
    const filePath = path.join(root, reqPath === '/' ? '/index.html' : reqPath);
    if (!filePath.startsWith(root) || !fs.existsSync(filePath) || fs.statSync(filePath).isDirectory()) {
      res.writeHead(404); res.end('not found'); return;
    }
    const ext = path.extname(filePath);
    const type = ext === '.html' ? 'text/html' : ext === '.js' ? 'application/javascript' : 'application/octet-stream';
    res.writeHead(200, { 'Content-Type': type });
    fs.createReadStream(filePath).pipe(res);
  });
}

async function withStubbedLeaflet(page) {
  await page.route('**://cdnjs.cloudflare.com/**leaflet.min.js', route => route.fulfill({ status: 200, contentType: 'application/javascript', body: STUB }));
  await page.route('**://cdnjs.cloudflare.com/**leaflet.draw.js', route => route.fulfill({ status: 200, contentType: 'application/javascript', body: '// stub' }));
  await page.route('**://cdnjs.cloudflare.com/**.css', route => route.fulfill({ status: 200, contentType: 'text/css', body: '/* stub */' }));
  await page.route('**://fonts.googleapis.com/**', route => route.fulfill({ status: 200, contentType: 'text/css', body: '/* stub */' }));
}

(async () => {
  const browser = await chromium.launch(launchOpts());
  const errors = [];
  const results = {};

  const server = serveStatic(ROOT);
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const port = server.address().port;

  try {
    // ---- Scenario A: served over http -- own proxy tried before the public one ----
    {
      // Console errors are NOT checked in this test (unlike every other
      // tests/verify_*.js) -- every scenario here deliberately fails a
      // request (route.abort()/500) to exercise the fallback chain, which
      // the browser always logs as a "Failed to load resource" console
      // error even though it's the exact behaviour under test. Only a real
      // uncaught JS exception (pageerror) fails this test.
      const page = await browser.newPage({ viewport: { width: 1400, height: 1000 } });
      page.on('pageerror', err => errors.push('A PAGEERROR: ' + err.message));
      await withStubbedLeaflet(page);

      let ownProxyHit = false, publicProxyHit = false;
      // The bylaw source URL itself -- force it to fail so fetchBylawSource() falls through.
      await page.route('**/main/attachments/attachView.cfm**', route => route.abort('failed'));
      await page.route('**/api/bylaw-fetch**', route => {
        ownProxyHit = true;
        route.fulfill({ status: 200, contentType: 'application/pdf', body: 'own-proxy-body' });
      });
      await page.route('**allorigins.win/**', route => {
        publicProxyHit = true;
        route.fulfill({ status: 200, contentType: 'application/pdf', body: 'public-proxy-body' });
      });

      await page.goto(`http://127.0.0.1:${port}/index.html`, { waitUntil: 'load', timeout: 60000 });
      await page.waitForTimeout(500);

      const r = await page.evaluate(async () => {
        const out = await fetchBylawSource('https://www.chilliwack.com/main/attachments/attachView.cfm?attachID=1757');
        return { ok: out.ok, text: out.ok ? new TextDecoder().decode(out.buf) : null, protocol: location.protocol };
      });
      results.httpOwnProxySucceeds = { ...r, ownProxyHit, publicProxyHit };
      await page.close();
    }

    // ---- Scenario B: served over http, own proxy itself fails -- falls through to the public proxy ----
    {
      const page = await browser.newPage({ viewport: { width: 1400, height: 1000 } });
      page.on('pageerror', err => errors.push('B PAGEERROR: ' + err.message));
      await withStubbedLeaflet(page);

      let ownProxyHit = false, publicProxyHit = false;
      await page.route('**/main/attachments/attachView.cfm**', route => route.abort('failed'));
      await page.route('**/api/bylaw-fetch**', route => { ownProxyHit = true; route.fulfill({ status: 500, body: 'boom' }); });
      await page.route('**allorigins.win/**', route => { publicProxyHit = true; route.fulfill({ status: 200, contentType: 'application/pdf', body: 'public-proxy-body' }); });

      await page.goto(`http://127.0.0.1:${port}/index.html`, { waitUntil: 'load', timeout: 60000 });
      await page.waitForTimeout(500);

      const r = await page.evaluate(async () => {
        const out = await fetchBylawSource('https://www.chilliwack.com/main/attachments/attachView.cfm?attachID=1757');
        return { ok: out.ok, text: out.ok ? new TextDecoder().decode(out.buf) : null };
      });
      results.httpFallsThroughToPublicProxy = { ...r, ownProxyHit, publicProxyHit };
      await page.close();
    }

    // ---- Scenario C: opened as a local file -- own proxy is skipped entirely, straight to the public proxy ----
    {
      const page = await browser.newPage({ viewport: { width: 1400, height: 1000 } });
      page.on('pageerror', err => errors.push('C PAGEERROR: ' + err.message));
      await withStubbedLeaflet(page);

      let ownProxyHit = false, publicProxyHit = false;
      await page.route('**/main/attachments/attachView.cfm**', route => route.abort('failed'));
      // Own proxy has no meaning under file:// (no server to answer relative /api/... at all),
      // but route it anyway so a regression that *does* call it under file:// would be caught.
      await page.route('**/api/bylaw-fetch**', route => { ownProxyHit = true; route.fulfill({ status: 200, body: 'own-proxy-body' }); });
      await page.route('**allorigins.win/**', route => { publicProxyHit = true; route.fulfill({ status: 200, contentType: 'application/pdf', body: 'public-proxy-body' }); });

      await page.goto('file://' + path.join(ROOT, 'index.html'), { waitUntil: 'load', timeout: 60000 });
      await page.waitForTimeout(500);

      const r = await page.evaluate(async () => {
        const out = await fetchBylawSource('https://www.chilliwack.com/main/attachments/attachView.cfm?attachID=1757');
        return { ok: out.ok, text: out.ok ? new TextDecoder().decode(out.buf) : null, protocol: location.protocol };
      });
      results.fileProtocolSkipsOwnProxy = { ...r, ownProxyHit, publicProxyHit };
      await page.close();
    }
  } finally {
    server.close();
    await browser.close();
  }

  const A = results.httpOwnProxySucceeds || {};
  const B = results.httpFallsThroughToPublicProxy || {};
  const C = results.fileProtocolSkipsOwnProxy || {};

  const pass = errors.length === 0
    && A.ok === true && A.text === 'own-proxy-body' && A.ownProxyHit === true && A.publicProxyHit === false
    && B.ok === true && B.text === 'public-proxy-body' && B.ownProxyHit === true && B.publicProxyHit === true
    && C.ok === true && C.text === 'public-proxy-body' && C.ownProxyHit === false && C.publicProxyHit === true
    && C.protocol === 'file:';

  console.log('=== errors ===', errors.length ? errors.join('\n') : '(none)');
  console.log('=== RESULTS ===', JSON.stringify(results, null, 2));
  console.log(pass ? 'PASS' : 'FAIL');
  process.exit(pass ? 0 : 1);
})();
