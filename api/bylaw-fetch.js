// v90: minimal server-side proxy for the live bylaw fetch
// (index.html's fetchBylawSource()), replacing the public, keyless,
// uncontrolled third-party CORS proxy (api.allorigins.win) as the app's
// primary CORS-workaround for municipal bylaw sites that don't send
// Access-Control-Allow-Origin. See docs/CHANGELOG.md's v90 section for the
// full root-cause writeup (why this is the one item from the audit's
// "add a backend to proxy WFS/Nominatim/Overpass/bylaw calls" roadmap line
// that actually needed a backend -- the others already have a working
// CORS-free path of their own).
//
// This is deliberately NOT a general-purpose open proxy: it only ever
// forwards to the exact hosts behind the hand-verified BYLAW_SOURCES table
// in index.html. Keep this list in sync with that table when a new
// jurisdiction is added -- there is no shared config file between the
// static front end and this function, so this is a manual duplication,
// on purpose, to keep this endpoint's attack surface obvious and small.
const ALLOWED_HOSTS = new Set([
  "www.chilliwack.com",
  "laws.abbotsford.ca",
  "apps.kelowna.ca",
]);

const MAX_RESPONSE_BYTES = 15 * 1024 * 1024; // bylaws are PDFs/HTML, never this large -- defensive cap only

module.exports = async function handler(req, res) {
  const target = typeof req.query.url === "string" ? req.query.url : null;
  if (!target) {
    res.status(400).json({ error: "missing url parameter" });
    return;
  }

  let parsed;
  try {
    parsed = new URL(target);
  } catch {
    res.status(400).json({ error: "invalid url" });
    return;
  }

  if (parsed.protocol !== "https:" || !ALLOWED_HOSTS.has(parsed.hostname)) {
    res.status(403).json({ error: "host not allowed" });
    return;
  }

  try {
    const upstream = await fetch(parsed.toString(), {
      redirect: "follow",
      signal: AbortSignal.timeout(15000),
      headers: { "user-agent": "bc-shooting-checker-bylaw-proxy/1.0" },
    });

    if (!upstream.ok) {
      res.status(502).json({ error: `upstream HTTP ${upstream.status}` });
      return;
    }

    const contentLength = Number(upstream.headers.get("content-length") || 0);
    if (contentLength && contentLength > MAX_RESPONSE_BYTES) {
      res.status(502).json({ error: "upstream response too large" });
      return;
    }

    const buf = Buffer.from(await upstream.arrayBuffer());
    if (buf.byteLength > MAX_RESPONSE_BYTES) {
      res.status(502).json({ error: "upstream response too large" });
      return;
    }

    const contentType = upstream.headers.get("content-type") || "application/octet-stream";
    // These bylaw documents change rarely -- caching at the edge (Vercel
    // honors s-maxage/stale-while-revalidate on serverless function
    // responses) cuts real, repeat load off both this function and the
    // municipal server for every subsequent lookup of the same jurisdiction.
    res.setHeader("Cache-Control", "public, max-age=3600, s-maxage=86400, stale-while-revalidate=604800");
    res.setHeader("Content-Type", contentType);
    res.status(200).send(buf);
  } catch (err) {
    res.status(502).json({ error: String((err && err.message) || err) });
  }
};

// Exported for tests/verify_v90_bylaw_proxy.js, which calls this directly
// with mock req/res objects and a stubbed global fetch rather than spinning
// up a real Vercel dev server -- see that file's own top comment.
module.exports.ALLOWED_HOSTS = ALLOWED_HOSTS;
