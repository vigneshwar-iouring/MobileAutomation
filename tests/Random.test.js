// Scratch file for debugging individual steps from any DriverManager-style test.
// Every flat page object and util that stack uses is imported and instantiated below -
// paste the steps you want to debug into the "DEBUG STEPS" block and run:
//   node tests/Random.test.js
// (Regression/ page objects under pages/<Category>/ use WDIO globals and are deliberately
// not imported here - see CLAUDE.md.)

const fs = require('fs');
const path = require('path');
const { spawnSync, execFileSync } = require('child_process');

const DriverManager = require('../driver/DriverManager');
const AppiumConfig = require('../config/appium.config');
const { APP_PACKAGE } = require('../config/appium.config');
const devices = require('../config/devices.config');
const testData = require('../data/testData');

const BasePage = require('../pages/BasePage');
const SplashPage = require('../pages/SplashPage');
const LoginPage = require('../pages/LoginPage');
const ForgotPasswordPage = require('../pages/ForgotPasswordPage');
const ResearchCalls = require('../pages/ResearchCalls');
const BasketPage = require('../pages/BasketPage');
const FundsPage = require('../pages/FundsPage');
const OrderPadPage = require('../pages/OrderPadPage');
const QuotesPage = require('../pages/QuotesPage');
const WatchlistIndexPage = require('../pages/WatchlistIndexPage');
const { MarketsPage, HRA_TABS, HRA_PERIODS, SIR_TABS } = require('../pages/MarketsPage');
const { NewsPage, parseNewsDateHeader } = require('../pages/NewsPage');
const { MutualFundsPage, parsePortfolioSummary, getExpectedFinancialYearLabel, daysBetween } = require('../pages/MutualFundsPage');
const { CorporateActionPage } = require('../pages/CorporateActionPage');
const { ResultsPage, isResultRow, parseResultRow } = require('../pages/ResultsPage');
const { PeerComparisonPage, PEER_TABS, PEER_SUB_TABS, PEER_TABS_WITH_SUB_TABS } = require('../pages/PeerComparisonPage');

const permissionHandler = require('../utils/permissionHandler');
const { getLatestUid, fetchLatestOtp } = require('../utils/gmailOtpHelper');
const { decodePng, regionCoverage, pixelAt } = require('../utils/pngPixels');
const { createLogger, getFailedTCs } = require('../utils/logger');
const { logSection, countTab, verifyOrderPad, runSymbolQuoteFlow, countAndRunQuoteFlow } = require('./ResearchCalls/shared');

const { logFile, entries } = createLogger('Random');
console.log(`Logging this run to: ${logFile}`);

const RECENTLY_VIEWED_LIMIT = 50;

