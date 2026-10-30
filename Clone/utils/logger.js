const fs = require('fs');
const path = require('path');
const { writeHtmlReport, writeReportData, writeSummary, writeLatestPointer, buildModuleDashboard, buildCompiledReport } = require('./reportBuilder');

function createLogger(testName) {
    const logsDir = path.join(__dirname, '..', 'logs');
    if (!fs.existsSync(logsDir)) {
        fs.mkdirSync(logsDir, { recursive: true });
    }

    const startTime = Date.now();
    const timestamp = new Date(startTime).toISOString().replace(/[:.]/g, '-');
    const logFile = path.join(logsDir, `${testName}_${timestamp}.log`);
    const stream = fs.createWriteStream(logFile, { flags: 'a' });

    const originalLog = console.log.bind(console);
    const originalError = console.error.bind(console);

    const format = (args) => args
        .map(a => (a instanceof Error ? a.stack : typeof a === 'object' ? JSON.stringify(a) : a))
        .join(' ');

    const entries = [];
    const classify = (message) => (/^\s*step\s+\d+/i.test(message) ? 'step' : 'info');

    console.log = (...args) => {
        originalLog(...args);
        const message = format(args);
        stream.write(`[${new Date().toISOString()}] ${message}\n`);
        entries.push({ time: Date.now(), level: classify(message), message });
    };

    console.error = (...args) => {
        originalError(...args);
        const message = format(args);
        stream.write(`[${new Date().toISOString()}] ERROR ${message}\n`);
        entries.push({ time: Date.now(), level: 'error', message });
    };

    // Runs when the process exits, however it got there (test finished, threw, or process.exit()
    // was called) - so every run, pass or fail, ends up with its own HTML report with no need for
    // each test file to remember to generate one itself.
    process.on('exit', () => {
        const endTime = Date.now();
        const status = entries.some(e => e.level === 'error') ? 'FAIL' : 'PASS';
        // The first error entry is the descriptive one every test's catch block logs first (e.g.
        // "Test failed: <message>" or "Real device error: <message>") - later entries are usually
        // just the stack trace, so this is what's worth surfacing in a report header/summary.
        const errorMessage = status === 'FAIL' ? (entries.find(e => e.level === 'error') || {}).message : null;
        try {
            const reportFile = writeHtmlReport({ testName, startTime, endTime, status, entries, errorMessage });
            const dataFile = writeReportData({ testName, startTime, endTime, status, entries });
            writeSummary({ testName, startTime, endTime, status, logFile, reportFile, errorMessage });
            writeLatestPointer({ testName, startTime, endTime, status, reportFile, dataFile, errorMessage });
            buildModuleDashboard();
            buildCompiledReport();
        } catch (err) {
            originalError('Failed to write HTML report:', err.message);
        }
    });

    return { logFile, entries };
}

// Scans a run's log entries and groups every failure - an explicit "FAIL" in the message, or an
// ERROR-level entry from a caught exception - under whichever "TC N:" step was most recently
// logged before it. This attributes a mid-TC crash to that TC the same way an inline assertion
// failure already is, without each test file needing its own currentStep-style tracking.
function getFailedTCs(entries) {
    let currentTC = null;
    const failuresByTC = new Map();
    for (const e of entries) {
        // Different test files label their steps "TC N:" or "Step N:" - both are tracked the
        // same way, prefixed in the summary with whichever word that file actually uses.
        const tcMatch = e.message.match(/(TC|Step) (\d+[a-z]?):/i);
        if (tcMatch) currentTC = `${tcMatch[1]} ${tcMatch[2]}`;
        const isFailure = e.level === 'error' || /FAIL/.test(e.message);
        if (isFailure && currentTC !== null) {
            if (!failuresByTC.has(currentTC)) failuresByTC.set(currentTC, []);
            failuresByTC.get(currentTC).push(e.message.trim());
        }
    }
    return [...failuresByTC.entries()].map(([tc, messages]) => ({ tc, messages }));
}

module.exports = { createLogger, getFailedTCs };
