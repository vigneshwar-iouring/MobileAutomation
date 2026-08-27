const DriverManager = require('../../../driver/DriverManager');
const ResearchCalls = require('../../../pages/ResearchCalls');
const { logSection, countAndRunQuoteFlow } = require('../shared');
const { createLogger } = require('../../../utils/logger');

const { logFile } = createLogger('ResearchCalls-Equity-Fundamental');
console.log(`Logging this run to: ${logFile}`);

async function run() {
    const driver = await DriverManager.getDriver();
    try {
        const researchCalls = new ResearchCalls(driver);

        console.log('Step 1: Clicking hamburger menu...');
        await researchCalls.clickHamburgerMenu();

        console.log('Step 2: Clicking Research option...');
        await researchCalls.clickResearchOption();
        await researchCalls.waitForContent();

        logSection('EQUITY - FUNDAMENTAL');
        await researchCalls.clickEquityTab();
        await researchCalls.clickFundamentalTab();
        await countAndRunQuoteFlow(driver, researchCalls, 'Equity - Fundamental', { skipScrollUp: true });

        await researchCalls.clickClose();
    } catch (err) {
        console.error('Test failed:', err.message);
        console.error(err.stack);
    } finally {
        await DriverManager.closeDriver();
    }
}

run();
