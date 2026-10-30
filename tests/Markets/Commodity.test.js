const DriverManager = require('../../driver/DriverManager');
const { MarketsPage } = require('../../pages/MarketsPage');
const { createLogger, getFailedTCs } = require('../../utils/logger');

const { logFile, entries } = createLogger('Markets_Commodity');
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
    return (await marketsPage.verifyCommodityOiAnalysisRows(label)).rows;
}

async function backToCommodityFromOiQuote(marketsPage, quote, label) {
    if (quote && !(await marketsPage.navigateBackToCommodityTab(`${quote.symbol}'s Quote`))) {
        throw new Error(`Could not get back to the Markets (Commodity) screen from the OI Analysis "${label}" Quote`);
    }
}

// Back on Commodity after a Quote: return to OI Analysis (re-selecting the tab if the app reset it)
// and verify its list again.
async function reverifyOiTab(marketsPage, index, label) {
    if (!(await marketsPage.scrollToOiAnalysis())) {
        throw new Error('OI Analysis section not found on the Commodity tab');
    }
    const selectedTab = await marketsPage.getSelectedOiAnalysisTab();
    if (selectedTab !== label) {
        console.log(`OI Analysis is on "${selectedTab}" after coming back - re-selecting "${label}"`);
        await marketsPage.clickOiAnalysisTab(index);
    }
    await marketsPage.verifyCommodityOiAnalysisRows(label);
}

// "See all": tab `label` must show its own message (different from every tab in `messages` so far)
// above its symbols.
async function verifyOiSeeAllTab(marketsPage, index, label, messages) {
    const tab = await marketsPage.clickOiAnalysisTab(index);
    if (!tab) return;
    await verifyOiMessage(marketsPage, '"See all" ', label, messages);
    await marketsPage.verifyCommodityOiAnalysisRows(`See all ${label}`);
}

// Taps Commodity Market Insights tab `i` of `count` (`where` names the screen for errors).
async function clickInsightsTab(marketsPage, where, i, count) {
    if (!count) throw new Error(`${where} tabs not found`);
    if (i > count) throw new Error(`${where} shows only ${count} tabs - no tab ${i}`);
    await marketsPage.clickCommodityInsightsTab(i, count);
}

async function clickNxtOptionBanner(marketsPage) {
    if (!(await marketsPage.clickNxtOptionBanner())) {
        throw new Error('NxtOption popup did not open from the Commodity banner');
    }
}

async function exploreNxtOptionTool(marketsPage, tool, toolOpened) {
    if (!toolOpened) throw new Error(`${tool} is not open`);
    if (!(await marketsPage.exploreNxtOptionTool(tool))) {
        throw new Error(`${tool} did not load its data for every tap`);
    }
}

async function backToCommodityFromTool(marketsPage, tool) {
    if (!(await marketsPage.navigateBackToCommodityTab(tool))) {
        throw new Error(`Could not get back to the Markets (Commodity) screen from ${tool}`);
    }
}

// Runs one TC: logs its "TC N: <title>", and if it throws, logs it as that TC's failure and returns
// undefined instead of stopping the run - every TC runs, and getFailedTCs() lists the failures at the end.
let tcCount = 0;
async function step(title, fn) {
    tcCount++;
    const tc = title.slice(0, title.indexOf(':'));
    console.log(`\n${title}`);
    try {
        return await fn();
    } catch (err) {
        console.error(`${tc} FAIL: ${err.message}`);
        return undefined;
    }
}

