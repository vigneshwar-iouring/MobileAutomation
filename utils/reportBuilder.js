const fs = require('fs');
const path = require('path');

const REPORTS_DIR = path.join(__dirname, '..', 'reports');
const SUMMARIES_DIR = path.join(REPORTS_DIR, '.summaries');
const LATEST_DIR = path.join(REPORTS_DIR, '.latest');
const DATA_DIR = path.join(REPORTS_DIR, '.data');

// Every module in the suite, by the exact name it passes to createLogger() - kept in one place so
// the dashboard can show "Not yet run" for anything that hasn't produced a report yet, instead of
// only listing whatever happens to already be on disk.
const MODULE_REGISTRY = [
    { group: 'Core / Auth', label: 'Launch App', testName: 'launchApp' },
    { group: 'Core / Auth', label: 'Login', testName: 'login' },
    { group: 'Core / Auth', label: 'Login With OTP', testName: 'loginWithOtp' },
    { group: 'Core / Auth', label: 'Forgot Password', testName: 'forgotPassword' },
    { group: 'Core / Auth', label: 'NC Forgot Password', testName: 'NCforgotpassword' },
    { group: 'Core / Auth', label: 'Logout', testName: 'logout' },
    { group: 'Core / Auth', label: 'Funds', testName: 'Funds' },
    { group: 'Core / Auth', label: 'Basket', testName: 'Basket' },
    { group: 'Core / Auth', label: 'News', testName: 'News' },
    { group: 'Mutual Funds', label: 'Home', testName: 'MutualFunds' },
    { group: 'Mutual Funds', label: 'Explore', testName: 'MutualFundsExplore' },
    { group: 'Mutual Funds', label: 'Portfolio', testName: 'MutualFundsPortfolio' },
    { group: 'Research Calls', label: 'Equity - Fundamental', testName: 'ResearchCalls-Equity-Fundamental' },
    { group: 'Research Calls', label: 'Equity - Technical', testName: 'ResearchCalls-Equity-Technical' },
    { group: 'Research Calls', label: 'Derivative - Technical', testName: 'ResearchCalls-Derivative-Technical' },
    { group: 'Research Calls', label: 'Derivative - Strategies', testName: 'ResearchCalls-Derivative-Strategies' },
    { group: 'Research Calls', label: 'Commodity - Technical', testName: 'ResearchCalls-Commodity-Technical' },
    { group: 'Research Calls', label: 'Commodity - Strategies', testName: 'ResearchCalls-Commodity-Strategies' }
];

function ensureDir(dir) {
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
}

function escapeHtml(str) {
    return String(str)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;');
}

function fmtDuration(ms) {
    return `${(ms / 1000).toFixed(1)}s`;
}

function pageShell(title, body) {
    return `<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8">
<title>${escapeHtml(title)}</title>
<style>
  body { font-family: Segoe UI, Arial, sans-serif; margin: 24px; background:#f7f7f9; color:#222; }
  h1 { margin-bottom: 4px; }
  a { color:#1565c0; text-decoration:none; }
  a:hover { text-decoration:underline; }
  .meta { color:#555; margin-bottom: 16px; }
  .status { display:inline-block; padding:4px 12px; border-radius:4px; font-weight:bold; color:#fff; font-size:13px; }
  .status.PASS { background:#2e7d32; }
  .status.FAIL { background:#c62828; }
  .status.NONE { background:#9e9e9e; }
  table { border-collapse: collapse; width:100%; background:#fff; box-shadow:0 1px 3px rgba(0,0,0,.1); margin-bottom:24px; }
  th, td { padding:8px 12px; border-bottom:1px solid #eee; text-align:left; font-size:14px; vertical-align:top; }
  th { background:#333; color:#fff; }
  tr.error td { color:#c62828; font-weight:600; }
  tr.step td { background:#eef5ff; }
  h2 { margin-top: 28px; margin-bottom: 8px; }
</style>
</head>
<body>
${body}
</body>
</html>`;
}

