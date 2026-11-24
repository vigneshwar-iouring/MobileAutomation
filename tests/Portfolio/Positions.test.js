const DriverManager = require('../../driver/DriverManager');
const SplashPage = require('../../pages/SplashPage');
const PortfolioPage = require('../../pages/PortfolioPage');
const permissionHandler = require('../../utils/permissionHandler');
const { createLogger, getFailedTCs } = require('../../utils/logger');

const { logFile, entries } = createLogger('Portfolio_Positions');
console.log(`Logging this run to: ${logFile}`);

// Read-only: only the Portfolio bottom-nav button, the Positions tab and the Today / Derivatives
// sub-tabs are tapped - no row, SQUARE OFF or Exit Positions.
//
// Sub-tabs:
//   Today       - every buy and sell executed today, ALL segments (equity, F&O, currency, commodity).
//                 Nothing stays on Today for more than one day: an equity position moves to
//                 Holdings the next day, so no Today equity symbol is in Holdings yet.
//   Derivatives - only F&O positions (NFO / BFO futures and options): every F&O executed today AND
//                 every open F&O executed earlier (carried forward) - the "Holdings" of F&O. So
//                 each Today F&O row is also on Derivatives; Derivatives rows not on Today are the
//                 carried-forward ones.
//
// TC 1 launch | TC 2 on Portfolio (Portfolio in the bottom navigation if not) | TC 3 Positions tab,
// its count, Today the default sub-tab | TC 4 Today sub-tab: rows vs its own count | TC 5 the same
// on Derivatives, every Derivatives row is F&O, every Today F&O row is on Derivatives (the rest are
// carried forward), then the Positions count vs the sub-tabs (same rule
// as Holdings.test.js / R58) | TC 6 Holdings tab: no Today equity symbol is listed in Holdings.

const tc = (no, text) => console.log(`\nTC ${no}: ${text}`);

// F&O contract markers: option / future type, an expiry date ("25NOV", "27 NOV 2025"), or an F&O
// exchange. Non-F&O markers: a cash-equity series / exchange, or a currency / commodity exchange.
const FNO_MARKERS = [
    /\b(CE|PE|FUT|FUTIDX|FUTSTK|OPTIDX|OPTSTK)\b/i,
    /\b\d{1,2}\s?(JAN|FEB|MAR|APR|MAY|JUN|JUL|AUG|SEP|OCT|NOV|DEC)(\s?\d{2,4})?\b/i,
    /\b(NFO|BFO)\b/,
];
const NON_FNO_MARKERS = [
    /\b(MCX|CDS|NCDEX)\b/,
    /-(EQ|BE)\b/i,
    /Exchange:\s*(NSE|BSE)\b/i,
];
const firstHit = (raw, res) => res.map(re => raw.match(re)).find(Boolean);

// Symbols are compared case-insensitively, ignoring spaces and an exchange / series suffix
// ("RTNPOWER-EQ", "IDEA BSE") - same as Holdings.test.js.
const normSymbol = s => String(s || '').toUpperCase().replace(/[-\s](EQ|BE|NSE|BSE)$/, '').replace(/\s+/g, '');

// Rows are matched across sub-tabs on everything before "Quantity:" (symbol, contract, exchange,
// product) - the quantity can differ when today's trade adds to a carried-forward F&O position.
const rowKey = r => r.split(/\s*Quantity:/)[0].trim();

// Derivatives = today's F&O + carried-forward F&O: every Today F&O row must be on Derivatives, and
// the Derivatives rows not on Today are the ones executed earlier. Only checked when every row on
// both sub-tabs was read.
function checkTodayFnoOnDerivatives(today, deriv) {
    if (today.rows.length !== today.count || deriv.rows.length !== deriv.count) {
        console.log(`Not every row was read (Today ${today.rows.length}/${today.count}, Derivatives ${deriv.rows.length}/${deriv.count}) - Today F&O vs Derivatives not compared`);
        return;
    }
    const todayFno = today.rows.filter(r => firstHit(r, FNO_MARKERS));
    const derivKeys = new Set(deriv.rows.map(rowKey));
    const missing = todayFno.filter(r => !derivKeys.has(rowKey(r)));
    if (!todayFno.length) console.log('No F&O executed today - nothing to find on Derivatives: PASS');
    else if (missing.length) console.error(`FAIL: F&O executed today but not on Derivatives: ${missing.map(r => PortfolioPage.positionSymbol(r)).join(', ')}`);
    else console.log(`All ${todayFno.length} F&O row(s) executed today are on Derivatives: PASS`);

    const todayKeys = new Set(today.rows.map(rowKey));
    const carried = deriv.rows.filter(r => !todayKeys.has(rowKey(r)));
    console.log(`Derivatives carried forward (executed before today): ${carried.length}${carried.length ? ` - ${carried.map(r => PortfolioPage.positionSymbol(r)).join(', ')}` : ''}`);
    const todayOnDeriv = deriv.rows.length - carried.length;
    console.log(`Derivatives ${deriv.count} = today's F&O ${todayFno.length} + carried forward ${carried.length}: ${todayOnDeriv === todayFno.length ? 'PASS' : `FAIL (${todayOnDeriv} Derivatives row(s) are also on Today, Today has ${todayFno.length} F&O row(s))`}`);
}

