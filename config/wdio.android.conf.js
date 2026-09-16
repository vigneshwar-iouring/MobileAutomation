const { config: baseConfig } = require('./wdio.base.conf');
const { handlePermissionDialog } = require('../utils/helpers');
const { androidCaps } = require('./caps.android');
const path = require('path');

exports.config = {
  ...baseConfig,

  hostname: process.env.APPIUM_HOST || '127.0.0.1',
  port: parseInt(process.env.APPIUM_PORT) || 4723,
  path: '/',

  capabilities: [{
    maxInstances: 1, // single physical device - no parallel sessions
    ...androidCaps,
    // Grant POST_NOTIFICATIONS at session start so no runtime dialog blocks tests.
    'appium:permissions': `{"${process.env.APP_PACKAGE || 'com.iouring.globecapital'}": {"POST_NOTIFICATIONS": "allow"}}`,
  }],

  beforeEach: async function () {
    await handlePermissionDialog();
  },

  mochaOpts: {
    ui: 'bdd',
    timeout: 300000,
  },

  suites: {
    regression: [path.join(__dirname, '../Regression/**/*.spec.js')],
  },
};
