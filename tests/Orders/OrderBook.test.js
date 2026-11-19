const DriverManager = require('../../driver/DriverManager');
const SplashPage = require('../../pages/SplashPage');
const OrderBookPage = require('../../pages/OrderBookPage');
const { MarketsPage } = require('../../pages/MarketsPage');
const QuotesPage = require('../../pages/QuotesPage');
const OrderPadPage = require('../../pages/OrderPadPage');
const permissionHandler = require('../../utils/permissionHandler');
const { createLogger, getFailedTCs } = require('../../utils/logger');

const { logFile, entries } = createLogger('OrderBook');
console.log(`Logging this run to: ${logFile}`);

// Real order placement switch - ON by default; set PLACE_REAL_ORDERS=0 to turn it off. This is a
// live account trading real money: with it on, TC 13 taps CONFIRM on the NSE lower-circuit BUY
// (only inside NSE hours). With it off, the NSE order (TC 7-15) stops at the Confirmation
// Preview and closes it with back - CONFIRM is never tapped and the status/Order Book steps are
// skipped.
const PLACE_REAL_ORDERS = process.env.PLACE_REAL_ORDERS !== '0';

// NSE symbol, same as tests/Orders/Orderpad.test.js: RTNPOWER's first search result is its NSE
// listing. Override with NSE_QUERY / NSE_POSITION.
const NSE = {
    query: process.env.NSE_QUERY || 'RTNPOWER',
    position: Number(process.env.NSE_POSITION) || 1,
};

// NSE trading hours (IST, Mon-Fri), as in the Regression suite's MARKET_HOURS. Outside them the
// order is not confirmed even with PLACE_REAL_ORDERS=1.
function isNseOpen() {
    const ist = new Date(Date.now() + 5.5 * 3600000);
    const day = ist.getUTCDay();
    const mins = ist.getUTCHours() * 60 + ist.getUTCMinutes();
    return day >= 1 && day <= 5 && mins >= 9 * 60 + 15 && mins <= 15 * 60 + 30;
}

// TC 1 launch | 2 Order Book (Orders nav if needed) | 3-6 ALL, Pending, Executed, Cancelled tabs
// TC 7-15 NSE lower-circuit BUY: 7 Markets | 8 search + NSE Quote | 9 lower circuit |
//   10 BUY -> Order Pad | 11 lower circuit in Price | 12 Confirmation Preview checks |
//   13 CONFIRM (gated) | 14 status popup buttons | 15 order in the Order Book, pending in Pending
// TC 16-18 the pending order: 16 tap it -> order details with Modify and Cancel |
//   17 timings (listing vs popup, vs the CONFIRM moment) | 18 mandatory fields
// TC 19-22 Modify (REAL order): 19 Modify pad for the symbol with MODIFY; only Qty / Price incl.
//   the Market/Limit swap (and SL trigger on an SL order) editable | 20 qty 1 -> 2, Approx Margin up | 21 MODIFY (+ confirm
//   if a preview appears, price/qty checked first) | 22 order details show qty 2, same order/price
const tc = (no, text) => console.log(`\nTC ${no}: ${text}`);

// Quote / Order Pad / search -> a screen with the bottom navigation. Back presses only, never
// anything that confirms; stops as soon as the Orders nav button is on screen.
async function backToBottomNav(driver, orderBook, marketsPage) {
    for (let i = 0; i < 5; i++) {
        if (await orderBook.isElementVisible(orderBook.ordersNavButton, 1000)) return true;
        if (await marketsPage.isElementVisible(marketsPage.searchScreen, 500)) {
            await marketsPage.closeGlobalSearch();
        } else {
            await driver.back();
        }
        await orderBook.pause(800);
    }
    return orderBook.isElementVisible(orderBook.ordersNavButton, 1000);
}