// Today's equity rows: not F&O and not currency / commodity. These are the ones that move to
// Holdings the next day.
const isTodayEquityRow = r => !firstHit(r, FNO_MARKERS) && !/\b(MCX|CDS|NCDEX)\b/.test(r);

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

// Derivatives lists only F&O: a row with a non-F&O marker is a FAIL; a row with no marker either
// way (row format not confirmed yet) is reported and the screen dumped, not passed silently.
async function checkDerivativesAreFno(portfolio, rows) {
    if (!rows.length) return;
    let bad = 0, unknown = 0;
    for (const r of rows) {
        const sym = PortfolioPage.positionSymbol(r);
        const nonFno = firstHit(r, NON_FNO_MARKERS);
        const fno = firstHit(r, FNO_MARKERS);
        if (nonFno && !/\b(NFO|BFO)\b/.test(r)) {
            bad++;
            console.error(`FAIL: Derivatives lists a non-F&O position ${sym} ("${nonFno[0]}"): ${r.replace(/\n/g, ' | ')}`);
        } else if (!fno) {
            unknown++;
            console.log(`Derivatives row ${sym}: no F&O marker found - segment not confirmed: ${r.replace(/\n/g, ' | ')}`);
        }
    }
    if (unknown) await portfolio.dumpPageSource('portfolio_positions_derivatives_segment');
    if (!bad && !unknown) console.log(`All ${rows.length} Derivatives row(s) are F&O: PASS`);
    else if (!bad) console.log(`No non-F&O row on Derivatives, ${unknown} row(s) unconfirmed - see the dump`);
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
    rows.forEach((r, i) => console.log(`  [${i}] ${PortfolioPage.positionSymbol(r)} - ${r.replace(/\n/g, ' | ')}`));
    if (!rows.length) {
        await portfolio.dumpPageSource(`portfolio_positions_${name.toLowerCase()}`);
        console.error(`FAIL: ${name} shows ${sub.count} item(s) but no position rows were found`);
    } else {
        console.log(`Rows listed ${rows.length} vs ${name} count ${sub.count}: ${rows.length === sub.count ? 'PASS' : 'FAIL'}`);
    }
    return { count: sub.count, rows };
}

// Positions count vs the sub-tabs, same rule as Holdings.test.js / Regression R58: Today = every buy
// and sell executed today (all segments), Derivatives = F&O only (today's and carried forward), so
// today's F&O position is on BOTH tabs and Positions = Derivatives + Today's non-F&O rows - not
// Today + Derivatives. When not every row could be read, only the bounds are checked.
function checkPositionsCount(positionsCount, today, deriv) {
    console.log(`Positions count check: Positions ${positionsCount}, Today ${today.count}, Derivatives ${deriv.count}`);
    const within = today.count <= positionsCount && deriv.count <= positionsCount;
    console.log(`Today (${today.count}) and Derivatives (${deriv.count}) each at most Positions (${positionsCount}): ${within ? 'PASS' : 'FAIL'}`);

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

        const subTabs = await portfolio.getPositionSubTabs();
        console.log(`Today / Derivatives sub-tabs shown: ${subTabs ? 'PASS' : 'FAIL'}`);
        if (!subTabs) throw new Error('Positions sub-tabs (Today / Derivatives) not found');
        console.log(`Today selected by default: ${subTabs.Today.selected ? 'PASS' : 'FAIL'}`);
        if (positionsCount === 0) {
            const empty = await portfolio.isEmptyPositionsShown();
            console.log(`No positions - "${portfolio.emptyPositionsText}" shown: ${empty ? 'PASS' : 'FAIL'}`);
        }

        const today = await checkPositionSubTab(portfolio, 4, 'Today');
        const deriv = await checkPositionSubTab(portfolio, 5, 'Derivatives');
        await checkDerivativesAreFno(portfolio, deriv.rows);
        checkTodayFnoOnDerivatives(today, deriv);
        checkPositionsCount(positionsCount, today, deriv);

        tc(6, "Verifying no equity symbol from Positions -> Today is listed in Holdings (it moves there the next day)...");
        await checkTodayNotInHoldings(portfolio, today.rows);

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
