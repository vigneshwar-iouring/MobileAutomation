const DriverManager = require('../../driver/DriverManager');
const { MarketsPage } = require('../../pages/MarketsPage');
const { NewsPage } = require('../../pages/NewsPage');
const QuotesPage = require('../../pages/QuotesPage');
const { MutualFundsPage } = require('../../pages/MutualFundsPage');
const { CorporateActionPage } = require('../../pages/CorporateActionPage');
const { ResultsPage } = require('../../pages/ResultsPage');
const { createLogger, getFailedTCs } = require('../../utils/logger');

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

        console.log('TC 7: Navigating back to Markets...');
        if (!(await marketsPage.navigateBackFromQuote())) {
            throw new Error('Could not get back to the Markets (Equity) screen from the Quote screen');
        }

        // The sub-tab row only exposes the tabs currently on screen, but tapping a tab scrolls the
        // next one into view - so tapping 1..N in order reaches all of them (N from "Tab 1 of N").
        console.log('\nTC 8: Clicking each Market Movers tab...');
        const moversTabs = await marketsPage.getMoversTabs();
        const moversTabCount = moversTabs.length ? moversTabs[0].total : 0;
        if (!moversTabCount) {
            console.log('Market Movers tabs not found - FAIL');
        }
        for (let i = 1; i <= moversTabCount; i++) {
            console.log(`Clicking Market Movers tab ${i} of ${moversTabCount}...`);
            const tabResult = await marketsPage.clickMoversTab(i, moversTabCount);
            if (tabResult && tabResult.rowCount === 0) {
                console.log(`No symbols listed under "${tabResult.label}" - FAIL`);
            }
        }

        console.log('\nTC 9: Clicking "See all" on Market Movers...');
        await marketsPage.clickSeeAllMarketMovers();
        await marketsPage.verifyMarketMoversScreenOpened();

        console.log('TC 10: Navigating back to Markets from the Market Movers screen...');
        await marketsPage.closeMarketMoversScreen();
        if (!(await marketsPage.navigateBackToMarkets())) {
            throw new Error('Could not get back to the Markets (Equity) screen from Market Movers');
        }

        // News is one TC end to end: open it from Markets, run the per-tab checks, close it.
        console.log('\nTC 11: News - scroll to News, See all, check every tab, close...');
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

        console.log('\nTC 12: Navigating back to Markets before the Corporate Action checks...');
        if (!(await marketsPage.navigateBackToMarkets())) {
            throw new Error('Could not get back to the Markets (Equity) screen after closing News');
        }

        console.log('TC 13: Scrolling to Corporate Action and clicking the first listed corporate action...');
        const firstAction = await marketsPage.tapFirstCorporateAction();
        if (!firstAction) {
            throw new Error('No corporate action listed in the Corporate Action section');
        }

        console.log('TC 14: Verifying the Quote screen shows the Event tag...');
        const quoteEvent = await quotesPage.readEventTag();
        logEventCheck(quoteEvent, firstAction.type);

        console.log('TC 15: Clicking the Event tag...');
        if (quoteEvent && quoteEvent.event) {
            await quotesPage.tapEventTag();
            await corporateActionPage.isSymbolScreenOpen(quoteEvent.symbol);
        } else {
            console.log('Skipping Event tap - no Event tag on the Quote screen: FAIL');
        }

        console.log('TC 16: Navigating back to Markets...');
        if (!(await marketsPage.navigateBackToMarkets())) {
            throw new Error('Could not get back to the Markets (Equity) screen from the Corporate Action screen');
        }

        console.log('TC 17: Clicking "See all" on Corporate Action...');
        await marketsPage.clickSeeAllCorporateAction();
        if (!(await corporateActionPage.isSeeAllScreenOpen())) {
            throw new Error('Corporate Action "See all" screen did not open');
        }

        console.log('TC 18: Selecting "This Week" in the left filter (another period if no data)...');
        const period = await corporateActionPage.selectFilterWithData('left', 'This Week');
        console.log(`Period filter with data: ${period ? `${period} - PASS` : 'none - FAIL (no data for any period)'}`);

        console.log('TC 19: Selecting "DIVIDEND" in the right filter (another type if no data)...');
        const actionType = period ? await corporateActionPage.selectFilterWithData('right', 'DIVIDEND') : null;
        console.log(`Type filter with data: ${actionType ? `${actionType} - PASS` : 'none - FAIL (no data for any type)'}`);

        console.log('TC 20: Clicking the first listed corporate action and verifying the Event tag on its Quote...');
        const listedAction = actionType ? await corporateActionPage.tapFirstListed() : null;
        if (listedAction) {
            logEventCheck(await quotesPage.readEventTag(), listedAction.type);
        } else {
            console.log('No corporate action to click under the selected filters: FAIL');
        }

        console.log('\nTC 21: Navigating back to Markets before the Results checks...');
        if (!(await marketsPage.navigateBackToMarkets())) {
            throw new Error('Could not get back to the Markets (Equity) screen after the Corporate Action checks');
        }

        console.log('TC 22: Scrolling to Results and clicking the first listed symbol...');
        const firstResult = await marketsPage.tapFirstResult();
        if (!firstResult) {
            throw new Error('No symbol listed in the Results section');
        }
        await marketsPage.verifyQuoteOpened(firstResult.symbol);

        console.log('TC 23: Navigating back to Markets...');
        if (!(await marketsPage.navigateBackToMarkets())) {
            throw new Error('Could not get back to the Markets (Equity) screen from the Results Quote');
        }

        console.log('TC 24: Clicking "See all" on Results...');
        await marketsPage.clickSeeAllResults();
        if (!(await resultsPage.isOpen())) {
            throw new Error('Market Results screen did not open');
        }

        console.log('TC 25: Verifying every listed result date is today or a future date...');
        const allResults = await resultsPage.collectAllResults();
        resultsPage.verifyDatesTodayOrFuture(allResults);

        console.log('TC 26: Clicking the first symbol on Market Results...');
        const listedResult = await resultsPage.tapFirstResult(allResults[0]);
        if (listedResult) {
            await marketsPage.verifyQuoteOpened(listedResult.symbol);
        } else {
            console.log('No symbol listed on Market Results: FAIL');
        }

        console.log('\nTC 27: Navigating back to Markets before the quick-access tile checks...');
        const backOnMarkets = await marketsPage.navigateBackToMarkets();
        if (!backOnMarkets) {
            throw new Error('Could not get back to the Markets (Equity) screen after the Results checks');
        }

        console.log('\nTC 28: Clicking "AI Algo" tile...');
        await marketsPage.clickAiAlgoTile();
        await driver.pause(5000); // give the webview a moment to start loading before checking

        console.log('TC 29: Waiting for the AI Algo webview to load and verifying it opened...');
        const aiAlgoOpened = await marketsPage.verifyAiAlgoOpened();
        console.log(`AI Algo page opened: ${aiAlgoOpened ? 'PASS' : 'FAIL'}`);

        console.log('TC 30: Navigating back to Market...');
        await marketsPage.navigateBackToMarkets();

        console.log('\nTC 31: Clicking "NxtOption" tile...');
        await marketsPage.clickNxtOptionTile();

        console.log('TC 32: Waiting for NxtOption to open...');
        await driver.pause(3000); // give the webview a moment to start loading before checking
        const nxtOptionOpened = await marketsPage.verifyNxtOptionOpened();
        console.log(`NxtOption opened: ${nxtOptionOpened ? 'PASS' : 'FAIL'}`);

        console.log('TC 33: Navigating back to Market...');
        await marketsPage.navigateBackToMarkets();

        console.log('\nTC 34: Clicking "IPO" tile...');
        await marketsPage.clickIpoTile();

        console.log('TC 35: Waiting for the IPO webview to load and verifying it opened...');
        const ipoOpened = await marketsPage.verifyIpoOpened();
        console.log(`IPO page opened: ${ipoOpened ? 'PASS' : 'FAIL'}`);

        console.log('TC 36: Navigating back to Market...');
        await marketsPage.navigateBackToMarkets();

        // Each click*Tile() scrolls the page and the tile row itself as needed to bring that tile
        // fully on screen (the row keeps its horizontal offset between visits).
        console.log('\nTC 37: Clicking "Mutual Funds" tile...');
        await marketsPage.clickMutualFundsTile();

        console.log('TC 38: Waiting for Mutual Funds to open...');
        const mutualFundsOpened = await mutualFundsPage.isOnMutualFundsScreen(8000);
        console.log(`Mutual Funds opened: ${mutualFundsOpened ? 'PASS' : 'FAIL'}`);

        console.log('TC 39: Navigating back to Market...');
        await marketsPage.navigateBackToMarkets();

        console.log('\nTC 40: Clicking "Basket" tile...');
        await marketsPage.clickBasketTile();

        console.log('TC 41: Waiting for Basket to open...');
        const basketOpened = await marketsPage.verifyBasketOpened();
        console.log(`Basket opened: ${basketOpened ? 'PASS' : 'FAIL'}`);

        console.log('TC 42: Navigating back to Market...');
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
