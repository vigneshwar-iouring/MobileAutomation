const DriverManager = require('../../driver/DriverManager');
const { MutualFundsPage } = require('../../pages/MutualFundsPage');
const { createLogger, getFailedTCs } = require('../../utils/logger');

const { logFile, entries } = createLogger('MutualFunds');
console.log(`Logging this run to: ${logFile}`);

async function run() {
    const driver = await DriverManager.getDriver();
    try {
        const mutualFundsPage = new MutualFundsPage(driver);

        console.log('TC 1: Opening Mutual Funds (bottom navigation)...');
        await mutualFundsPage.openMutualFunds();

        console.log('\nMutual Fund - Home');

        console.log('\nTC 2: Selecting Home tab and reading portfolio summary...');
        await mutualFundsPage.clickHomeTab();
        await driver.pause(1000);
        await mutualFundsPage.readPortfolioSummary();

        console.log('\nTC 3: Opening "High Returns" under Handpick Collections, scrolling to bottom and back to top...');
        const tileCount = await mutualFundsPage.getHighReturnsTileCount();
        await mutualFundsPage.clickHighReturnsCollection();
        await driver.pause(1000);
        const listCount = await mutualFundsPage.getHighReturnsListCount();
        console.log(`High Returns count - tile: ${tileCount}, list header: ${listCount} - ${tileCount !== null && tileCount === listCount ? 'PASS (match)' : 'FAIL (mismatch)'}`);
        await mutualFundsPage.scrollListToBottomThenTop();

        // The list is back at the top after TC 3, so the first card read here is the fund opened.
        console.log('\nTC 4: Reading the first fund\'s return % in the list, opening it, and verifying Annualised shows the same % for that period...');
        await mutualFundsPage.openFirstFundAndVerifyReturn();

        console.log('\nTC 5: Verifying One Time and Start SIP order pads for this fund...');
        await mutualFundsPage.clickOneTimeButton();
        await mutualFundsPage.verifyOrderPadDefaults('One Time');
        await mutualFundsPage.goBackFromOrderPad();

        await mutualFundsPage.attemptStartSipFlow('Start SIP');

        console.log('\nTC 6: Reading NAV (with date) and Annualised return, verifying NAV date is not in the future...');
        await mutualFundsPage.readFundNavAndAnnualised();

        console.log('\nTC 7: Reading Min. Invest Amt, Total Assets and Exit Load...');
        await mutualFundsPage.readFundAdditionalInfo();

        console.log('\nTC 8: Selecting each available option in the Annualised box and printing NAV/Annualised for each...');
        await mutualFundsPage.cycleAnnualisedReturnPeriods();

        console.log('\nTC 9: Clicking through the chart period tabs (starting from threeMonths) until max...');
        await mutualFundsPage.cycleChartPeriods();

        console.log('\nTC 10: Scrolling to Peer Comparison, tapping View More (if applicable), and cycling its return period options...');
        await mutualFundsPage.cycleSectionReturnPeriods('Peer Comparison');

        console.log('\nTC 11: Scrolling to the bottom and repeating for "Funds in this Category" (if applicable)...');
        await mutualFundsPage.cycleSectionReturnPeriods('Funds in this Category', { scrollToBottom: true });

        console.log('\nTC 12: Navigating back to the High Returns list and cycling its return period filter (1Y default, 3Y, 5Y)...');
        // For each newly selected period (3Y, 5Y), repeats TC 4's check against that period: the
        // first fund's % in the list must match its Annualised % for the same period.
        // Shared with the Handpick Collection TCs below.
        const verifyOtherListPeriods = () => mutualFundsPage.cycleListReturnPeriods({
            afterSelect: async (period) => {
                console.log(`Verifying first fund's % for "${period}" against its Annualised value...`);
                await mutualFundsPage.openFirstFundAndVerifyReturn();
                await mutualFundsPage.goBackFromFundDetail();
                await driver.pause(1000);
            }
        });
        await mutualFundsPage.goBackFromFundDetail();
        await verifyOtherListPeriods();

        console.log('\nTC 13: Navigating back to Home...');
        await mutualFundsPage.navigateBackToHome();

        // One TC per remaining Handpick Collection, each: open it, verify tile count matches the
        // list header count, verify the first fund's list % matches its Annualised % for the
        // list's current period, then switch the list to each other period (3Y, 5Y) and repeat
        // the check for it, then back to Home.
        const verifyCollection = async (collectionName) => {
            const collectionTileCount = await mutualFundsPage.getCollectionTileCount(collectionName);
            await mutualFundsPage.clickCollection(collectionName);
            await driver.pause(1000);
            const collectionListCount = await mutualFundsPage.getCollectionListCount();
            console.log(`${collectionName} count - tile: ${collectionTileCount}, list header: ${collectionListCount} - ${collectionTileCount !== null && collectionTileCount === collectionListCount ? 'PASS (match)' : 'FAIL (mismatch)'}`);
            await mutualFundsPage.openFirstFundAndVerifyReturn();
            await mutualFundsPage.goBackFromFundDetail();
            await verifyOtherListPeriods();
            await mutualFundsPage.navigateBackToHome();
        };

        console.log('\nTC 14: Opening the "Debt" Handpick Collection, verifying its count and the first fund\'s list % against its Annualised % for 1Y, 3Y and 5Y...');
        await verifyCollection('Debt');

        console.log('\nTC 15: Opening the "Tax Saving" Handpick Collection, verifying its count and the first fund\'s list % against its Annualised % for 1Y, 3Y and 5Y...');
        await verifyCollection('Tax Saving');

        console.log('\nTC 16: Opening the "Large Cap" Handpick Collection, verifying its count and the first fund\'s list % against its Annualised % for 1Y, 3Y and 5Y...');
        await verifyCollection('Large Cap');

        console.log('\nTC 17: Opening the "Mid Cap" Handpick Collection, verifying its count and the first fund\'s list % against its Annualised % for 1Y, 3Y and 5Y...');
        await verifyCollection('Mid Cap');

        console.log('\nTC 18: Opening the "Small Cap" Handpick Collection, verifying its count and the first fund\'s list % against its Annualised % for 1Y, 3Y and 5Y...');
        await verifyCollection('Small Cap');

        console.log('\nTC 19: Clicking search icon near Handpick Collections and searching "tata"...');
        await mutualFundsPage.clickSearchIcon();
        await mutualFundsPage.searchMutualFunds('tata');
        await mutualFundsPage.verifySearchResults('tata');

        console.log('\nTC 20: Navigating back to Home again...');
        await mutualFundsPage.navigateBackToHome();

        console.log('\nTC 21: Opening "Invest in New Fund Offering", scrolling to the bottom, and tapping the last fund...');
        await mutualFundsPage.clickNfoBanner();
        await driver.pause(1000);
        await mutualFundsPage.scrollNfoListToBottom();
        const nfoFundName = await mutualFundsPage.clickLastNfoFund();
        console.log(`NFO fund name: ${nfoFundName}`);
        const nfoDates = await mutualFundsPage.readNfoDates();
        await mutualFundsPage.verifyNfoRemainingTime(nfoDates);

        console.log('\nTC 22: Printing Minimum Investment Amount...');
        await mutualFundsPage.readNfoMinInvestAmount();

        console.log('\nTC 23: Scrolling to bottom then top, then verifying One Time and Start SIP order pads...');
        await mutualFundsPage.scrollScreenToBottomThenTop();

        await mutualFundsPage.clickOneTimeButton();
        await mutualFundsPage.verifyOrderPadDefaults('One Time');
        await mutualFundsPage.goBackFromOrderPad();

        await mutualFundsPage.attemptStartSipFlow('Start SIP');

        console.log('\nTC 24: Navigating back to Home...');
        await mutualFundsPage.navigateBackToHome();

        console.log('\nTC 25: Scrolling to bottom, changing return period to 3Y, then visiting the first fund in Equity, Debt and Hybrid and verifying its list % matches its Annualised %...');
        await mutualFundsPage.scrollHomeToBottom();
        await mutualFundsPage.changeSectionReturnPeriod('Trending Funds', '3 Years Return');

        for (const category of ['Equity', 'Debt', 'Hybrid']) {
            if (category !== 'Equity') {
                await mutualFundsPage.clickTrendingFundsCategory(category);
                await driver.pause(1000);
            }
            const fundName = await mutualFundsPage.openFirstFundAndVerifyReturn();
            console.log(`${category} - first fund: ${fundName}`);
            await mutualFundsPage.goBackFromFundDetail();
        }
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