// NSE BUY at the Quote's own lower circuit (a genuine in-range price far below LTP, so the order
// rests as pending rather than filling), then its status on the popup and in the Order Book.
async function placeNseLowerCircuitOrder(driver, pages) {
    const { orderBook, marketsPage, quotesPage, orderPadPage } = pages;

    tc(7, 'Navigating to Markets...');
    await marketsPage.clickMarketNavButton();
    if (!(await marketsPage.waitForEquityLoaded(10000))) throw new Error('Markets screen did not load');
    await marketsPage.scrollToTop();

    tc(8, `Searching "${NSE.query}", opening result #${NSE.position} and verifying its NSE Quote opens...`);
    if (!(await marketsPage.clickGlobalSearchBar())) throw new Error('Global search did not open');
    await marketsPage.typeInSearch(NSE.query);
    const searched = await marketsPage.tapSearchResult(NSE.query, NSE.position);
    if (!searched || !(await marketsPage.verifyQuoteOpened(searched))) {
        throw new Error(`Quote did not open for "${NSE.query}" result #${NSE.position}`);
    }
    const header = await quotesPage.getQuoteHeader();
    const exchangeOk = header && header.exchange === 'NSE';
    console.log(`Quote opened on ${header ? header.exchange : 'unknown exchange'} (expected NSE): ${exchangeOk ? 'PASS' : 'FAIL'}`);
    if (!exchangeOk) throw new Error('Opened symbol is not an NSE symbol - set NSE_QUERY / NSE_POSITION');
    const symbol = header.symbol;

    tc(9, 'Expanding the Quote and reading the lower circuit...');
    if (!(await quotesPage.swipeUpQuoteScreen())) throw new Error('Quote screen did not expand');
    const limits = await quotesPage.getCircuitLimits();
    if (!limits) throw new Error('Could not read circuit limits from the Quote screen');
    const lower = Number(limits.lower);

    tc(10, 'Clicking BUY on the Quote and verifying the Buy Order Pad opens...');
    await quotesPage.clickBuy();
    if (!(await orderPadPage.verifyOpenedFor('Buy'))) throw new Error('Buy Order Pad did not open');

    tc(11, `Entering the lower circuit (${lower}) in Price...`);
    await orderPadPage.ensureLimitMode();
    if (!(await orderPadPage.setPrice(limits.lower))) throw new Error(`Price field did not take the lower circuit ${lower}`);
    await orderPadPage.hideKeyboardIfShown();

    tc(12, 'Clicking BUY and verifying the Confirmation Preview shows the lower circuit price on NSE...');
    await orderPadPage.clickBuy();
    await orderPadPage.proceedPastSurveillanceIfShown();
    const outcome = await orderPadPage.waitForBuyOutcome();
    if (outcome.outcome !== 'confirmation') {
        throw new Error(outcome.outcome === 'dpr'
            ? `BUY at the lower circuit rejected with "${outcome.message}"`
            : 'Confirmation Preview did not appear after BUY');
    }
    const details = await orderPadPage.getConfirmationDetails();
    console.log(`Confirmation Preview: ${JSON.stringify(details)}`);
    // Safety check before CONFIRM: the popup shows what will actually be sent (the Price field's
    // own text can read right while the form state is unchanged - see OrderPadPage.setPrice).
    const priceOk = Number(String(details.Price || '').replace(/,/g, '')) === lower;
    const exOk = details.Exchange === 'NSE';
    console.log(`Confirmation price ${details.Price} matches lower circuit ${lower}: ${priceOk ? 'PASS' : 'FAIL'}`);
    console.log(`Confirmation exchange ${details.Exchange} is NSE: ${exOk ? 'PASS' : 'FAIL'}`);
    if (!priceOk || !exOk) {
        await orderPadPage.dismissConfirmationPopup();
        throw new Error('Confirmation Preview does not match the intended order - refusing to tap CONFIRM');
    }

    if (!PLACE_REAL_ORDERS || !isNseOpen()) {
        tc(13, `${!PLACE_REAL_ORDERS ? 'PLACE_REAL_ORDERS is off' : 'NSE market closed (09:15-15:30 IST, Mon-Fri)'} - closing the Confirmation Preview without confirming...`);
        await orderPadPage.dismissConfirmationPopup();
        console.log('TC 14-15 skipped - no order placed, so no status popup or Order Book row to verify');
        return;
    }

    tc(13, `Tapping CONFIRM - placing a REAL NSE BUY order: ${symbol} x ${details.Quantity} @ ${lower}...`);
    const confirmedAt = Date.now();
    await orderPadPage.tapConfirm();

    tc(14, 'Reading the order status popup and verifying its buttons...');
    const popup = await orderBook.readOrderStatusPopup();
    let popupStatus = null;
    if (!popup) {
        console.log('Order status popup did not appear after CONFIRM: FAIL');
    } else {
        popupStatus = popup.status;
        console.log(`Order status popup: status "${popup.status || 'unknown'}" ("${popup.message || ''}")`);
        console.log(`Order status shown on the popup: ${popup.status ? 'PASS' : 'FAIL'}`);
        const buttons = `Close ${popup.close ? 'shown' : 'not shown'}, View Order Book ${popup.viewOrderBook ? 'shown' : 'not shown'}`;
        // Placed/Queued/Scheduled/Failed: only Close. Rejected: View Order Book and Close.
        const buttonsOk = popup.status === 'Rejected'
            ? !!popup.close && !!popup.viewOrderBook
            : !!popup.close && !popup.viewOrderBook;
        const expected = popup.status === 'Rejected' ? 'View Order Book and Close' : 'only Close';
        console.log(`${popup.status || 'Unknown'} status shows ${expected} (${buttons}): ${buttonsOk ? 'PASS' : 'FAIL'}`);
    }

    tc(15, `Opening the Order Book and verifying the ${symbol} BUY @ ${lower} order and its status...`);
    if (popup && popup.viewOrderBook) {
        await orderBook.tapNode(popup.viewOrderBook);
        await orderBook.pause(1500);
    } else {
        if (popup && popup.close) {
            await orderBook.tapNode(popup.close);
            await orderBook.pause(1000);
        }
        if (!(await backToBottomNav(driver, orderBook, marketsPage))) throw new Error('Could not get back to the bottom navigation');
        await orderBook.clickOrdersNav();
        await orderBook.pause(1500);
        await orderBook.selectRegularTab();
    }
    if (!(await orderBook.isOnOrderBook(10000))) throw new Error('Order Book did not open after placing the order');
    await orderBook.tapStatusTab('ALL');

    const row = await orderBook.findOrderRow(r =>
        r.action === 'BUY' && r.symbol === symbol && r.price === lower);
    if (!row) {
        console.log(`${symbol} BUY @ ${lower} not listed in the Order Book ALL tab: FAIL`);
        (await orderBook.getOrderRows()).slice(0, 5).forEach(r => console.log(`  - ${r}`));
        return;
    }
    console.log(`Order listed in the Order Book: "${row.raw}": PASS`);
    console.log(`Order status in the Order Book: ${row.status}`);
    // The popup's "Placed" and the Order Book's resting-order status can be worded differently,
    // so only a Rejected popup is compared word for word.
    if (popupStatus === 'Rejected') {
        const same = /rejected/i.test(row.status);
        console.log(`Order Book status "${row.status}" matches the popup's Rejected: ${same ? 'PASS' : 'FAIL'}`);
        console.log('TC 16-19 skipped - the order was rejected, so it is not pending and has no Modify / Cancel');
        return;
    } else if (popupStatus) {
        console.log(`Popup status "${popupStatus}" vs Order Book status "${row.status}" - logged, not compared`);
    }

    // A lower-circuit BUY rests unfilled, so it must be in the Pending tab, not Executed/Cancelled.
    await orderBook.tapStatusTab('Pending');
    const pendingRow = await orderBook.findOrderRow(r =>
        r.action === 'BUY' && r.symbol === symbol && r.price === lower, 15000);
    const isPending = !!pendingRow && !/executed|cancel|reject/i.test(pendingRow.status);
    console.log(`Order reflected in the Pending tab as pending (status "${pendingRow ? pendingRow.status : 'not listed'}"): ${isPending ? 'PASS' : 'FAIL'}`);
    if (!pendingRow) return;

    const od = await verifyPendingOrderDetails(orderBook, pendingRow, { symbol, lower, quantity: Number(details.Quantity), confirmedAt });
    if (!od) return;
    if (!od.buttons.modify) {
        console.log('TC 19-22 skipped - no Modify button on the order details');
        await orderBook.closeOrderDetails();
        return;
    }
    await modifyPendingOrder(driver, pages, od, { symbol, lower });
}

