const DriverManager = require('../../driver/DriverManager');
const { MarketsPage, HRA_TABS, HRA_PERIODS, SIR_TABS } = require('../../pages/MarketsPage');
const { NewsPage } = require('../../pages/NewsPage');
const QuotesPage = require('../../pages/QuotesPage');
const OrderPadPage = require('../../pages/OrderPadPage');
const { PeerComparisonPage, PEER_TABS, PEER_SUB_TABS, PEER_TABS_WITH_SUB_TABS } = require('../../pages/PeerComparisonPage');
const { MutualFundsPage } = require('../../pages/MutualFundsPage');
const { CorporateActionPage } = require('../../pages/CorporateActionPage');
const { ResultsPage } = require('../../pages/ResultsPage');
const { createLogger, getFailedTCs } = require('../../utils/logger');

// Stocks You Viewed Recently "See all" keeps at most this many symbols.
const RECENTLY_VIEWED_LIMIT = 50;

const { logFile, entries } = createLogger('Markets_Equity');
console.log(`Logging this run to: ${logFile}`);

function printSummary(results) {
    const line = '='.repeat(60);
    console.log(`\n${line}\n SUMMARY - Latest news date/time and tag check per tab\n${line}`);
    for (const r of results) {
        if (r.raw === null && r.date === null) {
            console.log(`  ${r.tab}: No Data Found`);
            continue;
        }
        if (!r.date) {
            console.log(`  ${r.tab}: Could not parse date (raw: "${r.raw}")`);
            continue;
        }
        const dateStatus = !r.isPastOrNow
            ? 'FAIL (in the future)'
            : (r.isWithinLast10Days ? 'PASS' : 'FAIL (older than 10 days)');
        const tagStatus = r.tab === 'All'
            ? `tags seen: ${r.distinctTags.join(', ') || 'none'}`
            : (r.mismatches.length ? `FAIL - ${r.mismatches.length} mismatched tag(s): ${[...new Set(r.mismatches.map(e => e.tag))].join(', ')}` : 'PASS - all tags match');
        console.log(`  ${r.tab}: ${r.raw} ${r.latestTime || ''} - ${dateStatus} | ${tagStatus}`);
    }
}

// Logs PASS/FAIL for the Quote's Event tag: it must be present, and - when the corporate action's
// type is known - describe that same type ("STOCK SPLIT" -> "Stock split Ratio 10:5, ...",
// "DIVIDEND" -> "Dividend Rs. 5.5 Per share, ..."), compared with case/spaces/dots ignored.
function logEventCheck(quote, expectedType) {
    if (!quote) {
        console.log('Quote screen did not open: FAIL');
        return;
    }
    if (!quote.event) {
        console.log(`Event tag on ${quote.symbol}'s Quote: not displayed - FAIL`);
        return;
    }
    console.log(`Event tag on ${quote.symbol}'s Quote: "${quote.event}" - PASS`);
    if (expectedType) {
        const norm = s => s.toLowerCase().replace(/[^a-z]/g, '');
        const matches = norm(quote.event).startsWith(norm(expectedType));
        console.log(`Event matches the corporate action type "${expectedType}": ${matches ? 'PASS' : 'FAIL'}`);
    }
}

