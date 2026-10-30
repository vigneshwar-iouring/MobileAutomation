const fs = require('fs');
const path = require('path');

// Dedicated, standalone HTML report just for Regression/New_Regression.spec.js - kept
// separate from utils/reportBuilder.js (which drives the plain-Node DriverManager-style
// tests' shared dashboard/compiled report) since this suite runs through a completely
// different framework (Mocha/WDIO, not DriverManager), per-test rather than per-file, and
// isn't part of that other reporting system's MODULE_REGISTRY.
const REPORTS_DIR = path.join(__dirname, '..', 'reports');

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
  h2 { margin-top: 28px; margin-bottom: 8px; }
  .meta { color:#555; margin-bottom: 16px; }
  .status { display:inline-block; padding:4px 12px; border-radius:4px; font-weight:bold; color:#fff; font-size:13px; }
  .status.passed  { background:#2e7d32; }
  .status.failed  { background:#c62828; }
  .status.skipped { background:#9e9e9e; }
  table { border-collapse: collapse; width:100%; background:#fff; box-shadow:0 1px 3px rgba(0,0,0,.1); margin-bottom:16px; }
  th, td { padding:8px 12px; border-bottom:1px solid #eee; text-align:left; font-size:14px; vertical-align:top; }
  th { background:#333; color:#fff; }
  tr.error td { color:#c62828; }
  .error-msg { color:#c62828; font-weight:600; margin-top:4px; }
  .logs { font-family: Consolas, monospace; font-size:12px; white-space:pre-wrap; background:#fafafa; border:1px solid #eee; padding:8px; max-height:280px; overflow:auto; margin:0; }
  details { margin-bottom:24px; background:#fff; box-shadow:0 1px 3px rgba(0,0,0,.1); border-radius:4px; }
  summary { cursor:pointer; padding:10px 14px; font-weight:600; list-style:none; display:flex; align-items:center; gap:10px; }
  summary::-webkit-details-marker { display:none; }
  details[open] summary { border-bottom:1px solid #eee; }
  .summary-body { padding:12px 14px; }
</style>
</head>
<body>
${body}
</body>
</html>`;
}

function errorMsgHtml(state, errorMessage) {
  return state === 'failed' && errorMessage ? `<div class="error-msg">Failed on: ${escapeHtml(errorMessage)}</div>` : '';
}

// results: [{ title, state: 'passed'|'failed'|'skipped', duration, error, logs: [{level,message}] }]
function renderReport({ suiteName, startTime, endTime, results }) {
  const passed = results.filter(r => r.state === 'passed').length;
  const failed = results.filter(r => r.state === 'failed').length;
  const skipped = results.filter(r => r.state === 'skipped').length;
  const overallStatus = failed > 0 ? 'failed' : (results.length ? 'passed' : 'skipped');

  const rows = results.map(r => {
    const logRows = (r.logs || []).map(l => `${l.level === 'error' ? '[ERROR] ' : ''}${l.message}`).join('\n');
    return `
  <details${r.state === 'failed' ? ' open' : ''}>
    <summary>
      <span class="status ${r.state}">${r.state.toUpperCase()}</span>
      <span>${escapeHtml(r.title)}</span>
      <span style="color:#888;font-weight:normal;">(${fmtDuration(r.duration)})</span>
    </summary>
    <div class="summary-body">
      ${errorMsgHtml(r.state, r.error)}
      ${logRows ? `<pre class="logs">${escapeHtml(logRows)}</pre>` : '<div style="color:#888;">No log output captured.</div>'}
    </div>
  </details>`;
  }).join('\n');

  const body = `
  <h1>${escapeHtml(suiteName)}</h1>
  <div class="meta">
    ${new Date(startTime).toLocaleString()} &rarr; ${new Date(endTime).toLocaleString()} (${fmtDuration(endTime - startTime)})
    &nbsp; <span class="status ${overallStatus}">${overallStatus.toUpperCase()}</span>
    &nbsp; ${results.length} test case(s) &nbsp;|&nbsp;
    <span class="status passed">PASSED</span> ${passed} &nbsp;
    <span class="status failed">FAILED</span> ${failed} &nbsp;
    <span class="status skipped">SKIPPED</span> ${skipped}
  </div>
${rows}`;

  return pageShell(`${suiteName} - Regression Report`, body);
}

function ensureDir(dir) {
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
}

function writeReport({ suiteName, startTime, endTime, results }) {
  ensureDir(REPORTS_DIR);
  const timestamp = new Date(startTime).toISOString().replace(/[:.]/g, '-');
  const reportFile = path.join(REPORTS_DIR, `Regression_Report_${timestamp}.html`);
  fs.writeFileSync(reportFile, renderReport({ suiteName, startTime, endTime, results }));

  // Also refresh a stable, human-named file so it's easy to open without hunting for the
  // newest timestamp.
  const latestFile = path.join(REPORTS_DIR, 'Regression Report.html');
  fs.writeFileSync(latestFile, renderReport({ suiteName, startTime, endTime, results }));

  return reportFile;
}

module.exports = { writeReport };
