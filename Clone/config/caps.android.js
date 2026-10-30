const path = require('path');

const apkPath = path.join(__dirname, '../apps/android/base (3).apk');

// Target device configuration
const deviceConfig = {
  PIXEL_9A: {
    udid: process.env.PIXEL_9A_UDID || '5B181XEBF4PE41',
    deviceName: process.env.PIXEL_9A_NAME || 'Pixel 9a',
    platformVersion: process.env.PIXEL_9A_VERSION || '16',
    pin: process.env.PIXEL_9A_PIN || '2580',
  },
  PIXEL_4A: {
    udid: process.env.PIXEL_4A_UDID || '192.168.1.100:5555',
    deviceName: process.env.PIXEL_4A_NAME || 'Pixel 4a',
    platformVersion: process.env.PIXEL_4A_VERSION || '13',
    pin: process.env.PIXEL_4A_PIN || '11111',
  },
};

// Get target device from env, default to PIXEL_9A
const targetDevice = process.env.TARGET_DEVICE || 'PIXEL_9A';
const selectedDevice = deviceConfig[targetDevice] || deviceConfig.PIXEL_9A;

const androidCaps = {
  platformName: 'Android',
  'appium:automationName': 'UiAutomator2',
  'appium:udid':           selectedDevice.udid,
  'appium:deviceName':     selectedDevice.deviceName,
  'appium:platformVersion': selectedDevice.platformVersion,
  'appium:app':            apkPath,
  'appium:appPackage':     process.env.APP_PACKAGE  || 'com.iouring.globecapital.dev',
  'appium:appActivity':    process.env.APP_ACTIVITY || 'com.iouring.globecapital.MainActivity',
  'appium:noReset':        true,
  'appium:fullReset':      false,
  'appium:autoGrantPermissions':      true,
  'appium:newCommandTimeout':         300,
  'appium:ignoreHiddenApiPolicyError':true,
  'appium:enforceXPath1':             true,
  'appium:skipUnlock':                true,
  'appium:disableWindowAnimation':    true,
  // Prevent UiAutomator2 from waiting up to 10s for app idle before each command.
  // The Globe Capital live price feed keeps the UI thread busy, so idle never fires,
  // causing cascading timeouts across every before hook after login.
  'appium:waitForIdleTimeout':        0,
};

module.exports = { androidCaps, apkPath, targetDevice, selectedDevice };
