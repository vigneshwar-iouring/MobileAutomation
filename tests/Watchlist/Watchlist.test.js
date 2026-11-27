const DriverManager = require('../../driver/DriverManager');
const WatchlistIndexPage = require('../../pages/WatchlistIndexPage');
const { createLogger, getFailedTCs } = require('../../utils/logger');

const { logFile, entries } = createLogger('Watchlist');
console.log(`Logging this run to: ${logFile}`);

// Maximum symbols per watchlist (raised from 50 to 100 in the app).
const WATCHLIST_SYMBOL_LIMIT = 100;
// Longest watchlist name the app accepts; it ignores keystrokes past this, with no toast.
const WATCHLIST_NAME_MAX_LENGTH = 15;

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
            console.log(`\nTC 7: Closing Add Symbols with "${expectedButton}" (${added.length} symbol(s) added) and checking the update toast...`);
            const shownButton = await watchlistPage.getSearchCloseButtonLabel();
            const buttonOk = shownButton === expectedButton;
            console.log(`  Close button shows "${shownButton}" (expected "${expectedButton}") ${buttonOk ? 'PASS' : 'FAIL'}`);
            const updatedToastShown = await watchlistPage.watchForToast(
                watchlistPage.watchlistUpdatedToastText, 3000, () => watchlistPage.closeSearchSymbols());
            if (expectedButton === 'Done') {
                console.log(`  "Watchlist updated Successfully!" toast shown after Done: ${updatedToastShown ? 'PASS' : 'FAIL'}`);
            } else {
                console.log(`  "Watchlist updated Successfully!" toast not shown after Cancel: ${!updatedToastShown ? 'PASS' : 'FAIL'}`);
            }

            countInfo = await watchlistPage.getWatchlistSymbolCount();
            const capped = !!countInfo && countInfo.current === WATCHLIST_SYMBOL_LIMIT;
            console.log(`  Final count: ${countInfo ? `${countInfo.current}/${countInfo.max}` : 'unknown'} (expected ${WATCHLIST_SYMBOL_LIMIT}/${WATCHLIST_SYMBOL_LIMIT}) ${capped ? 'PASS' : 'FAIL'}`);
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
        const newGroupName = 'Watchlist1abcd';
        await watchlistPage.renameEditWatchlistGroup(newGroupName);
        await watchlistPage.closeEditWatchlist();

        if (await watchlistPage.isElementVisible('android=new UiSelector().description("CHANGE")', 800)) {
            await watchlistPage.clickSaveChanges();
        }
        const renameToastShown = await watchlistPage.isWatchlistUpdatedToastShown();
        console.log(`  "Watchlist updated Successfully!" toast shown: ${renameToastShown ? 'PASS' : 'FAIL'}`);

        console.log('\nTC 13: Verifying watchlist name length and empty-name validation...');
        await watchlistPage.navigateToWatchlist();
        await watchlistPage.clickFirstWatchlistTab();
        await watchlistPage.openManageWatchlist();
        await watchlistPage.openEditWatchlistForGroup(newGroupName);

        // The app no longer shows a "too long" toast: it simply stops accepting keystrokes once
        // the name is 15 characters long. So a 20-character name is typed key by key and the
        // field must end up holding exactly its first 15 characters.
        const tooLongName = 'ThisNameIsWayTooLong';
        const shownName = await watchlistPage.typeEditWatchlistNameByKeys(tooLongName);
        await driver.hideKeyboard().catch(() => { });
        const expectedName = tooLongName.slice(0, WATCHLIST_NAME_MAX_LENGTH);
        const lengthOk = shownName.length === WATCHLIST_NAME_MAX_LENGTH;
        console.log(`  Name length after typing ${tooLongName.length} characters: ${shownName.length} (expected ${WATCHLIST_NAME_MAX_LENGTH}) ${lengthOk ? 'PASS' : 'FAIL'}`);
        const textOk = shownName === expectedName;
        console.log(`  Typing stopped at the ${WATCHLIST_NAME_MAX_LENGTH}th character: "${shownName}" (expected "${expectedName}") ${textOk ? 'PASS' : 'FAIL'}`);

        await watchlistPage.clearEditWatchlistNameField();
        await watchlistPage.closeEditWatchlist();
        const emptyToastShown = await watchlistPage.isWatchlistNameEmptyToastShown();
        console.log(`  "Watchlist name cannot be empty!" toast shown: ${emptyToastShown ? 'PASS' : 'FAIL'}`);

        // An empty/invalid name blocks saving, so the group is restored to a valid name here
        // rather than left nameless for every subsequent TC/run.
        await watchlistPage.renameEditWatchlistGroup(newGroupName);
        await watchlistPage.closeEditWatchlist();
        if (await watchlistPage.isElementVisible('android=new UiSelector().description("CHANGE")', 800)) {
            await watchlistPage.clickSaveChanges();
        }

        console.log('\nTC 14: Toggling the NIFTY row on Manage Watchlist...');
        await watchlistPage.navigateToWatchlist();
        await watchlistPage.clickFirstWatchlistTab();
        await watchlistPage.openManageWatchlist();
        // The toggle has no accessibility signal to assert on (see toggleManageWatchlistIndexRow),
        // so before/after screenshots are saved for visual confirmation instead of a PASS/FAIL log.
        await driver.saveScreenshot(`./logs/nifty_toggle_before_${Date.now()}.png`).catch(() => { });
        await watchlistPage.toggleManageWatchlistIndexRow('NIFTY');
        await driver.pause(500);
        await driver.saveScreenshot(`./logs/nifty_toggle_after_${Date.now()}.png`).catch(() => { });
        console.log('  Tapped the NIFTY toggle');

        await watchlistPage.navigateToWatchlist();

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
