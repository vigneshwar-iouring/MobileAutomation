const path = require('path');
const DriverManager = require('../../driver/DriverManager');
const SplashPage = require('../../pages/SplashPage');
const OrderBookPage = require('../../pages/OrderBookPage');
const { MarketsPage } = require('../../pages/MarketsPage');
const QuotesPage = require('../../pages/QuotesPage');
const OrderPadPage = require('../../pages/OrderPadPage');
const permissionHandler = require('../../utils/permissionHandler');
const { createLogger } = require('../../utils/logger');

const { logFile, entries } = createLogger('StopLossAndTags');
console.log(`Logging this run to: ${logFile}`);

// Places every order type the Order Pad test (tests/Orders/Orderpad.test.js) walks through, on
// both sides, in every segment - AFTER MARKET HOURS - and checks each one end to end:
//   - the AMO tag is shown while placing it (market closed);
//   - the Confirmation Preview carries the selected type (action, product, Limit/Market/SL,
//     validity, qty, price);
//   - CONFIRM gives the "Rejected" status popup (View Orderbook / Close);
//   - the order is listed in the Order Book and its order details show the selected type.
//
// Order types per side (taken from the Order Pad test's steps): Limit + Delivery/Carryforward,
// Limit + Intraday, Market + Delivery/Carryforward, Market + Intraday, Stoploss (SL limit + trigger),
// each non-default Validity (e.g. IOC), Disclosed Qty, and MTF (NSE BUY on MTF-eligible symbols).
// Intraday / Validity / Disclosed Qty / MTF are only placed when the pad offers them.
//
// Each order on a side gets its own quantity (1, 2, 3... shares; lots on derivatives), so its row
// in the Order Book can be told apart from the others for the same symbol.
//
// Account: dummy account per the test owner. Still, PLACE_REAL_ORDERS=0 stops every order at the
// Confirmation Preview (closed with back, CONFIRM never tapped). And the run is meant for a CLOSED
// market: a segment is skipped while it is trading (see MARKET_HOURS), so a Market order can never
// fill here. Limit orders go at the Quote's lower circuit (BUY) / upper circuit (SELL); the SL
// order uses the Order Pad test's own values (pad price, trigger 0.5 below on BUY / above on SELL).
//
// Env: SEGMENTS=NSE,MCX  SIDES=BUY  ORDER_TYPES=SL,MARKET (name contains any token)
//      <EXCHANGE>_QUERY / <EXCHANGE>_POSITION as in the Order Pad test.
const PLACE_REAL_ORDERS = process.env.PLACE_REAL_ORDERS !== '0';
// ALLOW_OPEN_MARKET=1 also runs segments that are still trading (default: skipped). Only for an
// account with no funds, where every order is rejected anyway - the AMO tag is then not expected.
const ALLOW_OPEN_MARKET = process.env.ALLOW_OPEN_MARKET === '1';

// Same symbols as tests/Orders/Orderpad.test.js.
const ALL_SEGMENTS = [
    { exchange: 'NSE', query: 'RTNPOWER', position: 1 },
    { exchange: 'BSE', query: 'IDEA', position: 2 },
    { exchange: 'NFO', query: 'NIFTY 25100 CE', position: 1 },
    { exchange: 'BFO', query: 'SENSEX 77100 CE', position: 1 },
    { exchange: 'MCX', query: 'NATGASMINI', position: 1 },
    // CDS isn't searched: Markets -> Currency -> first Top Gainers symbol (Top Losers if empty).
    { exchange: 'CDS', source: 'currencyMovers' },
].map(s => s.source ? s : ({
    ...s,
    query: process.env[`${s.exchange}_QUERY`] || s.query,
    position: Number(process.env[`${s.exchange}_POSITION`]) || s.position,
}));
const envList = name => (process.env[name] || '').toUpperCase().split(',').map(s => s.trim()).filter(Boolean);
const wantedSegments = envList('SEGMENTS');
const SEGMENTS = wantedSegments.length ? ALL_SEGMENTS.filter(s => wantedSegments.includes(s.exchange)) : ALL_SEGMENTS;
const wantedSides = envList('SIDES');
const SIDES = ['Buy', 'Sell'].filter(s => !wantedSides.length || wantedSides.includes(s.toUpperCase()));
const wantedTypes = envList('ORDER_TYPES');

// When each segment is OPEN (IST, Mon-Fri, [open, close) in minutes after midnight). Outside it
// the segment runs; inside it the segment is skipped. Deliberately wide: equity opens from the
// 09:00 pre-open, NFO/BFO close as in the Regression suite (15:40), and MCX runs its evening
// session to 23:55 - so no order here can meet a live market. Exchange holidays are not known, so
// a weekday holiday counts as open (skipped) - run with the segment's hours over instead.
const MARKET_HOURS = {
    NSE: { open: 9 * 60, close: 15 * 60 + 30 },
    BSE: { open: 9 * 60, close: 15 * 60 + 30 },
    NFO: { open: 9 * 60, close: 15 * 60 + 40 },
    BFO: { open: 9 * 60, close: 15 * 60 + 40 },
    CDS: { open: 9 * 60, close: 17 * 60 },
    MCX: { open: 9 * 60, close: 23 * 60 + 55 },
};

