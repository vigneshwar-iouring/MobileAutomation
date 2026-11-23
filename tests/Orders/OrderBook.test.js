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
// Delivery / Intraday BUYs, TC 21 / TC 25 modify and cancel the NSE Delivery one, TC 42 / TC 51
// tap CONFIRM on the BSE lower-circuit Delivery / Intraday BUYs, TC 60 / TC 69 on the NFO
// Carryforward / Intraday BUYs, TC 78 on the BFO Carryforward BUY, TC 87 / TC 96 on the MCX and
// TC 105 / TC 114 on the CDS Carryforward / Intraday BUYs (only inside each exchange's hours), and
// TC 126 cancels every pending order (Cancel All -> Yes).
// With it off, each order stops at the Confirmation Preview and closes it with back - CONFIRM is
// never tapped and every later step is skipped; Cancel All is answered No.
const PLACE_REAL_ORDERS = process.env.PLACE_REAL_ORDERS !== '0';

// BULK_ONLY=1 runs just TC 1-2 and the Convert to Market / Cancel All flow (TC 117-127) on whatever
// is already pending - no tab checks, no new orders.
const BULK_ONLY = process.env.BULK_ONLY === '1';

// SEARCH_ONLY=1 runs just TC 1-2 and the Order Book search (TC 128) - no tab checks, no orders,
// no Convert to Market / Cancel All.
const SEARCH_ONLY = process.env.SEARCH_ONLY === '1';

// SEGMENTS=MCX,CDS runs just TC 1-2 and those exchanges' order flows - no tab checks (TC 3-6),
// no other exchanges, and no Convert to Market / Cancel All (TC 117-127).
const SEGMENTS = (process.env.SEGMENTS || '').toUpperCase().split(',').map(s => s.trim()).filter(Boolean);

// Symbols, same as tests/Orders/Orderpad.test.js: RTNPOWER's first search result is its NSE
// listing; IDEA's second result is its BSE listing. The NFO/BFO option contracts and the MCX
// NATGASMINI future are the same ones (strikes drift with the market). Override with
// <EXCHANGE>_QUERY / _POSITION, e.g. NFO_QUERY="NIFTY 26000 CE". CDS isn't searched: Markets ->
// Currency -> first Top Gainers symbol (Top Losers if none) - unless CDS_QUERY is set.
const SYMBOLS = {
    NSE: { query: process.env.NSE_QUERY || 'RTNPOWER', position: Number(process.env.NSE_POSITION) || 1 },
    BSE: { query: process.env.BSE_QUERY || 'IDEA', position: Number(process.env.BSE_POSITION) || 2 },
    NFO: { query: process.env.NFO_QUERY || 'NIFTY 25100 CE', position: Number(process.env.NFO_POSITION) || 1 },
    BFO: { query: process.env.BFO_QUERY || 'SENSEX 77100 CE', position: Number(process.env.BFO_POSITION) || 1 },
    MCX: { query: process.env.MCX_QUERY || 'NATGASMINI', position: Number(process.env.MCX_POSITION) || 1 },
    CDS: process.env.CDS_QUERY
        ? { query: process.env.CDS_QUERY, position: Number(process.env.CDS_POSITION) || 1 }
        : { source: 'currencyMovers' },
};

// Segments where this account's orders are normally rejected, with why. A rejection there is
// logged as the expected outcome (its pending checks are skipped, as for any rejected order).
// Live 2026-11-20: CDS "Fresh Buy order in CarryForward /COMMON product not allowed in CRP ..." -
// the account has no funds available for currency trading.
const EXPECTED_REJECTION = {
    CDS: 'no funds available on this account to trade CDS',
};

// Product names compared ignoring case and spaces: the pad says "Carryforward", the order details
// "CARRY FORWARD".
const sameProduct = (a, b) => String(a || '').replace(/\s/g, '').toLowerCase() === String(b || '').replace(/\s/g, '').toLowerCase();

// Trading hours, same as Regression/New_Regression.spec.js's MARKET_HOURS / skipIfMarketClosed
// (ported, not imported - that file is a Mocha spec). IST, Mon-Fri, [open, close) in minutes
// after midnight: exactly the close time is outside. Exchange holidays are not known here, so a
// weekday holiday still runs. Outside the window the order flows are skipped before anything is
// attempted, and re-checked just before CONFIRM in case the close passes mid-run.
const MARKET_HOURS = {
    NSE: { open: 9 * 60 + 15, close: 15 * 60 + 30 },
    BSE: { open: 9 * 60 + 15, close: 15 * 60 + 30 },
    NFO: { open: 9 * 60 + 15, close: 15 * 60 + 40 },
    BFO: { open: 9 * 60 + 15, close: 15 * 60 + 40 },
    MCX: { open: 9 * 60, close: 17 * 60 },
    CDS: { open: 9 * 60, close: 17 * 60 },
};

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
//   pending (its details checked for Product INTRADAY) - but TC 27-30 open the Order Pad from the
//   NSE Delivery order's Repeat Order instead of searching: 27 Order Book -> that order (by Order
//   ID) with Repeat Order | 28 Repeat Order -> Buy Order Pad | 29 same symbol on NSE | 30 prefilled
//   qty / price. Falls back to the search steps when no NSE Delivery order was placed this run.
// TC 36-44 the same as TC 27-35 on BSE with Delivery selected (details checked for Exchange BSE,
//   Product DELIVERY); TC 45-53 the same on BSE with Intraday selected.
// TC 54-62 / 63-71 the same on an NFO option with Carryforward / Intraday selected; TC 72-80 on a
//   BFO option with Carryforward selected (quantity = the pad's default, one lot).
// TC 81-89 / 90-98 the same on the MCX future with Carryforward / Intraday selected; TC 99-107 /
//   108-116 on a CDS contract (Currency Top Gainers / Losers) with Carryforward / Intraday.
// TC 117-127 Convert to Market / Cancel All on the Pending tab (see bulkActionsOnPending).
// TC 128 Order Book search bar -> "RTNPOWER" -> the symbol is listed (see searchOrderBook).
// Each order flow is skipped outside its exchange's hours (NSE/BSE 09:15-15:30, NFO/BFO
// 09:15-15:40, MCX/CDS 09:00-17:00 IST, Mon-Fri) -
// "Market closed - unable to place orders" - as the Regression suite does.
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

