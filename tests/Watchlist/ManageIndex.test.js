const DriverManager = require('../../driver/DriverManager');
const WatchlistIndexPage = require('../../pages/WatchlistIndexPage');
const { createLogger, getFailedTCs } = require('../../utils/logger');

const { logFile, entries } = createLogger('ManageIndex');
console.log(`Logging this run to: ${logFile}`);

async function run() {
    const driver = await DriverManager.getDriver();
    try {
        const watchlistPage = new WatchlistIndexPage(driver);

        console.log('TC 1: Verifying current screen is Watchlist...');
        await watchlistPage.navigateToWatchlist();

        console.log('\nTC 2: Scrolling the indices strip right until "Add Indices" is visible...');
        await watchlistPage.scrollIndicesToAddButton();

        console.log('\nTC 3: Clicking "Add Indices"...');
        await watchlistPage.clickAddIndices();
        await driver.pause(1000);

        const originalIndices = await watchlistPage.getAddedIndexNames();
        console.log('Original added indices:', originalIndices);

        console.log('\nTC 4: Clicking the first index observed in the list...');
        await watchlistPage.clickFirstIndex();
        await driver.pause(1000);
        await driver.back();
        await driver.pause(800);

        console.log('\nTC 5: Clicking whichever of NSE/BSE is not currently selected...');
        await watchlistPage.clickOtherExchangeFilter();
        await driver.pause(1000);

        console.log('\nTC 6: Clicking the first index observed in the list...');
        await watchlistPage.clickFirstIndex();
        await driver.pause(1000);
        await driver.back();
        await driver.pause(800);

        console.log('\nTC 7: Scrolling to the end of the Indices list');
        await watchlistPage.scrollAllIndicesToBottom();
        await watchlistPage.scrollAllIndicesToTop();

        // Shared by both passes below: enters edit mode, removes down to the minimum of 2
        // (verifying a toast per removal, then the floor-limit toast), then adds four different
        // ones back (no toast expected there - confirmed live that adding shows no snackbar at
        // all, unlike removal's "Undo" one).
        const removeThenAddFlow = async () => {
            await watchlistPage.clickEditIndices();
            await driver.pause(800);

            let removable = await watchlistPage.getRemovableIndices();
            console.log(`Found ${removable.length} removable indices: ${removable.map(n => n.desc.split('\n')[0]).join(', ')}`);

            let removalCount = 0;
            while (removable.length > 2) {
                removalCount++;
                const target = removable[removable.length - 1];
                const name = await watchlistPage.removeIndex(target);
                await driver.pause(500);

                const toastOk = await watchlistPage.isIndexRemovedToastShown(name);
                console.log(`"${name} Removed" toast shown: ${toastOk ? 'PASS' : 'FAIL'}`);

                // On the 3rd removal specifically: click "Undo" on its toast, verify the index
                // comes back, then remove it again (for real this time) before continuing.
                if (removalCount === 4) {
                    console.log(`Clicking "Undo" on the 3rd removal ("${name}")...`);
                    await watchlistPage.clickUndoOnToast(name);
                    await driver.pause(800);

                    const afterUndo = await watchlistPage.getRemovableIndices();
                    const restored = afterUndo.some(n => n.desc.startsWith(`${name}\n`));
                    console.log(`"${name}" restored after Undo: ${restored ? 'PASS' : 'FAIL'}`);

                    console.log(`Clicking remove again for "${name}"...`);
                    const targetAgain = afterUndo.find(n => n.desc.startsWith(`${name}\n`)) || afterUndo[afterUndo.length - 1];
                    await watchlistPage.removeIndex(targetAgain);
                    await driver.pause(500);

                    const toastOkAgain = await watchlistPage.isIndexRemovedToastShown(name);
                    console.log(`"${name} Removed" toast shown (after re-removing): ${toastOkAgain ? 'PASS' : 'FAIL'}`);
                }

                removable = await watchlistPage.getRemovableIndices();
                console.log(`Now ${removable.length} removable: ${removable.map(n => n.desc.split('\n')[0]).join(', ')}`);
            }

            const floorTarget = removable[removable.length - 1];
            await watchlistPage.removeIndex(floorTarget);
            await driver.pause(1000);

            const minToastOk = await watchlistPage.isMinimumIndicesToastShown();
            console.log(`"Minimum 2 Indices needed" toast shown: ${minToastOk ? 'PASS' : 'FAIL'}`);

            const finalRemovable = await watchlistPage.getRemovableIndices();
            console.log(`Still ${finalRemovable.length} removable after the floor attempt (should remain 2)`);

            for (let i = 0; i < 4; i++) {
                const addable = await watchlistPage.getAddableIndices();
                const target = addable[0];
                const name = await watchlistPage.addIndex(target);
                await driver.pause(1000);

                const toastOk = await watchlistPage.isIndexAddedToastShown(name);
                console.log(`"${name} Added" - toast: ${toastOk ? 'shown (unexpected)' : 'not shown (expected - adding has no toast)'}`);
            }
        };

        console.log('\nTC 8: Removing down to 2 and adding 4 different ones back...');
        await removeThenAddFlow();

        console.log('\nTC 9: Navigating back, clicking DISCARD, and verifying changes are reverted...');
        await driver.back();
        await driver.pause(800);
        await watchlistPage.clickDiscardChanges();
        await driver.pause(1000);

        const afterDiscard = await watchlistPage.getAddedIndexNames();
        console.log('Indices after discard:', afterDiscard);
        const reverted = JSON.stringify([...originalIndices].sort()) === JSON.stringify([...afterDiscard].sort());
        console.log(`Changes correctly reverted: ${reverted ? 'PASS' : 'FAIL'}`);

        console.log('\nTC 10: Repeating the same remove/add flow, this time saving via CHANGE...');
        await removeThenAddFlow();

        console.log('\nTC 11: Navigating back and clicking CHANGE to save...');
        await driver.back();
        await driver.pause(800);
        await watchlistPage.clickSaveChanges();
        await driver.pause(1000);

        const afterSave = await watchlistPage.getAddedIndexNames();
        console.log('Indices after save:', afterSave);

        console.log('\nTC 12: Re-entering edit mode and attempting to add a 7th index, verifying the ceiling toast...');
        await watchlistPage.clickEditIndices();
        await driver.pause(800);

        const sixAdded = await watchlistPage.getRemovableIndices();
        console.log(`Currently ${sixAdded.length} added: ${sixAdded.map(n => n.desc.split('\n')[0]).join(', ')}`);

        const seventhTarget = (await watchlistPage.getAddableIndices())[0];
        await watchlistPage.addIndex(seventhTarget);
        await driver.pause(1000);

        const maxToastOk = await watchlistPage.isMaximumIndicesToastShown();
        console.log(`"Max 6 indices can be added" toast shown: ${maxToastOk ? 'PASS' : 'FAIL'}`);

        const stillSixAdded = await watchlistPage.getRemovableIndices();
        console.log(`Still ${stillSixAdded.length} added after the 7th attempt (should remain 6)`);

        await driver.back();
        await driver.pause(800);
        if (await watchlistPage.isElementVisible('android=new UiSelector().description("DISCARD")', 2000)) {
            await watchlistPage.clickDiscardChanges();
            await driver.pause(800);
        }

        // Adjusts the real added-index count to exactly targetCount via edit mode, then saves -
        // used below to re-render the indices strip with a different number of cards each time,
        // since that's what actually changes the merged "Add Indices" node's own shape/bounds.
        const setIndexCount = async (targetCount) => {
            await watchlistPage.clickEditIndices();
            await driver.pause(800);

            let removable = await watchlistPage.getRemovableIndices();
            while (removable.length > targetCount) {
                await watchlistPage.removeIndex(removable[removable.length - 1]);
                await driver.pause(500);
                removable = await watchlistPage.getRemovableIndices();
            }
            while (removable.length < targetCount) {
                const addable = await watchlistPage.getAddableIndices();
                await watchlistPage.addIndex(addable[0]);
                await driver.pause(800);
                removable = await watchlistPage.getRemovableIndices();
            }

            await driver.back();
            await driver.pause(800);
            await watchlistPage.clickSaveChanges();
            await driver.pause(1000);
            await watchlistPage.navigateToWatchlist();
        };

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