function nowInIST() {
    const parts = Object.fromEntries(new Intl.DateTimeFormat('en-GB', {
        timeZone: 'Asia/Kolkata', weekday: 'short', hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
    }).formatToParts(new Date()).map(p => [p.type, p.value]));
    return { weekday: parts.weekday, minutes: Number(parts.hour) * 60 + Number(parts.minute), label: `${parts.weekday} ${parts.hour}:${parts.minute} IST` };
}
const fmtMinutes = m => `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;

// null while `segment` is closed (this test can run), else why it is skipped.
function marketOpenMessage(segment) {
    const { open, close } = MARKET_HOURS[segment];
    const now = nowInIST();
    const weekend = now.weekday === 'Sat' || now.weekday === 'Sun';
    if (weekend || now.minutes < open || now.minutes >= close) return null;
    return `Market open - this test places after-market (AMO) orders only (${segment} treated as open ${fmtMinutes(open)}-${fmtMinutes(close)} IST, Mon-Fri; now ${now.label})`;
}

// Calendar days to a contract's expiry from its name - same as the Order Pad test.
const MONTHS = { JAN: 0, FEB: 1, MAR: 2, APR: 3, MAY: 4, JUN: 5, JUL: 6, AUG: 7, SEP: 8, OCT: 9, NOV: 10, DEC: 11 };
function daysToExpiry(symbol) {
    const m = (symbol || '').toUpperCase().match(/\b(\d{1,2})(JAN|FEB|MAR|APR|MAY|JUN|JUL|AUG|SEP|OCT|NOV|DEC)\b/);
    if (!m) return null;
    const now = new Date();
    const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    let expiry = new Date(today.getFullYear(), MONTHS[m[2]], Number(m[1]));
    if (expiry < today) expiry = new Date(today.getFullYear() + 1, MONTHS[m[2]], Number(m[1]));
    return Math.round((expiry - today) / 86400000);
}

// Fixed TC numbers per step, the same in every segment (the [NSE] / [NSE BUY SL DELIVERY] tag
// says which run):
//   1 Markets | 2 search (CDS: Currency movers) | 3 search result + Quote | 4 expand + circuits
//   5 probe a BUY pad for the order types offered (Intraday, Validity, Disclosed Qty, MTF)
//   Per order: 6 open a fresh pad | 7 select the order type | 8 BUY/SELL + AMO tag |
//              9 Confirmation Preview shows the type | 10 CONFIRM + Rejected popup
//   Order Book: 11 open it | 12 order listed (listing) | 13 order details show the type
//   Stoploss refusals per side (nothing placed): 14 trigger on the wrong side of the limit price |
//   15 Stoploss on with an empty trigger
const tc = (no, text) => console.log(`\nTC ${no}: ${text}`);

const num = t => Number(String(t === undefined || t === null ? '' : t).replace(/[₹,\s]/g, ''));
const norm = s => String(s || '').replace(/[\s_-]/g, '').toLowerCase();
const r4 = n => Math.round(n * 10000) / 10000;
const sameSymbol = (a, b) => String(a || '').replace(/\s+/g, ' ').trim().toUpperCase() === String(b || '').replace(/\s+/g, ' ').trim().toUpperCase();
const AMO_RE = /\bAMO\b|after[\s-]?market/i;
const pf = ok => (ok ? 'PASS' : 'FAIL');

// Expected order-type wording. Live 2026-11-19: Confirmation Preview "Limit" / "Market" /
// "SL Limit", order details "LMT" / "MARKET". SL in the details and SL-M anywhere not captured
// yet, so the usual spellings are accepted ("SL", "SL-L", "SL-LMT" / "SL-M", "SLM", "SL Market").
const ORDER_TYPE_RE = {
    Limit: /^(limit|lmt)$/i,
    Market: /^(market|mkt)$/i,
    SL: /^(sl|stop ?loss)([\s-]*(l|lmt|limit))?$/i,
    SLM: /^(sl|stop ?loss)[\s-]*(m|mkt|market)$/i,
};
const typeKey = spec => (spec.stoploss ? (spec.priceType === 'Market' ? 'SLM' : 'SL') : spec.priceType);
// Prices moved by the test are snapped to the segment's tick (CDS 0.0025, else 0.05 - also a
// valid multiple of NSE/BSE's 0.01).
const toTick = (exchange, x) => {
    const tick = exchange === 'CDS' ? 0.0025 : 0.05;
    return r4(Math.max(tick, Math.round(x / tick) * tick));
};

// Quote / Order Pad / search -> a screen with the bottom navigation. Back presses only, never
// anything that confirms - same as tests/Orders/OrderBook.test.js.
async function backToBottomNav(driver, { orderBook, marketsPage }) {
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

// Markets on its Equity tab, from wherever the app is.
async function goToMarkets(driver, pages) {
    const { marketsPage } = pages;
    if (await marketsPage.waitForEquityLoaded(3000)) return;
    if (!(await backToBottomNav(driver, pages))) throw new Error('Could not get back to the bottom navigation');
    await marketsPage.clickMarketNavButton();
    if (!(await marketsPage.waitForEquityLoaded(10000))) {
        // Markets reopens on the last segment tab (the CDS run leaves it on Currency).
        await marketsPage.clickSegmentTab('Equity', marketsPage.equityTab);
        if (!(await marketsPage.waitForEquityLoaded(10000))) throw new Error('Markets screen did not load');
    }
}

// TC 1-4: Markets -> the segment's symbol -> its Quote (expanded) with the circuit limits read.
// Returns { symbol, limits, days }.
async function openSegmentQuote(driver, pages, { exchange, query, position, source }, quiet = false) {
    const { marketsPage, quotesPage } = pages;
    const step = (no, text) => (quiet ? console.log(`[${exchange}] ${text}`) : tc(no, `[${exchange}] ${text}`));

    step(1, 'Navigating to Markets...');
    await goToMarkets(driver, pages);
    await marketsPage.scrollToTop();

    if (source === 'currencyMovers') {
        step(2, `Clicking Currency and the first Top Gainers symbol (Top Losers if none), verifying its ${exchange} Quote opens...`);
        if (!(await marketsPage.openFirstCurrencyGainerOrLoser())) throw new Error('No Currency Top Gainers/Top Losers symbol could be opened');
    } else {
        step(2, `Opening global search and searching "${query}"...`);
        if (!(await marketsPage.clickGlobalSearchBar())) throw new Error('Global search screen did not open from the Markets search bar');
        await marketsPage.typeInSearch(query);
        step(3, `Clicking search result #${position} and verifying its ${exchange} Quote opens...`);
        const symbol = await marketsPage.tapSearchResult(query, position);
        if (!symbol || !(await marketsPage.verifyQuoteOpened(symbol))) throw new Error(`Quote screen did not open for "${query}" result #${position}`);
    }
    const header = await quotesPage.getQuoteHeader();
    const quoteExchange = header ? header.exchange : null;
    console.log(`Quote opened on ${quoteExchange || 'unknown exchange'} (expected ${exchange}): ${pf(quoteExchange === exchange)}`);
    if (quoteExchange !== exchange) throw new Error(`Opened symbol is not a ${exchange} symbol${query ? ` - set ${exchange}_QUERY / ${exchange}_POSITION` : ''}`);

    step(4, 'Expanding the Quote and reading the lower / upper circuit...');
    if (!(await quotesPage.swipeUpQuoteScreen())) throw new Error('Quote screen did not expand');
    const limits = await quotesPage.getCircuitLimits();
    if (!limits) throw new Error('Could not read circuit limits from the Quote screen');
    return { symbol: header.symbol, limits, days: daysToExpiry(header.symbol) };
}

