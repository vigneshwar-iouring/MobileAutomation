const devices = require('./devices.config');

const deviceType = process.env.DEVICE_TYPE || 'real';
const device = devices[deviceType];

if (!device) {
    throw new Error(`Unknown DEVICE_TYPE "${deviceType}". Use "real" or "emulator".`);
}

console.log(`Running on: ${deviceType} → ${device.deviceName} (${device.udid})`);

const capabilities = {
    platformName:               'Android',
    'appium:automationName':    'UiAutomator2',
    'appium:deviceName':        device.deviceName,
    'appium:udid':              device.udid,
    'appium:appPackage':        'com.iouring.globecapital.dev',
    'appium:appActivity':       'com.iouring.globecapital.MainActivity',
    'appium:noReset':           device.noReset,
    'appium:newCommandTimeout': 60,
};

// Only add avdName for emulator so Appium can auto-launch it
if (device.avdName) {
    capabilities['appium:avd'] = device.avdName;
}

const AppiumConfig = {
    protocol: 'http',
    hostname: '127.0.0.1',
    port:     4723,
    path:     '/',
    logLevel: 'silent',
    capabilities,
};

module.exports = AppiumConfig;
