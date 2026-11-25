const DriverManager = require('../../driver/DriverManager');
const SplashPage = require('../../pages/SplashPage');
const PortfolioPage = require('../../pages/PortfolioPage');
const OrderPadPage = require('../../pages/OrderPadPage');
const permissionHandler = require('../../utils/permissionHandler');
const { createLogger, getFailedTCs } = require('../../utils/logger');

const { logFile, entries } = createLogger('Portfolio_Positions');
console.log(`Logging this run to: ${logFile}`);

// Nothing is placed or converted. Tapped: the Portfolio bottom-nav button, the Positions tab, the
// Today / Derivatives sub-tabs, each position row (its detail sheet) and the sheet's View Chart,
// Add Alert, Option Chain, BUY MORE / SELL, SQUARE OFF and CONVERT - each only OPENS a screen,
// which is checked and left with back / Close. On an Order Pad its BUY / SELL is never tapped; on
// the Convert screen its Convert button is never tapped (only the Convert to dropdown and the Qty
// box, set back to the original). Exit Positions mode is entered (rows ticked, Select All / Clear
// All) and left with Cancel; its Confirm Exit Positions - which squares off the selected positions at
// market price - is tapped ONLY with EXIT_POSITIONS_POPUP_TEST=1, and its popup is only answered No.
//
// Sub-tabs:
//   Today       - every buy and sell executed today, ALL segments (equity and derivatives).
//                 Nothing stays on Today for more than one day: an equity position moves to
//                 Holdings the next day, so no Today equity symbol is in Holdings yet.
//   Derivatives - only derivative positions - NFO / BFO (F&O), CDS (currency) and MCX (commodity):
//                 every derivative executed today AND every open derivative executed earlier
//                 (carried forward) - the "Holdings" of derivatives. So each Today derivative row is
//                 also on Derivatives; Derivatives rows not on Today are the carried-forward ones.
//
// TC 1 launch | TC 2 on Portfolio (Portfolio in the bottom navigation if not) | TC 3 Positions tab,
// its count, Today the default sub-tab | TC 4 Today sub-tab: rows vs its own count | TC 5 the same
// on Derivatives | TC 4a-d / 5a-d per sub-tab: Exit Positions shown only when positions are listed (never
// tapped), search a listed symbol + Clear + Cancel, Filter opens, Alerts opens | TC 4e-h Today's Exit
// Positions screen: open positions listed, tick / untick, Select All / Clear All / Select All, Confirm
// -> Yes / No popup -> No (only with EXIT_POSITIONS_POPUP_TEST=1), Cancel, nothing exited | TC 5 also: every Derivatives row is NFO / BFO / CDS / MCX, every Today derivative row is on Derivatives (the rest are
// carried forward), then the Positions count vs the sub-tabs (same rule
// as Holdings.test.js / R58) | TC 6 click every Today symbol: row (name, expiry for derivatives, P&L value
// and %, LTP, change value and %, Qty, Avg, order tag) and detail sheet (the same plus Buy / Sell
// Qty, Avg, Value, Market Value, Open Value, View Chart, Add Alert, Option Chain if applicable, BUY
// MORE for a buy / SELL for a sell position, SQUARE OFF, CONVERT), each executed today, P&L
// recalculated | TC 6a Today's cumulative P&L vs its symbols | per symbol: TC 6b View Chart, 6c Add
// Alert, 6d Option Chain (if shown), 6e BUY MORE -> Buy Order Pad / SELL -> Sell Order Pad (pad
// side, symbol, products: Delivery / Intraday equity, Carryforward / Intraday derivatives), 6f SQUARE
// OFF -> opposite-side Order Pad with the position's product, 6g CONVERT -> name (expiry),
// Existing product = executed product, Convert to + its dropdown = the alternatives (equity
// Intraday <-> Delivery (+ MTF on applicable NSE), derivatives Intraday <-> C.Fwd, no C.Fwd on
// BFO), Qty modified and restored, Convert button shown | TC 7 / 7a-g the same on Derivatives -
// CONVERT only on derivatives executed today (also on Today), never on carried-forward ones | TC 8 Holdings
// tab: no Today equity symbol is listed in Holdings.
//
// The position row and detail sheet grammar has not been captured yet: the first sheet of each
// sub-tab is saved to ui_dumps/portfolio_position_details_<subtab>.xml.

const tc = (no, text) => console.log(`\nTC ${no}: ${text}`);

// PNL_ONLY=1: TC 1-7 with each symbol's details / P&L and the cumulative P&L, but none of the sheet
// buttons clicked through (TC 6b-g / 7b-g) and no TC 8.
const PNL_ONLY = process.env.PNL_ONLY === '1';
// CONTROLS_ONLY=1: TC 1-5 with the Search / Filter / Alerts / Exit Positions checks (4a-h, 5a-d),
// without clicking through each symbol (TC 6 / 7) or TC 8.
const CONTROLS_ONLY = process.env.CONTROLS_ONLY === '1';

// Derivatives = NFO, BFO (F&O), CDS (currency) and MCX (commodity). Derivative markers: option /
// future type, an expiry date ("25NOV", "27 NOV 2025"), or one of those exchanges. Non-derivative
// markers: a cash-equity series / exchange.
const DERIV_EXCHANGE_RE = /\b(NFO|BFO|CDS|MCX)\b/;

// A row as logged: without its ", Double tap to view position details" hint, lines joined by " | ".
const showRow = r => String(r || '').replace(/,?\s*Double tap to view position details\.?\s*$/i, '').replace(/\n/g, ' | ').trim();
const DERIV_MARKERS = [
    /\b(CE|PE|FUT|FUTIDX|FUTSTK|OPTIDX|OPTSTK|FUTCUR|OPTCUR|FUTCOM|OPTFUT)\b/i,
    /\b\d{1,2}\s?(JAN|FEB|MAR|APR|MAY|JUN|JUL|AUG|SEP|OCT|NOV|DEC)(\s?\d{2,4})?\b/i,
    DERIV_EXCHANGE_RE,
];
const NON_DERIV_MARKERS = [
    /-(EQ|BE)\b/i,
    /Exchange:\s*(NSE|BSE)\b/i,
];
const firstHit = (raw, res) => res.map(re => raw.match(re)).find(Boolean);

// Symbols are compared case-insensitively, ignoring spaces and an exchange / series suffix
// ("RTNPOWER-EQ", "IDEA BSE") - same as Holdings.test.js.
const normSymbol = s => String(s || '').toUpperCase().replace(/[-\s](EQ|BE|NSE|BSE)$/, '').replace(/\s+/g, '');

// Rows are matched across sub-tabs on everything before "Quantity:" (symbol, contract, exchange,
// product) - the quantity can differ when today's trade adds to a carried-forward derivative position.
const rowKey = r => r.split(/\s*Quantity:/)[0].trim();

// Derivatives = today's derivatives + carried-forward derivatives: every Today derivative row must be on Derivatives, and
// the Derivatives rows not on Today are the ones executed earlier. Only checked when every row on
// both sub-tabs was read.
function checkTodayDerivOnDerivatives(today, deriv) {
    if (today.rows.length !== today.count || deriv.rows.length !== deriv.count) {
        console.log(`Not every row was read (Today ${today.rows.length}/${today.count}, Derivatives ${deriv.rows.length}/${deriv.count}) - Today derivative vs Derivatives not compared`);
        return;
    }
    const todayDeriv = today.rows.filter(r => firstHit(r, DERIV_MARKERS));
    const derivKeys = new Set(deriv.rows.map(rowKey));
    const missing = todayDeriv.filter(r => !derivKeys.has(rowKey(r)));
    if (!todayDeriv.length) console.log('No derivative executed today - nothing to find on Derivatives: PASS');
    else if (missing.length) console.error(`FAIL: derivative executed today but not on Derivatives: ${missing.map(r => PortfolioPage.positionSymbol(r)).join(', ')}`);
    else console.log(`All ${todayDeriv.length} derivative row(s) executed today are on Derivatives: PASS`);

    const todayKeys = new Set(today.rows.map(rowKey));
    const carried = deriv.rows.filter(r => !todayKeys.has(rowKey(r)));
    console.log(`Derivatives carried forward (executed before today): ${carried.length}${carried.length ? ` - ${carried.map(r => PortfolioPage.positionSymbol(r)).join(', ')}` : ''}`);
    const todayOnDeriv = deriv.rows.length - carried.length;
    console.log(`Derivatives ${deriv.count} = today's derivative ${todayDeriv.length} + carried forward ${carried.length}: ${todayOnDeriv === todayDeriv.length ? 'PASS' : `FAIL (${todayOnDeriv} Derivatives row(s) are also on Today, Today has ${todayDeriv.length} derivative row(s))`}`);
}

// Today's equity rows: not a derivative (NFO / BFO / CDS / MCX). These are the ones that move to
// Holdings the next day.
const isTodayEquityRow = r => !firstHit(r, DERIV_MARKERS);

// Today's equity executions only reach Holdings the next day, so none of them may already be
// listed in Holdings. Taps the Holdings tab (read-only).
async function checkTodayNotInHoldings(portfolio, todayRows) {
    const equity = todayRows.filter(isTodayEquityRow).map(r => PortfolioPage.positionSymbol(r));
    console.log(`Today equity position(s): ${equity.length ? equity.join(', ') : 'none'}`);

    await portfolio.tapTopTab('Holdings');
    const holdSelected = (await portfolio.getSelectedTopTab()) === 'Holdings';
    console.log(`Holdings tab selected: ${holdSelected ? 'PASS' : 'FAIL'}`);
    if (!equity.length) {
        console.log('No equity executed today - nothing to compare with Holdings: PASS');
        return;
    }

    const holdings = (await portfolio.collectAllHoldingRows()).map(r => PortfolioPage.parseHoldingRow(r));
    console.log(`Holdings listed (${holdings.length}): ${holdings.map(h => h.symbol).join(', ') || 'none'}`);
    const holdingSet = new Set(holdings.map(h => normSymbol(h.symbol)));
    const overlap = equity.filter(s => holdingSet.has(normSymbol(s)));
    if (overlap.length) {
        console.error(`FAIL: symbol(s) executed today already listed in Holdings (should move there only the next day): ${overlap.join(', ')}`);
    } else {
        console.log(`None of today's ${equity.length} equity symbol(s) (${equity.join(', ')}) are in Holdings: PASS`);
    }
}

