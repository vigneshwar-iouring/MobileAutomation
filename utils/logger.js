const fs = require('fs');
const path = require('path');

function createLogger(testName) {
    const logsDir = path.join(__dirname, '..', 'logs');
    if (!fs.existsSync(logsDir)) {
        fs.mkdirSync(logsDir, { recursive: true });
    }

    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const logFile = path.join(logsDir, `${testName}_${timestamp}.log`);
    const stream = fs.createWriteStream(logFile, { flags: 'a' });

    const originalLog = console.log.bind(console);
    const originalError = console.error.bind(console);

    const format = (args) => args
        .map(a => (a instanceof Error ? a.stack : typeof a === 'object' ? JSON.stringify(a) : a))
        .join(' ');

    console.log = (...args) => {
        originalLog(...args);
        stream.write(`[${new Date().toISOString()}] ${format(args)}\n`);
    };

    console.error = (...args) => {
        originalError(...args);
        stream.write(`[${new Date().toISOString()}] ERROR ${format(args)}\n`);
    };

    return { logFile };
}

module.exports = { createLogger };
