require('dotenv').config();

const fs   = require('fs');
const path = require('path');

const SCREENSHOT_DIR = path.join(__dirname, '../reports/screenshots');
const LOGS_DIR       = path.join(__dirname, '../logs');

// Ensure Android SDK is visible to the Appium subprocess on Windows
if (!process.env.ANDROID_HOME && process.env.LOCALAPPDATA) {
  process.env.ANDROID_HOME = `${process.env.LOCALAPPDATA}\\Android\\Sdk`;
  process.env.ANDROID_SDK_ROOT = process.env.ANDROID_HOME;
}

exports.config = {
  runner: 'local',

  specs: [path.join(__dirname, '../tests/**/*.spec.js')],

  exclude: [],

  maxInstances: 1,

  logLevel: 'info',
  outputDir: LOGS_DIR,

  bail: 0,

  waitforTimeout: 10000,

  connectionRetryTimeout: 120000,

  connectionRetryCount: 3,

  services: ['appium'],

  framework: 'mocha',

  reporters: [
    'spec',
    [
      'allure',
      {
        outputDir: 'allure-results',
        disableWebdriverStepsReporting: false,
        disableWebdriverScreenshotsReporting: false,
      },
    ],
  ],

  mochaOpts: {
    ui: 'bdd',
    timeout: 60000,
  },

  // Save a screenshot to reports/screenshots/ on test failure.
  // Filename: FAIL-<sanitized-test-title>-<timestamp>.png
  afterTest: async function (test, context, { error }) {
    if (error) {
      try {
        fs.mkdirSync(SCREENSHOT_DIR, { recursive: true });
        const safe  = test.title.replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 80);
        const file  = path.join(SCREENSHOT_DIR, `FAIL-${safe}-${Date.now()}.png`);
        await browser.saveScreenshot(file);
      } catch {}
    }
  },
};
