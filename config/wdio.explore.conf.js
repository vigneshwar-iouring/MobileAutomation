const { config: base } = require('./wdio.base.conf');
const { androidCaps } = require('./caps.android');
const path = require('path');

exports.config = {
  ...base,

  hostname: process.env.APPIUM_HOST || '127.0.0.1',
  port:     parseInt(process.env.APPIUM_PORT) || 4723,
  path:     '/',

  specs: [path.join(__dirname, '../tests/explore/explore.spec.js')],

  capabilities: [{ ...androidCaps }],

  mochaOpts: {
    ui:      'bdd',
    timeout: 300000,
  },

  reporters: ['spec'],
  services: [
    ['appium', { args: { relaxedSecurity: true } }],
  ],
};