// Derivatives lists only NFO / BFO / CDS / MCX positions: a row with a cash-equity marker is a FAIL;
// a row with no marker either way (row format not confirmed yet) is reported and the screen dumped,
// not passed silently.
async function checkDerivativesSegments(portfolio, rows) {
    if (!rows.length) return;
    let bad = 0, unknown = 0;
    for (const r of rows) {
        const sym = PortfolioPage.positionSymbol(r);
        const nonDeriv = firstHit(r, NON_DERIV_MARKERS);
        const deriv = firstHit(r, DERIV_MARKERS);
        if (nonDeriv && !DERIV_EXCHANGE_RE.test(r)) {
            bad++;
            console.error(`FAIL: Derivatives lists a non-derivative position ${sym} ("${nonDeriv[0]}"): ${showRow(r)}`);
        } else if (!deriv) {
            unknown++;
            console.log(`Derivatives row ${sym}: no derivative marker found - segment not confirmed: ${showRow(r)}`);
        }
    }
    if (unknown) await portfolio.dumpPageSource('portfolio_positions_derivatives_segment');
    if (!bad && !unknown) console.log(`All ${rows.length} Derivatives row(s) are NFO / BFO / CDS / MCX: PASS`);
    else if (!bad) console.log(`No non-derivative row on Derivatives, ${unknown} row(s) unconfirmed - see the dump`);
}

// ---- Position details and P&L ----
const num = s => (s == null || s === '' ? null : Number(String(s).replace(/,/g, '')));
const fmt = n => (n == null || Number.isNaN(n) ? 'n/a' : Number(n).toFixed(2));
const verdict = ok => (ok ? 'PASS' : 'FAIL');
const round2 = n => Math.round((n + Math.sign(n) * 1e-9) * 100) / 100;
const near = (a, b, tol = 0.01) => a != null && b != null && !Number.isNaN(a) && !Number.isNaN(b) && Math.abs(round2(a) - round2(b)) <= tol + 1e-9;
// A negative P&L must carry its minus sign - an unsigned loss is a FAIL, named as such (same rule
// as Holdings.test.js).
const valueVerdict = (shown, expected, tol = 0.01) => {
    if (near(shown, expected, tol)) return 'PASS';
    if (shown != null && expected != null && expected < 0 && shown > 0 && near(-shown, expected, tol))
        return `FAIL (minus sign missing: app shows ${fmt(shown)} - expected ${fmt(expected)})`;
    return 'FAIL';
};

// Prices tick while positions are opened one by one: Mon-Fri 09:00-23:30 IST (equity, F&O,
// currency and commodity sessions together) - outside that only rounding tolerances apply.
function pricesMayTick() {
    const parts = Object.fromEntries(new Intl.DateTimeFormat('en-GB', {
        timeZone: 'Asia/Kolkata', weekday: 'short', hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
    }).formatToParts(new Date()).map(p => [p.type, p.value]));
    const minutes = Number(parts.hour) * 60 + Number(parts.minute);
    return !['Sat', 'Sun'].includes(parts.weekday) && minutes >= 9 * 60 && minutes < 23 * 60 + 30;
}

// The year is 2 or 4 digits not followed by another digit, so "23DEC 500 CE" reads "23DEC", not the strike.
const EXPIRY_RE = /\b\d{1,2}\s?(JAN|FEB|MAR|APR|MAY|JUN|JUL|AUG|SEP|OCT|NOV|DEC)(\s?(\d{4}|\d{2}))?(?!\d)\b/i;
const ROW_FIELDS = [['pnl', 'P&L'], ['ltp', 'LTP'], ['change', 'Change'], ['qty', 'Qty'], ['avg', 'Avg']];
const SHEET_FIELDS = [
    ['pnl', 'P&L'], ['ltp', 'LTP'], ['change', 'Change'], ['qty', 'Qty'], ['avg', 'Avg'],
    ['buyQty', 'Buy Qty'], ['buyAvg', 'Buy Avg'], ['buyValue', 'Buy Value'],
    ['sellQty', 'Sell Qty'], ['sellAvg', 'Sell Avg'], ['sellValue', 'Sell Value'],
    ['marketValue', 'Market Value'], ['openValue', 'Open Value'],
];

