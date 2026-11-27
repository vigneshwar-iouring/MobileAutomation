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

// Same value as Watchlist.test.js.
const WATCHLIST_SYMBOL_LIMIT = 100;

async function run() {
const driver = await DriverManager.getDriver();
try {
    const watchlistPage = new WatchlistIndexPage(driver);

    console.log('TC 1: Verifying current screen is Watchlist...');
    await watchlistPage.navigateToWatchlist();

    console.log('\nTC 2: Clicking through every individual watchlist tab...');
    const clickedTabs = await watchlistPage.clickAllWatchlistNameTabs(30, async ({ name, n, total }) => {
        const hasSymbols = !(await watchlistPage.isWatchlistEmpty());
        console.log(`\nSwitched to tab ${n} of ${total}: "${name}" - has symbols: ${hasSymbols ? 'Yes' : 'No'}`);
    });
    console.log(`Clicked ${clickedTabs.length} watchlist tabs: ${clickedTabs.join(', ')}`);

    console.log('\nTC 3: Checking the 1st watchlist tab for symbols...');
    const firstTabName = await watchlistPage.clickFirstWatchlistTab();
    if (await watchlistPage.isWatchlistEmpty()) {
        const { hasHeading, hasSubtext, hasAddSymbolsButton } = await watchlistPage.getEmptyWatchlistDetails();
        console.log(`  "${firstTabName}" is empty:`);
        console.log(`    "Empty Watchlist" heading shown: ${hasHeading ? 'PASS' : 'FAIL'}`);
        console.log(`    "Add symbols to your watchlist group" message shown: ${hasSubtext ? 'PASS' : 'FAIL'}`);
        console.log(`    "ADD SYMBOLS" button shown: ${hasAddSymbolsButton ? 'PASS' : 'FAIL'}`);

        console.log('\nTC 4: Clicking ADD SYMBOLS and searching for "HDFC"...');
        await watchlistPage.clickAddSymbols();
        await watchlistPage.searchAddSymbols('HDFC');
        const addedSymbol = await watchlistPage.clickAddIconForFirstResult();
        console.log(`  Added "${addedSymbol}" to "${firstTabName}" via the "+" icon`);
    } else {
        const symbol = await watchlistPage.clickFirstWatchlistSymbol();
        await driver.pause(1200);
        console.log(`  "${firstTabName}" has symbols - opened first symbol "${symbol}"`);
        await watchlistPage.swipeUpQuoteScreen();
        // Backs out until Watchlist is actually showing - doesn't assume one back press
        // leaves an expanded Quote screen rather than just collapsing it.
        await watchlistPage.navigateToWatchlist();
    }

    console.log('\nTC 5: Reading the 1st watchlist tab\'s current symbol count...');
    await watchlistPage.clickFirstWatchlistTab();
    let countInfo = await watchlistPage.getWatchlistSymbolCount();
    console.log(countInfo ? `  Current count: ${countInfo.current}/${countInfo.max}` : '  Could not read the watchlist symbol count (list may still be empty).');
    if (countInfo) {
        const limitOk = countInfo.max === WATCHLIST_SYMBOL_LIMIT;
        console.log(`  Watchlist symbol limit: ${countInfo.max} (expected ${WATCHLIST_SYMBOL_LIMIT}) ${limitOk ? 'PASS' : 'FAIL'}`);
    }

    // Runs even when the watchlist is already full: the add attempt is then refused straight
    // away, which is exactly the cap validation.
    if (countInfo) {
        console.log(`\nTC 6: Adding symbols via "HDFC" search until the ${WATCHLIST_SYMBOL_LIMIT}-symbol cap is reached...`);
        await watchlistPage.openSearchSymbols();
        await watchlistPage.searchAddSymbols('HDFC');
        const added = await watchlistPage.addSearchResultsUntilCapped();
        console.log(`  Added ${added.length} symbol(s) via "HDFC" search: ${added.join(', ')}`);
        const addedOk = added.length === WATCHLIST_SYMBOL_LIMIT - countInfo.current;
        console.log(`  Symbols added: ${added.length} (expected ${WATCHLIST_SYMBOL_LIMIT - countInfo.current} to go from ${countInfo.current} to ${WATCHLIST_SYMBOL_LIMIT}) ${addedOk ? 'PASS' : 'FAIL'}`);
        if (!added.length && !added.capReached) {
            console.error(`  FAIL: no "HDFC" search result could be added at ${countInfo.current}/${countInfo.max} - see ui_dumps/watchlist_add_symbols_no_addable.xml`);
        }
        const capRefused = added.capReached;
        console.log(`  App refused adding past the ${WATCHLIST_SYMBOL_LIMIT}-symbol cap: ${capRefused ? 'PASS' : 'FAIL'}`);

        // One more add attempt at the cap, watched for the app's limit toast.
        const maxToastText = `Maximum ${WATCHLIST_SYMBOL_LIMIT} scrips can be added`;
        const overCap = capRefused ? await watchlistPage.tapAddExpectingMaxToast(WATCHLIST_SYMBOL_LIMIT) : null;
        if (!overCap) {
            console.error(`  FAIL: could not attempt an add past the cap to check the "${maxToastText}" toast`);
        } else {
            console.log(`  Tapped "Add Watchlist" on "${overCap.symbol}" at ${WATCHLIST_SYMBOL_LIMIT}/${WATCHLIST_SYMBOL_LIMIT} - refused: ${overCap.refused ? 'PASS' : 'FAIL'}`);
            console.log(`  "${maxToastText}" toast shown: ${overCap.toastShown ? 'PASS' : 'FAIL'}`);
        }

        // "Watchlist updated Successfully!" is shown only when symbols were added and Add Symbols
        // is closed with Done. With nothing added (the watchlist was already full) it is closed
        // with Cancel, and no toast must appear. Watched with multi-window reading on (where
        // the app's toasts are drawn), so an absent toast is a real result.
        const expectedButton = added.length ? 'Done' : 'Cancel';

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
