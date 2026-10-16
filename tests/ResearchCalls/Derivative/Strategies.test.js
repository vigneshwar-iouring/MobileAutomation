const DriverManager = require('../../../driver/DriverManager');
const ResearchCalls = require('../../../pages/ResearchCalls');
const { logSection, countAndRunQuoteFlow } = require('../shared');
const { createLogger, getFailedTCs } = require('../../../utils/logger');

const { logFile, entries } = createLogger('ResearchCalls-Derivative-Strategies');
console.log(`Logging this run to: ${logFile}`);

async function run() {
    const driver = await DriverManager.getDriver();
    try {
        const researchCalls = new ResearchCalls(driver);

        console.log('TC 1: Clicking hamburger menu...');
        await researchCalls.clickHamburgerMenu();

        console.log('TC 2: Clicking Research option...');
        await researchCalls.clickResearchOption();
        await researchCalls.waitForContent();

        logSection('DERIVATIVE - STRATEGIES');
        await researchCalls.clickDerivativeTab();
        await researchCalls.clickStrategiesTab();
        await countAndRunQuoteFlow(driver, researchCalls, 'Derivative - Strategies', { skipScrollUp: true });

        await researchCalls.clickClose();
    } catch (err) {
        console.error('Test failed:', err.message);
        console.error(err.stack);
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
