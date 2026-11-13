const DriverManager = require('../../driver/DriverManager');
const { MarketsPage } = require('../../pages/MarketsPage');
const QuotesPage = require('../../pages/QuotesPage');
const OrderPadPage = require('../../pages/OrderPadPage');
const { createLogger } = require('../../utils/logger');

const { logFile, entries } = createLogger('NonExecutableOrders');
console.log(`Logging this run to: ${logFile}`);

// One run per segment: search `query`, open result #`position`, and expect its Quote on `exchange`.
// RTNPOWER's first result is its NSE listing; IDEA's second result is its BSE listing. The derivative queries are ones already used elsewhere
// in this repo (Regression R36/R37, tests/Markets/Equity.test.js); contract strikes drift with the
// market, so each can be overridden without editing this file, e.g. NFO_QUERY="NIFTY 26000 CE".
// SEGMENTS=NSE,MCX runs just those segments.
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
const wanted = (process.env.SEGMENTS || '').toUpperCase().split(',').map(s => s.trim()).filter(Boolean);
const SEGMENTS = wanted.length ? ALL_SEGMENTS.filter(s => wanted.includes(s.exchange)) : ALL_SEGMENTS;

// Calendar days from today to a contract's expiry, read from its name ("SENSEX 12NOV 77100 CE",
// "NATGASMINI 24NOV FUT"). The name carries no year, so a date already past is taken as next
// year's. Returns null when the name has no DDMON expiry (e.g. an equity).
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

// Fixed TC numbers per step, the same in every segment (the [NSE]/[NSE BUY] tag says which run):
//   1 Markets | 2 search (CDS: Currency movers) | 3 search result | 4 expand Quote | 5 circuits
//   6 BUY -> Order Pad | 7 Order Pad fields
//   8-23  BUY side:  8 exchange radio/tile + Regular | 9 quantity/lots | 10 amount (derivatives: Lot <-> Quantity) | 11 price
//                    12 Brokerage: Limit + Delivery/Carryforward | 13 Brokerage: Limit + Intraday
//                    14 market depth | 15 Market swap
//                    16 Brokerage: Market + Delivery/Carryforward | 17 Brokerage: Market + Intraday
//                    18 stoploss | 19 Delivery/Intraday | 20 More/validity | 21 disclosed qty | 22 MTF | 23 Buy/Sell swap
//   24 reopen as SELL | 25-40 SELL side (same steps, +17) | 41 reopen as BUY
//   42 lower circuit in Price | 43 Confirmation Preview
// Every segment runs every step on both sides. On NFO/BFO/MCX/CDS "Delivery" is Carryforward, MTF
// must be absent, and a contract expiring today/tomorrow has no Intraday (those steps are skipped).
const tc = (no, text) => console.log(`\nTC ${no}: ${text}`);