// IST wall clock for a JS timestamp, as { date: 'DD-MM-YYYY', secs: seconds since midnight }.
function istClock(ms) {
    const d = new Date(ms + 5.5 * 3600000);
    const pad = n => String(n).padStart(2, '0');
    return {
        date: `${pad(d.getUTCDate())}-${pad(d.getUTCMonth() + 1)}-${d.getUTCFullYear()}`,
        secs: d.getUTCHours() * 3600 + d.getUTCMinutes() * 60 + d.getUTCSeconds(),
    };
}
const toSecs = t => {
    const [h, m, s = 0] = String(t).split(':').map(Number);
    return h * 3600 + m * 60 + s;
};

// Every field of the order details popup, one per line, in the popup's own order.
function printOrderDetails(od) {
    const rows = [
        ['Action', od.action],
        ['Status', od.status],
        ['Order time (header)', od.headerTime],
        ['Quantity (filled of total)', od.totalQty === null ? null : `${od.filledQty} of ${od.totalQty}`],
        ...Object.entries(od.fields),
        ['Buttons', ['modify', 'cancel', 'repeat'].filter(b => od.buttons[b])
            .map(b => ({ modify: 'Modify', cancel: 'Cancel', repeat: 'Repeat Order' })[b]).join(', ') || 'none'],
    ];
    const width = Math.max(...rows.map(([k]) => k.length));
    console.log('Order details:');
    rows.forEach(([k, v]) => console.log(`  ${k.padEnd(width)} : ${v === null || v === undefined || v === '' ? '-' : v}`));
}