// Writes one test's own step-by-step HTML report (called automatically when the process exits -
// see logger.js). Status is FAIL whenever any console.error() line was logged during the run.
function writeHtmlReport({ testName, startTime, endTime, status, entries }) {
    ensureDir(REPORTS_DIR);
    const rows = entries.map(e => `
        <tr class="${e.level}">
            <td>${new Date(e.time).toLocaleTimeString()}</td>
            <td>${e.level.toUpperCase()}</td>
            <td>${escapeHtml(e.message)}</td>
        </tr>`).join('\n');

    const body = `
  <h1>${escapeHtml(testName)}</h1>
  <div class="meta">
    ${new Date(startTime).toLocaleString()} &rarr; ${new Date(endTime).toLocaleString()} (${fmtDuration(endTime - startTime)})
    &nbsp; <span class="status ${status}">${status}</span>
  </div>
  <table>
    <thead><tr><th>Time</th><th>Level</th><th>Message</th></tr></thead>
    <tbody>${rows}</tbody>
  </table>`;

    const timestamp = new Date(startTime).toISOString().replace(/[:.]/g, '-');
    const reportFile = path.join(REPORTS_DIR, `${testName}_${timestamp}.html`);
    fs.writeFileSync(reportFile, pageShell(`${testName} - Test Report`, body));
    return reportFile;
}

// Persists this run's full step-by-step entries as JSON, alongside the rendered HTML - lets
// buildCompiledReport() below re-embed the full detail of every module's *latest* run into one
// single file, instead of only linking out to each module's separate report.
function writeReportData({ testName, startTime, endTime, status, entries }) {
    ensureDir(DATA_DIR);
    const timestamp = new Date(startTime).toISOString().replace(/[:.]/g, '-');
    const dataFile = path.join(DATA_DIR, `${testName.replace(/[\\/]/g, '_')}_${timestamp}.json`);
    fs.writeFileSync(dataFile, JSON.stringify({ testName, startTime, endTime, status, entries }));
    return dataFile;
}

// Drops a small JSON summary for this test run, only when it's part of a suite run (RunAll.test.js
// sets REPORT_RUN_ID before spawning its children) - a standalone single-file run has nothing to
// aggregate into, so it just gets its own HTML report and skips this.
function writeSummary({ testName, startTime, endTime, status, logFile, reportFile }) {
    const runId = process.env.REPORT_RUN_ID;
    if (!runId) return;

    const dir = path.join(SUMMARIES_DIR, runId);
    ensureDir(dir);
    const file = path.join(dir, `${testName.replace(/[\\/]/g, '_')}_${startTime}.json`);
    fs.writeFileSync(file, JSON.stringify({ testName, startTime, endTime, status, logFile, reportFile }, null, 2));
}

// Records this test's most recent result, independent of any suite run - this is what the module
// dashboard (buildModuleDashboard) and the compiled report (buildCompiledReport) both read to find
// each module's latest status/detail.
function writeLatestPointer({ testName, startTime, endTime, status, reportFile, dataFile }) {
    ensureDir(LATEST_DIR);
    const file = path.join(LATEST_DIR, `${testName.replace(/[\\/]/g, '_')}.json`);
    fs.writeFileSync(file, JSON.stringify({ testName, startTime, endTime, status, reportFile, dataFile }, null, 2));
}

