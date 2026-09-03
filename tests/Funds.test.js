const DriverManager = require('../driver/DriverManager');
const ResearchCalls = require('../pages/ResearchCalls');
const FundsPage = require('../pages/FundsPage');
const { createLogger, getFailedTCs } = require('../utils/logger');

const { logFile, entries } = createLogger('Funds');
console.log(`Logging this run to: ${logFile}`);

async function run() {
    const driver = await DriverManager.getDriver();
    try {
        const researchCalls = new ResearchCalls(driver);
        const fundsPage = new FundsPage(driver);

        console.log('TC 1: Clicking hamburger menu...');
        await researchCalls.clickHamburgerMenu();

        console.log('TC 2: Clicking Funds...');
        await fundsPage.openFunds();
        await driver.pause(3000);

        console.log('TC 3: Reading margin summary...');
        await fundsPage.readMarginSummary();

        console.log('TC 4: Tapping tooltip icon...');
        await fundsPage.tapMarginUtilisedTooltip();
        const tooltipAvailable = await fundsPage.isTooltipInfoAvailable();
        console.log(`Tooltip information available: ${tooltipAvailable}`);
        await fundsPage.dismissTooltip();

        console.log('TC 5: Clicking View Transaction...');
        await fundsPage.clickViewTransactions();
        await driver.pause(1000);
        await fundsPage.goBackHardware();
        await driver.pause(1000);

        console.log('TC 6: Clicking Withdraw Funds...');
        await fundsPage.clickWithdrawFunds();
        await driver.pause(1000);
        await fundsPage.readWithdrawSummary();

        console.log('TC 7: Navigating back to Funds/Margin screen...');
        await fundsPage.goBackHardware();
        await driver.pause(1000);

        console.log('TC 8: Clicking Add Funds...');
        await fundsPage.clickAddFunds();
        await driver.pause(1000);

        console.log('TC 9: Tapping quick amount option +₹10,000...');
        await fundsPage.tapQuickAmount('10,000');
        await driver.pause(500);
        const enteredAmount = await fundsPage.getEnteredAmount();
        const hasTwoDecimals = /\.\d{2}$/.test(enteredAmount || '');
        console.log(`Entered amount: ${enteredAmount} - has two decimal places: ${hasTwoDecimals}`);

        console.log('TC 10: Tapping NEFT / RTGS / IMPS Transfer and verifying contents...');
        await fundsPage.clickNeftOption();
        await driver.pause(1000);
        await fundsPage.readNeftDetails();

        console.log('TC 11: Navigating back to Funds/Margin screen...');
        await fundsPage.goBackHardware(); // dismiss NEFT dialog
        await driver.pause(800);
        await fundsPage.goBack(); // Add Funds -> Funds/Margin
        await driver.pause(1000);

        console.log('TC 12: Navigating back from Funds/Margin screen...');
        await fundsPage.goBack();
        await driver.pause(1000);

        console.log('Funds flow completed');
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
