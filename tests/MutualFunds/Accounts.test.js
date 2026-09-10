const DriverManager = require('../../driver/DriverManager');
const { MutualFundsPage, getExpectedFinancialYearLabel, daysBetween } = require('../../pages/MutualFundsPage');
const { createLogger, getFailedTCs } = require('../../utils/logger');

const { logFile, entries } = createLogger('MutualFundsAccounts');
console.log(`Logging this run to: ${logFile}`);

const DOWNLOAD_TOAST = 'Report download completed';

async function run() {
    const driver = await DriverManager.getDriver();
    try {
        const mutualFundsPage = new MutualFundsPage(driver);
        const today = new Date();

        console.log('TC 41: Opening Mutual Funds (bottom navigation)...');
        await mutualFundsPage.openMutualFunds();

        console.log('\nTC 42: Clicking Accounts tab...');
        await mutualFundsPage.clickAccountsTab();
        await driver.pause(1000);

        console.log('\nTC 43: Clicking Reports and printing the header...');
        await mutualFundsPage.clickReportsMenu();
        await driver.pause(1000);
        const header = await mutualFundsPage.getReportsHeader();
        console.log(`Reports header: "${header}"`);

        console.log('\nTC 44: Printing the available Report options...');
        const reportOptions = await mutualFundsPage.getReportOptions();
        console.log(`Report options (in order): ${reportOptions.join(', ')}`);

        console.log('\nTC 45: Clicking Holdings Report and verifying its date is today...');
        await mutualFundsPage.clickReportOption('Holdings Report');
        await driver.pause(1000);
        const asOnDate = await mutualFundsPage.getReportAsOnDate();
        const isToday = !!asOnDate && asOnDate.toDateString() === today.toDateString();
        console.log(`Holdings Report "As on" date: ${asOnDate ? asOnDate.toDateString() : null} - ${isToday ? 'PASS (matches today)' : 'FAIL (does not match today)'}`);

        console.log('\nTC 46: Downloading Holdings Report and verifying the completion toast...');
        await mutualFundsPage.clickDownloadButton();
        const holdingsToastShown = await mutualFundsPage.waitForToast(DOWNLOAD_TOAST, { timeout: 3000 });
        console.log(`Holdings Report download toast: ${holdingsToastShown ? 'PASS (observed)' : 'FAIL (not observed)'}`);

        console.log('\nTC 47: Clicking Holdings Report again to collapse it...');
        await mutualFundsPage.clickReportOption('Holdings Report');
        await driver.pause(800);

        console.log('\nTC 48: Clicking Portfolio Summary Report and verifying Start/End Date are today...');
        await mutualFundsPage.clickReportOption('Portfolio Summary Report');
        await driver.pause(1000);
        const { startDate, endDate } = await mutualFundsPage.getPortfolioSummaryDates();
        const startIsToday = !!startDate && startDate.toDateString() === today.toDateString();
        const endIsToday = !!endDate && endDate.toDateString() === today.toDateString();
        console.log(`Portfolio Summary Report - Start Date: ${startDate ? startDate.toDateString() : null} - ${startIsToday ? 'PASS (matches today)' : 'FAIL (does not match today)'}`);
        console.log(`Portfolio Summary Report - End Date: ${endDate ? endDate.toDateString() : null} - ${endIsToday ? 'PASS (matches today)' : 'FAIL (does not match today)'}`);

        console.log('\nTC 49: Downloading Portfolio Summary Report and verifying the completion toast...');
        await mutualFundsPage.clickDownloadButton();
        const portfolioToastShown = await mutualFundsPage.waitForToast(DOWNLOAD_TOAST, { timeout: 3000 });
        console.log(`Portfolio Summary Report download toast: ${portfolioToastShown ? 'PASS (observed)' : 'FAIL (not observed)'}`);

        console.log('\nTC 50: Clicking Portfolio Summary Report again to collapse it...');
        await mutualFundsPage.clickReportOption('Portfolio Summary Report');
        await driver.pause(800);

        console.log('\nTC 51: Clicking Capital Gain Report and verifying the current financial year is observed...');
        await mutualFundsPage.clickReportOption('Capital Gain Report');
        await driver.pause(1000);
        const financialYear = await mutualFundsPage.getCapitalGainFinancialYear();
        const expectedFinancialYear = getExpectedFinancialYearLabel();
        console.log(`Capital Gain Report - Financial Year: "${financialYear}" (expected "${expectedFinancialYear}") - ${financialYear === expectedFinancialYear ? 'PASS (matches current FY)' : 'FAIL (does not match current FY)'}`);

        console.log('\nTC 52: Downloading Capital Gain Report and verifying the completion toast...');
        await mutualFundsPage.clickDownloadButton();
        const capitalGainToastShown = await mutualFundsPage.waitForToast(DOWNLOAD_TOAST, { timeout: 3000 });
        console.log(`Capital Gain Report download toast: ${capitalGainToastShown ? 'PASS (observed)' : 'FAIL (not observed)'}`);

        console.log('\nTC 53: Clicking Capital Gain Report again to collapse it...');
        await mutualFundsPage.clickReportOption('Capital Gain Report');
        await driver.pause(800);

        console.log('\nTC 54: Navigating back to the Accounts tab...');
        await mutualFundsPage.goBackFromReports();

        console.log('\nTC 55: Clicking Order Book and printing the header...');
        await mutualFundsPage.clickOrderBookMenu();
        await driver.pause(1000);
        const orderBookHeader = await mutualFundsPage.getOrderBookHeader();
        console.log(`Order Book header: "${orderBookHeader}"`);

        console.log('\nTC 56: Checking the date range is exactly one week (7 days)...');
        const { startDate: obStartDate, endDate: obEndDate } = await mutualFundsPage.getOrderBookDateRange();
        const rangeDays = (obStartDate && obEndDate) ? daysBetween(obStartDate, obEndDate) : null;
        console.log(`Order Book date range: ${obStartDate ? obStartDate.toDateString() : null} - ${obEndDate ? obEndDate.toDateString() : null} (${rangeDays} day(s)) - ${rangeDays === 7 ? 'PASS (exactly 7 days)' : 'FAIL (not 7 days)'}`);

        console.log('\nTC 57: Navigating back to the Accounts tab...');
        await mutualFundsPage.goBackFromOrderBook();

        console.log('\nTC 58: Clicking Bank and printing the header...');
        await mutualFundsPage.clickBankMenu();
        await driver.pause(1000);
        const banksHeader = await mutualFundsPage.getBanksHeader();
        console.log(`Banks header: "${banksHeader}"`);

        console.log('\nTC 59: Checking whether any banks are listed...');
        const bankNames = await mutualFundsPage.getBankList();
        if (bankNames.length === 0) {
            console.log('No banks listed - navigating back');
            await mutualFundsPage.goBackFromBank();
        } else {
            console.log(`Banks listed: ${bankNames.join(', ')}`);
            await mutualFundsPage.goBackFromBank();
        }

        console.log('\nTC 60: Clicking Autopay and checking for active mandates...');
        await mutualFundsPage.clickAutopayMenu();
        await driver.pause(1000);
        const autopayList = await mutualFundsPage.getAutopayList();
        if (autopayList.length > 0) {
            console.log(`Autopay count: ${autopayList.length}`);
            const activeCount = autopayList.filter(desc => desc.includes('ACTIVE')).length;
            console.log(`Autopay "Active" tag check: ${activeCount}/${autopayList.length} mandate(s) show ACTIVE - ${activeCount === autopayList.length ? 'PASS' : 'FAIL'}`);
        } else {
            const emptyMessageShown = await mutualFundsPage.isAutopayEmptyMessageShown();
            console.log(emptyMessageShown ? 'No autopay active' : 'Autopay list empty, but expected empty-state message not observed');
        }

        console.log('\nTC 61: Navigating back to the Accounts tab...');
        await mutualFundsPage.goBackFromAutopay();

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