// Back to the Quote after an order (status popup closed, or a step failed half way). Closes the
// Confirmation Preview / Order Pad with their own back - never confirms. false when the app ended
// up somewhere else (e.g. a bottom-nav screen) - the caller then reopens the symbol.
async function ensureOnQuote(driver, { quotesPage, orderPadPage, orderBook }) {
    // The Quote shows both BUY and SELL; the Order Pad (checked first) only one of them. The
    // header label isn't used - it is only known for the collapsed Quote.
    const onQuote = async () => (await quotesPage.isElementVisible(quotesPage.buyButton, 1000))
        && (await quotesPage.isElementVisible(quotesPage.sellButton, 1000));
    for (let i = 0; i < 4; i++) {
        if (await orderPadPage.isElementVisible(orderPadPage.confirmationHeading, 500)) {
            await orderPadPage.dismissConfirmationPopup();
        } else if (await orderPadPage.isDisplayed(1000)) {
            await orderPadPage.hideKeyboardIfShown();
            await orderPadPage.goBackToQuotes();
        } else if (await onQuote()) {
            return true;
        } else if (await orderBook.isElementVisible(orderBook.ordersNavButton, 500)) {
            return false;
        } else {
            await driver.back();
        }
        await orderPadPage.pause(1000);
    }
    return onQuote();
}

// TC 5: what this symbol's pad offers. Opens a BUY pad, reads it, backs out without tapping BUY.
async function probeOrderPad(pages, exchange, days) {
    const { quotesPage, orderPadPage: pad } = pages;
    const equity = ['NSE', 'BSE'].includes(exchange);
    tc(5, `[${exchange}] Opening a BUY Order Pad and reading which order types are offered...`);
    await quotesPage.clickBuy();
    if (!(await pad.verifyOpenedFor('Buy'))) throw new Error('Buy Order Pad did not open');
    try {
        const intraday = !(!equity && days !== null && days <= 1) && (await pad.getProductState('Intraday')).actionable;
        let lot = null;
        if (!equity) {
            lot = await pad.getLotInfo();
            if (!lot.size) lot.size = await pad.deriveLotSizeBySwap(lot.mode);
            if (!lot.size) throw new Error(`Lot size could not be read (note "${lot.note}") or worked out by swapping`);
            console.log(`Lot size ${lot.size}, box opens in ${lot.mode || 'Quantity'} mode`);
        }
        const mtf = exchange === 'NSE' && !!(await pad.findMtfNode());
        const amo = await pad.findAmoTag();
        console.log(`AMO tag on the Order Pad while the market is closed: ${amo ? `shown ("${amo}")` : 'not shown on the pad itself'}`);
        await pad.dumpScreenTo(`sltags_orderpad_${exchange}`);
        await pad.expandMore();
        const { names: validities, selected: defaultValidity } = await pad.getValidityOptions();
        const disclosedQty = !!(await pad.getInputBelow(/^Disclosed Qty$/));
        const offered = { intraday, lot, mtf, validities, defaultValidity, disclosedQty };
        console.log(`Offered on ${exchange}: Intraday ${intraday ? 'yes' : 'no'}, Validity ${validities.join('/') || 'none'} (default ${defaultValidity || 'none clear'}), Disclosed Qty ${disclosedQty ? 'yes' : 'no'}, MTF ${mtf ? 'yes' : 'no'}`);
        return offered;
    } finally {
        await pad.hideKeyboardIfShown();
        await pad.goBackToQuotes();
        await pad.pause(1000);
    }
}

// The order types for one side, in placement order. `n` (the order's quantity multiplier) is its
// 1-based position in the list.
function buildSpecs(exchange, side, offered) {
    const equity = ['NSE', 'BSE'].includes(exchange);
    const holding = equity ? 'Delivery' : 'Carryforward';
    const H = holding.toUpperCase();
    const specs = [
        { name: `LIMIT ${H}`, priceType: 'Limit', product: holding },
        offered.intraday && { name: 'LIMIT INTRADAY', priceType: 'Limit', product: 'Intraday' },
        { name: `MARKET ${H}`, priceType: 'Market', product: holding },
        offered.intraday && { name: 'MARKET INTRADAY', priceType: 'Market', product: 'Intraday' },
        { name: `SL ${H}`, priceType: 'Limit', product: holding, stoploss: true },
        { name: `SL MARKET ${H}`, priceType: 'Market', product: holding, stoploss: true },
        ...offered.validities
            .filter(v => v !== offered.defaultValidity)
            .map(v => ({ name: `LIMIT ${H} ${v.toUpperCase()}`, priceType: 'Limit', product: holding, validity: v })),
        offered.disclosedQty && { name: `LIMIT ${H} DISCLOSED QTY`, priceType: 'Limit', product: holding, disclosedQty: 1 },
        offered.mtf && side === 'Buy' && { name: 'LIMIT MTF', priceType: 'Limit', product: 'MTF', baseProduct: 'Delivery', mtf: true },
    ].filter(Boolean);
    return specs
        .map((s, i) => ({ ...s, side, n: i + 1 }))
        .filter(s => !wantedTypes.length || wantedTypes.some(t => s.name.includes(t)));
}

