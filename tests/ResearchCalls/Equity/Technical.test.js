const DriverManager = require('../../../driver/DriverManager');
const ResearchCalls = require('../../../pages/ResearchCalls');
const { logSection, countAndRunQuoteFlow } = require('../shared');
const { createLogger } = require('../../../utils/logger');

const { logFile } = createLogger('ResearchCalls-Equity-Technical');
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

        logSection('EQUITY - TECHNICAL');
        await researchCalls.clickEquityTab();
        await researchCalls.clickTechnicalTab();
        await countAndRunQuoteFlow(driver, researchCalls, 'Equity - Technical', { skipScrollUp: true });

        await researchCalls.clickClose();
    } catch (err) {
        console.error('Test failed:', err.message);
        console.error(err.stack);
    } finally {
        await DriverManager.closeDriver();
    }
}

run();
