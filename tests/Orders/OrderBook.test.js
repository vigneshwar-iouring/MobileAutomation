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
// live account trading real money: with it on, TC 13 / TC 33 tap CONFIRM on the NSE lower-circuit
// Delivery / Intraday BUYs, and TC 21 / TC 25 modify and cancel the Delivery one (only inside NSE
// hours). With it off, each order stops at the Confirmation Preview and closes it with back -
// CONFIRM is never tapped and every later step is skipped.
const PLACE_REAL_ORDERS = process.env.PLACE_REAL_ORDERS !== '0';

// NSE symbol, same as tests/Orders/Orderpad.test.js: RTNPOWER's first search result is its NSE
// listing. Override with NSE_QUERY / NSE_POSITION.
const NSE = {
    query: process.env.NSE_QUERY || 'RTNPOWER',
    position: Number(process.env.NSE_POSITION) || 1,
};

// Trading hours, same as Regression/New_Regression.spec.js's MARKET_HOURS / skipIfMarketClosed
// (ported, not imported - that file is a Mocha spec). IST, Mon-Fri, [open, close) in minutes
// after midnight: exactly the close time is outside. Exchange holidays are not known here, so a
// weekday holiday still runs. Outside the window the order flows are skipped before anything is
// attempted, and re-checked just before CONFIRM in case the close passes mid-run.
const MARKET_HOURS = { NSE: { open: 9 * 60 + 15, close: 15 * 60 + 30 } };

function nowInIST() {
    const parts = Object.fromEntries(new Intl.DateTimeFormat('en-GB', {
        timeZone: 'Asia/Kolkata', weekday: 'short', hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
    }).formatToParts(new Date()).map(p => [p.type, p.value]));
    return { weekday: parts.weekday, minutes: Number(parts.hour) * 60 + Number(parts.minute), label: `${parts.weekday} ${parts.hour}:${parts.minute} IST` };
}