// TC 6-10 for one order: fresh pad -> set the type -> BUY/SELL (AMO tag) -> Confirmation Preview
// checks -> CONFIRM -> Rejected popup -> Close. Returns the order record for the Order Book checks.
async function placeOrder(driver, pages, ctx, spec) {
    const { quotesPage, orderPadPage: pad, orderBook } = pages;
    const { exchange, symbol, limits, offered } = ctx;
    const equity = ['NSE', 'BSE'].includes(exchange);
    const isBuy = spec.side === 'Buy';
    const tag = `${exchange} ${spec.side.toUpperCase()} ${spec.name}`;
    const lot = offered.lot;
    const order = {
        ...spec, tag, exchange, symbol, placed: false,
        qty: equity ? spec.n : spec.n * lot.size,
        lots: equity ? null : spec.n,
        price: null, trigger: null,
        // Derivatives: Disclosed Qty must be whole lots ("Quantity Should be in the multiple of
        // lot size") and at least a quarter of the order ("Minimum 25% of Order quantity") - MCX
        // NATGASMINI, lot 250, 19-20 Nov 2026. So the fewest whole lots >= 25%, in quantity units.
        disclosedQty: spec.disclosedQty ? (equity ? spec.disclosedQty : Math.max(1, Math.ceil(spec.n * 0.25)) * lot.size) : undefined,
    };

    tc(6, `[${tag}] Opening a fresh ${spec.side.toUpperCase()} Order Pad from the Quote...`);
    if (!(await ensureOnQuote(driver, pages))) throw new Error('Not on the Quote screen');
    await (isBuy ? quotesPage.clickBuy() : quotesPage.clickSell());
    if (!(await pad.verifyOpenedFor(spec.side))) throw new Error(`${spec.side} Order Pad did not open`);

    tc(7, `[${tag}] Selecting the order type: ${spec.priceType}${spec.stoploss ? ` + Stoploss (${typeKey(spec) === 'SLM' ? 'SL-M' : 'SL Limit'})` : ''}, ${spec.product}${spec.validity ? `, Validity ${spec.validity}` : ''}${order.disclosedQty ? `, Disclosed Qty ${order.disclosedQty}` : ''}, qty ${order.qty}${equity ? '' : ` (${spec.n} lot(s))`}...`);
    if (spec.mtf) {
        await pad.selectProduct(spec.baseProduct);
        const mtf = await pad.findMtfNode();
        if (!mtf) throw new Error('MTF not offered on this pad');
        await pad.tapNode(mtf);
        await pad.pause(800);
        console.log(`Tapped MTF ("${mtf.desc || mtf.text}")`);
    } else if (!(await pad.selectProduct(spec.product))) {
        throw new Error(`${spec.product} could not be selected`);
    }
    const boxValue = equity || lot.mode === 'Lot' ? spec.n : spec.n * lot.size;
    if (!(await pad.setQuantity(boxValue))) throw new Error(`Quantity did not take ${boxValue}`);
    if (!(await pad.setPriceType(spec.priceType))) throw new Error(`Price type did not switch to ${spec.priceType}`);
    if (spec.priceType === 'Limit') {
        if (spec.stoploss) {
            // The Order Pad test's SL step: limit = the pad's own price, trigger 0.5 below (BUY) /
            // above (SELL) it.
            order.price = num(await pad.getPrice());
        } else {
            // Far from the market: BUY at the lower circuit, SELL at the upper circuit.
            order.price = num(isBuy ? limits.lower : limits.upper);
            if (!(await pad.setPrice(order.price))) throw new Error(`Price field did not take ${order.price}`);
        }
        await pad.hideKeyboardIfShown();
    }
    if (spec.stoploss && spec.priceType === 'Market') {
        // SL-M: no limit price - the trigger goes on the exchange's side of the LTP (BUY stop
        // above it, SELL stop below it). The stoploss toggle may be refused with Market.
        const toggle = (await pad.getPadNodes()).find(n => n.desc.startsWith('toggle stoploss'));
        if (!toggle || /disabled/i.test(toggle.desc) || !toggle.enabled) {
            throw new Error(`Stoploss toggle not available with Market price type ("${toggle ? toggle.desc : 'not shown'}") - SL-M not offered`);
        }
        if (!(await pad.verifyStoplossToggleShowsTrigger())) throw new Error('Stoploss Trigger Price box did not appear with Market');
        const modeAfter = await pad.getPriceMode();
        console.log(`Price type after turning Stoploss on with Market: "${modeAfter}" (stays Market for SL-M): ${pf(modeAfter === 'Market')}`);
        const ltp = await pad.getExchangeLtp(exchange);
        if (!ltp) throw new Error('LTP not readable on the pad - cannot place an SL-M trigger');
        order.trigger = isBuy ? toTick(exchange, ltp > 1 ? ltp + 0.5 : ltp * 1.2) : toTick(exchange, ltp > 1 ? ltp - 0.5 : ltp * 0.8);
        console.log(`SL-M trigger ${order.trigger} is ${isBuy ? 'above' : 'below'} the LTP ${ltp}`);
        if (!(await pad.setTriggerPrice(order.trigger))) throw new Error(`Trigger Price did not take ${order.trigger}`);
    } else if (spec.stoploss) {
        if (!(await pad.verifyStoplossToggleShowsTrigger())) throw new Error('Stoploss Trigger Price box did not appear');
        order.trigger = isBuy
            ? r4(order.price > 1 ? order.price - 0.5 : order.price * 0.9)
            : r4(order.price + 0.5);
        console.log(`Trigger ${order.trigger} is ${isBuy ? 'below' : 'above'} the limit price ${order.price}`);
        if (!(await pad.setTriggerPrice(order.trigger))) throw new Error(`Trigger Price did not take ${order.trigger}`);
        order.price = num(await pad.getPrice());
    }
    if (spec.validity || order.disclosedQty) {
        if (!(await pad.expandMore())) throw new Error('More did not expand');
        if (spec.validity && !(await pad.selectValidity(spec.validity))) throw new Error(`Validity ${spec.validity} could not be selected`);
        if (order.disclosedQty && !(await pad.enterDisclosedQty(order.disclosedQty))) throw new Error(`Disclosed Qty did not take ${order.disclosedQty}`);
    }
    await pad.hideKeyboardIfShown();

    tc(8, `[${tag}] Tapping ${spec.side.toUpperCase()} and verifying the AMO tag is shown (market closed)...`);
    const amoOnPad = await pad.findAmoTag();
    await pad.clickSide(spec.side);
    await pad.proceedPastSurveillanceIfShown();
    let outcome = await pad.waitForBuyOutcome();
    // Live 2026-11-19 after the close: the Quote showed circuits 5.23-7.83 while the pad's DPR
    // check allowed only 5.20-7.78, so a SELL at the Quote's upper circuit was refused. Re-enter
    // the circuit-priced limit at the DPR band's own edge once (logged as a mismatch).
    const dpr = outcome.outcome === 'dpr' && String(outcome.message).match(/([\d.]+)\s*-\s*([\d.]+)/);
    if (dpr && spec.priceType === 'Limit' && !spec.stoploss) {
        const bound = num(isBuy ? dpr[1] : dpr[2]);
        console.log(`Quote ${isBuy ? 'lower' : 'upper'} circuit ${order.price} is outside the pad's "${outcome.message}" - Quote circuit and DPR band differ: FAIL`);
        // The DPR message is inline on the pad (above "Add Stoploss", ui_dumps/sltags_after_sell_NSE.xml),
        // not a dialog - no back press, just a new price.
        console.log(`Retrying at the DPR ${isBuy ? 'lower' : 'upper'} bound ${bound}`);
        order.price = bound;
        if (!(await pad.setPrice(bound))) throw new Error(`Price field did not take ${bound}`);
        await pad.hideKeyboardIfShown();
        await pad.clickSide(spec.side);
        await pad.proceedPastSurveillanceIfShown();
        outcome = await pad.waitForBuyOutcome();
    }
    if (outcome.outcome !== 'confirmation') {
        await pad.dumpScreenTo(`sltags_after_${spec.side.toLowerCase()}_${exchange}`);
        throw new Error(outcome.outcome === 'dpr'
            ? `${spec.side.toUpperCase()} rejected on the pad with "${outcome.message}"`
            : `Confirmation Preview did not appear after ${spec.side.toUpperCase()} (screen saved to ui_dumps/sltags_after_${spec.side.toLowerCase()}_${exchange}.xml)`);
    }
    const amoOnPreview = await pad.findAmoTag();
    if (!ctx.previewDumped) {
        await pad.dumpScreenTo(`sltags_confirmation_${exchange}`);
        ctx.previewDumped = true;
    }
    const where = [amoOnPad && `Order Pad "${amoOnPad}"`, amoOnPreview && `Confirmation Preview "${amoOnPreview}"`].filter(Boolean).join(', ');
    if (marketOpenMessage(exchange)) {
        console.log(`Market open for ${exchange} - AMO tag not expected (${where || 'none shown'})`);
    } else {
        console.log(`AMO tag shown while placing the order after market hours (${where || 'not found on the Order Pad or the Confirmation Preview'}): ${pf(!!where)}`);
    }
    order.amo = !!where;

    tc(9, `[${tag}] Verifying the Confirmation Preview shows the selected order type...`);
    const c = await pad.getConfirmationDetails();
    console.log(`Confirmation Preview: ${JSON.stringify(c)}`);
    const checks = [];
    const check = (label, shown, ok) => {
        checks.push(ok);
        console.log(`Confirmation ${label} "${shown === undefined ? 'missing' : shown}": ${pf(ok)}`);
    };
    check(`Order Action is ${spec.side}`, c['Order Action'], norm(c['Order Action']) === norm(spec.side));
    check(`Exchange is ${exchange}`, c.Exchange, c.Exchange === exchange);
    check(`Quantity is ${order.qty}${equity ? '' : ` (${order.lots} lot(s))`}`, c.Quantity, num(c.Quantity) === order.qty || (!equity && num(c.Quantity) === order.lots));
    check(`Product Type is ${spec.product}`, c['Product Type'], spec.mtf
        ? /\bMTF\b/i.test(Object.values(c).join(' '))
        : norm(c['Product Type']) === norm(spec.product));
    const triggerKey = Object.keys(c).find(k => /trigger/i.test(k));
    // A matching trigger stands in for the SL wording only when no Order Type is shown at all -
    // never lets an SL-M pass as "SL Limit" or the other way round.
    check(`Order Type is ${typeKey(spec)}`, c['Order Type'], ORDER_TYPE_RE[typeKey(spec)].test(String(c['Order Type'] || '').trim())
        || (spec.stoploss && c['Order Type'] === undefined && !!triggerKey && num(c[triggerKey]) === order.trigger));
    if (spec.priceType === 'Limit') check(`Price is ${order.price}`, c.Price, num(c.Price) === order.price);
    else console.log(`Confirmation Price for a Market order: "${c.Price}" (logged)`);
    if (spec.stoploss) {
        if (triggerKey) check(`${triggerKey} is ${order.trigger}`, c[triggerKey], num(c[triggerKey]) === order.trigger);
        else console.log('Trigger Price is not shown on the Confirmation Preview - checked in the order details instead');
    }
    const validity = spec.validity || offered.defaultValidity;
    if (validity && c.Validity !== undefined) check(`Validity is ${validity}`, c.Validity, norm(c.Validity) === norm(validity));
    // Same safety rule as every other order flow here: never CONFIRM something other than what
    // was selected - this also keeps a wrong type out of the Order Book checks.
    if (!checks.every(Boolean)) {
        await pad.dismissConfirmationPopup();
        throw new Error('Confirmation Preview does not match the selected order type - refusing to tap CONFIRM');
    }

    if (!PLACE_REAL_ORDERS) {
        tc(10, `[${tag}] PLACE_REAL_ORDERS is off - closing the Confirmation Preview without confirming...`);
        await pad.dismissConfirmationPopup();
        return order;
    }

    tc(10, `[${tag}] Tapping CONFIRM and verifying the Rejected popup (market closed)...`);
    order.confirmedAt = Date.now();
    await pad.tapConfirm();
    order.placed = true;
    const popup = await orderBook.readOrderStatusPopup();
    if (!popup) {
        console.log('Order status popup did not appear after CONFIRM: FAIL');
        return order;
    }
    order.popupStatus = popup.status;
    const labels = (await orderBook.getDescribedElements()).map(n => n.desc.replace(/\s+/g, ' ').trim()).filter(d => d && d !== 'Scrim');
    console.log(`Order status popup reads: ${labels.join(' | ') || popup.message || '(nothing readable)'}`);
    // The reason line is the longest label that is neither the status, the "N X SYMBOL" line nor a button.
    order.popupReason = labels
        .filter(l => !/^(rejected|failed|placed|queued|scheduled|close|view order ?book)$/i.test(l) && !/^\d+\s*X\s/i.test(l))
        .sort((a, b) => b.length - a.length)[0] || null;
    if (order.popupReason) console.log(`Popup reason: "${order.popupReason}"`);
    console.log(`Rejected popup displayed (status "${popup.status || 'unknown'}"): ${pf(popup.status === 'Rejected')}`);
    console.log(`Rejected popup shows View Orderbook and Close (View Orderbook ${popup.viewOrderBook ? 'shown' : 'not shown'}, Close ${popup.close ? 'shown' : 'not shown'}): ${pf(!!popup.viewOrderBook && !!popup.close)}`);
    const amoOnPopup = labels.find(l => AMO_RE.test(l));
    if (amoOnPopup) console.log(`AMO tag on the status popup: "${amoOnPopup}"`);
    if (popup.close) {
        await orderBook.tapNode(popup.close);
        await orderBook.pause(1000);
    }
    return order;
}

