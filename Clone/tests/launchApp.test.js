const DriverManager = require('../driver/DriverManager');
const SplashPage = require('../pages/SplashPage');
const permissionHandler = require('../utils/permissionHandler');
const { createLogger, getFailedTCs } = require('../utils/logger');

const { logFile, entries } = createLogger('launchApp');
console.log(`Logging this run to: ${logFile}`);

async function run() {
    const driver = await DriverManager.getDriver();

    try {
        const splashPage = new SplashPage(driver);

        await splashPage.launch();
        await splashPage.pause(3000);
        console.log('TC 1: App launched');

        await permissionHandler.dismissAllPermissions(driver);
        await splashPage.pause(1500);
        console.log('TC 2: Permissions handled');

        const appLoaded = await splashPage.isAppLoaded();
        if (appLoaded) {
            console.log('TC 3: App loaded successfully — Launch test PASSED');
        } else {
            console.log('TC 3: App load not verified — check element selectors');
        }

    } catch (err) {
        console.error('Test failed:', err.message);
    } finally {
        await DriverManager.closeDriver();

        const failedTCs = getFailedTCs(entries);
        if (failedTCs.length) {
            console.log('\n=== Failed Test Cases ===');
            failedTCs.forEach(f => {
                console.log(`${f.tc}:`);
                f.messages.forEach(m => console.log(`  - ${m}`));
            });
        } else {
            console.log('\nAll test cases passed.');
        }
    }
}

run();