// One position: its row (name, expiry for derivatives, P&L value / %, LTP, change value / %, Qty, Avg, tag),
// then its detail sheet (the same plus Buy / Sell Qty / Avg / Value, Market Value, Open Value and
// the buttons), the P&L recalculated, closed with back. No button on the sheet is tapped.
//   `executedToday` - the position was executed today (every Today row; a Derivatives row that is
//                     also on Today): it must show buy / sell activity, and CONVERT must be shown.
//                     A carried-forward Derivatives position must NOT show CONVERT.
// Returns { symbol, pnl, computedPnl, marketValue } or null when the sheet couldn't be read.
async function checkPosition(portfolio, subTab, raw, { executedToday, dumpName }) {
    const symbol = PortfolioPage.positionSymbol(raw);
    const isDeriv = !!firstHit(raw, DERIV_MARKERS);
    const row = PortfolioPage.readPositionFields([{ label: raw }]);
    const rowTags = PortfolioPage.positionTags([raw]);
    console.log(`\n${subTab} -> ${symbol}${isDeriv ? ' (derivative)' : ''}${executedToday ? ' - executed today' : ' - carried forward'}: ${showRow(raw)}`);

    const baseline = await portfolio.openPositionDetails(raw);
    if (!baseline) {
        await portfolio.dumpPageSource(`portfolio_position_${normSymbol(symbol)}_no_details`);
        console.error(`FAIL: could not open the details of ${symbol}`);
        await portfolio.closePositionDetails();
        return null;
    }
    if (dumpName) await portfolio.dumpPageSource(dumpName);
    const d = await portfolio.readPositionDetails(baseline);
    const closed = await portfolio.closePositionDetails();
    const f = d.fields;
    const v = k => (f[k] ? f[k].value : null);
    // Change value as the app shows it - read from the Order Pad header (never calculated).
    const exchange = (raw.match(/Exchange:\s*([A-Z]+)/i) || [])[1] || null;
    const pad = await fetchChangeFromOrderPad(portfolio, raw, subTab, d.buttons, exchange);

    // Row: what the row's accessibility text carries. Values drawn on the row but not in its
    // accessibility text (as on Holdings) are reported and verified on the detail sheet instead.
    console.log(`${symbol} name on the row: ${verdict(!!symbol)}`);
    if (isDeriv) console.log(`${symbol} expiry on the row: ${verdict(EXPIRY_RE.test(raw) || EXPIRY_RE.test(symbol))}${EXPIRY_RE.test(raw) ? ` (${raw.match(EXPIRY_RE)[0]})` : ''}`);
    // Change percent comes with the LTP ("Last traded price is 3.10 (-18.42 percent)" - live
    // 2026-11-25); the sheet has no separate Change label.
    const changePct = f.change && f.change.percent != null ? f.change.percent : (f.ltp ? f.ltp.percent : null);
    const onSheet = k => (k === 'change' ? changePct != null : !!f[k]);
    for (const [k, name] of ROW_FIELDS) {
        const r = row[k];
        const pct = k === 'pnl' || k === 'change';
        if (r && (!pct || r.percent != null)) console.log(`${symbol} row ${name}${pct ? ' value and percent' : ''} (${r.raw.replace(/\n/g, ' ')}): PASS`);
        // P&L / LTP / Change aren't in the row's accessibility text - they're verified on the sheet.
        else if (onSheet(k)) continue;
        else console.error(`FAIL: ${symbol} ${name} not shown on the row or the detail sheet`);
    }
    if (rowTags.length) console.log(`${symbol} order tag on the row (${rowTags.join(', ')}): PASS`);
    if (row.qty && f.qty) console.log(`${symbol} row Qty ${row.qty.value} matches the sheet (${f.qty.value}): ${verdict(row.qty.value === f.qty.value)}`);
    if (row.avg && f.avg) console.log(`${symbol} row Avg ${fmt(row.avg.value)} matches the sheet (${fmt(f.avg.value)}): ${verdict(near(row.avg.value, f.avg.value))}`);

    // Change value: the sheet exposes only the percent (with the LTP); the value comes from the app's
    // Order Pad header (fetched above), or from the sheet itself if it ever exposes one.
    const changeVal = f.change && f.change.value != null ? f.change.value : (pad.value ?? null);
    const changeSrc = f.change && f.change.value != null ? 'sheet' : pad.value != null ? `Order Pad, LTP ${fmt(pad.ltp)}` : null;

    // Detail sheet: every field shown, once each as "Label: value".
    const QTY_KEYS = ['qty', 'buyQty', 'sellQty'];
    const showField = (k, n) => {
        if (k === 'change') {
            if (changePct == null && changeVal == null) return `${n}: n/a`;
            return `${n}: ${changeVal != null ? fmt(changeVal) : 'n/a'} (${fmt(changePct)}%)${changeSrc ? ` [value from ${changeSrc}]` : ''}`;
        }
        if (!f[k] || f[k].value == null) return `${n}: n/a`;
        const val = QTY_KEYS.includes(k) ? f[k].value : fmt(f[k].value);
        return `${n}: ${val}${f[k].percent != null ? ` (${fmt(f[k].percent)}%)` : ''}`;
    };
    console.log(`${symbol} sheet: ${SHEET_FIELDS.map(([k, n]) => showField(k, n)).join(' | ')}`);
    const baseSym = normSymbol(symbol).match(/^[A-Z&-]+/);
    const named = !!baseSym && d.labels.some(t => normSymbol(t).includes(baseSym[0]));
    console.log(`${symbol} name on the detail sheet: ${verdict(named)}`);
    if (isDeriv) console.log(`${symbol} expiry on the detail sheet${d.expiry ? ` (${d.expiry})` : ''}: ${verdict(!!d.expiry)}`);
    for (const [k, name] of SHEET_FIELDS) {
        if (k === 'change') continue;
        const pct = k === 'pnl';
        console.log(`${symbol} ${name}${pct ? ' value and percent' : ''} shown: ${verdict(!!f[k] && (!pct || f[k].percent != null))}`);
    }
    console.log(`${symbol} Change percent shown${changePct != null ? ` (${fmt(changePct)}%)` : ''}: ${verdict(changePct != null)}`);
    if (f.change && f.change.value != null) {
        console.log(`${symbol} Change value shown on the sheet (${fmt(f.change.value)}): PASS`);
    } else if (pad.value != null) {
        console.log(`${symbol} Change value from the app's Order Pad header (${pad.exchange}: LTP ${fmt(pad.ltp)}, Change ${fmt(pad.value)}, ${fmt(pad.percent)}%): PASS`);
    } else {
        console.error(`FAIL: ${symbol} Change value could not be fetched from the app - ${pad.error}`);
    }
    const tags = [...new Set([...rowTags, ...d.tags])];
    console.log(`${symbol} order tag shown (${tags.join(', ') || 'none'}): ${verdict(tags.length > 0)}`);
    if (!SHEET_FIELDS.every(([k]) => k === 'change' || f[k]) && !dumpName) await portfolio.dumpPageSource(`portfolio_position_${normSymbol(symbol)}_details`);

    // Buy / sell order, from the sheet's Buy Qty and Sell Qty:
    //   Buy Qty > Sell Qty -> buy order;  Sell Qty > Buy Qty -> sell order;
    //   equal              -> closed position - it shows only BUY MORE (never SELL).
    // Only when Buy / Sell Qty weren't read does the sign of the shown Qty decide.
    const buyQ = v('buyQty'), sellQ = v('sellQty'), qty = v('qty');
    const bothRead = buyQ != null && sellQ != null;
    const side = bothRead
        ? (buyQ > sellQ ? 'buy' : sellQ > buyQ ? 'sell' : 'closed')
        : (qty == null ? 'unknown' : qty > 0 ? 'buy' : qty < 0 ? 'sell' : 'closed');
    console.log(`${symbol} order: Buy Qty ${buyQ ?? 'n/a'} vs Sell Qty ${sellQ ?? 'n/a'} -> ${side === 'buy' ? 'buy order' : side === 'sell' ? 'sell order' : side === 'closed' ? 'closed (Buy Qty = Sell Qty)' : 'unknown'}${bothRead ? '' : ` (from the sign of Qty ${qty ?? 'n/a'})`}`);
    // Net quantity for the P&L: Buy Qty - Sell Qty when it agrees with the shown Qty, else the shown
    // Qty signed by the order side (a carried-forward position's Qty includes earlier days).
    const net = bothRead && (qty == null || Math.abs(qty) === Math.abs(buyQ - sellQ))
        ? buyQ - sellQ
        : qty == null ? null : side === 'sell' ? -Math.abs(qty) : side === 'buy' ? Math.abs(qty) : qty;
    console.log(`${symbol} net position: ${net == null ? 'n/a' : net}`);

    // Executed today: Today lists only positions executed today, so each shows a buy or sell today.
    if (executedToday) {
        const traded = (buyQ || 0) > 0 || (sellQ || 0) > 0;
        console.log(`${symbol} executed today (Buy Qty ${buyQ ?? 'n/a'} / Sell Qty ${sellQ ?? 'n/a'}): ${verdict(traded)}`);
    }

    // Buttons (looked at, never tapped).
    const b = d.buttons;
    console.log(`${symbol} View Chart shown: ${verdict(b.viewChart)}`);
    console.log(`${symbol} Add Alert shown: ${verdict(b.addAlert)}`);
    console.log(`${symbol} Option Chain ${b.optionChain ? 'shown' : 'not shown (not applicable for this symbol)'}`);
    if (side === 'buy') {
        console.log(`${symbol} BUY MORE shown (buy order): ${verdict(b.buyMore)}`);
        if (b.sell) console.error(`FAIL: ${symbol} is a buy order but shows SELL instead of BUY MORE`);
    } else if (side === 'sell') {
        console.log(`${symbol} SELL shown (sell order): ${verdict(b.sell)}`);
        if (b.buyMore) console.error(`FAIL: ${symbol} is a sell order but shows BUY MORE instead of SELL`);
    } else if (side === 'closed') {
        // A closed position (Buy Qty = Sell Qty) still shows its Qty, and only BUY MORE - never SELL.
        console.log(`${symbol} closed (Buy Qty = Sell Qty) - Qty shown (${qty ?? 'n/a'}): ${verdict(qty != null)}`);
        console.log(`${symbol} closed (Buy Qty = Sell Qty) - BUY MORE shown: ${verdict(b.buyMore)}`);
        if (b.sell) console.error(`FAIL: ${symbol} is closed (Buy Qty = Sell Qty) but shows SELL - only BUY MORE should be shown`);
    } else {
        console.error(`FAIL: ${symbol} buy / sell order not determined - Buy Qty, Sell Qty and Qty not read`);
    }
    if (side !== 'closed') console.log(`${symbol} SQUARE OFF shown: ${verdict(b.squareOff)}`);
    else console.log(`${symbol} SQUARE OFF ${b.squareOff ? 'shown' : 'not shown'} (position closed)`);
    if (executedToday) console.log(`${symbol} CONVERT shown (executed today): ${verdict(b.convert)}`);
    else console.log(`${symbol} CONVERT not shown (carried forward, not executed today): ${verdict(!b.convert)}`);
    console.log(`Back on Positions: ${verdict(closed)}`);

    // P&L, rounded to two decimals. Derivative (F&O, currency, commodity) values can be per lot: the multiplier is read
    // from Buy (or Sell) Value / (Qty x Avg) when it comes out a whole number above 1.
    //   Executed today (no carried quantity): P&L = (Sell Value - Buy Value) + Net Qty x LTP
    //   Carried forward:                       P&L = (LTP - Avg) x Net Qty
    //   P&L % (open position) = ((LTP - Avg) / Avg) x 100 x sign(Net Qty); (closed) = P&L / Buy Value x 100
    //   Market Value = |Net Qty| x LTP;  Open Value = |Net Qty| x Avg
    const L = v('ltp'), A = v('avg');
    const ratio = (val, q, a) => (val && q && a ? val / (q * a) : null);
    const r = ratio(v('buyValue'), buyQ, v('buyAvg')) || ratio(v('sellValue'), sellQ, v('sellAvg'));
    const mult = r && Math.abs(r - Math.round(r)) < 0.01 && Math.round(r) > 1 ? Math.round(r) : 1;
    if (mult > 1) console.log(`${symbol} values are per lot: Value / (Qty x Avg) = ${mult}`);
    if (buyQ != null && v('buyAvg') != null && v('buyValue') != null)
        console.log(`${symbol} Buy Value ${fmt(v('buyValue'))} vs Buy Qty x Buy Avg = ${fmt(round2(buyQ * v('buyAvg') * mult))}: ${verdict(near(v('buyValue'), buyQ * v('buyAvg') * mult, 0.01 + buyQ * mult * 0.005))}`);
    if (sellQ != null && v('sellAvg') != null && v('sellValue') != null)
        console.log(`${symbol} Sell Value ${fmt(v('sellValue'))} vs Sell Qty x Sell Avg = ${fmt(round2(sellQ * v('sellAvg') * mult))}: ${verdict(near(v('sellValue'), sellQ * v('sellAvg') * mult, 0.01 + sellQ * mult * 0.005))}`);

    let computed = null;
    const sameDay = executedToday && buyQ != null && sellQ != null && v('buyValue') != null && v('sellValue') != null && (qty == null || Math.abs(qty) === Math.abs(buyQ - sellQ));
    if (L != null && net != null) {
        if (sameDay) {
            computed = round2((v('sellValue') - v('buyValue')) + net * L * mult);
            console.log(`${symbol} P&L ${fmt(v('pnl'))} vs (Sell Value - Buy Value) + Net Qty x LTP = (${fmt(v('sellValue'))} - ${fmt(v('buyValue'))}) + ${net} x ${fmt(L)}${mult > 1 ? ` x ${mult}` : ''} = ${fmt(computed)}: ${valueVerdict(v('pnl'), computed, 0.01 + Math.abs(net) * mult * 0.005)}`);
        } else if (A != null) {
            computed = round2((L - A) * net * mult);
            console.log(`${symbol} P&L ${fmt(v('pnl'))} vs (LTP - Avg) x Net Qty = (${fmt(L)} - ${fmt(A)}) x ${net}${mult > 1 ? ` x ${mult}` : ''} = ${fmt(computed)}: ${valueVerdict(v('pnl'), computed, 0.01 + Math.abs(net) * mult * 0.005)}`);
        }
        const pnlPct = f.pnl ? f.pnl.percent : null;
        if (net !== 0 && A) {
            const pct = round2(((L - A) / A) * 100 * Math.sign(net));
            console.log(`${symbol} P&L % ${fmt(pnlPct)} vs ((LTP - Avg) / Avg) x 100 = ${fmt(pct)}: ${valueVerdict(pnlPct, pct, 0.01 + (0.005 / A) * 100)}`);
        } else if (net === 0 && computed != null && v('buyValue')) {
            const pct = round2((computed / v('buyValue')) * 100);
            console.log(`${symbol} P&L % ${fmt(pnlPct)} vs P&L / Buy Value x 100 = ${fmt(pct)}: ${valueVerdict(pnlPct, pct, 0.02)}`);
        }
        if (v('marketValue') != null)
            console.log(`${symbol} Market Value ${fmt(v('marketValue'))} vs |Net Qty| x LTP = ${fmt(round2(Math.abs(net) * L * mult))}: ${verdict(near(Math.abs(v('marketValue')), Math.abs(net) * L * mult))}`);
    } else {
        console.error(`FAIL: ${symbol} P&L not recalculated - LTP ${fmt(L)} / Net Qty ${net ?? 'n/a'} not read`);
    }
    if (A != null && net != null && v('openValue') != null)
        console.log(`${symbol} Open Value ${fmt(v('openValue'))} vs |Net Qty| x Avg = ${fmt(round2(Math.abs(net) * A * mult))}: ${verdict(near(Math.abs(v('openValue')), Math.abs(net) * A * mult, 0.01 + Math.abs(net) * mult * 0.005))}`);
    // Change value vs change percent, all three as the app shows them at one moment:
    // % = Change / (LTP - Change) x 100 (Prev.close = LTP - Change).
    //   Sheet change value (if ever exposed): with the sheet's own LTP and %.
    //   Otherwise the Order Pad header's LTP / Change / % (read together, so prices can't tick between).
    const cLtp = f.change && f.change.value != null ? L : pad.ltp;
    const cPct = f.change && f.change.value != null ? changePct : pad.percent;
    if (changeVal != null && cLtp != null && cPct != null && cLtp - changeVal) {
        const pct = round2((changeVal / (cLtp - changeVal)) * 100);
        console.log(`${symbol} Change % ${fmt(cPct)} vs Change / (LTP - Change) x 100 = ${fmt(changeVal)} / (${fmt(cLtp)} - ${fmt(changeVal)}) x 100 = ${fmt(pct)}: ${verdict(near(cPct, pct, 0.02))}`);
        // A fall must carry its minus sign on the value as well as on the percent.
        if (cPct !== 0 && changeVal !== 0) console.log(`${symbol} Change value sign matches its percent (${fmt(changeVal)} / ${fmt(cPct)}%): ${verdict(Math.sign(cPct) === Math.sign(changeVal))}`);
    }
    // The Order Pad's change % vs the sheet's, when both were read at the same LTP.
    if (pad.percent != null && changePct != null && pad.ltp != null && L != null) {
        if (near(pad.ltp, L, 0)) console.log(`${symbol} Change % on the sheet ${fmt(changePct)} vs on the Order Pad ${fmt(pad.percent)} (same LTP ${fmt(L)}): ${verdict(near(changePct, pad.percent, 0.01))}`);
        else console.log(`${symbol} Change % on the sheet ${fmt(changePct)} (LTP ${fmt(L)}) vs on the Order Pad ${fmt(pad.percent)} (LTP ${fmt(pad.ltp)}) - LTP ticked between the two, not compared`);
    }
    return {
        symbol, pnl: v('pnl'), computedPnl: computed, marketValue: L != null && net != null ? Math.abs(net) * L * mult : 0,
        raw, isDeriv, side, executedToday, buttons: b,
        exchange: (raw.match(/Exchange:\s*([A-Z]+)/i) || [])[1] || null,
        product: PortfolioPage.normProduct((raw.match(/Product:\s*([^.]+)/i) || [])[1] || tags[0]),
    };
}

