const DriverManager = require('../driver/DriverManager');
const { NewsPage } = require('../pages/NewsPage');
const { createLogger, getFailedTCs } = require('../utils/logger');

const { logFile, entries } = createLogger('News');
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
        const dateStatus = r.isPastOrNow ? 'PASS' : 'FAIL (in the future)';
        const tagStatus = r.tab === 'All'
            ? `tags seen: ${r.distinctTags.join(', ') || 'none'}`
            : (r.mismatches.length ? `FAIL - ${r.mismatches.length} mismatched tag(s): ${[...new Set(r.mismatches.map(e => e.tag))].join(', ')}` : 'PASS - all tags match');
        console.log(`  ${r.tab}: ${r.raw} ${r.latestTime || ''} - ${dateStatus} | ${tagStatus}`);
    }
}

async function run() {
    const driver = await DriverManager.getDriver();
    try {
        const newsPage = new NewsPage(driver);
        const results = [];

        console.log('TC 1: Clicking hamburger menu...');
        await newsPage.clickHamburgerMenu();

        console.log('TC 2: Clicking News...');
        await newsPage.clickNewsOption();

        console.log('TC 3: Waiting up to 10s for the News screen to load...');
        const loaded = await newsPage.waitForLoaded(10000);
        if (!loaded) {
            throw new Error('News screen did not load within 10 seconds');
        }

        const emptyResult = { raw: null, date: null, latestTime: null, isPastOrNow: null, entryCount: 0, distinctTags: [], mismatches: [] };

        // Tabs are selected one by one (in fixed left-to-right order) rather than by swiping the
        // tab strip - clicking each tab is what actually scrolls later tabs into view.
        for (const tabName of newsPage.tabNames) {
            console.log(`\nTC 4: Selecting "${tabName}" tab...`);
            await newsPage.clickTab(tabName);
            await driver.pause(1000);

            // Check for data before doing any scrolling/search - skips that work entirely on an
            // empty tab instead of scrolling a feed that was never going to have anything to read.
            if (await newsPage.isNoDataFound()) {
                console.log(`No Data Found for "${tabName}" - skipping scroll and search`);
                results.push({ tab: tabName, ...emptyResult });
                continue;
            }

            console.log('TC 5: Scrolling down 2 times, then up 2 time...');
            await newsPage.scrollDown();
            await newsPage.scrollDown();
            await newsPage.scrollUp();
            await newsPage.scrollUp();

            if (tabName === 'All') {
                console.log('TC 5b: Opening search bar and searching "Manufacturing"...');
                await newsPage.clickSearchBar();
                await newsPage.searchNews('Manufacturing');
                await driver.pause(3000);
                await newsPage.verifyNewsSearchResults('Manufacturing');
                await newsPage.closeSearch();
                await driver.pause(1000);
            }

            console.log(`TC 6: Checking latest news date/time and tag consistency for "${tabName}"...`);
            const summary = await newsPage.getFeedSummary(tabName);
            results.push({ tab: tabName, ...summary });
        }

        printSummary(results);

        console.log('\nTC 7: Closing News screen...');
        await newsPage.clickClose();
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
