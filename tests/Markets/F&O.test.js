const DriverManager = require('../../driver/DriverManager');
const { MarketsPage } = require('../../pages/MarketsPage');
const { createLogger, getFailedTCs } = require('../../utils/logger');

const { logFile, entries } = createLogger('Markets_FnO');
console.log(`Logging this run to: ${logFile}`);

// Every OI Analysis tab explains its own build-up/unwinding pattern above its list, so tab `label`'s
// message must be shown and differ from every tab already in `messages` (label -> message).
async function verifyOiMessage(marketsPage, where, label, messages) {
    const message = await marketsPage.getOiAnalysisMessage();
    const sameAs = [...messages].filter(([, m]) => m === message).map(([l]) => l);
    console.log(`OI Analysis ${where}"${label}" message: "${message || ''}" - ${!message ? 'FAIL (no message shown)' : sameAs.length ? `FAIL (same as ${sameAs.join(', ')})` : 'PASS (different from the other tabs)'}`);
    if (message) messages.set(label, message);
}

// Taps OI Analysis tab `index` (expected to be `label`), checks its message and verifies its list -
// returns its rows.
async function selectOiTab(marketsPage, index, label, messages) {
    const tab = await marketsPage.clickOiAnalysisTab(index);
    if (!tab) return [];
    if (tab.label !== label) console.log(`OI Analysis tab ${index} is "${tab.label}", expected "${label}": FAIL`);
    await verifyOiMessage(marketsPage, '', label, messages);
    return (await marketsPage.verifyOiAnalysisRows(label)).rows;
}

async function backToFnoFromOiQuote(marketsPage, quote, label) {
    if (quote && !(await marketsPage.navigateBackToFnoTab(`${quote.symbol}'s Quote`))) {
        throw new Error(`Could not get back to the Markets (F&O) screen from the OI Analysis "${label}" Quote`);
    }
}

// Back on F&O after a Quote: return to OI Analysis (re-selecting the tab if the app reset it) and
// verify its list again.
async function reverifyOiTab(marketsPage, index, label) {
    if (!(await marketsPage.scrollToOiAnalysis())) {
        throw new Error('OI Analysis section not found on the F&O tab');
    }
    const selectedTab = await marketsPage.getSelectedOiAnalysisTab();
    if (selectedTab !== label) {
        console.log(`OI Analysis is on "${selectedTab}" after coming back - re-selecting "${label}"`);
        await marketsPage.clickOiAnalysisTab(index);
    }
    await marketsPage.verifyOiAnalysisRows(label);
}

