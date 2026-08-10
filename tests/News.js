const DriverManager = require('../driver/DriverManager');
const { NewsPage } = require('../pages/NewsPage');
const { createLogger } = require('../utils/logger');

const { logFile } = createLogger('News');
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

        console.log('Step 1: Clicking hamburger menu...');
        await newsPage.clickHamburgerMenu();

        console.log('Step 2: Clicking News...');
        await newsPage.clickNewsOption();

        console.log('Step 3: Waiting up to 10s for the News screen to load...');
        const loaded = await newsPage.waitForLoaded(10000);
        if (!loaded) {
            throw new Error('News screen did not load within 10 seconds');
        }

        // Tabs are selected one by one (in fixed left-to-right order) rather than by swiping the
        // tab strip - clicking each tab is what actually scrolls later tabs into view.
        for (const tabName of newsPage.tabNames) {
            console.log(`\nStep 4: Selecting "${tabName}" tab...`);
            await newsPage.clickTab(tabName);
            await driver.pause(1000);

            console.log('Step 5: Scrolling down 2 times...');
            await newsPage.scrollDown();
            await newsPage.scrollDown();

            console.log(`Step 6: Checking latest news date/time and tag consistency for "${tabName}"...`);
            const summary = await newsPage.getFeedSummary(tabName);
            results.push({ tab: tabName, ...summary });
        }

        printSummary(results);

        console.log('\nStep 7: Closing News screen...');
        await newsPage.clickClose();
    } catch (err) {
        console.error('Test failed:', err.message);
        console.error(err.stack);
    } finally {
        await DriverManager.closeDriver();
    }
}

run();
