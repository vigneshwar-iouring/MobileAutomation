const DriverManager = require('../../driver/DriverManager');
const SplashPage = require('../../pages/SplashPage');
const PortfolioPage = require('../../pages/PortfolioPage');
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
// Read-only also on the holding detail sheet: SQUARE OFF / BUY MORE are never tapped.

const tc = (no, text) => console.log(`\nTC ${no}: ${text}`);

// SEARCH_ONLY=1 runs just TC 1-2 and the Holdings search + Cancel (TC 12) - no Positions, no
// holding details, no P&L checks.
const SEARCH_ONLY = process.env.SEARCH_ONLY === '1';

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
    await portfolio.closeHoldingDetails();
    console.log(`${h.symbol} details: Exchange ${d.exchange}, Qty ${d.quantity}, Current Value ${fmt(d.marketValue)}, P&L ${fmt(d.pnl)} (${fmt(d.pnlPercent)}%), Avg ${fmt(d.avgPrice)}, LTP ${fmt(d.ltp)} (${fmt(d.changePercent)}%), Invested ${fmt(d.invested)}, Day's P&L ${fmt(d.daysPnl)}`);

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
    return { ...d, quantity: Q, avgPrice: A, prevClose };
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
