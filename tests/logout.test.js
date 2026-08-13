const DriverManager = require('../driver/DriverManager');
const LoginPage = require('../pages/LoginPage');
const { createLogger } = require('../utils/logger');

const { logFile } = createLogger('logout');
console.log(`Logging this run to: ${logFile}`);

async function run() {
    const driver = await DriverManager.getDriver();

    try {
        const loginPage = new LoginPage(driver);

        console.log('Step 1: Checking logged-in state...');
        if (!(await loginPage.isLoggedIn())) {
            console.log('Not currently logged in - nothing to do');
            return;
        }

        console.log('Step 2: Logging out...');
        await loginPage.logout();
        await driver.pause(2000);

        const stillLoggedIn = await loginPage.isLoggedIn(3000);
        console.log(stillLoggedIn ? 'Logout did not take effect - still on the home screen' : 'Logout successful');

    } catch (err) {
        console.error('Test failed:', err.message);
        console.error(err.stack);
    } finally {
        await DriverManager.closeDriver();
    }
}

run();
