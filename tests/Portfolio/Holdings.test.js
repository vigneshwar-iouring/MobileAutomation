const DriverManager = require('../../driver/DriverManager');
const SplashPage = require('../../pages/SplashPage');
const PortfolioPage = require('../../pages/PortfolioPage');
const OrderPadPage = require('../../pages/OrderPadPage');
const permissionHandler = require('../../utils/permissionHandler');
const { createLogger, getFailedTCs } = require('../../utils/logger');

const { logFile, entries } = createLogger('Portfolio_Holdings');
console.log(`Logging this run to: ${logFile}`);

// Read-only: nothing on Portfolio is tapped except the Holdings / Positions tabs and the Today /
// Derivatives sub-tabs - no row, SQUARE OFF, BUY MORE or Exit Positions.
//
// TC 1 launch | TC 2 on Portfolio (Portfolio in the bottom navigation if not), Holdings selected
// by default | TC 3 Positions tab, its count, Today the default sub-tab | TC 4 Today sub-tab:
// executed orders listed (or the empty message), rows vs the tab's own count | TC 5 the same on
// Derivatives, then Positions count vs the sub-tabs (Regression R58's rule) | TC 6 back to Holdings;
// with no holdings, logs "No symbols in the holdings" + the app's own message and stops there |
// TC 7 cumulative P&L: Current, Invested, Overall P&L and Today's P&L (value + percent) | TC 8
// search bar, Filter, Pledge, Alerts | TC 9 each holding: name, Current Value, Qty, P&L + percent,
// Avg, LTP + change percent (row + detail sheet) | TC 10 header totals vs the holdings | TC 11
// Holdings lists only equity symbols | TC 12 search for a listed symbol, then Cancel | TC 13 no symbol from
// Positions -> Today is in Holdings (Holdings = equity held overnight; today's executions stay in
// Positions until the next day).
// TC 14-18 the first holding's detail sheet: fields + buttons | Price Breakdown (Date / Qty /
// Price) | Close | View Chart (10s, web page for the symbol) + Close | Add Alerts (Set Alert for
// the symbol) + back | TC 19-20 SQUARE OFF -> SELL pad, BUY MORE -> BUY pad (opened only, never
// submitted) | TC 21-22 tap the holding, swipe up -> half Quote, swipe up -> full Quote - see
// checkFirstHoldingScreens / checkOrderPadsAndQuote | TC 23 Option Chain (on the first holding that shows it) |
// TC 24-25 MTF holding: NRML Square Off -> normal SELL pad, MTF Square Off -> SELL pad with MTF -
// see checkOptionChainAndMtf.
// No order is ever placed: SQUARE OFF / BUY MORE only open the pad, whose SELL / BUY is never tapped.

const tc = (no, text) => console.log(`\nTC ${no}: ${text}`);

// SEARCH_ONLY=1 runs just TC 1-2 and the Holdings search + Cancel (TC 12) - no Positions, no
// holding details, no P&L checks.
const SEARCH_ONLY = process.env.SEARCH_ONLY === '1';
// DETAILS_ONLY=1 runs just TC 1-2 and the first holding's detail screens, order pads, Quote, Option Chain and MTF (TC 14-25).
const DETAILS_ONLY = process.env.DETAILS_ONLY === '1';

// Symbols are compared case-insensitively, ignoring spaces and an exchange / series suffix
// ("RTNPOWER-EQ", "IDEA BSE").
const normSymbol = s => String(s || '').toUpperCase().replace(/[-\s](EQ|BE|NSE|BSE)$/, '').replace(/\s+/g, '');

// A holding that looks like a derivative / currency / commodity contract rather than a cash
// equity share: an option or future marker, an expiry ("25NOV", "27 NOV 2025"), or a non-equity
// exchange named on the row.
const DERIVATIVE_MARKERS = [
    /\b(CE|PE|FUT|FUTIDX|FUTSTK|FUTCOM|FUTCUR|OPTIDX|OPTSTK)\b/i,
    /\b\d{1,2}\s?(JAN|FEB|MAR|APR|MAY|JUN|JUL|AUG|SEP|OCT|NOV|DEC)(\s?\d{2,4})?\b/i,
    /\b(NFO|BFO|MCX|CDS|NCDEX)\b/,
];
const nonEquityReason = raw => {
    const hit = DERIVATIVE_MARKERS.map(re => raw.match(re)).find(Boolean);
    return hit ? `"${hit[0]}"` : null;
};

// Search / Quote / Order Pad -> a screen with the bottom navigation. Back presses only.
async function backToBottomNav(driver, portfolio) {
    for (let i = 0; i < 5; i++) {
        if (await portfolio.isElementVisible(portfolio.portfolioNavButton, 1000)) return true;
        await driver.back();
        await portfolio.pause(800);
    }
    return portfolio.isElementVisible(portfolio.portfolioNavButton, 1000);
}

// Positions -> `name` sub-tab: selected after the tap, then every executed position listed (or
// the empty message when its count is 0). Returns { count, rows }.
async function checkPositionSubTab(portfolio, no, name) {
    tc(no, `Positions -> ${name}: verifying executed orders are listed...`);
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

    // The row format hasn't been captured yet - keep a dump of the first populated sub-tab.
    await portfolio.dumpPageSource(`portfolio_positions_${name.toLowerCase()}`);
    console.log(`${name} positions listed (${rows.length}):`);
    rows.forEach((r, i) => console.log(`  [${i}] ${PortfolioPage.positionSymbol(r)} - ${r.replace(/\n/g, ' | ')}`));
    if (!rows.length) console.error(`FAIL: ${name} shows ${sub.count} item(s) but no position rows were found`);
    else console.log(`Rows listed ${rows.length} vs ${name} count ${sub.count}: ${rows.length === sub.count ? 'PASS' : 'FAIL'}`);
    return { count: sub.count, rows };
}

// Positions count vs the sub-tabs, same rule as Regression R58: Today = orders executed today (any
// segment), Derivatives = every F&O position (today's and carried forward), so today's F&O
// position is on BOTH tabs and Positions = Derivatives + Today's non-F&O rows - not Today +
// Derivatives. Rows are matched across tabs on everything before "Quantity:" (symbol, contract,
// exchange, product). When not every row could be read, only the bounds are checked.
function checkPositionsCount(positionsCount, today, deriv) {
    console.log(`Positions count check: Positions ${positionsCount}, Today ${today.count}, Derivatives ${deriv.count}`);
    const within = today.count <= positionsCount && deriv.count <= positionsCount;
    console.log(`Today (${today.count}) and Derivatives (${deriv.count}) each at most Positions (${positionsCount}): ${within ? 'PASS' : 'FAIL'}`);

    const rowKey = r => r.split(/\s*Quantity:/)[0].trim();
    if (today.rows.length === today.count && deriv.rows.length === deriv.count) {
        const derivKeys = new Set(deriv.rows.map(rowKey));
        const todayOnly = today.rows.filter(r => !derivKeys.has(rowKey(r)));
        console.log(`Today rows also on Derivatives (today's F&O): ${today.rows.length - todayOnly.length} | Today-only (non-F&O): ${todayOnly.length}`);
        const expected = deriv.count + todayOnly.length;
        console.log(`Positions ${positionsCount} vs Derivatives ${deriv.count} + Today-only ${todayOnly.length} = ${expected}: ${expected === positionsCount ? 'PASS' : 'FAIL'}`);
    } else {
        console.log(`Not every row was read (Today ${today.rows.length}/${today.count}, Derivatives ${deriv.rows.length}/${deriv.count}) - checking count bounds only`);
        const bound = positionsCount <= today.count + deriv.count;
        console.log(`Positions (${positionsCount}) at most Today + Derivatives (${today.count + deriv.count}): ${bound ? 'PASS' : 'FAIL'}`);
    }
}