async function run() {
    const driver = await DriverManager.getDriver();
    try {
        const marketsPage = new MarketsPage(driver);
        const newsPage = new NewsPage(driver);
        const quotesPage = new QuotesPage(driver);
        const orderPadPage = new OrderPadPage(driver);
        const peerPage = new PeerComparisonPage(driver);
        const mutualFundsPage = new MutualFundsPage(driver);
        const corporateActionPage = new CorporateActionPage(driver);
        const resultsPage = new ResultsPage(driver);
        const results = [];

        console.log('TC 1: Checking if the app is already on the Markets screen...');
        const alreadyOnMarkets = await marketsPage.waitForEquityLoaded(3000);
        if (alreadyOnMarkets) {
            console.log('Already on Markets screen (Equity) - skipping bottom navigation tap, continuing with remaining TCs');
        } else {
            console.log('Not on Markets screen - clicking Market bottom navigation button...');
            await marketsPage.clickMarketNavButton();
        }

        console.log('TC 2: Waiting for Markets screen to land on Equity...');
        const equityLoaded = alreadyOnMarkets || await marketsPage.waitForEquityLoaded(10000);
        if (!equityLoaded) {
            throw new Error('Markets screen did not land on Equity within 10 seconds');
        }

        console.log('TC 3: Verifying Equity is the tab selected by default...');
        await marketsPage.isEquityTabSelected();

        console.log('TC 4: Verifying the first section on Equity is "Market Movers"...');
        await marketsPage.scrollToTop();
        const firstSection = await marketsPage.getFirstSectionTitle();
        console.log(`First section on Equity: "${firstSection}" - ${firstSection === 'Market Movers' ? 'PASS' : 'FAIL (expected "Market Movers")'}`);

        console.log('TC 5: Clicking the first symbol in Market Movers (Top Gainers)...');
        await marketsPage.rewindMoversTabs();
        const symbol = await marketsPage.tapFirstMarketMover();
        if (!symbol) {
            throw new Error('No symbol found in the Market Movers list');
        }
        const quoteOpened = await marketsPage.verifyQuoteOpened(symbol);

        console.log('TC 6: Expanding the Quote screen...');
        if (quoteOpened) {
            await quotesPage.swipeUpQuoteScreen();
        } else {
            console.log('Skipping Quote expand - Quote screen did not open: FAIL');
        }

        // Quote checks on the expanded Quote (TC 7-22).
        if (quoteOpened) {
            console.log('\nTC 7: Verifying the NSE/BSE toggle under the symbol name and switching to the other exchange...');
            await quotesPage.verifyAndSwitchExchange();
            const header = await quotesPage.getQuoteHeader();
            const exchange = header ? header.exchange : null;

            console.log('\nTC 8: Verifying the 52 week low/high indicator...');
            await quotesPage.verify52WeekIndicator(exchange);

            // Only ever opens the Order Pads and backs out - the pad's own BUY/SELL is never tapped.
            console.log('\nTC 9: Clicking SELL and verifying the Sell Order Pad...');
            await quotesPage.clickSell();
            const sellPad = await orderPadPage.verifyOpenedFor('Sell');

            console.log('\nTC 10: Navigating back to the Quote...');
            if (sellPad) await orderPadPage.goBackToQuotes();
            console.log(`Back on the Quote screen: ${(await quotesPage.isDisplayed(5000)) ? 'PASS' : 'FAIL'}`);

            console.log('\nTC 11: Clicking BUY and verifying the Buy Order Pad...');
            await quotesPage.clickBuy();
            const buyPad = await orderPadPage.verifyOpenedFor('Buy');

            console.log('\nTC 12: Navigating back to the Quote...');
            if (buyPad) await orderPadPage.goBackToQuotes();
            console.log(`Back on the Quote screen: ${(await quotesPage.isDisplayed(5000)) ? 'PASS' : 'FAIL'}`);

            console.log('\nTC 13: Clicking Advanced Options and verifying "Compare with Peer" (equity only)...');
            const peerListed = await quotesPage.openAdvancedOptionsForPeer(exchange);

            if (peerListed) {
                console.log('\nTC 14: Clicking "Compare with Peer" and verifying the Ratios, Key Parameters, Performance tabs...');
                await quotesPage.clickCompareWithPeer();
                await peerPage.verifyOpened(header && header.symbol);
                if (!(await peerPage.isDisplayed(1000))) {
                    throw new Error('Peer Comparison screen did not open from Compare with Peer');
                }

                // Taps the first listed peer (FAIL if none), checks its Quote and comes back.
                const openFirstPeer = async context => {
                    const peer = await peerPage.tapFirstSymbol(context);
                    if (peer && await marketsPage.verifyQuoteOpened(peer)) await peerPage.navigateBackFromQuote();
                };

                let step = 15;
                for (const tab of PEER_TABS) {
                    const hasSubTabs = PEER_TABS_WITH_SUB_TABS.includes(tab);
                    console.log(`\nTC ${step++}: Clicking ${tab} and verifying its ${hasSubTabs ? 'Standalone/Consolidated sub-tabs' : 'symbols (no sub-tabs)'}...`);
                    await peerPage.clickTab(tab);
                    if (!hasSubTabs) {
                        await openFirstPeer(tab);
                        continue;
                    }
                    for (const sub of PEER_SUB_TABS) {
                        console.log(`\nTC ${step++}: ${tab} - clicking ${sub} and opening the first symbol's Quote...`);
                        await peerPage.clickSubTab(sub);
                        await openFirstPeer(`${tab} / ${sub}`);
                    }
                }

                console.log(`\nTC ${step++}: Closing Peer Comparison and returning to the Quote...`);
                await peerPage.close(quotesPage.stockSummary);
            } else if (await quotesPage.isElementVisible('android=new UiSelector().description("Scrim")', 1000)) {
                await driver.back(); // close the Advanced Options sheet
                await quotesPage.pause(800);
            }
        }

        console.log('TC 23: Navigating back to Markets...');
        if (!(await marketsPage.navigateBackFromQuote())) {
            throw new Error('Could not get back to the Markets (Equity) screen from the Quote screen');
        }

        // The sub-tab row only exposes the tabs currently on screen, but tapping a tab scrolls the
        // next one into view - so tapping 1..N in order reaches all of them (N from "Tab 1 of N").
        console.log('\nTC 24: Clicking each Market Movers tab...');
        const moversTabs = await marketsPage.getMoversTabs();
        const moversTabCount = moversTabs.length ? moversTabs[0].total : 0;
        if (!moversTabCount) {
            console.log('Market Movers tabs not found - FAIL');
        }
        for (let i = 1; i <= moversTabCount; i++) {
            console.log(`Clicking Market Movers tab ${i} of ${moversTabCount}...`);
            const tabResult = await marketsPage.clickMoversTab(i, moversTabCount);
            if (tabResult && tabResult.rowCount === 0) {
                console.log(`No symbols listed under "${tabResult.label}"`);
            }
        }

        console.log('\nTC 25: Clicking "See all" on Market Movers...');
        await marketsPage.clickSeeAllMarketMovers();
        await marketsPage.verifyMarketMoversScreenOpened();

        // The "See all" row has more tabs than Markets' (12 vs 6 when checked live) and is also
        // click-only, so it is rewound to Tab 1 and walked the same way as TC 24.
        console.log('TC 26: Clicking each tab on the Market Movers "See all" screen...');
        await marketsPage.rewindMoversTabs();
        const seeAllMoversTabs = await marketsPage.getMoversTabs();
        const seeAllMoversTabCount = seeAllMoversTabs.length ? seeAllMoversTabs[0].total : 0;
        if (!seeAllMoversTabCount) {
            console.log('Market Movers "See all" tabs not found - FAIL');
        }
        for (let i = 1; i <= seeAllMoversTabCount; i++) {
            const tabResult = await marketsPage.clickMoversTab(i, seeAllMoversTabCount);
            if (tabResult && tabResult.rowCount === 0) {
                console.log(`No symbols listed under "${tabResult.label}"`);
            }
        }

        console.log('TC 27: Navigating back to Markets from the Market Movers screen...');
        await marketsPage.closeMarketMoversScreen();
        if (!(await marketsPage.navigateBackToMarkets())) {
            throw new Error('Could not get back to the Markets (Equity) screen from Market Movers');
        }

        // News is one TC end to end: open it from Markets, run the per-tab checks, close it.
        console.log('\nTC 28: News - scroll to News, See all, check every tab, close...');
        const newsVisible = await marketsPage.scrollToNews();
        if (!newsVisible) {
            throw new Error('Could not find "News" section on the Equity screen');
        }

        console.log('Clicking See all on News...');
        await marketsPage.clickSeeAllNews();

        console.log('Waiting up to 10s for the News screen to load...');
        const loaded = await newsPage.waitForLoaded(10000);
        if (!loaded) {
            throw new Error('News screen did not load within 10 seconds');
        }

        const emptyResult = { raw: null, date: null, latestTime: null, isPastOrNow: null, isWithinLast10Days: null, entryCount: 0, distinctTags: [], mismatches: [] };

        // Same per-tab flow as tests/News.test.js: tabs are selected one by one (in fixed
        // left-to-right order) rather than by swiping the tab strip - clicking each tab is what
        // actually scrolls later tabs into view.
        for (const tabName of newsPage.tabNames) {
            console.log(`\nSelecting "${tabName}" tab...`);
            await newsPage.clickTab(tabName);
            await driver.pause(1000);

            if (await newsPage.isNoDataFound()) {
                console.log(`No Data Found for "${tabName}" - skipping scroll and search`);
                results.push({ tab: tabName, ...emptyResult });
                continue;
            }

            console.log('Scrolling down 2 times, then up 2 time...');
            await newsPage.scrollDown();
            await newsPage.scrollDown();
            await newsPage.scrollUp();
            await newsPage.scrollUp();

            if (tabName === 'All') {
                console.log('Opening search bar and searching "News"...');
                await newsPage.clickSearchBar();
                await newsPage.searchNews('News');
                await driver.pause(3000);
                await newsPage.verifyNewsSearchResults('News');
                await newsPage.closeSearch();
                await driver.pause(1000);
            }

            console.log(`Checking latest news date/time and tag consistency for "${tabName}"...`);
            const summary = await newsPage.getFeedSummary(tabName);
            results.push({ tab: tabName, ...summary });
        }

        printSummary(results);

        console.log('\nClosing News screen...');
        await newsPage.clickClose();

        console.log('\nTC 29: Navigating back to Markets before the Corporate Action checks...');
        if (!(await marketsPage.navigateBackToMarkets())) {
            throw new Error('Could not get back to the Markets (Equity) screen after closing News');
        }

        console.log('TC 30: Scrolling to Corporate Action and clicking the first listed corporate action...');
        const firstAction = await marketsPage.tapFirstCorporateAction();
        if (!firstAction) {
            throw new Error('No corporate action listed in the Corporate Action section');
        }

        console.log('TC 31: Verifying the Quote screen shows the Event tag...');
        const quoteEvent = await quotesPage.readEventTag();
        logEventCheck(quoteEvent, firstAction.type);

        console.log('TC 32: Clicking the Event tag...');
        if (quoteEvent && quoteEvent.event) {
            await quotesPage.tapEventTag();
            await corporateActionPage.isSymbolScreenOpen(quoteEvent.symbol);
        } else {
            console.log('Skipping Event tap - no Event tag on the Quote screen: FAIL');
        }

        console.log('TC 33: Navigating back to Markets...');
        if (!(await marketsPage.navigateBackToMarkets())) {
            throw new Error('Could not get back to the Markets (Equity) screen from the Corporate Action screen');
        }

        console.log('TC 34: Clicking "See all" on Corporate Action...');
        await marketsPage.clickSeeAllCorporateAction();
        if (!(await corporateActionPage.isSeeAllScreenOpen())) {
            throw new Error('Corporate Action "See all" screen did not open');
        }

        console.log('TC 35: Selecting "This Week" in the left filter (another period if no data)...');
        const period = await corporateActionPage.selectFilterWithData('left', 'This Week');
        console.log(`Period filter with data: ${period ? `${period} - PASS` : 'none - FAIL (no data for any period)'}`);

        console.log('TC 36: Selecting "DIVIDEND" in the right filter (another type if no data)...');
        const actionType = period ? await corporateActionPage.selectFilterWithData('right', 'DIVIDEND') : null;
        console.log(`Type filter with data: ${actionType ? `${actionType} - PASS` : 'none - FAIL (no data for any type)'}`);

        console.log('TC 37: Clicking the first listed corporate action and verifying the Event tag on its Quote...');
        const listedAction = actionType ? await corporateActionPage.tapFirstListed() : null;
        if (listedAction) {
            logEventCheck(await quotesPage.readEventTag(), listedAction.type);
        } else {
            console.log('No corporate action to click under the selected filters: FAIL');
        }

        console.log('\nTC 38: Navigating back to Markets before the Results checks...');
        if (!(await marketsPage.navigateBackToMarkets())) {
            throw new Error('Could not get back to the Markets (Equity) screen after the Corporate Action checks');
        }

        console.log('TC 39: Scrolling to Results and clicking the first listed symbol...');
        const firstResult = await marketsPage.tapFirstResult();
        if (!firstResult) {
            throw new Error('No symbol listed in the Results section');
        }
        await marketsPage.verifyQuoteOpened(firstResult.symbol);

        console.log('TC 40: Navigating back to Markets...');
        if (!(await marketsPage.navigateBackToMarkets())) {
            throw new Error('Could not get back to the Markets (Equity) screen from the Results Quote');
        }

        console.log('TC 41: Clicking "See all" on Results...');
        await marketsPage.clickSeeAllResults();
        if (!(await resultsPage.isOpen())) {
            throw new Error('Market Results screen did not open');
        }

        console.log('TC 42: Verifying every listed result date is today or a future date...');
        const allResults = await resultsPage.collectAllResults();
        resultsPage.verifyDatesTodayOrFuture(allResults);

        console.log('TC 43: Clicking the first symbol on Market Results...');
        const listedResult = await resultsPage.tapFirstResult(allResults[0]);
        if (listedResult) {
            await marketsPage.verifyQuoteOpened(listedResult.symbol);
        } else {
            console.log('No symbol listed on Market Results: FAIL');
        }

        console.log('\nTC 44: Navigating back to Markets before the quick-access tile checks...');
        const backOnMarkets = await marketsPage.navigateBackToMarkets();
        if (!backOnMarkets) {
            throw new Error('Could not get back to the Markets (Equity) screen after the Results checks');
        }

        console.log('\nTC 45: Clicking "AI Algo" tile...');
        await marketsPage.clickAiAlgoTile();
        await driver.pause(5000); // give the webview a moment to start loading before checking

        console.log('TC 46: Waiting for the AI Algo webview to load and verifying it opened...');
        const aiAlgoOpened = await marketsPage.verifyAiAlgoOpened();
        console.log(`AI Algo page opened: ${aiAlgoOpened ? 'PASS' : 'FAIL'}`);

        console.log('TC 47: Navigating back to Market...');
        await marketsPage.navigateBackToMarkets();

        console.log('\nTC 48: Clicking "NxtOption" tile...');
        await marketsPage.clickNxtOptionTile();

        console.log('TC 49: Waiting for NxtOption to open...');
        await driver.pause(3000); // give the webview a moment to start loading before checking
        const nxtOptionOpened = await marketsPage.verifyNxtOptionOpened();
        console.log(`NxtOption opened: ${nxtOptionOpened ? 'PASS' : 'FAIL'}`);

        console.log('TC 50: Navigating back to Market...');
        await marketsPage.navigateBackToMarkets();

        console.log('\nTC 51: Clicking "IPO" tile...');
        await marketsPage.clickIpoTile();

        console.log('TC 52: Waiting for the IPO webview to load and verifying it opened...');
        const ipoOpened = await marketsPage.verifyIpoOpened();
        console.log(`IPO page opened: ${ipoOpened ? 'PASS' : 'FAIL'}`);

        console.log('TC 53: Navigating back to Market...');
        await marketsPage.navigateBackToMarkets();

        // Each click*Tile() scrolls the page and the tile row itself as needed to bring that tile
        // fully on screen (the row keeps its horizontal offset between visits).
        console.log('\nTC 54: Clicking "Mutual Funds" tile...');
        await marketsPage.clickMutualFundsTile();

        console.log('TC 55: Waiting for Mutual Funds to open...');
        const mutualFundsOpened = await mutualFundsPage.isOnMutualFundsScreen(8000);
        console.log(`Mutual Funds opened: ${mutualFundsOpened ? 'PASS' : 'FAIL'}`);

        console.log('TC 56: Navigating back to Market...');
        await marketsPage.navigateBackToMarkets();

        console.log('\nTC 57: Clicking "Basket" tile...');
        await marketsPage.clickBasketTile();

        console.log('TC 58: Waiting for Basket to open...');
        const basketOpened = await marketsPage.verifyBasketOpened();
        console.log(`Basket opened: ${basketOpened ? 'PASS' : 'FAIL'}`);

        console.log('TC 59: Navigating back to Market...');
        if (!(await marketsPage.navigateBackToMarkets())) {
            throw new Error('Could not get back to the Markets (Equity) screen from Basket');
        }

        console.log('\nTC 60: Scrolling to High Return Achievers...');
        if (!(await marketsPage.scrollToHighReturnAchievers())) {
            throw new Error('High Return Achievers section not found on the Markets (Equity) screen');
        }

        console.log('\nTC 61: Clicking the first High Return Achievers symbol and verifying its Quote...');
        const hraSymbol = await marketsPage.tapFirstHraSymbol();
        if (hraSymbol) await marketsPage.verifyQuoteOpened(hraSymbol);

        // Back from the Quote returns to Markets with the section still in view (verified live);
        // scroll it back in only if it isn't.
        console.log('\nTC 62: Navigating back to Markets from the Quote...');
        if (!(await marketsPage.navigateBackFromQuote())) {
            throw new Error('Could not get back to the Markets (Equity) screen from the High Return Achievers Quote');
        }
        if (!(await marketsPage.getHraRows()).length) await marketsPage.scrollToHighReturnAchievers();

        console.log('\nTC 63: Clicking each High Return Achievers tab...');
        for (const tab of HRA_TABS) {
            await marketsPage.clickHraTab(tab);
        }

        console.log('\nTC 64: Opening the period dropdown next to the High Return Achievers tabs...');
        const startPeriod = await marketsPage.getHraPeriod();
        console.log(`Current period: "${startPeriod}"`);
        marketsPage.verifyHraPeriodOptions(await marketsPage.openHraPeriodDropdown());

        // The dropdown is still open from TC 64, so the first selection taps straight into it. The
        // selected period persists across visits, so it is put back to how it was found afterwards.
        console.log('\nTC 65: Selecting each period in the dropdown...');
        for (const period of HRA_PERIODS) {
            await marketsPage.selectHraPeriod(period);
        }
        if (startPeriod && startPeriod !== HRA_PERIODS[HRA_PERIODS.length - 1]) {
            console.log(`Restoring the period dropdown to "${startPeriod}"...`);
            await marketsPage.selectHraPeriod(startPeriod);
        }

        console.log('\nTC 66: Clicking "See all" on High Return Achievers...');
        await marketsPage.clickSeeAllHighReturnAchievers();
        if (!(await marketsPage.verifyHraSeeAllOpened())) {
            throw new Error('High Return Achievers "See all" screen did not open');
        }

        console.log('\nTC 67: Clicking the first symbol on High Return Achievers "See all" and verifying its Quote...');
        const seeAllSymbol = await marketsPage.tapFirstHraSymbol();
        if (seeAllSymbol) await marketsPage.verifyQuoteOpened(seeAllSymbol);

        console.log('\nTC 68: Navigating back to High Return Achievers "See all" from the Quote...');
        if (!(await marketsPage.navigateBackToHraSeeAll())) {
            throw new Error('Could not get back to the High Return Achievers "See all" screen from the Quote');
        }

        console.log('\nTC 69: Verifying Large Cap with "1 Month" is selected by default...');
        const largeCapDefault = await marketsPage.isHraTabSelected('Large Cap');
        const defaultPeriod = await marketsPage.getHraPeriod();
        console.log(`Large Cap tab selected: ${largeCapDefault ? 'PASS' : 'FAIL'} | period: "${defaultPeriod}" - ${defaultPeriod === '1 Month' ? 'PASS' : 'FAIL (expected "1 Month")'}`);

        console.log('\nTC 70: Verifying the listed symbols are displayed with their 1 Year Return...');
        await marketsPage.verifyHraOneYearReturns();

        // Each step changes one thing - the period, then the tab - and the list must differ from
        // the one shown before that step. The row label reads "1 Year Return" whatever the period,
        // so the change is seen in the symbols/return values.
        let before = marketsPage.hraSnapshot(await marketsPage.getHraRows());

        console.log('\nTC 71: Selecting "6 Month" from the dropdown...');
        if (await marketsPage.selectHraPeriod('6 Month')) before = await marketsPage.verifyHraDataUpdated(before, 'Large Cap / "6 Month"');

        console.log('\nTC 72: Selecting the Mid Cap tab...');
        if (await marketsPage.clickHraTab('Mid Cap')) before = await marketsPage.verifyHraDataUpdated(before, 'Mid Cap / "6 Month"');

        console.log('\nTC 73: Selecting "1 Year" from the dropdown...');
        if (await marketsPage.selectHraPeriod('1 Year')) before = await marketsPage.verifyHraDataUpdated(before, 'Mid Cap / "1 Year"');

        console.log('\nTC 74: Selecting the Small Cap tab...');
        if (await marketsPage.clickHraTab('Small Cap')) before = await marketsPage.verifyHraDataUpdated(before, 'Small Cap / "1 Year"');

        console.log('\nTC 75: Selecting "3 Year" from the dropdown...');
        if (await marketsPage.selectHraPeriod('3 Year')) before = await marketsPage.verifyHraDataUpdated(before, 'Small Cap / "3 Year"');

        console.log('\nTC 76: Selecting the Large Cap tab...');
        if (await marketsPage.clickHraTab('Large Cap')) before = await marketsPage.verifyHraDataUpdated(before, 'Large Cap / "3 Year"');

        // The period persists across visits - put it back to "1 Month" so the next run starts from
        // the default TC 69 expects.
        console.log('Restoring the period dropdown to "1 Month"...');
        await marketsPage.selectHraPeriod('1 Month');

        console.log('\nTC 77: Closing High Return Achievers and navigating back to Markets...');
        await marketsPage.closeHraSeeAll();
        if (!(await marketsPage.navigateBackToMarkets())) {
            throw new Error('Could not get back to the Markets (Equity) screen from High Return Achievers');
        }

        console.log('\nTC 78: Scrolling to Stock In Range...');
        if (!(await marketsPage.scrollToStockInRange())) {
            throw new Error('Stock In Range section not found on the Markets (Equity) screen');
        }

        console.log('\nTC 79: Clicking the first Stock In Range symbol and verifying its Quote...');
        const sirSymbol = await marketsPage.tapFirstSirSymbol();
        if (sirSymbol) await marketsPage.verifyQuoteOpened(sirSymbol);

        console.log('\nTC 80: Navigating back to Markets from the Quote...');
        if (!(await marketsPage.navigateBackFromQuote())) {
            throw new Error('Could not get back to the Markets (Equity) screen from the Stock In Range Quote');
        }
        if (!(await marketsPage.getSirRows()).length) await marketsPage.scrollToStockInRange();

        console.log('\nTC 81: Clicking each Stock In Range tab and checking the first 5 prices fall in its range...');
        for (const tab of SIR_TABS) {
            await marketsPage.clickSirTab(tab.label);
        }

        console.log('\nTC 82: Clicking "See all" on Stock In Range...');
        await marketsPage.clickSeeAllStockInRange();
        if (!(await marketsPage.verifySirSeeAllOpened())) {
            throw new Error('Stock In Range "See all" screen did not open');
        }

        console.log('\nTC 83: Clicking the first symbol on Stock In Range "See all" and verifying its Quote...');
        const sirSeeAllSymbol = await marketsPage.tapFirstSirSymbol();
        const sirSeeAllQuoteOpened = !!sirSeeAllSymbol && await marketsPage.verifyQuoteOpened(sirSeeAllSymbol);

        console.log('\nTC 84: Navigating back to Stock In Range "See all" from the Quote...');
        // With no Quote open, a back-press would close "See all" itself and derail TC 85/86.
        if (!sirSeeAllQuoteOpened) {
            console.log('No Quote open from Stock In Range "See all" - skipping the back-press: FAIL');
        } else if (!(await marketsPage.navigateBackToSirSeeAll())) {
            throw new Error('Could not get back to the Stock In Range "See all" screen from the Quote');
        }

        console.log('\nTC 85: Clicking each Stock In Range tab on "See all" and checking the first 5 prices fall in its range...');
        for (const tab of SIR_TABS) {
            await marketsPage.clickSirTab(tab.label);
        }

        console.log('\nTC 86: Closing Stock In Range and navigating back to Markets...');
        await marketsPage.closeSirSeeAll();
        if (!(await marketsPage.navigateBackToMarkets())) {
            throw new Error('Could not get back to the Markets (Equity) screen from Stock In Range');
        }

        console.log('\nTC 87: Clicking the global search bar at the top of Markets...');
        await marketsPage.scrollToTop();
        if (!(await marketsPage.clickGlobalSearchBar())) {
            throw new Error('Global search screen did not open from the Markets search bar');
        }

        // Each search opens the chosen result's Quote, comes back to search and clears the text;
        // the symbols opened must then show up under Stocks You Viewed Recently.
        const searches = [
            { query: 'IDEA', position: 1 },
            { query: 'GTLINFRA', position: 2 },
            { query: 'NIFTY 22750', position: 1 },
            { query: 'USDINR', position: 1 },
            { query: 'GOLD 149000', position: 1 },
        ];
        const viewedSymbols = [];
        let tc = 88;
        for (const { query, position } of searches) {
            console.log(`\nTC ${tc++}: Searching "${query}", opening result #${position}'s Quote and clearing the text...`);
            await marketsPage.typeInSearch(query);
            const searchedSymbol = await marketsPage.tapSearchResult(query, position);
            if (!searchedSymbol) continue;
            if (await marketsPage.verifyQuoteOpened(searchedSymbol)) {
                viewedSymbols.push(searchedSymbol);
                if (!(await marketsPage.navigateBackToSearch())) {
                    throw new Error(`Could not get back to global search from ${searchedSymbol}'s Quote`);
                }
            }
            await marketsPage.clearSearch();
        }

        console.log('\nTC 93: Closing global search and scrolling to Stocks You Viewed Recently...');
        await marketsPage.closeGlobalSearch();
        if (!(await marketsPage.navigateBackToMarkets())) {
            throw new Error('Could not get back to the Markets (Equity) screen from global search');
        }
        if (!(await marketsPage.scrollToRecentlyViewed())) {
            throw new Error('Stocks You Viewed Recently section not found on the Markets (Equity) screen');
        }

        console.log('\nTC 94: Clicking "See all" on Stocks You Viewed Recently...');
        await marketsPage.clickSeeAllRecentlyViewed();
        if (!(await marketsPage.verifyRecentlyViewedSeeAllOpened())) {
            throw new Error('Stocks You Viewed Recently "See all" screen did not open');
        }

        console.log(`\nTC 95: Verifying the searched symbols are listed under Stocks You Viewed Recently (at most ${RECENTLY_VIEWED_LIMIT})...`);
        console.log(`Symbols viewed via search: ${viewedSymbols.join(', ') || 'none'}`);
        if (viewedSymbols.length < searches.length) {
            console.log(`Only ${viewedSymbols.length} of ${searches.length} searched symbols opened a Quote: FAIL`);
        }
        await marketsPage.verifyRecentlyViewedList(viewedSymbols, RECENTLY_VIEWED_LIMIT);

        console.log('\nTC 96: Closing Stocks You Viewed Recently and navigating back to Markets...');
        await marketsPage.closeRecentlyViewedSeeAll();
        if (!(await marketsPage.navigateBackToMarkets())) {
            throw new Error('Could not get back to the Markets (Equity) screen from Stocks You Viewed Recently');
        }

        console.log('\nTC 97: Clicking the first symbol under Stocks You Viewed Recently and verifying its Quote...');
        const recentSymbol = await marketsPage.tapFirstRecentlyViewed();
        const recentQuoteOpened = !!recentSymbol && await marketsPage.verifyQuoteOpened(recentSymbol);

        console.log('\nTC 98: Closing the Quote and navigating back to Markets...');
        if (!recentQuoteOpened) {
            console.log('No Quote open from Stocks You Viewed Recently - skipping the back-press: FAIL');
        } else if (!(await marketsPage.navigateBackFromQuote())) {
            throw new Error('Could not get back to the Markets (Equity) screen from the Stocks You Viewed Recently Quote');
        }

        // Most recently viewed is listed first - that's the symbol TC 97 opened, or failing that the
        // last one searched.
        const firstRecent = recentSymbol || viewedSymbols[viewedSymbols.length - 1];
        console.log(`\nTC 99: Clicking X on the first symbol (${firstRecent || 'none'}) and verifying it is removed from Stocks You Viewed Recently...`);
        if (!firstRecent) {
            console.log('No symbol listed under Stocks You Viewed Recently to remove: FAIL');
        } else {
            await marketsPage.removeRecentlyViewed(firstRecent);
        }

        console.log('\nTC 100: Scrolling to FII/DII and verifying it shows the previous trading day\'s date...');
        const fii = await marketsPage.scrollToFiiDii();
        if (!fii) throw new Error('FII/DII section not found on the Markets (Equity) screen');
        marketsPage.verifyFiiDiiDate(fii);

        console.log('\nTC 101: Verifying the FII Cash, DII Cash, FII Future and FII Option rows with values in Crore...');
        marketsPage.verifyFiiDiiRows(fii);

        console.log('\nTC 102: Verifying the FII/DII graph bars - red for negative, green for positive values...');
        await marketsPage.verifyFiiDiiBars(fii);

        console.log('\nTC 103: Clicking "See all" on FII/DII and verifying the Daily, Monthly, Yearly tabs and ALL, STOCK, INDEX sub-tabs...');
        await marketsPage.clickSeeAllFiiDii();
        if (!(await marketsPage.verifyFiiDiiSeeAllOpened())) {
            throw new Error('FII/DII "See all" screen did not open with its tabs and sub-tabs');
        }

        console.log('\nTC 104: Verifying Daily and ALL are selected by default with the same date shown on Markets...');
        await marketsPage.verifyFiiDiiSeeAllDefault(fii.dateText);

        console.log('\nTC 105: Daily - scrolling down ALL and verifying the past dates listed...');
        await marketsPage.verifyFiiDiiHistory('Daily', 'ALL');

        console.log('\nTC 106: Clicking STOCK and verifying only FII Cash and DII Cash are displayed...');
        await marketsPage.clickFiiDiiSegment('STOCK');

        console.log('\nTC 107: Daily - scrolling down STOCK and verifying the past dates listed...');
        await marketsPage.verifyFiiDiiHistory('Daily', 'STOCK');

        console.log('\nTC 108: Clicking INDEX and verifying only FII Future and FII Option are displayed...');
        await marketsPage.clickFiiDiiSegment('INDEX');

        console.log('\nTC 109: Daily - scrolling down INDEX and verifying the past dates listed...');
        await marketsPage.verifyFiiDiiHistory('Daily', 'INDEX');

        // Monthly, then Yearly: the latest entry must be the current month/year, then each sub-tab
        // in turn must list only its own rows, down through all its past months/years.
        tc = 110;
        for (const period of ['Monthly', 'Yearly']) {
            const unit = period === 'Monthly' ? 'month' : 'year';
            console.log(`\nTC ${tc++}: Clicking ${period} and verifying the current ${unit} is displayed...`);
            await marketsPage.clickFiiDiiPeriod(period);
            for (const segment of ['ALL', 'STOCK', 'INDEX']) {
                console.log(`\nTC ${tc++}: ${period} - clicking ${segment} and verifying its rows...`);
                await marketsPage.clickFiiDiiSegment(segment);
                console.log(`\nTC ${tc++}: ${period} - scrolling down ${segment} and verifying the past ${unit}s listed...`);
                await marketsPage.verifyFiiDiiHistory(period, segment);
            }
        }
        await marketsPage.navigateBackToMarkets();
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
