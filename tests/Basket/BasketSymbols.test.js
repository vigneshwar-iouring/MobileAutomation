const DriverManager = require('../../driver/DriverManager');
const ResearchCalls = require('../../pages/ResearchCalls');
const BasketPage = require('../../pages/BasketPage');
const { createLogger, getFailedTCs } = require('../../utils/logger');

const { logFile, entries } = createLogger('Basket');
console.log(`Logging this run to: ${logFile}`);

async function run() {
    const driver = await DriverManager.getDriver();
    try {
        const researchCalls = new ResearchCalls(driver);
        const basketPage = new BasketPage(driver);

        console.log('TC 1: Navigating to Basket via the hamburger menu...');
        await basketPage.goToHome();
        await researchCalls.clickHamburgerMenu();
        await basketPage.clickBasketOrdersMenuItem();
        let onBasketScreen = await basketPage.waitForBasketScreen();
        if (onBasketScreen) {
            console.log('Basket screen loaded via hamburger -> Basket Orders');
        } else {
            console.error('FAIL: Basket screen did not load within 10s of tapping "Basket Orders" in the hamburger menu');
            // Keep the rest of the flow testable: reach the same screen via Orders -> Basket tab.
            await basketPage.openBasketViaOrdersTab();
            onBasketScreen = await basketPage.waitForBasketScreen();
            if (!onBasketScreen) {
                throw new Error('Basket screen did not load via the hamburger menu or via Orders -> Basket tab');
            }
            console.log('Basket screen loaded via fallback (Orders -> Basket tab)');
        }

        // RESUME_CLONE_LIMIT=1: run only the clone-to-50 + global-search limit flow. New baskets
        // can't be created while the account is at its 20-basket limit, so an existing basket
        // (CLONE_BASKET, default "A") is reused: one already at 50 symbols is preferred (straight to
        // the 51st-symbol check), else an empty one is given a TATASTEEL symbol and cloned up to 50.
        if (process.env.RESUME_CLONE_LIMIT === '1') {
            const name = process.env.CLONE_BASKET || 'A';
            console.log(`TC 2: Opening saved basket "${name}" (RESUME_CLONE_LIMIT)...`);
            const full = await basketPage.openSavedBasket(name, BASKET_MAX_ITEMS, 5000, { quiet: true });
            if (!full) {
                if (!(await basketPage.openSavedBasket(name, 0))) throw new Error(`No saved basket "${name}" with 50 or 0 items to resume on`);
                const added = await basketPage.addSymbolToBasket({
                    query: 'TataSteel', symbol: 'TATASTEEL', side: 'BUY', exchange: 'NSE', orderType: 'Market', product: 'Intraday',
                });
                await basketPage.pause(1000);
                const count = await basketPage.getItemCount();
                console.log(`TATASTEEL added: ${added}, item count ${count} ${added && count === 1 ? 'PASS' : 'FAIL'}`);
                if (!count) throw new Error('Basket has no symbol to clone');
            }
            await cloneToLimitChecks(basketPage, 3);
            console.log('Basket flow completed (clone limit only)');
            return;
        }

        console.log('TC 2: Checking for saved baskets, else verifying the empty-basket message...');
        const basketState = await basketPage.getBasketListState();
        if (basketState.count > 0) {
            console.log(`Saved baskets found (${basketState.count}):`);
            basketState.rows.forEach((r, i) => console.log(`  [${i}] ${r.replace(/\n/g, ' | ')}`));
        } else if (basketState.emptyMessageShown) {
            console.log(`No saved baskets - empty message shown: "${basketPage.noBasketText}"`);
        } else {
            console.error(`FAIL: no saved baskets listed and the empty message "${basketPage.noBasketText}" was not shown`);
        }

        console.log('TC 3: Clicking New Basket...');
        await basketPage.clickNewBasket();
        const dialogOpened = await basketPage.verifyNewBasketDialogOpened();
        if (!dialogOpened) {
            console.error('"New Basket" dialog did not open. This button has been observed to reject ');
            return;
        }

        console.log('TC 4: Clicking Create Basket with no name entered...');
        await basketPage.clickCreateBasket();
        const nameError = await basketPage.getCreateBasketError();
        console.log(`Error message: "${nameError}"`);

        console.log('TC 5: Entering basket name "Basket 1" and creating it...');
        await basketPage.enterBasketName('Basket 1');
        await basketPage.clickCreateBasket();
        const toastShown = await basketPage.waitForBasketCreatedToast();
        console.log(`"Basket created successfully" toast shown: ${toastShown}`);

        console.log('TC 6: Verifying basket header, empty state, and EXECUTE state...');
        await basketPage.readBasketHeader();
        const emptyState = await basketPage.isEmptyBasketCentered();
        console.log(`"Empty Basket" visible: ${emptyState.visible}, centered: ${emptyState.centered}`);
        const executeEnabled = await basketPage.isExecuteEnabled();
        console.log(`EXECUTE enabled: ${executeEnabled} (expected false while basket is empty)`);

        // Every combination of side x exchange x order type x product, all for TATASTEEL.
        // Adding to a basket never places an order - only EXECUTE does, and it is never tapped.
        const combos = [];
        for (const side of ['SELL', 'BUY'])
            for (const exchange of ['NSE', 'BSE'])
                for (const orderType of ['Market', 'Limit'])
                    for (const product of ['Intraday', 'Delivery'])
                        combos.push({ query: 'TataSteel', symbol: 'TATASTEEL', side, exchange, orderType, product });

        let tc = 7;
        for (const combo of combos) {
            const label = `ADD ${combo.side} ${combo.exchange} ${combo.orderType} ${combo.product}`;
            console.log(`TC ${tc}: ${label}...`);
            const countBefore = await basketPage.getItemCount();
            const added = await basketPage.addSymbolToBasket(combo);
            await basketPage.pause(1000);
            const countAfter = await basketPage.getItemCount();
            const countOk = countBefore !== null && countAfter === countBefore + 1;
            console.log(`Item count ${countBefore} -> ${countAfter} ${countOk ? 'PASS' : 'FAIL'}`);
            if (!added) console.error(`FAIL: ${label} was not added as requested`);
            tc++;
        }

        console.log(`TC ${tc}: Verifying every combination is in the basket...`);
        const items = await basketPage.getBasketItems();
        console.log(`Basket items read: ${items.length}`);
        items.forEach((it, i) => console.log(`  [${i}] ${it.side} ${it.name} ${it.exchange} ${it.orderType} ${it.product}`));
        // The basket rows may use exchange-style codes (MIS/CNC, MKT/LMT) instead of the pad's labels.
        const PRODUCT = { Intraday: ['INTRADAY', 'MIS'], Delivery: ['DELIVERY', 'CNC'] };
        const ORDER_TYPE = { Market: ['MARKET', 'MKT'], Limit: ['LIMIT', 'LMT'] };
        const is = (value, options) => !!value && options.includes(value.toUpperCase());
        const unmatched = [...items];
        for (const c of combos) {
            const idx = unmatched.findIndex(it =>
                is(it.side, [c.side]) && is(it.exchange, [c.exchange]) &&
                is(it.orderType, ORDER_TYPE[c.orderType]) && is(it.product, PRODUCT[c.product]));
            const label = `${c.side} ${c.exchange} ${c.orderType} ${c.product}`;
            if (idx === -1) console.error(`FAIL: no basket item found for ${label}`);
            else { console.log(`Found in basket: ${label} PASS`); unmatched.splice(idx, 1); }
        }
        tc++;

        console.log(`TC ${tc}: Verifying EXECUTE state after adding symbols...`);
        const executeEnabledAfter = await basketPage.isExecuteEnabled();
        console.log(`EXECUTE enabled: ${executeEnabledAfter} (expected true now that the basket has items)`);
        if (!executeEnabledAfter) console.error('FAIL: EXECUTE is not enabled with items in the basket');
        tc++;

        console.log(`TC ${tc}: Cloning the first symbol in the basket...`);
        const countBeforeClone = await basketPage.getItemCount();
        await basketPage.tapFirstBasketItem();
        await basketPage.clickClone();
        const clonedToast = await basketPage.waitForToast('Symbol cloned successfully', { timeout: 3000 });
        console.log(`"Symbol cloned successfully" toast shown: ${clonedToast} ${clonedToast ? 'PASS' : 'FAIL'}`);
        await basketPage.pause(1000);
        const countAfterClone = await basketPage.getItemCount();
        const cloneCountOk = countBeforeClone !== null && countAfterClone === countBeforeClone + 1;
        console.log(`Item count ${countBeforeClone} -> ${countAfterClone} ${cloneCountOk ? 'PASS' : 'FAIL'}`);
        tc++;

        console.log(`TC ${tc}: Modifying the first symbol - swapping Buy/Sell...`);
        const firstBefore = await basketPage.getFirstItemDesc();
        const sideBefore = BasketPage.sideOf(firstBefore);
        await basketPage.tapFirstBasketItem();
        await basketPage.clickModify();
        const updatedToast = await basketPage.swapSideAndSave();
        console.log(`"Basket updated successfully" toast shown: ${updatedToast} ${updatedToast ? 'PASS' : 'FAIL'}`);
        await basketPage.pause(1000);
        const sideAfter = BasketPage.sideOf(await basketPage.getFirstItemDesc());
        const expectedSide = sideBefore === 'BUY' ? 'SELL' : 'BUY';
        const swapOk = sideAfter === expectedSide;
        console.log(`First item side ${sideBefore} -> ${sideAfter} (expected ${expectedSide}) ${swapOk ? 'PASS' : 'FAIL'}`);
        tc++;

        await renameBasketChecks(basketPage, tc);
        tc += 2;

        await removeSymbolChecks(basketPage, tc);
        tc += 2;

        tc = await cloneToLimitChecks(basketPage, tc);

        await deleteBasketChecks(basketPage, tc);

        console.log('Basket flow completed');
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

// Edit -> rename -> Back -> "Do you want to save the changes?": No keeps the old name, Yes saves
// the new one. Starts and ends on the open basket's detail screen.
const NEW_BASKET_NAME = 'Baskets';
async function renameBasketChecks(basketPage, tc) {
    console.log(`TC ${tc}: Renaming the basket and answering No on the save popup...`);
    const originalName = await basketPage.getOpenBasketName();
    console.log(`Current basket name: "${originalName}"`);
    if (!originalName) {
        console.error('FAIL: could not read the open basket name');
        return;
    }
    await basketPage.clickEditBasket();
    await basketPage.renameBasket(originalName, NEW_BASKET_NAME);
    if (await basketPage.leaveEditBasket()) await basketPage.answerSaveChanges('No');
    const nameAfterNo = await basketPage.getOpenBasketName();
    const unchanged = nameAfterNo === originalName;
    console.log(`Basket name after No: "${nameAfterNo}" (expected "${originalName}") ${unchanged ? 'PASS' : 'FAIL'}`);
    tc++;

    console.log(`TC ${tc}: Renaming the basket and answering Yes on the save popup...`);
    await basketPage.clickEditBasket();
    await basketPage.renameBasket(nameAfterNo || originalName, NEW_BASKET_NAME);
    if (await basketPage.leaveEditBasket()) await basketPage.answerSaveChanges('Yes');
    const nameAfterYes = await basketPage.getOpenBasketName();
    const changed = nameAfterYes === NEW_BASKET_NAME;
    console.log(`Basket name after Yes: "${nameAfterYes}" (expected "${NEW_BASKET_NAME}") ${changed ? 'PASS' : 'FAIL'}`);
}

// Edit -> Remove the first symbol -> "<SYMBOL> Removed" message with Undo: Undo brings the symbol
// back; removing again and tapping Done saves it. Starts and ends on the basket detail screen.
async function removeSymbolChecks(basketPage, tc) {
    console.log(`TC ${tc}: Removing the first symbol and undoing it...`);
    const countBefore = await basketPage.getItemCount();
    await basketPage.clickEditBasket();
    const firstBefore = (await basketPage.getVisibleItemRows())[0];
    const message = await basketPage.removeFirstSymbol();
    console.log(`Removed message: "${message}" ${message ? 'PASS' : 'FAIL'}`);
    const firstAfterRemove = (await basketPage.getVisibleItemRows())[0];
    const removedShown = firstAfterRemove !== firstBefore;
    console.log(`First symbol gone from the list after Remove: ${removedShown ? 'PASS' : 'FAIL'}`);
    await basketPage.undoRemove();
    const firstAfterUndo = (await basketPage.getVisibleItemRows())[0];
    const restored = firstAfterUndo === firstBefore;
    console.log(`First symbol back in the list after Undo: ${restored ? 'PASS' : 'FAIL'}`);
    // Nothing changed, so leave without saving (the popup may or may not appear).
    await basketPage.click(basketPage.editBasketBack);
    if (await basketPage.isElementVisible(basketPage.saveChangesPrompt, 2000)) await basketPage.answerSaveChanges('No');
    const countAfterUndo = await basketPage.getItemCount();
    const countKept = countBefore !== null && countAfterUndo === countBefore;
    console.log(`Item count ${countBefore} -> ${countAfterUndo} (expected unchanged) ${countKept ? 'PASS' : 'FAIL'}`);
    tc++;

    console.log(`TC ${tc}: Removing the first symbol and saving with Done...`);
    const detailRowsBefore = await basketPage.getVisibleItemRows();
    await basketPage.clickEditBasket();
    const message2 = await basketPage.removeFirstSymbol();
    console.log(`Removed message: "${message2}" ${message2 ? 'PASS' : 'FAIL'}`);
    await basketPage.clickDone();
    const countAfterDone = await basketPage.getItemCount();
    const countDropped = countAfterUndo !== null && countAfterDone === countAfterUndo - 1;
    console.log(`Item count ${countAfterUndo} -> ${countAfterDone} (expected one less) ${countDropped ? 'PASS' : 'FAIL'}`);
    // The old second item should now be first.
    const detailRowsAfter = await basketPage.getVisibleItemRows();
    const shifted = detailRowsBefore.length > 1 && detailRowsAfter[0] === detailRowsBefore[1];
    console.log(`First symbol removed - old 2nd item is now 1st: ${shifted ? 'PASS' : 'FAIL'}`);
}

// Clones the first symbol until the basket holds the maximum of 50 symbols (header "50/50 items"),
// then taps global search (to add a 51st) and checks a limit toast is shown, global search does
// not open, and the count stays at 50. Starts and ends on the basket
// detail screen. Returns the next TC number.
const BASKET_MAX_ITEMS = 50;
// Shown on tapping global search with 50 symbols in the basket (verified live).
const MAX_SYMBOLS_TOAST = 'You can only add upto 50 symbols';
async function cloneToLimitChecks(basketPage, tc) {
    console.log(`TC ${tc}: Cloning the first symbol until the basket has ${BASKET_MAX_ITEMS} symbols...`);
    const { itemCount: header } = await basketPage.readBasketHeader();
    const maxShown = header && Number((header.match(/\/(\d+)/) || [])[1]);
    console.log(`Header max: ${maxShown} (expected ${BASKET_MAX_ITEMS}) ${maxShown === BASKET_MAX_ITEMS ? 'PASS' : 'FAIL'}`);

    let count = await basketPage.getItemCount();
    if (count === null) {
        console.error('FAIL: could not read the item count before cloning');
        return tc + 2;
    }
    const startCount = count;
    let stalls = 0;
    // Bounded: one attempt per missing item plus a little slack for a clone that didn't register.
    for (let attempt = 0; count < BASKET_MAX_ITEMS && attempt < BASKET_MAX_ITEMS - startCount + 5; attempt++) {
        await basketPage.tapFirstBasketItem();
        await basketPage.clickClone();
        const toast = await basketPage.waitForToast('Symbol cloned successfully', { timeout: 3000 });
        await basketPage.pause(500);
        const next = await basketPage.getItemCount();
        console.log(`Clone ${attempt + 1}: count ${count} -> ${next}, toast ${toast}`);
        if (next === count + 1) {
            stalls = 0;
        } else if (++stalls >= 3) {
            console.error(`FAIL: cloning stopped increasing the count at ${next}`);
            break;
        }
        if (next !== null) count = next;
    }
    const reached = count === BASKET_MAX_ITEMS;
    console.log(`Item count ${startCount} -> ${count} (expected ${BASKET_MAX_ITEMS}) ${reached ? 'PASS' : 'FAIL'}`);
    if (!reached) console.error(`FAIL: basket has ${count} symbols after cloning, expected ${BASKET_MAX_ITEMS}`);
    tc++;

    // At 50 symbols, try to add a 51st through global search (not Clone): the app should refuse
    // with a toast and stay on the basket.
    console.log(`TC ${tc}: Attempting to add a ${BASKET_MAX_ITEMS + 1}st symbol via global search - expecting "${MAX_SYMBOLS_TOAST}"...`);
    const { messages, stayedOnBasket } = await basketPage.tapGlobalSearchCapturingMessages();
    console.log(`Message(s) shown: ${messages.join(' | ') || '(none)'}`);
    const toastShown = messages.some(m => m.includes(MAX_SYMBOLS_TOAST));
    console.log(`"${MAX_SYMBOLS_TOAST}" toast shown: ${toastShown} ${toastShown ? 'PASS' : 'FAIL'}`);
    if (!toastShown) {
        console.error(`FAIL: "${MAX_SYMBOLS_TOAST}" not shown when tapping global search on a full basket`);
        await basketPage.dumpPage('basket_symbols_limit_no_message');
    }
    console.log(`Stayed on the basket (global search not opened): ${stayedOnBasket} ${stayedOnBasket ? 'PASS' : 'FAIL'}`);
    if (!stayedOnBasket) {
        console.error('FAIL: global search opened on a full basket');
        await basketPage.backToBasketDetail();
    }
    const countAfterLimit = await basketPage.getItemCount();
    const capped = countAfterLimit === BASKET_MAX_ITEMS;
    console.log(`Item count after the ${BASKET_MAX_ITEMS + 1}st-symbol attempt: ${countAfterLimit} (expected ${BASKET_MAX_ITEMS}) ${capped ? 'PASS' : 'FAIL'}`);
    if (!capped) console.error(`FAIL: basket went past the ${BASKET_MAX_ITEMS}-symbol limit (${countAfterLimit})`);
    return tc + 1;
}

// Edit -> DELETE BASKET -> "Are you sure, you want to Delete the basket?": No keeps the basket,
// Yes deletes it and shows "Basket deleted successfully". Starts on the basket detail screen.
async function deleteBasketChecks(basketPage, tc) {
    console.log(`TC ${tc}: Delete basket, answering No...`);
    const name = await basketPage.getOpenBasketName();
    await basketPage.clickEditBasket();
    if (await basketPage.clickDeleteBasket()) await basketPage.answerSaveChanges('No');
    const stillEditing = await basketPage.isElementVisible(basketPage.editBasketTitle, 3000);
    console.log(`Still on Edit Basket after No (basket not deleted): ${stillEditing ? 'PASS' : 'FAIL'}`);
    await basketPage.exitEditBasketWithoutSaving();
    const nameAfterNo = await basketPage.getOpenBasketName();
    const kept = nameAfterNo === name;
    console.log(`Basket "${name}" still open after No: ${kept ? 'PASS' : 'FAIL'}`);
    tc++;

    console.log(`TC ${tc}: Delete basket, answering Yes...`);
    await basketPage.clickEditBasket();
    if (await basketPage.clickDeleteBasket()) {
        await basketPage.click('//*[@content-desc="Yes" or @text="Yes"]');
        console.log('Clicked Yes on the delete popup');
    }
    const deletedToast = await basketPage.waitForToast('Basket deleted successfully', { timeout: 3000 });
    console.log(`"Basket deleted successfully" toast shown: ${deletedToast} ${deletedToast ? 'PASS' : 'FAIL'}`);
}

run();
