const fs = require('fs');
const DriverManager = require('../driver/DriverManager');
const SplashPage = require('../pages/SplashPage');
const LoginPage = require('../pages/LoginPage');
const permissionHandler = require('../utils/permissionHandler');
const ResearchCalls = require('../pages/ResearchCalls');
const QuotesPage = require('../pages/QuotesPage');
const OrderPadPage = require('../pages/OrderPadPage');
const { createLogger } = require('../utils/logger');

function logSection(title) {
    const line = '='.repeat(60);
    console.log(`\n${line}\n ${title}\n${line}`);
}

async function countTab(researchCalls, label, { skipScrollUp = false } = {}) {
    console.log(`Step 4: Counting symbols under ${label}...`);
    await researchCalls.waitForContent();
    if (!skipScrollUp) {
        await researchCalls.scrollUpUnlessNoData();
    }
    const count = await researchCalls.countSymbols();
    console.log(`${label} symbol count: ${count}`);
    return count;
}

// Derivative research calls name the underlying (e.g. "RBLBANK"), but the Order Pad shows the
// actual tradable contract (e.g. "RBLBANK 25AUG 400 CE") - so for those, a strict equality check
// would always report a mismatch. matchContains checks the Order Pad symbol *contains* the
// expected one instead of being exactly equal to it.
async function verifyOrderPad(driver, expectedSymbol, expectedType, label, { matchContains = false } = {}) {
    const orderPad = new OrderPadPage(driver);
    const displayed = await orderPad.isDisplayed();
    const symbol = await orderPad.getDisplayedSymbol();
    const type = await orderPad.getTransactionType();
    const symbolMatch = matchContains ? !!(symbol && expectedSymbol && symbol.includes(expectedSymbol)) : symbol === expectedSymbol;
    console.log(`${label}: Order Pad displayed=${displayed}, symbol="${symbol}" (expected "${expectedSymbol}"${matchContains ? ', contains-match' : ''}), type="${type}" (expected "${expectedType}")`);
    console.log(`${label}: symbol match=${symbolMatch}, type match=${type === expectedType}`);
    await orderPad.validateMargins(label);
    await orderPad.goBackToQuotes();
}

// Opens the Quotes screen for the first symbol in whichever tab is currently active and exercises
// BUY/SELL -> Order Pad, Add to Basket, and Add to Watchlist, then returns to the Research Calls
// list. Self-guards on tabs with no data, so the same function covers every tab - present and
// future - without per-tab special-casing.
async function runSymbolQuoteFlow(driver, researchCalls, label) {
    console.log(`Step 5: Opening Quotes screen for the first ${label} symbol...`);
    const firstCard = await researchCalls.getFirstSymbolCard();
    if (!firstCard) {
        console.log(`No symbol available in ${label} - skipping Quotes flow`);
        return;
    }
    const symbol = firstCard.symbol;
    console.log(`First symbol identified: ${symbol}`);
    const matchContains = label.toLowerCase().includes('derivative');

    await firstCard.element.click();
    await driver.pause(1000);

    const quotesPage = new QuotesPage(driver);
    console.log('Step 5: Reading call details and validating End Date...');
    const callDetails = await quotesPage.readCallDetails(firstCard.rawDesc);
    await quotesPage.validateEndDate(callDetails);

    // Tapping the symbol opens a call-detail dialog (BUY/QUOTE/WATCHLIST) before the Quotes screen
    // even exists - Step 7's BUY click belongs to that dialog, not the Quotes screen's own BUY.
    console.log('Step 7: Clicking BUY on the call-detail dialog...');
    await quotesPage.clickDialogBuy();
    await verifyOrderPad(driver, symbol, 'Buy', 'BUY #1', { matchContains });

    await quotesPage.openQuote();
    const onQuotes = await quotesPage.isDisplayed();
    console.log(`Quotes screen displayed: ${onQuotes}`);

    console.log('Step 6: Reading quote details...');
    await quotesPage.readQuoteDetails();

    console.log('Step 8: Expanding Quotes screen and scrolling to bottom...');
    await quotesPage.clickSwipeUpIfAvailable();
    await quotesPage.scrollToBottom();

    console.log('Step 9: Clicking SELL...');
    await quotesPage.clickSell();
    await verifyOrderPad(driver, symbol, 'Sell', 'SELL', { matchContains });

    console.log('Step 10: Clicking BUY again from the bottom section...');
    await quotesPage.clickBuy();
    await verifyOrderPad(driver, symbol, 'Buy', 'BUY #2', { matchContains });

    console.log('Step 11: Adding to basket (2nd basket)...');
    await quotesPage.openAdvancedOptions();
    await quotesPage.addToBasket(2);

    console.log('Step 12: Adding to watchlist (1st watchlist)...');
    await quotesPage.openWatchlistPicker();
    await quotesPage.selectWatchlist(1);

    console.log('Step 13: Returning to Research Calls list...');
    await quotesPage.returnToResearchCallsList();
}