function printSummary(results) {
    const line = '='.repeat(60);
    console.log(`\n${line}\n SUMMARY - Latest news date/time and tag check per tab\n${line}`);
    for (const r of results) {
        if (r.noData) {
            console.log(`  ${r.tab}: No Data Found`);
            continue;
        }
        if (!r.date) {
            console.log(`  ${r.tab}: FAIL - could not parse date (raw: "${r.raw}")`);
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
        const basePage = new BasePage(driver);
        const splashPage = new SplashPage(driver);
        const loginPage = new LoginPage(driver);
        const forgotPasswordPage = new ForgotPasswordPage(driver);
        const researchCalls = new ResearchCalls(driver);
        const basketPage = new BasketPage(driver);
        const fundsPage = new FundsPage(driver);
        const orderPadPage = new OrderPadPage(driver);
        const quotesPage = new QuotesPage(driver);
        const watchlistIndexPage = new WatchlistIndexPage(driver);
        const marketsPage = new MarketsPage(driver);
        const newsPage = new NewsPage(driver);
        const mutualFundsPage = new MutualFundsPage(driver);
        const corporateActionPage = new CorporateActionPage(driver);
        const resultsPage = new ResultsPage(driver);
        const peerPage = new PeerComparisonPage(driver);

        // ===================== DEBUG STEPS =====================
        // Paste the steps to debug here, e.g. copied from tests/Markets/Equity.test.js:
        //   console.log('\nTC 81: Clicking the first symbol under Last Visited...');
        //   const recentSymbol = await marketsPage.tapFirstRecentlyViewed();
        //   await marketsPage.verifyQuoteOpened(recentSymbol);


        console.log('\nTC 91: Clicking the global search bar at the top of Markets...');
        await marketsPage.scrollToTop();
        if (!(await marketsPage.clickGlobalSearchBar())) {
            throw new Error('Global search screen did not open from the Markets search bar');
        }

        // Each search opens the chosen result's Quote, comes back to search and clears the text;
        // the symbols opened must then show up under Last Visited.
        const searches = [
            { query: 'IDEA', position: 1 },
            { query: 'GTLINFRA', position: 2 },
            { query: 'NIFTY 22750', position: 1 },
            { query: 'USDINR', position: 1 },
            { query: 'GOLD 149000', position: 1 },
        ];
        const viewedSymbols = [];
        let tc = 92;
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

        console.log('\nTC 97: Closing global search and scrolling to Last Visited...');
        await marketsPage.closeGlobalSearch();
        if (!(await marketsPage.navigateBackToMarkets())) {
            throw new Error('Could not get back to the Markets (Equity) screen from global search');
        }
        if (!(await marketsPage.scrollToRecentlyViewed())) {
            throw new Error('Last Visited section not found on the Markets (Equity) screen');
        }

        console.log('\nTC 98: Clicking "See all" on Last Visited...');
        await marketsPage.clickSeeAllRecentlyViewed();
        if (!(await marketsPage.verifyRecentlyViewedSeeAllOpened())) {
            throw new Error('Last Visited "See all" screen did not open');
        }

        console.log(`\nTC 99: Verifying the searched symbols are listed under Last Visited (at most ${RECENTLY_VIEWED_LIMIT})...`);
        console.log(`Symbols viewed via search: ${viewedSymbols.join(', ') || 'none'}`);
        if (viewedSymbols.length < searches.length) {
            console.log(`Only ${viewedSymbols.length} of ${searches.length} searched symbols opened a Quote: FAIL`);
        }
        await marketsPage.verifyRecentlyViewedList(viewedSymbols, RECENTLY_VIEWED_LIMIT);

        console.log('\nTC 100: Closing Last Visited and navigating back to Markets...');
        await marketsPage.closeRecentlyViewedSeeAll();
        if (!(await marketsPage.navigateBackToMarkets())) {
            throw new Error('Could not get back to the Markets (Equity) screen from Last Visited');
        }

        console.log('\nTC 101: Clicking the first symbol under Last Visited and verifying its Quote...');
        const recentSymbol = await marketsPage.tapFirstRecentlyViewed();
        const recentQuoteOpened = !!recentSymbol && await marketsPage.verifyQuoteOpened(recentSymbol);

        console.log('\nTC 102: Closing the Quote and navigating back to Markets...');
        if (!recentQuoteOpened) {
            console.log('No Quote open from Last Visited - skipping the back-press: FAIL');
        } else if (!(await marketsPage.navigateBackFromQuote())) {
            throw new Error('Could not get back to the Markets (Equity) screen from the Last Visited Quote');
        }

        // Most recently viewed is listed first - that's the symbol TC 101 opened, or failing that the
        // last one searched.
        const firstRecent = recentSymbol || viewedSymbols[viewedSymbols.length - 1];
        console.log(`\nTC 103: Clicking X on the first symbol (${firstRecent || 'none'}) and verifying it is removed from Last Visited...`);
        if (!firstRecent) {
            console.log('No symbol listed under Last Visited to remove: FAIL');
        } else {
            await marketsPage.removeRecentlyViewed(firstRecent);
        }

        console.log('\nTC 104: Scrolling to FII/DII and verifying it shows the previous trading day\'s date...');
        const fii = await marketsPage.scrollToFiiDii();
        if (!fii) throw new Error('FII/DII section not found on the Markets (Equity) screen');
        marketsPage.verifyFiiDiiDate(fii);

        console.log('\nTC 105: Verifying the FII Cash, DII Cash, FII Future and FII Option rows with values in Crore...');
        marketsPage.verifyFiiDiiRows(fii);

        console.log('\nTC 106: Verifying the FII/DII graph bars - red for negative, green for positive values...');
        await marketsPage.verifyFiiDiiBars(fii);

        console.log('\nTC 107: Clicking "See all" on FII/DII and verifying the Daily, Monthly, Yearly tabs and ALL, STOCK, INDEX sub-tabs...');
        await marketsPage.clickSeeAllFiiDii();
        if (!(await marketsPage.verifyFiiDiiSeeAllOpened())) {
            throw new Error('FII/DII "See all" screen did not open with its tabs and sub-tabs');
        }

        console.log('\nTC 108: Verifying Daily and ALL are selected by default with the same date shown on Markets...');
        await marketsPage.verifyFiiDiiSeeAllDefault(fii.dateText);

        console.log('\nTC 109: Daily - scrolling down ALL and verifying the past dates listed...');
        await marketsPage.verifyFiiDiiHistory('Daily', 'ALL');

        console.log('\nTC 110: Clicking STOCK and verifying only FII Cash and DII Cash are displayed...');
        await marketsPage.clickFiiDiiSegment('STOCK');

        console.log('\nTC 111: Daily - scrolling down STOCK and verifying the past dates listed...');
        await marketsPage.verifyFiiDiiHistory('Daily', 'STOCK');

        console.log('\nTC 112: Clicking INDEX and verifying only FII Future and FII Option are displayed...');
        await marketsPage.clickFiiDiiSegment('INDEX');

        console.log('\nTC 113: Daily - scrolling down INDEX and verifying the past dates listed...');
        await marketsPage.verifyFiiDiiHistory('Daily', 'INDEX');

        // Monthly, then Yearly: the latest entry must be the current month/year, then each sub-tab
        // in turn must list only its own rows, down through all its past months/years.
        tc = 114;
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
    }
    catch (err) {
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