const num = s => (s == null || s === '' ? null : Number(String(s).replace(/,/g, '')));
const fmt = n => (n == null || Number.isNaN(n) ? 'n/a' : Number(n).toFixed(2));
const verdict = ok => (ok ? 'PASS' : 'FAIL');
// Every calculation is rounded off to two decimals before it is compared with the app.
const round2 = n => Math.round((n + Math.sign(n) * 1e-9) * 100) / 100;
// Equal after rounding, within `tol` (default: one paisa, for the app's own rounding).
const near = (a, b, tol = 0.01) => a != null && b != null && !Number.isNaN(a) && !Number.isNaN(b) && Math.abs(round2(a) - round2(b)) <= tol + 1e-9;
// Verdict for a P&L VALUE the app shows vs the formula. A negative value must be shown with its
// minus sign, like its percentage. Live 2026-11-23 the app left it off on some losses (IDEA P&L
// "0.91" beside "-3.66 percent"; Day's P&L "0.32" beside a -1.31% change, while VISL showed
// "-2.37") - that is a FAIL, named as a missing minus sign so it reads apart from a wrong amount.
const valueVerdict = (shown, expected, percent, tol = 0.01) => {
    if (near(shown, expected, tol)) return 'PASS';
    if (shown != null && expected != null && expected < 0 && shown > 0 && near(-shown, expected, tol))
        return `FAIL (minus sign missing: app shows ${fmt(shown)}${percent != null ? ` beside ${fmt(percent)}%` : ''} - expected ${fmt(expected)})`;
    return 'FAIL';
};

// Formulas (all rounded off to two decimals):
//   Individual: P&L value = Qty x LTP - Qty x Avg;  P&L % = ((LTP - Avg) / Avg) x 100
//   Overall:    Invested = sum of Qty x Avg;  Current = sum of Qty x LTP;
//               P&L value = Current - Invested;  P&L % = ((Current - Invested) / Invested) x 100
//   Today's:    P&L value = Qty x LTP - Qty x Prev.close;  P&L % = ((LTP - Prev.close) / Prev.close) x 100
//               (header: summed over holdings, % = value / sum of Qty x Prev.close x 100)
// Invested / Current are Qty-weighted: the app's Invested is the sum of each holding's Qty x Avg
// (live: IDEA Qty 2 at Avg 12.45 counts 24.89). Prev.close isn't shown anywhere, so it is derived
// from the LTP and its change percent on the detail sheet: Prev.close = LTP / (1 + change% / 100).
//
// Tolerances, beyond the one paisa of rounding:
//   - Avg is shown to 2 decimals but the real average can carry more (IDEA: 24.89 / 2 = 12.445),
//     so anything multiplied by Avg is allowed Qty x 0.005, and P&L % (0.005 / Avg) x 100;
//   - Prev.close is rebuilt from a 2-decimal change %, so Today's P&L is allowed Qty x LTP x 0.0001;
//   - during market hours (Mon-Fri 09:15-15:30 IST) prices tick while the holdings are opened one
//     by one, so the header's Current / Overall / Today's P&L vs the holdings' sums are allowed 1%
//     of Current. Outside market hours prices are static and only the rounding tolerances apply.
function isMarketOpen() {
    const parts = Object.fromEntries(new Intl.DateTimeFormat('en-GB', {
        timeZone: 'Asia/Kolkata', weekday: 'short', hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
    }).formatToParts(new Date()).map(p => [p.type, p.value]));
    const minutes = Number(parts.hour) * 60 + Number(parts.minute);
    return !['Sat', 'Sun'].includes(parts.weekday) && minutes >= 9 * 60 + 15 && minutes < 15 * 60 + 30;
}

// Cumulative header: every value shown, and Overall P&L (value and %) = Current - Invested by the
// formulas above, from the header's own Current / Invested. Returns the parsed numbers.
async function checkHoldingsSummary(portfolio) {
    const s = await portfolio.getHoldingsSummary();
    console.log(`Current: ${s.current} | Invested: ${s.invested} | Overall P&L: ${s.overallPnl} | Today's P&L: ${s.todayPnl}`);
    const overall = PortfolioPage.parseValuePercent(s.overallPnl);
    const today = PortfolioPage.parseValuePercent(s.todayPnl);
    const parsed = { current: num(s.current), invested: num(s.invested), overall, today };
    if (!s.current || !s.invested || !s.overallPnl || !s.todayPnl) await portfolio.dumpPageSource('portfolio_holdings_summary');
    console.log(`Current value shown: ${verdict(parsed.current != null && !Number.isNaN(parsed.current))}`);
    console.log(`Invested value shown: ${verdict(parsed.invested != null && !Number.isNaN(parsed.invested))}`);
    console.log(`Overall P&L value and percent shown: ${verdict(overall.value != null && overall.percent != null)}`);
    console.log(`Today's P&L value and percent shown: ${verdict(today.value != null && today.percent != null)}`);

    if (parsed.current != null && parsed.invested != null && overall.value != null) {
        const value = round2(parsed.current - parsed.invested);
        console.log(`Overall P&L ${fmt(overall.value)} vs Current - Invested = ${fmt(value)}: ${valueVerdict(overall.value, value, overall.percent)}`);
        if (parsed.invested && overall.percent != null) {
            const pct = round2(((parsed.current - parsed.invested) / parsed.invested) * 100);
            console.log(`Overall P&L % ${fmt(overall.percent)} vs ((Current - Invested) / Invested) x 100 = ${fmt(pct)}: ${verdict(near(overall.percent, pct))}`);
        }
    }
    return parsed;
}

// While a holding's sheet is open for its P&L: is its MTF quantity listed, and do the Square Off
// buttons match it - MTF qty > 0 -> BUY MORE + NRML Square Off + MTF Square Off; otherwise the plain
// SQUARE OFF + BUY MORE. Option Chain (only some symbols) is logged when shown. Buttons are only
// looked at here - TC 23-25 click through them.
function checkHoldingMtfAndButtons(symbol, qty, mtfQty, b) {
    console.log(`${symbol} MTF qty listed (${mtfQty}): ${verdict(mtfQty != null)}`);
    if (mtfQty == null) return;
    if (qty != null) console.log(`${symbol} MTF qty ${mtfQty} within Qty ${qty}: ${verdict(mtfQty <= qty)}`);
    if (mtfQty > 0) {
        console.log(`${symbol} is an MTF holding - NRML Square Off shown: ${verdict(b.nrmlSquareOff)}`);
        console.log(`${symbol} MTF Square Off shown: ${verdict(b.mtfSquareOff)}`);
    } else {
        console.log(`${symbol} SQUARE OFF shown: ${verdict(b.squareOff)}`);
        if (b.nrmlSquareOff || b.mtfSquareOff) console.error(`FAIL: ${symbol} has no MTF qty but shows NRML / MTF Square Off`);
    }
    console.log(`${symbol} BUY MORE shown: ${verdict(b.buyMore)}`);
    console.log(`${symbol} Option Chain ${b.optionChain ? 'shown' : 'not shown (not applicable for this symbol)'}`);
}