// ---- Position sheet buttons: View Chart, Add Alert, Option Chain, BUY MORE / SELL, SQUARE OFF,
// CONVERT. Each opens its screen, which is checked and left with back / Close. On an Order Pad
// nothing is ever tapped (its BUY / SELL never); on the Convert screen its Convert never.

// Order Pad product chip names for a normalised product.
const PAD_PRODUCT = { Intraday: 'Intraday', Delivery: 'Delivery', CarryForward: 'Carryforward' };
const PRODUCT_LABEL = { Intraday: 'Intraday', Delivery: 'Delivery', CarryForward: 'C.Fwd', MTF: 'MTF' };

// Calendar days to a contract's expiry from its name ("NIFTY 01DEC 28250 CE"); null for equity.
// Same rule as tests/Orders/Orderpad.test.js (no year in the name - a past date is next year's).
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

// The ticker part of a position's name ("NIFTY 01DEC 28250 CE" -> "NIFTY").
const baseSymbol = s => (String(s || '').toUpperCase().match(/^[A-Z&-]+/) || [''])[0];

// Back to Positions -> `subTab` with nothing on top: back while a sheet / chart / other screen is
// shown (only while the bottom navigation isn't the plain list), then Portfolio / Positions /
// the sub-tab are tapped as needed. True when the sub-tabs are on screen.
async function backToPositions(portfolio, subTab) {
    await portfolio.hideKeyboardIfShown();
    // Search mode hides the sub-tabs but keeps the bottom navigation - leave it with Exit Search.
    if (await portfolio.isPositionsSearchOpen()) await portfolio.tapPositionsSearchButton('exit');
    for (let i = 0; i < 5; i++) {
        const labels = await portfolio.getAllLabels();
        const sheet = labels.some(n => PortfolioPage.POSITION_SHEET_RE.test(n.label) || PortfolioPage.CONVERT_SCREEN_RE.test(n.label));
        const web = await portfolio.isElementVisible(PortfolioPage.WEBVIEW, 300);
        const nav = await portfolio.isElementVisible(portfolio.portfolioNavButton, 500);
        if (!sheet && !web && nav) break;
        await portfolio.driver.back();
        await portfolio.pause(1000);
    }
    if (!(await portfolio.isOnPortfolio(2000))) {
        await portfolio.clickPortfolioNav().catch(() => {});
        await portfolio.isOnPortfolio(8000);
    }
    if ((await portfolio.getSelectedTopTab()) !== 'Positions') await portfolio.tapTopTab('Positions').catch(() => {});
    const tabs = await portfolio.getPositionSubTabs();
    if (tabs && !tabs[subTab].selected) await portfolio.tapPositionSubTab(subTab);
    return !!(await portfolio.getPositionSubTabs());
}

// The change value as the app itself shows it. The Positions row and sheet draw it next to the
// percent but don't expose it (their accessibility text has only the LTP and percent - live
// 2026-11-25); the Order Pad header does, signed:
//   "MCX \nExchange is MCX and the last traded price is 3.00\nChange is -0.80\nChange percentage is -21.05 percent"
// (ui_dumps/portfolio_position_more_orderpad_mcx.xml). The pad is opened from the sheet's BUY MORE /
// SELL / SQUARE OFF and left with back - nothing on it is tapped. A stock listed on both NSE and BSE
// shows only the LTP on each exchange chip (ui_dumps/portfolio_position_more_orderpad_nse.xml), so
// for it there is no change value to fetch.
// Returns { exchange, ltp, value, percent } or { error, ltp? }.
const PAD_CHANGE_RE = /^(NSE|BSE|NFO|BFO|MCX|CDS)\s*\n\s*Exchange is \1 and the last traded price is ([-+]?[\d,]+(?:\.\d+)?)(?:\s*\n\s*Change is ([-+]?[\d,]+(?:\.\d+)?))?(?:\s*\n\s*Change percentage is ([-+]?[\d,]+(?:\.\d+)?) percent)?/i;
async function fetchChangeFromOrderPad(portfolio, raw, subTab, buttons, exchange) {
    const key = ['buyMore', 'sell', 'squareOff'].find(k => buttons[k]);
    if (!key) return { error: 'no BUY MORE / SELL / SQUARE OFF on the sheet to open the Order Pad from' };
    const baseline = await portfolio.openPositionDetails(raw);
    if (!baseline) {
        await backToPositions(portfolio, subTab);
        return { error: 'the sheet did not reopen' };
    }
    let chips = [];
    if (await portfolio.tapPositionButton(key, { opensOrderPad: true })) {
        for (let i = 0; i < 4 && !chips.length; i++) {
            chips = (await portfolio.getDescribedElements()).map(n => n.desc.trim().match(PAD_CHANGE_RE)).filter(Boolean);
            if (!chips.length) await portfolio.pause(700);
        }
    }
    await backToPositions(portfolio, subTab);
    const chip = chips.find(m => exchange && m[1].toUpperCase() === exchange.toUpperCase()) || (chips.length === 1 ? chips[0] : null);
    if (!chip) return { error: chips.length ? `no ${exchange} chip on the Order Pad (${chips.map(m => m[1]).join(', ')})` : 'the Order Pad header was not found' };
    if (chip[3] == null) return { error: `the app's Order Pad shows only the LTP for ${chip[1]} (${chips.length > 1 ? 'listed on both NSE and BSE' : 'no change'}) - the change value isn't exposed anywhere on Positions`, ltp: num(chip[2]) };
    return { exchange: chip[1].toUpperCase(), ltp: num(chip[2]), value: num(chip[3]), percent: chip[4] != null ? num(chip[4]) : null };
}

// Back to the list, then the position's sheet opened afresh. True when it's open.
async function reopenSheet(portfolio, p, subTab) {
    if (!(await backToPositions(portfolio, subTab))) {
        console.error(`FAIL: could not get back to Positions -> ${subTab}`);
        return false;
    }
    if (await portfolio.openPositionDetails(p.raw)) return true;
    await portfolio.dumpPageSource(`portfolio_position_${normSymbol(p.symbol)}_no_sheet`);
    console.error(`FAIL: could not reopen the details of ${p.symbol}`);
    return false;
}

// Order Pad opened from a position: the pad side, the symbol and the product types only -
// Delivery / Intraday on equity, Carryforward / Intraday on derivatives (Intraday not offered
// on a contract expiring today / tomorrow - as in tests/Orders/Orderpad.test.js).
//   'more'      (BUY MORE / SELL): the segment's product options.
//   'squareOff' : the position's own product (its order tag) is the product on the pad.
// Nothing on the pad is tapped; it is left with back.
async function checkPositionOrderPad(portfolio, pad, p, padSide, kind, dumped) {
    const ok = await pad.verifyOpenedFor(padSide);
    const dumpName = `portfolio_position_${kind}_orderpad_${(p.exchange || 'x').toLowerCase()}`;
    if (!dumped.has(dumpName)) { dumped.add(dumpName); await portfolio.dumpPageSource(dumpName); }
    if (ok) {
        const shown = await pad.getDisplayedSymbol();
        const same = !!shown && normSymbol(shown).includes(normSymbol(baseSymbol(p.symbol)));
        console.log(`Order Pad is for ${p.symbol} (header "${shown}"): ${verdict(same)}`);
        const equity = ['NSE', 'BSE'].includes(p.exchange);
        const days = daysToExpiry(p.symbol);
        if (kind === 'more') {
            if (p.exchange) await pad.verifyProductOptions(p.exchange, { nearExpiry: !equity && days !== null && days <= 1 });
            else console.error(`FAIL: exchange of ${p.symbol} not read from its row - product options not checked`);
        }
        const want = PAD_PRODUCT[p.product];
        const labels = await pad.getProductLabels();
        if (!want) {
            console.log(`${p.symbol} product "${p.product}" has no Order Pad chip to compare - products shown: ${labels.join(', ') || 'none'}`);
        } else {
            const has = labels.some(l => l.replace(/\s/g, '').toLowerCase() === want.toLowerCase());
            console.log(`Order Pad shows the position's order tag ${want} (products shown: ${labels.join(', ') || 'none'}): ${verdict(has)}`);
            if (has) await pad.verifyProductSelected(want);
        }
    }
    console.log('Navigating back (the pad\'s own BUY / SELL is never tapped)...');
    await pad.hideKeyboardIfShown();
    await portfolio.driver.back();
    await portfolio.pause(1500);
    console.log(`Order Pad closed: ${verdict(!(await pad.isDisplayed(1500)))}`);
}

