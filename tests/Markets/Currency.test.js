const DriverManager = require('../../driver/DriverManager');
const { MarketsPage } = require('../../pages/MarketsPage');
const { createLogger, getFailedTCs } = require('../../utils/logger');

const { logFile, entries } = createLogger('Markets_Currency');
console.log(`Logging this run to: ${logFile}`);

// Same flow as tests/Markets/Commodity.test.js, minus the NxtOption banner steps - Currency has no
// NxtOption banner - and with Top Currencies' single list in place of Top Commodities' tabs.

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
    return (await marketsPage.verifyCurrencyOiAnalysisRows(label)).rows;
}

async function backToCurrencyFromOiQuote(marketsPage, quote, label) {
    if (quote && !(await marketsPage.navigateBackToCurrencyTab(`${quote.symbol}'s Quote`))) {
        throw new Error(`Could not get back to the Markets (Currency) screen from the OI Analysis "${label}" Quote`);
    }
}

// Back on Currency after a Quote: return to OI Analysis (re-selecting the tab if the app reset it)
// and verify its list again.
async function reverifyOiTab(marketsPage, index, label) {
    if (!(await marketsPage.scrollToOiAnalysis())) {
        throw new Error('OI Analysis section not found on the Currency tab');
    }
    const selectedTab = await marketsPage.getSelectedOiAnalysisTab();
    if (selectedTab !== label) {
        console.log(`OI Analysis is on "${selectedTab}" after coming back - re-selecting "${label}"`);
        await marketsPage.clickOiAnalysisTab(index);
    }
    await marketsPage.verifyCurrencyOiAnalysisRows(label);
}

// "See all": tab `label` must show its own message (different from every tab in `messages` so far)
// above its symbols.
async function verifyOiSeeAllTab(marketsPage, index, label, messages) {
    const tab = await marketsPage.clickOiAnalysisTab(index);
    if (!tab) return;
    await verifyOiMessage(marketsPage, '"See all" ', label, messages);
    await marketsPage.verifyCurrencyOiAnalysisRows(`See all ${label}`);
}