// Builds reports/index.html - one high-level page listing every module in MODULE_REGISTRY with its
// latest run status, timestamp and a link to that module's own detailed report. Regenerated on
// every test exit (see logger.js) so it always reflects the latest state, not just after a suite
// run. Any report found under .latest/ that isn't in MODULE_REGISTRY (e.g. a newly added test file
// that hasn't been registered yet) is still listed, under "Other".
function buildModuleDashboard() {
    ensureDir(LATEST_DIR);
    const latestByTestName = {};
    for (const file of fs.readdirSync(LATEST_DIR).filter(f => f.endsWith('.json'))) {
        const data = JSON.parse(fs.readFileSync(path.join(LATEST_DIR, file), 'utf8'));
        latestByTestName[data.testName] = data;
    }

    const known = new Set(MODULE_REGISTRY.map(m => m.testName));
    const extras = Object.keys(latestByTestName)
        .filter(name => !known.has(name))
        .map(name => ({ group: 'Other', label: name, testName: name }));

    const rows = [...MODULE_REGISTRY, ...extras].map(m => {
        const latest = latestByTestName[m.testName];
        if (!latest) {
            return { group: m.group, label: m.label, statusHtml: '<span class="status NONE">NOT RUN</span>', lastRun: '-', link: '' };
        }
        const link = `<a href="${path.basename(latest.reportFile)}">Report</a>`;
        return {
            group: m.group,
            label: m.label,
            statusHtml: `<span class="status ${latest.status}">${latest.status}</span>`,
            lastRun: new Date(latest.endTime).toLocaleString(),
            link
        };
    });

    const groups = [...new Set(rows.map(r => r.group))];
    const sections = groups.map(group => {
        const groupRows = rows.filter(r => r.group === group).map(r => `
        <tr>
            <td>${escapeHtml(r.label)}</td>
            <td>${r.statusHtml}</td>
            <td>${escapeHtml(r.lastRun)}</td>
            <td>${r.link}</td>
        </tr>`).join('\n');

        return `
  <h2>${escapeHtml(group)}</h2>
  <table>
    <thead><tr><th>Module</th><th>Status</th><th>Last Run</th><th>Report</th></tr></thead>
    <tbody>${groupRows}</tbody>
  </table>`;
    }).join('\n');

    const total = rows.length;
    const passed = rows.filter(r => r.statusHtml.includes('>PASS<')).length;
    const failed = rows.filter(r => r.statusHtml.includes('>FAIL<')).length;
    const notRun = rows.filter(r => r.statusHtml.includes('>NOT RUN<')).length;

    const body = `
  <h1>Test Modules - High Level Report</h1>
  <div class="meta">
    Generated ${new Date().toLocaleString()} &nbsp;
    ${total} module(s) &nbsp;|&nbsp;
    <span class="status PASS">PASS</span> ${passed} &nbsp;
    <span class="status FAIL">FAIL</span> ${failed} &nbsp;
    <span class="status NONE">NOT RUN</span> ${notRun}
  </div>
${sections}`;

    ensureDir(REPORTS_DIR);
    const reportFile = path.join(REPORTS_DIR, 'index.html');
    fs.writeFileSync(reportFile, pageShell('Test Modules - High Level Report', body));
    return reportFile;
}

// Builds reports/Compiled_Report.html - ONE file containing every executed module's full step log,
// one after another, so running each test individually (in any order, over any number of separate
// launches) still ends up compiled into a single report instead of scattered files. Regenerated on
// every test exit (see logger.js), each module's section always reflects its most recent run.
// Modules that haven't been run yet are listed with a "NOT RUN" placeholder and no detail table.
function buildCompiledReport() {
    ensureDir(LATEST_DIR);
    const latestByTestName = {};
    for (const file of fs.readdirSync(LATEST_DIR).filter(f => f.endsWith('.json'))) {
        const data = JSON.parse(fs.readFileSync(path.join(LATEST_DIR, file), 'utf8'));
        latestByTestName[data.testName] = data;
    }

    const known = new Set(MODULE_REGISTRY.map(m => m.testName));
    const extras = Object.keys(latestByTestName)
        .filter(name => !known.has(name))
        .map(name => ({ group: 'Other', label: name, testName: name }));
    const allModules = [...MODULE_REGISTRY, ...extras];

    const executed = allModules.filter(m => latestByTestName[m.testName]);
    const notRun = allModules.filter(m => !latestByTestName[m.testName]);

    const passed = executed.filter(m => latestByTestName[m.testName].status === 'PASS').length;
    const failed = executed.filter(m => latestByTestName[m.testName].status === 'FAIL').length;
    const overallStatus = executed.length && failed === 0 ? 'PASS' : (failed > 0 ? 'FAIL' : 'NONE');

    const sections = executed.map(m => {
        const latest = latestByTestName[m.testName];
        let entries = [];
        try {
            entries = latest.dataFile ? JSON.parse(fs.readFileSync(latest.dataFile, 'utf8')).entries : [];
        } catch (_) {
            entries = [];
        }

        const rows = entries.map(e => `
        <tr class="${e.level}">
            <td>${new Date(e.time).toLocaleTimeString()}</td>
            <td>${e.level.toUpperCase()}</td>
            <td>${escapeHtml(e.message)}</td>
        </tr>`).join('\n');

        return `
  <h2>${escapeHtml(m.group)} - ${escapeHtml(m.label)} <span class="status ${latest.status}">${latest.status}</span></h2>
  <div class="meta">
    ${new Date(latest.startTime).toLocaleString()} &rarr; ${new Date(latest.endTime).toLocaleString()} (${fmtDuration(latest.endTime - latest.startTime)})
  </div>
  <table>
    <thead><tr><th>Time</th><th>Level</th><th>Message</th></tr></thead>
    <tbody>${rows}</tbody>
  </table>`;
    }).join('\n');

    const notRunRows = notRun.map(m => `
        <tr>
            <td>${escapeHtml(m.group)}</td>
            <td>${escapeHtml(m.label)}</td>
            <td><span class="status NONE">NOT RUN</span></td>
        </tr>`).join('\n');

    const notRunSection = notRun.length ? `
  <h2>Not Yet Run</h2>
  <table>
    <thead><tr><th>Group</th><th>Module</th><th>Status</th></tr></thead>
    <tbody>${notRunRows}</tbody>
  </table>` : '';

    const body = `
  <h1>Compiled Test Report</h1>
  <div class="meta">
    Generated ${new Date().toLocaleString()} &nbsp;
    ${executed.length}/${allModules.length} module(s) executed &nbsp;|&nbsp;
    <span class="status PASS">PASS</span> ${passed} &nbsp;
    <span class="status FAIL">FAIL</span> ${failed} &nbsp;
    <span class="status NONE">NOT RUN</span> ${notRun.length} &nbsp;|&nbsp;
    Overall: <span class="status ${overallStatus}">${overallStatus}</span>
  </div>
${sections}
${notRunSection}`;

    ensureDir(REPORTS_DIR);
    const reportFile = path.join(REPORTS_DIR, 'Compiled_Report.html');
    fs.writeFileSync(reportFile, pageShell('Compiled Test Report', body));
    return reportFile;
}