// Convert targets per segment for an existing product: equity Intraday <-> Delivery (+ MTF, only
// for applicable NSE symbols - optional); derivatives Intraday <-> C.Fwd, but C.Fwd conversion is
// not applicable on BFO.
function convertTargets(exchange, existing) {
    const equity = ['NSE', 'BSE'].includes(exchange);
    const all = equity ? ['Intraday', 'Delivery'] : exchange === 'BFO' ? ['Intraday'] : ['Intraday', 'CarryForward'];
    return {
        required: all.filter(x => x !== existing),
        optional: exchange === 'NSE' && existing !== 'MTF' ? ['MTF'] : [],
    };
}

// Convert screen: name (expiry for derivatives), Existing product type = the executed order's
// product, Convert to = an alternative product, its dropdown's options, Qty and the Convert button
// shown; the Qty changed and set back. The screen's Convert button is NEVER tapped.
async function checkConvert(portfolio, p, no) {
    tc(no, `${p.symbol}: clicking CONVERT and verifying the Convert screen (its Convert button is never tapped)...`);
    const sheetLabels = await portfolio.getAllLabels();
    try {
        if (!(await portfolio.tapPositionButton('convert', { opensConvert: true }))) {
            console.error(`FAIL: CONVERT not found on the sheet of ${p.symbol}`);
            return;
        }
    } catch (e) {
        console.error(`FAIL: ${e.message}`);
        return;
    }
    const open = await portfolio.isConvertScreenOpen();
    await portfolio.dumpPageSource(`portfolio_position_convert_${(p.exchange || 'x').toLowerCase()}`);
    console.log(`Convert screen displayed: ${verdict(open)}`);
    if (!open) return;

    const c = await portfolio.readConvertScreen(sheetLabels);
    console.log(`Convert screen: ${c.labels.map(t => t.replace(/\n/g, ' ')).join(' | ')}`);
    const named = c.labels.some(t => normSymbol(t).includes(normSymbol(baseSymbol(p.symbol))));
    console.log(`${p.symbol} name on the Convert screen: ${verdict(named)}`);
    if (p.isDeriv) console.log(`${p.symbol} expiry on the Convert screen${c.expiry ? ` (${c.expiry})` : ''}: ${verdict(!!c.expiry)}`);

    const existing = PortfolioPage.normProduct(c.existing);
    console.log(`Existing product type "${c.existing}" is the executed order's product ${PRODUCT_LABEL[p.product] || p.product}: ${verdict(!!existing && existing === p.product)}`);
    const { required, optional } = convertTargets(p.exchange, existing || p.product);
    const allowed = [...required, ...optional];
    const convertTo = PortfolioPage.normProduct(c.convertTo);
    console.log(`Expected Convert to options for ${PRODUCT_LABEL[existing || p.product]} on ${p.exchange}: ${required.map(x => PRODUCT_LABEL[x]).join(' / ') || 'none'}${optional.length ? ` (+ ${optional.map(x => PRODUCT_LABEL[x]).join(', ')} if applicable)` : ''}${p.exchange === 'BFO' ? ' - C.Fwd not applicable on BFO' : ''}`);
    console.log(`Convert to "${c.convertTo}" is an alternative product type: ${verdict(!!convertTo && convertTo !== existing && allowed.includes(convertTo))}`);

    console.log('Clicking the Convert to dropdown...');
    const before = await portfolio.getAllLabels();
    const dd = await portfolio.openConvertToDropdown(sheetLabels);
    await portfolio.dumpPageSource(`portfolio_position_convert_dropdown_${(p.exchange || 'x').toLowerCase()}`);
    console.log(`Convert to dropdown opened: ${verdict(dd.opened)}`);
    if (dd.opened) {
        // The current selection may be listed again or only shown in the box - count it as listed.
        const listed = [...new Set([...dd.options, ...(convertTo ? [convertTo] : [])])];
        console.log(`Dropdown options: ${listed.map(x => PRODUCT_LABEL[x]).join(', ') || 'none'} (raw: ${dd.labels.map(t => t.replace(/\n/g, ' ')).join(' | ')})`);
        for (const x of required) console.log(`${PRODUCT_LABEL[x]} offered: ${verdict(listed.includes(x))}`);
        for (const x of optional) console.log(`${PRODUCT_LABEL[x]} ${listed.includes(x) ? 'offered' : 'not offered'} (only for applicable symbols)`);
        const wrong = listed.filter(x => !allowed.includes(x));
        console.log(`No option outside ${allowed.map(x => PRODUCT_LABEL[x]).join(' / ') || 'none'} (existing ${PRODUCT_LABEL[existing || p.product]}${p.exchange === 'BFO' ? ', C.Fwd on BFO' : ''} not offered): ${verdict(!wrong.length)}${wrong.length ? ` - offered: ${wrong.map(x => PRODUCT_LABEL[x]).join(', ')}` : ''}`);
        const still = await portfolio.closeConvertToDropdown(c.convertTo, before);
        console.log(`Dropdown closed with ${c.convertTo} kept, Convert screen still open: ${verdict(still)}`);
        if (!still) return;
    }

    console.log(`Qty shown ("${c.qty}"): ${verdict(c.qty != null && c.qty !== '')}`);
    console.log(`Convert button shown (never tapped): ${verdict(c.convertButton)}`);
    const orig = num(c.qty);
    // Field accessibility only (every segment, derivatives too): the displayed Qty - 1 is entered,
    // then the Qty displayed at first is entered back. Convert is never tapped, so the edited value
    // is never submitted.
    if (orig != null && !Number.isNaN(orig)) {
        const changed = orig - 1;
        const r1 = await portfolio.setConvertQty(changed, sheetLabels);
        console.log(`Qty modified to ${changed} - box reads "${r1}": ${verdict(num(r1) === changed)}`);
        const r2 = await portfolio.setConvertQty(orig, sheetLabels);
        console.log(`Qty set back to the original ${c.qty} - box reads "${r2}": ${verdict(num(r2) === orig)}`);
    }
    console.log('Navigating back (Convert is never tapped)...');
    console.log(`Convert screen closed: ${verdict(await portfolio.closeConvertScreen())}`);
}

// Every button on the position's sheet, each from a freshly opened sheet.
async function checkPositionButtons(portfolio, pad, p, subTab, no, dumped) {
    const b = p.buttons;
    const sym = p.symbol;

    tc(`${no}b`, `${sym}: clicking View Chart and verifying the chart...`);
    if (!b.viewChart) console.log('View Chart not on the sheet - already reported');
    else if (await reopenSheet(portfolio, p, subTab)) {
        await portfolio.tapPositionButton('viewChart');
        console.log('Waiting 10s for the chart to load...');
        const chart = await portfolio.readChartPage(10000);
        console.log(`Chart web page (WebView) shown: ${verdict(chart.webView)}`);
        // Equity: the company line belongs to the symbol. Derivatives: the chart may be named for
        // the underlying / contract - logged, not judged.
        if (p.isDeriv) console.log(`Chart company line: "${chart.company}" (derivative - not compared)`);
        else console.log(`Chart is for ${sym} (company "${chart.company}"): ${verdict(PortfolioPage.symbolMatchesCompany(baseSymbol(sym), chart.company))}`);
        if (!(await portfolio.tapChartClose())) {
            await portfolio.driver.back();
            await portfolio.pause(1500);
        }
        console.log(`Chart closed: ${verdict(!(await portfolio.isElementVisible(PortfolioPage.WEBVIEW, 1500)))}`);
    }

    tc(`${no}c`, `${sym}: clicking Add Alert and verifying the alert screen...`);
    if (!b.addAlert) console.log('Add Alert not on the sheet - already reported');
    else if (await reopenSheet(portfolio, p, subTab)) {
        await portfolio.tapPositionButton('addAlert');
        const alert = await portfolio.readSetAlertScreen();
        console.log(`Set Alert screen opened: ${verdict(alert.open)}`);
        if (alert.open) {
            const named = alert.descs.some(x => normSymbol(x).includes(normSymbol(baseSymbol(sym))));
            console.log(`Set Alert is for ${sym}: ${verdict(named)}`);
            console.log(`Create Alert button shown (never tapped): ${verdict(alert.createAlertShown)}`);
            await portfolio.leaveSetAlertScreen();
        } else {
            await portfolio.dumpPageSource(`portfolio_position_${normSymbol(sym)}_add_alert`);
        }
    }

    tc(`${no}d`, `${sym}: clicking Option Chain (if applicable) and verifying the option chain...`);
    if (!b.optionChain) console.log(`Option Chain not shown for ${sym} - not applicable`);
    else if (await reopenSheet(portfolio, p, subTab)) {
        await portfolio.tapPositionButton('optionChain');
        const open = await portfolio.isOptionChainOpen();
        if (!open) await portfolio.dumpPageSource(`portfolio_position_${normSymbol(sym)}_option_chain`);
        console.log(`Option Chain displayed ("Strike Price" column): ${verdict(open)}`);
        await portfolio.driver.back();
        await portfolio.pause(1500);
    }

    // Buy order -> BUY MORE -> Buy Order Pad; sell order -> SELL -> Sell Order Pad; a closed
    // position (Buy Qty = Sell Qty) shows only BUY MORE.
    const moreKey = p.side === 'sell' ? 'sell' : p.side === 'unknown' ? (b.buyMore ? 'buyMore' : b.sell ? 'sell' : null) : 'buyMore';
    const moreSide = moreKey === 'sell' ? 'Sell' : 'Buy';
    tc(`${no}e`, `${sym}: clicking ${moreKey === 'sell' ? 'SELL' : 'BUY MORE'} and verifying the ${moreSide} Order Pad...`);
    if (!moreKey || !b[moreKey]) console.log(`${moreKey === 'sell' ? 'SELL' : 'BUY MORE'} not on the sheet - already reported`);
    else if (await reopenSheet(portfolio, p, subTab)) {
        await portfolio.tapPositionButton(moreKey, { opensOrderPad: true });
        await checkPositionOrderPad(portfolio, pad, p, moreSide, 'more', dumped);
    }

    // SQUARE OFF opens the opposite side: buy order -> Sell Order Pad, sell order -> Buy Order Pad.
    const sqSide = p.side === 'sell' ? 'Buy' : 'Sell';
    tc(`${no}f`, `${sym}: clicking SQUARE OFF and verifying the ${sqSide} Order Pad with the same order tag...`);
    if (!b.squareOff) console.log(`SQUARE OFF not on the sheet${p.side === 'closed' ? ' (position closed)' : ' - already reported'}`);
    else if (p.side === 'closed') console.log('Position closed - SQUARE OFF not opened');
    else if (await reopenSheet(portfolio, p, subTab)) {
        await portfolio.tapPositionButton('squareOff', { opensOrderPad: true });
        await checkPositionOrderPad(portfolio, pad, p, sqSide, 'squareOff', dumped);
    }

    if (!b.convert) {
        tc(`${no}g`, `${sym}: CONVERT not shown${p.executedToday ? ' - already reported' : ' (carried forward)'} - nothing to open`);
    } else if (await reopenSheet(portfolio, p, subTab)) {
        await checkConvert(portfolio, p, `${no}g`);
    }
    await backToPositions(portfolio, subTab);
}