// BUY at the Quote's own lower circuit (a genuine in-range price far below LTP, so the order rests
// as pending rather than filling), then its status on the popup and in the Order Book.
// `exchange` is 'NSE' / 'BSE' (symbol from SYMBOLS); `product` is the Order Pad product
// ('Delivery' / 'Intraday'); `firstTc` numbers its steps (TC 7-15 for the first run). `full` =
// continue into order details / Modify / Cancel (TC 16-26); otherwise stop once the order is
// placed and listed as pending.
// `repeatOf` = { symbol, lower, orderId } of an order this run placed: instead of searching the
// symbol again, the Order Pad is opened from that order's Repeat Order in the Order Book.
async function placeLowerCircuitOrder(driver, pages, { exchange = 'NSE', product = 'Delivery', firstTc = 7, full = true, repeatOf = null } = {}) {
    const { orderPadPage } = pages;
    const T = n => n - 7 + firstTc;
    console.log(`\n========== ${exchange} lower-circuit BUY - ${product}${repeatOf ? ' (Repeat Order)' : ''} ==========`);

    // TC 7-10: get to a Buy Order Pad for the symbol, knowing its lower circuit.
    const { symbol, lower, lowerText } = repeatOf
        ? await openPadByRepeatOrder(driver, pages, { exchange, T, repeatOf })
        : await openPadFromQuote(pages, { exchange, T });

    tc(T(11), `Selecting ${product} and entering the lower circuit (${lower}) in Price...`);
    const productState = await orderPadPage.getProductState(product);
    if (!productState.actionable) throw new Error(`${product} is not offered on the Order Pad`);
    await orderPadPage.selectProduct(product);
    await orderPadPage.ensureLimitMode();
    if (!(await orderPadPage.setPrice(lowerText))) throw new Error(`Price field did not take the lower circuit ${lower}`);
    await orderPadPage.hideKeyboardIfShown();

    await submitLowerCircuitOrder(driver, pages, { exchange, product, T, full, symbol, lower });
}

// TC 7-10 the search way: Markets -> search -> Quote on `exchange` -> lower circuit -> BUY.
async function openPadFromQuote(pages, { exchange, T }) {
    const { marketsPage, quotesPage, orderPadPage } = pages;
    const { query, position, source } = SYMBOLS[exchange];

    tc(T(7), 'Navigating to Markets...');
    await marketsPage.clickMarketNavButton();
    if (!(await marketsPage.waitForEquityLoaded(10000))) throw new Error('Markets screen did not load');
    await marketsPage.scrollToTop();

    if (source === 'currencyMovers') {
        tc(T(8), `Clicking Currency and the first Top Gainers symbol (Top Losers if none), verifying its ${exchange} Quote opens...`);
        if (!(await marketsPage.openFirstCurrencyGainerOrLoser())) {
            throw new Error('No Currency Top Gainers/Top Losers symbol could be opened');
        }
    } else {
        tc(T(8), `Searching "${query}", opening result #${position} and verifying its ${exchange} Quote opens...`);
        if (!(await marketsPage.clickGlobalSearchBar())) throw new Error('Global search did not open');
        await marketsPage.typeInSearch(query);
        const searched = await marketsPage.tapSearchResult(query, position);
        if (!searched || !(await marketsPage.verifyQuoteOpened(searched))) {
            throw new Error(`Quote did not open for "${query}" result #${position}`);
        }
    }
    const header = await quotesPage.getQuoteHeader();
    const exchangeOk = header && header.exchange === exchange;
    console.log(`Quote opened on ${header ? header.exchange : 'unknown exchange'} (expected ${exchange}): ${exchangeOk ? 'PASS' : 'FAIL'}`);
    if (!exchangeOk) throw new Error(`Opened symbol is not a ${exchange} symbol - set ${exchange}_QUERY / ${exchange}_POSITION`);
    const symbol = header.symbol;

    tc(T(9), 'Expanding the Quote and reading the lower circuit...');
    if (!(await quotesPage.swipeUpQuoteScreen())) throw new Error('Quote screen did not expand');
    const limits = await quotesPage.getCircuitLimits();
    if (!limits) throw new Error('Could not read circuit limits from the Quote screen');
    const lower = Number(limits.lower);

    tc(T(10), 'Clicking BUY on the Quote and verifying the Buy Order Pad opens...');
    await quotesPage.clickBuy();
    if (!(await orderPadPage.verifyOpenedFor('Buy'))) throw new Error('Buy Order Pad did not open');
    return { symbol, lower, lowerText: limits.lower };
}

