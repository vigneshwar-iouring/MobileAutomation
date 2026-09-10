const DriverManager = require('../../driver/DriverManager');
const WatchlistIndexPage = require('../../pages/WatchlistIndexPage');
const { createLogger, getFailedTCs } = require('../../utils/logger');

const { logFile, entries } = createLogger('Watchlist');
console.log(`Logging this run to: ${logFile}`);

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

            console.log('  Clicking ADD SYMBOLS and searching for "HDFC"...');
            await watchlistPage.clickAddSymbols();
            await watchlistPage.searchAddSymbols('HDFC');
            const addedSymbol = await watchlistPage.clickAddIconForFirstResult();
            console.log(`  Added "${addedSymbol}" to "${firstTabName}" via the "+" icon`);
        } else {
            const symbol = await watchlistPage.clickFirstWatchlistSymbol();
            await driver.pause(1200);
            console.log(`  "${firstTabName}" has symbols - opened first symbol "${symbol}"`);
            await watchlistPage.goBackToQuotes();
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
