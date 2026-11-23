const fs = require('fs');
const path = require('path');
const BasePage = require('./BasePage');

// Portfolio (bottom-nav "Portfolio"), DriverManager stack - read-only: nothing here taps SQUARE
// OFF / BUY MORE / Exit Positions. (pages/Portfolio/PortfolioPage.js is the Regression-stack
// version - WDIO globals, not importable here.)
// From a real dump (ui_dumps/r58_positions_subtabs.xml):
//   - top tabs "Holdings\n4\nTab 1 of 2" / "Positions\n1\nTab 2 of 2" (count = number of items);
//   - Positions sub-tabs "Selected. Today's tab. 0 items., Currently selected tab." /
//     "Derivatives tab. 1 items., Double tap to switch to Derivatives tab" - the "Selected."
//     prefix moves to whichever sub-tab is active;
//   - empty state "You don't have any positions"; chrome "Search Positions, ...",
//     "Filter Positions, ...", "Alerts, ...", "Exit Positions mode, ...", "P&L\n0.00".
// Holdings rows (Regression R57, real device): "Stock: X.Invested Value: Y.Average price: Z.
// Quantity: Q. ... Double tap to view holdings details".
// A Positions ROW has not been captured in any dump yet, so position rows are read as "every
// described node in the list area that isn't known chrome" and the first screen that has one is
// saved to ui_dumps/portfolio_positions_<subtab>.xml so the format can be pinned down.
const SUB_TABS = { Today: /Today's tab\.\s*(\d+)\s*items?/i, Derivatives: /Derivatives tab\.\s*(\d+)\s*items?/i };
const TOP_TABS = { Holdings: /^Holdings\n(\d+)\nTab \d+ of \d+/, Positions: /^Positions\n(\d+)\nTab \d+ of \d+/ };
const NAV_LABELS = ['Watchlist', 'Market', 'Orders', 'Portfolio', 'Mutual Funds'];
const POSITIONS_CHROME = [
    /^Search Positions/i, /^Filter Positions/i, /^Alerts,/i, /^Exit Positions mode/i, /^P&L\n/i,
    /don.t have any positions/i, /^Index /i, /^Hamburger menu/i,
];

const normApos = s => String(s || '').replace(/[‘’]/g, "'");

class PortfolioPage extends BasePage {
    constructor(driver) {
        super(driver);
        this.portfolioNavButton = 'android=new UiSelector().className("android.widget.ImageView").description("Portfolio")';
        this.emptyPositionsText = "You don't have any positions";
        this.searchClearButton = 'android=new UiSelector().description("Clear Search, Double tap to clear search text")';
        this.searchCancelButton = 'android=new UiSelector().description("Cancel Search, Double tap to exit search")';
    }

    async clickPortfolioNav(timeout = 8000) {
        await this.click(this.portfolioNavButton, timeout);
        console.log('Clicked Portfolio in the bottom navigation');
    }

    // ---- Top tabs: Holdings / Positions ----

    // { Holdings: {count, node}, Positions: {count, node} } - null when either tab isn't on screen.
    async getTopTabs(nodes) {
        nodes = nodes || await this.getDescribedElements();
        const out = {};
        for (const [name, re] of Object.entries(TOP_TABS)) {
            const node = nodes.find(n => re.test(n.desc));
            if (!node) return null;
            out[name] = { count: Number(node.desc.match(re)[1]), node };
        }
        return out;
    }

    async isOnPortfolio(timeout = 3000) {
        try {
            await this.driver.waitUntil(async () => !!(await this.getTopTabs()), { timeout, interval: 500 });
            return true;
        } catch (_) {
            return false;
        }
    }

    // 'Holdings' / 'Positions' / null. The tab's own `selected` attribute first; Compose doesn't
    // always set it, so fall back to which tab's content is on screen (Positions has the
    // Today/Derivatives sub-tabs, Holdings has holding rows / "Filter Holdings").
    async getSelectedTopTab() {
        for (const name of Object.keys(TOP_TABS)) {
            try {
                const el = await this.driver.$(`android=new UiSelector().descriptionStartsWith("${name}")`);
                if ((await el.isExisting()) && (await el.getAttribute('selected')) === 'true') return name;
            } catch (_) { /* fall through to the content check */ }
        }
        const nodes = await this.getDescribedElements();
        if (nodes.some(n => SUB_TABS.Today.test(n.desc) || SUB_TABS.Derivatives.test(n.desc))) return 'Positions';
        if (nodes.some(n => /Double tap to view holdings details|^Filter Holdings/i.test(n.desc))) return 'Holdings';
        return null;
    }

    // The tab nodes are merged Compose semantics - tap their bounds rather than click() a selector.
    async tapTopTab(name) {
        const tabs = await this.getTopTabs();
        if (!tabs) throw new Error(`Portfolio tabs not on screen - cannot tap "${name}"`);
        await this.tapNode(tabs[name].node);
        await this.pause(1500);
    }

    // ---- Positions sub-tabs: Today / Derivatives ----

    // { Today: {count, selected, node}, Derivatives: {...} } - null when the sub-tab row isn't shown.
    async getPositionSubTabs(nodes) {
        nodes = nodes || await this.getDescribedElements();
        const out = {};
        for (const [name, re] of Object.entries(SUB_TABS)) {
            const node = nodes.find(n => re.test(n.desc));
            if (!node) return null;
            out[name] = {
                count: Number(node.desc.match(re)[1]),
                selected: /^Selected\.|Currently selected tab/i.test(node.desc),
                node,
            };
        }
        return out;
    }

    async tapPositionSubTab(name) {
        const tabs = await this.getPositionSubTabs();
        if (!tabs) throw new Error(`Positions sub-tabs not on screen - cannot tap "${name}"`);
        await this.tapNode(tabs[name].node);
        await this.pause(1500);
    }

    async isEmptyPositionsShown() {
        const nodes = await this.getDescribedElements();
        if (nodes.some(n => /don.t have any positions/i.test(normApos(n.desc)))) return true;
        return (await this.getTextElements()).some(n => /don.t have any positions/i.test(normApos(n.text)));
    }

    // Position rows on screen: described nodes below the sub-tab row (and the search / filter bar
    // under it) and above the bottom navigation that aren't known chrome. Raw content-desc strings.
    async getPositionRows() {
        const nodes = await this.getDescribedElements();
        const tabs = await this.getPositionSubTabs(nodes);
        if (!tabs) return [];
        const chrome = nodes.filter(n => POSITIONS_CHROME.some(re => re.test(n.desc)));
        const listTop = Math.max(tabs.Today.node.y2, ...chrome.filter(n => /^(Search|Filter) Positions|^Exit Positions mode|^Alerts,/i.test(n.desc)).map(n => n.y2));
        const navNodes = nodes.filter(n => NAV_LABELS.includes(n.desc));
        const listBottom = navNodes.length ? Math.min(...navNodes.map(n => n.y1)) : Infinity;
        return nodes
            .filter(n => n.y1 >= listTop && n.y2 <= listBottom)
            .filter(n => !NAV_LABELS.includes(n.desc) && !POSITIONS_CHROME.some(re => re.test(n.desc)))
            .filter(n => !SUB_TABS.Today.test(n.desc) && !SUB_TABS.Derivatives.test(n.desc))
            .map(n => n.desc.trim())
            .filter(Boolean);
    }

    // Every position row in the current sub-tab, scrolling down until nothing new appears, then
    // back to the top. De-duplicated by content-desc, so it can only under-count.
    async collectAllPositionRows(maxScrolls = 10) {
        return this.collectRows(() => this.getPositionRows(), maxScrolls);
    }

    // Best-effort symbol from a position row whose exact grammar isn't confirmed yet: an explicit
    // "Stock:/Symbol:/Scrip:" label, else "... for SYMBOL.", else the row's first line / sentence.
    static positionSymbol(raw) {
        const labelled = raw.match(/(?:Stock|Symbol|Scrip|Instrument)\s*:\s*([^.\n,]+)/i);
        if (labelled) return labelled[1].trim();
        const forSym = raw.match(/\b(?:position|order)s? (?:in|for) ([^.\n,]+)/i);
        if (forSym) return forSym[1].trim();
        return raw.split(/\n|\.\s|,\s/)[0].trim();
    }

    // ---- Holdings ----
    // From a real dump (Regression log, 2026-11-19, 5 holdings):
    //   - summary: label nodes "Current" / "Overall P&L" / "Invested" / "Today's P&L", each value a
    //     separate node directly below its label ("2,444.25", "268.09 (12.32%)", "2,176.16",
    //     "-25.68 (-1.04%)") - values are right-aligned under the right-hand labels, so they're
    //     matched by horizontal overlap with the label, not by x1;
    //   - controls: EditText hint="Search for Stocks", "Pledge, Double tap to open pledge",
    //     "Filter Holdings, Double tap to open holdings filters", "Alerts, Double tap to open alerts";
    //   - row: "Stock: IDEA.Invested Value: 24.89.Average price: 12.45. Quantity: 2., Double tap to
    //     view holdings details" - Current Value, P&L and LTP are drawn on the row but NOT in its
    //     accessibility text, so they are read from the row's detail sheet:
    //     "Stock details: B2BSOFT. Exchange: BSE. Quantity: 1. Margin trading facility quantity: 0."
    //     "Profit and loss: 0.11 (0.62 percent)." "Last traded price is 17.87 (1.76 percent)."
    //     "Average Price: 17.76" "Market Value: 17.87" "Invested Value: 17.76" "Day's P&L: 0.31"
    //     plus SQUARE OFF / BUY MORE (never tapped) - closed with back.

    async getHoldingRows() {
        return (await this.getDescribedElements())
            .map(n => n.desc.trim())
            .filter(d => /^Stock:/i.test(d) || /Double tap to view holdings details/i.test(d));
    }

    async collectAllHoldingRows(maxScrolls = 15) {
        return this.collectRows(() => this.getHoldingRows(), maxScrolls);
    }

    // "Stock: X.Invested Value: Y.Average price: Z. Quantity: Q." -> { raw, symbol, invested, avgPrice, quantity }
    static parseHoldingRow(raw) {
        const get = re => { const m = raw.match(re); return m ? m[1].trim() : null; };
        return {
            raw,
            symbol: get(/Stock:\s*([^.\n]+)\./i) || raw.split(/\n|\./)[0].trim(),
            invested: get(/Invested Value:\s*(-?[\d,]+\.?\d*)/i),
            avgPrice: get(/Average price:\s*(-?[\d,]+\.?\d*)/i),
            quantity: get(/Quantity:\s*(\d+)/i),
        };
    }

    // "268.09 (12.32%)" / "0.11 (0.62 percent)" -> { value: 268.09, percent: 12.32 } (null parts when absent).
    static parseValuePercent(text) {
        const m = String(text || '').match(/(-?[\d,]+(?:\.\d+)?)\s*\(\s*(-?[\d,]+(?:\.\d+)?)\s*(?:%|percent)\s*\)/i);
        if (!m) return { value: null, percent: null };
        return { value: Number(m[1].replace(/,/g, '')), percent: Number(m[2].replace(/,/g, '')) };
    }

    // Cumulative header: { current, invested, overallPnl, todayPnl } as raw strings (null when the
    // label or its value isn't on screen).
    async getHoldingsSummary() {
        const nodes = await this.getDescribedElements();
        const valueBelow = label => {
            const l = nodes.find(n => n.desc.trim() === label);
            if (!l) return null;
            const below = nodes
                .filter(n => n !== l && n.y1 >= l.y2 && n.y1 - l.y2 < 120 && n.x1 <= l.x2 && n.x2 >= l.x1)
                .sort((a, b) => a.y1 - b.y1);
            return below.length ? below[0].desc.trim() : null;
        };
        return {
            current: valueBelow('Current'),
            invested: valueBelow('Invested'),
            overallPnl: valueBelow('Overall P&L'),
            todayPnl: valueBelow("Today's P&L"),
        };
    }

    // Scrolls the Holdings list back up until the summary header ("Current" label) is on screen -
    // opening lower holdings scrolls it away. Returns whether the header is visible.
    async scrollHoldingsToTop(maxSwipes = 6) {
        for (let i = 0; i <= maxSwipes; i++) {
            if ((await this.getDescribedElements()).some(n => n.desc.trim() === 'Current')) return true;
            if (i < maxSwipes) {
                await this.swipe('up');
                await this.pause(500);
            }
        }
        return false;
    }

    // Which Holdings controls are on screen: { search, pledge, filter, alerts } booleans.
    async getHoldingsControls() {
        const descs = (await this.getDescribedElements()).map(n => n.desc);
        const src = await this.driver.getPageSource();
        return {
            search: /hint="Search for Stocks/i.test(src) || descs.some(d => /^Search (for )?(Stocks|Holdings)/i.test(d)),
            pledge: descs.some(d => /^Pledge,/i.test(d)),
            filter: descs.some(d => /^Filter Holdings/i.test(d)),
            alerts: descs.some(d => /^Alerts,/i.test(d)),
        };
    }

    // ---- Holdings controls: Filter / Pledge / Alerts ----
    // Buttons beside the search bar (clickable="false", merged Compose semantics - tapped on bounds):
    //   "Filter Holdings, Double tap to open holdings filters" | "Pledge, Double tap to open pledge" |
    //   "Alerts, Double tap to open alerts".
    static get HOLDINGS_CONTROLS() {
        return { filter: /^Filter Holdings\b/i, pledge: /^Pledge,/i, alerts: /^Alerts,/i };
    }

    async tapHoldingsControl(key) {
        const node = (await this.getDescribedElements()).find(n => PortfolioPage.HOLDINGS_CONTROLS[key].test(n.desc));
        if (!node) return false;
        await this.tapNode(node);
        await this.pause(2000);
        return true;
    }

    // Filter: not captured yet - open when a filter sheet's own controls appear (Apply / Reset /
    // Clear / Sort / a "Filter(s)" title) that the Holdings list itself doesn't have.
    async isHoldingsFilterOpen(timeout = 5000) {
        const re = /^(apply|reset|clear( all)?|sort( by)?|filters?|filter by)\b/i;
        try {
            await this.driver.waitUntil(async () => (await this.getAllLabels()).some(n => re.test(n.label) && !/^Filter Holdings/i.test(n.label)), { timeout, interval: 500 });
            return true;
        } catch (_) {
            return false;
        }
    }

    // Pledge opens a web page - an android.webkit.WebView.
    async isPledgePageOpen(timeout = 10000) {
        return this.isElementVisible(PortfolioPage.WEBVIEW, timeout);
    }

    // Closes the Pledge web page with its close button - an android.widget.Button (per the user:
    // new UiSelector().className("android.widget.Button")). The Holdings' own Buttons can stay in
    // the tree behind the page, so those are skipped and the top-most remaining Button is tapped.
    // Returns the tapped Button's label ('' when unlabelled), or null when none was found.
    async closePledgePage() {
        const own = /^(Pledge,|Filter Holdings|Alerts,|Hamburger menu|Index |Back, Double tap)/i;
        const buttons = (await this.getAllNodes())
            .filter(n => n.cls === 'android.widget.Button' && !own.test(n.desc) && n.y2 > n.y1)
            .sort((a, b) => a.y1 - b.y1 || a.x1 - b.x1);
        if (!buttons.length) return null;
        await this.tapNode(buttons[0]);
        await this.pause(1500);
        return buttons[0].desc || buttons[0].text || '';
    }

    // Alerts screen: its "Search Alerts" search box (hint, seen in the Regression run) or title.
    async isAlertsScreenOpen(timeout = 8000) {
        try {
            await this.driver.waitUntil(async () => {
                const src = await this.driver.getPageSource();
                return /Search Alerts/i.test(src) || (await this.getDescribedElements()).some(n => /^(Alerts|My Alerts)$/i.test(n.desc.trim()));
            }, { timeout, interval: 500 });
            return true;
        } catch (_) {
            return false;
        }
    }

    // "You don't have any Holdings" (content-desc or text, either apostrophe), or null.
    async getHoldingsEmptyMessage() {
        const all = [
            ...(await this.getDescribedElements()).map(n => n.desc),
            ...(await this.getTextElements()).map(n => n.text),
        ];
        const hit = all.find(t => /don.t have any holdings/i.test(normApos(t)));
        return hit ? hit.replace(/\s+/g, ' ').trim() : null;
    }

    // The holding row node whose content-desc is `raw`, scrolled so enough of it sits above the
    // bottom navigation to be tapped. Looks on screen, then further down, then back up.
    async findHoldingRowNode(raw, maxScrolls = 8) {
        const visible = async () => {
            const nodes = await this.getDescribedElements();
            const navTop = Math.min(...nodes.filter(n => NAV_LABELS.includes(n.desc)).map(n => n.y1), Infinity);
            const node = nodes.find(n => n.desc.trim() === raw);
            if (!node) return null;
            const y2 = Math.min(node.y2, navTop);
            return y2 - node.y1 >= 60 ? { ...node, y2 } : null;
        };
        let node = await visible();
        for (const dir of ['down', 'up']) {
            for (let i = 0; !node && i < maxScrolls; i++) {
                await this.swipe(dir);
                await this.pause(600);
                node = await visible();
            }
        }
        return node;
    }

    async isHoldingDetailsOpen(timeout = 5000) {
        try {
            await this.driver.waitUntil(async () => (await this.getDescribedElements()).some(n => /^Stock details:/i.test(n.desc)), { timeout, interval: 400 });
            return true;
        } catch (_) {
            return false;
        }
    }

    // Taps the holding's row (centre of its visible part) and waits for its detail sheet.
    async openHoldingDetails(raw) {
        const node = await this.findHoldingRowNode(raw);
        if (!node) return false;
        await this.tapNode(node);
        return this.isHoldingDetailsOpen();
    }

    // The detail sheet's fields, numbers parsed: { symbol, exchange, quantity, pnl, pnlPercent,
    // ltp, changePercent, avgPrice, marketValue, invested, daysPnl, raw: {...} }.
    async readHoldingDetails() {
        const descs = (await this.getDescribedElements()).map(n => n.desc.trim());
        const find = re => { for (const d of descs) { const m = d.match(re); if (m) return m; } return null; };
        const num = s => (s == null ? null : Number(String(s).replace(/,/g, '')));
        const details = find(/^Stock details:\s*([^.]+)\.\s*(?:Exchange:\s*([^.]+)\.)?\s*(?:Quantity:\s*(\d+))?/i);
        const pnl = find(/^Profit and loss:\s*(.+?)\.?$/i);
        const ltp = find(/^Last traded price is\s*(.+?)\.?$/i);
        const avg = find(/^Average Price:\s*(-?[\d,]+(?:\.\d+)?)/i);
        const mv = find(/^Market Value:\s*(-?[\d,]+(?:\.\d+)?)/i);
        const inv = find(/^Invested Value:\s*(-?[\d,]+(?:\.\d+)?)/i);
        const day = find(/^Day's P&L:\s*(-?[\d,]+(?:\.\d+)?)/i);
        const pnlVP = PortfolioPage.parseValuePercent(pnl && pnl[1]);
        const ltpVP = PortfolioPage.parseValuePercent(ltp && ltp[1]);
        return {
            symbol: details ? details[1].trim() : null,
            exchange: details && details[2] ? details[2].trim() : null,
            quantity: details && details[3] ? Number(details[3]) : null,
            pnl: pnlVP.value, pnlPercent: pnlVP.percent,
            ltp: ltpVP.value, changePercent: ltpVP.percent,
            avgPrice: num(avg && avg[1]),
            marketValue: num(mv && mv[1]),
            invested: num(inv && inv[1]),
            daysPnl: num(day && day[1]),
            raw: { details: details && details[0], pnl: pnl && pnl[0], ltp: ltp && ltp[0] },
        };
    }

    // MTF quantity from "Stock details: X. Exchange: BSE. Quantity: 1. Margin trading facility
    // quantity: 0." - null when not shown.
    async readHoldingMtfQuantity() {
        const d = (await this.getDescribedElements()).find(n => /^Stock details:/i.test(n.desc));
        const m = d && d.desc.match(/Margin trading facility quantity:\s*(\d+)/i);
        return m ? Number(m[1]) : null;
    }

    // ---- Holding detail sheet buttons (real dump, 2026-11-19) ----
    //   "Price Breakdown, Double tap to view holding price breakdown details"
    //   "View Chart, Double tap to open interactive chart for this stock"
    //   "Add Alerts, Double tap to create alert for this stock"
    //   "SQUARE OFF" / "BUY MORE" - looked at, never tapped.
    // All are clickable="false" Buttons (merged Compose semantics) - tapped on their bounds.
    static get DETAIL_BUTTONS() {
        return {
            priceBreakdown: /^Price Breakdown\b/i,
            viewChart: /^View Chart\b/i,
            addAlerts: /^Add Alerts\b/i,
            squareOff: /^SQUARE OFF$/i,
            buyMore: /^BUY MORE$/i,
            // Only on some symbols. On a Quote it reads "Option chain Button, Double tap to open the
            // option chain." - not captured on this sheet yet, so matched loosely.
            optionChain: /^Option chains?\b/i,
            // An MTF holding shows NRML / MTF Square Off instead of the plain SQUARE OFF - labels
            // not captured yet, so matched on both words in either order.
            nrmlSquareOff: /\bNRML\b.*\bSQUARE ?OFF\b|\bSQUARE ?OFF\b.*\bNRML\b/i,
            mtfSquareOff: /\bMTF\b.*\bSQUARE ?OFF\b|\bSQUARE ?OFF\b.*\bMTF\b/i,
        };
    }

    // Keys whose button only opens an Order Pad (never places anything by itself).
    static get ORDER_PAD_BUTTONS() { return ['squareOff', 'buyMore', 'nrmlSquareOff', 'mtfSquareOff']; }

    // Option Chain screen: its "Strike Price" column header (same signal as MarketsPage.openOptionChain).
    async isOptionChainOpen(timeout = 15000) {
        return this.isElementVisible('android=new UiSelector().description("Strike Price")', timeout);
    }

    async getHoldingDetailButtons() {
        const nodes = await this.getDescribedElements();
        const out = {};
        for (const [key, re] of Object.entries(PortfolioPage.DETAIL_BUTTONS)) out[key] = nodes.some(n => re.test(n.desc.trim()));
        return out;
    }

    // Taps one of the detail sheet's buttons by key ('priceBreakdown' / 'viewChart' / 'addAlerts').
    // SQUARE OFF / BUY MORE only open the SELL / BUY Order Pad - nothing is placed until the pad's
    // own SELL / BUY and then CONFIRM are tapped, which nothing here does - but they still need an
    // explicit { opensOrderPad: true } so they're never hit by accident.
    async tapHoldingDetailButton(key, { opensOrderPad = false } = {}) {
        if (PortfolioPage.ORDER_PAD_BUTTONS.includes(key) && !opensOrderPad) throw new Error(`Refusing to tap ${key} without opensOrderPad: true`);
        const re = PortfolioPage.DETAIL_BUTTONS[key];
        const node = (await this.getDescribedElements()).find(n => re.test(n.desc.trim()));
        if (!node) return false;
        await this.tapNode(node);
        await this.pause(1500);
        return true;
    }

    // Every label on screen (content-desc and text), with bounds - WebView / dialog content can
    // expose either one.
    async getAllLabels() {
        return [
            ...(await this.getDescribedElements()).map(n => ({ ...n, label: n.desc.trim() })),
            ...(await this.getTextElements()).map(n => ({ ...n, label: n.text.trim() })),
        ].filter(n => n.label);
    }

    // A Close control (content-desc or text "Close..." / "...Double tap to close..." / "X"), or null.
    async findCloseControl() {
        const labels = await this.getAllLabels();
        return labels.find(n => /^close\b/i.test(n.label))
            || labels.find(n => /double tap to close/i.test(n.label))
            || labels.find(n => /^(x|✕|×)$/i.test(n.label))
            || null;
    }

    // Taps Close (back when no Close control is found). Returns 'close' / 'back'.
    async tapCloseOrBack() {
        const close = await this.findCloseControl();
        if (close) await this.tapNode(close); else await this.driver.back();
        await this.pause(1500);
        return close ? `close ("${close.label.split('\n')[0]}")` : 'back (no Close control found)';
    }

    // ---- Price Breakdown ----
    // Live (ui_dumps/portfolio_price_breakdown.xml, 2026-11-23): title "Price Breakdown - B2BSOFT",
    // header cells "Date" / "Qty" / "Price", and each row ONE merged label across the full width,
    // its cells separated by newlines: "18/11/2026\n1\n17.76". Close is an unlabelled clickable
    // ImageView left of the title ([48,219][84,255]). A per-cell table form is still handled.
    async isPriceBreakdownOpen(timeout = 6000) {
        try {
            await this.driver.waitUntil(async () => !!(await this.readPriceBreakdown()).headers.date, { timeout, interval: 500 });
            return true;
        } catch (_) {
            return false;
        }
    }

    async readPriceBreakdown() {
        const labels = await this.getAllLabels();
        const header = re => labels.find(n => re.test(n.label));
        const title = labels.find(n => /^Price Breakdown\s*-/i.test(n.label));
        const headers = {
            date: header(/^date$/i),
            qty: header(/^(qty|quantity)\.?$/i),
            price: header(/^(price|avg\.? price|average price|buy price)$/i),
        };
        const headerY2 = Math.max(...Object.values(headers).filter(Boolean).map(n => n.y2), 0);
        const rows = [];
        // Merged row: "date\nqty\nprice" below the header row.
        for (const n of labels) {
            if (n.y1 < headerY2 - 2) continue;
            const parts = n.label.split('\n').map(p => p.trim()).filter(Boolean);
            if (parts.length === 3 && /\d/.test(parts[0]) && /^\d+$/.test(parts[1])) rows.push({ date: parts[0], qty: parts[1], price: parts[2] });
        }
        // Per-cell table: cells grouped into rows by y, mapped by x to the nearest header column.
        if (!rows.length && headers.date && headers.qty && headers.price) {
            const cols = Object.entries(headers).map(([k, n]) => ({ k, cx: (n.x1 + n.x2) / 2 }));
            const cells = labels.filter(n => n.y1 >= headerY2 - 2 && !Object.values(headers).includes(n));
            const byRow = [];
            for (const c of cells.sort((a, b) => a.y1 - b.y1)) {
                const row = byRow.find(r => Math.abs(r.y - c.y1) <= 20);
                if (row) row.cells.push(c); else byRow.push({ y: c.y1, cells: [c] });
            }
            for (const r of byRow) {
                const row = {};
                for (const c of r.cells) {
                    const cx = (c.x1 + c.x2) / 2;
                    const col = cols.reduce((best, col) => (Math.abs(col.cx - cx) < Math.abs(best.cx - cx) ? col : best));
                    row[col.k] = row[col.k] ? `${row[col.k]} ${c.label}` : c.label;
                }
                if (row.date || row.qty || row.price) rows.push(row);
            }
        }
        return {
            title: title ? title.label : null,
            headers: { date: !!headers.date, qty: !!headers.qty, price: !!headers.price },
            rows,
        };
    }

    // Every node in the page source - labelled or not - as { cls, desc, text, rid, clickable, x1..y2 }.
    async getAllNodes() {
        const src = await this.driver.getPageSource();
        const dec = s => String(s || '').replace(/&#10;/g, '\n').replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&');
        return (src.match(/<[\w.]+[^>]*>/g) || []).map(tag => {
            const b = tag.match(/bounds="\[(-?\d+),(-?\d+)\]\[(-?\d+),(-?\d+)\]"/);
            if (!b) return null;
            const attr = a => { const m = tag.match(new RegExp(`\\s${a}="([^"]*)"`)); return m ? dec(m[1]) : ''; };
            return {
                cls: (tag.match(/^<([\w.]+)/) || [])[1], desc: attr('content-desc'), text: attr('text'), rid: attr('resource-id'),
                clickable: attr('clickable') === 'true', x1: +b[1], y1: +b[2], x2: +b[3], y2: +b[4],
            };
        }).filter(Boolean);
    }

    // Price Breakdown's Close: the clickable, unlabelled icon on the title's row, left of the title.
    async tapPriceBreakdownClose() {
        const nodes = await this.getAllNodes();
        const title = nodes.find(n => /^Price Breakdown\s*-/i.test(n.desc));
        const close = title && nodes.find(n => n.clickable && !n.desc && !n.text && n.x2 <= title.x1 && n.y1 < title.y2 && n.y2 > title.y1);
        if (!close) return false;
        await this.tapNode(close);
        await this.pause(1500);
        return true;
    }

    // ---- View Chart (web page) ----
    // Live (ui_dumps/portfolio_view_chart.xml, 2026-11-23): an android.webkit.WebView from y=290 to
    // the bottom, laid OVER the holding detail sheet (whose nodes stay in the tree behind it). Inside
    // it the chart header is a TextView with the symbol and change ("VISL <zero-width spaces> ▲ 0.18")
    // immediately followed by the company name, resource-id "sym-detail" ("B2B SOFTWARE
    // TECHNOLOGIES LTD."). Above the WebView: an unlabelled clickable top-left ([0,136][154,290]) -
    // the Close - then an unlabelled icon, and "B" / "S" (chart Buy / Sell, never tapped).
    static get WEBVIEW() { return 'android=new UiSelector().className("android.webkit.WebView")'; }

    // NB: the header symbol TextView's accessibility text is stale - live 2026-11-23 it read "VISL"
    // across runs while the screen showed "B2BSOFT BSE" - so check `company` (which does update)
    // with symbolMatchesCompany, not headerSymbol.
    //
    // Does `company` (e.g. "B2B SOFTWARE TECHNOLOGIES LTD.") belong to `symbol` (e.g. "B2BSOFT")?
    // Letters/digits only, case-insensitive: the symbol inside the company name, or its characters
    // in order within it ("TCS" in "TATA CONSULTANCY SERVICES").
    static symbolMatchesCompany(symbol, company) {
        const s = String(symbol || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
        const c = String(company || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
        if (!s || !c) return false;
        if (c.includes(s)) return true;
        let i = 0;
        for (const ch of c) if (ch === s[i]) i++;
        return i === s.length && c[0] === s[0];
    }

    async saveScreenshot(name) {
        try {
            const file = path.join(__dirname, '..', 'ui_dumps', `${name}.png`);
            fs.mkdirSync(path.dirname(file), { recursive: true });
            await this.driver.saveScreenshot(file);
            console.log(`Saved screenshot: ui_dumps/${name}.png`);
        } catch (e) {
            console.log(`Could not save screenshot ${name}: ${e.message}`);
        }
    }

    // Waits `waitMs` for the chart to load, then reads it: { webView, headerSymbol, headerText, company }.
    // The WebView's accessibility tree fills in late: live 2026-11-23 a page source taken right after
    // the 10s wait had no WebView content at all, and one taken a moment later had it - so the read
    // is retried (up to `settleMs`) until the company line ("sym-detail") is there.
    async readChartPage(waitMs = 10000, settleMs = 5000) {
        await this.pause(waitMs);
        const webView = await this.isElementVisible(PortfolioPage.WEBVIEW, 2000);
        let nodes = await this.getAllNodes();
        for (const end = Date.now() + settleMs; !nodes.some(n => n.rid === 'sym-detail') && Date.now() < end;) {
            await this.pause(500);
            nodes = await this.getAllNodes();
        }
        const i = nodes.findIndex(n => n.rid === 'sym-detail');
        const company = i >= 0 ? nodes[i].text.trim() : null;
        const head = i > 0 ? nodes.slice(0, i).reverse().find(n => n.text.trim()) : null;
        const headerText = head ? head.text.replace(/[​\s]+/g, ' ').trim() : null;
        const headerSymbol = headerText ? headerText.split(/[\s▲▼]/)[0] : null;
        return { webView, headerSymbol, headerText, company };
    }

    // The chart's Close: the clickable, unlabelled node at the top-left above the WebView.
    async tapChartClose() {
        const nodes = await this.getAllNodes();
        const wv = nodes.find(n => n.cls === 'android.webkit.WebView');
        const top = wv ? wv.y1 : 300;
        const close = nodes.find(n => n.clickable && !n.desc && !n.text && n.x1 < 200 && n.y2 <= top + 2 && n.y1 > 100);
        if (!close) return false;
        await this.tapNode(close);
        await this.pause(1500);
        return true;
    }

    // ---- Set Alert screen (Regression log, 2026-11-19) ----
    //   "Back, Double tap to go back" | "Set Alert" | "TCS" | "TATA CONSULTANCY SERV LT" |
    //   "Last traded price for TCS: 2,354.70, change is -24.80 (-1.04 percent)., ..." |
    //   "Alert me if" ... "Create Alert, Double tap to set alert" (never tapped here).
    async readSetAlertScreen(timeout = 8000) {
        try {
            await this.driver.waitUntil(async () => (await this.getDescribedElements()).some(n => n.desc.trim() === 'Set Alert'), { timeout, interval: 500 });
        } catch (_) {
            return { open: false };
        }
        const descs = (await this.getDescribedElements()).map(n => n.desc.trim());
        const ltp = descs.find(d => /^Last traded price for /i.test(d));
        const ltpSymbol = ltp ? (ltp.match(/^Last traded price for\s+(.+?):/i) || [])[1] : null;
        return {
            open: true,
            descs,
            ltpSymbol: ltpSymbol ? ltpSymbol.trim() : null,
            createAlertShown: descs.some(d => /^Create Alert\b/i.test(d)),
        };
    }

    // Back from Set Alert: its own Back button, else the system back.
    async leaveSetAlertScreen() {
        const back = (await this.getDescribedElements()).find(n => /^Back, Double tap to go back/i.test(n.desc));
        if (back) await this.tapNode(back); else await this.driver.back();
        await this.pause(1500);
    }

    // ---- Holding -> Quote (half / full) ----
    // Half quote: the Quote's summary card "Stock IDEA, NSE. Last traded price..." or its "Swipe up
    // for Stock Details" handle, without the tab strip. Full quote: the "Overview\nTab 1 of N" tab
    // strip (same signal as BasePage.isQuoteExpanded). Returns 'full' / 'half' / 'details' (the
    // holding detail sheet) / null.
    // Live (ui_dumps/portfolio_quote_half.xml, 2026-11-23): the half Quote is the holding popup
    // pulled up to mid-screen ("Stock details:" at y≈678 instead of ≈1362) with the Quote's own
    // content now under it - "Pr. Close. 17.82., ..." / Open / High / Low, the Bid / Ask depth,
    // "Total Buy Qty. ..." - and no summary card or tab strip yet. The popup alone has none of that.
    async getQuoteState(symbol) {
        if (await this.isQuoteExpanded()) return 'full';
        const descs = (await this.getDescribedElements()).map(n => n.desc.trim());
        const sym = symbol.toUpperCase();
        const quoteContent = descs.some(d => /^(Pr\. Close|Open|High|Low)\. .*Displays the/i.test(d) || /^Total (Buy|Sell) Qty\./i.test(d));
        const details = descs.some(d => /^Stock details:/i.test(d));
        if (details && quoteContent) return 'half';
        if (descs.some(d => d.toUpperCase().startsWith(`STOCK ${sym},`) || d === 'Swipe up for Stock Details' || /Swipe up to explore quote details/i.test(d))) return 'half';
        if (details) return 'details';
        return null;
    }

    // One upward drag on whatever sheet is showing: from its top-most content (the holding sheet's
    // "Stock details", the Quote's handle / summary card) to near the top of the screen.
    async swipeUpSheet() {
        const { width, height } = await this.driver.getWindowSize();
        const nodes = await this.getDescribedElements();
        const grip = nodes.find(n => n.desc === 'Swipe up for Stock Details')
            || nodes.find(n => /^Stock (details:|\S+, )/i.test(n.desc))
            || null;
        const x = grip ? Math.round((grip.x1 + grip.x2) / 2) : Math.floor(width / 2);
        const startY = grip ? Math.round((grip.y1 + grip.y2) / 2) : Math.floor(height * 0.6);
        await this.driver.action('pointer', { parameters: { pointerType: 'touch' } })
            .move({ duration: 0, x, y: startY })
            .down()
            .pause(150)
            .move({ duration: 600, x, y: Math.floor(height * 0.08) })
            .up()
            .perform();
        await this.pause(1500);
    }

    // Holding popup -> half Quote. A full-height drag goes straight past half to the full Quote
    // (live 2026-11-23), so this drags up in short steps (a quarter of the screen each, from the
    // sheet's top content) until the state leaves 'details'. Returns the state reached:
    // 'half' (wanted), 'full' (overshot), or whatever is left after `maxSteps`.
    async swipeUpToHalfQuote(symbol, maxSteps = 3) {
        const { width, height } = await this.driver.getWindowSize();
        let state = await this.getQuoteState(symbol);
        for (let i = 0; i < maxSteps && state !== 'half' && state !== 'full'; i++) {
            const nodes = await this.getDescribedElements();
            const grip = nodes.find(n => /^Stock details:/i.test(n.desc)) || nodes.find(n => n.desc === 'Swipe up for Stock Details');
            const x = grip ? Math.round((grip.x1 + grip.x2) / 2) : Math.floor(width / 2);
            const startY = grip ? Math.round((grip.y1 + grip.y2) / 2) : Math.floor(height * 0.65);
            const endY = Math.max(startY - Math.floor(height * 0.25), Math.floor(height * 0.3));
            await this.driver.action('pointer', { parameters: { pointerType: 'touch' } })
                .move({ duration: 0, x, y: startY })
                .down()
                .pause(150)
                .move({ duration: 500, x, y: endY })
                .up()
                .perform();
            await this.pause(1500);
            state = await this.getQuoteState(symbol);
        }
        return state;
    }

    // Back presses until the Holdings list (Portfolio tabs) is on screen.
    async backToHoldings(maxPresses = 4) {
        for (let i = 0; i < maxPresses; i++) {
            if (await this.isOnPortfolio(1500)) return true;
            await this.driver.back();
            await this.pause(1000);
        }
        return this.isOnPortfolio(2000);
    }

    // Back out of the detail sheet to the Holdings list.
    async closeHoldingDetails() {
        for (let i = 0; i < 2; i++) {
            await this.driver.back();
            await this.pause(800);
            if (await this.isOnPortfolio(2000)) return true;
        }
        return false;
    }

    // ---- Holdings search bar (EditText, hint "Search for Stocks") ----

    async findHoldingsSearchBar() {
        const el = await this.driver.$('android=new UiSelector().className("android.widget.EditText")');
        return (await el.isExisting()) ? el : null;
    }

    async getHoldingsSearchText() {
        const el = await this.findHoldingsSearchBar();
        if (!el) return null;
        const text = (await el.getAttribute('text')) || '';
        return /^search for/i.test(text) ? '' : text;
    }

    async hideKeyboardIfShown() {
        try {
            if (await this.driver.isKeyboardShown()) {
                await this.driver.hideKeyboard();
                await this.pause(500);
            }
        } catch (_) { /* no keyboard */ }
    }

    // While searching (ui_dumps/portfolio_holdings_search.xml, 2026-11-23) the bar has two buttons:
    //   "Clear Search, Double tap to clear search text" - the x inside the bar, empties the text;
    //   "Cancel Search, Double tap to exit search"      - the Cancel beside it, leaves search mode.
    // Both report clickable="false" (merged Compose semantics), so a click() that leaves the button
    // in place is followed by a tap on its bounds.
    async isHoldingsSearchClearShown() { return this.isElementVisible(this.searchClearButton, 1000); }
    async isHoldingsSearchCancelShown() { return this.isElementVisible(this.searchCancelButton, 1000); }

    async tapHoldingsSearchClear() { return this.tapSearchButton(this.searchClearButton, 'Clear Search'); }
    async tapHoldingsSearchCancel() { return this.tapSearchButton(this.searchCancelButton, 'Cancel Search'); }

    // Clicks the button found by `selector`; returns false when it isn't on screen.
    async tapSearchButton(selector, name) {
        const el = await this.driver.$(selector);
        if (!(await el.isExisting())) return false;
        const { x, y } = await el.getLocation();
        const { width, height } = await el.getSize();
        await el.click();
        await this.pause(1000);
        // Clear Search stays on screen only while there's text; Cancel Search goes away entirely.
        const stillThere = name === 'Cancel Search'
            ? await this.isHoldingsSearchCancelShown()
            : (await this.getHoldingsSearchText()) !== '';
        if (stillThere) {
            await this.tapNode({ x1: x, y1: y, x2: x + width, y2: y + height });
            await this.pause(1000);
        }
        return true;
    }

    // Taps the search bar and types `query` key by key (real key events - Compose fields can
    // accept setValue() without the app seeing it). Returns { opened, text }. `hideKeyboard:
    // false` leaves the keyboard (and any focus-only Cancel button) up.
    async searchHoldings(query, { hideKeyboard = true } = {}) {
        const el = await this.findHoldingsSearchBar();
        if (!el) return { opened: false, text: null };
        await el.click();
        await this.pause(800);
        let opened = false;
        try { opened = await this.driver.isKeyboardShown(); } catch (_) { /* unknown */ }
        for (const ch of query) {
            await this.driver.keys(ch);
            await this.pause(60);
        }
        await this.pause(1200);
        const text = await this.getHoldingsSearchText();
        if (hideKeyboard) await this.hideKeyboardIfShown();
        return { opened, text };
    }

    // Empties the search bar (End + backspaces) so the full list is back.
    async clearHoldingsSearch() {
        let text = await this.getHoldingsSearchText();
        for (let attempt = 0; attempt < 3 && text; attempt++) {
            const el = await this.findHoldingsSearchBar();
            if (!el) break;
            await el.click();
            await this.pause(500);
            await this.driver.pressKeyCode(123); // KEYCODE_MOVE_END
            for (let i = 0; i < text.length; i++) {
                await this.driver.pressKeyCode(67); // KEYCODE_DEL
                await this.pause(40);
            }
            await this.pause(800);
            text = await this.getHoldingsSearchText();
        }
        await this.hideKeyboardIfShown();
        return text === '';
    }

    // ---- shared ----

    async collectRows(readRows, maxScrolls) {
        const seen = new Set(await readRows());
        let scrolls = 0;
        for (; scrolls < maxScrolls; scrolls++) {
            const before = seen.size;
            await this.swipe('down');
            await this.pause(700);
            (await readRows()).forEach(r => seen.add(r));
            if (seen.size === before) break;
        }
        for (let i = 0; i <= scrolls; i++) {
            await this.swipe('up');
            await this.pause(400);
        }
        return [...seen];
    }

    async dumpPageSource(name) {
        try {
            const src = await this.driver.getPageSource();
            const file = path.join(__dirname, '..', 'ui_dumps', `${name}.xml`);
            fs.mkdirSync(path.dirname(file), { recursive: true });
            fs.writeFileSync(file, src);
            console.log(`Saved UI dump: ui_dumps/${name}.xml`);
        } catch (e) {
            console.log(`Could not save UI dump ${name}: ${e.message}`);
        }
    }
}

module.exports = PortfolioPage;