// TC 7-10 the Repeat Order way: Order Book ALL tab -> the earlier order (by Order ID) -> Repeat
// Order -> a Buy Order Pad for the same symbol, prefilled from that order. Its price is the
// lower circuit the earlier order was placed at.
async function openPadByRepeatOrder(driver, pages, { exchange, T, repeatOf }) {
    const { orderBook, marketsPage, orderPadPage } = pages;
    const { symbol, lower, orderId } = repeatOf;

    tc(T(7), `Opening the Order Book and order ${orderId} (${symbol} BUY @ ${lower}) and verifying Repeat Order is shown...`);
    if (!(await orderBook.isOnOrderBook(3000))) {
        if (!(await backToBottomNav(driver, orderBook, marketsPage))) throw new Error('Could not get back to the bottom navigation');
        await orderBook.clickOrdersNav();
        await orderBook.pause(1500);
        await orderBook.selectRegularTab();
        if (!(await orderBook.isOnOrderBook(10000))) throw new Error('Order Book did not open');
    }
    const od = await openOrderById(orderBook, { tab: 'ALL', symbol, lower, orderId });
    if (!od) throw new Error(`Order ${orderId} not found in the Order Book ALL tab to repeat`);
    printOrderDetails(od);
    console.log(`Order ${orderId} details open (status ${od.status}): PASS`);
    console.log(`Repeat Order button displayed: ${od.buttons.repeat ? 'PASS' : 'FAIL'}`);
    if (!od.buttons.repeat) throw new Error(`No Repeat Order on order ${orderId} (status ${od.status})`);

    tc(T(8), 'Clicking Repeat Order and verifying the Buy Order Pad opens...');
    await orderBook.tapNode(od.buttons.repeat);
    if (!(await orderPadPage.verifyOpenedFor('Buy'))) throw new Error('Buy Order Pad did not open from Repeat Order');

    tc(T(9), `Verifying the Order Pad is for ${symbol} on ${exchange}...`);
    const shown = await orderPadPage.getDisplayedSymbol();
    const symbolOk = shown === symbol;
    console.log(`Order Pad symbol "${shown || 'not shown'}" is ${symbol}: ${symbolOk ? 'PASS' : 'FAIL'}`);
    if (!symbolOk) throw new Error(`Repeat Order opened the pad for "${shown}", not ${symbol}`);
    // Logged only - the Confirmation Preview's exchange is checked before CONFIRM regardless.
    await orderPadPage.verifyExchangeSelected(exchange);

    tc(T(10), `Verifying the Order Pad is prefilled from order ${orderId} (qty ${od.totalQty}, price ${lower})...`);
    const padQty = await orderPadPage.getQuantity();
    const padPrice = await orderPadPage.getPrice();
    console.log(`Quantity prefilled "${padQty}" = ${od.totalQty}: ${Number(padQty) === od.totalQty ? 'PASS' : 'FAIL'}`);
    console.log(`Price prefilled "${padPrice}" = ${lower}: ${Number(padPrice) === lower ? 'PASS' : 'FAIL'}`);
    return { symbol, lower, lowerText: String(lower) };
}