const fmtMinutes = m => `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;

// null while `segment` is open, else the "Market closed - unable to place orders (...)" message.
function marketClosedMessage(segment) {
    const { open, close } = MARKET_HOURS[segment];
    const now = nowInIST();
    const weekend = now.weekday === 'Sat' || now.weekday === 'Sun';
    if (!weekend && now.minutes >= open && now.minutes < close) return null;
    return `Market closed - unable to place orders (${segment} trades ${fmtMinutes(open)}-${fmtMinutes(close)} IST, Mon-Fri; now ${now.label})`;
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
// TC 23-26 Cancel (REAL order, matched by Order ID): 23 Cancel -> "Are you sure...?" Yes / No |
//   24 No -> order unchanged | 25 Cancel -> Yes -> OK popup -> OK | 26 the order turns Cancelled
//   by itself (then confirmed in ALL)
// TC 27-35 the same as TC 7-15 with Intraday selected, up to the order being placed and listed as
//   pending (its details checked for Product INTRADAY).
// All order flows are skipped outside NSE hours (09:15-15:30 IST, Mon-Fri) - "Market closed -
// unable to place orders" - as the Regression suite does.
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
// `product` is the Order Pad product ('Delivery' / 'Intraday'); `firstTc` numbers its steps
// (TC 7-15 for the first run). `full` = continue into order details / Modify / Cancel (TC 16-26);
// otherwise stop once the order is placed and listed as pending.
async function placeNseLowerCircuitOrder(driver, pages, { product = 'Delivery', firstTc = 7, full = true } = {}) {
    const { orderBook, marketsPage, quotesPage, orderPadPage } = pages;
    const T = n => n - 7 + firstTc;
    console.log(`\n========== NSE lower-circuit BUY - ${product} ==========`);

    tc(T(7), 'Navigating to Markets...');
    await marketsPage.clickMarketNavButton();
    if (!(await marketsPage.waitForEquityLoaded(10000))) throw new Error('Markets screen did not load');
    await marketsPage.scrollToTop();

    tc(T(8), `Searching "${NSE.query}", opening result #${NSE.position} and verifying its NSE Quote opens...`);
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

    tc(T(9), 'Expanding the Quote and reading the lower circuit...');
    if (!(await quotesPage.swipeUpQuoteScreen())) throw new Error('Quote screen did not expand');
    const limits = await quotesPage.getCircuitLimits();
    if (!limits) throw new Error('Could not read circuit limits from the Quote screen');
    const lower = Number(limits.lower);

    tc(T(10), 'Clicking BUY on the Quote and verifying the Buy Order Pad opens...');
    await quotesPage.clickBuy();
    if (!(await orderPadPage.verifyOpenedFor('Buy'))) throw new Error('Buy Order Pad did not open');

    tc(T(11), `Selecting ${product} and entering the lower circuit (${lower}) in Price...`);
    const productState = await orderPadPage.getProductState(product);
    if (!productState.actionable) throw new Error(`${product} is not offered on the Order Pad`);
    await orderPadPage.selectProduct(product);
    await orderPadPage.ensureLimitMode();
    if (!(await orderPadPage.setPrice(limits.lower))) throw new Error(`Price field did not take the lower circuit ${lower}`);
    await orderPadPage.hideKeyboardIfShown();

    tc(T(12), 'Clicking BUY and verifying the Confirmation Preview shows the lower circuit price on NSE...');
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
    const productOk = String(details['Product Type'] || '').toLowerCase() === product.toLowerCase();
    console.log(`Confirmation price ${details.Price} matches lower circuit ${lower}: ${priceOk ? 'PASS' : 'FAIL'}`);
    console.log(`Confirmation exchange ${details.Exchange} is NSE: ${exOk ? 'PASS' : 'FAIL'}`);
    console.log(`Confirmation product ${details['Product Type']} is ${product}: ${productOk ? 'PASS' : 'FAIL'}`);
    if (!priceOk || !exOk || !productOk) {
        await orderPadPage.dismissConfirmationPopup();
        throw new Error('Confirmation Preview does not match the intended order - refusing to tap CONFIRM');
    }

    const closedNow = marketClosedMessage('NSE');
    if (!PLACE_REAL_ORDERS || closedNow) {
        tc(T(13), `${!PLACE_REAL_ORDERS ? 'PLACE_REAL_ORDERS is off' : closedNow} - closing the Confirmation Preview without confirming...`);
        await orderPadPage.dismissConfirmationPopup();
        console.log(`TC ${T(14)}-${full ? 26 : T(15)} skipped - no order placed`);
        return;
    }

    tc(T(13), `Tapping CONFIRM - placing a REAL NSE ${product} BUY order: ${symbol} x ${details.Quantity} @ ${lower}...`);
    const confirmedAt = Date.now();
    await orderPadPage.tapConfirm();

    tc(T(14), 'Reading the order status popup and verifying its buttons...');
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

    tc(T(15), `Opening the Order Book and verifying the ${symbol} BUY @ ${lower} order and its status...`);
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
        if (full) console.log('TC 16-26 skipped - the order was rejected, so it is not pending and has no Modify / Cancel');
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

    if (!full) {
        // Placement only: confirm the listed order is the one just placed, with this product.
        const placed = await orderBook.openOrderDetails(pendingRow.raw);
        if (!placed) {
            console.log('Order details popup did not open: FAIL');
            return;
        }
        printOrderDetails(placed);
        const prodOk = String(placed.fields['Product'] || '').toLowerCase() === product.toLowerCase();
        console.log(`Order placed as ${product} (Product "${placed.fields['Product']}", Order ID ${placed.fields['Order ID']}): ${prodOk ? 'PASS' : 'FAIL'}`);
        console.log(`Back on the Order Book after closing the order details: ${(await orderBook.closeOrderDetails()) ? 'PASS' : 'FAIL'}`);
        return;
    }

    const od = await verifyPendingOrderDetails(orderBook, pendingRow, { symbol, lower, quantity: Number(details.Quantity), confirmedAt });
    if (!od) return;
    const orderId = od.fields['Order ID'];
    if (!od.buttons.modify) {
        console.log('TC 19-22 skipped - no Modify button on the order details');
        await orderBook.closeOrderDetails();
    } else {
        // A failed Modify must not stop the Cancel below - the real order is cancelled either way.
        try {
            await modifyPendingOrder(driver, pages, od, { symbol, lower });
        } catch (err) {
            console.error('Modify failed:', err.message);
        }
    }
    await cancelPendingOrder(driver, pages, { symbol, lower, orderId });
}

// Pending tab -> the row of order `orderId`: rows don't show the Order ID, so each BUY row for
// the symbol at the price is opened until its details match. Leaves those details open.
async function openPendingOrderById(orderBook, { symbol, lower, orderId }) {
    // An open details sheet hides the tab row (only its own nodes are in the tree) - close it first.
    await orderBook.closeOrderDetails();
    if (!(await orderBook.isOnOrderBook(3000))) return null;
    await orderBook.tapStatusTab('Pending');
    const candidates = (await orderBook.getParsedOrderRows())
        .filter(r => r.action === 'BUY' && r.symbol === symbol && r.price === lower);
    for (const r of candidates) {
        const d = await orderBook.openOrderDetails(r.raw);
        if (d && d.fields['Order ID'] === orderId) return d;
        await orderBook.closeOrderDetails();
    }
    return null;
}