// Clicks every listed position of `name` (its rows are those read in TC 4 / 5) and checks its
// details, then the cumulative P&L below the sub-tabs (read right after, so prices have little
// time to move), then each position's buttons. A position whose buttons were already clicked on
// Today (`doneKeys`) isn't clicked through again on Derivatives.
async function checkSubTabPositions(portfolio, no, name, rows, isExecutedToday, doneKeys = new Set(), dumped = new Set()) {
    tc(no, `Positions -> ${name}: clicking every listed symbol and verifying its details and P&L...`);
    if (!rows.length) {
        console.log(`No ${name} positions listed - nothing to open`);
        return [];
    }
    await portfolio.tapPositionSubTab(name);
    const results = [];
    for (let i = 0; i < rows.length; i++) {
        results.push(await checkPosition(portfolio, name, rows[i], {
            executedToday: isExecutedToday(rows[i]),
            dumpName: i === 0 ? `portfolio_position_details_${name.toLowerCase()}` : null,
        }));
    }
    await checkCumulativePnl(portfolio, no, name, rows, results);
    if (PNL_ONLY) {
        console.log(`\nPNL_ONLY: ${name} buttons (TC ${no}b-g) not clicked through`);
        return results;
    }

    const pad = new OrderPadPage(portfolio.driver);
    for (const p of results.filter(Boolean)) {
        if (doneKeys.has(rowKey(p.raw))) {
            console.log(`\n${p.symbol}: buttons already clicked through on Today - not repeated on ${name}`);
            continue;
        }
        doneKeys.add(rowKey(p.raw));
        await checkPositionButtons(portfolio, pad, p, name, no, dumped);
    }
    return results;
}

// The cumulative P&L under the sub-tabs: { shown, value } (value null when not found).
// Opening lower rows can scroll the list - bring it back into view first.
async function readCumulativePnl(portfolio) {
    let shown = await portfolio.getPositionsPnl();
    for (let i = 0; shown == null && i < 4; i++) {
        await portfolio.swipe('up');
        await portfolio.pause(500);
        shown = await portfolio.getPositionsPnl();
    }
    const value = shown == null ? null
        : PortfolioPage.parseValuePercent(shown).value ?? num((String(shown).match(/[+-]?[\d,]+(?:\.\d+)?/) || [])[0]);
    return { shown, value };
}

// Every row's P&L, read back-to-back from its sheet (nothing else checked, so it's quick).
// Null when a sheet couldn't be opened or its P&L read.
async function readAllPnl(portfolio, rows) {
    const pnls = [];
    for (const raw of rows) {
        const baseline = await portfolio.openPositionDetails(raw);
        const d = baseline ? await portfolio.readPositionDetails(baseline) : null;
        await portfolio.closePositionDetails();
        if (!d || !d.fields.pnl || d.fields.pnl.value == null) return null;
        pnls.push(d.fields.pnl.value);
    }
    return pnls;
}

// Cumulative P&L vs the sum of the symbols' P&L. The symbols can only be read one sheet at a time
// and prices stream meanwhile, so a mismatch while prices tick is re-checked on a snapshot:
// cumulative -> every symbol's P&L -> cumulative again. Only a snapshot whose cumulative didn't
// change during the reads is compared (to the rounding tolerance); a mismatch there is a FAIL.
async function checkCumulativePnl(portfolio, no, name, rows, results) {
    tc(`${no}a`, `Verifying the cumulative P&L below the ${name} tab against the listed symbols...`);
    const first = await readCumulativePnl(portfolio);
    console.log(`Cumulative P&L shown: ${first.shown ?? 'not found'}`);
    if (first.value == null) {
        await portfolio.dumpPageSource(`portfolio_positions_${name.toLowerCase()}_pnl`);
        console.error(`FAIL: cumulative P&L not found below the ${name} tab`);
        return results;
    }
    const read = results.filter(Boolean);
    if (read.length !== rows.length || read.some(r => r.pnl == null)) {
        console.error(`FAIL: P&L read for ${read.filter(r => r.pnl != null).length} of ${rows.length} position(s) - cumulative P&L not compared`);
        return results;
    }
    const tol = 0.01 * read.length;
    const symbols = pnls => read.map((r, i) => `${r.symbol} ${fmt(pnls[i])}`).join(' + ');
    const sum = round2(read.reduce((t, r) => t + r.pnl, 0));
    const matched = near(first.value, sum, tol);
    console.log(`Cumulative P&L ${fmt(first.value)} vs sum of the symbols' P&L as read on their sheets (${symbols(read.map(r => r.pnl))}) = ${fmt(sum)}: ${matched ? valueVerdict(first.value, sum, tol) : pricesMayTick() ? `differs by ${fmt(round2(first.value - sum))} - prices streamed between the reads, re-checking on a snapshot` : valueVerdict(first.value, sum, tol)}`);
    if (read.every(r => r.computedPnl != null)) {
        const calc = round2(read.reduce((t, r) => t + r.computedPnl, 0));
        console.log(`Sum of the calculated P&L = ${fmt(calc)} (each symbol's own P&L check is reported on its sheet above)`);
    }
    if (matched || !pricesMayTick()) return results;

    // Prices tick: snapshot cumulative -> all symbols -> cumulative, up to 3 times.
    let last = null;
    for (let attempt = 1; attempt <= 3; attempt++) {
        const before = await readCumulativePnl(portfolio);
        const pnls = await readAllPnl(portfolio, rows);
        const after = await readCumulativePnl(portfolio);
        if (before.value == null || after.value == null || !pnls) {
            console.error(`FAIL: snapshot ${attempt} - ${!pnls ? 'a symbol\'s P&L could not be read' : 'cumulative P&L not found'}`);
            return results;
        }
        const snapSum = round2(pnls.reduce((t, p) => t + p, 0));
        last = { before, after, snapSum };
        if (before.value !== after.value) {
            console.log(`Snapshot ${attempt}: cumulative moved ${fmt(before.value)} -> ${fmt(after.value)} while the symbols were read - not comparable, retrying`);
            continue;
        }
        console.log(`Snapshot ${attempt} (cumulative steady at ${fmt(before.value)} during the reads): sum of the symbols' P&L (${symbols(pnls)}) = ${fmt(snapSum)}: ${valueVerdict(before.value, snapSum, tol)}`);
        return results;
    }
    console.log(`Cumulative P&L not verified - prices kept streaming during all 3 snapshots (last: cumulative ${fmt(last.before.value)} -> ${fmt(last.after.value)}, symbols' sum ${fmt(last.snapSum)}). Re-run when the market is quieter or closed.`);
    return results;
}

// Search / Quote / Order Pad -> a screen with the bottom navigation. Back presses only.
async function backToBottomNav(driver, portfolio) {
    for (let i = 0; i < 5; i++) {
        if (await portfolio.isElementVisible(portfolio.portfolioNavButton, 1000)) return true;
        await driver.back();
        await portfolio.pause(800);
    }
    return portfolio.isElementVisible(portfolio.portfolioNavButton, 1000);
}

// Positions -> `name` sub-tab: selected after the tap, then every position listed (or the empty
// message when its count is 0). Returns { count, rows }.
async function checkPositionSubTab(portfolio, no, name) {
    tc(no, `Positions -> ${name}: verifying the listed positions match the ${name} count...`);
    await portfolio.tapPositionSubTab(name);
    const tabs = await portfolio.getPositionSubTabs();
    if (!tabs) {
        console.error(`FAIL: Positions sub-tabs not on screen after tapping ${name}`);
        return { count: 0, rows: [] };
    }
    const sub = tabs[name];
    console.log(`${name} sub-tab selected: ${sub.selected ? 'PASS' : 'FAIL'}`);
    console.log(`${name} sub-tab count: ${sub.count}`);

    const rows = await portfolio.collectAllPositionRows();
    if (sub.count === 0) {
        const empty = await portfolio.isEmptyPositionsShown();
        console.log(`No ${name} positions - "${portfolio.emptyPositionsText}" shown: ${empty ? 'PASS' : 'FAIL'}`);
        if (rows.length) console.error(`FAIL: ${name} count is 0 but ${rows.length} row(s) are listed: ${rows.join(' || ')}`);
        return { count: sub.count, rows };
    }

    console.log(`${name} positions listed (${rows.length}):`);
    rows.forEach((r, i) => console.log(`  [${i}] ${PortfolioPage.positionSymbol(r)} - ${showRow(r)}`));
    if (!rows.length) {
        await portfolio.dumpPageSource(`portfolio_positions_${name.toLowerCase()}`);
        console.error(`FAIL: ${name} shows ${sub.count} item(s) but no position rows were found`);
    } else {
        console.log(`Rows listed ${rows.length} vs ${name} count ${sub.count}: ${rows.length === sub.count ? 'PASS' : 'FAIL'}`);
    }
    return { count: sub.count, rows };
}

// The bar under the sub-tabs (Search / Filter / Alerts / Exit Positions) on `name`, whose rows were
// read in TC `no`:
//   a - Exit Positions shown when any position is listed, NOT shown when none is (never tapped);
//   b - Search: a symbol from the list typed in, only matching rows listed and it among them,
//       Clear empties the box, Cancel leaves search with the full list back;
//   c - Filter opens the position filters (left with back);
//   d - Alerts opens the Alerts screen (left with back).
const visibleRows = async portfolio => (await portfolio.getDescribedElements()).map(n => n.desc).filter(d => /^Position for stock:/i.test(d));
async function bringControlsIntoView(portfolio) {
    for (let i = 0; i < 4; i++) {
        const c = await portfolio.getPositionsControls();
        if (c.search || c.filter || c.alerts || c.exit) return c;
        await portfolio.swipe('up');
        await portfolio.pause(500);
    }
    return portfolio.getPositionsControls();
}

