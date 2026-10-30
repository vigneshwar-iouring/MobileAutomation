const DriverManager = require('../../driver/DriverManager');
const { MutualFundsPage } = require('../../pages/MutualFundsPage');
const { createLogger, getFailedTCs } = require('../../utils/logger');

const { logFile, entries } = createLogger('MutualFundsExplore');
console.log(`Logging this run to: ${logFile}`);

async function run() {
    const driver = await DriverManager.getDriver();
    try {
        const mutualFundsPage = new MutualFundsPage(driver);

        console.log('TC 21: Opening Mutual Funds (bottom navigation)...');
        await mutualFundsPage.openMutualFunds();

        console.log('\nTC 22: Clicking Explore tab...');
        await mutualFundsPage.clickExploreTab();
        await driver.pause(1000);

        console.log('\nTC 23: Scrolling through Category Solutions and counting headers...');
        await mutualFundsPage.countCategorySolutionsHeaders();

        console.log('\nTC 24: Scrolling back to top and expanding the Equity category...');
        await mutualFundsPage.scrollExploreToTop();
        const categoryCount = await mutualFundsPage.getCategoryFundCount('Equity');
        console.log(`Equity category card shows: ${categoryCount} funds`);

        await mutualFundsPage.clickCategoryCard('Equity');
        await driver.pause(1000);
        await mutualFundsPage.scrollToCategoryTags();
        const tags = await mutualFundsPage.getCategoryTags();
        console.log(`Equity tags (in order): ${tags.join(', ')}`);

        console.log('\nTC 25: Selecting "All" and verifying the fund count matches the category card...');
        await mutualFundsPage.clickCategoryTag('All');
        await driver.pause(1500);
        const allResultsCount = await mutualFundsPage.getFilteredResultsCount();
        console.log(`"All" tag results: ${allResultsCount}`);
        console.log(`Count check: category card (${categoryCount}) vs "All" results (${allResultsCount}) - ${categoryCount !== null && categoryCount === allResultsCount ? 'PASS (match)' : 'FAIL (mismatch)'}`);

        console.log('\nTC 26: Clicking the first fund in Equity - All...');
        const equityFundName = await mutualFundsPage.clickFirstFund();
        console.log(`First fund: ${equityFundName}`);
        await driver.pause(1500);

        console.log('\nTC 27: Opening One Time order pad, clearing the amount, closing the keypad, and verifying SUBMIT is disabled...');
        await mutualFundsPage.clickOneTimeButton();
        await mutualFundsPage.clearOrderPadAmount();
        await driver.hideKeyboard().catch(() => {});
        const oneTimeSubmitDisabled = await mutualFundsPage.isSubmitButtonDisabled();
        console.log(`One Time - SUBMIT disabled after clearing amount: ${oneTimeSubmitDisabled ? 'PASS' : 'FAIL'}`);
        await mutualFundsPage.goBackFromOrderPad();

        console.log('\nTC 28: Opening Start SIP order pad, clearing the amount, closing the keypad, and verifying SUBMIT is disabled...');
        const sipOpened = await mutualFundsPage.clickStartSipButtonIfApplicable();
        if (sipOpened) {
            await mutualFundsPage.clearOrderPadAmount();
            await driver.hideKeyboard().catch(() => {});
            const sipSubmitDisabled = await mutualFundsPage.isSubmitButtonDisabled();
            console.log(`Start SIP - SUBMIT disabled after clearing amount: ${sipSubmitDisabled ? 'PASS' : 'FAIL'}`);
            await mutualFundsPage.goBackFromOrderPad();
        } else {
            console.log('Start SIP not applicable for this fund - skipping');
        }

        console.log('\nTC 29: Navigating back to the Equity fund list...');
        await mutualFundsPage.goBackFromFundDetail();

        console.log('\nTC 30: Searching "SBI" in the local search bar and verifying SBI funds are listed...');
        const searchQuery = 'SBI';
        await mutualFundsPage.searchLocalFundList(searchQuery);
        const searchResultNames = await mutualFundsPage.getSearchResultNames();
        console.log(`Results after searching "${searchQuery}": ${searchResultNames.join(', ')}`);
        const allMatchSbi = searchResultNames.length > 0 && searchResultNames.every(name => name.toUpperCase().includes(searchQuery));
        console.log(`SBI search check: ${allMatchSbi ? 'PASS (all results are SBI funds)' : 'FAIL'}`);

        console.log('\nTC 30b: Clearing the search bar by backspacing...');
        await mutualFundsPage.clearLocalSearch(searchQuery.length);
        const clearedResultsCount = await mutualFundsPage.getFilteredResultsCount();
        console.log(`Results after clearing search: ${clearedResultsCount}`);

        console.log('\nTC 31: Clicking + and selecting the next tag observed after "All"...');
        await mutualFundsPage.clickAddFilterButton();
        await driver.pause(800);
        const nextTag = tags[1];
        await mutualFundsPage.clickCategoryTag(nextTag);
        await driver.pause(1500);
        const nextTagResultsCount = await mutualFundsPage.getFilteredResultsCount();
        console.log(`"${nextTag}" tag results: ${nextTagResultsCount}`);

        console.log('\nTC 32: Selecting 3Y and 5Y return periods...');
        await mutualFundsPage.changeSectionReturnPeriod('Equity', '3 Years Return');
        await mutualFundsPage.changeSectionReturnPeriod('Equity', '5 Years Return');

        await mutualFundsPage.goBackFromFundList();
        await mutualFundsPage.clickCategoryCard('Equity');

        console.log('\nTC 33: Repeating for each remaining category below Equity (All -> search "SBI" -> verify -> clear -> + -> next tag, excluding "Index Fund")...');
        const remainingCategories = ['Debt', 'Hybrid', 'Index Fund', 'Funds of Funds', 'Solution Oriented'];

        for (const category of remainingCategories) {
            console.log(`\n--- Category: ${category} ---`);
            await mutualFundsPage.scrollToCategoryCard(category);
            await mutualFundsPage.clickCategoryCard(category);
            await driver.pause(1000);
            await mutualFundsPage.scrollToCategoryTags();
            const categoryTags = await mutualFundsPage.getCategoryTags();
            console.log(`${category} tags (in order): ${categoryTags.join(', ')}`);

            // Not every category has an "All" tag - "Index Fund" expands to a single tag chip
            // named "Index Fund" itself instead, so the first tag found is clicked generically.
            const firstTag = categoryTags[0];
            if (!firstTag) {
                console.log(`${category} - no tags found - skipping to next category`);
                await mutualFundsPage.scrollToCategoryCard(category);
                await mutualFundsPage.clickCategoryCard(category);
                await mutualFundsPage.scrollExploreDown();
                continue;
            }
            await mutualFundsPage.clickCategoryTag(firstTag);
            await driver.pause(1500);

            await mutualFundsPage.searchLocalFundList(searchQuery);
            const results = await mutualFundsPage.getSearchResultNames();
            console.log(`Results after searching "${searchQuery}": ${results.join(', ')}`);
            const allMatch = results.length > 0 && results.every(name => name.toUpperCase().includes(searchQuery));
            console.log(`${category} - SBI search check: ${allMatch ? 'PASS (all results are SBI funds)' : 'FAIL'}`);

            await mutualFundsPage.clearLocalSearch(searchQuery.length);
            await driver.pause(500);

            // "Index Fund" only ever has the one tag (itself) - there's no second tag to add via
            // "+", so that step is skipped entirely and this goes straight back to Explore. With
            // no "+"/tag tap afterward to close it as a side effect, the keyboard left open by
            // clearLocalSearch's backspacing would otherwise eat the very first back-press below
            // (dismissing the keyboard instead of navigating), so it's hidden explicitly here.
            if (category === 'Index Fund') {
                console.log(`${category} - only tag available - skipping "+" step`);
                await driver.hideKeyboard().catch(() => { });
            } else {
                await mutualFundsPage.clickAddFilterButton();
                await driver.pause(800);
                const nextCategoryTag = categoryTags.slice(1).find(t => t !== 'Index Fund');
                if (nextCategoryTag) {
                    await mutualFundsPage.clickCategoryTag(nextCategoryTag);
                    await driver.pause(1500);
                    const nextCategoryTagCount = await mutualFundsPage.getFilteredResultsCount();
                    console.log(`${category} - "${nextCategoryTag}" tag results: ${nextCategoryTagCount}`);
                } else {
                    console.log(`${category} - no eligible tag found after "All" (excluding "Index Fund") - skipping`);
                }
            }

            await mutualFundsPage.goBackFromFundList();
            await mutualFundsPage.scrollToCategoryCard(category);
            await mutualFundsPage.clickCategoryCard(category);
            await mutualFundsPage.scrollExploreDown();
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