// TC 16-19: open the pending order's details (Modify / Cancel shown - never tapped), check its
// timings against the Order Book row and the CONFIRM moment, its mandatory fields, then close it.
async function verifyPendingOrderDetails(orderBook, row, { symbol, lower, quantity, confirmedAt }) {
    tc(16, `Tapping the pending ${symbol} order and verifying its order details with Modify and Cancel...`);
    const od = await orderBook.openOrderDetails(row.raw);
    if (!od) {
        console.log('Order details popup did not open: FAIL');
        return;
    }
    printOrderDetails(od);
    console.log(`Order details popup opened for ${od.action} ${od.fields['Stock name'] || '?'} (status ${od.status}): ${od.fields['Stock name'] === symbol ? 'PASS' : 'FAIL'}`);
    console.log(`Modify button displayed: ${od.buttons.modify ? 'PASS' : 'FAIL'}`);
    console.log(`Cancel button displayed: ${od.buttons.cancel ? 'PASS' : 'FAIL'}`);

    tc(17, 'Verifying the order timings in the Order Book listing and the order details popup...');
    const now = istClock(Date.now());
    const placed = istClock(confirmedAt);
    // Order times must fall between just before CONFIRM (device/exchange clock skew) and now.
    const inWindow = t => t && toSecs(t) >= placed.secs - 120 && toSecs(t) <= now.secs + 60;
    const orderTime = od.fields['Order Time'];
    const exch = String(od.fields['Exchange Order Time'] || '').match(/^(\d{2}-\d{2}-\d{4})\s+([\d:]+)$/);
    const placedLabel = new Date(confirmedAt + 5.5 * 3600000).toISOString().slice(11, 19);
    console.log(`Order Time "${orderTime || 'missing'}" is at the time the order was placed (CONFIRM ~${placedLabel} IST): ${inWindow(orderTime) ? 'PASS' : 'FAIL'}`);
    console.log(`Exchange Order Time "${od.fields['Exchange Order Time'] || 'missing'}" is today (${now.date}) at the time the order was placed: ${exch && exch[1] === now.date && inWindow(exch[2]) ? 'PASS' : 'FAIL'}`);
    console.log(`Popup header order time "${od.headerTime || 'missing'}" matches the Exchange Order Time: ${exch && od.headerTime === exch[2] ? 'PASS' : 'FAIL'}`);
    console.log(`Exchange Order Time not earlier than Order Time: ${exch && orderTime && toSecs(exch[2]) >= toSecs(orderTime) ? 'PASS' : 'FAIL'}`);
    const listTime = orderBook.rowTime(row.raw);
    if (listTime) {
        const same = [od.headerTime, orderTime, exch && exch[2]].some(t => t && (t === listTime || t.startsWith(`${listTime}:`)));
        console.log(`Order Book listing time "${listTime}" matches the order details popup: ${same ? 'PASS' : 'FAIL'}`);
    } else {
        // Drawn inside the row's merged node, absent from its content-desc - cannot be read
        // through Appium without OCR. A screenshot is kept for manual comparison.
        const shot = require('path').join(__dirname, '..', '..', 'ui_dumps', 'orderbook_order_details.png');
        await orderBook.driver.saveScreenshot(shot).catch(() => { });
        console.log(`Order Book listing time is not exposed in the row's accessibility label - NOT VERIFIABLE (screenshot: ${shot})`);
    }

    tc(18, 'Verifying the mandatory fields in the order details (order id, exchange, exchange order id, timing, qty, avg price)...');
    const f = od.fields;
    const has = v => v !== undefined && v !== null && String(v).trim() !== '';
    const num = v => Number(String(v).replace(/,/g, ''));
    const check = (label, ok, shown) => console.log(`${label} (${shown === undefined ? 'missing' : `"${shown}"`}): ${ok ? 'PASS' : 'FAIL'}`);
    check('Order ID displayed', has(f['Order ID']), f['Order ID']);
    check('Exchange is NSE', f['Exchange'] === 'NSE', f['Exchange']);
    check('Exchange Order Number (exchange order id) displayed', /^\d+$/.test(f['Exchange Order Number'] || ''), f['Exchange Order Number']);
    check('Order Time displayed', /^\d{1,2}:\d{2}(:\d{2})?$/.test(orderTime || ''), orderTime);
    check('Exchange Order Time displayed', !!exch, f['Exchange Order Time']);
    check(`Quantity is ${quantity}`, od.totalQty === quantity, od.totalQty === null ? undefined : `${od.filledQty} of ${od.totalQty}`);
    check(`Order Price is the lower circuit ${lower}`, num(f['Order Price']) === lower, f['Order Price']);
    // The popup labels it "Avg Price" for both sides: buy avg on a BUY, sell avg on a SELL.
    const avgLabel = od.action === 'SELL' ? 'Sell avg' : 'Buy avg';
    check(`${avgLabel} (Avg Price) displayed for the ${od.action} order`, has(f['Avg Price']) && !Number.isNaN(num(f['Avg Price'])), f['Avg Price']);
    // Pending and unfilled: nothing traded yet, so the average must still be 0.
    if (od.filledQty === 0) check(`${avgLabel} is 0 while nothing is filled`, num(f['Avg Price']) === 0, f['Avg Price']);

    return od;
}

