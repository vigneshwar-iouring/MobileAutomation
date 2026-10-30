const path = require('path');
const { spawnSync } = require('child_process');
const { buildSuiteReport } = require('../../utils/reportBuilder');

// Runs the whole Watchlist suite end-to-end as one "Run": each test file below still opens/closes
// its own driver session (same as running it individually), but this launches them back to back as
// separate node processes so a single click runs all of them in order and stops at the first
// failure.
const SUITE = [
    'Watchlist.test.js',
    'Index.test.js',
    'ManageIndex.test.js'
];

// Every spawned child inherits this via env: process.env below - it's how each module's own HTML
// report gets grouped into one combined suite report afterwards (see utils/reportBuilder.js).
const runId = `Watchlist_${Date.now()}`;
process.env.REPORT_RUN_ID = runId;

let exitCode = 0;

for (const file of SUITE) {
    const fullPath = path.join(__dirname, file);
    console.log(`\n=== Running ${file} ===\n`);

    const result = spawnSync(process.execPath, [fullPath], {
        stdio: 'inherit',
        env: process.env
    });

    if (result.status !== 0) {
        console.error(`\n${file} failed (exit code ${result.status}) - stopping Watchlist suite`);
        exitCode = result.status ?? 1;
        break;
    }
}

const reportFile = buildSuiteReport(runId, 'Watchlist');
if (reportFile) {
    console.log(`\nWatchlist suite HTML report: ${reportFile}`);
}

console.log(exitCode === 0 ? '\nWatchlist suite completed successfully' : '\nWatchlist suite failed');
process.exit(exitCode);
