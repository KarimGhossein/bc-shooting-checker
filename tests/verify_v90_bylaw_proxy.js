// Regression test for v90: api/bylaw-fetch.js, the new minimal serverless
// proxy that replaces the public api.allorigins.win CORS proxy as the
// primary fallback for index.html's live bylaw fetch (fetchBylawSource()).
//
// This is a plain Node test, not a Playwright one -- there's no browser
// involved, just calling the handler function directly with mock req/res
// objects and a stubbed global.fetch, the same way Vercel itself would
// invoke it (module.exports is the (req, res) => {} handler). Keeps the
// same "=== errors ===" / "=== RESULTS ===" / PASS-FAIL console convention
// every other tests/verify_*.js script uses, so tests/run.js picks this up
// for free.
// See docs/CHANGELOG.md's v90 section for the full root-cause writeup.
const assert = require('assert');
const path = require('path');
const handler = require(path.join(__dirname, '..', 'api', 'bylaw-fetch.js'));

const errors = [];

function makeReq(url) {
  return { query: { url } };
}
function makeRes() {
  return {
    statusCode: null,
    headers: {},
    body: null,
    status(code) { this.statusCode = code; return this; },
    setHeader(k, v) { this.headers[k] = v; return this; },
    json(obj) { this.body = obj; return this; },
    send(buf) { this.body = buf; return this; },
  };
}

function stubFetch(impl) {
  const original = global.fetch;
  global.fetch = impl;
  return () => { global.fetch = original; };
}

(async () => {
  const results = {};

  // 1) Missing url param -> 400, never touches fetch.
  {
    const res = makeRes();
    const restore = stubFetch(async () => { throw new Error('fetch should not be called'); });
    try {
      await handler(makeReq(undefined), res);
      results.missingUrl = { status: res.statusCode, body: res.body };
    } finally { restore(); }
  }

  // 2) Malformed url string -> 400.
  {
    const res = makeRes();
    const restore = stubFetch(async () => { throw new Error('fetch should not be called'); });
    try {
      await handler(makeReq('not a url'), res);
      results.malformedUrl = { status: res.statusCode, body: res.body };
    } finally { restore(); }
  }

  // 3) Disallowed host -> 403, never touches fetch.
  {
    const res = makeRes();
    const restore = stubFetch(async () => { throw new Error('fetch should not be called'); });
    try {
      await handler(makeReq('https://evil.example.com/x'), res);
      results.disallowedHost = { status: res.statusCode, body: res.body };
    } finally { restore(); }
  }

  // 4) http (not https) to an otherwise-allowed host -> 403.
  {
    const res = makeRes();
    const restore = stubFetch(async () => { throw new Error('fetch should not be called'); });
    try {
      await handler(makeReq('http://www.chilliwack.com/x'), res);
      results.nonHttps = { status: res.statusCode, body: res.body };
    } finally { restore(); }
  }

  // 5) Allowed host, upstream succeeds -> 200, right body/content-type, cache headers set.
  {
    const res = makeRes();
    const fakeBody = Buffer.from('%PDF-1.4 fake bylaw bytes');
    const restore = stubFetch(async (url) => {
      results.calledUrl = url;
      return {
        ok: true,
        status: 200,
        headers: { get: (h) => (h === 'content-type' ? 'application/pdf' : h === 'content-length' ? String(fakeBody.byteLength) : null) },
        arrayBuffer: async () => fakeBody.buffer.slice(fakeBody.byteOffset, fakeBody.byteOffset + fakeBody.byteLength),
      };
    });
    try {
      await handler(makeReq('https://www.chilliwack.com/main/attachments/attachView.cfm?attachID=1757'), res);
      results.happyPath = {
        status: res.statusCode,
        contentType: res.headers['Content-Type'],
        hasCacheControl: !!res.headers['Cache-Control'],
        bodyMatches: Buffer.isBuffer(res.body) && res.body.equals(fakeBody),
      };
    } finally { restore(); }
  }

  // 6) Allowed host, upstream returns a non-ok status -> 502.
  {
    const res = makeRes();
    const restore = stubFetch(async () => ({ ok: false, status: 404, headers: { get: () => null } }));
    try {
      await handler(makeReq('https://laws.abbotsford.ca/civix/document/id/coa/coabylaws/1995b114'), res);
      results.upstreamNotOk = { status: res.statusCode, body: res.body };
    } finally { restore(); }
  }

  // 7) Allowed host, fetch itself throws (network error / timeout) -> 502, doesn't crash.
  {
    const res = makeRes();
    const restore = stubFetch(async () => { throw new Error('simulated network failure'); });
    try {
      await handler(makeReq('https://apps.kelowna.ca/CityPage/Docs/PDFs/Bylaws/Discharge%20of%20Firearms%20Bylaw%20No.%209779.pdf'), res);
      results.upstreamThrew = { status: res.statusCode, body: res.body };
    } finally { restore(); }
  }

  // 8) Allowed host, upstream claims an oversized body via Content-Length -> 502, body never read.
  {
    const res = makeRes();
    let arrayBufferCalled = false;
    const restore = stubFetch(async () => ({
      ok: true,
      status: 200,
      headers: { get: (h) => (h === 'content-length' ? String(20 * 1024 * 1024) : null) },
      arrayBuffer: async () => { arrayBufferCalled = true; return new ArrayBuffer(0); },
    }));
    try {
      await handler(makeReq('https://www.chilliwack.com/huge-file'), res);
      results.oversized = { status: res.statusCode, arrayBufferCalled };
    } finally { restore(); }
  }

  try {
    assert.strictEqual(results.missingUrl.status, 400);
    assert.strictEqual(results.malformedUrl.status, 400);
    assert.strictEqual(results.disallowedHost.status, 403);
    assert.strictEqual(results.nonHttps.status, 403);
    assert.strictEqual(results.happyPath.status, 200);
    assert.strictEqual(results.happyPath.contentType, 'application/pdf');
    assert.ok(results.happyPath.hasCacheControl);
    assert.ok(results.happyPath.bodyMatches);
    assert.strictEqual(results.upstreamNotOk.status, 502);
    assert.strictEqual(results.upstreamThrew.status, 502);
    assert.strictEqual(results.oversized.status, 502);
    assert.strictEqual(results.oversized.arrayBufferCalled, false);
  } catch (e) {
    errors.push('ASSERTION: ' + e.message);
  }

  const pass = errors.length === 0;
  console.log('=== errors ===', errors.length ? errors.join('\n') : '(none)');
  console.log('=== RESULTS ===', JSON.stringify(results, null, 2));
  console.log(pass ? 'PASS' : 'FAIL');
  process.exit(pass ? 0 : 1);
})();