// TC 19-22: Modify the pending order's quantity 1 -> NEW_QTY at the same price, then verify the
// order details show it. Modifies a REAL order - only reached after TC 13 actually placed one.
const NEW_QTY = 2;
async function modifyPendingOrder(driver, pages, od, { symbol, lower }) {
    const { orderBook, orderPadPage, marketsPage } = pages;
    const oldQty = od.totalQty;
    const orderId = od.fields['Order ID'];

    tc(19, `Clicking Modify and verifying the Modify Order Pad opens for ${symbol} with a MODIFY button...`);
    await orderBook.tapNode(od.buttons.modify);
    if (!(await orderPadPage.verifyModifyPadFor(symbol))) throw new Error('Modify Order Pad did not open');
    const padQty = await orderPadPage.getQuantity();
    const padPrice = await orderPadPage.getPrice();
    console.log(`Modify Order Pad prefilled with the order (qty "${padQty}" = ${oldQty}, price "${padPrice}" = ${lower}): ${Number(padQty) === oldQty && Number(padPrice) === lower ? 'PASS' : 'FAIL'}`);
    // Only Qty and Price editable - plus the SL trigger when the order is a stoploss order.
    const isSL = /^SL/i.test(od.fields['Order Type'] || '') || Number(od.fields['Trigger Price'] || 0) > 0;
    const access = await orderPadPage.verifyModifyPadFieldAccess({ exchange: od.fields['Exchange'], isSL });
    if (!access.intact) throw new Error('Modify pad was left with a changed exchange / price type - refusing to tap MODIFY');

    tc(20, `Increasing the quantity ${oldQty} -> ${NEW_QTY} and verifying Approx Margin increases...`);
    const marginBefore = await orderPadPage.getApproxMargin();
    if (!(await orderPadPage.setQuantity(NEW_QTY))) throw new Error(`Quantity did not take ${NEW_QTY}`);
    await orderPadPage.verifyApproxMarginMoved(marginBefore, 'up', `quantity ${oldQty} -> ${NEW_QTY}`);
    // Price must still be the lower circuit - the modification may only change the quantity.
    const priceNow = await orderPadPage.getPrice();
    if (Number(priceNow) !== lower) throw new Error(`Price changed to "${priceNow}" on the Modify pad - refusing to tap MODIFY`);

    tc(21, `Clicking MODIFY - modifying the REAL order ${orderId}: ${symbol} qty ${NEW_QTY} @ ${lower}...`);
    const result = await orderPadPage.clickModifyAndWait();
    if (result.outcome === 'confirmation') {
        // Same safety check as the original order: confirm only what was intended.
        const c = await orderPadPage.getConfirmationDetails();
        console.log(`Modify Confirmation Preview: ${JSON.stringify(c)}`);
        const ok = Number(String(c.Price || '').replace(/,/g, '')) === lower && Number(c.Quantity) === NEW_QTY;
        console.log(`Modify confirmation shows qty ${NEW_QTY} @ ${lower} (qty ${c.Quantity}, price ${c.Price}): ${ok ? 'PASS' : 'FAIL'}`);
        if (!ok) {
            await orderPadPage.dismissConfirmationPopup();
            throw new Error('Modify Confirmation Preview does not match the intended modification - refusing to tap CONFIRM');
        }
        await orderPadPage.tapConfirm();
    } else if (result.outcome !== 'left') {
        throw new Error(result.outcome === 'dpr' ? `MODIFY rejected with "${result.message}"` : 'Order Pad did not respond to MODIFY');
    }
    const popup = await orderBook.readOrderStatusPopup(5000);
    if (popup) console.log(`Status after MODIFY: "${popup.status || 'unknown'}" ("${popup.message || ''}")`);
    if (popup && popup.close) await orderBook.tapNode(popup.close);

    tc(22, `Verifying the order details show the modification (qty ${NEW_QTY}, same order and price)...`);
    if (!(await orderBook.isOnOrderBook(3000))) {
        if (!(await backToBottomNav(driver, orderBook, marketsPage))) throw new Error('Could not get back to the bottom navigation');
        await orderBook.clickOrdersNav();
        await orderBook.pause(1500);
        await orderBook.selectRegularTab();
    }
    await orderBook.tapStatusTab('Pending');
    const row = await orderBook.findOrderRow(r =>
        r.action === 'BUY' && r.symbol === symbol && r.price === lower && r.totalQty === NEW_QTY, 20000);
    console.log(`Order Book row shows qty ${NEW_QTY} (${row ? `"${row.raw}"` : 'no matching row'}): ${row ? 'PASS' : 'FAIL'}`);
    if (!row) return;
    const after = await orderBook.openOrderDetails(row.raw);
    if (!after) {
        console.log('Order details popup did not open after the modification: FAIL');
        return;
    }
    printOrderDetails(after);
    const check = (label, ok) => console.log(`${label}: ${ok ? 'PASS' : 'FAIL'}`);
    check(`Quantity updated to ${NEW_QTY} ("${after.filledQty} of ${after.totalQty}")`, after.totalQty === NEW_QTY);
    check(`Same order - Order ID ${after.fields['Order ID']} = ${orderId}`, after.fields['Order ID'] === orderId);
    check(`Order Price unchanged at ${lower} ("${after.fields['Order Price']}")`, Number(after.fields['Order Price']) === lower);
    check(`Order Value updated to ${NEW_QTY} x ${lower} ("${after.fields['Order Value']}")`,
        Math.abs(Number(String(after.fields['Order Value']).replace(/,/g, '')) - NEW_QTY * lower) < 0.01);
    check(`Status still Pending ("${after.status}")`, /pending/i.test(after.status || ''));
    console.log(`Order details - Exchange Order Time before "${od.fields['Exchange Order Time']}", after "${after.fields['Exchange Order Time']}" (logged)`);

    console.log(`Back on the Order Book after closing the order details: ${(await orderBook.closeOrderDetails()) ? 'PASS' : 'FAIL'}`);
}