// One holding: name / Qty / Avg from its row, then its detail sheet (Current Value = Market Value,
// P&L value and percent, Avg, LTP and change percent, Day's P&L), closed with back - SQUARE OFF /
// BUY MORE are never tapped. The P&L and Today's P&L are recomputed with the formulas above.
// Returns the detail fields plus the derived prevClose, or null when the sheet couldn't be read.
async function checkHolding(portfolio, h) {
    const qty = num(h.quantity), avg = num(h.avgPrice), invested = num(h.invested);
    console.log(`\n${h.symbol}: row shows Qty ${h.quantity}, Avg ${h.avgPrice}, Invested ${h.invested}`);
    console.log(`${h.symbol} name / Qty / Avg on the row: ${verdict(!!h.symbol && qty != null && avg != null)}`);

    if (!(await portfolio.openHoldingDetails(h.raw))) {
        await portfolio.dumpPageSource(`portfolio_holding_${h.symbol}_no_details`);
        console.error(`FAIL: could not open the details of ${h.symbol}`);
        await portfolio.closeHoldingDetails();
        return null;
    }
    const d = await portfolio.readHoldingDetails();
    const mtfQty = await portfolio.readHoldingMtfQuantity();
    const buttons = await portfolio.getHoldingDetailButtons();
    await portfolio.closeHoldingDetails();
    console.log(`${h.symbol} details: Exchange ${d.exchange}, Qty ${d.quantity}, Current Value ${fmt(d.marketValue)}, P&L ${fmt(d.pnl)} (${fmt(d.pnlPercent)}%), Avg ${fmt(d.avgPrice)}, LTP ${fmt(d.ltp)} (${fmt(d.changePercent)}%), Invested ${fmt(d.invested)}, Day's P&L ${fmt(d.daysPnl)}`);
    checkHoldingMtfAndButtons(h.symbol, d.quantity, mtfQty, buttons);

    console.log(`${h.symbol} name on details: ${d.symbol} ${verdict(d.symbol && d.symbol.toUpperCase() === h.symbol.toUpperCase())}`);
    console.log(`${h.symbol} Current Value shown: ${verdict(d.marketValue != null)}`);
    console.log(`${h.symbol} Qty ${d.quantity} matches the row (${qty}): ${verdict(d.quantity != null && d.quantity === qty)}`);
    console.log(`${h.symbol} P&L value and percent shown: ${verdict(d.pnl != null && d.pnlPercent != null)}`);
    console.log(`${h.symbol} Avg ${fmt(d.avgPrice)} matches the row (${fmt(avg)}): ${verdict(near(d.avgPrice, avg))}`);
    console.log(`${h.symbol} LTP and change percent shown: ${verdict(d.ltp != null && d.changePercent != null)}`);

    const A = d.avgPrice != null ? d.avgPrice : avg;
    const Q = d.quantity != null ? d.quantity : qty;
    const L = d.ltp;
    if (L != null && A && Q) {
        const pnl = round2(Q * L - Q * A);
        console.log(`${h.symbol} P&L ${fmt(d.pnl)} vs Qty x LTP - Qty x Avg = ${Q} x ${fmt(L)} - ${Q} x ${fmt(A)} = ${fmt(pnl)}: ${valueVerdict(d.pnl, pnl, d.pnlPercent, 0.01 + Q * 0.005)}`);
        const pct = round2(((L - A) / A) * 100);
        console.log(`${h.symbol} P&L % ${fmt(d.pnlPercent)} vs ((LTP - Avg) / Avg) x 100 = ${fmt(pct)}: ${verdict(near(d.pnlPercent, pct, 0.01 + (0.005 / A) * 100))}`);
        const current = round2(Q * L);
        console.log(`${h.symbol} Current Value ${fmt(d.marketValue)} vs Qty x LTP = ${fmt(current)}: ${verdict(near(d.marketValue, current))}`);
    }
    if (A && Q && invested != null)
        console.log(`${h.symbol} Invested ${fmt(invested)} vs Qty x Avg = ${fmt(round2(Q * A))}: ${verdict(near(invested, Q * A, 0.01 + Q * 0.005))}`);

    // Today's P&L - Prev.close rebuilt from LTP and change % (so the change % itself is the
    // ((LTP - Prev.close) / Prev.close) x 100 input here; the Day's P&L value is what's checked).
    let prevClose = null;
    if (L != null && d.changePercent != null && d.changePercent > -100) {
        prevClose = L / (1 + d.changePercent / 100);
        const dayPnl = round2(Q * L - Q * prevClose);
        console.log(`${h.symbol} Prev.close (from LTP ${fmt(L)} and change ${fmt(d.changePercent)}%) = ${fmt(prevClose)}`);
        if (d.daysPnl != null)
            console.log(`${h.symbol} Day's P&L ${fmt(d.daysPnl)} vs Qty x LTP - Qty x Prev.close = ${fmt(dayPnl)}: ${valueVerdict(d.daysPnl, dayPnl, d.changePercent, 0.01 + Q * L * 0.0001)}`);
    }
    return { ...d, quantity: Q, avgPrice: A, prevClose, raw: h.raw, mtfQty, buttons };
}