// TC 14 / 15: stoploss input the app must refuse - nothing is placed. `kind`:
//   'wrong-side' - SL Limit with the trigger on the wrong side of the limit price (BUY trigger
//                  above it, SELL trigger below it - the opposite of the valid SL order above);
//   'empty'      - Stoploss on with no trigger entered.
// Taps BUY/SELL and expects an error on the pad instead of the Confirmation Preview. If the preview
// opens anyway it is closed with back (CONFIRM is never tapped) and logged as a FAIL.
async function checkInvalidStoploss(driver, pages, ctx, side, kind) {
    const { quotesPage, orderPadPage: pad } = pages;
    const { exchange } = ctx;
    const isBuy = side === 'Buy';
    const equity = ['NSE', 'BSE'].includes(exchange);
    const holding = equity ? 'Delivery' : 'Carryforward';
    const no = kind === 'wrong-side' ? 14 : 15;
    const tag = `${exchange} ${side.toUpperCase()} SL ${kind === 'wrong-side' ? 'INVALID TRIGGER' : 'EMPTY TRIGGER'}`;
    tc(no, `[${tag}] ${kind === 'wrong-side'
        ? `Entering a trigger ${isBuy ? 'above' : 'below'} the limit price and verifying the app refuses the SL order`
        : 'Turning Stoploss on without a trigger and verifying the app refuses the order'} (nothing placed)...`);
    try {
        if (!(await ensureOnQuote(driver, pages))) throw new Error('Not on the Quote screen');
        await (isBuy ? quotesPage.clickBuy() : quotesPage.clickSell());
        if (!(await pad.verifyOpenedFor(side))) throw new Error(`${side} Order Pad did not open`);
        await pad.selectProduct(holding);
        if (!(await pad.setPriceType('Limit'))) throw new Error('Price type did not switch to Limit');
        const price = num(await pad.getPrice());
        if (!(await pad.verifyStoplossToggleShowsTrigger())) throw new Error('Stoploss Trigger Price box did not appear');
        if (kind === 'wrong-side') {
            const trigger = isBuy ? toTick(exchange, price + 0.5) : toTick(exchange, price > 1 ? price - 0.5 : price * 0.5);
            console.log(`Invalid trigger ${trigger} is ${isBuy ? 'above' : 'below'} the limit price ${price}`);
            if (!(await pad.setTriggerPrice(trigger))) throw new Error(`Trigger Price did not take ${trigger}`);
        } else {
            console.log(`Trigger Price left empty (limit price ${price})`);
        }
        await pad.hideKeyboardIfShown();

        const labelsOf = async () => (await pad.getPadNodes()).map(n => (n.desc || n.text).replace(/\s+/g, ' ').trim()).filter(Boolean);
        const before = new Set(await labelsOf());
        await pad.clickSide(side);
        // Poll ~4s: the error may be inline or a short-lived toast/snackbar.
        const shown = new Set();
        let preview = false;
        const end = Date.now() + 4000;
        while (Date.now() < end) {
            if (await pad.isElementVisible(pad.confirmationHeading, 300)) { preview = true; break; }
            (await labelsOf()).filter(l => !before.has(l) && !/^[\d.,₹\s]+$/.test(l)).forEach(l => shown.add(l));
            await pad.pause(300);
        }
        await pad.dumpScreenTo(`sltags_sl_${kind}_${exchange}_${side.toLowerCase()}`);
        if (preview) {
            const c = await pad.getConfirmationDetails();
            console.log(`Confirmation Preview opened for an invalid stoploss: ${JSON.stringify(c)}`);
            await pad.dismissConfirmationPopup();
            console.log(`App refused the ${kind === 'wrong-side' ? 'wrong-side trigger' : 'empty trigger'}: FAIL (Confirmation Preview opened - closed without confirming)`);
            return;
        }
        // Exchange LTP tiles re-render with every tick - not messages.
        const messages = [...shown].filter(l => !/Exchange is \w+ and the last traded price/i.test(l));
        const error = messages.find(l => /trigger|stop ?loss|invalid|should|must|greater|less|higher|lower|enter|required/i.test(l))
            // Live 2026-11-19 (MCX, empty trigger): the only response was the inline
            // "DPR Range: x - y" - the empty (0) trigger checked against the price band.
            || messages.find(l => /^DPR Range/i.test(l));
        console.log(`New text on the pad after ${side.toUpperCase()}: ${messages.join(' | ') || 'none'}`);
        console.log(`App refused the ${kind === 'wrong-side' ? 'wrong-side trigger' : 'empty trigger'} with an error (${error ? `"${error}"` : 'no error text found'}) and no Confirmation Preview: ${pf(!!error)}`);
        if (error && !/trigger|stop ?loss/i.test(error)) {
            console.log(`Note: the error shown ("${error}") does not mention the trigger / stoploss - the user is not told what to fix`);
        }
    } catch (err) {
        console.error(`[${tag}] failed:`, err.message);
    } finally {
        await ensureOnQuote(driver, pages);
    }
}