// One status tab: tap it, then
//   - no orders listed -> "You don't have any <Tab> orders" is shown and the tab shows no count (0);
//   - orders listed    -> the empty message must not be shown, and the number of orders listed
//                         (whole list, scrolled) must not be greater than the tab's count.
// The visible badge itself is drawn inside the tab's merged a11y node, so "no count displayed"
// is checked as the count the app exposes for that tab being 0.
async function checkTab(orderBook, no, name) {
    tc(no, `Clicking the ${name} tab and verifying its orders / empty message and tab count...`);
    await orderBook.tapStatusTab(name);

    const rows = await orderBook.getOrderRows();
    const count = await orderBook.getTabCount(name);
    const message = await orderBook.getEmptyMessage();
    const expected = orderBook.expectedEmptyMessage(name);

    if (rows.length === 0) {
        console.log(`No orders listed in ${name}`);
        const msgOk = orderBook.emptyMessageMatches(message, name);
        console.log(`"${expected}" displayed (found "${message || 'nothing'}"): ${msgOk ? 'PASS' : 'FAIL'}`);
        console.log(`No order count displayed near the ${name} tab (count ${count}): ${count === 0 ? 'PASS' : 'FAIL'}`);
    } else {
        console.log(`Orders listed in ${name} (tab count ${count}) - empty-state checks not applicable`);
        console.log(`Empty message not displayed while orders are listed: ${message ? `FAIL (shows "${message}")` : 'PASS'}`);

        // The whole list, not just the first screen - scrolls down and back up.
        const allRows = await orderBook.collectAllOrderRows();
        allRows.slice(0, 3).forEach(r => console.log(`  - ${r}`));
        const countOk = count !== null && allRows.length <= count;
        console.log(`Listed orders (${allRows.length}) not greater than the ${name} tab count (${count}): ${countOk ? 'PASS' : 'FAIL'}`);
    }
}