async function checkPositionsControls(portfolio, no, name, rows) {
    tc(`${no}a`, `Positions -> ${name}: verifying Exit Positions is ${rows.length ? '' : 'NOT '}displayed (${rows.length} position(s) listed)...`);
    let c = await bringControlsIntoView(portfolio);
    if (rows.length) console.log(`Exit Positions displayed on ${name} (positions listed): ${verdict(c.exit)}`);
    else console.log(`Exit Positions NOT displayed on ${name} (no positions listed): ${verdict(!c.exit)}`);
    if (!c.exit === !!rows.length) await portfolio.dumpPageSource(`portfolio_positions_${name.toLowerCase()}_exit_positions`);

    tc(`${no}b`, `Positions -> ${name}: searching a listed symbol with the search icon, then Clear and Cancel...`);
    if (!rows.length) {
        console.log(`No ${name} positions listed - nothing to search for (search icon ${c.search ? 'shown' : 'not shown'})`);
    } else if (!c.search) {
        await portfolio.dumpPageSource(`portfolio_positions_${name.toLowerCase()}_no_search`);
        console.error(`FAIL: search icon not displayed on ${name}`);
    } else {
        // Search by the first row's base symbol ("NATGASMINI" of "NATGASMINI 23DEC 500 CE").
        const target = rows[0];
        const query = PortfolioPage.positionSymbol(target).split(/\s+/)[0];
        const wanted = rows.filter(r => PortfolioPage.positionSymbol(r).toUpperCase().includes(query.toUpperCase()));
        await portfolio.tapPositionsControl('search');
        const bar = !!(await portfolio.findPositionsSearchBox()) && (await portfolio.isPositionsSearchOpen());
        console.log(`Search box opened after clicking the search icon: ${verdict(bar)}`);
        if (!bar) {
            await portfolio.dumpPageSource(`portfolio_positions_${name.toLowerCase()}_search_not_opened`);
        } else {
            const text = await portfolio.typePositionsSearch(query);
            console.log(`Entered "${query}" in the search box - it reads "${text ?? ''}": ${verdict(!!text && text.toUpperCase() === query.toUpperCase())}`);
            await portfolio.hideKeyboardIfShown();
            await portfolio.dumpPageSource(`portfolio_positions_${name.toLowerCase()}_search`);
            const listed = await visibleRows(portfolio);
            const others = listed.filter(r => !PortfolioPage.positionSymbol(r).toUpperCase().includes(query.toUpperCase()));
            console.log(`Searched symbol listed (${listed.map(r => PortfolioPage.positionSymbol(r)).join(', ') || 'none'}): ${verdict(listed.some(r => rowKey(r) === rowKey(target)))}`);
            console.log(`Only "${query}" positions listed (${wanted.length} expected, ${listed.length} shown): ${verdict(!others.length && listed.length === wanted.length)}`);
            if (others.length) console.error(`FAIL: non-matching positions listed for "${query}": ${others.map(r => PortfolioPage.positionSymbol(r)).join(', ')}`);

            // Clear (x) in the search bar: empties the box, the full list is back, still searching.
            if (await portfolio.tapPositionsSearchButton('clear')) {
                console.log('Clear button shown in the search bar: PASS');
                const after = await portfolio.getPositionsSearchText();
                console.log(`Search box empty after clicking Clear (reads "${after ?? ''}"): ${verdict(after === '')}`);
                const all = await visibleRows(portfolio);
                console.log(`Full ${name} list back after Clear (${all.length} row(s) on screen): ${verdict(all.length >= Math.min(rows.length, 3))}`);
            } else {
                await portfolio.dumpPageSource(`portfolio_positions_${name.toLowerCase()}_search_no_clear`);
                console.error('FAIL: Clear button not shown in the search bar while it has text');
            }

            // Cancel = "Exit Search": leaves search mode, the sub-tabs and controls are back.
            await portfolio.hideKeyboardIfShown();
            if (await portfolio.tapPositionsSearchButton('exit')) {
                console.log('Cancel (Exit Search) button shown beside the search bar: PASS');
                const gone = !(await portfolio.isPositionsSearchOpen());
                console.log(`Search closed after clicking Cancel: ${verdict(gone)}`);
                const tabs = await portfolio.getPositionSubTabs();
                console.log(`Sub-tabs and ${name} list back after Cancel: ${verdict(!!tabs && tabs[name].selected && (await visibleRows(portfolio)).length > 0)}`);
            } else {
                console.error('FAIL: Cancel (Exit Search) button not shown beside the search bar');
            }
        }
        await backToPositions(portfolio, name);
    }

    tc(`${no}c`, `Positions -> ${name}: clicking the filter icon and verifying the filter opens...`);
    c = await bringControlsIntoView(portfolio);
    if (!c.filter) {
        await portfolio.dumpPageSource(`portfolio_positions_${name.toLowerCase()}_no_filter`);
        console.error(`FAIL: filter icon not displayed on ${name}`);
    } else {
        await portfolio.tapPositionsControl('filter');
        const open = await portfolio.isPositionsFilterOpen();
        await portfolio.dumpPageSource(`portfolio_positions_${name.toLowerCase()}_filter`);
        console.log(`Filter opened: ${verdict(open)}`);
        await portfolio.driver.back();
        await portfolio.pause(1000);
        console.log(`Back on Positions -> ${name}: ${verdict(await backToPositions(portfolio, name))}`);
    }

    tc(`${no}d`, `Positions -> ${name}: clicking the alert icon and verifying the Alerts screen...`);
    c = await bringControlsIntoView(portfolio);
    if (!c.alerts) {
        await portfolio.dumpPageSource(`portfolio_positions_${name.toLowerCase()}_no_alerts`);
        console.error(`FAIL: alert icon not displayed on ${name}`);
    } else {
        await portfolio.tapPositionsControl('alerts');
        const open = await portfolio.isAlertsScreenOpen();
        if (!open) await portfolio.dumpPageSource(`portfolio_positions_${name.toLowerCase()}_alerts`);
        console.log(`Alerts screen displayed: ${verdict(open)}`);
        console.log(`Back on Positions -> ${name}: ${verdict(await backToPositions(portfolio, name))}`);
    }
}

// Exit Positions screen on `name` (its rows read in TC `no`). Open positions only = Quantity not 0.
//   Exit Positions -> the open positions listed (and no closed one) -> first symbol's checkbox
//   ticked then unticked -> Select All -> Clear All -> Select All -> Confirm Exit Positions -> the
//   Yes / No popup -> No -> Cancel -> back on Positions with every position as before.
// Confirm squares off the selected positions at MARKET PRICE if the app ever skips its popup, so it
// is tapped only with EXIT_POSITIONS_POPUP_TEST=1; without it the flow stops after the second
// Select All, clears the selection and cancels. The popup is only ever answered No.
const isOpenPosition = r => !/Quantity:\s*0(?:\.0+)?\b/i.test(r);
const exitKey = d => rowKey(d.replace(/^(Selected|Unselected)\.\s*/i, ''));
const positionSnapshot = rows => rows.map(r => `${rowKey(r)} | Qty ${(r.match(/Quantity:\s*([-\d,]+)/i) || [])[1] ?? '?'}`).sort();

