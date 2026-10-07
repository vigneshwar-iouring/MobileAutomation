require('dotenv').config();

const fs = require('fs');
const path = require('path');
const { writeReport } = require('../utils/regressionReportBuilder');

const SCREENSHOT_DIR = path.join(__dirname, '../reports/screenshots');
const LOGS_DIR = path.join(__dirname, '../logs');

// Captures every console.log/console.error line printed during each test case (started
// in beforeTest, read back in afterTest) so the standalone regression report can show
// the same step-by-step detail visible in the terminal, per test case, without needing a
// separate logging library - see utils/regressionReportBuilder.js.
let originalConsoleLog;
let originalConsoleError;
let capturedLogs = [];
let regressionResults = [];
let regressionSuiteStart = null;

function startLogCapture() {
  capturedLogs = [];
  originalConsoleLog = console.log;
  originalConsoleError = console.error;
  console.log = (...args) => {
    capturedLogs.push({ level: 'log', message: args.map(String).join(' ') });
    originalConsoleLog(...args);
  };
  console.error = (...args) => {
    capturedLogs.push({ level: 'error', message: args.map(String).join(' ') });
    originalConsoleError(...args);
  };
}

function stopLogCapture() {
  if (originalConsoleLog) console.log = originalConsoleLog;
  if (originalConsoleError) console.error = originalConsoleError;
  return capturedLogs;
}

// Ensure Android SDK is visible to the Appium subprocess on Windows
if (!process.env.ANDROID_HOME && process.env.LOCALAPPDATA) {
  process.env.ANDROID_HOME = `${process.env.LOCALAPPDATA}\\Android\\Sdk`;
  process.env.ANDROID_SDK_ROOT = process.env.ANDROID_HOME;
}

exports.config = {
  runner: 'local',

  specs: [path.join(__dirname, '../Regression/**/*.spec.js')],

  exclude: [],

  maxInstances: 1,

  logLevel: 'info',
  outputDir: LOGS_DIR,

  bail: 0,

  waitforTimeout: 10000,

  connectionRetryTimeout: 120000,

  connectionRetryCount: 3,

  // No 'services' entry - connects to the Appium server already running externally
  // (127.0.0.1:4723), the same setup every other test in this repo relies on, rather
  // than having wdio spawn/manage its own Appium instance.
  framework: 'mocha',

  reporters: ['spec'],

  mochaOpts: {
    ui: 'bdd',
    timeout: 60000,
  },

  beforeTest: function () {
    if (regressionSuiteStart === null) regressionSuiteStart = Date.now();
    startLogCapture();
  },

  // Save a screenshot to reports/screenshots/ on test failure, and record this test case
  // (status/duration/error/captured console output) for the standalone regression report
  // written in the "after" hook below.
  afterTest: async function (test, context, { error, passed, skipped, duration }) {
    const logs = stopLogCapture();
    regressionResults.push({
      title: test.title,
      // `skipped` is set when the test calls this.skip() itself (e.g. R34-R39 outside market
      // hours) - without it those would show as failed, since `passed` is false for a skip.
      state: skipped ? 'skipped' : (passed ? 'passed' : 'failed'),
      duration,
      error: error && error.message,
      logs,
    });

    if (error) {
      try {
        fs.mkdirSync(SCREENSHOT_DIR, { recursive: true });
        const safe = test.title.replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 80);
        const file = path.join(SCREENSHOT_DIR, `FAIL-${safe}-${Date.now()}.png`);
        await browser.saveScreenshot(file);
      } catch {}
    }
  },

  // Worker-level hook (runs once per spec file, in the SAME process as beforeTest/
  // afterTest above) - unlike onComplete, which runs in WDIO's separate launcher
  // process and so never sees regressionResults populated by the worker at all.
  after: function () {
    if (!regressionResults.length) return;
    const file = writeReport({
      suiteName: 'New_Regression.spec.js',
      startTime: regressionSuiteStart || Date.now(),
      endTime: Date.now(),
      results: regressionResults,
    });
    console.log(`\nRegression report written to: ${file}`);
  },
};