async function run() {
    const driver = await DriverManager.getDriver();
    try {
        const marketsPage = new MarketsPage(driver);

        await step('TC 1: Checking if the app is already on the Markets screen...', async () => {
            if (await marketsPage.waitForEquityLoaded(3000)) {
                console.log('Already on Markets screen - skipping bottom navigation tap, continuing with remaining TCs');
                return;
            }
            console.log('Not on Markets screen - clicking Market bottom navigation button...');
            await marketsPage.clickMarketNavButton();
            if (!(await marketsPage.waitForEquityLoaded(10000))) {
                throw new Error('Markets screen did not load within 10 seconds');
            }
        });

        await step('TC 2: Clicking the Commodity tab and verifying it is selected...', async () => {
            if (!(await marketsPage.clickCommodityTab())) {
                throw new Error('Commodity tab was not selected after tapping it');
            }
        });

        const indexQuote = await step('TC 3: Clicking the first index in the index bar above the search bar and verifying its Quote screen (symbol, LTP, segment)...', async () => {
            const quote = await marketsPage.openFirstIndexBarQuote();
            if (!quote) throw new Error('Quote screen did not open from the index bar');
            return quote;
        });

        const optionChainOpened = await step('TC 4: Clicking Option Chain and verifying the Option Chain screen opens...', async () => {
            if (!indexQuote) throw new Error('No index Quote open to reach Option Chain from');
            if (!(await marketsPage.openOptionChain())) throw new Error('Option Chain screen did not open');
            return true;
        });

        // NxtOption banner shows on Option Chain for Commodity and F&O, not for Equity or Currency.
        await step('TC 5: Verifying the NxtOption banner is displayed on Option Chain...', async () => {
            if (!optionChainOpened) throw new Error('Option Chain is not open');
            if (!(await marketsPage.verifyOptionChainNxtOptionBanner(true))) {
                throw new Error('NxtOption banner not displayed on the Commodity Option Chain');
            }
        });

        await step('TC 6: Navigating back from Option Chain to the Commodity tab...', async () => {
            if (indexQuote && !(await marketsPage.navigateBackToCommodityTab(`${indexQuote.symbol}'s Option Chain`))) {
                throw new Error('Could not get back to the Markets (Commodity) screen from Option Chain');
            }
        });

        await step('TC 7: Verifying the first section on Commodity is "Commodity Market Insights"...', async () => {
            await marketsPage.scrollToTopUnlessAt('Commodity Market Insights');
            const firstSection = await marketsPage.getFirstSectionTitle();
            console.log(`First section on Commodity: "${firstSection}" - ${firstSection === 'Commodity Market Insights' ? 'PASS' : 'FAIL (expected "Commodity Market Insights")'}`);
        });

        await step('TC 8: Verifying Top Gainers is selected by default with a list of Commodity symbols...', () =>
            marketsPage.verifyCommodityInsightsDefault());

        const insightQuote = await step('TC 9: Clicking the first symbol under Commodity Market Insights and verifying its Quote screen...', async () =>
            marketsPage.openFirstFnoSymbol('Commodity Market Insights', await marketsPage.getFnoInsightRows()));

        // Same click-only sub-tab row as Equity's Market Movers: rewind to Tab 1 (in case it was left
        // scrolled), then tapping 1..5 in order brings each next tab into view. 5 tabs ("Top Gainers
        // \nTab 1 of 5") as seen live by Regression/New_Regression.spec.js.
        const insightTabCount = await step('TC 10: Navigating back from the Quote to the Commodity tab...', async () => {
            if (insightQuote && !(await marketsPage.navigateBackToCommodityTab(`${insightQuote.symbol}'s Quote`))) {
                throw new Error('Could not get back to the Markets (Commodity) screen from the Commodity Market Insights Quote');
            }
            await marketsPage.scrollToTopUnlessAt('Commodity Market Insights');
            const insightTabs = await marketsPage.getMoversTabs();
            const count = insightTabs.length ? insightTabs[0].total : 0;
            if (!count) {
                throw new Error('Commodity Market Insights tabs not found');
            }
            console.log(`Commodity Market Insights shows ${count} tabs: ${count === 5 ? 'PASS' : 'FAIL (expected 5)'}`);
            await marketsPage.rewindMoversTabs();
            return count;
        });

        await step('TC 11: Clicking Commodity Market Insights tab 1 (Top Gainers) and verifying it lists symbols...', () =>
            clickInsightsTab(marketsPage, 'Commodity Market Insights', 1, insightTabCount));

        await step('TC 12: Clicking Commodity Market Insights tab 2 and verifying it lists symbols...', () =>
            clickInsightsTab(marketsPage, 'Commodity Market Insights', 2, insightTabCount));

        await step('TC 13: Clicking Commodity Market Insights tab 3 and verifying it lists symbols...', () =>
            clickInsightsTab(marketsPage, 'Commodity Market Insights', 3, insightTabCount));

        await step('TC 14: Clicking Commodity Market Insights tab 4 and verifying it lists symbols...', () =>
            clickInsightsTab(marketsPage, 'Commodity Market Insights', 4, insightTabCount));

        await step('TC 15: Clicking Commodity Market Insights tab 5 and verifying it lists symbols...', () =>
            clickInsightsTab(marketsPage, 'Commodity Market Insights', 5, insightTabCount));

        await step('TC 16: Clicking "See all" on Commodity Market Insights...', async () => {
            await marketsPage.scrollToTopUnlessAt('Commodity Market Insights');
            await marketsPage.clickSeeAllCommodityInsights();
            if (!(await marketsPage.verifyCommodityInsightsSeeAllOpened())) {
                throw new Error('Commodity Market Insights "See all" screen did not open');
            }
        });

        await step('TC 17: Verifying Top Gainers is selected by default with a list of Commodity symbols...', () =>
            marketsPage.verifyCommodityInsightsDefault());

        const seeAllQuote = await step('TC 18: "See all" - clicking the first symbol and verifying its Quote screen...', async () =>
            marketsPage.openFirstFnoSymbol('Commodity Market Insights "See all"', await marketsPage.getFnoInsightRows()));

        // "See all" has the same 5 tabs as Commodity Market Insights itself.
        const seeAllTabCount = await step('TC 19: Navigating back from the Quote to Commodity Market Insights "See all"...', async () => {
            if (seeAllQuote && !(await marketsPage.navigateBackToCommodityInsightsSeeAll(`${seeAllQuote.symbol}'s Quote`))) {
                throw new Error('Could not get back to Commodity Market Insights "See all" from the Quote');
            }
            const seeAllTabs = await marketsPage.getMoversTabs();
            const count = seeAllTabs.length ? seeAllTabs[0].total : 0;
            if (!count) {
                throw new Error('Commodity Market Insights "See all" tabs not found');
            }
            console.log(`Commodity Market Insights "See all" shows ${count} tabs: ${count === 5 ? 'PASS' : 'FAIL (expected 5)'}`);
            await marketsPage.rewindMoversTabs();
            return count;
        });

        await step('TC 20: "See all" - clicking tab 1 (Top Gainers) and verifying it lists symbols...', () =>
            clickInsightsTab(marketsPage, 'Commodity Market Insights "See all"', 1, seeAllTabCount));

        await step('TC 21: "See all" - clicking tab 2 and verifying it lists symbols...', () =>
            clickInsightsTab(marketsPage, 'Commodity Market Insights "See all"', 2, seeAllTabCount));

        await step('TC 22: "See all" - clicking tab 3 and verifying it lists symbols...', () =>
            clickInsightsTab(marketsPage, 'Commodity Market Insights "See all"', 3, seeAllTabCount));

        await step('TC 23: "See all" - clicking tab 4 and verifying it lists symbols...', () =>
            clickInsightsTab(marketsPage, 'Commodity Market Insights "See all"', 4, seeAllTabCount));

        await step('TC 24: "See all" - clicking tab 5 and verifying it lists symbols...', () =>
            clickInsightsTab(marketsPage, 'Commodity Market Insights "See all"', 5, seeAllTabCount));

        await step('TC 25: Closing Commodity Market Insights "See all" and navigating back to the Commodity tab...', async () => {
            // Leave "See all" on Top Gainers for the next run's default check.
            await marketsPage.rewindMoversTabs();
            await marketsPage.closeCommodityInsightsSeeAll();
            if (!(await marketsPage.navigateBackToMarkets())) {
                throw new Error('Could not get back to the Markets screen from Commodity Market Insights "See all"');
            }
            if (!(await marketsPage.isSegmentTabSelected(marketsPage.commodityTab)) && !(await marketsPage.clickCommodityTab())) {
                throw new Error('Commodity tab was not selected after tapping it');
            }
            console.log('Back on Markets (Commodity): PASS');
        });

        await step('TC 26: Clicking the NxtOption banner below Commodity Market Insights and verifying Strategy Builder, IV Analysis, OI Analysis are displayed...', () =>
            clickNxtOptionBanner(marketsPage));
        const strategyBuilderOpened = await step('TC 27: Clicking Strategy Builder and verifying the app navigates to Strategy Builder...', () =>
            marketsPage.openNxtOptionTool('Strategy Builder'));
        await step('TC 28: Clicking Buy Call and waiting 5s for the data/graph to load...', () =>
            exploreNxtOptionTool(marketsPage, 'Strategy Builder', strategyBuilderOpened));
        await step('TC 29: Navigating back from Strategy Builder to the Commodity tab...', () =>
            backToCommodityFromTool(marketsPage, 'Strategy Builder'));

        await step('TC 30: Clicking the NxtOption banner again...', () =>
            clickNxtOptionBanner(marketsPage));
        const ivAnalysisOpened = await step('TC 31: Clicking IV Analysis and verifying the app navigates to IV Analysis...', () =>
            marketsPage.openNxtOptionTool('IV Analysis'));
        await step('TC 32: Clicking each IV Analysis tab and waiting 3s on each for its data to load...', () =>
            exploreNxtOptionTool(marketsPage, 'IV Analysis', ivAnalysisOpened));
        await step('TC 33: Navigating back from IV Analysis to the Commodity tab...', () =>
            backToCommodityFromTool(marketsPage, 'IV Analysis'));

        await step('TC 34: Clicking the NxtOption banner again...', () =>
            clickNxtOptionBanner(marketsPage));
        const oiAnalysisOpened = await step('TC 35: Clicking OI Analysis and verifying the app navigates to OI Analysis...', () =>
            marketsPage.openNxtOptionTool('OI Analysis'));
        await step('TC 36: Clicking each OI Analysis tab and waiting 3s on each for its data to load...', () =>
            exploreNxtOptionTool(marketsPage, 'OI Analysis', oiAnalysisOpened));
        await step('TC 37: Navigating back from OI Analysis to the Commodity tab...', () =>
            backToCommodityFromTool(marketsPage, 'OI Analysis'));

        await step('TC 38: Navigating back to Commodity Market Insights...', async () => {
            await marketsPage.scrollToTopUnlessAt('Commodity Market Insights');
            const topSection = await marketsPage.getFirstSectionTitle();
            console.log(`Back on Commodity Market Insights: ${topSection === 'Commodity Market Insights' ? 'PASS' : `FAIL (first section is "${topSection}")`}`);
        });

        await step('TC 39: Scrolling down to Trending Commodities Options...', async () => {
            if (!(await marketsPage.scrollToTrendingCommodities())) {
                throw new Error('Trending Commodities Options section not found on the Commodity tab');
            }
        });

        await step('TC 40: Verifying Most Traded is selected by default...', () =>
            marketsPage.isTrendingCommodityTabSelected('Most Traded'));

        await step('TC 41: Verifying Most Traded lists Commodity symbols with expiry...', () =>
            marketsPage.verifyTrendingCommodityRows('Most Traded'));

        const mostTradedQuote = await step('TC 42: Clicking the first Most Traded symbol and verifying its Quote screen...', async () =>
            marketsPage.openFirstFnoSymbol('Trending Commodities Options "Most Traded"', await marketsPage.getTrendingCommodityRows()));

        await step('TC 43: Navigating back from the Quote to the Commodity tab...', async () => {
            if (mostTradedQuote && !(await marketsPage.navigateBackToCommodityTab(`${mostTradedQuote.symbol}'s Quote`))) {
                throw new Error('Could not get back to the Markets (Commodity) screen from the Most Traded Quote');
            }
            if (!(await marketsPage.scrollToTrendingCommodities())) {
                throw new Error('Trending Commodities Options section not found on the Commodity tab');
            }
        });

        await step('TC 44: Clicking Highest OI and verifying it is selected...', async () => {
            await marketsPage.clickTrendingCommodityTab('Highest OI');
            await marketsPage.isTrendingCommodityTabSelected('Highest OI');
        });

        await step('TC 45: Verifying Highest OI lists Commodity symbols with expiry...', () =>
            marketsPage.verifyTrendingCommodityRows('Highest OI'));

        const highestOiQuote = await step('TC 46: Clicking the first Highest OI symbol and verifying its Quote screen...', async () =>
            marketsPage.openFirstFnoSymbol('Trending Commodities Options "Highest OI"', await marketsPage.getTrendingCommodityRows()));

        await step('TC 47: Navigating back from the Quote to the Commodity tab...', async () => {
            if (highestOiQuote && !(await marketsPage.navigateBackToCommodityTab(`${highestOiQuote.symbol}'s Quote`))) {
                throw new Error('Could not get back to the Markets (Commodity) screen from the Highest OI Quote');
            }
        });

        // Tab count/names aren't fixed in code - read "Tab 1 of N" off the row, rewind it (it may be
        // left scrolled from a previous run), then tap 1..N in order, each tap bringing the next into view.
        const topTabCount = await step('TC 48: Scrolling down to Top Commodities...', async () => {
            if (!(await marketsPage.scrollToTopCommodities())) {
                throw new Error('Top Commodities section not found on the Commodity tab');
            }
            const topTabs = await marketsPage.getTopCommoditiesTabs();
            const count = topTabs.length ? topTabs[0].total : 0;
            if (!count) {
                throw new Error('Top Commodities tabs not found');
            }
            await marketsPage.rewindTopCommoditiesTabs();
            return count;
        }) || 0;

        const topQuote = await step('TC 49: Clicking the first Top Commodities symbol and verifying its Quote screen...', async () =>
            marketsPage.openFirstFnoSymbol('Top Commodities', await marketsPage.getTopCommoditiesRows()));

        await step('TC 50: Navigating back from the Quote to the Commodity tab...', async () => {
            if (topQuote && !(await marketsPage.navigateBackToCommodityTab(`${topQuote.symbol}'s Quote`))) {
                throw new Error('Could not get back to the Markets (Commodity) screen from the Top Commodities Quote');
            }
            if (!(await marketsPage.scrollToTopCommodities())) {
                throw new Error('Top Commodities section not found on the Commodity tab');
            }
            await marketsPage.rewindTopCommoditiesTabs();
        });

        // Top Commodities' tab counts are read at runtime, so the TC numbers from here on follow them.
        let tc = 51;
        for (let i = 1; i <= topTabCount; i++) {
            await step(`TC ${tc++}: Clicking Top Commodities tab ${i} of ${topTabCount} and verifying symbols are listed...`, () =>
                marketsPage.clickTopCommoditiesTab(i));
        }

        const topSeeAllTabCount = await step(`TC ${tc++}: Clicking "See all" on Top Commodities...`, async () => {
            await marketsPage.scrollToTopCommodities();
            await marketsPage.clickSeeAllTopCommodities();
            if (!(await marketsPage.verifyTopCommoditiesSeeAllOpened())) {
                throw new Error('Top Commodities "See all" screen did not open');
            }
            const topSeeAllTabs = await marketsPage.getTopCommoditiesTabs();
            await marketsPage.rewindTopCommoditiesTabs();
            return topSeeAllTabs.length ? topSeeAllTabs[0].total : 0;
        }) || 0;

        const topSeeAllQuote = await step(`TC ${tc++}: "See all" - clicking the first Top Commodities symbol and verifying its Quote screen...`, async () =>
            marketsPage.openFirstFnoSymbol('Top Commodities "See all"', await marketsPage.getTopCommoditiesRows()));

        await step(`TC ${tc++}: Navigating back from the Quote to Top Commodities "See all"...`, async () => {
            if (topSeeAllQuote && !(await marketsPage.navigateBackToSeeAll(marketsPage.topCommoditiesHeading, `${topSeeAllQuote.symbol}'s Quote`))) {
                throw new Error('Could not get back to Top Commodities "See all" from the Quote');
            }
            await marketsPage.rewindTopCommoditiesTabs();
        });

        for (let i = 1; i <= topSeeAllTabCount; i++) {
            await step(`TC ${tc++}: "See all" - clicking Top Commodities tab ${i} of ${topSeeAllTabCount} and verifying symbols are listed...`, () =>
                marketsPage.clickTopCommoditiesTab(i, 'Top Commodities "See all"'));
        }

        await step(`TC ${tc++}: Closing Top Commodities "See all" and navigating back to the Commodity tab...`, async () => {
            // Leave "See all" on Tab 1 for the next run.
            await marketsPage.rewindTopCommoditiesTabs();
            await marketsPage.closeTopCommoditiesSeeAll();
            if (!(await marketsPage.navigateBackToMarkets())) {
                throw new Error('Could not get back to the Markets screen from Top Commodities "See all"');
            }
            if (!(await marketsPage.isSegmentTabSelected(marketsPage.commodityTab)) && !(await marketsPage.clickCommodityTab())) {
                throw new Error('Commodity tab was not selected after tapping it');
            }
            console.log('Back on Markets (Commodity): PASS');
        });

        await step(`TC ${tc++}: Scrolling down to OI Analysis...`, async () => {
            if (!(await marketsPage.scrollToOiAnalysis())) {
                throw new Error('OI Analysis section not found on the Commodity tab');
            }
        });

        // Click-only tab row like the others: tapping the tabs in order brings each next tab into view.
        // Each tab's own message is checked before "See all" too, against the tabs already visited.
        const oiTabMessages = new Map();

        const longBuildupRows = await step(`TC ${tc++}: Clicking OI Analysis "Long Buildup" and verifying its own message with symbols with expiry, Open Interest and Price...`, () =>
            selectOiTab(marketsPage, 1, 'Long Buildup', oiTabMessages));
        const longBuildupQuote = await step(`TC ${tc++}: Clicking the first OI Analysis "Long Buildup" symbol and verifying its Quote screen...`, () =>
            marketsPage.openFirstFnoSymbol('OI Analysis "Long Buildup"', longBuildupRows || []));
        await step(`TC ${tc++}: Navigating back from the Quote to the Commodity tab...`, () =>
            backToCommodityFromOiQuote(marketsPage, longBuildupQuote, 'Long Buildup'));
        await step(`TC ${tc++}: Verifying OI Analysis "Long Buildup" lists symbols with expiry under Symbol, Open Interest, Price...`, () =>
            reverifyOiTab(marketsPage, 1, 'Long Buildup'));

        const longUnwindingRows = await step(`TC ${tc++}: Clicking OI Analysis "Long Unwinding" and verifying its own message with symbols with expiry, Open Interest and Price...`, () =>
            selectOiTab(marketsPage, 2, 'Long Unwinding', oiTabMessages));
        const longUnwindingQuote = await step(`TC ${tc++}: Clicking the first OI Analysis "Long Unwinding" symbol and verifying its Quote screen...`, () =>
            marketsPage.openFirstFnoSymbol('OI Analysis "Long Unwinding"', longUnwindingRows || []));
        await step(`TC ${tc++}: Navigating back from the Quote to the Commodity tab...`, () =>
            backToCommodityFromOiQuote(marketsPage, longUnwindingQuote, 'Long Unwinding'));
        await step(`TC ${tc++}: Verifying OI Analysis "Long Unwinding" lists symbols with expiry under Symbol, Open Interest, Price...`, () =>
            reverifyOiTab(marketsPage, 2, 'Long Unwinding'));

        const shortBuildupRows = await step(`TC ${tc++}: Clicking OI Analysis "Short Buildup" and verifying its own message with symbols with expiry, Open Interest and Price...`, () =>
            selectOiTab(marketsPage, 3, 'Short Buildup', oiTabMessages));
        const shortBuildupQuote = await step(`TC ${tc++}: Clicking the first OI Analysis "Short Buildup" symbol and verifying its Quote screen...`, () =>
            marketsPage.openFirstFnoSymbol('OI Analysis "Short Buildup"', shortBuildupRows || []));
        await step(`TC ${tc++}: Navigating back from the Quote to the Commodity tab...`, () =>
            backToCommodityFromOiQuote(marketsPage, shortBuildupQuote, 'Short Buildup'));
        await step(`TC ${tc++}: Verifying OI Analysis "Short Buildup" lists symbols with expiry under Symbol, Open Interest, Price...`, () =>
            reverifyOiTab(marketsPage, 3, 'Short Buildup'));

        const shortCoveringRows = await step(`TC ${tc++}: Clicking OI Analysis "Short Covering" and verifying its own message with symbols with expiry, Open Interest and Price...`, () =>
            selectOiTab(marketsPage, 4, 'Short Covering', oiTabMessages));
        const shortCoveringQuote = await step(`TC ${tc++}: Clicking the first OI Analysis "Short Covering" symbol and verifying its Quote screen...`, () =>
            marketsPage.openFirstFnoSymbol('OI Analysis "Short Covering"', shortCoveringRows || []));
        await step(`TC ${tc++}: Navigating back from the Quote to the Commodity tab...`, () =>
            backToCommodityFromOiQuote(marketsPage, shortCoveringQuote, 'Short Covering'));
        await step(`TC ${tc++}: Verifying OI Analysis "Short Covering" lists symbols with expiry under Symbol, Open Interest, Price...`, () =>
            reverifyOiTab(marketsPage, 4, 'Short Covering'));

        await step(`TC ${tc++}: Clicking "See all" on OI Analysis...`, async () => {
            if (!(await marketsPage.scrollToOiAnalysis())) {
                throw new Error('OI Analysis section not found on the Commodity tab');
            }
            await marketsPage.clickSeeAllOiAnalysis();
            if (!(await marketsPage.verifyOiAnalysisSeeAllOpened())) {
                throw new Error('OI Analysis "See all" screen did not open');
            }
        });

        // Every tab explains its own build-up/unwinding pattern above its list, so each tab's message
        // must be present and different from every other tab's.
        const oiMessages = new Map();
        await step(`TC ${tc++}: "See all" - clicking "Long Buildup" and verifying its own message with symbols...`, () =>
            verifyOiSeeAllTab(marketsPage, 1, 'Long Buildup', oiMessages));
        await step(`TC ${tc++}: "See all" - clicking "Long Unwinding" and verifying its own message with symbols...`, () =>
            verifyOiSeeAllTab(marketsPage, 2, 'Long Unwinding', oiMessages));
        await step(`TC ${tc++}: "See all" - clicking "Short Buildup" and verifying its own message with symbols...`, () =>
            verifyOiSeeAllTab(marketsPage, 3, 'Short Buildup', oiMessages));
        await step(`TC ${tc++}: "See all" - clicking "Short Covering" and verifying its own message with symbols...`, () =>
            verifyOiSeeAllTab(marketsPage, 4, 'Short Covering', oiMessages));

        const oiSeeAllQuote = await step(`TC ${tc++}: "See all" - clicking the first OI Analysis "Short Covering" symbol and verifying its Quote screen...`, async () =>
            marketsPage.openFirstFnoSymbol('OI Analysis "See all"', await marketsPage.getOiAnalysisRows()));

        await step(`TC ${tc++}: Navigating back from the Quote to OI Analysis "See all"...`, async () => {
            if (oiSeeAllQuote && !(await marketsPage.navigateBackToSeeAll('OI Analysis', `${oiSeeAllQuote.symbol}'s Quote`))) {
                throw new Error('Could not get back to OI Analysis "See all" from the Quote');
            }
        });

        await step(`TC ${tc++}: Navigating back from OI Analysis "See all" to the Commodity tab...`, async () => {
            if (!(await marketsPage.navigateBackToCommodityTab('OI Analysis "See all"'))) {
                throw new Error('Could not get back to the Markets (Commodity) screen from OI Analysis "See all"');
            }
        });
    } catch (err) {
        console.error('Test failed:', err.message);
        console.error(err.stack);
    } finally {
        await DriverManager.closeDriver();

        const failedTCs = getFailedTCs(entries);
        if (failedTCs.length) {
            console.log(`\n=== Failed Test Cases (${failedTCs.length} of ${tcCount}) ===`);
            failedTCs.forEach(f => {
                console.log(`${f.tc}:`);
                f.messages.forEach(m => console.log(`  - ${m}`));
            });
        } else {
            console.log(`\nAll ${tcCount} test cases passed.`);
        }
    }
}

run();
