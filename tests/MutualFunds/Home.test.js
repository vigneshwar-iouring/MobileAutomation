const DriverManager = require('../../driver/DriverManager');
const { MutualFundsPage } = require('../../pages/MutualFundsPage');
const { createLogger } = require('../../utils/logger');

const { logFile } = createLogger('MutualFunds');
console.log(`Logging this run to: ${logFile}`);

async function run() {
    const driver = await DriverManager.getDriver();
    try {
        const mutualFundsPage = new MutualFundsPage(driver);

        console.log('Step 1: Opening Mutual Funds (bottom navigation)...');
        await mutualFundsPage.openMutualFunds();

        console.log('\nMutual Fund - Home');

        console.log('\nStep 2: Selecting Home tab and reading portfolio summary...');
        await mutualFundsPage.clickHomeTab();
        await driver.pause(1000);
        await mutualFundsPage.readPortfolioSummary();

        console.log('\nStep 3: Opening "High Returns" under Handpick Collections, scrolling to bottom and back to top...');
        const tileCount = await mutualFundsPage.getHighReturnsTileCount();
        await mutualFundsPage.clickHighReturnsCollection();
        await driver.pause(1000);
        const listCount = await mutualFundsPage.getHighReturnsListCount();
        console.log(`High Returns count - tile: ${tileCount}, list header: ${listCount} - ${tileCount !== null && tileCount === listCount ? 'PASS (match)' : 'FAIL (mismatch)'}`);
        await mutualFundsPage.scrollListToBottomThenTop();

        console.log('\nStep 4: Clicking the first Mutual Fund...');
        await mutualFundsPage.clickFirstFund();
        await driver.pause(1500);

        console.log('\nStep 5: Verifying One Time and Start SIP order pads for this fund...');
        await mutualFundsPage.clickOneTimeButton();
        await mutualFundsPage.verifyOrderPadDefaults('One Time');
        await mutualFundsPage.goBackFromOrderPad();

        await mutualFundsPage.attemptStartSipFlow('Start SIP');

        console.log('\nStep 6: Reading NAV (with date) and Annualised return, verifying NAV date is not in the future...');
        await mutualFundsPage.readFundNavAndAnnualised();

        console.log('\nStep 7: Reading Min. Invest Amt, Total Assets and Exit Load...');
        await mutualFundsPage.readFundAdditionalInfo();

        console.log('\nStep 8: Selecting each available option in the Annualised box and printing NAV/Annualised for each...');
        await mutualFundsPage.cycleAnnualisedReturnPeriods();

        console.log('\nStep 9: Scrolling to Peer Comparison, tapping View More (if applicable), and cycling its return period options...');
        await mutualFundsPage.cycleSectionReturnPeriods('Peer Comparison');

        console.log('\nStep 10: Scrolling to the bottom and repeating for "Funds in this Category" (if applicable)...');
        await mutualFundsPage.cycleSectionReturnPeriods('Funds in this Category', { scrollToBottom: true });

        console.log('\nStep 11: Navigating back to Home...');
        await mutualFundsPage.navigateBackToHome();

        console.log('\nStep 12: Clicking search icon near Handpick Collections and searching "tata"...');
        await mutualFundsPage.clickSearchIcon();
        await mutualFundsPage.searchMutualFunds('tata');
        await mutualFundsPage.verifySearchResults('tata');

        console.log('\nStep 13: Navigating back to Home again...');
        await mutualFundsPage.navigateBackToHome();

        console.log('\nStep 14: Opening "Invest in New Fund Offering", scrolling to the bottom, and tapping the last fund...');
        await mutualFundsPage.clickNfoBanner();
        await driver.pause(1000);
        await mutualFundsPage.scrollNfoListToBottom();
        const nfoFundName = await mutualFundsPage.clickLastNfoFund();
        console.log(`NFO fund name: ${nfoFundName}`);
        const nfoDates = await mutualFundsPage.readNfoDates();
        await mutualFundsPage.verifyNfoRemainingTime(nfoDates);

        console.log('\nStep 15: Printing Minimum Investment Amount...');
        await mutualFundsPage.readNfoMinInvestAmount();

        console.log('\nStep 16: Scrolling to bottom then top, then verifying One Time and Start SIP order pads...');
        await mutualFundsPage.scrollScreenToBottomThenTop();

        await mutualFundsPage.clickOneTimeButton();
        await mutualFundsPage.verifyOrderPadDefaults('One Time');
        await mutualFundsPage.goBackFromOrderPad();

        await mutualFundsPage.attemptStartSipFlow('Start SIP');

        console.log('\nStep 17: Navigating back to Home...');
        await mutualFundsPage.navigateBackToHome();

        console.log('\nStep 18: Scrolling to bottom, changing return period to 3Y, then visiting the first fund in Equity, Debt and Hybrid...');
        await mutualFundsPage.scrollHomeToBottom();
        await mutualFundsPage.changeSectionReturnPeriod('Trending Funds', '3 Years Return');

        for (const category of ['Equity', 'Debt', 'Hybrid']) {
            if (category !== 'Equity') {
                await mutualFundsPage.clickTrendingFundsCategory(category);
                await driver.pause(1000);
            }
            const fundName = await mutualFundsPage.clickFirstFund();
            console.log(`${category} - first fund: ${fundName}`);
            await driver.pause(1500);
            await mutualFundsPage.goBackFromFundDetail();
        }
    } catch (err) {
        console.error('Test failed:', err.message);
        console.error(err.stack);
    } finally {
        await DriverManager.closeDriver();
    }
}

run();
