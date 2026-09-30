// Reminder test (v109). The BC Hunting and Trapping Regulations Synopsis is
// republished every two years. Once SYNOPSIS_VALID_UNTIL
// (src/config/constants.js) has passed, this test FAILS on purpose: update
// SYNOPSIS_EDITION, SYNOPSIS_VALID_UNTIL and the regional PDF file names in
// SYNOPSIS_REGION_PDFS, and re-check any rule the report quotes from the
// Synopsis (buffers, the 100 m occupied-building rule, road allowance).
const fs = require('fs');
const path = require('path');
const src = fs.readFileSync(path.join(__dirname, '..', 'src/config/constants.js'), 'utf8');
const until = (src.match(/SYNOPSIS_VALID_UNTIL\s*=\s*"([^"]+)"/) || [])[1];
const edition = (src.match(/SYNOPSIS_EDITION\s*=\s*"([^"]+)"/) || [])[1];
const end = until && new Date(until + 'T23:59:59-07:00');
const ok = !!end && !isNaN(end) && new Date() <= end;
console.log('=== errors ===', '(none)');
console.log(`Synopsis edition ${edition}, valid until ${until}.`);
if (!ok) console.log('The Synopsis has expired. Update the Synopsis constants and quoted rules (see this file\'s header).');
console.log(ok ? 'PASS' : 'FAIL');
process.exit(ok ? 0 : 1);