// Order Book list -> the row matching `predicate`, scrolling from the top of the list down.
// A screen that reads the same as the last one is not proof of the end of the list: a run of
// identical rows (live 2026-11-19: dozens of identical rejected TATASTEEL orders on this
// account) looks unchanged after a swipe. So it stops only after 3 such screens.
async function locateRow(orderBook, predicate, maxScrolls = 40) {
    // Pending -> ALL refreshes the list and puts it back at the top, newest order first (probed
    // live 2026-11-19) - a few swipes up don't get back from deep in a long list.
    await orderBook.tapStatusTab('Pending');
    await orderBook.tapStatusTab('ALL');
    let last = null;
    let unchanged = 0;
    for (let i = 0; i <= maxScrolls; i++) {
        const rows = await orderBook.getParsedOrderRows();
        const hit = rows.find(r => r.action && predicate(r));
        if (hit) return hit;
        const sig = rows.map(r => r.raw).join('|');
        unchanged = sig === last ? unchanged + 1 : 0;
        if (unchanged >= 3) break;
        last = sig;
        await orderBook.swipe('down');
        await orderBook.pause(700);
    }
    return null;
}

const toSecs = t => {
    const [h, m, s = 0] = String(t).split(':').map(Number);
    return h * 3600 + m * 60 + s;
};
const istSecs = ms => {
    const d = new Date(ms + 5.5 * 3600000);
    return d.getUTCHours() * 3600 + d.getUTCMinutes() * 60 + d.getUTCSeconds();
};

// Every field of the order details popup, one per line - same layout as the OrderBook test.
function printOrderDetails(od) {
    const rows = [
        ['Action', od.action],
        ['Status', od.status],
        ['Order time (header)', od.headerTime],
        ['Quantity (filled of total)', od.totalQty === null ? null : `${od.filledQty} of ${od.totalQty}`],
        ...Object.entries(od.fields),
    ];
    const width = Math.max(...rows.map(([k]) => k.length));
    console.log('Order details:');
    rows.forEach(([k, v]) => console.log(`  ${k.padEnd(width)} : ${v === null || v === undefined || v === '' ? '-' : v}`));
}

