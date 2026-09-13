// Regression test for v94: this app must always deploy to Vercel as a
// plain static site, never auto-built by Vite.
//
// Root cause this guards against: Vercel's zero-config detection treats
// `vite.config.mjs` + "vite" in package.json's devDependencies as a Vite
// project and runs `npm run build`, serving only `dist/`. Vite's HTML
// processing only bundles/copies files reachable through the
// `type="module"` import graph or `public/` -- a classic `<script
// src="src/config/whatever.js">` (deliberately NOT a module, see
// docs/PLAN.md's "why classic scripts, not ES modules") is invisible to
// that graph, so every src/config/*.js file 404's in that build's output
// even though it's sitting right there in the repo. This silently broke
// every real location lookup in production from the moment v92 shipped a
// classic <script src> for the first time, and v93 turned it into a loud,
// page-load-time crash (MARKUP_ICONS referenced at the main script's top
// level) that also took out My Markup and the header progress bar.
//
// This is a plain Node test (no browser) -- what it verifies is repo
// configuration, not runtime behaviour, and the actual fix can't be
// verified end-to-end from inside this sandbox (no Vercel dashboard
// access, and npm install is blocked by this sandbox's own network
// policy -- see docs/PLAN.md's v94 section). What it CAN catch: a future
// edit accidentally removing or weakening vercel.json's static-passthrough
// settings, or removing a src/config/*.js file's <script src> reference
// without removing the file (or vice versa) -- either of which would
// silently reintroduce this exact failure mode.
const fs = require('fs');
const path = require('path');
const ROOT = path.resolve(__dirname, '..');

(async () => {
  const results = {};

  let vercelJson = null;
  try {
    vercelJson = JSON.parse(fs.readFileSync(path.join(ROOT, 'vercel.json'), 'utf8'));
  } catch (e) {
    results.vercelJsonParseError = e.message;
  }
  results.vercelJsonExists = !!vercelJson;
  results.frameworkIsNull = vercelJson && vercelJson.framework === null;
  results.buildCommandIsNull = vercelJson && vercelJson.buildCommand === null;
  results.outputDirectoryIsRoot = vercelJson && vercelJson.outputDirectory === '.';

  // The three config files this whole bug was about must still exist on
  // disk AND still be referenced from index.html as classic (non-module)
  // <script src> tags, in the same dependency order -- vercel.json fixes
  // *how* they're served, not whether they're wired up correctly, so this
  // is a separate, still-worthwhile check (verify_v92_config_split.js and
  // verify_v93_marker_icons.js already check the DOM/runtime side of this
  // via a file:// Playwright load; this checks the raw source instead, so
  // it also catches a mistake that a file:// load wouldn't -- e.g. a
  // reintroduced type="module" attribute, which works fine under file://
  // in this Chromium sandbox's own test runs but is exactly the thing that
  // makes Vite's bundler swallow a script, which is the failure mode this
  // whole file exists to guard against).
  const html = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
  const configFiles = ['src/config/constants.js', 'src/config/layers.js', 'src/config/icons.js'];
  results.allConfigFilesExistOnDisk = configFiles.every(f => fs.existsSync(path.join(ROOT, f)));
  const scriptTagRe = /<script([^>]*)\ssrc=["']([^"']+)["']([^>]*)>/g;
  const foundTags = {};
  let m;
  while ((m = scriptTagRe.exec(html))) {
    foundTags[m[2]] = m[1] + m[3];
  }
  results.allConfigFilesReferenced = configFiles.every(f => f in foundTags);
  results.noneAreModules = configFiles.every(f => !/type=["']module["']/.test(foundTags[f] || ''));
  // Dependency order matters (layers.js/icons.js read consts by bare name
  // from constants.js) -- classic <script> tags execute in document order.
  const idxOf = f => html.indexOf(`src="${f}"`);
  results.correctOrder = idxOf('src/config/constants.js') < idxOf('src/config/layers.js')
    && idxOf('src/config/layers.js') < idxOf('src/config/icons.js');

  // api/bylaw-fetch.js (v90) must still be a plain Vercel Function, which
  // Vercel detects independently of the framework/build settings above --
  // this vercel.json shouldn't (and doesn't need to) touch it, but a
  // regression here would mean the fix broke the other Vercel-dependent
  // feature while fixing this one.
  results.bylawFunctionStillExists = fs.existsSync(path.join(ROOT, 'api/bylaw-fetch.js'));
  results.vercelJsonHasNoFunctionsOverride = !vercelJson || !('functions' in vercelJson);

  const pass = results.vercelJsonExists === true
    && results.frameworkIsNull === true
    && results.buildCommandIsNull === true
    && results.outputDirectoryIsRoot === true
    && results.allConfigFilesExistOnDisk === true
    && results.allConfigFilesReferenced === true
    && results.noneAreModules === true
    && results.correctOrder === true
    && results.bylawFunctionStillExists === true
    && results.vercelJsonHasNoFunctionsOverride === true;

  console.log('=== RESULTS ===', JSON.stringify(results, null, 2));
  console.log(pass ? 'PASS' : 'FAIL');
  process.exit(pass ? 0 : 1);
})();
