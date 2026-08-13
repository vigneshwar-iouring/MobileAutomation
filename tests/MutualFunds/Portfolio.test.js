const DriverManager = require('../../driver/DriverManager');
const { MutualFundsPage } = require('../../pages/MutualFundsPage');
const { createLogger } = require('../../utils/logger');

const { logFile } = createLogger('MutualFundsPortfolio');
console.log(`Logging this run to: ${logFile}`);

async function run() {
    const driver = await DriverManager.getDriver();
    try {
        const mutualFundsPage = new MutualFundsPage(driver);

        console.log('Step 1: Opening Mutual Funds and clicking Portfolio tab...');
        await mutualFundsPage.openMutualFunds();
        await driver.pause(1000);
        await mutualFundsPage.clickPortfolioTab();
        await driver.pause(1000);
        await mutualFundsPage.readPortfolioSummary();

        console.log('\nStep 2: Clicking Active SIPs and verifying the count matches Manage SIP...');
        const activeSipsCount = await mutualFundsPage.getActiveSipsCount();
        console.log(`Active SIPs count (Portfolio page): ${activeSipsCount}`);
        await mutualFundsPage.clickActiveSipsTile();
        await driver.pause(1500);
        const sipCards = await mutualFundsPage.getManageSipCards();
        console.log(`Manage SIP list shows ${sipCards.length} SIP(s)`);
        console.log(`Count check: ${activeSipsCount !== null && activeSipsCount === sipCards.length ? 'PASS (match)' : 'FAIL (mismatch)'}`);

        console.log('\nStep 3: Printing and opening the first Active SIP...');
        const firstSip = sipCards[0];
        console.log(`First SIP - Name: ${firstSip.name}, Frequency: ${firstSip.frequency}, Amount: ${firstSip.amount}`);
        await mutualFundsPage.clickManageSipCard(firstSip);
        await driver.pause(1500);

        console.log('\nStep 4: Printing SIP Detail (Due Date, SIP ID, Mandate Bank, Mandate ID)...');
        const detail = await mutualFundsPage.readSipDetail();
        const nameMatch = detail.name === firstSip.name;
        const amountMatch = mutualFundsPage.parseCurrency(detail.amount) === mutualFundsPage.parseCurrency(firstSip.amount);
        console.log(`Name check: ${nameMatch ? 'PASS (match)' : 'FAIL (mismatch)'}`);
        console.log(`Amount check: ${amountMatch ? 'PASS (match)' : 'FAIL (mismatch)'}`);

        console.log('\nStep 5: Scrolling down to the bottom of the SIP Detail screen...');
        await mutualFundsPage.scrollSipDetailToBottom();

        console.log('\nStep 6: Navigating back to the Portfolio page...');
        await mutualFundsPage.goBackFromSipDetail();

        console.log('\nStep 7: Clicking the first fund below Active SIPs and printing its fields...');
        const fundCards = await mutualFundsPage.getPortfolioFundCards();
        const firstFund = fundCards[0];
        await mutualFundsPage.clickPortfolioFundCard(firstFund);
        await driver.pause(1500);
        const holdingDetail = await mutualFundsPage.readFundHoldingDetail();

        console.log('\nStep 8: Opening options and clicking Redeem Fund, verifying Folio No...');
        await mutualFundsPage.clickActionsButton();
        await driver.pause(1000);
        await mutualFundsPage.clickRedeemFund();
        await driver.pause(1500);
        const redeemFolioNo = await mutualFundsPage.readRedeemFolioNumber();
        const holdingFolioNo = (holdingDetail.folioNumber || '').replace(/\s+/g, '');
        console.log(`Folio No - Holding detail: ${holdingFolioNo}, Redeem screen: ${redeemFolioNo}`);
        console.log(`Folio No check: ${redeemFolioNo === holdingFolioNo ? 'PASS (match)' : 'FAIL (mismatch)'}`);
        await mutualFundsPage.clickRedeemAll();
        await driver.pause(1000);
        await mutualFundsPage.clickRedeemAll();
        await mutualFundsPage.goBackToActionsMenu();

        console.log('\nStep 9: Clicking Switch Fund...');
        await mutualFundsPage.clickSwitchFund();
        await driver.pause(1500);
        await mutualFundsPage.goBackToActionsMenu();

        console.log('\nStep 10: Clicking Transaction Details...');
        await mutualFundsPage.clickTransactionDetails();
        await driver.pause(1500);
        await mutualFundsPage.goBackToActionsMenu();

        console.log('\nStep 11: Clicking Fund Overview, then navigating back to the Portfolio page...');
        await mutualFundsPage.clickFundOverview();
        await driver.pause(1500);
        await mutualFundsPage.goBackToActionsMenu();
        await mutualFundsPage.goBackFromActionsMenuToPortfolio();
    } catch (err) {
        console.error('Test failed:', err.message);
        console.error(err.stack);
    } finally {
        await DriverManager.closeDriver();
    }
}

run();
