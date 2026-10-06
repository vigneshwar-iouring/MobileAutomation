const DriverManager = require('../../driver/DriverManager');
const WatchlistIndexPage = require('../../pages/WatchlistIndexPage');
const { createLogger, getFailedTCs } = require('../../utils/logger');

const { logFile, entries } = createLogger('WatchlistIndex');
console.log(`Logging this run to: ${logFile}`);

async function run() {
    const driver = await DriverManager.getDriver();
    try {
        const watchlistPage = new WatchlistIndexPage(driver);

        console.log('TC 1: Verifying current screen is Watchlist...');
        await watchlistPage.navigateToWatchlist();

        console.log('\nTC 2: Clicking the first index observed at the top...');
        await watchlistPage.clickFirstIndex();
        await driver.pause(1500);
        await watchlistPage.swipeUpQuoteScreen();
        await driver.pause(1000);

        console.log('\nTC 3: Printing the details observed in the Quotes screen...');
        await watchlistPage.printQuoteDetails();

        console.log('\nTC 4: Clicking View Chart and verifying the chart is opened...');
        await watchlistPage.clickViewChart();
        const chartOpened = await watchlistPage.isChartOpened(15000);
        console.log(`Chart opened: ${chartOpened ? 'PASS' : 'FAIL'}`);
        await watchlistPage.goBackToQuotes();

        console.log('\nTC 5: Clicking Alerts...');
        await watchlistPage.clickAddAlert();
        await driver.pause(1000);
        await watchlistPage.goBackToQuotes();

        // Not every index has a listed Option Chain (e.g. sector/thematic indices with no options
        // trading) - same optional-tab situation as the Futures tab below, so TCs 6-10 (all of
        // which depend on it) are skipped rather than failed when it's absent.
        const hasOptionChain = await watchlistPage.isOptionChainShown();

        console.log('\nTC 6: Clicking Option Chain...');
        if (hasOptionChain) {
            await watchlistPage.clickOptionChain();
            await driver.pause(1000);

            console.log('\nTC 7: Searching "tata" in Option Chain search and verifying results...');
            await watchlistPage.clickOptionChainSearch();
            await watchlistPage.searchOptionChainSymbol('tata');
            const searchResults = await watchlistPage.getOptionChainSearchResults();
            console.log(`Search results: ${searchResults.join(', ')}`);
            const allMatchTata = searchResults.length > 0 && searchResults.every(name => name.toUpperCase().includes('TATA'));
            console.log(`"tata" search check: ${allMatchTata ? 'PASS (all results contain TATA)' : 'FAIL'}`);

            for (const tab of ['STOCK', 'F&O', 'COM', 'CDS']) {
                await watchlistPage.clickOptionChainFilterTab(tab);
                await driver.pause(500);
            }

            await watchlistPage.clickOptionChainCancel();
            await driver.pause(500);

            await watchlistPage.goBackToQuotes();
        } else {
            console.log('Option Chain not shown for this index - skipping TC 6/7');
        }

        console.log('\nTC 8: Clicking the option rows above and below the live price marker...');
        if (hasOptionChain) {
            await watchlistPage.clickOptionChain();
            await driver.pause(1000);

            const ascendingNeighbors = await watchlistPage.getMarkerNeighborStrikes();
            console.log(`Strike rows around live price marker: above=${ascendingNeighbors.above}, below=${ascendingNeighbors.below}`);
            const isAscending = ascendingNeighbors.above < ascendingNeighbors.below;
            console.log(`Ascending order check: ${isAscending ? 'PASS' : 'FAIL'}`);

            await watchlistPage.clickStrikePriceHeader();
            await driver.pause(1000);

            const descendingNeighbors = await watchlistPage.getMarkerNeighborStrikes();
            console.log(`Strike rows around live price marker after sort: above=${descendingNeighbors.above}, below=${descendingNeighbors.below}`);
            const isDescending = descendingNeighbors.above > descendingNeighbors.below;
            console.log(`Descending order check: ${isDescending ? 'PASS' : 'FAIL'}`);

            await watchlistPage.clickStrikePriceHeader();
            await driver.pause(1000);

            await watchlistPage.clickOptionRow('above');
            await driver.pause(1000);
            await watchlistPage.swipeUpQuoteScreen();
            await driver.pause(1000);
            await watchlistPage.goBackToQuotes();

            await watchlistPage.clickOptionRow('below');
            await driver.pause(1000);
            await watchlistPage.swipeUpQuoteScreen();
            await driver.pause(1000);
            await watchlistPage.goBackToQuotes();

            await watchlistPage.goBackToQuotes();
        } else {
            console.log('Option Chain not shown for this index - skipping TC 8');
        }

        console.log('\nTC 9: Selecting the next expiry date, then returning to the previous one...');
        if (hasOptionChain) {
            await watchlistPage.clickOptionChain();
            await driver.pause(1000);

            const expiryDatesValid = await watchlistPage.verifyExpiryDatesAreTodayOrFuture();
            console.log(`Expiry dates are today or future: ${expiryDatesValid ? 'PASS' : 'FAIL'}`);

            await watchlistPage.clickExpiryDateTab(1);
            await driver.pause(1000);
            await watchlistPage.clickExpiryDateTab(0);
            await driver.pause(1000);

            await watchlistPage.goBackToQuotes();
        } else {
            console.log('Option Chain not shown for this index - skipping TC 9');
        }

        console.log('\nTC 10: Verifying LTP is the default tab, then checking OI and Greeks scroll to bottom and top...');
        if (hasOptionChain) {
            await watchlistPage.clickOptionChain();
            await driver.pause(600);

            const onLtpByDefault = await watchlistPage.isOptionChainOnLtpTab();
            console.log(`Option Chain launches on LTP tab by default: ${onLtpByDefault ? 'PASS' : 'FAIL'}`);

            await watchlistPage.clickOptionChainTab('OI');
            await driver.pause(250);
            await watchlistPage.scrollOptionChainToBottom();
            await watchlistPage.scrollOptionChainToTop();

            await watchlistPage.clickOptionChainTab('Greeks');
            await driver.pause(250);
            await watchlistPage.scrollOptionChainToBottom();
            await watchlistPage.scrollOptionChainToTop();

            await watchlistPage.goBackToQuotes();
        } else {
            console.log('Option Chain not shown for this index - skipping TC 10');
        }

        console.log('\nTC 11: Clicking Futures tab, verifying expiry dates, and stepping through F&O contracts...');
        // Not every index has a listed futures contract - the Futures tab simply doesn't exist for
        // those, so this TC is skipped rather than failed when it's absent.
        if (await watchlistPage.isFuturesTabShown()) {
            await watchlistPage.clickFuturesTab();
            await driver.pause(1000);

            const futuresDatesValid = await watchlistPage.verifyFuturesExpiryDatesAreTodayOrFuture();
            console.log(`Futures expiry dates are today or future: ${futuresDatesValid ? 'PASS' : 'FAIL'}`);

            const futuresContracts = await watchlistPage.getFuturesContracts();
            console.log(`Found ${futuresContracts.length} F&O contracts`);

            for (let i = 0; i < Math.min(2, futuresContracts.length); i++) {
                console.log(`\nProcessing F&O contract #${i + 1}...`);
                const contracts = await watchlistPage.getFuturesContracts();
                watchlistPage.printFutureContractFields(contracts[i]);

                await watchlistPage.clickFuturesContract(i);
                await driver.pause(1200);
                await watchlistPage.swipeUpQuoteScreen();
                await driver.pause(800);
                await watchlistPage.scrollQuoteScreenToBottom();
                await watchlistPage.goBackToQuotes();
            }
        } else {
            console.log('Futures tab not shown for this index - skipping TC 11');
        }

        console.log('\nTC 12: Clicking Technicals tab and cycling SMA/EMA across durations...');
        await watchlistPage.clickTechnicalsTab();
        await driver.pause(1000);

        const processDuration = async (label) => {
            // "Weekly"/"Monthly" drop the Moving Average grid entirely - only Technical
            // Indicators remains - so there's no SMA/EMA toggle to click on those two durations.
            let smaOk = true;
            let emaOk = true;
            if (await watchlistPage.isMovingAverageShown()) {
                await watchlistPage.clickSMA();
                await driver.pause(600);
                smaOk = await watchlistPage.verifyNoZeroValueFields(`${label} - SMA`);

                await watchlistPage.clickEMA();
                await driver.pause(600);
                emaOk = await watchlistPage.verifyNoZeroValueFields(`${label} - EMA`);
            } else {
                console.log(`  [${label}] No Moving Average / SMA-EMA section on this duration - skipping`);
            }

            await watchlistPage.scrollQuoteScreenToBottom();
            const bottomOk = await watchlistPage.verifyNoZeroValueFields(`${label} - bottom`);

            await watchlistPage.scrollQuoteScreenToTop();

            const allNoZero = smaOk && emaOk && bottomOk;
            console.log(`No 0.00 values observed for ${label}: ${allNoZero ? 'PASS' : 'FAIL'}`);
        };

        // Duration tabs beyond what's currently on-screen (e.g. "1 Day", "1 Week") don't exist in
        // the tree until scrolled into view - and a manual swipe on this row bubbles up to the
        // outer tab pager instead (see getDurationTabs) - but clicking through them in order
        // causes the app to lazily reveal more, so re-fetching the tab list after each click picks
        // up whatever's newly appeared. Loops until a fresh fetch has nothing left unprocessed.
        const processedLabels = new Set();
        for (let guard = 0; guard < 10; guard++) {
            const tabs = await watchlistPage.getDurationTabs();
            const nextTab = tabs.find(t => !processedLabels.has(t.desc.replace(/\n/g, ' ')));
            if (!nextTab) break;

            const label = nextTab.desc.replace(/\n/g, ' ');
            if (processedLabels.size > 0) {
                console.log(`\nClicking the next time duration and repeating the same flow...`);
                await watchlistPage.tapNode(nextTab);
                console.log(`Clicked duration tab: "${label}"`);
                await driver.pause(800);
            }

            await processDuration(label);
            processedLabels.add(label);
        }

        console.log('\nTC 13: Clicking Constituents tab, selecting the first symbol, and scrolling once...');
        await watchlistPage.clickConstituentsTab();
        await driver.pause(1000);

        const constituentsCountLabel = await watchlistPage.getConstituentsCountLabel();
        console.log(`Constituents count label: ${constituentsCountLabel}`);

        const constituents = await watchlistPage.getConstituentStocks();
        console.log(`Found ${constituents.length} constituent stocks`);

        await watchlistPage.clickConstituentStock(0);
        await driver.pause(1200);
        await watchlistPage.swipeUpQuoteScreen();
        await driver.pause(800);

        await watchlistPage.goBackToQuotes();
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
