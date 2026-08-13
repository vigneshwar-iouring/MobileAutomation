const DriverManager = require('../../driver/DriverManager');
const { MutualFundsPage } = require('../../pages/MutualFundsPage');
const { createLogger } = require('../../utils/logger');

const { logFile } = createLogger('MutualFundsExplore');
console.log(`Logging this run to: ${logFile}`);

async function run() {
    const driver = await DriverManager.getDriver();
    try {
        const mutualFundsPage = new MutualFundsPage(driver);

        console.log('Step 1: Opening Mutual Funds (bottom navigation)...');
        await mutualFundsPage.openMutualFunds();

        console.log('\nStep 2: Clicking Explore tab...');
        await mutualFundsPage.clickExploreTab();
        await driver.pause(1000);

        console.log('\nStep 3: Scrolling through Category Solutions and counting headers...');
        await mutualFundsPage.countCategorySolutionsHeaders();

        console.log('\nStep 4: Scrolling back to top and expanding the Equity category...');
        await mutualFundsPage.scrollExploreToTop();
        const categoryCount = await mutualFundsPage.getCategoryFundCount('Equity');
        console.log(`Equity category card shows: ${categoryCount} funds`);

        await mutualFundsPage.clickCategoryCard('Equity');
        await driver.pause(1000);
        const tags = await mutualFundsPage.getCategoryTags();
        console.log(`Equity tags (in order): ${tags.join(', ')}`);

        console.log('\nStep 5: Selecting "All" and verifying the fund count matches the category card...');
        await mutualFundsPage.clickCategoryTag('All');
        await driver.pause(1500);
        const allResultsCount = await mutualFundsPage.getFilteredResultsCount();
        console.log(`"All" tag results: ${allResultsCount}`);
        console.log(`Count check: category card (${categoryCount}) vs "All" results (${allResultsCount}) - ${categoryCount !== null && categoryCount === allResultsCount ? 'PASS (match)' : 'FAIL (mismatch)'}`);

        console.log('\nStep 6: Searching "SBI" in the local search bar and verifying SBI funds are listed...');
        const searchQuery = 'SBI';
        await mutualFundsPage.searchLocalFundList(searchQuery);
        const searchResultNames = await mutualFundsPage.getSearchResultNames();
        console.log(`Results after searching "${searchQuery}": ${searchResultNames.join(', ')}`);
        const allMatchSbi = searchResultNames.length > 0 && searchResultNames.every(name => name.toUpperCase().includes(searchQuery));
        console.log(`SBI search check: ${allMatchSbi ? 'PASS (all results are SBI funds)' : 'FAIL'}`);

        console.log('\nStep 6b: Clearing the search bar by backspacing...');
        await mutualFundsPage.clearLocalSearch(searchQuery.length);
        const clearedResultsCount = await mutualFundsPage.getFilteredResultsCount();
        console.log(`Results after clearing search: ${clearedResultsCount}`);

        console.log('\nStep 7: Clicking + and selecting the next tag observed after "All"...');
        await mutualFundsPage.clickAddFilterButton();
        await driver.pause(800);
        const nextTag = tags[1];
        await mutualFundsPage.clickCategoryTag(nextTag);
        await driver.pause(1500);
        const nextTagResultsCount = await mutualFundsPage.getFilteredResultsCount();
        console.log(`"${nextTag}" tag results: ${nextTagResultsCount}`);

        console.log('\nStep 8: Selecting 3Y and 5Y return periods...');
        await mutualFundsPage.changeSectionReturnPeriod('Equity', '3 Years Return');
        await mutualFundsPage.changeSectionReturnPeriod('Equity', '5 Years Return');

        await mutualFundsPage.goBackFromFundList();
        await mutualFundsPage.clickCategoryCard('Equity');
    } catch (err) {
        console.error('Test failed:', err.message);
        console.error(err.stack);
    } finally {
        await DriverManager.closeDriver();
    }
}

run();