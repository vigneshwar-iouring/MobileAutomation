const { remote } = require('webdriverio');
const AppiumConfig = require('../config/appium.config');

let driverInstance = null;

const DriverManager = {
    async getDriver() {
        if (!driverInstance) {
            driverInstance = await remote(AppiumConfig);
            console.log('Driver session created');
        }
        return driverInstance;
    },

    async closeDriver() {
        if (driverInstance) {
            await driverInstance.deleteSession();
            driverInstance = null;
            console.log('Driver session closed');
        }
    }
};

module.exports = DriverManager;
