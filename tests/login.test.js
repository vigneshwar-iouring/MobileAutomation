const DriverManager = require('../driver/DriverManager');
const SplashPage = require('../pages/SplashPage');
const LoginPage = require('../pages/LoginPage');
const permissionHandler = require('../utils/permissionHandler');
const { createLogger } = require('../utils/logger');

const { logFile } = createLogger('login');
console.log(`Logging this run to: ${logFile}`);

async function run() {
    const driver = await DriverManager.getDriver();

    try {
        const splashPage = new SplashPage(driver);
        const loginPage  = new LoginPage(driver);

        await splashPage.relaunch();
        await splashPage.pause(4000);
        await permissionHandler.dismissAllPermissions(driver);

        // Click Login ID field and enter credentials
        await loginPage.enterLoginId('tempmf11');

    } catch (err) {
        console.error('Test failed:', err.message);
    } finally {
        await DriverManager.closeDriver();
    }
}

run();