// TC 12-13 for one placed order: its Order Book row, then its order details.
async function verifyInOrderBook(orderBook, order, ctx) {
    const { tag, side, symbol } = order;
    // Every order is rejected after hours. Live 2026-11-19 the popup read "Failed" (with the
    // reason) while the Order Book and its details said "Rejected" - the popup wording is judged
    // at TC 10, the Order Book must say Rejected.
    const expectRejected = true;

    tc(12, `[${tag}] Verifying the ${side.toUpperCase()} ${symbol} qty ${order.qty}${order.price !== null ? ` @ ${order.price}` : ' (Market)'} order is listed in the Order Book...`);
    const row = await locateRow(orderBook, r =>
        r.action === side.toUpperCase() && sameSymbol(r.symbol, symbol) && r.totalQty === order.qty
        && (order.price === null || r.price === order.price));
    if (!row) {
        console.log('Order listed in the Order Book ALL tab: FAIL');
        (await orderBook.getOrderRows()).slice(0, 5).forEach(r => console.log(`  - ${r}`));
        return;
    }
    console.log(`Order listed in the Order Book: "${row.raw}": PASS`);
    console.log(`Listed status "${row.status}" is Rejected${order.popupStatus && order.popupStatus !== 'Rejected' ? ` (popup said "${order.popupStatus}")` : ''}: ${pf(/reject/i.test(row.status) === expectRejected)}`);
    // The row's accessibility label holds action / symbol / status / qty / price only - product
    // and order type are drawn inside the row but not exposed (ui_dumps/orderbook_list_probe.xml).
    // Checked here if a build does expose them, else left to the screenshot and the details below.
    const typeWords = row.raw.match(/\b(delivery|intraday|carry ?forward|mtf|lmt|mkt|limit|market|sl(-?[lm])?|amo)\b/gi);
    if (typeWords) {
        const shown = norm(typeWords.join(' '));
        const productOk = shown.includes(norm(order.mtf ? 'MTF' : order.product));
        console.log(`Order listing shows the product ${order.product} ("${typeWords.join(' ')}"): ${pf(productOk)}`);
    } else {
        if (!ctx.listingShot) {
            ctx.listingShot = path.join(__dirname, '..', '..', 'ui_dumps', `sltags_orderbook_${order.exchange}.png`);
            await orderBook.driver.saveScreenshot(ctx.listingShot).catch(() => { });
        }
        console.log(`Order type / product in the listing are drawn but not in the row's accessibility label - NOT VERIFIABLE from the listing (checked in the order details; screenshot ${ctx.listingShot})`);
    }
    if (AMO_RE.test(row.raw)) console.log('AMO tag in the Order Book row: shown');

    tc(13, `[${tag}] Opening the order details and verifying they show the selected order type...`);
    const od = await orderBook.openOrderDetails(row.raw);
    if (!od) {
        console.log('Order details popup did not open: FAIL');
        return;
    }
    try {
        printOrderDetails(od);
        const f = od.fields;
        const check = (label, shown, ok) => console.log(`${label} (${shown === undefined || shown === null ? 'missing' : `"${shown}"`}): ${pf(ok)}`);
        // Same symbol/side/qty rows from earlier runs look identical - the Order Time ties these
        // details to the order just placed (CONFIRM tapped at confirmedAt).
        const placedAt = istSecs(order.confirmedAt);
        const t = f['Order Time'];
        check(`Order Time is when this order was placed (~${new Date(order.confirmedAt + 5.5 * 3600000).toISOString().slice(11, 19)} IST)`, t,
            !!t && /^\d{1,2}:\d{2}(:\d{2})?$/.test(t) && toSecs(t) >= placedAt - 120 && toSecs(t) <= placedAt + 600);
        check(`Stock name is ${symbol}`, f['Stock name'], sameSymbol(f['Stock name'], symbol));
        check(`Action is ${side.toUpperCase()}`, od.action, od.action === side.toUpperCase());
        check('Status is Rejected', od.status, /reject/i.test(od.status || '') === expectRejected);
        const reason = f['Reject Reason'];
        check('Reject Reason displayed', reason, !!reason && reason.trim() !== '');
        if (reason && order.popupReason) {
            check('Reject Reason matches the status popup', reason, norm(reason).replace(/\.$/, '') === norm(order.popupReason).replace(/\.$/, ''));
        }
        // The tag line under the symbol in the order details, one content-desc - e.g.
        // "Exchange: MCX. Product: CARRY FORWARD. Order Type: LMT." (MCX / C.FWD / LMT tags).
        // Wording seen live 19-20 Nov 2026: DELIVERY / INTRADAY / CARRY FORWARD and
        // LMT / MARKET / SL LMT / SL MKT. MTF not seen yet - not checked exactly.
        if (!order.mtf) {
            const PRODUCT_TAG = { Delivery: 'DELIVERY', Intraday: 'INTRADAY', Carryforward: 'CARRY FORWARD' };
            const TYPE_TAG = { Limit: 'LMT', Market: 'MARKET', SL: 'SL LMT', SLM: 'SL MKT' };
            const expectedTags = `Exchange: ${order.exchange}. Product: ${PRODUCT_TAG[order.product]}. Order Type: ${TYPE_TAG[typeKey(order)]}.`;
            const tagNode = await orderBook.isElementVisible(`android=new UiSelector().description("${expectedTags}")`, 2000);
            const shownTags = (await orderBook.getDescribedElements()).map(n => n.desc.trim()).find(d => /^Exchange:\s*\w+\.\s*Product:/i.test(d));
            check(`Order details tags read "${expectedTags}"`, shownTags, tagNode);
        }
        check(`Exchange is ${order.exchange}`, f['Exchange'], f['Exchange'] === order.exchange);
        check(`Quantity is ${order.qty}`, od.totalQty === null ? null : `${od.filledQty} of ${od.totalQty}`, od.totalQty === order.qty);
        check(`Product is ${order.mtf ? 'MTF' : order.product}`, f['Product'], order.mtf
            ? /\bMTF\b/i.test(f['Product'] || '')
            : norm(f['Product']) === norm(order.product));
        check(`Order Type is ${typeKey(order)}`, f['Order Type'], ORDER_TYPE_RE[typeKey(order)].test(String(f['Order Type'] || '').trim()));
        if (order.price !== null) check(`Order Price is ${order.price}`, f['Order Price'], num(f['Order Price']) === order.price);
        check(`Trigger Price is ${order.stoploss ? order.trigger : '0 (no stoploss)'}`, f['Trigger Price'],
            num(f['Trigger Price']) === (order.stoploss ? order.trigger : 0));
        if (f['Disclosed Qty'] !== undefined) {
            const dq = order.disclosedQty || 0;
            check(`Disclosed Qty is ${dq}`, f['Disclosed Qty'], num(f['Disclosed Qty']) === dq);
        } else if (order.disclosedQty) {
            check(`Disclosed Qty is ${order.disclosedQty}`, undefined, false);
        }
        const validity = order.validity || ctx.offered.defaultValidity;
        const validityKey = Object.keys(f).find(k => /validity/i.test(k));
        if (validityKey && validity) check(`Validity is ${validity}`, f[validityKey], norm(f[validityKey]) === norm(validity));
        else if (order.validity) console.log(`Validity is not shown in the order details - ${order.validity} was checked on the Confirmation Preview only`);
        const amo = [od.raw, ...Object.entries(f).map(([k, v]) => `${k}: ${v}`)].find(s => AMO_RE.test(s));
        console.log(`AMO tag in the order details: ${amo ? `shown ("${amo}")` : 'not shown'}`);
    } finally {
        console.log(`Back on the Order Book after closing the order details: ${pf(await orderBook.closeOrderDetails())}`);
    }
}