// TC 12-15 (and 16-26 when `full`): BUY -> Confirmation Preview checks -> CONFIRM (gated) ->
// status popup -> the order in the Order Book.
async function submitLowerCircuitOrder(driver, pages, { exchange, product, T, full, symbol, lower }) {
    const { orderBook, marketsPage, orderPadPage } = pages;

    tc(T(12), `Clicking BUY and verifying the Confirmation Preview shows the lower circuit price on ${exchange}...`);
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
    const exOk = details.Exchange === exchange;
    const productOk = sameProduct(details['Product Type'], product);
    console.log(`Confirmation price ${details.Price} matches lower circuit ${lower}: ${priceOk ? 'PASS' : 'FAIL'}`);
    console.log(`Confirmation exchange ${details.Exchange} is ${exchange}: ${exOk ? 'PASS' : 'FAIL'}`);
    console.log(`Confirmation product ${details['Product Type']} is ${product}: ${productOk ? 'PASS' : 'FAIL'}`);
    if (!priceOk || !exOk || !productOk) {
        await orderPadPage.dismissConfirmationPopup();
        throw new Error('Confirmation Preview does not match the intended order - refusing to tap CONFIRM');
    }

    const closedNow = marketClosedMessage(exchange);
    if (!PLACE_REAL_ORDERS || closedNow) {
        tc(T(13), `${!PLACE_REAL_ORDERS ? 'PLACE_REAL_ORDERS is off' : closedNow} - closing the Confirmation Preview without confirming...`);
        await orderPadPage.dismissConfirmationPopup();
        console.log(`TC ${T(14)}-${full ? 26 : T(15)} skipped - no order placed`);
        return;
    }

    tc(T(13), `Tapping CONFIRM - placing a REAL ${exchange} ${product} BUY order: ${symbol} x ${details.Quantity} @ ${lower}...`);
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
    // Rejected - by the popup or, when the popup wasn't caught, by the Order Book row itself: it
    // will never be pending, so log why (the details' Reject Reason) and stop here.
    if (popupStatus === 'Rejected' || /rejected/i.test(row.status)) {
        if (popupStatus === 'Rejected') {
            const same = /rejected/i.test(row.status);
            console.log(`Order Book status "${row.status}" matches the popup's Rejected: ${same ? 'PASS' : 'FAIL'}`);
        }
        const rd = await orderBook.openOrderDetails(row.raw).catch(() => null);
        if (rd) {
            console.log(`Order ${rd.fields['Order ID'] || '?'} rejected - Reject Reason: "${rd.fields['Reject Reason'] || 'not shown'}"`);
            await orderBook.closeOrderDetails();
        }
        if (EXPECTED_REJECTION[exchange]) {
            console.log(`Rejection is expected on ${exchange} (${EXPECTED_REJECTION[exchange]}): PASS`);
        }
        console.log(`TC ${T(15)}${full ? '-26' : ''} pending checks skipped - the order was rejected, so it is not pending${full ? ' and has no Modify / Cancel' : ''}`);
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
        // Placement only: confirm the listed order is the one just placed, on this exchange with
        // this product. Rows show neither, and the same symbol @ the same price can be pending
        // more than once (e.g. BSE Delivery then BSE Intraday), so each candidate row is opened
        // until its details match.
        const isThis = d => d && d.fields['Exchange'] === exchange && sameProduct(d.fields['Product'], product);
        const candidates = (await orderBook.getParsedOrderRows())
            .filter(r => r.action === 'BUY' && r.symbol === symbol && r.price === lower);
        if (!candidates.length) candidates.push(pendingRow);
        let placed = null;
        let lastOpened = null;
        for (const r of candidates) {
            const d = await orderBook.openOrderDetails(r.raw);
            if (d) lastOpened = d;
            if (isThis(d)) { placed = d; break; }
            await orderBook.closeOrderDetails();
        }
        if (!lastOpened) {
            console.log('Order details popup did not open: FAIL');
            return;
        }
        printOrderDetails(placed || lastOpened);
        const f = (placed || lastOpened).fields;
        console.log(`Order placed on ${exchange} as ${product} (Exchange "${f['Exchange']}", Product "${f['Product']}", Order ID ${f['Order ID']}): ${placed ? 'PASS' : 'FAIL'}`);
        console.log(`Back on the Order Book after closing the order details: ${(await orderBook.closeOrderDetails()) ? 'PASS' : 'FAIL'}`);
        return;
    }

    const od = await verifyPendingOrderDetails(orderBook, pendingRow, { exchange, symbol, lower, quantity: Number(details.Quantity), confirmedAt });
    if (!od) return;
    const orderId = od.fields['Order ID'];
    placedOrders[`${exchange} ${product}`] = { symbol, lower, orderId };
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

// Orders this run placed, by "<exchange> <product>" -> { symbol, lower, orderId } (e.g. the NSE
// Delivery order, repeated for the NSE Intraday run).
const placedOrders = {};

// `tab` (Pending by default) -> the row of order `orderId`: rows don't show the Order ID, so each
// BUY row for the symbol at the price is opened until its details match. Leaves those details open.
async function openOrderById(orderBook, { tab = 'Pending', symbol, lower, orderId }) {
    // An open details sheet hides the tab row (only its own nodes are in the tree) - close it first.
    await orderBook.closeOrderDetails();
    if (!(await orderBook.isOnOrderBook(3000))) return null;
    await orderBook.tapStatusTab(tab);
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
    const od = await openOrderById(orderBook, { symbol, lower, orderId });
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
    const afterNo = await openOrderById(orderBook, { symbol, lower, orderId });
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
async function verifyPendingOrderDetails(orderBook, row, { exchange = 'NSE', symbol, lower, quantity, confirmedAt }) {
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
    check(`Exchange is ${exchange}`, f['Exchange'] === exchange, f['Exchange']);
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

// ---- TC 117-127: Convert to Market / Cancel All on the Pending tab ----
// (Written below as steps 81-91, numbered through B(): B(81) = TC 117.)
// 81 Pending tab -> Convert to Market -> selection mode | 82 first checkbox select + unselect |
// 83 Select All -> every checkbox selected | 84 Convert -> Yes / No confirmation shown (neither
// tapped) | 85 confirmation closed with back, nothing converted; Cancel All -> cancel selection
// mode | 86 first checkbox select + unselect | 87 Select All, then Clear All -> none selected |
// 88 Select All + Cancel All -> Yes / No confirmation | 89 No -> nothing cancelled |
// 90 Cancel All -> Select All -> Cancel All -> Yes (CANCELS EVERY PENDING ORDER, gated on
// PLACE_REAL_ORDERS) | 91 Pending empties and every order that was pending is Cancelled.
const BULK_FIRST_TC = 117;
const B = n => n - 81 + BULK_FIRST_TC;
// The Convert confirmation is NEVER answered Yes - converting the resting lower-circuit BUYs to
// market would fill them.

async function openPendingTab(driver, orderBook, marketsPage) {
    // A selection mode left open (e.g. by an earlier run - the app resumes where it was) changes
    // the row labels; leave it first. Never with a Yes / No confirmation open.
    if (await orderBook.readYesNo()) await orderBook.dismissConfirmationWithBack();
    if (await orderBook.isInSelectionMode()) await orderBook.exitSelectionMode();
    if (!(await orderBook.isOnOrderBook(3000))) {
        await orderBook.closeOrderDetails();
        if (!(await orderBook.isOnOrderBook(2000))) {
            if (!(await backToBottomNav(driver, orderBook, marketsPage))) throw new Error('Could not get back to the bottom navigation');
            await orderBook.clickOrdersNav();
            await orderBook.pause(1500);
            await orderBook.selectRegularTab();
            if (!(await orderBook.isOnOrderBook(10000))) throw new Error('Order Book did not open');
        }
    }
    await orderBook.tapStatusTab('Pending');
}

const counterText = s => s.counter ? `counter "${s.counter.text}"` : 'no counter shown';

// Taps the first (fully drawn) order's checkbox, checks it and the counter went to selected,
// taps it again, checks it is unselected.
async function toggleFirstCheckbox(orderBook) {
    const before = await orderBook.getSelectionState();
    if (!before.boxes.length) throw new Error('No order checkboxes shown in selection mode');
    const first = before.boxes[0];
    const firstNow = s => s.boxes.find(b => b.label === first.label) || s.boxes[0];
    console.log(`${before.boxes.length} order(s) on screen; first "${first.label}" selected: ${first.checked} (${counterText(before)})`);
    await orderBook.tapCheckbox(first.node);
    const on = await orderBook.getSelectionState();
    const onOk = firstNow(on) && firstNow(on).checked && (!on.counter || !before.counter || on.counter.selected === before.counter.selected + 1);
    console.log(`First checkbox selected after tapping it (${counterText(on)}): ${onOk ? 'PASS' : 'FAIL'}`);
    await orderBook.tapCheckbox(first.node);
    const off = await orderBook.getSelectionState();
    const offOk = firstNow(off) && !firstNow(off).checked && (!off.counter || !before.counter || off.counter.selected === before.counter.selected);
    console.log(`First checkbox unselected after tapping it again (${counterText(off)}): ${offOk ? 'PASS' : 'FAIL'}`);
}

// Logs whether every order is selected (`want` true) / none is (false): the counter covers the
// whole list ("5/5" / "0/5"), the on-screen rows are checked one by one.
async function verifyAllBoxes(orderBook, want, what) {
    const s = await orderBook.getSelectionState();
    const n = s.boxes.filter(b => b.checked === want).length;
    const rowsOk = s.boxes.length > 0 && n === s.boxes.length;
    const counterOk = !s.counter || s.counter.selected === (want ? s.counter.total : 0);
    console.log(`${what}: ${n} of ${s.boxes.length} order(s) on screen ${want ? 'selected' : 'unselected'}, ${counterText(s)}: ${rowsOk && counterOk ? 'PASS' : 'FAIL'}`);
    return rowsOk && counterOk;
}

// Taps Select All (only when not everything is already selected - it may toggle) and verifies.
async function selectAll(orderBook) {
    const s = await orderBook.getSelectionState();
    if (!s.selectAll) throw new Error('Select All not shown in selection mode');
    const already = s.counter ? s.counter.selected === s.counter.total : (s.boxes.length > 0 && s.boxes.every(b => b.checked));
    if (already) {
        console.log('Every order is already selected - Select All not tapped again (it would unselect them)');
    } else {
        await orderBook.tapCheckbox(s.selectAll);
        console.log(`Tapped "${s.selectAll.label.split(',')[0]}"`);
    }
    const ok = await verifyAllBoxes(orderBook, true, 'After Select All');
    await orderBook.dumpPageSource('orderbook_bulk_select_all');
    return ok;
}

function logConfirmation(dialog, what) {
    console.log(`${what} confirmation displayed ("${dialog ? dialog.question || 'no message read' : 'not shown'}"): ${dialog ? 'PASS' : 'FAIL'}`);
    if (dialog) console.log(`Yes and No buttons displayed (Yes ${dialog.yes ? 'shown' : 'not shown'}, No ${dialog.no ? 'shown' : 'not shown'}): ${dialog.yes && dialog.no ? 'PASS' : 'FAIL'}`);
}

// Pending rows as "action|symbol|qty|price" keys (status left out) for before/after comparison.
const orderKey = r => `${r.action}|${r.symbol}|${r.totalQty}|${r.price}`;

// Leaves selection mode (back presses, only while checkboxes show) and re-reads the Pending tab:
// every order that was pending must still be there with the same status, qty and price.
async function verifyPendingUnchanged(driver, pages, before, what) {
    const { orderBook, marketsPage } = pages;
    if (await orderBook.isInSelectionMode()) await orderBook.exitSelectionMode();
    await openPendingTab(driver, orderBook, marketsPage);
    const after = (await orderBook.collectAllOrderRows()).map(r => orderBook.parseOrderRow(r)).filter(r => r.action);
    const missing = before.filter(b => !after.some(a => orderKey(a) === orderKey(b) && a.status === b.status));
    missing.forEach(b => console.log(`  changed / missing: ${b.raw}`));
    console.log(`Pending orders unchanged - ${what} (${before.length - missing.length} of ${before.length} still pending as before): ${missing.length ? 'FAIL' : 'PASS'}`);
}

async function bulkActionsOnPending(driver, pages) {
    const { orderBook, marketsPage } = pages;
    console.log('\n========== Pending tab - Convert to Market / Cancel All ==========');

    tc(B(81), 'Opening the Pending tab, clicking Convert to Market and verifying the selection checkboxes...');
    await openPendingTab(driver, orderBook, marketsPage);
    const pendingBefore = (await orderBook.collectAllOrderRows()).map(r => orderBook.parseOrderRow(r)).filter(r => r.action);
    // Identical orders collapse into one row text, so the tab counts are the real totals.
    const pendingCountBefore = await orderBook.getTabCount('Pending');
    const cancelledCountBefore = await orderBook.getTabCount('Cancelled');
    console.log(`Pending orders before: ${pendingCountBefore} (${pendingBefore.length} distinct), Cancelled before: ${cancelledCountBefore}`);
    pendingBefore.forEach(r => console.log(`  - ${r.raw}`));
    if (!pendingCountBefore && !pendingBefore.length) {
        console.log(`TC ${B(81)}-${B(91)} skipped - no pending orders, so Convert to Market / Cancel All have nothing to act on`);
        return;
    }
    const bulk = await orderBook.getBulkButtons();
    console.log(`Cancel All shown: ${bulk.cancelAll ? 'PASS' : 'FAIL'} | Convert to Market shown: ${bulk.convert ? 'PASS' : 'FAIL'}`);
    const convertMode = await orderBook.enterSelectionMode('convert');
    console.log(`Convert to Market selection mode (checkboxes + Select All) displayed: ${convertMode ? 'PASS' : 'FAIL'}`);
    if (!convertMode) throw new Error('Convert to Market selection mode did not open');

    tc(B(82), 'Selecting the first checkbox and unselecting it...');
    await toggleFirstCheckbox(orderBook);

    tc(B(83), 'Clicking Select All and verifying every order is selected...');
    await selectAll(orderBook);

    tc(B(84), 'Clicking Convert and verifying the confirmation with Yes and No (neither is tapped)...');
    const convertDialog = await orderBook.tapSelectionActionForConfirmation('convert');
    logConfirmation(convertDialog, 'Convert to Market');

    tc(B(85), 'Closing the confirmation without tapping Yes / No, then clicking Cancel All...');
    // Yes is NEVER tapped here. Back first; if the popup stays, No (it converts nothing).
    if (convertDialog && !(await orderBook.dismissConfirmationWithBack())) {
        const still = await orderBook.readYesNo();
        if (still && still.no) {
            console.log('Back did not close the confirmation - tapping No (never Yes)');
            await orderBook.tapNode(still.no);
            await orderBook.pause(1500);
        }
        if (await orderBook.readYesNo()) throw new Error('Convert to Market confirmation could not be closed - stopping, Yes not tapped');
    }
    console.log('Convert to Market confirmation closed without answering: PASS');
    await verifyPendingUnchanged(driver, pages, pendingBefore, 'nothing converted');
    const cancelMode = await orderBook.enterSelectionMode('cancel');
    console.log(`Cancel All selection mode (checkboxes + Select All) displayed: ${cancelMode ? 'PASS' : 'FAIL'}`);
    if (!cancelMode) throw new Error('Cancel All selection mode did not open');

    tc(B(86), 'Selecting the first checkbox and unselecting it...');
    await toggleFirstCheckbox(orderBook);

    tc(B(87), 'Clicking Select All, then Clear All, and verifying no order is selected...');
    await selectAll(orderBook);
    const clear = (await orderBook.getSelectionState()).clear;
    console.log(`Clear All displayed: ${clear ? 'PASS' : 'FAIL'}`);
    if (clear) {
        await orderBook.tapCheckbox(clear);
        await verifyAllBoxes(orderBook, false, 'After Clear All');
    }

    tc(B(88), 'Clicking Select All again, then Cancel All, and verifying the confirmation with Yes and No...');
    await selectAll(orderBook);
    const cancelDialog = await orderBook.tapSelectionActionForConfirmation('cancel');
    logConfirmation(cancelDialog, 'Cancel All');
    if (!cancelDialog || !cancelDialog.no) throw new Error('Cancel All confirmation with No did not appear');

    tc(B(89), 'Clicking No and verifying no order was cancelled...');
    await orderBook.tapNode(cancelDialog.no);
    await orderBook.pause(1500);
    console.log(`Confirmation closed after No: ${!(await orderBook.readYesNo()) ? 'PASS' : 'FAIL'}`);
    await verifyPendingUnchanged(driver, pages, pendingBefore, 'nothing cancelled');

    tc(B(90), 'Clicking Cancel All, Select All and Cancel All again, then Yes - CANCELLING EVERY PENDING ORDER...');
    if (!(await orderBook.enterSelectionMode('cancel'))) throw new Error('Cancel All selection mode did not open again');
    await selectAll(orderBook);
    const finalDialog = await orderBook.tapSelectionActionForConfirmation('cancel');
    logConfirmation(finalDialog, 'Cancel All');
    if (!finalDialog || !finalDialog.yes) throw new Error('Cancel All confirmation with Yes did not appear');
    if (!PLACE_REAL_ORDERS) {
        console.log('PLACE_REAL_ORDERS is off - answering No instead of cancelling the pending orders');
        if (finalDialog.no) await orderBook.tapNode(finalDialog.no);
        await orderBook.exitSelectionMode();
        console.log(`TC ${B(91)} skipped - nothing cancelled`);
        return;
    }
    await orderBook.tapNode(finalDialog.yes);
    const ack = await orderBook.acknowledgeIfShown();
    console.log(ack.okShown ? `Cancel All result popup ("${ack.message || 'no message read'}") acknowledged with OK` : 'No OK popup after Yes');

    tc(B(91), `Verifying every pending order (${pendingCountBefore}) is cancelled and changed to Cancelled...`);
    if (await orderBook.isInSelectionMode()) await orderBook.exitSelectionMode();
    await openPendingTab(driver, orderBook, marketsPage);
    let emptied = false;
    try {
        await driver.waitUntil(async () => {
            emptied = (await orderBook.getParsedOrderRows()).filter(r => r.action).length === 0;
            if (!emptied) await orderBook.tapStatusTab('Pending');
            return emptied;
        }, { timeout: 20000, interval: 2000 });
    } catch (_) { /* still listed */ }
    const message = await orderBook.getEmptyMessage();
    console.log(`Pending tab empty ("${message || 'no empty message'}"): ${emptied ? 'PASS' : 'FAIL'}`);
    if (!emptied) (await orderBook.getOrderRows()).slice(0, 5).forEach(r => console.log(`  still pending: ${r}`));
    console.log(`Pending tab count is 0: ${(await orderBook.getTabCount('Pending')) === 0 ? 'PASS' : 'FAIL'}`);
    const cancelledCountAfter = await orderBook.getTabCount('Cancelled');
    console.log(`Cancelled tab count went up by the ${pendingCountBefore} pending order(s) (${cancelledCountBefore} -> ${cancelledCountAfter}): ${cancelledCountAfter === cancelledCountBefore + pendingCountBefore ? 'PASS' : 'FAIL'}`);

    // Each order that was pending must now be listed Cancelled in ALL (matched by action, symbol,
    // qty and price - one Cancelled row used per pending order).
    await orderBook.tapStatusTab('ALL');
    const allRows = (await orderBook.collectAllOrderRows()).map(r => orderBook.parseOrderRow(r)).filter(r => r.action);
    const unused = allRows.filter(r => /cancel/i.test(r.status));
    let cancelled = 0;
    for (const b of pendingBefore) {
        const i = unused.findIndex(r => orderKey(r) === orderKey(b));
        const ok = i >= 0;
        if (ok) { unused.splice(i, 1); cancelled++; }
        console.log(`  ${b.action} ${b.symbol} qty ${b.totalQty} @ ${b.price}: ${ok ? 'Cancelled' : 'NOT listed as Cancelled'}`);
    }
    console.log(`Every pending order changed to Cancelled (${cancelled} of ${pendingBefore.length}): ${cancelled === pendingBefore.length ? 'PASS' : 'FAIL'}`);
}

// TC 128: after Cancel All, search the Order Book (ALL tab) for the NSE symbol (RTNPOWER) and
// verify it is listed. Read-only - nothing is tapped on the results.
const SEARCH_TC = B(91) + 1;
async function searchOrderBook(driver, pages) {
    const { orderBook, marketsPage } = pages;
    const query = SYMBOLS.NSE.query;
    tc(SEARCH_TC, `Clicking the Order Book search bar, searching "${query}" and verifying the symbol is listed...`);
    if (await orderBook.isInSelectionMode()) await orderBook.exitSelectionMode();
    await openPendingTab(driver, orderBook, marketsPage);
    await orderBook.tapStatusTab('ALL');

    const search = await orderBook.searchOrders(query);
    console.log(`Search bar opened for typing: ${search.opened ? 'PASS' : 'FAIL'}`);
    console.log(`Entered "${query}" in the search bar (field reads "${search.text}"): ${search.typed ? 'PASS' : 'FAIL'}`);

    const isMatch = r => new RegExp(`^${query.replace(/\s+/g, '\\s*')}\\b`, 'i').test(r.symbol || '');
    let rows = [];
    try {
        await driver.waitUntil(async () => {
            rows = (await orderBook.getParsedOrderRows()).filter(r => r.action);
            return rows.some(isMatch);
        }, { timeout: 8000, interval: 1000 });
    } catch (_) { /* not listed */ }
    rows.slice(0, 5).forEach(r => console.log(`  - ${r.raw}`));
    const hits = rows.filter(isMatch);
    console.log(`${query} listed in the search results (${hits.length} order(s)): ${hits.length ? 'PASS' : 'FAIL'}`);
    if (rows.length) {
        const others = rows.filter(r => !isMatch(r));
        console.log(`Only ${query} orders listed (${others.length} other row(s)): ${others.length ? 'FAIL' : 'PASS'}`);
    }

    console.log(`Search text cleared: ${(await orderBook.clearSearch()) ? 'PASS' : 'FAIL'}`);
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

        for (const [i, name] of (BULK_ONLY || SEARCH_ONLY || SEGMENTS.length ? [] : orderBook.tabs).entries()) {
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
        // Order flows: NSE Delivery (TC 7-26: place, details, modify, cancel), then NSE Intraday
        // (TC 27-35), BSE Delivery (TC 36-44), BSE Intraday (TC 45-53), NFO Carryforward (TC 54-62),
        // NFO Intraday (TC 63-71), BFO Carryforward (TC 72-80), MCX Carryforward / Intraday
        // (TC 81-89 / 90-98) and CDS Carryforward / Intraday (TC 99-107 / 108-116) - each up to the order being
        // placed and listed as pending. Each is skipped outright outside its exchange's
        // hours - as Regression's skipIfMarketClosed - so no order is attempted on a closed market.
        const runs = [
            { exchange: 'NSE', product: 'Delivery', firstTc: 7, lastTc: 26, full: true },
            // Opened from the NSE Delivery order's Repeat Order in the Order Book, not by searching.
            { exchange: 'NSE', product: 'Intraday', firstTc: 27, lastTc: 35, full: false, repeat: 'NSE Delivery' },
            { exchange: 'BSE', product: 'Delivery', firstTc: 36, lastTc: 44, full: false },
            { exchange: 'BSE', product: 'Intraday', firstTc: 45, lastTc: 53, full: false },
            { exchange: 'NFO', product: 'Carryforward', firstTc: 54, lastTc: 62, full: false },
            { exchange: 'NFO', product: 'Intraday', firstTc: 63, lastTc: 71, full: false },
            { exchange: 'BFO', product: 'Carryforward', firstTc: 72, lastTc: 80, full: false },
            { exchange: 'MCX', product: 'Carryforward', firstTc: 81, lastTc: 89, full: false },
            { exchange: 'MCX', product: 'Intraday', firstTc: 90, lastTc: 98, full: false },
            { exchange: 'CDS', product: 'Carryforward', firstTc: 99, lastTc: 107, full: false },
            { exchange: 'CDS', product: 'Intraday', firstTc: 108, lastTc: 116, full: false },
        ];
        if (BULK_ONLY) console.log('\nBULK_ONLY=1 - TC 3-80 (tab checks and order placement) skipped');
        if (SEGMENTS.length) console.log(`\nSEGMENTS=${SEGMENTS.join(',')} - only those order flows run (tab checks and Convert / Cancel All skipped)`);
        if (SEARCH_ONLY) console.log(`\nSEARCH_ONLY=1 - only the Order Book search (TC ${SEARCH_TC}) runs`);
        for (const r of BULK_ONLY || SEARCH_ONLY ? [] : runs.filter(x => !SEGMENTS.length || SEGMENTS.includes(x.exchange))) {
            const closed = marketClosedMessage(r.exchange);
            if (closed) {
                console.log(`\nTC ${r.firstTc}-${r.lastTc} (${r.exchange} ${r.product} order) skipped - ${closed}`);
                continue;
            }
            try {
                if (!(await backToBottomNav(driver, orderBook, marketsPage))) throw new Error('Could not get back to the bottom navigation');
                const repeatOf = r.repeat ? placedOrders[r.repeat] || null : null;
                if (r.repeat && !repeatOf) {
                    console.log(`\nNo ${r.repeat} order was placed this run to repeat - opening ${r.exchange} ${r.product} by searching the symbol instead`);
                }
                await placeLowerCircuitOrder(driver, pages, { ...r, repeatOf });
            } catch (err) {
                console.error(`${r.exchange} lower-circuit ${r.product} order failed:`, err.message);
            }
        }

        // TC 117-127: Convert to Market / Cancel All on whatever is pending now (ends by cancelling
        // every pending order when PLACE_REAL_ORDERS is on).
        try {
            if (!SEGMENTS.length && !SEARCH_ONLY) await bulkActionsOnPending(driver, pages);
        } catch (err) {
            console.error('Convert to Market / Cancel All flow failed:', err.message);
            // Never leave a Convert confirmation open: back out of it (No / Yes are not tapped).
            await orderBook.dismissConfirmationWithBack().catch(() => { });
        }

        // TC 128: Order Book search for the NSE symbol, after Cancel All.
        try {
            if (!SEGMENTS.length) await searchOrderBook(driver, pages);
        } catch (err) {
            console.error('Order Book search failed:', err.message);
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