// "See all": tab `label` must show its own message (different from every tab in `messages` so far)
// above its symbols.
async function verifyOiSeeAllTab(marketsPage, index, label, messages) {
    const tab = await marketsPage.clickOiAnalysisTab(index);
    if (!tab) return;
    await verifyOiMessage(marketsPage, '"See all" ', label, messages);
    await marketsPage.verifyOiAnalysisRows(`See all ${label}`);
}

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

        console.log('\nTC 3: Clicking the first index in the index bar above the search bar and verifying its Quote screen (symbol, LTP, segment)...');
        const indexBarQuote = await marketsPage.openFirstIndexBarQuote();

        console.log('\nTC 4: Clicking Option Chain and verifying the Option Chain screen opens...');
        if (!indexBarQuote) console.log('No index Quote open to reach Option Chain from: FAIL');
        const optionChainOpened = !!indexBarQuote && await marketsPage.openOptionChain();

        // NxtOption banner shows on Option Chain for Commodity and F&O, not for Equity or Currency.
        console.log('\nTC 5: Verifying the NxtOption banner is displayed on Option Chain...');
        if (optionChainOpened) await marketsPage.verifyOptionChainNxtOptionBanner(true);
        else console.log('Option Chain is not open - skipping the NxtOption banner check: FAIL');

        console.log('\nTC 6: Navigating back from Option Chain to the F&O tab...');
        if (indexBarQuote && !(await marketsPage.navigateBackToFnoTab(`${indexBarQuote.symbol}'s Option Chain`))) {
            throw new Error('Could not get back to the Markets (F&O) screen from Option Chain');
        }

        console.log('\nTC 7: Verifying the first section on F&O is "F&O Market Insights"...');
        await marketsPage.scrollToTop();
        const firstSection = await marketsPage.getFirstSectionTitle();
        console.log(`First section on F&O: "${firstSection}" - ${firstSection === 'F&O Market Insights' ? 'PASS' : 'FAIL (expected "F&O Market Insights")'}`);

        console.log('\nTC 8: Verifying Top Gainers is selected by default with a list of F&O symbols...');
        await marketsPage.verifyFnoInsightsDefault();

        console.log('\nTC 9: Clicking the first symbol under F&O Market Insights and verifying its expanded Quote screen and 52 week indicator...');
        const insightQuote = await marketsPage.openFirstFnoSymbol('F&O Market Insights', await marketsPage.getFnoInsightRows());

        console.log('\nTC 10: Navigating back from the Quote to the F&O tab...');
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
        let tc = 11;
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

        console.log(`\nTC ${tc++}: "See all" - clicking the first symbol and verifying its expanded Quote screen and 52 week indicator...`);
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
        const strategyBuilderOpened = await marketsPage.openNxtOptionTool('Strategy Builder');

        console.log(`\nTC ${tc++}: Clicking Buy Call and waiting 5s for the data/graph to load...`);
        if (strategyBuilderOpened) await marketsPage.exploreNxtOptionTool('Strategy Builder');
        else console.log('Strategy Builder is not open - skipping Buy Call: FAIL');

        console.log(`\nTC ${tc++}: Navigating back from Strategy Builder to the F&O tab...`);
        if (!(await marketsPage.navigateBackToFnoTab('Strategy Builder'))) {
            throw new Error('Could not get back to the Markets (F&O) screen from Strategy Builder');
        }

        console.log(`\nTC ${tc++}: Clicking the NxtOption banner again...`);
        if (!(await marketsPage.clickNxtOptionBanner())) {
            throw new Error('NxtOption popup did not open from the F&O banner');
        }

        console.log(`\nTC ${tc++}: Clicking IV Analysis and verifying the app navigates to IV Analysis...`);
        const ivAnalysisOpened = await marketsPage.openNxtOptionTool('IV Analysis');

        console.log(`\nTC ${tc++}: Clicking each IV Analysis tab and waiting 3s on each for its data to load...`);
        if (ivAnalysisOpened) await marketsPage.exploreNxtOptionTool('IV Analysis');
        else console.log('IV Analysis is not open - skipping its tabs: FAIL');

        console.log(`\nTC ${tc++}: Navigating back from IV Analysis to the F&O tab...`);
        if (!(await marketsPage.navigateBackToFnoTab('IV Analysis'))) {
            throw new Error('Could not get back to the Markets (F&O) screen from IV Analysis');
        }

        console.log(`\nTC ${tc++}: Clicking the NxtOption banner again...`);
        if (!(await marketsPage.clickNxtOptionBanner())) {
            throw new Error('NxtOption popup did not open from the F&O banner');
        }

        console.log(`\nTC ${tc++}: Clicking OI Analysis and verifying the app navigates to OI Analysis...`);
        const oiAnalysisOpened = await marketsPage.openNxtOptionTool('OI Analysis');

        console.log(`\nTC ${tc++}: Clicking each OI Analysis tab and waiting 3s on each for its data to load...`);
        if (oiAnalysisOpened) await marketsPage.exploreNxtOptionTool('OI Analysis');
        else console.log('OI Analysis is not open - skipping its tabs: FAIL');

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

        console.log(`\nTC ${tc++}: Clicking the first Most Traded symbol and verifying its expanded Quote screen and 52 week indicator...`);
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

        console.log(`\nTC ${tc++}: Clicking the first Highest OI symbol and verifying its expanded Quote screen and 52 week indicator...`);
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

        console.log(`\nTC ${tc++}: Clicking the first Future Index Contracts symbol and verifying its expanded Quote screen and 52 week indicator...`);
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

        console.log('\nTC 66: Scrolling down to OI Analysis...');
        if (!(await marketsPage.scrollToOiAnalysis())) {
            throw new Error('OI Analysis section not found on the F&O tab');
        }

        // Click-only tab row like the others: tapping the tabs in order brings each next tab into view.
        // Each tab's own message is checked before "See all" too, against the tabs already visited.
        const oiTabMessages = new Map();
        console.log('\nTC 67: Clicking OI Analysis "Long Buildup" and verifying its own message with symbols with expiry, Open Interest and Price...');
        const longBuildupRows = await selectOiTab(marketsPage, 1, 'Long Buildup', oiTabMessages);
        console.log('\nTC 68: Clicking the first OI Analysis "Long Buildup" symbol and verifying its expanded Quote screen and 52 week indicator...');
        const longBuildupQuote = await marketsPage.openFirstFnoSymbol('OI Analysis "Long Buildup"', longBuildupRows);
        console.log('\nTC 69: Navigating back from the Quote to the F&O tab...');
        await backToFnoFromOiQuote(marketsPage, longBuildupQuote, 'Long Buildup');
        console.log('\nTC 70: Verifying OI Analysis "Long Buildup" lists symbols with expiry under Symbol, Open Interest, Price...');
        await reverifyOiTab(marketsPage, 1, 'Long Buildup');

        console.log('\nTC 71: Clicking OI Analysis "Long Unwinding" and verifying its own message with symbols with expiry, Open Interest and Price...');
        const longUnwindingRows = await selectOiTab(marketsPage, 2, 'Long Unwinding', oiTabMessages);
        console.log('\nTC 72: Clicking the first OI Analysis "Long Unwinding" symbol and verifying its expanded Quote screen and 52 week indicator...');
        const longUnwindingQuote = await marketsPage.openFirstFnoSymbol('OI Analysis "Long Unwinding"', longUnwindingRows);
        console.log('\nTC 73: Navigating back from the Quote to the F&O tab...');
        await backToFnoFromOiQuote(marketsPage, longUnwindingQuote, 'Long Unwinding');
        console.log('\nTC 74: Verifying OI Analysis "Long Unwinding" lists symbols with expiry under Symbol, Open Interest, Price...');
        await reverifyOiTab(marketsPage, 2, 'Long Unwinding');

        console.log('\nTC 75: Clicking OI Analysis "Short Buildup" and verifying its own message with symbols with expiry, Open Interest and Price...');
        const shortBuildupRows = await selectOiTab(marketsPage, 3, 'Short Buildup', oiTabMessages);
        console.log('\nTC 76: Clicking the first OI Analysis "Short Buildup" symbol and verifying its expanded Quote screen and 52 week indicator...');
        const shortBuildupQuote = await marketsPage.openFirstFnoSymbol('OI Analysis "Short Buildup"', shortBuildupRows);
        console.log('\nTC 77: Navigating back from the Quote to the F&O tab...');
        await backToFnoFromOiQuote(marketsPage, shortBuildupQuote, 'Short Buildup');
        console.log('\nTC 78: Verifying OI Analysis "Short Buildup" lists symbols with expiry under Symbol, Open Interest, Price...');
        await reverifyOiTab(marketsPage, 3, 'Short Buildup');

        console.log('\nTC 79: Clicking OI Analysis "Short Covering" and verifying its own message with symbols with expiry, Open Interest and Price...');
        const shortCoveringRows = await selectOiTab(marketsPage, 4, 'Short Covering', oiTabMessages);
        console.log('\nTC 80: Clicking the first OI Analysis "Short Covering" symbol and verifying its expanded Quote screen and 52 week indicator...');
        const shortCoveringQuote = await marketsPage.openFirstFnoSymbol('OI Analysis "Short Covering"', shortCoveringRows);
        console.log('\nTC 81: Navigating back from the Quote to the F&O tab...');
        await backToFnoFromOiQuote(marketsPage, shortCoveringQuote, 'Short Covering');
        console.log('\nTC 82: Verifying OI Analysis "Short Covering" lists symbols with expiry under Symbol, Open Interest, Price...');
        await reverifyOiTab(marketsPage, 4, 'Short Covering');

        console.log('\nTC 83: Clicking "See all" on OI Analysis...');
        if (!(await marketsPage.scrollToOiAnalysis())) {
            throw new Error('OI Analysis section not found on the F&O tab');
        }
        await marketsPage.clickSeeAllOiAnalysis();
        if (!(await marketsPage.verifyOiAnalysisSeeAllOpened())) {
            throw new Error('OI Analysis "See all" screen did not open');
        }

        // Every tab explains its own build-up/unwinding pattern above its list, so each tab's message
        // must be present and different from every other tab's.
        const oiMessages = new Map();
        console.log('\nTC 84: "See all" - clicking "Long Buildup" and verifying its own message with symbols...');
        await verifyOiSeeAllTab(marketsPage, 1, 'Long Buildup', oiMessages);
        console.log('\nTC 85: "See all" - clicking "Long Unwinding" and verifying its own message with symbols...');
        await verifyOiSeeAllTab(marketsPage, 2, 'Long Unwinding', oiMessages);
        console.log('\nTC 86: "See all" - clicking "Short Buildup" and verifying its own message with symbols...');
        await verifyOiSeeAllTab(marketsPage, 3, 'Short Buildup', oiMessages);
        console.log('\nTC 87: "See all" - clicking "Short Covering" and verifying its own message with symbols...');
        await verifyOiSeeAllTab(marketsPage, 4, 'Short Covering', oiMessages);

        console.log('\nTC 88: Navigating back from OI Analysis "See all" to the F&O tab...');
        if (!(await marketsPage.navigateBackToFnoTab('OI Analysis "See all"'))) {
            throw new Error('Could not get back to the Markets (F&O) screen from OI Analysis "See all"');
        }

        console.log('\nTC 89: Scrolling down to Rollover Analysis...');
        if (!(await marketsPage.scrollToRolloverAnalysis())) {
            throw new Error('Rollover Analysis section not found on the F&O tab');
        }

        console.log('\nTC 90: Clicking the first Rollover Analysis symbol and verifying its expanded Quote screen and 52 week indicator...');
        const rolloverQuote = await marketsPage.openFirstFnoSymbol('Rollover Analysis', await marketsPage.getRolloverRows());

        console.log('\nTC 91: Navigating back from the Quote to the F&O tab...');
        if (rolloverQuote && !(await marketsPage.navigateBackToFnoTab(`${rolloverQuote.symbol}'s Quote`))) {
            throw new Error('Could not get back to the Markets (F&O) screen from the Rollover Analysis Quote');
        }
        if (!(await marketsPage.scrollToRolloverAnalysis())) {
            throw new Error('Rollover Analysis section not found on the F&O tab');
        }

        console.log('\nTC 92: Verifying Rollover Analysis lists F&O symbols with expiry under Symbol, Percentage%, Rollover cost...');
        await marketsPage.verifyRolloverRows('INDEX, HIGH');

        console.log('\nTC 93: Verifying Index and High are selected by default...');
        await marketsPage.verifyRolloverSelection('INDEX', 'HIGH');

        console.log('\nTC 94: Clicking Index, Low and verifying its F&O symbols with expiry...');
        await marketsPage.selectRollover('INDEX', 'LOW');
        await marketsPage.verifyRolloverRows('INDEX, LOW');

        console.log('\nTC 95: Clicking Stock, Low and verifying its F&O symbols with expiry...');
        await marketsPage.selectRollover('STOCK', 'LOW');
        await marketsPage.verifyRolloverRows('STOCK, LOW');

        console.log('\nTC 96: Clicking Stock, High and verifying its F&O symbols with expiry...');
        await marketsPage.selectRollover('STOCK', 'HIGH');
        await marketsPage.verifyRolloverRows('STOCK, HIGH');

        // Leave Rollover Analysis on its default for the next run's TC 93.
        console.log('\nTC 97: Resetting Rollover Analysis to Index, High...');
        await marketsPage.selectRollover('INDEX', 'HIGH');

        // "See all" - same steps. High/Low are its "Highest Rollover"/"Lowest Rollover" tabs here.
        console.log('\nTC 98: Clicking "See all" on Rollover Analysis...');
        if (!(await marketsPage.scrollToRolloverAnalysis())) {
            throw new Error('Rollover Analysis section not found on the F&O tab');
        }
        await marketsPage.clickSeeAllRollover();
        if (!(await marketsPage.verifyRolloverSeeAllOpened())) {
            throw new Error('Rollover Analysis "See all" screen did not open');
        }

        console.log('\nTC 99: "See all" - clicking the first Rollover Analysis symbol and verifying its expanded Quote screen and 52 week indicator...');
        const rolloverSeeAllQuote = await marketsPage.openFirstFnoSymbol('Rollover Analysis "See all"', await marketsPage.getRolloverRows());

        console.log('\nTC 100: Navigating back from the Quote to Rollover Analysis "See all"...');
        if (rolloverSeeAllQuote && !(await marketsPage.navigateBackToRolloverSeeAll(`${rolloverSeeAllQuote.symbol}'s Quote`))) {
            throw new Error('Could not get back to Rollover Analysis "See all" from the Quote');
        }

        console.log('\nTC 101: "See all" - verifying Rollover Analysis lists F&O symbols with expiry under Symbol, Percentage%, Rollover cost...');
        await marketsPage.verifyRolloverRows('See all INDEX, HIGH');

        console.log('\nTC 102: "See all" - verifying Index and Highest Rollover are selected by default...');
        await marketsPage.verifyRolloverSeeAllSelection('INDEX', 'HIGH');

        console.log('\nTC 103: "See all" - clicking Index, Lowest Rollover and verifying its F&O symbols with expiry...');
        await marketsPage.selectRolloverSeeAll('INDEX', 'LOW');
        await marketsPage.verifyRolloverRows('See all INDEX, LOW');

        console.log('\nTC 104: "See all" - clicking Stock, Lowest Rollover and verifying its F&O symbols with expiry...');
        await marketsPage.selectRolloverSeeAll('STOCK', 'LOW');
        await marketsPage.verifyRolloverRows('See all STOCK, LOW');

        console.log('\nTC 105: "See all" - clicking Stock, Highest Rollover and verifying its F&O symbols with expiry...');
        await marketsPage.selectRolloverSeeAll('STOCK', 'HIGH');
        await marketsPage.verifyRolloverRows('See all STOCK, HIGH');

        // Leave "See all" on its default for the next run's TC 102.
        console.log('\nTC 106: "See all" - resetting to Index, Highest Rollover...');
        await marketsPage.selectRolloverSeeAll('INDEX', 'HIGH');

        console.log('\nTC 107: Navigating back from Rollover Analysis "See all" to the F&O tab...');
        if (!(await marketsPage.navigateBackToFnoTab('Rollover Analysis "See all"'))) {
            throw new Error('Could not get back to the Markets (F&O) screen from Rollover Analysis "See all"');
        }

        console.log('\nTC 108: Scrolling to FII Trend in F&O and verifying its date is not older than 3 days...');
        let fiiTrend = await marketsPage.scrollToFiiTrend();
        if (!fiiTrend) throw new Error('FII Trend in F&O section not found on the F&O tab');
        marketsPage.verifyFiiTrendDate(fiiTrend);

        console.log('\nTC 109: Verifying Stock Futures is selected by default in the dropdown...');
        marketsPage.verifyFiiTrendFilter(fiiTrend, 'Stock Futures');

        console.log('\nTC 110: Verifying Buy, Sell and Net Positions are displayed in Cr...');
        marketsPage.verifyFiiTrendRows(fiiTrend);

        console.log('\nTC 111: Verifying Buy, Sell and Net Positions are each shown as their own bar...');
        let fiiBars = (await marketsPage.verifyFiiTrendBars(fiiTrend)).bars;

        console.log('\nTC 112: Selecting Stock Options and verifying the graph is updated...');
        let fiiNext = await marketsPage.selectFiiTrendFilter('Stock Options');
        let fiiNextBars = (await marketsPage.verifyFiiTrendBars(fiiNext)).bars;
        marketsPage.verifyFiiTrendRows(fiiNext);
        marketsPage.verifyFiiTrendUpdated(fiiTrend, fiiNext, fiiBars, fiiNextBars);
        [fiiTrend, fiiBars] = [fiiNext, fiiNextBars];

        console.log('\nTC 113: Selecting Index Futures and verifying the graph is updated...');
        fiiNext = await marketsPage.selectFiiTrendFilter('Index Futures');
        fiiNextBars = (await marketsPage.verifyFiiTrendBars(fiiNext)).bars;
        marketsPage.verifyFiiTrendRows(fiiNext);
        marketsPage.verifyFiiTrendUpdated(fiiTrend, fiiNext, fiiBars, fiiNextBars);
        [fiiTrend, fiiBars] = [fiiNext, fiiNextBars];

        console.log('\nTC 114: Selecting Index Options and verifying the graph is updated...');
        fiiNext = await marketsPage.selectFiiTrendFilter('Index Options');
        fiiNextBars = (await marketsPage.verifyFiiTrendBars(fiiNext)).bars;
        marketsPage.verifyFiiTrendRows(fiiNext);
        marketsPage.verifyFiiTrendUpdated(fiiTrend, fiiNext, fiiBars, fiiNextBars);
        [fiiTrend, fiiBars] = [fiiNext, fiiNextBars];

        // "See all" - same steps as Equity's FII/DII "See all" (tests/Markets/Equity.test.js TC 107-126),
        // on F&O's "FII" screen, whose sub-tabs list Stock/Index Futures and Options.
        marketsPage.useFnoFiiSeeAll();
        console.log('\nTC 115: Clicking "See All" on FII Trend in F&O and verifying the Daily, Monthly, Yearly tabs and ALL, STOCK, INDEX sub-tabs...');
        if (!(await marketsPage.clickSeeAllFiiTrend()) || !(await marketsPage.verifyFiiDiiSeeAllOpened())) {
            throw new Error('FII Trend in F&O "See All" screen did not open with its tabs and sub-tabs');
        }

        console.log('\nTC 116: Verifying Daily and ALL are selected by default with the same date shown on F&O...');
        await marketsPage.verifyFiiDiiSeeAllDefault(fiiTrend.dateText);

        console.log('\nTC 117: Daily - scrolling down ALL and verifying the past dates listed...');
        await marketsPage.verifyFiiDiiHistory('Daily', 'ALL');

        console.log('\nTC 118: Clicking STOCK and verifying only Stock Futures and Stock Options are displayed...');
        await marketsPage.clickFiiDiiSegment('STOCK');

        console.log('\nTC 119: Daily - scrolling down STOCK and verifying the past dates listed...');
        await marketsPage.verifyFiiDiiHistory('Daily', 'STOCK');

        console.log('\nTC 120: Clicking INDEX and verifying only Index Futures and Index Options are displayed...');
        await marketsPage.clickFiiDiiSegment('INDEX');

        console.log('\nTC 121: Daily - scrolling down INDEX and verifying the past dates listed...');
        await marketsPage.verifyFiiDiiHistory('Daily', 'INDEX');

        console.log('\nTC 122: Clicking Monthly and verifying the current month is displayed...');
        await marketsPage.clickFiiDiiPeriod('Monthly');

        console.log('\nTC 123: Monthly - clicking ALL and verifying its rows...');
        await marketsPage.clickFiiDiiSegment('ALL');

        console.log('\nTC 124: Monthly - scrolling down ALL and verifying the past months listed...');
        await marketsPage.verifyFiiDiiHistory('Monthly', 'ALL');

        console.log('\nTC 125: Monthly - clicking STOCK and verifying its rows...');
        await marketsPage.clickFiiDiiSegment('STOCK');

        console.log('\nTC 126: Monthly - scrolling down STOCK and verifying the past months listed...');
        await marketsPage.verifyFiiDiiHistory('Monthly', 'STOCK');

        console.log('\nTC 127: Monthly - clicking INDEX and verifying its rows...');
        await marketsPage.clickFiiDiiSegment('INDEX');

        console.log('\nTC 128: Monthly - scrolling down INDEX and verifying the past months listed...');
        await marketsPage.verifyFiiDiiHistory('Monthly', 'INDEX');

        console.log('\nTC 129: Clicking Yearly and verifying the current year is displayed...');
        await marketsPage.clickFiiDiiPeriod('Yearly');

        console.log('\nTC 130: Yearly - clicking ALL and verifying its rows...');
        await marketsPage.clickFiiDiiSegment('ALL');

        console.log('\nTC 131: Yearly - scrolling down ALL and verifying the past years listed...');
        await marketsPage.verifyFiiDiiHistory('Yearly', 'ALL');

        console.log('\nTC 132: Yearly - clicking STOCK and verifying its rows...');
        await marketsPage.clickFiiDiiSegment('STOCK');

        console.log('\nTC 133: Yearly - scrolling down STOCK and verifying the past years listed...');
        await marketsPage.verifyFiiDiiHistory('Yearly', 'STOCK');

        console.log('\nTC 134: Yearly - clicking INDEX and verifying its rows...');
        await marketsPage.clickFiiDiiSegment('INDEX');

        console.log('\nTC 135: Yearly - scrolling down INDEX and verifying the past years listed...');
        await marketsPage.verifyFiiDiiHistory('Yearly', 'INDEX');

        console.log('\nTC 136: Navigating back from FII "See All" to the F&O tab...');
        if (!(await marketsPage.navigateBackToFnoTab('FII "See All"'))) {
            throw new Error('Could not get back to the Markets (F&O) screen from FII "See All"');
        }

        // Leave the dropdown on its default for the next run's TC 109.
        console.log('\nTC 137: Resetting the FII Trend in F&O dropdown to Stock Futures...');
        if (!(await marketsPage.readFiiTrend())) await marketsPage.scrollToFiiTrend();
        await marketsPage.selectFiiTrendFilter('Stock Futures');
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