// Header totals vs the holdings, by the formulas above. The header is read again here (right after
// the holdings) so live prices have had as little time as possible to move.
async function checkSummaryAgainstHoldings(portfolio, holdings, details) {
    // TC 9 scrolled down to open the lower holdings - bring the header back first.
    if (!(await portfolio.scrollHoldingsToTop())) {
        await portfolio.dumpPageSource('portfolio_holdings_header_not_found');
        console.error('FAIL: the Holdings summary header (Current / Invested / P&L) could not be scrolled back into view');
        return;
    }
    const fresh = await portfolio.getHoldingsSummary();
    const summary = {
        current: num(fresh.current), invested: num(fresh.invested),
        overall: PortfolioPage.parseValuePercent(fresh.overallPnl), today: PortfolioPage.parseValuePercent(fresh.todayPnl),
    };
    console.log(`Header now: Current ${fresh.current} | Invested ${fresh.invested} | Overall P&L ${fresh.overallPnl} | Today's P&L ${fresh.todayPnl}`);
    const n = holdings.length;
    const all = details.every(Boolean);
    const qtySum = holdings.reduce((t, h) => t + (num(h.quantity) || 0), 0);

    // Invested isn't live: sum of Qty x Avg (Avg rounding only).
    const investedSum = all
        ? details.reduce((t, d) => t + d.quantity * d.avgPrice, 0)
        : holdings.reduce((t, h) => t + num(h.quantity) * num(h.avgPrice), 0);
    console.log(`Invested ${fmt(summary.invested)} vs sum of Qty x Avg = ${fmt(round2(investedSum))}: ${verdict(near(summary.invested, investedSum, 0.01 * n + qtySum * 0.005))}`);
    if (!all) {
        console.log(`Details read for ${details.filter(Boolean).length}/${n} holdings - Current / Overall / Today's P&L totals not compared`);
        return;
    }

    const open = isMarketOpen();
    const live = open && summary.current ? Math.abs(summary.current) * 0.01 : 0;
    console.log(`Market ${open ? 'open - header vs sums allowed 1% of Current for live prices' : 'closed - prices static, rounding tolerance only'}`);

    const currentSum = details.reduce((t, d) => t + d.quantity * d.ltp, 0);
    console.log(`Current ${fmt(summary.current)} vs sum of Qty x LTP = ${fmt(round2(currentSum))}: ${verdict(near(summary.current, currentSum, 0.01 * n + live))}`);

    const overallValue = round2(currentSum - investedSum);
    const overallPct = investedSum ? round2(((currentSum - investedSum) / investedSum) * 100) : null;
    console.log(`Overall P&L ${fmt(summary.overall.value)} vs Current - Invested = ${fmt(overallValue)}: ${valueVerdict(summary.overall.value, overallValue, summary.overall.percent, 0.01 * n + qtySum * 0.005 + live)}`);
    if (overallPct != null) {
        const pctTol = 0.01 + (investedSum ? ((qtySum * 0.005 + live) / investedSum) * 100 : 0);
        console.log(`Overall P&L % ${fmt(summary.overall.percent)} vs ((Current - Invested) / Invested) x 100 = ${fmt(overallPct)}: ${verdict(near(summary.overall.percent, overallPct, pctTol))}`);
    }

    if (details.some(d => d.prevClose == null)) {
        console.log("Prev.close not derivable for every holding - Today's P&L total not compared");
        return;
    }
    const prevSum = details.reduce((t, d) => t + d.quantity * d.prevClose, 0);
    const todayValue = round2(currentSum - prevSum);
    const todayPct = prevSum ? round2(((currentSum - prevSum) / prevSum) * 100) : null;
    const rebuildTol = details.reduce((t, d) => t + d.quantity * d.ltp * 0.0001, 0);
    console.log(`Today's P&L ${fmt(summary.today.value)} vs sum of (Qty x LTP - Qty x Prev.close) = ${fmt(todayValue)}: ${valueVerdict(summary.today.value, todayValue, summary.today.percent, 0.01 * n + rebuildTol + live)}`);
    if (todayPct != null) {
        const pctTol = 0.01 + ((rebuildTol + live) / prevSum) * 100;
        console.log(`Today's P&L % ${fmt(summary.today.percent)} vs ((Current - Prev.close total) / Prev.close total) x 100 = ${fmt(todayPct)}: ${verdict(near(summary.today.percent, todayPct, pctTol))}`);
    }
}

// Types a random holding's symbol (HOLDINGS_SEARCH=<symbol> to pick one) into "Search for
// Stocks": that symbol must be listed and the list narrowed to rows matching it. Then Cancel twice:
// "Clear Search" (text gone, full list back), then "Cancel Search" (search exited). If the bar opens another screen instead
// (e.g. a global search), that screen is dumped and backed out of.
async function checkHoldingsSearch(portfolio, holdings) {
    const query = process.env.HOLDINGS_SEARCH || holdings[Math.floor(Math.random() * holdings.length)].symbol;
    console.log(`Searching for "${query}" (picked from the ${holdings.length} holding(s))`);
    const { opened, text } = await portfolio.searchHoldings(query, { hideKeyboard: false });
    console.log(`Search bar focused (keyboard shown): ${opened}`);
    // The Cancel control hasn't been captured in a dump yet - keep the searching state.
    await portfolio.dumpPageSource('portfolio_holdings_search');
    if (!(await portfolio.isOnPortfolio(2000))) {
        console.log(`Search opened a different screen (dumped) - backing out to Holdings`);
        await portfolio.driver.back();
        await portfolio.pause(800);
        if (!(await portfolio.isOnPortfolio(3000))) console.error('FAIL: could not get back to Holdings after the search');
        return;
    }
    console.log(`Search text "${text}" equals "${query}": ${verdict(text === query)}`);
    const rows = (await portfolio.getHoldingRows()).map(r => PortfolioPage.parseHoldingRow(r));
    console.log(`Rows after searching "${query}": ${rows.map(r => r.symbol).join(', ') || 'none'}`);
    console.log(`"${query}" listed: ${verdict(rows.some(r => r.symbol.toUpperCase() === query.toUpperCase()))}`);
    const others = rows.filter(r => !r.symbol.toUpperCase().includes(query.toUpperCase()));
    console.log(`Only rows matching "${query}" listed: ${verdict(!others.length)}${others.length ? ` (also: ${others.map(r => r.symbol).join(', ')})` : ''}`);

    // First Cancel - the x in the bar ("Clear Search"): text gone, full list back, still searching.
    console.log('Clicking Cancel (Clear Search) in the search bar...');
    const cleared = await portfolio.tapHoldingsSearchClear();
    if (!cleared) {
        console.error('FAIL: "Clear Search" not found in the search bar - clearing the text by keyboard instead');
        await portfolio.clearHoldingsSearch();
    }
    const after = await portfolio.getHoldingsSearchText();
    console.log(`Search text cleared: ${verdict(after === '')}${after ? ` (still "${after}")` : ''}`);
    const back = (await portfolio.getHoldingRows()).map(r => PortfolioPage.parseHoldingRow(r));
    console.log(`Rows after clearing: ${back.map(r => r.symbol).join(', ') || 'none'}`);
    if (holdings.length > 1) {
        const restored = back.some(r => !r.symbol.toUpperCase().includes(query.toUpperCase()));
        console.log(`Full Holdings list back after clearing: ${verdict(restored)}`);
    }

    // Second Cancel - "Cancel Search, Double tap to exit search": leaves search mode.
    console.log('Clicking Cancel again (Cancel Search) to exit the search...');
    const exited = await portfolio.tapHoldingsSearchCancel();
    if (!exited) {
        console.error('FAIL: "Cancel Search, Double tap to exit search" not found');
        await portfolio.dumpPageSource('portfolio_holdings_search_no_cancel');
    } else {
        await portfolio.hideKeyboardIfShown();
        const gone = !(await portfolio.isHoldingsSearchCancelShown());
        console.log(`Search exited (Cancel Search no longer shown): ${verdict(gone)}`);
        console.log(`Back on Holdings: ${verdict((await portfolio.getSelectedTopTab()) === 'Holdings')}`);
    }
}

