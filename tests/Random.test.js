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
        //   console.log('\nTC 81: Clicking the first symbol under Stocks You Viewed Recently...');
        //   const recentSymbol = await marketsPage.tapFirstRecentlyViewed();
        //   await marketsPage.verifyQuoteOpened(recentSymbol);


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
