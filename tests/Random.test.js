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
        // =======================================================
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
