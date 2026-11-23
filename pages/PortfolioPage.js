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