// Non-executable BUY: a limit order at the Quote's own lower circuit. Tapping the Order Pad's
// BUY only opens the Confirmation Preview - this checks that popup carries the lower circuit
// price and then closes it with back. CONFIRM is never tapped, so no order is placed.
async function runSegment({ exchange, query, position, source }, marketsPage, quotesPage, orderPadPage) {
    console.log(`\n========== ${exchange}: ${source === 'currencyMovers' ? 'Currency Top Gainers/Losers' : `"${query}" result #${position}`} ==========`);

    tc(1, `[${exchange}] Navigating to Markets...`);
    if (!(await marketsPage.waitForEquityLoaded(3000))) {
        await marketsPage.clickMarketNavButton();
        if (!(await marketsPage.waitForEquityLoaded(10000))) {
            throw new Error('Markets screen did not load');
        }
    }
    await marketsPage.scrollToTop();

    if (source === 'currencyMovers') {
        tc(2, `[${exchange}] Clicking Currency and the first Top Gainers symbol (Top Losers if none), verifying its ${exchange} Quote opens...`);
        if (!(await marketsPage.openFirstCurrencyGainerOrLoser())) {
            throw new Error('No Currency Top Gainers/Top Losers symbol could be opened');
        }
    } else {
        tc(2, `[${exchange}] Opening global search and searching "${query}"...`);
        if (!(await marketsPage.clickGlobalSearchBar())) {
            throw new Error('Global search screen did not open from the Markets search bar');
        }
        await marketsPage.typeInSearch(query);

        tc(3, `[${exchange}] Clicking search result #${position} and verifying its ${exchange} Quote opens...`);
        const symbol = await marketsPage.tapSearchResult(query, position);
        if (!symbol || !(await marketsPage.verifyQuoteOpened(symbol))) {
            throw new Error(`Quote screen did not open for "${query}" result #${position}`);
        }
    }
    const header = await quotesPage.getQuoteHeader();
    const quoteExchange = header ? header.exchange : null;
    const exchangeOk = quoteExchange === exchange;
    console.log(`Quote opened on ${quoteExchange || 'unknown exchange'} (expected ${exchange}): ${exchangeOk ? 'PASS' : 'FAIL'}`);
    if (!exchangeOk) {
        throw new Error(`Opened symbol is not a ${exchange} symbol${query ? ` - set ${exchange}_QUERY / ${exchange}_POSITION` : ''}`);
    }

    tc(4, `[${exchange}] Expanding the Quote screen...`);
    if (!(await quotesPage.swipeUpQuoteScreen())) {
        throw new Error('Quote screen did not expand');
    }

    // The Order Pad doesn't show circuit limits, so read them here before tapping BUY.
    tc(5, `[${exchange}] Reading the lower circuit from the Quote screen...`);
    const limits = await quotesPage.getCircuitLimits();
    if (!limits) throw new Error('Could not read circuit limits from the Quote screen');

    tc(6, `[${exchange}] Clicking BUY on the Quote and verifying the Buy Order Pad opens...`);
    await quotesPage.clickBuy();
    if (!(await orderPadPage.verifyOpenedFor('Buy'))) {
        throw new Error('Buy Order Pad did not open');
    }

    tc(7, `[${exchange}] Verifying Order Type, Quantity (filled by default), Price, Add Stoploss, product options, More, Approx/Avail margin and BUY are displayed...`);
    const days = daysToExpiry(header && header.symbol);
    if (days !== null) console.log(`${header.symbol} expires in ${days} day(s)${days <= 1 ? ' - Intraday not expected' : ''}`);
    await orderPadPage.verifyOrderPadFields(exchange, { nearExpiry: days !== null && days <= 1 });

    {
        // Each side leaves the pad changed (SL on, Disclosed Qty, MTF, product/price type), so every
        // side gets a freshly opened pad, and the lower-circuit BUY below gets one too.
        // Every segment gets the same walk-through on both sides (derivative differences handled inside).
        // Derivatives: no Intraday near expiry, and some contracts show it disabled (BFO) - either
        // way the Intraday steps are skipped. Read on each side's fresh pad would be the same contract.
        const derivative = !['NSE', 'BSE'].includes(exchange);
        const noIntraday = derivative && ((days !== null && days <= 1) || !(await orderPadPage.getProductState('Intraday')).actionable);
        if (derivative && noIntraday) console.log(`Intraday not actionable for ${header && header.symbol} - Intraday steps skipped on both sides`);
        const runSide = side => validateOrderPad(orderPadPage, exchange, header && header.symbol, side, { noIntraday });
        const reopen = async (no, side) => {
            tc(no, `[${exchange}] Going back to the Quote and opening a fresh ${side} Order Pad...`);
            await orderPadPage.hideKeyboardIfShown();
            await orderPadPage.goBackToQuotes();
            await orderPadPage.pause(1000);
            await (side === 'Buy' ? quotesPage.clickBuy() : quotesPage.clickSell());
            if (!(await orderPadPage.verifyOpenedFor(side))) {
                throw new Error(`${side} Order Pad did not open after the ${exchange} checks`);
            }
        };
        try {
            await runSide('Buy');
        } finally {
            await reopen(24, 'Sell');
        }
        try {
            await runSide('Sell');
        } finally {
            await reopen(41, 'Buy');
        }
    }

    tc(42, `[${exchange}] Entering the lower circuit (${limits.lower}) in Price...`);
    await orderPadPage.ensureLimitMode();
    if (!(await orderPadPage.setPrice(limits.lower))) {
        throw new Error(`Price field did not take the lower circuit ${limits.lower}`);
    }

    tc(43, `[${exchange}] Clicking BUY and verifying the Confirmation Preview shows the lower circuit price...`);
    await orderPadPage.clickBuy();
    const result = await orderPadPage.waitForBuyOutcome();
    if (result.outcome === 'confirmation') {
        const details = await orderPadPage.getConfirmationDetails();
        console.log(`Confirmation Preview: ${JSON.stringify(details)}`);
        const priceOk = Number(String(details.Price || '').replace(/,/g, '')) === Number(limits.lower);
        console.log(`Confirmation price ${details.Price} matches lower circuit ${limits.lower}: ${priceOk ? 'PASS' : 'FAIL'}`);
        console.log(`Confirmation exchange ${details.Exchange} matches ${exchange}: ${details.Exchange === exchange ? 'PASS' : 'FAIL'}`);
        await orderPadPage.dismissConfirmationPopup();
    } else if (result.outcome === 'dpr') {
        console.log(`BUY at the lower circuit rejected with "${result.message}": FAIL`);
    } else {
        console.log('Neither the Confirmation Preview nor a DPR error appeared after BUY: FAIL');
    }
}

// Tap the pad's own BUY/SELL with the given price type + product, open Applicable Charges on the
// Confirmation Preview and verify Brokerage is displayed - then back out without confirming.
async function checkBrokerage(pad, no, tag, side, priceType, product) {
    tc(no, `[${tag}] Tapping ${side.toUpperCase()} with ${priceType} + ${product}, opening Applicable Charges and verifying Brokerage is displayed...`);
    await pad.setPriceType(priceType);
    await pad.selectProduct(product);
    await pad.verifyBrokerageOnConfirmation({ side, priceType, product });
}

// Order Pad walk-through for a pad opened from the Quote's BUY or SELL (`side`), on any segment.
// The pad's own BUY/SELL is tapped only for the Brokerage steps, which open the Confirmation
// Preview and back out of it - CONFIRM is never tapped, so no order is placed.
// Deviation from the written steps: the price is swapped back to Limit before turning on the
// stoploss, since a trigger "below/above the entered price" only means something with a limit price.
// Buy vs Sell: the stoploss trigger goes below the price on Buy and above it on Sell. MTF is only
// offered on NSE BUY (and only for MTF-eligible symbols) - everywhere else it must not be shown.
// Equity margins move the same way on both sides (checked live on RTNPOWER: Sell 1 -> 12 qty took
// Approx margin 7.06 -> 84.72, Intraday -> 16.94).
// Derivatives (NFO/BFO/MCX/CDS), from the NFO pad dump (ui_dumps/r35_confirmation_popup_missing.xml):
//   - a single exchange tile instead of the NSE/BSE radios;
//   - the pad opens in Quantity mode with one lot ("65 Qty = 1 Lot" above the box); +1 means one
//     more lot, and the swap is Quantity <-> Lot, not Amount;
//   - the holding product is Carryforward; a contract expiring today/tomorrow offers no Intraday,
//     so the Intraday steps are skipped (`noIntraday`);
//   - margin isn't simply qty x price: only an option BUY (premium) must rise with the price and
//     change on Limit -> Market; futures / option-sell / Intraday margin moves are logged, not judged.
// NOT YET SEEN LIVE on a derivative pad: Market Depth, the stoploss trigger, Validity, Disclosed Qty.
async function validateOrderPad(pad, exchange, symbol, side = 'Buy', { noIntraday = false } = {}) {
    const ex = `${exchange} ${side.toUpperCase()}`;
    const isBuy = side === 'Buy';
    const equity = ['NSE', 'BSE'].includes(exchange);
    const holding = equity ? 'Delivery' : 'Carryforward';
    const optionBuy = !equity && isBuy && /\b(CE|PE)\s*$/i.test(symbol || '');
    // Margin direction expected per step (see above): 'any' = log only.
    const dir = {
        price: equity || optionBuy ? 'up' : 'any',
        market: equity || optionBuy ? 'change' : 'any',
        intraday: equity ? 'down' : 'any',
    };
    // 4 decimals: CDS ticks are 0.0025.
    const r4 = n => Math.round(n * 10000) / 10000;
    const toNum = t => Number(String(t || '').replace(/,/g, ''));
    // TC number for this step on the BUY pad / on the SELL pad (see the table at the top).
    const no = (buy, sell) => (isBuy ? buy : sell);
    const skipIntraday = n => tc(n, `[${ex}] Intraday step skipped - Intraday isn't actionable for this contract (disabled, or expires today/tomorrow)`);

    tc(no(8, 25), `[${ex}] Verifying the ${exchange} ${equity ? 'radio' : 'exchange tile'} is selected and Order Type is Regular...`);
    await pad.verifyExchangeSelected(exchange);
    await pad.verifyOrderTypeRegular();
    const ltp = await pad.getExchangeLtp(exchange);
    console.log(`${exchange} LTP on the Order Pad: ${ltp}`);

    // Derivatives: the pad opens in Quantity mode with one lot ("65 Qty = 1 Lot" above the box for
    // NIFTY, 20 for SENSEX), so "+1" means one more lot - quantity goes up by the lot size.
    // Derivatives: the box opens on one lot, either in Quantity mode ("65 Qty = 1 Lot" above it for
    // NIFTY, 20 for SENSEX) or in Lot mode (reads 1). "+1" means one more lot either way.
    tc(no(9, 26), `[${ex}] Verifying Quantity is pre-filled, then increasing it by ${equity ? '1' : 'one lot'}...`);
    await pad.verifyQuantityPrefilled();
    const defaultQty = toNum(await pad.getQuantity());
    let lot = null;
    if (!equity) {
        lot = await pad.getLotInfo();
        console.log(`Lot size shown above the ${lot.mode || 'Qty/Lot'} box (note "${lot.note}", lot size ${lot.size}): ${lot.size ? 'PASS' : 'FAIL'}`);
        if (!lot.size) {
            // Don't stop the walk-through on an unrecognised note - work the lot size out instead.
            lot.size = await pad.deriveLotSizeBySwap(lot.mode);
            if (!lot.size) throw new Error(`Lot size could not be read (note "${lot.note}") or worked out by swapping`);
        }
        const oneLot = lot.mode === 'Lot' ? 1 : lot.size;
        console.log(`Default ${lot.mode === 'Lot' ? 'lots' : 'quantity'} ${defaultQty} is one lot (${oneLot}): ${defaultQty === oneLot ? 'PASS' : 'FAIL'}`);
    }
    let margin = (await pad.readMargins()).approxText;
    // Value typed into the box: +1 share (equity), +1 lot in units (Quantity mode) or +1 lot (Lot mode).
    const boxValue = equity ? defaultQty + 1 : lot.mode === 'Lot' ? defaultQty + 1 : defaultQty + lot.size;
    await pad.setQuantity(boxValue);
    let qty = equity || lot.mode !== 'Lot' ? boxValue : boxValue * lot.size;
    if (!equity) console.log(`Quantity ${qty} is ${qty / lot.size} lots of ${lot.size}: ${qty % lot.size === 0 ? 'PASS' : 'FAIL'}`);
    margin = (await pad.verifyApproxMarginMoved(margin, 'up', `${lot && lot.mode === 'Lot' ? 'lots' : 'quantity'} ${defaultQty} -> ${boxValue}`)).text;

    if (equity) {
        tc(no(10, 27), `[${ex}] Swapping Quantity to Amount and verifying the rounded-up amount, then swapping back...`);
        const priceNow = toNum(await pad.getPrice());
        await pad.verifySwapToAmount(qty, priceNow, ltp);
        await pad.swapBackToQuantity();
    } else if (lot.mode === 'Lot') {
        tc(no(10, 27), `[${ex}] Swapping Lot to Quantity (${boxValue} x ${lot.size}), back to Lot, increasing the lot by 1, and verifying Quantity updates on swapping...`);
        qty = (await pad.verifySwapLotToQuantityAndBack(boxValue, lot.size)).qty;
    } else {
        tc(no(10, 27), `[${ex}] Swapping Quantity to Lot (${qty} / ${lot.size} = ${qty / lot.size}), increasing the lot by 1, and verifying Quantity updates on swapping back...`);
        qty = (await pad.verifySwapQuantityToLotAndBack(qty, lot.size)).qty;
    }
    margin = (await pad.readMargins()).approxText;

    tc(no(11, 28), `[${ex}] Verifying Price (Limit) is the default with the LTP filled in, then increasing it by 1...`);
    const mode = await pad.getPriceMode();
    console.log(`Price mode defaults to Limit (reads "${mode}"): ${mode === 'Limit' ? 'PASS' : 'FAIL'}`);
    // The box is filled once when the pad opens while the LTP keeps ticking (live NFO: price 157.4
    // vs LTP 158.7 a few seconds later) - so accept a price within 1% of either the LTP read at the
    // start of this walk-through or the current one.
    const LTP_TOLERANCE = 0.01;
    const price = toNum(await pad.getPrice());
    const ltpNow = await pad.getExchangeLtp(exchange);
    const near = l => l !== null && l > 0 && Math.abs(price - l) <= l * LTP_TOLERANCE;
    console.log(`Price field holds the LTP within ${LTP_TOLERANCE * 100}% (price ${price}, LTP ${ltp}${ltpNow !== ltp ? ` / now ${ltpNow}` : ''}): ${near(ltp) || near(ltpNow) ? 'PASS' : 'FAIL'}`);
    margin = (await pad.readMargins()).approxText;
    await pad.setPrice(r4(price + 1));
    await pad.hideKeyboardIfShown();
    margin = (await pad.verifyApproxMarginMoved(margin, dir.price, `price ${price} -> ${r4(price + 1)}`)).text;

    await checkBrokerage(pad, no(12, 29), ex, side, 'Limit', holding);
    if (noIntraday) skipIntraday(no(13, 30));
    else await checkBrokerage(pad, no(13, 30), ex, side, 'Limit', 'Intraday');
    await pad.selectProduct(holding);
    margin = (await pad.readMargins()).approxText;

    tc(no(14, 31), `[${ex}] Opening Market Depth from the price field and closing it with back...`);
    await pad.verifyMarketDepthOpensAndCloses();

    tc(no(15, 32), `[${ex}] Swapping Price to Market and verifying 0 is shown and Approx margin changes...`);
    await pad.verifySwapToMarket();
    margin = (await pad.verifyApproxMarginMoved(margin, dir.market, 'Limit -> Market')).text;

    await checkBrokerage(pad, no(16, 33), ex, side, 'Market', holding);
    if (noIntraday) skipIntraday(no(17, 34));
    else await checkBrokerage(pad, no(17, 34), ex, side, 'Market', 'Intraday');
    await pad.selectProduct(holding);
    margin = (await pad.readMargins()).approxText;

    tc(no(18, 35), `[${ex}] Swapping back to Limit, turning on Stoploss and entering a trigger ${isBuy ? 'below' : 'above'} the price...`);
    await pad.ensureLimitMode();
    await pad.verifyStoplossToggleShowsTrigger();
    const limitPrice = toNum(await pad.getPrice());
    const trigger = isBuy
        ? r4(limitPrice > 1 ? limitPrice - 0.5 : limitPrice * 0.9)
        : r4(limitPrice + 0.5);
    console.log(`Trigger ${trigger} is ${isBuy ? 'below' : 'above'} the limit price ${limitPrice}`);
    await pad.setTriggerPrice(trigger);

    if (noIntraday) {
        tc(no(19, 36), `[${ex}] Verifying ${holding} is the default product (Intraday not offered - switch skipped)...`);
        await pad.verifyProductSelected(holding);
    } else {
        tc(no(19, 36), `[${ex}] Verifying ${holding} is the default product, switching to Intraday and back...`);
        await pad.verifyProductSelected(holding);
        margin = (await pad.readMargins()).approxText;
        await pad.selectProduct('Intraday');
        margin = (await pad.verifyApproxMarginMoved(margin, dir.intraday, `${holding} -> Intraday`)).text;
        await pad.selectProduct(holding);
    }

    tc(no(20, 37), `[${ex}] Expanding More, checking Validity options and reselecting the default...`);
    await pad.expandMore();
    await pad.verifyValidityOptions();

    tc(no(21, 38), `[${ex}] Entering 1 in Disclosed Qty (if offered)...`);
    await pad.enterDisclosedQty(1);

    let mtf = null;
    if (exchange !== 'NSE' || !isBuy) {
        const where = exchange !== 'NSE' ? `a ${exchange} order` : 'a SELL order';
        tc(no(22, 39), `[${ex}] Verifying MTF is not displayed on ${where}...`);
        const mtfShown = await pad.findMtfNode();
        console.log(`MTF not displayed on ${where}: ${mtfShown ? `FAIL (shows "${mtfShown.desc || mtfShown.text}")` : 'PASS'}`);
    } else {
        tc(no(22, 39), `[${ex}] Selecting MTF (if offered for ${symbol || 'this symbol'}) and verifying Approx margin updates...`);
        mtf = await pad.findMtfNode();
        if (!mtf) {
            // MTF is only for MTF-eligible NSE symbols, so its absence alone isn't a failure.
            console.log(`MTF not displayed for ${symbol || 'this symbol'} - not MTF-eligible, skipped`);
        } else {
            margin = (await pad.readMargins()).approxText;
            await pad.tapNode(mtf);
            await pad.pause(800);
            await pad.verifyApproxMarginMoved(margin, 'change', 'selecting MTF');
        }
    }

    tc(no(23, 40), `[${ex}] Swapping ${isBuy ? 'BUY to SELL' : 'SELL to BUY'} and back, then verifying Available margin is displayed...`);
    await pad.verifyBuySellSwap({ from: side, mtfWasShown: !!mtf });
    const { availText } = await pad.readMargins();
    console.log(`Available margin displayed ("${availText}"): ${availText !== null ? 'PASS' : 'FAIL'}`);
}

// Like utils/logger's getFailedTCs, but keyed on "TC N [TAG]" - TC numbers repeat in every
// segment here, so the number alone would merge NSE's and BSE's failures into one entry.
function getFailedTCs(entries) {
    let current = null;
    const byTC = new Map();
    for (const e of entries) {
        const m = e.message.match(/TC (\d+): (\[[^\]]+\])?/);
        if (m) current = `TC ${m[1]}${m[2] ? ` ${m[2]}` : ''}`;
        if (current && (e.level === 'error' || /FAIL/.test(e.message))) {
            if (!byTC.has(current)) byTC.set(current, []);
            byTC.get(current).push(e.message.trim());
        }
    }
    return [...byTC.entries()].map(([tc, messages]) => ({ tc, messages }));
}