// TC 23-26: Cancel -> "Are you sure...?" No (nothing changes), then Cancel -> Yes -> OK, and the
// order must turn Cancelled on its own.
// CANCELS a REAL order - only the one this run placed (matched by Order ID).
async function cancelPendingOrder(driver, pages, { symbol, lower, orderId }) {
    const { orderBook, marketsPage } = pages;

    tc(23, `Opening order ${orderId}, clicking Cancel and verifying the cancel confirmation (Yes / No)...`);
    if (!(await orderBook.isOnOrderBook(3000))) {
        if (!(await backToBottomNav(driver, orderBook, marketsPage))) throw new Error('Could not get back to the bottom navigation');
        await orderBook.clickOrdersNav();
        await orderBook.pause(1500);
        await orderBook.selectRegularTab();
    }
    const od = await openPendingOrderById(orderBook, { symbol, lower, orderId });
    if (!od) throw new Error(`Pending order ${orderId} not found to cancel`);
    console.log(`Order ${orderId} details open (status ${od.status}, qty ${od.filledQty} of ${od.totalQty}): PASS`);
    if (!od.buttons.cancel) throw new Error('No Cancel button on the order details');
    const dialog = await orderBook.tapCancelOnDetails(od);
    console.log(`Cancel confirmation displayed ("${dialog ? dialog.question.desc : 'not shown'}"): ${dialog ? 'PASS' : 'FAIL'}`);
    if (!dialog) throw new Error('Cancel confirmation did not appear');
    console.log(`Yes and No buttons displayed (Yes ${dialog.yes ? 'shown' : 'not shown'}, No ${dialog.no ? 'shown' : 'not shown'}): ${dialog.yes && dialog.no ? 'PASS' : 'FAIL'}`);
    if (!dialog.yes || !dialog.no) throw new Error('Yes / No missing on the cancel confirmation');

    tc(24, 'Clicking No and verifying no changes were made to the order...');
    console.log(`Cancel confirmation closed after No: ${(await orderBook.answerCancelNo(dialog)) ? 'PASS' : 'FAIL'}`);
    if (!(await orderBook.isOnOrderBook(3000))) await orderBook.closeOrderDetails();
    const afterNo = await openPendingOrderById(orderBook, { symbol, lower, orderId });
    console.log(`Order ${orderId} still listed in the Pending tab after No: ${afterNo ? 'PASS' : 'FAIL'}`);
    if (!afterNo) throw new Error(`Order ${orderId} not found in Pending after answering No`);
    const same = (label, a, b) => console.log(`${label} unchanged ("${b}"): ${a === b ? 'PASS' : `FAIL (was "${a}")`}`);
    same('Status', od.status, afterNo.status);
    same('Quantity', `${od.filledQty} of ${od.totalQty}`, `${afterNo.filledQty} of ${afterNo.totalQty}`);
    for (const k of ['Order Price', 'Exchange', 'Product', 'Order Type', 'Order Time', 'Exchange Order Number', 'Exchange Order Time']) {
        same(k, od.fields[k], afterNo.fields[k]);
    }
    console.log(`Modify and Cancel still offered after No: ${afterNo.buttons.modify && afterNo.buttons.cancel ? 'PASS' : 'FAIL'}`);

    tc(25, `Clicking Cancel then Yes - CANCELLING the REAL order ${orderId} - and clicking OK on the popup...`);
    const dialog2 = await orderBook.tapCancelOnDetails(afterNo);
    if (!dialog2 || !dialog2.yes) throw new Error('Cancel confirmation did not appear the second time');
    const ack = await orderBook.confirmCancelAndAcknowledge(dialog2);
    console.log(`Cancel popup with OK displayed ("${ack.message || 'no message read'}"): ${ack.okShown ? 'PASS' : 'FAIL'}`);

    tc(26, `Verifying order ${orderId} automatically changes to Cancelled...`);
    // "Automatically": the open list updates by itself - no tab switch / refresh for 10s. The
    // Pending tab must drop the order (or the row turns Cancelled in place).
    const matches = r => r.action === 'BUY' && r.symbol === symbol && r.price === lower;
    let auto = false;
    const pendingBefore = (await orderBook.getParsedOrderRows()).filter(matches).length;
    try {
        await driver.waitUntil(async () => {
            const rows = (await orderBook.getParsedOrderRows()).filter(matches);
            auto = rows.some(r => /cancel/i.test(r.status)) || rows.filter(r => /pending/i.test(r.status)).length < Math.max(pendingBefore, 1);
            return auto;
        }, { timeout: 10000, interval: 1000 });
    } catch (_) { /* not updated by itself */ }
    console.log(`Order Book updated by itself after the cancel (no manual refresh): ${auto ? 'PASS' : 'FAIL'}`);

    // Then the definitive check: ALL tab, the row's details show this Order ID as Cancelled.
    await orderBook.tapStatusTab('ALL');
    const cancelledRows = (await orderBook.getParsedOrderRows()).filter(r => matches(r) && /cancel/i.test(r.status));
    let confirmed = null;
    for (const r of cancelledRows) {
        const d = await orderBook.openOrderDetails(r.raw);
        if (d && d.fields['Order ID'] === orderId) { confirmed = d; break; }
        await orderBook.closeOrderDetails();
    }
    if (!confirmed) {
        console.log(`Order ${orderId} listed as Cancelled in the ALL tab: FAIL`);
        (await orderBook.getOrderRows()).slice(0, 5).forEach(r => console.log(`  - ${r}`));
        return;
    }
    printOrderDetails(confirmed);
    console.log(`Order ${orderId} status changed to Cancelled ("${confirmed.status}"): ${/cancel/i.test(confirmed.status || '') ? 'PASS' : 'FAIL'}`);
    console.log(`Modify / Cancel no longer offered on the cancelled order: ${!confirmed.buttons.modify && !confirmed.buttons.cancel ? 'PASS' : 'FAIL'}`);
    console.log(`Back on the Order Book after closing the order details: ${(await orderBook.closeOrderDetails()) ? 'PASS' : 'FAIL'}`);
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
    // Live 2026-11-19 (after market close) the status popup read "Rejected" / "2 X RTNPOWER" with
    // "View Orderbook" and "Close" - no reason shown - and the order stayed unchanged at qty 1.
    const popup = await orderBook.readOrderStatusPopup(5000);
    if (popup) console.log(`Status after MODIFY: "${popup.status || 'unknown'}" ("${popup.message || ''}")`);
    const rejected = !!popup && popup.status === 'Rejected';
    console.log(`Modification accepted: ${rejected ? 'FAIL (Rejected by the exchange)' : 'PASS'}`);
    if (popup && popup.close) await orderBook.tapNode(popup.close);

    tc(22, `Verifying the order details show the modification (qty ${NEW_QTY}, same order and price)...`);
    if (!(await orderBook.isOnOrderBook(3000))) {
        if (!(await backToBottomNav(driver, orderBook, marketsPage))) throw new Error('Could not get back to the bottom navigation');
        await orderBook.clickOrdersNav();
        await orderBook.pause(1500);
        await orderBook.selectRegularTab();
    }
    await orderBook.tapStatusTab('Pending');
    if (rejected) {
        // A rejected modification must leave the order exactly as it was.
        const same = await orderBook.findOrderRow(r =>
            r.action === 'BUY' && r.symbol === symbol && r.price === lower && r.totalQty === oldQty, 10000);
        console.log(`Rejected modification left the order unchanged at qty ${oldQty} (${same ? `"${same.raw}"` : 'no matching row'}): ${same ? 'PASS' : 'FAIL'}`);
        return;
    }
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

        const pages = {
            orderBook,
            marketsPage,
            quotesPage: new QuotesPage(driver),
            orderPadPage: new OrderPadPage(driver),
        };
        // Order flows: Delivery (TC 7-26: place, details, modify, cancel), then Intraday (TC 27-35:
        // the same up to the order being placed and listed as pending). Skipped outright outside
        // NSE hours - as Regression's skipIfMarketClosed - so no order is attempted on a closed market.
        const runs = [
            { product: 'Delivery', firstTc: 7, lastTc: 26, full: true },
            { product: 'Intraday', firstTc: 27, lastTc: 35, full: false },
        ];
        for (const r of runs) {
            const closed = marketClosedMessage('NSE');
            if (closed) {
                console.log(`\nTC ${r.firstTc}-${r.lastTc} (${r.product} order) skipped - ${closed}`);
                continue;
            }
            try {
                if (!(await backToBottomNav(driver, orderBook, marketsPage))) throw new Error('Could not get back to the bottom navigation');
                await placeNseLowerCircuitOrder(driver, pages, r);
            } catch (err) {
                console.error(`NSE lower-circuit ${r.product} order failed:`, err.message);
            }
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
