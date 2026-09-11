#!/usr/bin/env node
// Test runner for the network-stubbed Playwright verification suite.
//
// These scripts predate this repository -- each one was written ad hoc
// alongside a specific bug fix and run manually (see docs/CHANGELOG.md for
// which version each corresponds to). This runner is what turns that habit
// into something CI can actually check: every verify_*.js in this directory
// is executed against the current index.html, and the run fails if any
// script exits non-zero OR reports a console/page error under
// "=== errors ===" (the convention every one of these scripts follows).
//
// This does not replace writing real assert()-style tests going forward --
// see docs/PLAN.md for that -- but it means today's whole suite is a single
// `npm test` instead of nine scripts run by hand.
const { spawnSync } = require("child_process");
const fs = require("fs");
const path = require("path");

const dir = __dirname;
const files = fs
  .readdirSync(dir)
  .filter((f) => f.startsWith("verify_") && f.endsWith(".js"))
  .sort();

if (files.length === 0) {
  console.error("No verify_*.js scripts found in tests/.");
  process.exit(1);
}

let failed = 0;
const results = [];

for (const file of files) {
  const full = path.join(dir, file);
  const start = Date.now();
  const proc = spawnSync("node", [full], { encoding: "utf8", timeout: 120000 });
  const ms = Date.now() - start;
  const stdout = proc.stdout || "";
  const stderr = proc.stderr || "";

  const errorsLine = /=== errors ===\s*([\s\S]*?)\n=== RESULTS ===/.exec(stdout);
  const reportedErrors = errorsLine && errorsLine[1].trim() !== "(none)";
  const nonZeroExit = proc.status !== 0 && proc.status !== null;
  const crashed = !!proc.error;

  const ok = !nonZeroExit && !crashed && !reportedErrors;
  if (!ok) failed++;

  results.push({ file, ok, ms, nonZeroExit, crashed, reportedErrors });
  console.log(`${ok ? "PASS" : "FAIL"}  ${file}  (${ms}ms)`);
  if (!ok) {
    if (crashed) console.log("  runner error:", proc.error.message);
    if (nonZeroExit) console.log("  exit code:", proc.status);
    if (reportedErrors) console.log("  reported errors:\n" + errorsLine[1].trim().split("\n").map((l) => "    " + l).join("\n"));
    if (stderr.trim()) console.log("  stderr:\n" + stderr.trim().split("\n").map((l) => "    " + l).join("\n"));
  }
}

console.log("");
console.log(`${results.length - failed}/${results.length} passed`);
process.exit(failed ? 1 : 0);
