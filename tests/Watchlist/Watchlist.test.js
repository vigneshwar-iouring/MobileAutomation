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

            console.log('\nTC 4: Clicking ADD SYMBOLS and searching for "HDFC"...');
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

        console.log('\nTC 5: Reading the 1st watchlist tab\'s current symbol count...');
        await watchlistPage.clickFirstWatchlistTab();
        let countInfo = await watchlistPage.getWatchlistSymbolCount();
        console.log(countInfo ? `  Current count: ${countInfo.current}/${countInfo.max}` : '  Could not read the watchlist symbol count (list may still be empty).');

        if (countInfo && countInfo.current < countInfo.max) {
            console.log('\nTC 6: Adding symbols via "HDFC" search until the cap is reached...');
            await watchlistPage.openSearchSymbols();
            await watchlistPage.searchAddSymbols('HDFC');
            const added = await watchlistPage.addSearchResultsUntilCapped();
            console.log(`  Added ${added.length} symbol(s) via "HDFC" search: ${added.join(', ')}`);
            await watchlistPage.closeSearchSymbols();

            console.log('\nTC 7: Saving and verifying the update toast...');
            // Some "leave with unsaved changes" flows in this app (e.g. Manage Indices, Edit
            // Watchlist) show a DISCARD/CHANGE prompt on exit - live-observed here that the Add
            // Symbols screen's Done instead saves immediately with its own short-lived success
            // toast, so this prompt check is kept brief (a real prompt appears near-instantly)
            // rather than the far longer wait used to check for genuinely absent elements
            // elsewhere - burning ~2s+ here waiting on a prompt that never shows was observed live
            // to eat into the toast's own lifetime and make the very next check report a false FAIL.
            if (await watchlistPage.isElementVisible('android=new UiSelector().description("CHANGE")', 800)) {
                await watchlistPage.clickSaveChanges();
            }
            const addToastShown = await watchlistPage.isWatchlistUpdatedToastShown();
            console.log(`  "Watchlist updated Successfully!" toast shown: ${addToastShown ? 'PASS' : 'FAIL'}`);

            countInfo = await watchlistPage.getWatchlistSymbolCount();
            console.log(`  Final count: ${countInfo ? `${countInfo.current}/${countInfo.max}` : 'unknown'}`);
        } else if (countInfo) {
            console.log('\nTC 6/7: Already at the cap - nothing to add, skipping.');
        }

        console.log('\nTC 8: Opening Manage Watchlist and Edit Watchlist for the 1st tab\'s group...');
        await watchlistPage.openManageWatchlist();
        await watchlistPage.openEditWatchlistForGroup(firstTabName);
        const onEditWatchlist = await watchlistPage.isOnEditWatchlistScreen();
        console.log(`  On Edit Watchlist screen: ${onEditWatchlist ? 'PASS' : 'FAIL'}`);

        console.log('\nTC 9: Removing the 1st symbol and verifying the removed toast...');
        const removedSymbol = await watchlistPage.removeFirstEditWatchlistSymbol();
        const removedToastShown = await watchlistPage.isSymbolRemovedToastShown(removedSymbol);
        console.log(`  "${removedSymbol} Removed" toast shown: ${removedToastShown ? 'PASS' : 'FAIL'}`);

        console.log('\nTC 10: Undoing the removal and verifying the symbol is restored...');
        const undoClicked = await watchlistPage.clickUndoOnSymbolRemovedToast(removedSymbol);
        console.log(`  "Undo" clicked: ${undoClicked ? 'PASS' : 'FAIL'}`);
        await driver.pause(600);
        const restoredSymbols = await watchlistPage.getEditWatchlistRemovableSymbols();
        const isRestored = restoredSymbols.some(s => s.symbol === removedSymbol);
        console.log(`  "${removedSymbol}" restored after Undo: ${isRestored ? 'PASS' : 'FAIL'}`);

        console.log('\nTC 11: Removing the same symbol again and saving...');
        await watchlistPage.removeEditWatchlistSymbol(removedSymbol);
        await driver.pause(500);
        await watchlistPage.closeEditWatchlist();

        // Leaving Edit Watchlist with an unsaved removal was observed live to sometimes show the
        // DISCARD/CHANGE prompt and sometimes save directly (like the Add Symbols screen's Done) -
        // checked the same brief, non-blocking way as TC 7 rather than assumed either way.
        if (await watchlistPage.isElementVisible('android=new UiSelector().description("CHANGE")', 800)) {
            await watchlistPage.clickSaveChanges();
        }
        const saveToastShown = await watchlistPage.isWatchlistUpdatedToastShown();
        console.log(`  "Watchlist updated Successfully!" toast shown: ${saveToastShown ? 'PASS' : 'FAIL'}`);

        console.log('\nTC 12: Renaming the 1st watchlist group via Manage Watchlist...');
        await watchlistPage.navigateToWatchlist();
        await watchlistPage.clickFirstWatchlistTab();
        await watchlistPage.openManageWatchlist();
        await watchlistPage.openEditWatchlistForGroup(firstTabName);
        const newGroupName = 'Watchlist_1';
        await watchlistPage.renameEditWatchlistGroup(newGroupName);
        await watchlistPage.closeEditWatchlist();

        if (await watchlistPage.isElementVisible('android=new UiSelector().description("CHANGE")', 800)) {
            await watchlistPage.clickSaveChanges();
        }
        const renameToastShown = await watchlistPage.isWatchlistUpdatedToastShown();
        console.log(`  "Watchlist updated Successfully!" toast shown: ${renameToastShown ? 'PASS' : 'FAIL'}`);

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
