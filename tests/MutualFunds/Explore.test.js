const DriverManager = require('../../driver/DriverManager');
const { MutualFundsPage } = require('../../pages/MutualFundsPage');
const { createLogger } = require('../../utils/logger');

const { logFile } = createLogger('MutualFundsExplore');
console.log(`Logging this run to: ${logFile}`);

async function run() {
    const driver = await DriverManager.getDriver();
    try {
        const mutualFundsPage = new MutualFundsPage(driver);

        console.log('Step 1: Opening Mutual Funds (bottom navigation)...');
        await mutualFundsPage.openMutualFunds();

        console.log('\nStep 2: Clicking Explore tab...');
        await mutualFundsPage.clickExploreTab();
        await driver.pause(1000);

        console.log('\nStep 3: Scrolling through Category Solutions and counting headers...');
        await mutualFundsPage.countCategorySolutionsHeaders();
    } catch (err) {
        console.error('Test failed:', err.message);
        console.error(err.stack);
    } finally {
        await DriverManager.closeDriver();
    }
}

run();
