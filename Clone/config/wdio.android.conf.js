const { config: baseConfig } = require('./wdio.base.conf');
const { handlePermissionDialog } = require('../utils/helpers');
const { androidCaps } = require('./caps.android');
const path = require('path');

exports.config = {
  ...baseConfig,

  hostname: process.env.APPIUM_HOST || '127.0.0.1',
  port:     parseInt(process.env.APPIUM_PORT) || 4723,
  path:     '/',

  capabilities: [{
    maxInstances: 1,   // single physical device — no parallel sessions
    ...androidCaps,
    // Grant POST_NOTIFICATIONS at session start so no runtime dialog blocks tests.
    'appium:permissions': `{"${process.env.APP_PACKAGE || 'com.iouring.globecapital.dev'}": {"POST_NOTIFICATIONS": "allow"}}`,
  }],

  beforeEach: async function () {
    await handlePermissionDialog();
  },

  mochaOpts: {
    ui:      'bdd',
    timeout: 300000,
  },

  services: [
    ['appium', {
      args:    { relaxedSecurity: true },
      logPath: path.join(__dirname, '../logs'),
    }],
  ],

  suites: {
    smoke:           [path.join(__dirname, '../tests/smoke/**/*.spec.js')],
    regression:      [path.join(__dirname, '../tests/**/*.spec.js')],
    login:           [path.join(__dirname, '../tests/login/**/*.spec.js')],
    signup:          [path.join(__dirname, '../tests/signup/**/*.spec.js')],
    watchlist:       [path.join(__dirname, '../tests/watchlist/**/*.spec.js')],
    'login-watchlist': [path.join(__dirname, '../tests/login-watchlist/**/*.spec.js')],
    quote:             [path.join(__dirname, '../tests/quote/quote.spec.js')],
    'quote-symbol':    [path.join(__dirname, '../tests/quote/quote.symbol-type.spec.js')],
    search:            [path.join(__dirname, '../tests/search/**/*.spec.js')],
    markets:           [path.join(__dirname, '../tests/markets/markets.spec.js')],
    order:             [path.join(__dirname, '../tests/order/**/*.spec.js')],
    'market-equity':   [path.join(__dirname, '../tests/markets/market_equity.spec.js')],
    'market-equity-1':  [path.join(__dirname, '../tests/markets/market_equity_1.spec.js')],
    'market-live-movers': [path.join(__dirname, '../tests/markets/market_live_movers.spec.js')],
    e2e:             [path.join(__dirname, '../tests/login-watchlist/**/*.spec.js')],
  },
};