// Order Pad -> Quote -> search -> Markets. Back presses never confirm anything; they only run
// once search was reached, so a failure on Markets itself can't back out of the app.
async function returnToMarkets(driver, marketsPage) {
    try {
        // Order Pad / Quote -> either search (searched symbols) or Markets itself (Currency movers).
        const onSearch = () => marketsPage.isElementVisible(marketsPage.searchCancelButton, 1000);
        for (let i = 0; i < 4 && !(await marketsPage.waitForEquityLoaded(1000)) && !(await onSearch()); i++) {
            await driver.back();
            await marketsPage.pause(800);
        }
        if (await onSearch()) await marketsPage.closeGlobalSearch();
        if (!(await marketsPage.navigateBackToMarkets())) return false;
        // Leave Markets on Equity (the CDS run switches it to Currency).
        if (!(await marketsPage.isSegmentTabSelected(marketsPage.equityTab))) {
            await marketsPage.clickSegmentTab('Equity', marketsPage.equityTab);
        }
        return true;
    } catch (e) {
        console.error('Could not get back to Markets:', e.message);
        return false;
    }
}

async function run() {
    const driver = await DriverManager.getDriver();
    const marketsPage = new MarketsPage(driver);
    const quotesPage = new QuotesPage(driver);
    const orderPadPage = new OrderPadPage(driver);
    try {
        console.log(`Segments: ${SEGMENTS.map(s => `${s.exchange} (${s.source === 'currencyMovers' ? 'Currency Top Gainers/Losers' : `"${s.query}" #${s.position}`})`).join(', ')}`);
        for (const segment of SEGMENTS) {
            try {
                await runSegment(segment, marketsPage, quotesPage, orderPadPage);
            } catch (err) {
                console.error(`${segment.exchange} failed:`, err.message);
            }
            if (!(await returnToMarkets(driver, marketsPage))) {
                throw new Error(`Stuck after ${segment.exchange} - could not return to Markets for the next segment`);
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
