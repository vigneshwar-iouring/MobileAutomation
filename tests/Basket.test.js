const DriverManager = require('../driver/DriverManager');
const ResearchCalls = require('../pages/ResearchCalls');
const BasketPage = require('../pages/BasketPage');
const { createLogger } = require('../utils/logger');

const { logFile } = createLogger('Basket');
console.log(`Logging this run to: ${logFile}`);

async function run() {
    const driver = await DriverManager.getDriver();
    try {
        const researchCalls = new ResearchCalls(driver);
        const basketPage = new BasketPage(driver);

        console.log('Step 1: Navigating to Basket via the hamburger menu...');
        await researchCalls.clickHamburgerMenu();
        await basketPage.clickBasketOrdersMenuItem();

        console.log('Step 2: Verifying empty-basket message...');
        const emptyMessage = await basketPage.getEmptyBasketMessage();
        console.log(`Empty basket message: "${emptyMessage}"`);

        console.log('Step 3: Clicking New Basket...');
        await basketPage.clickNewBasket();
        const dialogOpened = await basketPage.verifyNewBasketDialogOpened();
        if (!dialogOpened) {
            console.error('"New Basket" dialog did not open. This button has been observed to reject ');
            return;
        }

        console.log('Step 4: Clicking Create Basket with no name entered...');
        await basketPage.clickCreateBasket();
        const nameError = await basketPage.getCreateBasketError();
        console.log(`Error message: "${nameError}"`);

        console.log('Step 5: Entering basket name "Basket 1" and creating it...');
        await basketPage.enterBasketName('Basket 1');
        await basketPage.clickCreateBasket();
        const toastShown = await basketPage.waitForBasketCreatedToast();
        console.log(`"Basket created successfully" toast shown: ${toastShown}`);

        console.log('Step 6: Verifying basket header, empty state, and EXECUTE state...');
        await basketPage.readBasketHeader();
        const emptyState = await basketPage.isEmptyBasketCentered();
        console.log(`"Empty Basket" visible: ${emptyState.visible}, centered: ${emptyState.centered}`);
        const executeEnabled = await basketPage.isExecuteEnabled();
        console.log(`EXECUTE enabled: ${executeEnabled} (expected false while basket is empty)`);

        console.log('Step 7: Clicking "Add symbols to your basket"...');
        await basketPage.clickAddSymbols();

        console.log('Step 8: Searching for TataSteel...');
        await basketPage.searchSymbol('TataSteel');
        await basketPage.clickFirstSearchResult('TATASTEEL');

        console.log('Step 9: Clicking ADD BUY...');
        await basketPage.clickAddBuy();
        await basketPage.confirmOrderPad();
        const addedToast = await basketPage.waitForAddedToBasketToast();
        console.log(`"Added To Basket" toast shown: ${addedToast}`);

        console.log('Step 10: Verifying basket state after adding a symbol...');
        await basketPage.readBasketHeader();
        const executeEnabledAfter = await basketPage.isExecuteEnabled();
        console.log(`EXECUTE enabled: ${executeEnabledAfter} (expected true now that the basket has an item)`);

        console.log('Basket flow completed');
    } catch (err) {
        console.error('Test failed:', err.message);
        console.error(err.stack);
    } finally {
        await DriverManager.closeDriver();
    }
}

run();
