const DriverManager = require('../../driver/DriverManager');
const { MarketsPage } = require('../../pages/MarketsPage');
const { NewsPage } = require('../../pages/NewsPage');
const { MutualFundsPage } = require('../../pages/MutualFundsPage');
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

async function run() {
    const driver = await DriverManager.getDriver();
    try {
        const marketsPage = new MarketsPage(driver);
        const newsPage = new NewsPage(driver);
        const mutualFundsPage = new MutualFundsPage(driver);
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

        console.log('TC 3: Scrolling to Market Live section...');
        const marketLiveVisible = await marketsPage.scrollToMarketLive();
        if (!marketLiveVisible) {
            throw new Error('Could not find "Market Live" section on the Equity screen');
        }

        console.log('TC 4: Clicking See All near Market Live...');
        await marketsPage.clickSeeAllNearMarketLive();

        console.log('TC 5: Waiting up to 10s for the News screen to load...');
        const loaded = await newsPage.waitForLoaded(10000);
        if (!loaded) {
            throw new Error('News screen did not load within 10 seconds');
        }

        const emptyResult = { raw: null, date: null, latestTime: null, isPastOrNow: null, isWithinLast10Days: null, entryCount: 0, distinctTags: [], mismatches: [] };

        // Same per-tab flow as tests/News.test.js: tabs are selected one by one (in fixed
        // left-to-right order) rather than by swiping the tab strip - clicking each tab is what
        // actually scrolls later tabs into view.
        //
        // TC numbers increment across iterations instead of being reused (e.g. a fixed "TC 6" for
        // every tab) - getFailedTCs() in utils/logger.js attributes a failure to whichever "TC N:"
        // was most recently logged, so reusing the same number for every tab would merge failures
        // from different tabs into one bucket and hide which tab actually failed.
        let tc = 6;
        for (const tabName of newsPage.tabNames) {
            console.log(`\nTC ${tc}: Selecting "${tabName}" tab...`);
            await newsPage.clickTab(tabName);
            await driver.pause(1000);
            tc++;

            if (await newsPage.isNoDataFound()) {
                console.log(`No Data Found for "${tabName}" - skipping scroll and search`);
                results.push({ tab: tabName, ...emptyResult });
                continue;
            }

            console.log(`TC ${tc}: Scrolling down 2 times, then up 2 time...`);
            await newsPage.scrollDown();
            await newsPage.scrollDown();
            await newsPage.scrollUp();
            await newsPage.scrollUp();
            tc++;

            if (tabName === 'All') {
                console.log(`TC ${tc}: Opening search bar and searching "Manufacturing"...`);
                await newsPage.clickSearchBar();
                await newsPage.searchNews('Manufacturing');
                await driver.pause(3000);
                await newsPage.verifyNewsSearchResults('Manufacturing');
                await newsPage.closeSearch();
                await driver.pause(1000);
                tc++;
            }

            console.log(`TC ${tc}: Checking latest news date/time and tag consistency for "${tabName}"...`);
            const summary = await newsPage.getFeedSummary(tabName);
            results.push({ tab: tabName, ...summary });
            tc++;
        }

        printSummary(results);

        console.log(`\nTC ${tc}: Closing News screen...`);
        await newsPage.clickClose();
        tc++;

        console.log(`\nTC ${tc}: Navigating back to Markets before the quick-access tile checks...`);
        const backOnMarkets = await marketsPage.navigateBackToMarkets();
        if (!backOnMarkets) {
            throw new Error('Could not get back to the Markets (Equity) screen after closing News');
        }
        tc++;

        console.log(`\nTC ${tc}: Clicking "AI Algo" tile...`);
        await marketsPage.clickAiAlgoTile();
        await pause(2000); // give the webview a moment to start loading before checking
        tc++;

        console.log(`TC ${tc}: Waiting for the AI Algo webview to load and verifying it opened...`);
        const aiAlgoOpened = await marketsPage.verifyAiAlgoOpened();
        console.log(`AI Algo page opened: ${aiAlgoOpened ? 'PASS' : 'FAIL'}`);
        tc++;

        console.log(`TC ${tc}: Navigating back to Market...`);
        await marketsPage.navigateBackToMarkets();
        tc++;

        console.log(`\nTC ${tc}: Clicking "NxtOption" tile...`);
        await marketsPage.clickNxtOptionTile();
        tc++;

        console.log(`TC ${tc}: Waiting for NxtOption to open...`);
        const nxtOptionOpened = await marketsPage.verifyNxtOptionOpened();
        console.log(`NxtOption opened: ${nxtOptionOpened ? 'PASS' : 'FAIL'}`);
        tc++;

        console.log(`TC ${tc}: Navigating back to Market...`);
        await marketsPage.navigateBackToMarkets();
        tc++;

        console.log(`\nTC ${tc}: Clicking "IPO" tile...`);
        await marketsPage.clickIpoTile();
        tc++;

        console.log(`TC ${tc}: Waiting for the IPO webview to load and verifying it opened...`);
        const ipoOpened = await marketsPage.verifyIpoOpened();
        console.log(`IPO page opened: ${ipoOpened ? 'PASS' : 'FAIL'}`);
        tc++;

        console.log(`TC ${tc}: Navigating back to Market...`);
        await marketsPage.navigateBackToMarkets();
        tc++;

        console.log(`\nTC ${tc}: Scrolling the quick-access tile row right to reveal Mutual Funds and Basket...`);
        await marketsPage.scrollTilesRight();
        tc++;

        console.log(`TC ${tc}: Clicking "Mutual Funds" tile...`);
        await marketsPage.clickMutualFundsTile();
        tc++;

        console.log(`TC ${tc}: Waiting for Mutual Funds to open...`);
        const mutualFundsOpened = await mutualFundsPage.isOnMutualFundsScreen(8000);
        console.log(`Mutual Funds opened: ${mutualFundsOpened ? 'PASS' : 'FAIL'}`);
        tc++;

        console.log(`TC ${tc}: Navigating back to Market...`);
        await marketsPage.navigateBackToMarkets();
        tc++;

        console.log(`\nTC ${tc}: Clicking "Basket" tile...`);
        await marketsPage.clickBasketTile();
        tc++;

        console.log(`TC ${tc}: Waiting for Basket to open...`);
        const basketOpened = await marketsPage.verifyBasketOpened();
        console.log(`Basket opened: ${basketOpened ? 'PASS' : 'FAIL'}`);
        tc++;

        console.log(`TC ${tc}: Navigating back to Market...`);
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
