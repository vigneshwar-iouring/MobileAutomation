// Reuses this repo's own device registry (config/devices.config.js) rather than the
// Clone project's PIXEL_9A/PIXEL_4A list, so DEVICE_TYPE matches the same "real"/
// "real1"/"emulator" values every other test in this repo already uses.
const devices = require('./devices.config');

const deviceType = process.env.DEVICE_TYPE || 'real';
const device = devices[deviceType];

if (!device) {
  throw new Error(`Unknown DEVICE_TYPE "${deviceType}". Use "real", "real1", or "emulator".`);
}

const androidCaps = {
  platformName: 'Android',
  'appium:automationName': 'UiAutomator2',
  'appium:udid': device.udid,
  'appium:deviceName': device.deviceName,
  // No .dev suffix - matches the app package already proven to work against the real
  // device elsewhere in this repo (config/appium.config.js), not Clone's appPackage default.
  'appium:appPackage': process.env.APP_PACKAGE || 'com.iouring.globecapital',
  'appium:appActivity': process.env.APP_ACTIVITY || 'com.iouring.globecapital.MainActivity',
  'appium:noReset': device.noReset,
  'appium:autoGrantPermissions': true,
  'appium:newCommandTimeout': 300,
  'appium:ignoreHiddenApiPolicyError': true,
  'appium:enforceXPath1': true,
  'appium:skipUnlock': true,
  'appium:disableWindowAnimation': true,
  // Prevent UiAutomator2 from waiting up to 10s for app idle before each command - the
  // Globe Capital live price feed keeps the UI thread busy, so idle never fires.
  'appium:waitForIdleTimeout': 0,
};

if (device.avdName) {
  androidCaps['appium:avd'] = device.avdName;
}

module.exports = { androidCaps };
