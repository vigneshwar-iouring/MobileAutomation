const DriverManager = require('../../driver/DriverManager');
const { MarketsPage } = require('../../pages/MarketsPage');
const { createLogger, getFailedTCs } = require('../../utils/logger');

const { logFile, entries } = createLogger('Markets_FnO');
console.log(`Logging this run to: ${logFile}`);

async function run() {
    const driver = await DriverManager.getDriver();
    try {
        const marketsPage = new MarketsPage(driver);

        console.log('TC 1: Checking if the app is already on the Markets screen...');
        const alreadyOnMarkets = await marketsPage.waitForEquityLoaded(3000);
        if (alreadyOnMarkets) {
            console.log('Already on Markets screen - skipping bottom navigation tap, continuing with remaining TCs');
        } else {
            console.log('Not on Markets screen - clicking Market bottom navigation button...');
            await marketsPage.clickMarketNavButton();
            if (!(await marketsPage.waitForEquityLoaded(10000))) {
                throw new Error('Markets screen did not load within 10 seconds');
            }
        }

        console.log('\nTC 2: Clicking the F&O tab and verifying it is selected...');
        if (!(await marketsPage.clickFnoTab())) {
            throw new Error('F&O tab was not selected after tapping it');
        }

        console.log('\nTC 3: Verifying the first section on F&O is "F&O Market Insights"...');
        await marketsPage.scrollToTop();
        const firstSection = await marketsPage.getFirstSectionTitle();
        console.log(`First section on F&O: "${firstSection}" - ${firstSection === 'F&O Market Insights' ? 'PASS' : 'FAIL (expected "F&O Market Insights")'}`);

        console.log('\nTC 4: Verifying Top Gainers is selected by default with a list of F&O symbols...');
        await marketsPage.verifyFnoInsightsDefault();

        console.log('\nTC 5: Clicking the first symbol under F&O Market Insights and verifying its Quote screen...');
        const insightQuote = await marketsPage.openFirstFnoSymbol('F&O Market Insights', await marketsPage.getFnoInsightRows());

        console.log('\nTC 6: Navigating back from the Quote to the F&O tab...');
        if (insightQuote && !(await marketsPage.navigateBackToFnoTab(`${insightQuote.symbol}'s Quote`))) {
            throw new Error('Could not get back to the Markets (F&O) screen from the F&O Market Insights Quote');
        }

        // Same click-only sub-tab row as Equity's Market Movers: rewind to Tab 1 (in case it was left
        // scrolled), then tapping 1..N in order brings each next tab into view.
        await marketsPage.scrollToTop();
        const insightTabs = await marketsPage.getMoversTabs();
        const insightTabCount = insightTabs.length ? insightTabs[0].total : 0;
        if (!insightTabCount) {
            throw new Error('F&O Market Insights tabs not found');
        }
        await marketsPage.rewindMoversTabs();
        let tc = 7;
        for (let i = 1; i <= insightTabCount; i++) {
            console.log(`\nTC ${tc++}: Clicking F&O Market Insights tab ${i} of ${insightTabCount} and verifying it lists symbols...`);
            await marketsPage.clickFnoInsightsTab(i, insightTabCount);
        }

        console.log(`\nTC ${tc++}: Clicking "See all" on F&O Market Insights...`);
        await marketsPage.scrollToTop();
        await marketsPage.clickSeeAllFnoInsights();
        if (!(await marketsPage.verifyFnoInsightsSeeAllOpened())) {
            throw new Error('F&O Market Insights "See all" screen did not open');
        }

        console.log(`\nTC ${tc++}: Verifying Top Gainers is selected by default with a list of F&O symbols...`);
        await marketsPage.verifyFnoInsightsDefault();

        console.log(`\nTC ${tc++}: "See all" - clicking the first symbol and verifying its Quote screen...`);
        const seeAllQuote = await marketsPage.openFirstFnoSymbol('F&O Market Insights "See all"', await marketsPage.getFnoInsightRows());

        console.log(`\nTC ${tc++}: Navigating back from the Quote to F&O Market Insights "See all"...`);
        if (seeAllQuote && !(await marketsPage.navigateBackToFnoInsightsSeeAll(`${seeAllQuote.symbol}'s Quote`))) {
            throw new Error('Could not get back to F&O Market Insights "See all" from the Quote');
        }

        const seeAllTabs = await marketsPage.getMoversTabs();
        const seeAllTabCount = seeAllTabs.length ? seeAllTabs[0].total : 0;
        if (!seeAllTabCount) {
            throw new Error('F&O Market Insights "See all" tabs not found');
        }
        await marketsPage.rewindMoversTabs();
        for (let i = 1; i <= seeAllTabCount; i++) {
            console.log(`\nTC ${tc++}: "See all" - clicking tab ${i} of ${seeAllTabCount} and verifying it lists symbols...`);
            await marketsPage.clickFnoInsightsTab(i, seeAllTabCount);
        }

        console.log(`\nTC ${tc++}: Verifying the left (Expiry) dropdown is "All Expiry" by default...`);
        await marketsPage.verifyFnoFilterDefault('Expiry', marketsPage.expiryFilter, 'All Expiry');

        console.log(`\nTC ${tc++}: Verifying the right (Instrument) dropdown is "Stock Future" by default...`);
        await marketsPage.verifyFnoFilterDefault('Instrument', marketsPage.instrumentFilter, 'Stock Future');

        // Filters are checked on Top Gainers - the tab walk above left the last tab selected.
        await marketsPage.rewindMoversTabs();

        console.log(`\nTC ${tc++}: Clicking the Expiry dropdown and verifying its options...`);
        const expiryOptions = await marketsPage.openExpiryFilter();
        if (!expiryOptions.length) {
            throw new Error('No options listed in the Expiry dropdown');
        }
        const first = expiryOptions[0];
        console.log(`First Expiry option "${first.label}" is the current selection: ${first.selected ? 'PASS' : 'FAIL'}`);

        // The sheet closes on every pick, so it is reopened before each option after the first.
        for (let i = 0; i < expiryOptions.length; i++) {
            const { label } = expiryOptions[i];
            console.log(`\nTC ${tc++}: Selecting Expiry "${label}" and verifying the symbols listed match it...`);
            if (i > 0) await marketsPage.openExpiryFilter();
            await marketsPage.selectExpiryOption(label);
        }

        // Leave the screen on its default filter for the next run.
        if (expiryOptions.length > 1) {
            console.log(`\nTC ${tc++}: Resetting the Expiry dropdown to "${first.label}"...`);
            await marketsPage.openExpiryFilter();
            await marketsPage.selectExpiryOption(first.label);
        }

        console.log(`\nTC ${tc++}: Closing F&O Market Insights "See all" and navigating back to Markets...`);
        await marketsPage.closeFnoInsightsSeeAll();
        if (!(await marketsPage.navigateBackToMarkets())) {
            throw new Error('Could not get back to the Markets screen from F&O Market Insights "See all"');
        }

        console.log(`\nTC ${tc++}: Navigating back to the F&O tab...`);
        if (!(await marketsPage.clickFnoTab())) {
            throw new Error('F&O tab was not selected after tapping it');
        }

        console.log(`\nTC ${tc++}: Clicking the NxtOption banner below F&O Market Insights and verifying Strategy Builder, IV Analysis, OI Analysis are displayed...`);
        if (!(await marketsPage.clickNxtOptionBanner())) {
            throw new Error('NxtOption popup did not open from the F&O banner');
        }

        console.log(`\nTC ${tc++}: Clicking Strategy Builder and verifying the app navigates to Strategy Builder...`);
        await marketsPage.openNxtOptionTool('Strategy Builder');

        console.log(`\nTC ${tc++}: Navigating back from Strategy Builder to the F&O tab...`);
        if (!(await marketsPage.navigateBackToFnoTab('Strategy Builder'))) {
            throw new Error('Could not get back to the Markets (F&O) screen from Strategy Builder');
        }

        console.log(`\nTC ${tc++}: Clicking the NxtOption banner again...`);
        if (!(await marketsPage.clickNxtOptionBanner())) {
            throw new Error('NxtOption popup did not open from the F&O banner');
        }

        console.log(`\nTC ${tc++}: Clicking IV Analysis and verifying the app navigates to IV Analysis...`);
        await marketsPage.openNxtOptionTool('IV Analysis');

        console.log(`\nTC ${tc++}: Navigating back from IV Analysis to the F&O tab...`);
        if (!(await marketsPage.navigateBackToFnoTab('IV Analysis'))) {
            throw new Error('Could not get back to the Markets (F&O) screen from IV Analysis');
        }

        console.log(`\nTC ${tc++}: Clicking the NxtOption banner again...`);
        if (!(await marketsPage.clickNxtOptionBanner())) {
            throw new Error('NxtOption popup did not open from the F&O banner');
        }

        console.log(`\nTC ${tc++}: Clicking OI Analysis and verifying the app navigates to OI Analysis...`);
        await marketsPage.openNxtOptionTool('OI Analysis');

        console.log(`\nTC ${tc++}: Navigating back from OI Analysis to the F&O tab...`);
        if (!(await marketsPage.navigateBackToFnoTab('OI Analysis'))) {
            throw new Error('Could not get back to the Markets (F&O) screen from OI Analysis');
        }

        console.log(`\nTC ${tc++}: Navigating back to F&O Market Insights...`);
        await marketsPage.scrollToTop();
        const topSection = await marketsPage.getFirstSectionTitle();
        console.log(`Back on F&O Market Insights: ${topSection === 'F&O Market Insights' ? 'PASS' : `FAIL (first section is "${topSection}")`}`);

        console.log(`\nTC ${tc++}: Scrolling down to Trending Options...`);
        if (!(await marketsPage.scrollToTrendingOptions())) {
            throw new Error('Trending Options section not found on the F&O tab');
        }

        console.log(`\nTC ${tc++}: Verifying Most Traded is selected by default...`);
        await marketsPage.isTrendingTabSelected('Most Traded');

        console.log(`\nTC ${tc++}: Verifying Most Traded lists F&O symbols with expiry...`);
        await marketsPage.verifyTrendingOptionRows('Most Traded');

        console.log(`\nTC ${tc++}: Clicking the first Most Traded symbol and verifying its Quote screen...`);
        const mostTradedQuote = await marketsPage.openFirstFnoSymbol('Trending Options "Most Traded"', await marketsPage.getTrendingOptionRows());

        console.log(`\nTC ${tc++}: Navigating back from the Quote to the F&O tab...`);
        if (mostTradedQuote && !(await marketsPage.navigateBackToFnoTab(`${mostTradedQuote.symbol}'s Quote`))) {
            throw new Error('Could not get back to the Markets (F&O) screen from the Most Traded Quote');
        }
        if (!(await marketsPage.scrollToTrendingOptions())) {
            throw new Error('Trending Options section not found on the F&O tab');
        }

        console.log(`\nTC ${tc++}: Clicking Highest OI and verifying it is selected...`);
        await marketsPage.clickTrendingTab('Highest OI');
        await marketsPage.isTrendingTabSelected('Highest OI');

        console.log(`\nTC ${tc++}: Verifying Highest OI lists F&O symbols with expiry...`);
        await marketsPage.verifyTrendingOptionRows('Highest OI');

        console.log(`\nTC ${tc++}: Clicking the first Highest OI symbol and verifying its Quote screen...`);
        const highestOiQuote = await marketsPage.openFirstFnoSymbol('Trending Options "Highest OI"', await marketsPage.getTrendingOptionRows());

        console.log(`\nTC ${tc++}: Navigating back from the Quote to the F&O tab...`);
        if (highestOiQuote && !(await marketsPage.navigateBackToFnoTab(`${highestOiQuote.symbol}'s Quote`))) {
            throw new Error('Could not get back to the Markets (F&O) screen from the Highest OI Quote');
        }

        console.log(`\nTC ${tc++}: Scrolling down to Future Index Contracts...`);
        if (!(await marketsPage.scrollToFutureIndexContracts())) {
            throw new Error('Future Index Contracts section not found on the F&O tab');
        }

        const defaultIndexTab = await marketsPage.getSelectedFutureIndexTab();
        console.log(`\nTC ${tc++}: Verifying "${defaultIndexTab}" shows Current Expiry, Next Expiry, Far Expiry...`);
        await marketsPage.verifyFutureIndexCategories(defaultIndexTab);

        console.log(`\nTC ${tc++}: Clicking the first Future Index Contracts symbol and verifying its Quote screen...`);
        const indexQuote = await marketsPage.openFirstFnoSymbol('Future Index Contracts', await marketsPage.getFutureIndexRows());

        console.log(`\nTC ${tc++}: Navigating back from the Quote to the F&O tab...`);
        if (indexQuote && !(await marketsPage.navigateBackToFnoTab(`${indexQuote.symbol}'s Quote`))) {
            throw new Error('Could not get back to the Markets (F&O) screen from the Future Index Contracts Quote');
        }
        if (!(await marketsPage.scrollToFutureIndexContracts())) {
            throw new Error('Future Index Contracts section not found on the F&O tab');
        }
        await marketsPage.rewindFutureIndexTabs();

        console.log(`\nTC ${tc++}: Clicking Nifty 50 and verifying Current Expiry, Next Expiry, Far Expiry are listed...`);
        await marketsPage.clickFutureIndexTab('Nifty 50');
        await marketsPage.verifyFutureIndexCategories('Nifty 50');

        console.log(`\nTC ${tc++}: Clicking SENSEX and verifying Current Expiry, Next Expiry, Far Expiry are listed...`);
        await marketsPage.clickFutureIndexTab('SENSEX');
        await marketsPage.verifyFutureIndexCategories('SENSEX');

        console.log(`\nTC ${tc++}: Clicking BANKNIFTY and verifying Current Expiry, Next Expiry, Far Expiry are listed...`);
        await marketsPage.clickFutureIndexTab('BANKNIFTY');
        await marketsPage.verifyFutureIndexCategories('BANKNIFTY');

        console.log(`\nTC ${tc++}: Clicking FINNIFTY and verifying Current Expiry, Next Expiry, Far Expiry are listed...`);
        await marketsPage.clickFutureIndexTab('FINNIFTY');
        await marketsPage.verifyFutureIndexCategories('FINNIFTY');

        console.log(`\nTC ${tc++}: Clicking BANKEX and verifying Current Expiry, Next Expiry, Far Expiry are listed...`);
        await marketsPage.clickFutureIndexTab('BANKEX');
        await marketsPage.verifyFutureIndexCategories('BANKEX');
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