// Counts the current tab, then - only when it actually has symbols - runs the full quote flow on
// its first one. One call covers every tab (present and future) the same way. Results are
// recorded under `group` (Equity/Derivative/Commodity) so the whole run can be summarized grouped
// by asset class at the end, instead of only as a flat step-by-step log.
async function countAndRunQuoteFlow(driver, researchCalls, group, label, results, opts) {
    const count = await countTab(researchCalls, label, opts);
    results.push({ group, label, count });
    if (count > 0) {
        await runSymbolQuoteFlow(driver, researchCalls, label);
    } else {
        console.log(`Skipping Quotes flow for ${label} - no symbols available`);
    }
    return count;
}

function printSummary(results) {
    logSection('SUMMARY');
    for (const group of [...new Set(results.map(r => r.group))]) {
        console.log(`${group}:`);
        for (const r of results.filter(r => r.group === group)) {
            const sub = r.label.includes('-') ? r.label.split('-')[1].trim() : r.label;
            console.log(`  ${sub}: ${r.count} symbol(s)${r.count === 0 ? ' (No Data Found)' : ''}`);
        }
    }
}

async function run() {
    const driver = await DriverManager.getDriver();
    try {
        const splashPage = new SplashPage(driver);
        const researchCalls = new ResearchCalls(driver);
        const results = [];

        console.log('Step 1: Clicking hamburger menu...');
        await researchCalls.clickHamburgerMenu();

        console.log('Step 2: Clicking Research option...');
        await researchCalls.clickResearchOption();
        await researchCalls.waitForContent();

        logSection('EQUITY');
        await researchCalls.clickFundamentalTab();
        await countAndRunQuoteFlow(driver, researchCalls, 'Equity', 'Equity - Fundamental', results, { skipScrollUp: true });

        await researchCalls.clickTechnicalTab();
        await countAndRunQuoteFlow(driver, researchCalls, 'Equity', 'Equity - Technical', results);

        logSection('DERIVATIVE');
        await researchCalls.clickDerivativeTab();
        await researchCalls.clickTechnicalTab();
        await countAndRunQuoteFlow(driver, researchCalls, 'Derivative', 'Derivative - Technical', results);

        await researchCalls.clickStrategiesTab();
        await countAndRunQuoteFlow(driver, researchCalls, 'Derivative', 'Derivative - Strategies', results);

        logSection('COMMODITY');
        await researchCalls.clickCommodityTab();
        await researchCalls.clickTechnicalTab();
        await countAndRunQuoteFlow(driver, researchCalls, 'Commodity', 'Commodity - Technical', results);

        await researchCalls.clickStrategiesTab();
        await countAndRunQuoteFlow(driver, researchCalls, 'Commodity', 'Commodity - Strategies', results);

        printSummary(results);

        await researchCalls.clickClose();

    } catch (err) {
        console.error('Test failed:', err.message);
        console.error(err.stack);
    } finally {
        await DriverManager.closeDriver();
    };
}
run();