// TC 8 (continued): each Holdings control opens its page - Filter -> filter options -> back;
// Pledge -> web page -> its close Button; Alerts -> Alerts screen -> back. Each ends back on Holdings.
async function checkHoldingsControls(portfolio, controls) {
    const backOnHoldings = async () => {
        const ok = await portfolio.backToHoldings();
        console.log(`Back on Holdings: ${verdict(ok)}`);
    };

    if (controls.filter) {
        console.log('Clicking Filter...');
        await portfolio.tapHoldingsControl('filter');
        const open = await portfolio.isHoldingsFilterOpen();
        await portfolio.dumpPageSource('portfolio_holdings_filter');
        console.log(`Filter opened: ${verdict(open)}`);
        await portfolio.driver.back();
        await portfolio.pause(1000);
        await backOnHoldings();
    }

    if (controls.pledge) {
        console.log('Clicking Pledge...');
        await portfolio.tapHoldingsControl('pledge');
        const open = await portfolio.isPledgePageOpen();
        await portfolio.dumpPageSource('portfolio_pledge');
        console.log(`Pledge web page opened: ${verdict(open)}`);
        console.log('Closing the web page...');
        // Only look for its close Button while the page is up - never tap a stray Button on Holdings.
        const closed = open ? await portfolio.closePledgePage() : null;
        if (closed === null) {
            console.error('FAIL: no close Button (android.widget.Button) on the Pledge page - closing with back');
            await portfolio.driver.back();
            await portfolio.pause(1500);
        } else {
            console.log(`Tapped the close Button${closed ? ` "${closed}"` : ''}`);
        }
        console.log(`Pledge web page closed: ${verdict(!(await portfolio.isElementVisible(PortfolioPage.WEBVIEW, 1500)))}`);
        await backOnHoldings();
    }

    if (controls.alerts) {
        console.log('Clicking Alerts...');
        await portfolio.tapHoldingsControl('alerts');
        const open = await portfolio.isAlertsScreenOpen();
        await portfolio.dumpPageSource('portfolio_alerts');
        console.log(`Alerts screen opened: ${verdict(open)}`);
        await backOnHoldings();
    }
}

// The first holding's detail sheet and the screens it opens. Read-only: SQUARE OFF / BUY MORE and
// Set Alert's Create Alert are never tapped.
// TC n   first holding -> detail sheet: name, LTP + change %, Invested, Market value, Qty, MTF,
//        P&L + %, Day's P&L; Price Breakdown / View Chart / Add Alerts / SQUARE OFF / BUY MORE shown
// TC n+1 Price Breakdown: Date / Qty / Price columns with values in every row
// TC n+2 Close -> back on the detail sheet
// TC n+3 View Chart -> wait 10s -> web page with the symbol's chart -> Close
// TC n+4 Add Alerts -> Set Alert for the same symbol -> back -> detail sheet closed
async function checkFirstHoldingScreens(portfolio, n, known = null) {
    tc(n, 'Clicking the first holding and verifying its detail sheet...');
    await portfolio.scrollHoldingsToTop();
    const first = (await portfolio.getHoldingRows())[0];
    if (!first) {
        console.error('FAIL: no holding row on screen to open');
        return;
    }
    const h = PortfolioPage.parseHoldingRow(first);
    console.log(`First holding: ${h.symbol}`);
    if (!(await portfolio.openHoldingDetails(first))) {
        await portfolio.dumpPageSource('portfolio_first_holding_no_details');
        console.error(`FAIL: the detail sheet of ${h.symbol} did not open`);
        return;
    }
    await portfolio.dumpPageSource('portfolio_holding_details');
    const d = await portfolio.readHoldingDetails();
    const mtf = await portfolio.readHoldingMtfQuantity();
    console.log(`Details: ${d.symbol} | LTP ${fmt(d.ltp)} (${fmt(d.changePercent)}%) | Invested ${fmt(d.invested)} | Market value ${fmt(d.marketValue)} | Qty ${d.quantity} | MTF ${mtf} | P&L ${fmt(d.pnl)} (${fmt(d.pnlPercent)}%) | Day's P&L ${fmt(d.daysPnl)}`);
    const fields = [
        ['Symbol name', d.symbol && d.symbol.toUpperCase() === h.symbol.toUpperCase()],
        ['LTP', d.ltp != null],
        ['Change percent', d.changePercent != null],
        ['Invested value', d.invested != null],
        ['Market value', d.marketValue != null],
        ['Qty', d.quantity != null],
        ['MTF quantity', mtf != null],
        ['P&L value', d.pnl != null],
        ['P&L percent', d.pnlPercent != null],
        ["Day's P&L", d.daysPnl != null],
    ];
    fields.forEach(([name, ok]) => console.log(`${name} shown: ${verdict(ok)}`));
    const buttons = await portfolio.getHoldingDetailButtons();
    console.log(`Price Breakdown shown: ${verdict(buttons.priceBreakdown)}`);
    console.log(`View Chart shown: ${verdict(buttons.viewChart)}`);
    console.log(`Add Alerts shown: ${verdict(buttons.addAlerts)}`);
    console.log(`SQUARE OFF shown: ${verdict(buttons.squareOff)}`);
    console.log(`BUY MORE shown: ${verdict(buttons.buyMore)}`);

    tc(n + 1, 'Clicking Price Breakdown and verifying the Date, Qty and Price columns...');
    if (!(await portfolio.tapHoldingDetailButton('priceBreakdown'))) {
        console.error('FAIL: Price Breakdown button not found on the detail sheet');
    } else {
        const open = await portfolio.isPriceBreakdownOpen();
        await portfolio.dumpPageSource('portfolio_price_breakdown');
        const pb = await portfolio.readPriceBreakdown();
        console.log(`Price Breakdown opened: ${verdict(open)}`);
        console.log(`Date column shown: ${verdict(pb.headers.date)}`);
        console.log(`Qty column shown: ${verdict(pb.headers.qty)}`);
        console.log(`Price column shown: ${verdict(pb.headers.price)}`);
        console.log(`Price Breakdown is for ${h.symbol} (title "${pb.title}"): ${verdict(!!pb.title && pb.title.toUpperCase().endsWith(h.symbol.toUpperCase()))}`);
        console.log(`Rows (${pb.rows.length}):`);
        pb.rows.forEach((r, i) => console.log(`  [${i}] Date ${r.date} | Qty ${r.qty} | Price ${r.price}`));
        if (!pb.rows.length) console.error('FAIL: no Price Breakdown rows found');
        pb.rows.forEach((r, i) => {
            const dateOk = !!r.date && /\d/.test(r.date);
            const qtyOk = /^\d+$/.test(String(r.qty || '').trim()) && Number(r.qty) > 0;
            const priceOk = num(r.price) > 0;
            console.log(`Row ${i} Date / Qty / Price values: ${verdict(dateOk && qtyOk && priceOk)}`);
        });
        if (pb.rows.length && pb.rows.every(r => num(r.qty) > 0)) {
            const qtySum = pb.rows.reduce((t, r) => t + num(r.qty), 0);
            console.log(`Breakdown Qty total ${qtySum} vs holding Qty ${d.quantity} (reference)`);
        }

        tc(n + 2, 'Clicking Close on Price Breakdown...');
        if (!(await portfolio.tapPriceBreakdownClose())) {
            console.error('FAIL: Close button not found on Price Breakdown - closing with back');
            await portfolio.driver.back();
            await portfolio.pause(1500);
        }
        const pbGone = !(await portfolio.readPriceBreakdown()).title;
        console.log(`Price Breakdown closed: ${verdict(pbGone)}`);
        console.log(`Back on the detail sheet: ${verdict(await portfolio.isHoldingDetailsOpen(4000))}`);
    }

    tc(n + 3, 'Clicking View Chart, waiting 10s and verifying the chart web page...');
    if (!(await portfolio.isHoldingDetailsOpen(2000)) && !(await portfolio.openHoldingDetails(first))) {
        console.error(`FAIL: could not get back to the detail sheet of ${h.symbol}`);
        return;
    }
    if (!(await portfolio.tapHoldingDetailButton('viewChart'))) {
        console.error('FAIL: View Chart button not found on the detail sheet');
    } else {
        console.log('Waiting 10s for the chart to load...');
        const chart = await portfolio.readChartPage(10000);
        await portfolio.dumpPageSource('portfolio_view_chart');
        await portfolio.saveScreenshot('portfolio_view_chart');
        // The chart WebView is laid over the detail sheet, whose nodes stay in the tree behind it -
        // so the symbol is checked against the chart's own content. Its header symbol TextView is
        // NOT used: the WebView's accessibility text for it is stale (live 2026-11-23 it read "VISL"
        // while the screenshot showed "B2BSOFT BSE"). The company line (resource-id "sym-detail")
        // does update, so the holding's symbol is matched against it.
        console.log(`Chart web page (WebView) shown: ${verdict(chart.webView)}`);
        console.log(`Chart company: "${chart.company}" (header text "${chart.headerText}" - stale in accessibility, not checked)`);
        console.log(`Chart is for ${h.symbol} (company "${chart.company}"): ${verdict(PortfolioPage.symbolMatchesCompany(h.symbol, chart.company))}`);

        console.log('Clicking Close on the chart...');
        if (!(await portfolio.tapChartClose())) {
            console.error('FAIL: Close button not found on the chart - closing with back');
            await portfolio.driver.back();
            await portfolio.pause(1500);
        }
        const chartGone = !(await portfolio.isElementVisible(PortfolioPage.WEBVIEW, 1500));
        console.log(`Chart closed: ${verdict(chartGone)}`);
        console.log(`Back on the detail sheet: ${verdict(await portfolio.isHoldingDetailsOpen(4000))}`);
    }

    tc(n + 4, 'Clicking Add Alerts and verifying the alert screen opens for the symbol...');
    if (!(await portfolio.isHoldingDetailsOpen(2000)) && !(await portfolio.openHoldingDetails(first))) {
        console.error(`FAIL: could not get back to the detail sheet of ${h.symbol}`);
        return;
    }
    if (!(await portfolio.tapHoldingDetailButton('addAlerts'))) {
        console.error('FAIL: Add Alerts button not found on the detail sheet');
    } else {
        const alert = await portfolio.readSetAlertScreen();
        await portfolio.dumpPageSource('portfolio_add_alert');
        console.log(`Set Alert screen opened: ${verdict(alert.open)}`);
        if (alert.open) {
            const named = alert.descs.some(x => x.toUpperCase() === h.symbol.toUpperCase());
            console.log(`Set Alert is for ${h.symbol} (symbol shown${alert.ltpSymbol ? `, LTP line for ${alert.ltpSymbol}` : ''}): ${verdict(named || (alert.ltpSymbol || '').toUpperCase() === h.symbol.toUpperCase())}`);
            console.log(`Create Alert button shown: ${verdict(alert.createAlertShown)}`);
        }
        console.log('Navigating back...');
        await portfolio.leaveSetAlertScreen();
    }
    // Back to the Holdings list (Set Alert may return to the detail sheet or to the list).
    if (await portfolio.isHoldingDetailsOpen(2000)) await portfolio.closeHoldingDetails();
    console.log(`Back on Holdings: ${verdict(await portfolio.isOnPortfolio(4000))}`);

    await checkOrderPadsAndQuote(portfolio, first, h.symbol, n + 5);
    await checkOptionChainAndMtf(portfolio, n + 9, known);
}

