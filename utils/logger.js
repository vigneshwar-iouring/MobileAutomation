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
        try {
            const reportFile = writeHtmlReport({ testName, startTime, endTime, status, entries });
            const dataFile = writeReportData({ testName, startTime, endTime, status, entries });
            writeSummary({ testName, startTime, endTime, status, logFile, reportFile });
            writeLatestPointer({ testName, startTime, endTime, status, reportFile, dataFile });
            buildModuleDashboard();
            buildCompiledReport();
        } catch (err) {
            originalError('Failed to write HTML report:', err.message);
        }
    });

    return { logFile };
}

module.exports = { createLogger };