async function run() {
    const driver = await DriverManager.getDriver();
    try {
        const splashPage = new SplashPage(driver);
        const orderBook = new OrderBookPage(driver);
        const marketsPage = new MarketsPage(driver);
        console.log(`Real order placement: ${PLACE_REAL_ORDERS ? 'ON (set PLACE_REAL_ORDERS=0 to disable)' : 'OFF (PLACE_REAL_ORDERS=0)'}`);

        tc(1, 'Launching the app...');
        await splashPage.launch();
        await splashPage.pause(3000);
        await permissionHandler.dismissAllPermissions(driver);

        tc(2, 'Verifying the app is on the Order Book (clicking Orders in the bottom navigation if not)...');
        let onOrderBook = await orderBook.isOnOrderBook(3000);
        if (onOrderBook) {
            console.log('App is already on the Order Book');
        } else {
            // The app resumes where the previous run left it (noReset) - e.g. on search or a
            // Quote, with no bottom navigation - so back out to it first.
            await backToBottomNav(driver, orderBook, marketsPage);
            await orderBook.clickOrdersNav();
            await orderBook.pause(1500);
            await orderBook.selectRegularTab();
            onOrderBook = await orderBook.isOnOrderBook(10000);
        }
        console.log(`Order Book displayed: ${onOrderBook ? 'PASS' : 'FAIL'}`);
        if (!onOrderBook) throw new Error('Order Book did not open');

        const tabs = await orderBook.getStatusTabs();
        console.log(`Tab counts: ${tabs.map(t => `${t.name} ${t.count}`).join(', ')}`);

        for (const [i, name] of orderBook.tabs.entries()) {
            try {
                await checkTab(orderBook, 3 + i, name);
            } catch (err) {
                console.error(`${name} tab check failed:`, err.message);
            }
        }

        try {
            await placeNseLowerCircuitOrder(driver, {
                orderBook,
                marketsPage,
                quotesPage: new QuotesPage(driver),
                orderPadPage: new OrderPadPage(driver),
            });
        } catch (err) {
            console.error('NSE lower-circuit order failed:', err.message);
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
