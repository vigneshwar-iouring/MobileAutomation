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

// Runs one TC: logs "TC N: <title>", and if it throws, logs it as that TC's failure and returns
// undefined instead of stopping the run - every TC runs, and getFailedTCs() lists the failures at the end.
let tcCount = 0;
async function step(title, fn) {
    const n = ++tcCount;
    console.log(`\nTC ${n}: ${title}`);
    try {
        return await fn();
    } catch (err) {
        console.error(`TC ${n} FAIL: ${err.message}`);
        return undefined;
    }
}

async function run() {
    const driver = await DriverManager.getDriver();
    try {
        const marketsPage = new MarketsPage(driver);

        await step('Checking if the app is already on the Markets screen...', async () => {
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

        await step('Clicking the Commodity tab and verifying it is selected...', async () => {
            if (!(await marketsPage.clickCommodityTab())) {
                throw new Error('Commodity tab was not selected after tapping it');
            }
        });

        const indexQuote = await step('Clicking the first index in the index bar above the search bar and verifying its Quote screen (symbol, LTP, segment)...', async () => {
            const quote = await marketsPage.openFirstIndexBarQuote();
            if (!quote) throw new Error('Quote screen did not open from the index bar');
            return quote;
        });

        const optionChainOpened = await step('Clicking Option Chain and verifying the Option Chain screen opens...', async () => {
            if (!indexQuote) throw new Error('No index Quote open to reach Option Chain from');
            if (!(await marketsPage.openOptionChain())) throw new Error('Option Chain screen did not open');
            return true;
        });

        // NxtOption banner shows on Option Chain for Commodity and F&O, not for Equity or Currency.
        await step('Verifying the NxtOption banner is displayed on Option Chain...', async () => {
            if (!optionChainOpened) throw new Error('Option Chain is not open');
            if (!(await marketsPage.verifyOptionChainNxtOptionBanner(true))) {
                throw new Error('NxtOption banner not displayed on the Commodity Option Chain');
            }
        });

        await step('Navigating back from Option Chain to the Commodity tab...', async () => {
            if (indexQuote && !(await marketsPage.navigateBackToCommodityTab(`${indexQuote.symbol}'s Option Chain`))) {
                throw new Error('Could not get back to the Markets (Commodity) screen from Option Chain');
            }
        });

        await step('Verifying the first section on Commodity is "Commodity Market Insights"...', async () => {
            await marketsPage.scrollToTopUnlessAt('Commodity Market Insights');
            const firstSection = await marketsPage.getFirstSectionTitle();
            console.log(`First section on Commodity: "${firstSection}" - ${firstSection === 'Commodity Market Insights' ? 'PASS' : 'FAIL (expected "Commodity Market Insights")'}`);
        });

        await step('Verifying Top Gainers is selected by default with a list of Commodity symbols...', () =>
            marketsPage.verifyCommodityInsightsDefault());

        const insightQuote = await step('Clicking the first symbol under Commodity Market Insights and verifying its Quote screen...', async () =>
            marketsPage.openFirstFnoSymbol('Commodity Market Insights', await marketsPage.getFnoInsightRows()));

        // Same click-only sub-tab row as Equity's Market Movers: rewind to Tab 1 (in case it was left
        // scrolled), then tapping 1..5 in order brings each next tab into view. 5 tabs ("Top Gainers
        // \nTab 1 of 5") as seen live by Regression/New_Regression.spec.js.
        const insightTabCount = await step('Navigating back from the Quote to the Commodity tab...', async () => {
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

        for (let i = 1; i <= 5; i++) {
            await step(`Clicking Commodity Market Insights tab ${i}${i === 1 ? ' (Top Gainers)' : ''} and verifying it lists symbols...`, async () => {
                if (!insightTabCount) throw new Error('Commodity Market Insights tabs not found');
                await marketsPage.clickCommodityInsightsTab(i, insightTabCount);
            });
        }

        await step('Clicking "See all" on Commodity Market Insights...', async () => {
            await marketsPage.scrollToTopUnlessAt('Commodity Market Insights');
            await marketsPage.clickSeeAllCommodityInsights();
            if (!(await marketsPage.verifyCommodityInsightsSeeAllOpened())) {
                throw new Error('Commodity Market Insights "See all" screen did not open');
            }
        });

        await step('Verifying Top Gainers is selected by default with a list of Commodity symbols...', () =>
            marketsPage.verifyCommodityInsightsDefault());

        const seeAllQuote = await step('"See all" - clicking the first symbol and verifying its Quote screen...', async () =>
            marketsPage.openFirstFnoSymbol('Commodity Market Insights "See all"', await marketsPage.getFnoInsightRows()));

        const seeAllTabCount = await step('Navigating back from the Quote to Commodity Market Insights "See all"...', async () => {
            if (seeAllQuote && !(await marketsPage.navigateBackToCommodityInsightsSeeAll(`${seeAllQuote.symbol}'s Quote`))) {
                throw new Error('Could not get back to Commodity Market Insights "See all" from the Quote');
            }
            const seeAllTabs = await marketsPage.getMoversTabs();
            const count = seeAllTabs.length ? seeAllTabs[0].total : 0;
            if (!count) {
                throw new Error('Commodity Market Insights "See all" tabs not found');
            }
            await marketsPage.rewindMoversTabs();
            return count;
        }) || 0;
        for (let i = 1; i <= seeAllTabCount; i++) {
            await step(`"See all" - clicking tab ${i} of ${seeAllTabCount} and verifying it lists symbols...`, () =>
                marketsPage.clickCommodityInsightsTab(i, seeAllTabCount));
        }

        await step('Closing Commodity Market Insights "See all" and navigating back to the Commodity tab...', async () => {
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

        const nxtOptionTools = ['Strategy Builder', 'IV Analysis', 'OI Analysis'];
        for (const [i, tool] of nxtOptionTools.entries()) {
            await step(i === 0
                ? `Clicking the NxtOption banner below Commodity Market Insights and verifying ${nxtOptionTools.join(', ')} are displayed...`
                : 'Clicking the NxtOption banner again...', async () => {
                if (!(await marketsPage.clickNxtOptionBanner())) {
                    throw new Error('NxtOption popup did not open from the Commodity banner');
                }
            });

            const toolOpened = await step(`Clicking ${tool} and verifying the app navigates to ${tool}...`, () =>
                marketsPage.openNxtOptionTool(tool));

            await step(tool === 'Strategy Builder'
                ? 'Clicking Buy Call and waiting 5s for the data/graph to load...'
                : `Clicking each ${tool} tab and waiting 3s on each for its data to load...`, async () => {
                if (!toolOpened) throw new Error(`${tool} is not open`);
                if (!(await marketsPage.exploreNxtOptionTool(tool))) {
                    throw new Error(`${tool} did not load its data for every tap`);
                }
            });

            await step(`Navigating back from ${tool} to the Commodity tab...`, async () => {
                if (!(await marketsPage.navigateBackToCommodityTab(tool))) {
                    throw new Error(`Could not get back to the Markets (Commodity) screen from ${tool}`);
                }
            });
        }

        await step('Navigating back to Commodity Market Insights...', async () => {
            await marketsPage.scrollToTopUnlessAt('Commodity Market Insights');
            const topSection = await marketsPage.getFirstSectionTitle();
            console.log(`Back on Commodity Market Insights: ${topSection === 'Commodity Market Insights' ? 'PASS' : `FAIL (first section is "${topSection}")`}`);
        });

        await step('Scrolling down to Trending Commodities Options...', async () => {
            if (!(await marketsPage.scrollToTrendingCommodities())) {
                throw new Error('Trending Commodities Options section not found on the Commodity tab');
            }
        });

        await step('Verifying Most Traded is selected by default...', () =>
            marketsPage.isTrendingCommodityTabSelected('Most Traded'));

        await step('Verifying Most Traded lists Commodity symbols with expiry...', () =>
            marketsPage.verifyTrendingCommodityRows('Most Traded'));

        const mostTradedQuote = await step('Clicking the first Most Traded symbol and verifying its Quote screen...', async () =>
            marketsPage.openFirstFnoSymbol('Trending Commodities Options "Most Traded"', await marketsPage.getTrendingCommodityRows()));

        await step('Navigating back from the Quote to the Commodity tab...', async () => {
            if (mostTradedQuote && !(await marketsPage.navigateBackToCommodityTab(`${mostTradedQuote.symbol}'s Quote`))) {
                throw new Error('Could not get back to the Markets (Commodity) screen from the Most Traded Quote');
            }
            if (!(await marketsPage.scrollToTrendingCommodities())) {
                throw new Error('Trending Commodities Options section not found on the Commodity tab');
            }
        });

        await step('Clicking Highest OI and verifying it is selected...', async () => {
            await marketsPage.clickTrendingCommodityTab('Highest OI');
            await marketsPage.isTrendingCommodityTabSelected('Highest OI');
        });

        await step('Verifying Highest OI lists Commodity symbols with expiry...', () =>
            marketsPage.verifyTrendingCommodityRows('Highest OI'));

        const highestOiQuote = await step('Clicking the first Highest OI symbol and verifying its Quote screen...', async () =>
            marketsPage.openFirstFnoSymbol('Trending Commodities Options "Highest OI"', await marketsPage.getTrendingCommodityRows()));

        await step('Navigating back from the Quote to the Commodity tab...', async () => {
            if (highestOiQuote && !(await marketsPage.navigateBackToCommodityTab(`${highestOiQuote.symbol}'s Quote`))) {
                throw new Error('Could not get back to the Markets (Commodity) screen from the Highest OI Quote');
            }
        });

        // Tab count/names aren't fixed in code - read "Tab 1 of N" off the row, rewind it (it may be
        // left scrolled from a previous run), then tap 1..N in order, each tap bringing the next into view.
        const topTabCount = await step('Scrolling down to Top Commodities...', async () => {
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

        const topQuote = await step('Clicking the first Top Commodities symbol and verifying its Quote screen...', async () =>
            marketsPage.openFirstFnoSymbol('Top Commodities', await marketsPage.getTopCommoditiesRows()));

        await step('Navigating back from the Quote to the Commodity tab...', async () => {
            if (topQuote && !(await marketsPage.navigateBackToCommodityTab(`${topQuote.symbol}'s Quote`))) {
                throw new Error('Could not get back to the Markets (Commodity) screen from the Top Commodities Quote');
            }
            if (!(await marketsPage.scrollToTopCommodities())) {
                throw new Error('Top Commodities section not found on the Commodity tab');
            }
            await marketsPage.rewindTopCommoditiesTabs();
        });

        for (let i = 1; i <= topTabCount; i++) {
            await step(`Clicking Top Commodities tab ${i} of ${topTabCount} and verifying symbols are listed...`, () =>
                marketsPage.clickTopCommoditiesTab(i));
        }

        const topSeeAllTabCount = await step('Clicking "See all" on Top Commodities...', async () => {
            await marketsPage.scrollToTopCommodities();
            await marketsPage.clickSeeAllTopCommodities();
            if (!(await marketsPage.verifyTopCommoditiesSeeAllOpened())) {
                throw new Error('Top Commodities "See all" screen did not open');
            }
            const topSeeAllTabs = await marketsPage.getTopCommoditiesTabs();
            await marketsPage.rewindTopCommoditiesTabs();
            return topSeeAllTabs.length ? topSeeAllTabs[0].total : 0;
        }) || 0;

        const topSeeAllQuote = await step('"See all" - clicking the first Top Commodities symbol and verifying its Quote screen...', async () =>
            marketsPage.openFirstFnoSymbol('Top Commodities "See all"', await marketsPage.getTopCommoditiesRows()));

        await step('Navigating back from the Quote to Top Commodities "See all"...', async () => {
            if (topSeeAllQuote && !(await marketsPage.navigateBackToSeeAll(marketsPage.topCommoditiesHeading, `${topSeeAllQuote.symbol}'s Quote`))) {
                throw new Error('Could not get back to Top Commodities "See all" from the Quote');
            }
            await marketsPage.rewindTopCommoditiesTabs();
        });

        for (let i = 1; i <= topSeeAllTabCount; i++) {
            await step(`"See all" - clicking Top Commodities tab ${i} of ${topSeeAllTabCount} and verifying symbols are listed...`, () =>
                marketsPage.clickTopCommoditiesTab(i, 'Top Commodities "See all"'));
        }

        await step('Closing Top Commodities "See all" and navigating back to the Commodity tab...', async () => {
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

        await step('Scrolling down to OI Analysis...', async () => {
            if (!(await marketsPage.scrollToOiAnalysis())) {
                throw new Error('OI Analysis section not found on the Commodity tab');
            }
        });

        // Click-only tab row like the others: tapping the tabs in order brings each next tab into view.
        // Each tab's own message is checked before "See all" too, against the tabs already visited.
        const oiTabs = ['Long Buildup', 'Long Unwinding', 'Short Buildup', 'Short Covering'];
        const oiTabMessages = new Map();
        for (const [i, label] of oiTabs.entries()) {
            const index = i + 1;
            const rows = await step(`Clicking OI Analysis "${label}" and verifying its own message with symbols with expiry, Open Interest and Price...`, () =>
                selectOiTab(marketsPage, index, label, oiTabMessages));
            const quote = await step(`Clicking the first OI Analysis "${label}" symbol and verifying its Quote screen...`, () =>
                marketsPage.openFirstFnoSymbol(`OI Analysis "${label}"`, rows || []));
            await step('Navigating back from the Quote to the Commodity tab...', () =>
                backToCommodityFromOiQuote(marketsPage, quote, label));
            await step(`Verifying OI Analysis "${label}" lists symbols with expiry under Symbol, Open Interest, Price...`, () =>
                reverifyOiTab(marketsPage, index, label));
        }

        await step('Clicking "See all" on OI Analysis...', async () => {
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
        for (const [i, label] of oiTabs.entries()) {
            await step(`"See all" - clicking "${label}" and verifying its own message with symbols...`, () =>
                verifyOiSeeAllTab(marketsPage, i + 1, label, oiMessages));
        }

        const oiSeeAllQuote = await step(`"See all" - clicking the first OI Analysis "${oiTabs[oiTabs.length - 1]}" symbol and verifying its Quote screen...`, async () =>
            marketsPage.openFirstFnoSymbol('OI Analysis "See all"', await marketsPage.getOiAnalysisRows()));

        await step('Navigating back from the Quote to OI Analysis "See all"...', async () => {
            if (oiSeeAllQuote && !(await marketsPage.navigateBackToSeeAll('OI Analysis', `${oiSeeAllQuote.symbol}'s Quote`))) {
                throw new Error('Could not get back to OI Analysis "See all" from the Quote');
            }
        });

        await step('Navigating back from OI Analysis "See all" to the Commodity tab...', async () => {
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
