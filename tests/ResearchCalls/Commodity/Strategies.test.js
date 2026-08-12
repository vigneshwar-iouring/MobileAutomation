const DriverManager = require('../../../driver/DriverManager');
const ResearchCalls = require('../../../pages/ResearchCalls');
const { logSection, countAndRunQuoteFlow } = require('../shared');

async function run() {
    const driver = await DriverManager.getDriver();
    try {
        const researchCalls = new ResearchCalls(driver);

        console.log('Step 1: Clicking hamburger menu...');
        await researchCalls.clickHamburgerMenu();

        console.log('Step 2: Clicking Research option...');
        await researchCalls.clickResearchOption();
        await researchCalls.waitForContent();

        logSection('COMMODITY - STRATEGIES');
        await researchCalls.clickCommodityTab();
        await researchCalls.clickStrategiesTab();
        await countAndRunQuoteFlow(driver, researchCalls, 'Commodity - Strategies', { skipScrollUp: true });

        await researchCalls.clickClose();
    } catch (err) {
        console.error('Test failed:', err.message);
        console.error(err.stack);
    } finally {
        await DriverManager.closeDriver();
    }
}

run();