async function runSegment(driver, pages, segment) {
    const { exchange } = segment;
    console.log(`\n========== ${exchange}: ${segment.source === 'currencyMovers' ? 'Currency Top Gainers/Losers' : `"${segment.query}" result #${segment.position}`} ==========`);
    const openMsg = marketOpenMessage(exchange);
    if (openMsg && !ALLOW_OPEN_MARKET) {
        console.log(`[${exchange}] skipped - ${openMsg}`);
        return;
    }
    if (openMsg) console.log(`[${exchange}] ALLOW_OPEN_MARKET=1 - placing orders on an OPEN market (no AMO tag expected; Market orders can fill if the account has funds)`);

    const quote = await openSegmentQuote(driver, pages, segment);
    const offered = await probeOrderPad(pages, exchange, quote.days);
    const ctx = { exchange, ...quote, offered };

    const orders = [];
    for (const side of SIDES) {
        const specs = buildSpecs(exchange, side, offered);
        console.log(`\n[${exchange} ${side.toUpperCase()}] Order types to place: ${specs.map(s => s.name).join(', ') || 'none'}`);
        for (const spec of specs) {
            try {
                orders.push(await placeOrder(driver, pages, ctx, spec));
            } catch (err) {
                console.error(`[${exchange} ${side.toUpperCase()} ${spec.name}] failed:`, err.message);
            }
            // Back to the Quote for the next order - reopening the symbol if the app left it.
            if (!(await ensureOnQuote(driver, pages))) {
                console.log(`[${exchange}] Not on the Quote any more - reopening ${ctx.symbol}`);
                const again = await openSegmentQuote(driver, pages, segment, true);
                if (!sameSymbol(again.symbol, ctx.symbol)) throw new Error(`Reopened ${again.symbol} instead of ${ctx.symbol}`);
            }
        }
        if (!wantedTypes.length || wantedTypes.some(t => 'SL INVALID TRIGGER SL EMPTY TRIGGER'.includes(t))) {
            for (const kind of ['wrong-side', 'empty']) {
                await checkInvalidStoploss(driver, pages, ctx, side, kind);
                if (!(await ensureOnQuote(driver, pages))) {
                    const again = await openSegmentQuote(driver, pages, segment, true);
                    if (!sameSymbol(again.symbol, ctx.symbol)) throw new Error(`Reopened ${again.symbol} instead of ${ctx.symbol}`);
                }
            }
        }
    }

    const placed = orders.filter(o => o.placed);
    tc(11, `[${exchange}] Opening the Order Book (ALL tab) to check the ${placed.length} order(s) placed...`);
    if (!placed.length) {
        console.log(`[${exchange}] No order was placed${PLACE_REAL_ORDERS ? '' : ' (PLACE_REAL_ORDERS=0)'} - Order Book checks skipped`);
        return;
    }
    const { orderBook } = pages;
    if (!(await backToBottomNav(driver, pages))) throw new Error('Could not get back to the bottom navigation');
    await orderBook.clickOrdersNav();
    await orderBook.pause(1500);
    await orderBook.selectRegularTab();
    if (!(await orderBook.isOnOrderBook(10000))) throw new Error('Order Book did not open');
    // Reload the list once (Pending -> ALL) - it can lag behind the orders just placed.
    await orderBook.tapStatusTab('Pending');
    await orderBook.tapStatusTab('ALL');
    console.log('Order Book ALL tab displayed: PASS');
    for (const order of placed) {
        try {
            await verifyInOrderBook(orderBook, order, ctx);
        } catch (err) {
            console.error(`[${order.tag}] Order Book check failed:`, err.message);
            await orderBook.closeOrderDetails().catch(() => { });
        }
    }
}

// Like utils/logger's getFailedTCs, but keyed on "TC N [TAG]" - TC numbers repeat for every
// segment and order, so the number alone would merge their failures into one entry.
function getFailedTCs(logEntries) {
    let current = null;
    const byTC = new Map();
    for (const e of logEntries) {
        const m = e.message.match(/TC (\d+): (\[[^\]]+\])?/);
        if (m) current = `TC ${m[1]}${m[2] ? ` ${m[2]}` : ''}`;
        if (current && (e.level === 'error' || /FAIL/.test(e.message))) {
            if (!byTC.has(current)) byTC.set(current, []);
            byTC.get(current).push(e.message.trim());
        }
    }
    return [...byTC.entries()].map(([tc, messages]) => ({ tc, messages }));
}

async function run() {
    const driver = await DriverManager.getDriver();
    try {
        const pages = {
            orderBook: new OrderBookPage(driver),
            marketsPage: new MarketsPage(driver),
            quotesPage: new QuotesPage(driver),
            orderPadPage: new OrderPadPage(driver),
        };
        console.log(`Order placement: ${PLACE_REAL_ORDERS ? 'ON (set PLACE_REAL_ORDERS=0 to stop at the Confirmation Preview)' : 'OFF (PLACE_REAL_ORDERS=0)'}`);
        console.log(`Segments: ${SEGMENTS.map(s => s.exchange).join(', ')} | Sides: ${SIDES.join(', ')}${wantedTypes.length ? ` | Order types containing: ${wantedTypes.join(', ')}` : ''}`);

        const splashPage = new SplashPage(driver);
        await splashPage.launch();
        await splashPage.pause(3000);
        await permissionHandler.dismissAllPermissions(driver);

        for (const segment of SEGMENTS) {
            try {
                await runSegment(driver, pages, segment);
            } catch (err) {
                console.error(`${segment.exchange} failed:`, err.message);
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