// Taps Currency Market Insights tab `i` of `count` (`where` names the screen for errors).
async function clickInsightsTab(marketsPage, where, i, count) {
    if (!count) throw new Error(`${where} tabs not found`);
    if (i > count) throw new Error(`${where} shows only ${count} tabs - no tab ${i}`);
    await marketsPage.clickCurrencyInsightsTab(i, count);
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

        await step('TC 2: Clicking the Currency tab and verifying it is selected...', async () => {
            if (!(await marketsPage.clickCurrencyTab())) {
                throw new Error('Currency tab was not selected after tapping it');
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
        await step('TC 5: Verifying the NxtOption banner is not displayed on Option Chain...', async () => {
            if (!optionChainOpened) throw new Error('Option Chain is not open');
            if (!(await marketsPage.verifyOptionChainNxtOptionBanner(false))) {
                throw new Error('NxtOption banner displayed on the Currency Option Chain');
            }
        });

        await step('TC 6: Navigating back from Option Chain to the Currency tab...', async () => {
            if (indexQuote && !(await marketsPage.navigateBackToCurrencyTab(`${indexQuote.symbol}'s Option Chain`))) {
                throw new Error('Could not get back to the Markets (Currency) screen from Option Chain');
            }
        });

        await step('TC 7: Verifying the first section on Currency is "Currency Market Insights"...', async () => {
            await marketsPage.scrollToTopUnlessAt('Currency Market Insights');
            const firstSection = await marketsPage.getFirstSectionTitle();
            console.log(`First section on Currency: "${firstSection}" - ${firstSection === 'Currency Market Insights' ? 'PASS' : 'FAIL (expected "Currency Market Insights")'}`);
        });

        await step('TC 8: Verifying Top Gainers is selected by default with a list of Currency symbols...', () =>
            marketsPage.verifyCurrencyInsightsDefault());

        const insightQuote = await step('TC 9: Clicking the first symbol under Currency Market Insights and verifying its expanded Quote screen and 52 week indicator...', async () =>
            marketsPage.openFirstFnoSymbol('Currency Market Insights', await marketsPage.getFnoInsightRows()));

        // Same click-only sub-tab row as Commodity's: rewind to Tab 1 (in case it was left scrolled),
        // then tapping 1..5 in order brings each next tab into view. 5 tabs ("Top Gainers\nTab 1 of 5",
        // verified live).
        const insightTabCount = await step('TC 10: Navigating back from the Quote to the Currency tab...', async () => {
            if (insightQuote && !(await marketsPage.navigateBackToCurrencyTab(`${insightQuote.symbol}'s Quote`))) {
                throw new Error('Could not get back to the Markets (Currency) screen from the Currency Market Insights Quote');
            }
            await marketsPage.scrollToTopUnlessAt('Currency Market Insights');
            const insightTabs = await marketsPage.getMoversTabs();
            const count = insightTabs.length ? insightTabs[0].total : 0;
            if (!count) {
                throw new Error('Currency Market Insights tabs not found');
            }
            console.log(`Currency Market Insights shows ${count} tabs: ${count === 5 ? 'PASS' : 'FAIL (expected 5)'}`);
            await marketsPage.rewindMoversTabs();
            return count;
        });

        await step('TC 11: Clicking Currency Market Insights tab 1 (Top Gainers) and verifying it lists symbols...', () =>
            clickInsightsTab(marketsPage, 'Currency Market Insights', 1, insightTabCount));

        await step('TC 12: Clicking Currency Market Insights tab 2 and verifying it lists symbols...', () =>
            clickInsightsTab(marketsPage, 'Currency Market Insights', 2, insightTabCount));

        await step('TC 13: Clicking Currency Market Insights tab 3 and verifying it lists symbols...', () =>
            clickInsightsTab(marketsPage, 'Currency Market Insights', 3, insightTabCount));

        await step('TC 14: Clicking Currency Market Insights tab 4 and verifying it lists symbols...', () =>
            clickInsightsTab(marketsPage, 'Currency Market Insights', 4, insightTabCount));

        await step('TC 15: Clicking Currency Market Insights tab 5 and verifying it lists symbols...', () =>
            clickInsightsTab(marketsPage, 'Currency Market Insights', 5, insightTabCount));

        await step('TC 16: Clicking "See all" on Currency Market Insights...', async () => {
            await marketsPage.scrollToTopUnlessAt('Currency Market Insights');
            await marketsPage.clickSeeAllCurrencyInsights();
            if (!(await marketsPage.verifyCurrencyInsightsSeeAllOpened())) {
                throw new Error('Currency Market Insights "See all" screen did not open');
            }
        });

        await step('TC 17: Verifying Top Gainers is selected by default with a list of Currency symbols...', () =>
            marketsPage.verifyCurrencyInsightsDefault());

        const seeAllQuote = await step('TC 18: "See all" - clicking the first symbol and verifying its expanded Quote screen and 52 week indicator...', async () =>
            marketsPage.openFirstFnoSymbol('Currency Market Insights "See all"', await marketsPage.getFnoInsightRows()));

        // "See all" has the same 5 tabs as Currency Market Insights itself.
        const seeAllTabCount = await step('TC 19: Navigating back from the Quote to Currency Market Insights "See all"...', async () => {
            if (seeAllQuote && !(await marketsPage.navigateBackToCurrencyInsightsSeeAll(`${seeAllQuote.symbol}'s Quote`))) {
                throw new Error('Could not get back to Currency Market Insights "See all" from the Quote');
            }
            const seeAllTabs = await marketsPage.getMoversTabs();
            const count = seeAllTabs.length ? seeAllTabs[0].total : 0;
            if (!count) {
                throw new Error('Currency Market Insights "See all" tabs not found');
            }
            console.log(`Currency Market Insights "See all" shows ${count} tabs: ${count === 5 ? 'PASS' : 'FAIL (expected 5)'}`);
            await marketsPage.rewindMoversTabs();
            return count;
        });

        await step('TC 20: "See all" - clicking tab 1 (Top Gainers) and verifying it lists symbols...', () =>
            clickInsightsTab(marketsPage, 'Currency Market Insights "See all"', 1, seeAllTabCount));

        await step('TC 21: "See all" - clicking tab 2 and verifying it lists symbols...', () =>
            clickInsightsTab(marketsPage, 'Currency Market Insights "See all"', 2, seeAllTabCount));

        await step('TC 22: "See all" - clicking tab 3 and verifying it lists symbols...', () =>
            clickInsightsTab(marketsPage, 'Currency Market Insights "See all"', 3, seeAllTabCount));

        await step('TC 23: "See all" - clicking tab 4 and verifying it lists symbols...', () =>
            clickInsightsTab(marketsPage, 'Currency Market Insights "See all"', 4, seeAllTabCount));

        await step('TC 24: "See all" - clicking tab 5 and verifying it lists symbols...', () =>
            clickInsightsTab(marketsPage, 'Currency Market Insights "See all"', 5, seeAllTabCount));

        await step('TC 25: Closing Currency Market Insights "See all" and navigating back to the Currency tab...', async () => {
            // Leave "See all" on Top Gainers for the next run's default check.
            await marketsPage.rewindMoversTabs();
            await marketsPage.closeCurrencyInsightsSeeAll();
            if (!(await marketsPage.navigateBackToMarkets())) {
                throw new Error('Could not get back to the Markets screen from Currency Market Insights "See all"');
            }
            if (!(await marketsPage.isSegmentTabSelected(marketsPage.currencyTab)) && !(await marketsPage.clickCurrencyTab())) {
                throw new Error('Currency tab was not selected after tapping it');
            }
            console.log('Back on Markets (Currency): PASS');
        });

        await step('TC 26: Scrolling down to Trending Currencies Options...', async () => {
            if (!(await marketsPage.scrollToTrendingCurrencies())) {
                throw new Error('Trending Currencies Options section not found on the Currency tab');
            }
        });

        await step('TC 27: Verifying Most Traded is selected by default...', () =>
            marketsPage.isTrendingCurrencyTabSelected('Most Traded'));

        await step('TC 28: Verifying Most Traded lists Currency symbols with expiry...', () =>
            marketsPage.verifyTrendingCurrencyRows('Most Traded'));

        const mostTradedQuote = await step('TC 29: Clicking the first Most Traded symbol and verifying its expanded Quote screen and 52 week indicator...', async () =>
            marketsPage.openFirstFnoSymbol('Trending Currencies Options "Most Traded"', await marketsPage.getTrendingCurrencyRows()));

        await step('TC 30: Navigating back from the Quote to the Currency tab...', async () => {
            if (mostTradedQuote && !(await marketsPage.navigateBackToCurrencyTab(`${mostTradedQuote.symbol}'s Quote`))) {
                throw new Error('Could not get back to the Markets (Currency) screen from the Most Traded Quote');
            }
            if (!(await marketsPage.scrollToTrendingCurrencies())) {
                throw new Error('Trending Currencies Options section not found on the Currency tab');
            }
        });

        await step('TC 31: Clicking Highest OI and verifying it is selected...', async () => {
            await marketsPage.clickTrendingCurrencyTab('Highest OI');
            await marketsPage.isTrendingCurrencyTabSelected('Highest OI');
        });

        await step('TC 32: Verifying Highest OI lists Currency symbols with expiry...', () =>
            marketsPage.verifyTrendingCurrencyRows('Highest OI'));

        const highestOiQuote = await step('TC 33: Clicking the first Highest OI symbol and verifying its expanded Quote screen and 52 week indicator...', async () =>
            marketsPage.openFirstFnoSymbol('Trending Currencies Options "Highest OI"', await marketsPage.getTrendingCurrencyRows()));

        await step('TC 34: Navigating back from the Quote to the Currency tab...', async () => {
            if (highestOiQuote && !(await marketsPage.navigateBackToCurrencyTab(`${highestOiQuote.symbol}'s Quote`))) {
                throw new Error('Could not get back to the Markets (Currency) screen from the Highest OI Quote');
            }
        });

        // Top Currencies has no tab row (verified live) - its one list is checked as it stands.
        await step('TC 35: Scrolling down to Top Currencies and verifying it lists Currency symbols...', async () => {
            if (!(await marketsPage.scrollToTopCurrencies())) {
                throw new Error('Top Currencies section not found on the Currency tab');
            }
            await marketsPage.verifyTopCurrenciesRows();
        });

        const topQuote = await step('TC 36: Clicking the first Top Currencies symbol and verifying its expanded Quote screen and 52 week indicator...', async () =>
            marketsPage.openFirstFnoSymbol('Top Currencies', await marketsPage.getTopCurrenciesRows()));

        await step('TC 37: Navigating back from the Quote to the Currency tab...', async () => {
            if (topQuote && !(await marketsPage.navigateBackToCurrencyTab(`${topQuote.symbol}'s Quote`))) {
                throw new Error('Could not get back to the Markets (Currency) screen from the Top Currencies Quote');
            }
        });

        await step('TC 38: Clicking "See all" on Top Currencies...', async () => {
            if (!(await marketsPage.scrollToTopCurrencies())) {
                throw new Error('Top Currencies section not found on the Currency tab');
            }
            await marketsPage.clickSeeAllTopCurrencies();
            if (!(await marketsPage.verifyTopCurrenciesSeeAllOpened())) {
                throw new Error('Top Currencies "See all" screen did not open');
            }
        });

        await step('TC 39: "See all" - verifying Top Currencies lists Currency symbols...', () =>
            marketsPage.verifyTopCurrenciesRows('Top Currencies "See all"'));

        const topSeeAllQuote = await step('TC 40: "See all" - clicking the first Top Currencies symbol and verifying its expanded Quote screen and 52 week indicator...', async () =>
            marketsPage.openFirstFnoSymbol('Top Currencies "See all"', await marketsPage.getTopCurrenciesRows()));

        await step('TC 41: Navigating back from the Quote to Top Currencies "See all"...', async () => {
            if (topSeeAllQuote && !(await marketsPage.navigateBackToSeeAll('Top Currencies', `${topSeeAllQuote.symbol}'s Quote`, marketsPage.currencyTab))) {
                throw new Error('Could not get back to Top Currencies "See all" from the Quote');
            }
        });

        await step('TC 42: Closing Top Currencies "See all" and navigating back to the Currency tab...', async () => {
            await marketsPage.closeTopCurrenciesSeeAll();
            if (!(await marketsPage.navigateBackToMarkets())) {
                throw new Error('Could not get back to the Markets screen from Top Currencies "See all"');
            }
            if (!(await marketsPage.isSegmentTabSelected(marketsPage.currencyTab)) && !(await marketsPage.clickCurrencyTab())) {
                throw new Error('Currency tab was not selected after tapping it');
            }
            console.log('Back on Markets (Currency): PASS');
        });

        await step('TC 43: Scrolling down to OI Analysis...', async () => {
            if (!(await marketsPage.scrollToOiAnalysis())) {
                throw new Error('OI Analysis section not found on the Currency tab');
            }
        });

        // Click-only tab row like the others: tapping the tabs in order brings each next tab into view.
        // Each tab's own message is checked before "See all" too, against the tabs already visited.
        const oiTabMessages = new Map();

        const longBuildupRows = await step('TC 44: Clicking OI Analysis "Long Buildup" and verifying its own message with symbols with expiry, Open Interest and Price...', () =>
            selectOiTab(marketsPage, 1, 'Long Buildup', oiTabMessages));
        const longBuildupQuote = await step('TC 45: Clicking the first OI Analysis "Long Buildup" symbol and verifying its expanded Quote screen and 52 week indicator...', () =>
            marketsPage.openFirstFnoSymbol('OI Analysis "Long Buildup"', longBuildupRows || []));
        await step('TC 46: Navigating back from the Quote to the Currency tab...', () =>
            backToCurrencyFromOiQuote(marketsPage, longBuildupQuote, 'Long Buildup'));
        await step('TC 47: Verifying OI Analysis "Long Buildup" lists symbols with expiry under Symbol, Open Interest, Price...', () =>
            reverifyOiTab(marketsPage, 1, 'Long Buildup'));

        const longUnwindingRows = await step('TC 48: Clicking OI Analysis "Long Unwinding" and verifying its own message with symbols with expiry, Open Interest and Price...', () =>
            selectOiTab(marketsPage, 2, 'Long Unwinding', oiTabMessages));
        const longUnwindingQuote = await step('TC 49: Clicking the first OI Analysis "Long Unwinding" symbol and verifying its expanded Quote screen and 52 week indicator...', () =>
            marketsPage.openFirstFnoSymbol('OI Analysis "Long Unwinding"', longUnwindingRows || []));
        await step('TC 50: Navigating back from the Quote to the Currency tab...', () =>
            backToCurrencyFromOiQuote(marketsPage, longUnwindingQuote, 'Long Unwinding'));
        await step('TC 51: Verifying OI Analysis "Long Unwinding" lists symbols with expiry under Symbol, Open Interest, Price...', () =>
            reverifyOiTab(marketsPage, 2, 'Long Unwinding'));

        const shortBuildupRows = await step('TC 52: Clicking OI Analysis "Short Buildup" and verifying its own message with symbols with expiry, Open Interest and Price...', () =>
            selectOiTab(marketsPage, 3, 'Short Buildup', oiTabMessages));
        const shortBuildupQuote = await step('TC 53: Clicking the first OI Analysis "Short Buildup" symbol and verifying its expanded Quote screen and 52 week indicator...', () =>
            marketsPage.openFirstFnoSymbol('OI Analysis "Short Buildup"', shortBuildupRows || []));
        await step('TC 54: Navigating back from the Quote to the Currency tab...', () =>
            backToCurrencyFromOiQuote(marketsPage, shortBuildupQuote, 'Short Buildup'));
        await step('TC 55: Verifying OI Analysis "Short Buildup" lists symbols with expiry under Symbol, Open Interest, Price...', () =>
            reverifyOiTab(marketsPage, 3, 'Short Buildup'));

        const shortCoveringRows = await step('TC 56: Clicking OI Analysis "Short Covering" and verifying its own message with symbols with expiry, Open Interest and Price...', () =>
            selectOiTab(marketsPage, 4, 'Short Covering', oiTabMessages));
        const shortCoveringQuote = await step('TC 57: Clicking the first OI Analysis "Short Covering" symbol and verifying its expanded Quote screen and 52 week indicator...', () =>
            marketsPage.openFirstFnoSymbol('OI Analysis "Short Covering"', shortCoveringRows || []));
        await step('TC 58: Navigating back from the Quote to the Currency tab...', () =>
            backToCurrencyFromOiQuote(marketsPage, shortCoveringQuote, 'Short Covering'));
        await step('TC 59: Verifying OI Analysis "Short Covering" lists symbols with expiry under Symbol, Open Interest, Price...', () =>
            reverifyOiTab(marketsPage, 4, 'Short Covering'));

        await step('TC 60: Clicking "See all" on OI Analysis...', async () => {
            if (!(await marketsPage.scrollToOiAnalysis())) {
                throw new Error('OI Analysis section not found on the Currency tab');
            }
            await marketsPage.clickSeeAllOiAnalysis();
            if (!(await marketsPage.verifyOiAnalysisSeeAllOpened())) {
                throw new Error('OI Analysis "See all" screen did not open');
            }
        });

        // Every tab explains its own build-up/unwinding pattern above its list, so each tab's message
        // must be present and different from every other tab's.
        const oiMessages = new Map();
        await step('TC 61: "See all" - clicking "Long Buildup" and verifying its own message with symbols...', () =>
            verifyOiSeeAllTab(marketsPage, 1, 'Long Buildup', oiMessages));
        await step('TC 62: "See all" - clicking "Long Unwinding" and verifying its own message with symbols...', () =>
            verifyOiSeeAllTab(marketsPage, 2, 'Long Unwinding', oiMessages));
        await step('TC 63: "See all" - clicking "Short Buildup" and verifying its own message with symbols...', () =>
            verifyOiSeeAllTab(marketsPage, 3, 'Short Buildup', oiMessages));
        await step('TC 64: "See all" - clicking "Short Covering" and verifying its own message with symbols...', () =>
            verifyOiSeeAllTab(marketsPage, 4, 'Short Covering', oiMessages));

        const oiSeeAllQuote = await step('TC 65: "See all" - clicking the first OI Analysis "Short Covering" symbol and verifying its expanded Quote screen and 52 week indicator...', async () =>
            marketsPage.openFirstFnoSymbol('OI Analysis "See all"', await marketsPage.getOiAnalysisRows()));

        await step('TC 66: Navigating back from the Quote to OI Analysis "See all"...', async () => {
            if (oiSeeAllQuote && !(await marketsPage.navigateBackToSeeAll('OI Analysis', `${oiSeeAllQuote.symbol}'s Quote`, marketsPage.currencyTab))) {
                throw new Error('Could not get back to OI Analysis "See all" from the Quote');
            }
        });

        await step('TC 67: Navigating back from OI Analysis "See all" to the Currency tab...', async () => {
            if (!(await marketsPage.navigateBackToCurrencyTab('OI Analysis "See all"'))) {
                throw new Error('Could not get back to the Markets (Currency) screen from OI Analysis "See all"');
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