// Option Chain shows only for some symbols, and NRML / MTF Square Off only for an MTF holding - so
// the holdings are opened one by one (detail sheet read, then closed) until one of each is found.
// TC n   Option Chain -> Option Chain screen ("Strike Price") -> back
// TC n+1 MTF holding: BUY MORE + NRML Square Off + MTF Square Off shown; NRML Square Off -> normal
//        SELL Order Pad (no "MTF") -> back
// TC n+2 MTF Square Off -> SELL Order Pad with "MTF" -> back
// Order Pads are only opened - their SELL is never tapped.
async function checkOptionChainAndMtf(portfolio, n, known = null) {
    await portfolio.backToHoldings();
    await portfolio.scrollHoldingsToTop();
    let optionChain = null, mtf = null;
    // Full run: TC 9 already read every holding's MTF qty and buttons - reuse that.
    if (known && known.length && known.every(Boolean)) {
        const oc = known.find(d => d.buttons.optionChain);
        const m = known.find(d => d.mtfQty > 0 || d.buttons.nrmlSquareOff || d.buttons.mtfSquareOff);
        if (oc) optionChain = { raw: oc.raw, symbol: oc.symbol };
        if (m) mtf = { raw: m.raw, symbol: m.symbol, mtfQty: m.mtfQty, buttons: m.buttons };
    }
    const rows = known && known.length && known.every(Boolean) ? [] : await portfolio.collectAllHoldingRows();
    for (const raw of rows) {
        if (optionChain && mtf) break;
        const symbol = PortfolioPage.parseHoldingRow(raw).symbol;
        if (!(await portfolio.openHoldingDetails(raw))) continue;
        const buttons = await portfolio.getHoldingDetailButtons();
        const mtfQty = await portfolio.readHoldingMtfQuantity();
        console.log(`${symbol}: Option Chain ${buttons.optionChain ? 'shown' : 'not shown'} | MTF qty ${mtfQty} | NRML Square Off ${buttons.nrmlSquareOff ? 'shown' : 'not shown'} | MTF Square Off ${buttons.mtfSquareOff ? 'shown' : 'not shown'}`);
        if (!optionChain && buttons.optionChain) optionChain = { raw, symbol };
        if (!mtf && (mtfQty > 0 || buttons.nrmlSquareOff || buttons.mtfSquareOff)) mtf = { raw, symbol, mtfQty, buttons };
        await portfolio.closeHoldingDetails();
    }
    const pad = new OrderPadPage(portfolio.driver);
    const mtfTag = 'android=new UiSelector().description("MTF")';

    tc(n, 'Clicking Option Chain (where shown) and verifying the option chain...');
    if (!optionChain) {
        console.log('No holding shows Option Chain - not applicable for these symbols');
    } else if (await ensureDetailsOpen(portfolio, optionChain.raw, optionChain.symbol)) {
        console.log(`Option Chain shown for ${optionChain.symbol}`);
        await portfolio.tapHoldingDetailButton('optionChain');
        const open = await portfolio.isOptionChainOpen();
        await portfolio.dumpPageSource('portfolio_option_chain');
        console.log(`Option Chain displayed for ${optionChain.symbol} ("Strike Price" column): ${verdict(open)}`);
        console.log('Navigating back...');
        await portfolio.driver.back();
        await portfolio.pause(1500);
        console.log(`Option Chain closed: ${verdict(!(await portfolio.isOptionChainOpen(1500)))}`);
        await portfolio.backToHoldings();
    }

    tc(n + 1, 'MTF holding: verifying BUY MORE, NRML Square Off and MTF Square Off, then NRML Square Off -> normal SELL Order Pad...');
    if (!mtf) {
        console.log('No holding has an MTF quantity - NRML / MTF Square Off not applicable');
        return;
    }
    console.log(`MTF holding: ${mtf.symbol} (MTF qty ${mtf.mtfQty})`);
    console.log(`BUY MORE shown: ${verdict(mtf.buttons.buyMore)}`);
    console.log(`NRML Square Off shown: ${verdict(mtf.buttons.nrmlSquareOff)}`);
    console.log(`MTF Square Off shown: ${verdict(mtf.buttons.mtfSquareOff)}`);

    const squareOff = async (key, label, expectMtf) => {
        if (!mtf.buttons[key]) {
            console.error(`FAIL: ${label} not on the detail sheet of ${mtf.symbol}`);
            return;
        }
        if (!(await ensureDetailsOpen(portfolio, mtf.raw, mtf.symbol))) return;
        await portfolio.tapHoldingDetailButton(key, { opensOrderPad: true });
        const sellPad = await pad.verifyOpenedFor('Sell');
        await portfolio.dumpPageSource(`portfolio_${key}_orderpad`);
        const mtfShown = await portfolio.isElementVisible(mtfTag, 1500);
        console.log(expectMtf
            ? `MTF shown on the SELL Order Pad: ${verdict(mtfShown)}`
            : `Normal SELL Order Pad (no MTF shown): ${verdict(sellPad && !mtfShown)}`);
        if (sellPad) {
            const shown = await pad.getDisplayedSymbol();
            console.log(`Order Pad is for ${mtf.symbol} (header "${shown}"): ${verdict(!!shown && shown.toUpperCase().includes(mtf.symbol.toUpperCase()))}`);
        }
        console.log('Navigating back (SELL is never tapped)...');
        await portfolio.driver.back();
        await portfolio.pause(1500);
        console.log(`Order Pad closed: ${verdict(!(await pad.isDisplayed(1500)))}`);
    };
    await squareOff('nrmlSquareOff', 'NRML Square Off', false);

    tc(n + 2, 'MTF Square Off -> SELL Order Pad with MTF...');
    await squareOff('mtfSquareOff', 'MTF Square Off', true);
    await portfolio.backToHoldings();
}

