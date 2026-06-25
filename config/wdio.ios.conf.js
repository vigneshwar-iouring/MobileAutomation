const { config: baseConfig } = require('./wdio.base.conf');
const path = require('path');

const appPath = process.env.IOS_APP_PATH || path.join(__dirname, '../apps/ios/MyApp.app');

exports.config = {
  ...baseConfig,

  hostname: process.env.APPIUM_HOST || '127.0.0.1',
  port: parseInt(process.env.APPIUM_PORT) || 4723,
  path: '/',

  capabilities: [
    {
      platformName: 'iOS',
      'appium:automationName': 'XCUITest',
      'appium:deviceName': process.env.IOS_DEVICE || 'iPhone 15',
      'appium:platformVersion': process.env.IOS_VERSION || '17.0',
      'appium:app': appPath,
      'appium:bundleId': process.env.BUNDLE_ID || 'com.example.app',
      'appium:noReset': false,
      'appium:fullReset': false,
      'appium:newCommandTimeout': 60,
      'appium:wdaLocalPort': 8100,
    },
  ],

  suites: {
    smoke:      [path.join(__dirname, '../tests/smoke/**/*.spec.js')],
    regression: [path.join(__dirname, '../tests/**/*.spec.js')],
    login:      [path.join(__dirname, '../tests/login/**/*.spec.js')],
  },
};
