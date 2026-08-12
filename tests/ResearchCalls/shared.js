const QuotesPage = require('../../pages/QuotesPage');
const OrderPadPage = require('../../pages/OrderPadPage');

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
// its first one.
async function countAndRunQuoteFlow(driver, researchCalls, label, opts) {
    const count = await countTab(researchCalls, label, opts);
    if (count > 0) {
        await runSymbolQuoteFlow(driver, researchCalls, label);
    } else {
        console.log(`Skipping Quotes flow for ${label} - no symbols available`);
    }
    return count;
}

module.exports = { logSection, countTab, verifyOrderPad, runSymbolQuoteFlow, countAndRunQuoteFlow };