// The detail sheet must be open before tapping one of its buttons - reopen the holding if the
// previous step left the app on the Holdings list.
async function ensureDetailsOpen(portfolio, raw, symbol) {
    if (await portfolio.isHoldingDetailsOpen(2000)) return true;
    await portfolio.backToHoldings();
    if (await portfolio.openHoldingDetails(raw)) return true;
    console.error(`FAIL: could not open the detail sheet of ${symbol}`);
    return false;
}

// SQUARE OFF / BUY MORE only OPEN the SELL / BUY Order Pad: its own SELL / BUY (and CONFIRM) are
// never tapped, so no order is placed - each pad is left with back.
// TC n   SQUARE OFF -> SELL Order Pad for the symbol -> back
// TC n+1 BUY MORE   -> BUY Order Pad for the symbol -> back
// TC n+2 tap the holding again -> swipe up -> half Quote
// TC n+3 swipe up again -> full Quote -> back to Holdings
async function checkOrderPadsAndQuote(portfolio, raw, symbol, n) {
    const pad = new OrderPadPage(portfolio.driver);
    const padFor = async (key, label, expected, no) => {
        tc(no, `Clicking ${label} and verifying the ${expected.toUpperCase()} Order Pad...`);
        if (!(await ensureDetailsOpen(portfolio, raw, symbol))) return;
        if (!(await portfolio.tapHoldingDetailButton(key, { opensOrderPad: true }))) {
            const b = await portfolio.getHoldingDetailButtons();
            // An MTF holding shows NRML / MTF Square Off instead of the plain SQUARE OFF.
            if (key === 'squareOff' && (b.nrmlSquareOff || b.mtfSquareOff)) console.log(`${symbol} is an MTF holding - NRML / MTF Square Off shown instead of SQUARE OFF (checked in the MTF steps)`);
            else console.error(`FAIL: ${label} button not found on the detail sheet`);
            return;
        }
        const ok = await pad.verifyOpenedFor(expected);
        await portfolio.dumpPageSource(`portfolio_${key}_orderpad`);
        if (ok) {
            const shown = await pad.getDisplayedSymbol();
            console.log(`Order Pad is for ${symbol} (header "${shown}"): ${verdict(!!shown && shown.toUpperCase().includes(symbol.toUpperCase()))}`);
        }
        console.log('Navigating back (the pad\'s own button is never tapped)...');
        await portfolio.driver.back();
        await portfolio.pause(1500);
        const left = !(await pad.isDisplayed(1500));
        console.log(`Order Pad closed: ${verdict(left)}`);
    };
    await padFor('squareOff', 'SQUARE OFF', 'Sell', n);
    await padFor('buyMore', 'BUY MORE', 'Buy', n + 1);

    tc(n + 2, `Clicking ${symbol} again and scrolling the Quote up to half...`);
    await portfolio.backToHoldings();
    if (!(await portfolio.openHoldingDetails(raw))) {
        await portfolio.dumpPageSource('portfolio_quote_no_sheet');
        console.error(`FAIL: tapping ${symbol} did not open its sheet`);
        return;
    }
    const popup = await portfolio.getQuoteState(symbol);
    const buyMore = (await portfolio.getHoldingDetailButtons()).buyMore;
    console.log(`Popup with BUY MORE displayed after tapping ${symbol} (state: ${popup}): ${verdict(popup === 'details' && buyMore)}`);
    // Short steps - one full-height drag goes straight past half to the full Quote.
    const half = await portfolio.swipeUpToHalfQuote(symbol);
    await portfolio.dumpPageSource('portfolio_quote_half');
    console.log(`Half Quote displayed after the first swipe up (state: ${half}): ${verdict(half === 'half')}`);

    tc(n + 3, 'Scrolling the Quote up again to full...');
    await portfolio.swipeUpSheet();
    const full = await portfolio.getQuoteState(symbol);
    await portfolio.dumpPageSource('portfolio_quote_full');
    console.log(`Full Quote displayed after the second swipe up (state: ${full}): ${verdict(full === 'full')}`);

    console.log(`Back on Holdings: ${verdict(await portfolio.backToHoldings())}`);
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
        const alreadyThere = await portfolio.isOnPortfolio(3000);
        let onPortfolio = alreadyThere;
        if (alreadyThere) {
            console.log('App is already on Portfolio');
        } else {
            await backToBottomNav(driver, portfolio);
            await portfolio.clickPortfolioNav();
            onPortfolio = await portfolio.isOnPortfolio(10000);
        }
        console.log(`Portfolio displayed: ${onPortfolio ? 'PASS' : 'FAIL'}`);
        if (!onPortfolio) throw new Error('Portfolio did not open');

        const topTabs = await portfolio.getTopTabs();
        console.log(`Tab counts: Holdings ${topTabs.Holdings.count}, Positions ${topTabs.Positions.count}`);
        const defaultTab = await portfolio.getSelectedTopTab();
        if (alreadyThere) {
            // The app resumed on Portfolio (noReset) - it keeps whichever tab was last open, so
            // the "default" check only applies when this run navigated here itself.
            console.log(`Selected tab on the resumed Portfolio: ${defaultTab} (default-tab check applies only after navigating here)`);
        } else {
            console.log(`Holdings selected by default: ${defaultTab === 'Holdings' ? 'PASS' : `FAIL (selected: ${defaultTab})`}`);
        }

        if (DETAILS_ONLY) {
            if ((await portfolio.getSelectedTopTab()) !== 'Holdings') await portfolio.tapTopTab('Holdings');
            if (!(await portfolio.getHoldingRows()).length) {
                const emptyMsg = await portfolio.getHoldingsEmptyMessage();
                console.log(`No symbols in the holdings${emptyMsg ? ` - app shows: "${emptyMsg}"` : ''} - no holding to open`);
                return;
            }
            await checkFirstHoldingScreens(portfolio, 14);
            console.log('\nPortfolio Holdings detail screens completed (DETAILS_ONLY)');
            return;
        }

        if (SEARCH_ONLY) {
            if ((await portfolio.getSelectedTopTab()) !== 'Holdings') await portfolio.tapTopTab('Holdings');
            const rows = (await portfolio.getHoldingRows()).map(r => PortfolioPage.parseHoldingRow(r));
            if (!rows.length) {
                const emptyMsg = await portfolio.getHoldingsEmptyMessage();
                console.log(`No symbols in the holdings${emptyMsg ? ` - app shows: "${emptyMsg}"` : ''} - nothing to search`);
                return;
            }
            tc(12, 'Searching Holdings for a listed symbol, then clicking Cancel (SEARCH_ONLY)...');
            await checkHoldingsSearch(portfolio, rows);
            console.log('\nPortfolio Holdings search completed (SEARCH_ONLY)');
            return;
        }

        tc(3, 'Clicking the Positions tab and reading its count...');
        await portfolio.tapTopTab('Positions');
        const posSelected = (await portfolio.getSelectedTopTab()) === 'Positions';
        console.log(`Positions tab selected: ${posSelected ? 'PASS' : 'FAIL'}`);
        // Read after the tap, from the tab's own label ("Positions\nN\nTab 2 of 2") - same as
        // Regression R58's getPositionsCount().
        const positionsCount = ((await portfolio.getTopTabs()) || topTabs).Positions.count;
        console.log(`Positions count: ${positionsCount}`);
        const subTabs = await portfolio.getPositionSubTabs();
        console.log(`Today / Derivatives sub-tabs shown: ${subTabs ? 'PASS' : 'FAIL'}`);
        if (!subTabs) throw new Error('Positions sub-tabs (Today / Derivatives) not found');
        // Today is the default sub-tab - checked before anything is tapped.
        console.log(`Today selected by default: ${subTabs.Today.selected ? 'PASS' : 'FAIL'}`);
        if (positionsCount === 0) {
            const empty = await portfolio.isEmptyPositionsShown();
            console.log(`No positions - "${portfolio.emptyPositionsText}" shown: ${empty ? 'PASS' : 'FAIL'}`);
        }

        const today = await checkPositionSubTab(portfolio, 4, 'Today');
        const deriv = await checkPositionSubTab(portfolio, 5, 'Derivatives');
        checkPositionsCount(positionsCount, today, deriv);
        const todaySymbols = today.rows.map(r => PortfolioPage.positionSymbol(r));

        tc(6, 'Clicking the Holdings tab again...');
        await portfolio.tapTopTab('Holdings');
        const holdSelected = (await portfolio.getSelectedTopTab()) === 'Holdings';
        console.log(`Holdings tab selected: ${holdSelected ? 'PASS' : 'FAIL'}`);
        const holdingsCount = ((await portfolio.getTopTabs()) || topTabs).Holdings.count;
        const holdings = (await portfolio.collectAllHoldingRows()).map(r => PortfolioPage.parseHoldingRow(r));
        console.log(`Holdings count: ${holdingsCount} | rows listed: ${holdings.length}`);

        // No holdings: report the app's own message and stop - there is nothing else to verify.
        if (holdingsCount === 0 || !holdings.length) {
            const emptyMsg = await portfolio.getHoldingsEmptyMessage();
            if (emptyMsg) {
                console.log(`No symbols in the holdings - app shows: "${emptyMsg}"`);
            } else {
                await portfolio.dumpPageSource('portfolio_holdings_empty');
                console.error(`FAIL: No symbols in the holdings (count ${holdingsCount}) and the "You don't have any Holdings" message was not shown`);
            }
            if (holdingsCount > 0) console.error(`FAIL: Holdings tab shows ${holdingsCount} but no holding rows were found`);
            return;
        }
        console.log(`Rows listed ${holdings.length} vs Holdings count ${holdingsCount}: ${holdings.length === holdingsCount ? 'PASS' : 'FAIL'}`);

        tc(7, "Verifying the cumulative P&L: Current, Invested, Overall P&L and Today's P&L (value and percent)...");
        await checkHoldingsSummary(portfolio);

        tc(8, 'Verifying the search bar and the Filter, Pledge and Alerts buttons...');
        const controls = await portfolio.getHoldingsControls();
        console.log(`Search bar ("Search for Stocks") shown: ${controls.search ? 'PASS' : 'FAIL'}`);
        console.log(`Filter button shown: ${controls.filter ? 'PASS' : 'FAIL'}`);
        console.log(`Pledge button shown: ${controls.pledge ? 'PASS' : 'FAIL'}`);
        console.log(`Alerts button shown: ${controls.alerts ? 'PASS' : 'FAIL'}`);
        await checkHoldingsControls(portfolio, controls);

        tc(9, 'Verifying every holding shows its name, Current Value, Qty, P&L (value and percent), Avg, LTP and change percent...');
        const details = [];
        for (const h of holdings) details.push(await checkHolding(portfolio, h));

        tc(10, 'Verifying the cumulative P&L against the individual holdings...');
        await checkSummaryAgainstHoldings(portfolio, holdings, details);

        tc(11, 'Verifying Holdings lists only equity symbols...');
        let nonEquity = 0;
        holdings.forEach((h, i) => {
            const raw = `${h.raw} ${details[i] && details[i].exchange ? `Exchange: ${details[i].exchange}` : ''}`;
            const reason = nonEquityReason(raw);
            if (reason) {
                nonEquity++;
                console.error(`FAIL: ${h.symbol} in Holdings looks like a non-equity contract (${reason}): ${raw}`);
            }
        });
        if (!nonEquity) console.log(`All ${holdings.length} holding(s) are equity symbols: PASS`);

        tc(12, 'Searching Holdings for a listed symbol, then clicking Cancel...');
        await checkHoldingsSearch(portfolio, holdings);

        tc(13, "Verifying no symbol from Positions -> Today is listed in Holdings...");
        const holdingSet = new Set(holdings.map(h => normSymbol(h.symbol)));
        const overlap = todaySymbols.filter(s => holdingSet.has(normSymbol(s)));
        if (!todaySymbols.length) {
            console.log('No Today positions to compare - nothing executed today: PASS');
        } else if (overlap.length) {
            console.error(`FAIL: symbol(s) executed today also listed in Holdings: ${overlap.join(', ')}`);
        } else {
            console.log(`None of today's ${todaySymbols.length} position symbol(s) (${todaySymbols.join(', ')}) are in Holdings: PASS`);
        }

        await checkFirstHoldingScreens(portfolio, 14, details);

        console.log('\nPortfolio Holdings flow completed');
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