async function checkExitPositionsFlow(portfolio, no, name, rows) {
    tc(`${no}e`, `Positions -> ${name}: clicking Exit Positions and verifying the open positions are listed...`);
    const open = rows.filter(isOpenPosition);
    if (!open.length) {
        console.log(`No open ${name} positions - Exit Positions flow not applicable`);
        return;
    }
    const before = positionSnapshot(rows);
    await bringControlsIntoView(portfolio);
    if (!(await portfolio.enterExitPositionsMode())) {
        await portfolio.dumpPageSource(`portfolio_exit_positions_${name.toLowerCase()}_not_opened`);
        console.error(`FAIL: Exit Positions screen did not open on ${name}`);
        await backToPositions(portfolio, name);
        return;
    }
    console.log('Exit Positions screen opened: PASS');
    const listed = await portfolio.collectExitModeRows();
    const listedKeys = new Set(listed.map(r => exitKey(r.desc)));
    const openKeys = new Set(open.map(rowKey));
    console.log(`Positions listed on the Exit Positions screen (${listed.length}): ${listed.map(r => PortfolioPage.positionSymbol(r.desc)).join(', ')}`);
    const missing = open.filter(r => !listedKeys.has(rowKey(r)));
    const extra = listed.filter(r => !openKeys.has(exitKey(r.desc)));
    console.log(`Every open position listed (${open.length}): ${verdict(!missing.length)}${missing.length ? ` - missing ${missing.map(r => PortfolioPage.positionSymbol(r)).join(', ')}` : ''}`);
    console.log(`Only open positions listed (no closed / Qty 0 one): ${verdict(!extra.length)}${extra.length ? ` - also ${extra.map(r => PortfolioPage.positionSymbol(r.desc)).join(', ')}` : ''}`);
    let s = await portfolio.getExitModeState();
    console.log(`Counter "${s.counter ? `${s.counter.selected}/${s.counter.total}` : 'n/a'} Positions will be closed" - none selected, total = open positions (${open.length}): ${verdict(!!s.counter && s.counter.selected === 0 && s.counter.total === open.length)}`);

    const counterIs = async (want, label) => {
        s = await portfolio.getExitModeState();
        const ok = !!s.counter && s.counter.selected === want;
        console.log(`${label} - counter ${s.counter ? `${s.counter.selected}/${s.counter.total}` : 'n/a'} (expected ${want}/${s.counter ? s.counter.total : '?'}): ${verdict(ok)}`);
        return ok;
    };

    // First symbol's checkbox: tick, then untick.
    tc(`${no}f`, `Exit Positions: ticking and unticking the first symbol, Select All, Clear All, Select All...`);
    const first = s.rows[0];
    if (!first) {
        await portfolio.dumpPageSource(`portfolio_exit_positions_${name.toLowerCase()}_no_rows`);
        console.error('FAIL: no position row on the Exit Positions screen');
    } else {
        const sym = PortfolioPage.positionSymbol(first.desc);
        console.log(`First symbol ${sym} unselected to start: ${verdict(!first.selected)}`);
        await portfolio.tapExitModeRow(first);
        let r = (await portfolio.getExitModeState()).rows.find(x => exitKey(x.desc) === exitKey(first.desc));
        console.log(`${sym} checkbox ticked after clicking it: ${verdict(!!r && r.selected)}`);
        await counterIs(1, `${sym} selected`);
        await portfolio.tapExitModeRow(r || first);
        r = (await portfolio.getExitModeState()).rows.find(x => exitKey(x.desc) === exitKey(first.desc));
        console.log(`${sym} checkbox unticked after clicking it again: ${verdict(!!r && !r.selected)}`);
        await counterIs(0, `${sym} unselected`);
    }

    const selectAll = async label => {
        if (!(await portfolio.tapExitModeButton('selectAll'))) {
            await portfolio.dumpPageSource(`portfolio_exit_positions_${name.toLowerCase()}_no_select_all`);
            console.error(`FAIL: Select All not shown (${label})`);
            return false;
        }
        const all = await counterIs(open.length, `${label}: Select All clicked`);
        s = await portfolio.getExitModeState();
        console.log(`${label}: every visible row ticked: ${verdict(s.rows.length > 0 && s.rows.every(x => x.selected))}`);
        console.log(`${label}: Select All changed to Clear All: ${verdict(!!s.clearAll)}`);
        if (!s.clearAll) await portfolio.dumpPageSource(`portfolio_exit_positions_${name.toLowerCase()}_select_all`);
        return all;
    };
    await selectAll('First');
    if (await portfolio.tapExitModeButton('clearAll')) {
        await counterIs(0, 'Clear All clicked');
        s = await portfolio.getExitModeState();
        console.log(`Clear All: every visible row unticked: ${verdict(s.rows.every(x => !x.selected))}`);
        console.log(`Clear All changed back to Select All: ${verdict(!!s.selectAll)}`);
    } else {
        console.error('FAIL: Clear All not shown after Select All');
    }
    const allSelected = await selectAll('Again');

    // Confirm -> popup -> No.
    tc(`${no}g`, 'Exit Positions: clicking Exit (Confirm), verifying the Yes / No popup and clicking No...');
    if (process.env.EXIT_POSITIONS_POPUP_TEST !== '1') {
        console.log('Confirm Exit Positions NOT clicked - set EXIT_POSITIONS_POPUP_TEST=1 to run this step (it squares off every selected position at market price if the app ever skips its popup)');
        await portfolio.tapExitModeButton('clearAll');
    } else if (!allSelected) {
        console.error('FAIL: not every open position selected - Confirm Exit Positions not clicked');
    } else {
        await portfolio.tapConfirmExitPositions();
        const popup = await portfolio.readExitConfirmPopup();
        await portfolio.dumpPageSource(`portfolio_exit_positions_${name.toLowerCase()}_confirm_popup`);
        console.log(`Confirmation popup displayed${popup && popup.message ? ` ("${popup.message.replace(/\n/g, ' ')}")` : ''}: ${verdict(!!popup)}`);
        if (!popup) {
            console.error('FAIL: no Yes / No popup after Confirm Exit Positions - CHECK THE ACCOUNT: the selected positions may have been squared off');
        } else {
            console.log(`Yes button displayed: ${verdict(!!popup.yes)}`);
            console.log(`No button displayed: ${verdict(!!popup.no)}`);
            await portfolio.tapExitConfirmNo(popup);
            const gone = !(await portfolio.readExitConfirmPopup(1500));
            console.log(`Popup closed after clicking No: ${verdict(gone)}`);
            console.log(`Still on the Exit Positions screen: ${verdict(await portfolio.isExitPositionsModeOpen(3000))}`);
        }
    }

    // Cancel -> back on Positions, nothing exited.
    tc(`${no}h`, 'Exit Positions: clicking Cancel and verifying no open position was exited...');
    if (await portfolio.tapExitModeButton('cancel')) {
        console.log(`Exit Positions screen closed after Cancel: ${verdict(!(await portfolio.isExitPositionsModeOpen()))}`);
    } else {
        console.error('FAIL: Cancel not shown on the Exit Positions screen');
    }
    await backToPositions(portfolio, name);
    const tabs = await portfolio.getPositionSubTabs();
    const nowRows = await portfolio.collectAllPositionRows();
    const after = positionSnapshot(nowRows);
    const changed = before.filter(x => !after.includes(x)).concat(after.filter(x => !before.includes(x)));
    console.log(`${name} count after Cancel ${tabs ? tabs[name].count : 'n/a'} vs before ${rows.length}: ${verdict(!!tabs && tabs[name].count === rows.length)}`);
    console.log(`No position exited - every ${name} position listed with the same quantity: ${verdict(!changed.length)}`);
    if (changed.length) console.error(`FAIL: positions changed after the Exit Positions flow:\n  ${changed.join('\n  ')}`);
}

// Positions count vs the sub-tabs, same rule as Holdings.test.js / Regression R58: Today = every buy
// and sell executed today (all segments), Derivatives = NFO / BFO / CDS / MCX only (today's and carried forward), so
// today's derivative position is on BOTH tabs and Positions = Derivatives + Today's non-derivative rows - not
// Today + Derivatives. When not every row could be read, only the bounds are checked.
function checkPositionsCount(positionsCount, today, deriv) {
    console.log(`Positions count check: Positions ${positionsCount}, Today ${today.count}, Derivatives ${deriv.count}`);
    const within = today.count <= positionsCount && deriv.count <= positionsCount;
    console.log(`Today (${today.count}) and Derivatives (${deriv.count}) each at most Positions (${positionsCount}): ${within ? 'PASS' : 'FAIL'}`);

    if (today.rows.length === today.count && deriv.rows.length === deriv.count) {
        const derivKeys = new Set(deriv.rows.map(rowKey));
        const todayOnly = today.rows.filter(r => !derivKeys.has(rowKey(r)));
        console.log(`Today rows also on Derivatives (today's derivative): ${today.rows.length - todayOnly.length} | Today-only (non-derivative): ${todayOnly.length}`);
        const expected = deriv.count + todayOnly.length;
        console.log(`Positions ${positionsCount} vs Derivatives ${deriv.count} + Today-only ${todayOnly.length} = ${expected}: ${expected === positionsCount ? 'PASS' : 'FAIL'}`);
    } else {
        console.log(`Not every row was read (Today ${today.rows.length}/${today.count}, Derivatives ${deriv.rows.length}/${deriv.count}) - checking count bounds only`);
        const bound = positionsCount <= today.count + deriv.count;
        console.log(`Positions (${positionsCount}) at most Today + Derivatives (${today.count + deriv.count}): ${bound ? 'PASS' : 'FAIL'}`);
    }
}

async function run() {
    const driver = await DriverManager.getDriver();
    try {
        const splashPage = new SplashPage(driver);
        const portfolio = new PortfolioPage(driver);

        tc(1, 'Launching the app...');
        await splashPage.launch();
        await splashPage.pause(3000);
        await permissionHandler.dismissAllPermissions(driver);

        tc(2, 'Verifying the app is on Portfolio (clicking Portfolio in the bottom navigation if not)...');
        let onPortfolio = await portfolio.isOnPortfolio(3000);
        if (onPortfolio) {
            console.log('App is already on Portfolio');
        } else {
            console.log('App is not on Portfolio - clicking Portfolio in the bottom navigation');
            await backToBottomNav(driver, portfolio);
            await portfolio.clickPortfolioNav();
            onPortfolio = await portfolio.isOnPortfolio(10000);
        }
        console.log(`Portfolio displayed: ${onPortfolio ? 'PASS' : 'FAIL'}`);
        if (!onPortfolio) throw new Error('Portfolio did not open');

        tc(3, 'Clicking the Positions tab and reading its count...');
        await portfolio.tapTopTab('Positions');
        const posSelected = (await portfolio.getSelectedTopTab()) === 'Positions';
        console.log(`Positions tab selected: ${posSelected ? 'PASS' : 'FAIL'}`);
        // Read after the tap, from the tab's own label ("Positions\nN\nTab 2 of 2").
        const topTabs = await portfolio.getTopTabs();
        if (!topTabs) throw new Error('Holdings / Positions tabs not found');
        const positionsCount = topTabs.Positions.count;
        console.log(`Positions count: ${positionsCount}`);

        // A search left open (e.g. by an earlier run) hides the sub-tabs - close it first.
        if (await portfolio.isPositionsSearchOpen()) {
            console.log('Positions search was left open - closing it with Exit Search');
            await portfolio.hideKeyboardIfShown();
            await portfolio.tapPositionsSearchButton('exit');
        }
        const subTabs = await portfolio.getPositionSubTabs();
        console.log(`Today / Derivatives sub-tabs shown: ${subTabs ? 'PASS' : 'FAIL'}`);
        if (!subTabs) throw new Error('Positions sub-tabs (Today / Derivatives) not found');
        console.log(`Today selected by default: ${subTabs.Today.selected ? 'PASS' : 'FAIL'}`);
        if (positionsCount === 0) {
            const empty = await portfolio.isEmptyPositionsShown();
            console.log(`No positions - "${portfolio.emptyPositionsText}" shown: ${empty ? 'PASS' : 'FAIL'}`);
        }

        const today = await checkPositionSubTab(portfolio, 4, 'Today');
        if (!PNL_ONLY) {
            await checkPositionsControls(portfolio, 4, 'Today', today.rows);
            await checkExitPositionsFlow(portfolio, 4, 'Today', today.rows);
        }
        const deriv = await checkPositionSubTab(portfolio, 5, 'Derivatives');
        if (!PNL_ONLY) await checkPositionsControls(portfolio, 5, 'Derivatives', deriv.rows);
        await checkDerivativesSegments(portfolio, deriv.rows);
        checkTodayDerivOnDerivatives(today, deriv);
        checkPositionsCount(positionsCount, today, deriv);

        // Today: every row was executed today. Derivatives: a row also on Today was executed today,
        // the rest are carried forward.
        if (CONTROLS_ONLY) {
            console.log('\nCONTROLS_ONLY: TC 6 / 7 (each symbol) and TC 8 skipped');
        } else {
            const doneKeys = new Set(), dumped = new Set();
            await checkSubTabPositions(portfolio, 6, 'Today', today.rows, () => true, doneKeys, dumped);
            const todayKeys = new Set(today.rows.map(rowKey));
            await checkSubTabPositions(portfolio, 7, 'Derivatives', deriv.rows, r => todayKeys.has(rowKey(r)), doneKeys, dumped);
        }

        if (CONTROLS_ONLY) {
            // already reported
        } else if (PNL_ONLY) {
            console.log('\nPNL_ONLY: TC 8 (Today equity not in Holdings) skipped');
        } else {
            tc(8, "Verifying no equity symbol from Positions -> Today is listed in Holdings (it moves there the next day)...");
            await checkTodayNotInHoldings(portfolio, today.rows);
        }

        console.log('\nPortfolio Positions flow completed');
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