// Aggregates every module's summary written under REPORT_RUN_ID into one combined suite report -
// called by a RunAll.test.js after all of its spawned child processes have finished.
function buildSuiteReport(runId, suiteName) {
    const dir = path.join(SUMMARIES_DIR, runId);
    if (!fs.existsSync(dir)) {
        console.error(`No module summaries found for run ${runId}`);
        return null;
    }

    const modules = fs.readdirSync(dir)
        .filter(f => f.endsWith('.json'))
        .map(f => JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8')))
        .sort((a, b) => a.startTime - b.startTime);

    if (!modules.length) return null;

    const suiteStart = Math.min(...modules.map(m => m.startTime));
    const suiteEnd = Math.max(...modules.map(m => m.endTime));
    const overallStatus = modules.every(m => m.status === 'PASS') ? 'PASS' : 'FAIL';

    const rows = modules.map(m => `
        <tr>
            <td>${escapeHtml(m.testName)}</td>
            <td><span class="status ${m.status}">${m.status}</span></td>
            <td>${fmtDuration(m.endTime - m.startTime)}</td>
            <td><a href="${path.basename(m.reportFile)}">Report</a></td>
        </tr>`).join('\n');

    const body = `
  <h1>${escapeHtml(suiteName)}</h1>
  <div class="meta">
    ${new Date(suiteStart).toLocaleString()} &rarr; ${new Date(suiteEnd).toLocaleString()} (${fmtDuration(suiteEnd - suiteStart)})
    &nbsp; <span class="status ${overallStatus}">${overallStatus}</span>
    &nbsp; ${modules.length} module(s)
  </div>
  <table>
    <thead><tr><th>Module</th><th>Status</th><th>Duration</th><th>Report</th></tr></thead>
    <tbody>${rows}</tbody>
  </table>`;

    ensureDir(REPORTS_DIR);
    const reportFile = path.join(REPORTS_DIR, `${suiteName}_${runId}.html`);
    fs.writeFileSync(reportFile, pageShell(`${suiteName} - Suite Report`, body));
    return reportFile;
}

module.exports = {
    writeHtmlReport,
    writeReportData,
    writeSummary,
    writeLatestPointer,
    buildSuiteReport,
    buildModuleDashboard,
    buildCompiledReport,
    REPORTS_DIR
};
