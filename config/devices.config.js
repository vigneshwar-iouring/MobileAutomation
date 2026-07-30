const devices = {
    real: {
        deviceName: 'Pixel 4a',      // From: adb devices
        udid: '14081JEC205128',
        avdName: null,
        noReset: true,
    },
    real1: {
        deviceName: 'Oneplus 6',      // From: adb devices
        udid: '885feee4',
        avdName: null,
        noReset: true,
    },
    emulator: {
        deviceName: 'Pixel_4a',       // AVD name from: emulator -list-avds
        udid: 'emulator-5554',   // UDID from: adb devices (when emulator is running)
        avdName: 'Pixel_4a',        // Appium will auto-launch this AVD if not already running
        noReset: true,
    }
};

module.exports = devices;
