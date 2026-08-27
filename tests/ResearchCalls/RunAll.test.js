const path = require('path');
const { spawnSync } = require('child_process');
const { buildSuiteReport } = require('../../utils/reportBuilder');

// Runs the whole Research Calls suite end-to-end as one "Run": each test file below still opens/
// closes its own driver session (same as running it individually), but this launches them back to
// back as separate node processes so a single click runs all of them in order and stops at the
// first failure.
const SUITE = [
    'Equity/Fundamental.test.js',
    'Equity/Technical.test.js',
    'Derivative/Technical.test.js',
    'Derivative/Strategies.test.js',
    'Commodity/Technical.test.js',
    'Commodity/Strategies.test.js'
];

// Every spawned child inherits this via env: process.env below - it's how each module's own HTML
// report gets grouped into one combined suite report afterwards (see utils/reportBuilder.js).
const runId = `ResearchCalls_${Date.now()}`;
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
        console.error(`\n${file} failed (exit code ${result.status}) - stopping Research Calls suite`);
        exitCode = result.status ?? 1;
        break;
    }
}

const reportFile = buildSuiteReport(runId, 'ResearchCalls');
if (reportFile) {
    console.log(`\nResearch Calls suite HTML report: ${reportFile}`);
}

console.log(exitCode === 0 ? '\nResearch Calls suite completed successfully' : '\nResearch Calls suite failed');
process.exit(exitCode);
