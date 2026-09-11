// Shared browser-launch helper for the verification suite.
//
// This sandbox pins Chromium at /opt/pw-browsers/chromium via
// PLAYWRIGHT_BROWSERS_PATH rather than a normal `npx playwright install`.
// A real dev machine or CI runner won't have that exact path, so this
// falls back to Playwright's own default resolution (which already reads
// PLAYWRIGHT_BROWSERS_PATH itself) anywhere that specific file doesn't
// exist, instead of hardcoding one environment's layout into every test.
const fs = require("fs");

const SANDBOX_CHROMIUM = "/opt/pw-browsers/chromium";

function launchOpts() {
  const opts = { args: ["--no-sandbox"] };
  if (fs.existsSync(SANDBOX_CHROMIUM)) opts.executablePath = SANDBOX_CHROMIUM;
  return opts;
}

module.exports = { launchOpts };
