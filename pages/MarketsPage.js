const BasePage = require('./BasePage');
const { isResultRow, parseResultRow } = require('./ResultsPage');

// High Return Achievers sub-tabs and its return-period dropdown options, in on-screen order
// (verified live).
const HRA_TABS = ['Large Cap', 'Mid Cap', 'Small Cap'];
const HRA_PERIODS = ['1 Month', '6 Month', '1 Year', '3 Year'];
const HRA_PERIOD_RE = /^\d+ (Month|Year)s?$/;

// Each High Return Achievers row is one node: " MEESHO. Company profit 0.0 percent. Last traded
// price 232.74. One year return 10.01 percent., Double tap to view MEESHO details." The row always
// says "One year return", whichever period is selected, so the period is read from the pill instead.
const isHraRow = desc => desc.includes('Company profit') && desc.includes('Double tap to view');

// Stock In Range price-range tabs ("Under 100\nTab 1 of 4", ...) in on-screen order, with the
// last traded price range each one lists (verified live). Bounds are inclusive.
const SIR_TABS = [
    { label: 'Under 100', min: 0, max: 100 },
    { label: '100-500', min: 100, max: 500 },
    { label: '500-1000', min: 500, max: 1000 },
    { label: '1000-2000', min: 1000, max: 2000 },
];
// Its rows read like the movers rows: " TERAI. TERAI TEA CO. LTD.. Last traded price 140.01. Change
// 23.33. ..., Double tap to view TERAI details, or swipe right for next category".
const isSirRow = desc => desc.includes('Last traded price') && desc.includes('Double tap to view');
// Stocks You Viewed Recently cards on Markets read " IDEA. Last traded price 12.80. ...\nIDEA \n12.80..."
// (" NIFTY 13OCT 22750 CE. Last traded price ..." for a contract) - unlike the other sections' rows,
// with no "Double tap to view".
const isRecentCard = desc => desc.includes('\n') && !desc.includes('Double tap to view') && /^\s*\S.*?\. Last traded price/.test(desc);

// Left-to-right order of the "Trading Tools & Products" quick-access row (verified live). The row
// is a horizontal scroller that keeps its scroll offset between visits, so any one of these can be
// off-screen at either edge - the order tells revealTile() which way to swipe for a missing tile.
const TILE_ORDER = ['AI Algo', 'NxtOption', 'IPO', 'Mutual Funds', 'Basket'];

class MarketsPage extends BasePage {
    constructor(driver) {
        super(driver);
        // Same bottom-nav icon shape as WatchlistIndexPage's own nav buttons (a plain ImageView
        // whose content-desc is just the tab name, no "Tab N of M" suffix).
        this.marketNavButton = 'android=new UiSelector().className("android.widget.ImageView").description("Market")';

        // Equity is the default, left-most segment tab ("Equity\nTab 1 of 4"). Matched on the
        // full tab shape rather than descriptionContains("Equity") - News has its own "Equity"
        // tab ("Tab 4 of 8") and movers/news rows can mention the word too.
        this.equityTab = '//*[starts-with(@content-desc,"Equity") and contains(@content-desc,"Tab 1 of")]';
        this.equityTabLoaded = this.equityTab;

        // First section under the segment tabs on Equity. Its heading also appears as the title of
        // the "See all" Market Movers screen, which is told apart by that screen's Back button.
        this.marketMoversTitle = 'android=new UiSelector().description("Market Movers")';
        // Compose merges each "See all" label with its own "Double tap to..." hint into one
        // content-desc, so these match on the leading part only.
        this.seeAllMarketMovers = 'android=new UiSelector().descriptionStartsWith("See all Market Movers")';
        this.seeAllNews = 'android=new UiSelector().descriptionStartsWith("See all News")';
        this.seeAllCorporateAction = 'android=new UiSelector().descriptionStartsWith("See all Corporate Action")';
        this.seeAllResults = 'android=new UiSelector().descriptionStartsWith("See all Results")';
        this.seeAllHighReturnAchievers = 'android=new UiSelector().descriptionStartsWith("See all High Return Achievers")';
        this.highReturnAchieversTitle = 'android=new UiSelector().description("High Return Achievers")';
        this.seeAllStockInRange = 'android=new UiSelector().descriptionStartsWith("See all Stock In Range")';
        this.stockInRangeTitle = 'android=new UiSelector().description("Stock In Range")';
        this.backButton = 'android=new UiSelector().description("Back, Double tap to go back")';

        // Global search bar under the index ticker - a Button with no content-desc, only the hint
        // "Search Globe" (verified live). It opens the search screen, whose field is that screen's
        // first Button (hint "Add or search stocks", dropped once text is typed) - same as
        // BasketPage.searchField - with "Cancel" beside it.
        this.globalSearchBar = '//android.widget.Button[@hint="Search Globe"]';
        this.searchField = 'android=new UiSelector().className("android.widget.Button").instance(0)';
        this.searchCancelButton = 'android=new UiSelector().description("Cancel")';
        this.seeAllRecentlyViewed = 'android=new UiSelector().descriptionStartsWith("See all Stocks You Viewed Recently")';
        this.recentlyViewedTitle = 'android=new UiSelector().description("Stocks You Viewed Recently")';

        // Each movers row is one content-desc (" SYMBOL. COMPANY. Last traded price ..., Double tap
        // to view SYMBOL details, or swipe right for next category"). The index ticker above
        // ("...or swipe right for more options") never says "next category", so this skips it.
        this.moversRow = '//*[contains(@content-desc,"Double tap to view") and contains(@content-desc,"next category")]';

        // The Basket tile opens Orders on its "Basket" tab ("Basket\nTab 2 of 2"), which shows one
        // of two states: the saved baskets, each "NAME\nCreated on 21st September 2026\n1 items >"
        // (verified live), or - with none created - the message "Basket order is Empty". The "New
        // Basket" button shows in both states, so it doesn't count as content.
        this.basketTab = '//*[starts-with(@content-desc,"Basket") and contains(@content-desc,"Tab ")]';
        this.basketRow = '//*[contains(@content-desc,"Created on") and contains(@content-desc,"items")]';
        this.noBasketMessage = '//*[contains(@content-desc,"Basket order is Empty") or contains(@text,"Basket order is Empty")]';
    }

    async clickMarketNavButton(timeout = 8000) {
        await this.click(this.marketNavButton, timeout);
        console.log('Clicked Market bottom navigation button');
    }

    // Waits up to `timeout` for the Markets screen to land on its default Equity segment tab.
    async waitForEquityLoaded(timeout = 10000) {
        const loaded = await this.isElementVisible(this.equityTabLoaded, timeout);
        console.log(loaded ? 'Markets screen loaded on Equity tab within wait time' : `Markets screen did not load within ${timeout}ms`);
        return loaded;
    }

    // The segment tab carries a real selected="true" attribute (verified live), unlike most Compose
    // controls here, so the default selection can be checked directly.
    async isEquityTabSelected() {
        try {
            const el = await this.driver.$(this.equityTab);
            const selected = (await el.getAttribute('selected')) === 'true';
            console.log(`Equity tab selected by default: ${selected ? 'PASS' : 'FAIL'}`);
            return selected;
        } catch (_) {
            console.log('Equity tab selected by default: FAIL (Equity tab not found)');
            return false;
        }
    }

    // The Equity page keeps its vertical scroll offset between visits, so "the first field" is
    // only meaningful after scrolling back to the top.
    async scrollToTop() {
        await this.scrollToBoundaryByMovement('up', { maxScrolls: 15 });
    }

    // Returns the content-desc of the first element directly below the segment tab row - i.e. the
    // heading of the first section on the Equity page.
    async getFirstSectionTitle() {
        const nodes = await this.getDescribedElements();
        const equity = nodes.find(n => /^Equity\nTab 1 of \d+$/.test(n.desc));
        if (!equity) return null;
        // Elements on one row can differ by a pixel or two in y (the "Market Movers" heading sits
        // 1px below its own "See all"), so rows are compared with a tolerance, then left-to-right.
        const below = nodes.filter(n => n.y1 >= equity.y2);
        if (!below.length) return null;
        const topY = Math.min(...below.map(n => n.y1));
        const first = below.filter(n => n.y1 - topY <= 15).sort((a, b) => a.x1 - b.x1)[0];
        return first.desc.trim();
    }

    // Taps the first row of the currently selected Market Movers list and returns its symbol.
    async tapFirstMarketMover(timeout = 8000) {
        let rows = [];
        await this.driver.waitUntil(async () => {
            rows = await this.driver.$$(this.moversRow);
            return rows.length > 0;
        }, { timeout, interval: 300 }).catch(() => {});
        if (!rows.length) {
            console.log('No symbols found in the Market Movers list');
            return null;
        }
        const desc = await rows[0].getAttribute('content-desc');
        const symbol = (desc.trim().match(/^([^.\s]+)\./) || [])[1] || null;
        console.log(`First Market Movers symbol: ${symbol} (${desc.trim().split(', Double tap')[0]})`);
        await rows[0].click();
        return symbol;
    }

    // A movers row opens the half-height Quote sheet, headed "Stock SYMBOL, EXCHANGE. Last traded...".
    async verifyQuoteOpened(symbol, timeout = 8000) {
        const sel = `android=new UiSelector().descriptionStartsWith("Stock ${symbol},")`;
        const opened = await this.isElementVisible(sel, timeout);
        console.log(`Quote screen opened for ${symbol}: ${opened ? 'PASS' : 'FAIL'}`);
        return opened;
    }

    // Visible Market Movers sub-tabs ("Top Gainers\nTab 1 of 6", ...) - those below the segment
    // tab row. Only gives what is currently on screen; `total` comes from the "of N" suffix.
    async getMoversTabs() {
        const nodes = await this.getDescribedElements();
        const equity = nodes.find(n => /^Equity\nTab 1 of \d+$/.test(n.desc));
        const minY = equity ? equity.y2 : 0;
        return nodes
            .filter(n => n.y1 >= minY)
            .map(n => n.desc.match(/^(.+)\nTab (\d+) of (\d+)$/))
            .filter(Boolean)
            .map(m => ({ label: m[1], index: Number(m[2]), total: Number(m[3]) }));
    }

    // The sub-tab row keeps its scroll offset between visits (e.g. left on "Most Active by Value",
    // with Tab 1-3 out of the tree) and ignores swipes - so it is rewound by tapping the left-most
    // visible tab until Tab 1 is back, which also leaves Tab 1 (Top Gainers) selected.
    async rewindMoversTabs(maxTaps = 8) {
        for (let i = 0; i < maxTaps; i++) {
            const tabs = await this.getMoversTabs();
            if (!tabs.length) break;
            const first = tabs.reduce((a, b) => (b.index < a.index ? b : a));
            await (await this.driver.$(`(//*[contains(@content-desc,"Tab ${first.index} of ${first.total}")])[last()]`)).click();
            await this.pause(800);
            if (first.index === 1) {
                console.log('Market Movers tab row rewound to "Top Gainers"');
                return true;
            }
        }
        console.log('Could not rewind the Market Movers tab row to Tab 1');
        return false;
    }

    // Taps sub-tab `index` of `total`. The tab row is click-only (swiping it does nothing), but
    // tapping a tab scrolls its neighbour into the tree - so tapping 1..N in order reaches every
    // tab. [last()] skips the segment tabs, which come earlier in the tree, should both share N.
    async clickMoversTab(index, total, timeout = 5000) {
        const sel = `(//*[contains(@content-desc,"Tab ${index} of ${total}")])[last()]`;
        const el = await this.driver.$(sel);
        try {
            await el.waitForDisplayed({ timeout });
        } catch (_) {
            console.log(`Market Movers tab ${index} of ${total} not found: FAIL`);
            return null;
        }
        const label = (await el.getAttribute('content-desc')).split('\n')[0];
        // A tap can land while the row is still sliding from the previous tab (seen live on the
        // 12-tab "See all" row) and select nothing - and then the next tabs never scroll into the
        // tree. So the tab is re-found and tapped again until it reports selected.
        let selected = false;
        for (let attempt = 1; attempt <= 3 && !selected; attempt++) {
            await (await this.driver.$(sel)).click();
            await this.pause(1500);
            selected = (await (await this.driver.$(sel)).getAttribute('selected')) === 'true';
            if (!selected && attempt < 3) console.log(`Market Movers "${label}" tab not selected after tap ${attempt} - tapping again`);
        }
        const rows = await this.driver.$$(this.moversRow);
        const firstDesc = rows.length ? await rows[0].getAttribute('content-desc') : '';
        const firstSymbol = (firstDesc.trim().match(/^([^.\s]+)\./) || [])[1] || null;
        // An empty category (e.g. Upper Circuit, All Time Low on "See all") shows "No Data Found!".
        const noData = !rows.length && await this.isElementVisible('android=new UiSelector().description("No Data Found!")', 500);
        console.log(`Market Movers "${label}" tab - selected: ${selected ? 'PASS' : 'FAIL'} | symbols listed: ${rows.length}${firstSymbol ? ` (first: ${firstSymbol})` : ''}${noData ? ' - "No Data Found!" shown' : ''}`);
        return { label, selected, rowCount: rows.length, firstSymbol, noData };
    }

    async clickSeeAllMarketMovers(timeout = 8000) {
        await this.click(this.seeAllMarketMovers, timeout);
        console.log('Clicked "See all" on Market Movers');
    }

    // The full Market Movers screen: "Market Movers" title + Back button, its own sub-tab row and
    // a longer symbol list. The Equity tab disappearing confirms it isn't still the Markets screen.
    async verifyMarketMoversScreenOpened(timeout = 8000) {
        const backVisible = await this.isElementVisible(this.backButton, timeout);
        const titleVisible = backVisible && await this.isElementVisible(this.marketMoversTitle, 2000);
        const leftMarkets = titleVisible && !(await this.isElementVisible(this.equityTab, 500));
        const rows = leftMarkets ? await this.driver.$$(this.moversRow) : [];
        const opened = leftMarkets && rows.length > 0;
        console.log(`Market Movers "See all" screen opened (${rows.length} symbols listed): ${opened ? 'PASS' : 'FAIL'}`);
        return opened;
    }

    async closeMarketMoversScreen(timeout = 5000) {
        await this.click(this.backButton, timeout);
        console.log('Clicked Back on the Market Movers screen');
    }

    // Scrolls down until the News section's "See all" button is on screen.
    async scrollToNews(maxScrolls = 8) {
        for (let i = 0; i <= maxScrolls; i++) {
            if (await this.isElementVisible(this.seeAllNews, 500)) {
                console.log('"News" section is now visible');
                return true;
            }
            if (i < maxScrolls) {
                await this.swipe('down');
                await this.pause(500);
            }
        }
        console.log(`Could not find "News" section after ${maxScrolls} scrolls`);
        return false;
    }

    async clickSeeAllNews(timeout = 8000) {
        await this.click(this.seeAllNews, timeout);
        console.log('Clicked "See all" on News');
    }

    // Small upward drag (content moves up ~25% of the screen) - BasePage.swipe moves ~40%, which can
    // carry a section heading straight past the sticky segment tabs in one go.
    async nudgeDown() {
        const { width, height } = await this.driver.getWindowSize();
        const x = Math.floor(width / 2);
        await this.driver.action('pointer', { parameters: { pointerType: 'touch' } })
            .move({ duration: 0, x, y: Math.floor(height * 0.6) })
            .down()
            .move({ duration: 600, x, y: Math.floor(height * 0.35) })
            .up()
            .perform();
        await this.pause(600);
    }

    // Scrolls until section `title`'s heading is below the sticky segment tabs and its first row
    // (the first node below the heading that satisfies `isRow`) is fully above the floating bottom
    // nav, then returns that row's node. Starts from the top: the page is long (Market Movers down
    // to FII/DII) and keeps its scroll offset between visits.
    async scrollToSection(title, isRow, maxScrolls = 15) {
        await this.scrollToTop();
        const { height } = await this.driver.getWindowSize();
        for (let i = 0; i <= maxScrolls; i++) {
            const nodes = await this.getDescribedElements();
            const tabsBottom = (nodes.find(n => /^Equity\nTab 1 of \d+$/.test(n.desc)) || { y2: 0 }).y2;
            const navTop = (nodes.find(n => n.desc === 'Watchlist') || { y1: Math.floor(height * 0.87) }).y1;
            const heading = nodes.find(n => n.desc === title);
            const firstRow = heading && nodes.find(n => n.y1 >= heading.y2 && isRow(n.desc));
            if (heading && firstRow && heading.y1 >= tabsBottom && firstRow.y2 <= navTop) {
                console.log(`"${title}" section is now visible`);
                return firstRow;
            }
            if (i === maxScrolls) break;
            // Overshot (heading tucked under the sticky tabs) - nudge back the other way.
            if (heading && heading.y1 < tabsBottom) await this.swipe('up');
            else await this.nudgeDown();
        }
        console.log(`Could not bring the "${title}" section on screen after ${maxScrolls} scrolls`);
        return null;
    }

    // Each corporate action row on Markets is its own node: "Corporate action type STOCK SPLIT.
    // company name ... Ex date ...".
    async scrollToCorporateAction() {
        return this.scrollToSection('Corporate Action', d => d.startsWith('Corporate action type'));
    }

    // Each Results row is its own node: " KANOHAR. date 06 Oct 2026. Last traded price ..., Double
    // tap to view KANOHAR details, ..." - the result date sits under the symbol name on screen.
    async scrollToResults() {
        return this.scrollToSection('Results', d => isResultRow(d));
    }

    // Taps the first symbol listed under Results and returns { symbol, date }.
    async tapFirstResult() {
        const row = await this.scrollToResults();
        if (!row) return null;
        const result = parseResultRow(row.desc);
        await this.tapNode(row);
        console.log(`Tapped first Results symbol: ${result.symbol} (result date ${result.dateText})`);
        return result;
    }

    async clickSeeAllResults(timeout = 8000) {
        if (!(await this.isElementVisible(this.seeAllResults, 1000))) await this.scrollToResults();
        await this.click(this.seeAllResults, timeout);
        console.log('Clicked "See all" on Results');
    }

    // Taps the first corporate action listed on Markets and returns its type/company.
    async tapFirstCorporateAction() {
        const row = await this.scrollToCorporateAction();
        if (!row) return null;
        const m = row.desc.match(/Corporate action type ([^.]+)\. company name (.+?)(?:Rs\.|Ratio|\. Ex date)/) || [];
        await this.tapNode(row);
        console.log(`Tapped first corporate action: ${m[1] || '?'} - ${m[2] ? m[2].trim() : '?'}`);
        return { type: m[1] || null, company: m[2] ? m[2].trim() : null };
    }

    async clickSeeAllCorporateAction(timeout = 8000) {
        if (!(await this.isElementVisible(this.seeAllCorporateAction, 1000))) await this.scrollToCorporateAction();
        await this.click(this.seeAllCorporateAction, timeout);
        console.log('Clicked "See all" on Corporate Action');
    }

    async scrollToHighReturnAchievers() {
        return this.scrollToSection('High Return Achievers', isHraRow);
    }

    // Rows currently listed under High Return Achievers, as { symbol, desc }.
    async getHraRows() {
        const nodes = await this.getDescribedElements();
        return nodes
            .filter(n => isHraRow(n.desc))
            .map(n => {
                const num = re => { const m = n.desc.match(re); return m ? Number(m[1]) : null; };
                return {
                    symbol: (n.desc.trim().match(/^([^.\s]+)\./) || [])[1] || null,
                    ltp: num(/Last traded price (-?\d+(?:\.\d+)?)/),
                    oneYearReturn: num(/One year return (-?\d+(?:\.\d+)?) percent/),
                    desc: n.desc,
                };
            });
    }

    // One string per listed row ("MEESHO:10.01|VBL:6.48|...") - compared before/after a period
    // change to tell whether the list actually reloaded.
    hraSnapshot(rows) {
        return rows.map(r => `${r.symbol}:${r.oneYearReturn}`).join('|');
    }

    async clickSeeAllHighReturnAchievers(timeout = 8000) {
        if (!(await this.isElementVisible(this.seeAllHighReturnAchievers, 1000))) await this.scrollToHighReturnAchievers();
        await this.click(this.seeAllHighReturnAchievers, timeout);
        console.log('Clicked "See all" on High Return Achievers');
    }

    // The full High Return Achievers screen: X (Back) button + "High Return Achievers" title, the
    // same Large/Mid/Small Cap tabs and period pill, and a longer list (verified live). The Equity
    // tab disappearing confirms it isn't still the Markets screen.
    async verifyHraSeeAllOpened(timeout = 8000) {
        const backVisible = await this.isElementVisible(this.backButton, timeout);
        const titleVisible = backVisible && await this.isElementVisible(this.highReturnAchieversTitle, 2000);
        const leftMarkets = titleVisible && !(await this.isElementVisible(this.equityTab, 500));
        const rows = leftMarkets ? await this.getHraRows() : [];
        const opened = leftMarkets && rows.length > 0;
        console.log(`High Return Achievers "See all" screen opened (${rows.length} symbols listed): ${opened ? 'PASS' : 'FAIL'}`);
        return opened;
    }

    // Taps the first symbol listed under High Return Achievers (on Markets or its "See all"
    // screen) and returns its symbol; the row opens the half-height Quote sheet. On Markets the
    // section is scrolled into view first if no row is on screen.
    async tapFirstHraSymbol() {
        let row = (await this.getDescribedElements()).find(n => isHraRow(n.desc));
        if (!row) row = await this.scrollToHighReturnAchievers();
        if (!row) {
            console.log('No symbol listed under High Return Achievers: FAIL');
            return null;
        }
        const symbol = (row.desc.trim().match(/^([^.\s]+)\./) || [])[1] || null;
        await this.tapNode(row);
        console.log(`Tapped first High Return Achievers symbol: ${symbol}`);
        return symbol;
    }

    // One back-press from a Quote opened on the "See all" screen lands back on that screen
    // (verified live) - confirmed by its Back button, title and listed rows.
    async navigateBackToHraSeeAll() {
        await this.driver.back();
        await this.pause(1200);
        const back = await this.isElementVisible(this.backButton, 3000)
            && await this.isElementVisible(this.highReturnAchieversTitle, 2000)
            && (await this.getHraRows()).length > 0;
        console.log(`Navigated back from Quote to High Return Achievers "See all": ${back ? 'PASS' : 'FAIL'}`);
        return back;
    }

    // ── Stock In Range ──────────────────────────────────────────────────────────

    sirTabSelector(label) {
        const index = SIR_TABS.findIndex(t => t.label === label) + 1;
        return `//*[starts-with(@content-desc,"${label}") and contains(@content-desc,"Tab ${index} of ${SIR_TABS.length}")]`;
    }

    async scrollToStockInRange() {
        return this.scrollToSection('Stock In Range', isSirRow);
    }

    // Rows listed under the price-range tab row, as { symbol, ltp, node }. On Markets the list
    // stops at the next section's heading ("Stocks You Viewed Recently", whose rows look the same);
    // on "See all" there is nothing below it.
    async getSirRows() {
        const nodes = await this.getDescribedElements();
        const tabRow = nodes.find(n => /^Under 100\nTab 1 of \d+$/.test(n.desc));
        if (!tabRow) return [];
        // "See all" has an "All" filter between the tabs and the list, so the list only ends at a
        // non-row node below its first row.
        const first = nodes.find(n => n.y1 >= tabRow.y2 && isSirRow(n.desc));
        if (!first) return [];
        const next = nodes.find(n => n.y1 >= first.y2 && !isSirRow(n.desc));
        return nodes
            .filter(n => n.y1 >= tabRow.y2 && (!next || n.y1 < next.y1) && isSirRow(n.desc))
            .map(n => {
                const ltp = n.desc.match(/Last traded price (-?\d+(?:\.\d+)?)/);
                return { symbol: (n.desc.trim().match(/^([^.\s]+)\./) || [])[1] || null, ltp: ltp ? Number(ltp[1]) : null, node: n };
            });
    }

    // The list (re)loads after the screen/tab itself is up, so a single snapshot can catch it empty
    // or still showing the previous tab's rows - polls until `accept(rows)` holds or time runs out,
    // and returns the last rows seen either way.
    async waitForSirRows(timeout = 6000, accept = rows => rows.length > 0) {
        const deadline = Date.now() + timeout;
        let rows = await this.getSirRows();
        while (!accept(rows) && Date.now() < deadline) {
            await this.pause(700);
            rows = await this.getSirRows();
        }
        return rows;
    }

    // Taps the first symbol listed under Stock In Range (on Markets or its "See all" screen) and
    // returns its symbol; on Markets the section is scrolled into view first if needed.
    async tapFirstSirSymbol() {
        let rows = await this.getSirRows();
        if (!rows.length) {
            await this.scrollToStockInRange();
            rows = await this.getSirRows();
        }
        if (!rows.length) {
            console.log('No symbol listed under Stock In Range: FAIL');
            return null;
        }
        await this.tapNode(rows[0].node);
        console.log(`Tapped first Stock In Range symbol: ${rows[0].symbol} (LTP ${rows[0].ltp})`);
        return rows[0].symbol;
    }

    // Taps price-range tab `label` and checks it carries selected="true", lists symbols, and that
    // the last traded price of each of the first 5 listed symbols falls inside that range.
    async clickSirTab(label, timeout = 5000) {
        const range = SIR_TABS.find(t => t.label === label);
        const el = await this.driver.$(this.sirTabSelector(label));
        try {
            await el.waitForDisplayed({ timeout });
        } catch (_) {
            console.log(`Stock In Range "${label}" tab not found: FAIL`);
            return null;
        }
        await el.click();
        await this.pause(800);

        // The tab can briefly drop out of the tree while the list recomposes, so wait for it again
        // rather than letting getAttribute throw.
        let selected = false;
        try {
            const tab = await this.driver.$(this.sirTabSelector(label));
            await tab.waitForDisplayed({ timeout });
            selected = (await tab.getAttribute('selected')) === 'true';
        } catch (_) { /* logged as FAIL below */ }
        // Right after the tap the list can still hold the previous tab's rows, so wait for this
        // tab's prices to show up before judging them.
        const isOutOfRange = r => r.ltp === null || r.ltp < range.min || r.ltp > range.max;
        const firstFive = (await this.waitForSirRows(timeout, rows => rows.length > 0 && !rows.slice(0, 5).some(isOutOfRange))).slice(0, 5);
        const outOfRange = firstFive.filter(isOutOfRange);
        const inRange = firstFive.length > 0 && outOfRange.length === 0;
        console.log(`Stock In Range "${label}" tab - selected: ${selected ? 'PASS' : 'FAIL'} | symbols listed: ${firstFive.length ? 'PASS' : 'FAIL (none)'}`);
        console.log(`  First ${firstFive.length} prices: ${firstFive.map(r => `${r.symbol} ${r.ltp}`).join(', ') || 'none'}`);
        console.log(`  Prices within ${range.min}-${range.max}: ${inRange ? 'PASS' : `FAIL${outOfRange.length ? ` - out of range: ${outOfRange.map(r => `${r.symbol} ${r.ltp}`).join(', ')}` : ''}`}`);
        return { label, selected, rowCount: firstFive.length, inRange };
    }

    async clickSeeAllStockInRange(timeout = 8000) {
        if (!(await this.isElementVisible(this.seeAllStockInRange, 1000))) await this.scrollToStockInRange();
        await this.click(this.seeAllStockInRange, timeout);
        console.log('Clicked "See all" on Stock In Range');
    }

    // The full Stock In Range screen: X (Back) button + "Stock In Range" title, the same price-range
    // tabs and a longer list (verified live). The Equity tab disappearing confirms it isn't still
    // the Markets screen.
    async verifySirSeeAllOpened(timeout = 8000) {
        const backVisible = await this.isElementVisible(this.backButton, timeout);
        const titleVisible = backVisible && await this.isElementVisible(this.stockInRangeTitle, 2000);
        // Markets can linger in the tree while the screen transition animates, so give it a moment.
        let leftMarkets = false;
        const deadline = Date.now() + 3000;
        while (titleVisible && !leftMarkets) {
            leftMarkets = !(await this.isElementVisible(this.equityTab, 500));
            if (leftMarkets || Date.now() >= deadline) break;
            await this.pause(500);
        }
        const rows = leftMarkets ? await this.waitForSirRows(timeout) : [];
        const opened = leftMarkets && rows.length > 0;
        const why = !backVisible ? 'no Back button' : !titleVisible ? 'no title' : !leftMarkets ? 'Markets still on screen' : `${rows.length} symbols listed`;
        console.log(`Stock In Range "See all" screen opened (${why}): ${opened ? 'PASS' : 'FAIL'}`);
        return opened;
    }

    // One back-press from a Quote opened on the "See all" screen lands back on it (verified live).
    async navigateBackToSirSeeAll(timeout = 6000) {
        await this.driver.back();
        await this.pause(1200);
        const backVisible = await this.isElementVisible(this.backButton, 3000);
        const titleVisible = backVisible && await this.isElementVisible(this.stockInRangeTitle, 2000);
        const rows = titleVisible ? await this.waitForSirRows(timeout) : [];
        const back = rows.length > 0;
        const why = !backVisible ? 'no Back button' : !titleVisible ? 'no title' : `${rows.length} symbols listed`;
        console.log(`Navigated back from Quote to Stock In Range "See all" (${why}): ${back ? 'PASS' : 'FAIL'}`);
        return back;
    }

    async closeSirSeeAll(timeout = 5000) {
        await this.click(this.backButton, timeout);
        console.log('Clicked Back on the Stock In Range screen');
    }

    async closeHraSeeAll(timeout = 5000) {
        await this.click(this.backButton, timeout);
        console.log('Clicked Back on the High Return Achievers screen');
    }

    // Every listed symbol must show its "1 Year Return: x%" value (read from the row's
    // "One year return x percent" content-desc).
    async verifyHraOneYearReturns() {
        const rows = await this.getHraRows();
        const missing = rows.filter(r => r.oneYearReturn === null);
        rows.forEach(r => console.log(`  ${r.symbol}: LTP ${r.ltp} | 1 Year Return ${r.oneYearReturn === null ? 'not shown' : `${r.oneYearReturn}%`}`));
        const ok = rows.length > 0 && missing.length === 0;
        console.log(`Symbols displayed with 1 Year Return (${rows.length - missing.length}/${rows.length}): ${ok ? 'PASS' : `FAIL${rows.length ? ` - missing for ${missing.map(r => r.symbol).join(', ')}` : ' - no symbols listed'}`}`);
        return ok;
    }

    async isHraTabSelected(label) {
        const index = HRA_TABS.indexOf(label) + 1;
        try {
            const el = await this.driver.$(`//*[starts-with(@content-desc,"${label}") and contains(@content-desc,"Tab ${index} of ${HRA_TABS.length}")]`);
            return (await el.getAttribute('selected')) === 'true';
        } catch (_) {
            return false;
        }
    }

    // Waits for the list to differ from `before` (a hraSnapshot) after a period/tab change, logs
    // PASS/FAIL with the top 3 rows, and returns the new snapshot for the next comparison.
    async verifyHraDataUpdated(before, what) {
        const after = await this.waitForHraRowsChange(before);
        const rows = await this.getHraRows();
        const top = rows.slice(0, 3).map(r => `${r.symbol} ${r.oneYearReturn}%`).join(', ');
        console.log(`Data updated for ${what} (top: ${top || 'none'}): ${after && after !== before ? 'PASS' : 'FAIL - list unchanged from the previous selection'}`);
        return after;
    }

    // Polls until the listed rows differ from `before` (a hraSnapshot) - the list reloads a moment
    // after the dropdown closes.
    async waitForHraRowsChange(before, timeout = 6000) {
        let after = before;
        await this.driver.waitUntil(async () => {
            after = this.hraSnapshot(await this.getHraRows());
            return after && after !== before;
        }, { timeout, interval: 500 }).catch(() => {});
        return after;
    }

    // Taps High Return Achievers sub-tab `label` ("Large Cap\nTab 1 of 3") and checks it carries
    // selected="true" (a real attribute here, verified live) and lists at least one symbol.
    async clickHraTab(label, timeout = 5000) {
        const index = HRA_TABS.indexOf(label) + 1;
        const sel = `//*[starts-with(@content-desc,"${label}") and contains(@content-desc,"Tab ${index} of ${HRA_TABS.length}")]`;
        const el = await this.driver.$(sel);
        try {
            await el.waitForDisplayed({ timeout });
        } catch (_) {
            console.log(`High Return Achievers "${label}" tab not found: FAIL`);
            return null;
        }
        await el.click();
        await this.pause(1500);

        const selected = (await (await this.driver.$(sel)).getAttribute('selected')) === 'true';
        const rows = await this.getHraRows();
        console.log(`High Return Achievers "${label}" tab - selected: ${selected ? 'PASS' : 'FAIL'} | symbols listed: ${rows.length}${rows.length ? ` (first: ${rows[0].symbol})` : ' - FAIL'}`);
        return { label, selected, rowCount: rows.length, firstSymbol: rows.length ? rows[0].symbol : null };
    }

    // The period pill ("1 Month") sits at the right end of the High Return Achievers tab row.
    async getHraPeriodPill() {
        const nodes = await this.getDescribedElements();
        const tab = nodes.find(n => /^Large Cap\nTab 1 of \d+$/.test(n.desc));
        if (!tab) return null;
        return nodes.find(n => HRA_PERIOD_RE.test(n.desc) && n.y1 < tab.y2 && n.y2 > tab.y1) || null;
    }

    async getHraPeriod() {
        const pill = await this.getHraPeriodPill();
        return pill ? pill.desc : null;
    }

    // Opens the period dropdown and returns its options top-to-bottom. While open, a full-screen
    // "Dismiss" scrim covers the page and the pill drops out of the tree, so every period-shaped
    // node left is an option.
    async openHraPeriodDropdown() {
        const pill = await this.getHraPeriodPill();
        if (!pill) {
            console.log('High Return Achievers period dropdown not found: FAIL');
            return [];
        }
        await this.tapNode(pill);
        await this.pause(1200);
        const nodes = await this.getDescribedElements();
        if (!nodes.some(n => n.desc === 'Dismiss')) {
            console.log('High Return Achievers period dropdown did not open: FAIL');
            return [];
        }
        return nodes.filter(n => HRA_PERIOD_RE.test(n.desc)).sort((a, b) => a.y1 - b.y1).map(n => n.desc);
    }

    // Verifies the open dropdown lists exactly 1 Month, 6 Month, 1 Year and 3 Year, in that order.
    verifyHraPeriodOptions(options) {
        const ok = options.length === HRA_PERIODS.length && HRA_PERIODS.every((p, i) => options[i] === p);
        console.log(`Period dropdown options: ${options.join(', ') || 'none'} - ${ok ? 'PASS' : `FAIL (expected ${HRA_PERIODS.join(', ')})`}`);
        return ok;
    }

    // Picks `period` from the dropdown (opening it first if needed), then checks the pill shows it
    // and the list still has symbols.
    async selectHraPeriod(period) {
        let option = (await this.getDescribedElements()).find(n => n.desc === period);
        if (!option || !(await this.isElementVisible('android=new UiSelector().description("Dismiss")', 300))) {
            await this.openHraPeriodDropdown();
            option = (await this.getDescribedElements()).find(n => n.desc === period);
        }
        if (!option) {
            console.log(`Period "${period}" not listed in the dropdown: FAIL`);
            await this.driver.back(); // close the dropdown
            await this.pause(600);
            return null;
        }
        await this.tapNode(option);
        await this.pause(1500);

        const shown = await this.getHraPeriod();
        const rows = await this.getHraRows();
        const ok = shown === period && rows.length > 0;
        console.log(`Selected period "${period}" - pill shows "${shown}" | symbols listed: ${rows.length}${rows.length ? ` (first: ${rows[0].symbol})` : ''} - ${ok ? 'PASS' : 'FAIL'}`);
        return { period, shown, rowCount: rows.length, firstSymbol: rows.length ? rows[0].symbol : null };
    }

    // Horizontal drag across one row at height `y`. 'left' drags content leftward to reveal tiles
    // further right; 'right' reveals tiles further left (same convention as BasePage.swipe).
    async swipeRowAt(y, direction) {
        const { width } = await this.driver.getWindowSize();
        const [fromX, toX] = direction === 'left'
            ? [Math.floor(width * 0.8), Math.floor(width * 0.15)]
            : [Math.floor(width * 0.15), Math.floor(width * 0.8)];
        await this.driver.action('pointer')
            .move({ duration: 0, x: fromX, y })
            .down()
            .move({ duration: 800, x: toX, y })
            .up()
            .perform();
        await this.pause(600);
    }

    // Brings quick-access tile `name` fully on screen and returns its node. Two things get in the
    // way (both seen live): at the top of the page the tile row sits underneath the floating
    // bottom nav, so the page is scrolled until the row clears it; and the row keeps whatever
    // horizontal offset it was last left at, so it is swiped toward the tile until fully visible.
    async revealTile(name, maxSwipes = 4) {
        const { width, height } = await this.driver.getWindowSize();
        const findRow = async () => {
            const nodes = await this.getDescribedElements();
            const heading = nodes.find(n => n.desc === 'Trading Tools & Products');
            if (!heading) return null;
            const navTop = (nodes.find(n => n.desc === 'Watchlist') || { y1: Math.floor(height * 0.87) }).y1;
            const tiles = nodes.filter(n => TILE_ORDER.includes(n.desc) && n.y1 > heading.y2 && n.y1 - heading.y2 < 150);
            return { heading, navTop, tiles };
        };

        // The row is near the top of the page (right under Market Movers); if it isn't on screen the
        // page was left scrolled further down (e.g. at Results), so start again from the top.
        let row = await findRow();
        if (!row || !row.tiles.length) {
            await this.scrollToTop();
            row = await findRow();
        }
        for (let i = 0; i < maxSwipes && (!row || !row.tiles.length || Math.max(...row.tiles.map(t => t.y2)) > row.navTop); i++) {
            await this.swipe('down');
            await this.pause(600);
            row = await findRow();
        }
        if (!row || !row.tiles.length) {
            console.log(`Could not bring the "Trading Tools & Products" row on screen for "${name}"`);
            return null;
        }

        const fullWidth = Math.max(...row.tiles.map(t => t.x2 - t.x1));
        for (let i = 0; i <= maxSwipes; i++) {
            const tile = row.tiles.find(t => t.desc === name);
            if (tile && tile.x1 >= 0 && tile.x2 <= width && (tile.x2 - tile.x1) >= fullWidth * 0.9) return tile;
            if (i === maxSwipes) break;

            // A partially clipped tile tells the direction directly; a missing one is placed by
            // TILE_ORDER relative to the tiles that are visible.
            const target = TILE_ORDER.indexOf(name);
            const revealLeft = tile
                ? tile.x1 <= 0
                : target < Math.min(...row.tiles.map(t => TILE_ORDER.indexOf(t.desc)));
            await this.swipeRowAt(Math.round((row.tiles[0].y1 + row.tiles[0].y2) / 2), revealLeft ? 'right' : 'left');
            row = await findRow();
            if (!row || !row.tiles.length) break;
        }
        console.log(`Could not reveal the "${name}" tile in the quick-access row`);
        return null;
    }

    async clickTile(name) {
        const tile = await this.revealTile(name);
        if (!tile) throw new Error(`"${name}" tile not found in the Trading Tools & Products row`);
        await this.tapNode(tile);
        console.log(`Clicked "${name}" tile`);
    }

    async clickAiAlgoTile() {
        await this.clickTile('AI Algo');
    }

    async clickNxtOptionTile() {
        await this.clickTile('NxtOption');
    }

    async clickIpoTile() {
        await this.clickTile('IPO');
    }

    async clickMutualFundsTile() {
        await this.clickTile('Mutual Funds');
    }

    async clickBasketTile() {
        await this.clickTile('Basket');
    }

    // AI Algo and IPO open an embedded webview - waitForWebViewLoaded (BasePage) confirms the
    // native WebView container itself has mounted, which is as far as content-desc-based
    // verification can reach into web content.
    async verifyAiAlgoOpened(timeout = 10000) {
        const loaded = await this.waitForWebViewLoaded(timeout);
        console.log(loaded ? 'AI Algo webview loaded' : `AI Algo webview did not load within ${timeout}ms`);
        return loaded;
    }

    async verifyIpoOpened(timeout = 10000) {
        const loaded = await this.waitForWebViewLoaded(timeout);
        console.log(loaded ? 'IPO webview loaded' : `IPO webview did not load within ${timeout}ms`);
        return loaded;
    }

    // NxtOption has no confirmed unique marker of its own from this entry point, so this instead
    // confirms navigation actually happened: the Equity tab marker disappearing means the screen
    // moved on from Markets.
    async verifyNxtOptionOpened(timeout = 8000) {
        const leftMarkets = await this.driver.waitUntil(
            async () => !(await this.isElementVisible(this.equityTabLoaded, 500)),
            { timeout, interval: 300 }
        ).then(() => true).catch(() => false);
        console.log(leftMarkets ? 'NxtOption opened (navigated away from Markets)' : `Still on Markets after ${timeout}ms - NxtOption did not open`);
        return leftMarkets;
    }

    async verifyBasketOpened(timeout = 8000) {
        if (!(await this.isElementVisible(this.basketTab, timeout))) {
            console.log(`Basket tab did not appear within ${timeout}ms`);
            return false;
        }
        // Either state can take a moment to render - poll for whichever shows first.
        let state = null;
        await this.driver.waitUntil(async () => {
            const rows = await this.driver.$$(this.basketRow);
            if (rows.length) state = `${rows.length} saved basket(s) displayed`;
            else if (await this.isElementVisible(this.noBasketMessage, 200)) state = 'no baskets created - "Basket order is Empty" shown';
            return !!state;
        }, { timeout: 5000, interval: 500 }).catch(() => {});
        console.log(state ? `Basket screen loaded - ${state}` : 'Basket tab opened, but neither saved baskets nor "Basket order is Empty" is shown');
        return !!state;
    }

    // ── Global search / Stocks You Viewed Recently ─────────────────────────────

    async clickGlobalSearchBar(timeout = 8000) {
        await this.click(this.globalSearchBar, timeout);
        const opened = await this.isElementVisible(this.searchCancelButton, timeout);
        console.log(`Global search screen opened: ${opened ? 'PASS' : 'FAIL'}`);
        return opened;
    }

    async getSearchText() {
        try {
            return (await (await this.driver.$(this.searchField)).getAttribute('text')) || '';
        } catch (_) {
            return '';
        }
    }

    // The field only takes key events while focused - after returning from a Quote it still shows
    // the query but has lost focus (verified live) - so it is tapped first, then typed into with
    // real key events, which the Compose field picks up where setValue() may not.
    async typeInSearch(query, timeout = 5000) {
        await this.click(this.searchField, timeout);
        await this.pause(300);
        for (const ch of query) {
            await this.driver.keys(ch);
            await this.pause(60);
        }
        const text = await this.getSearchText();
        console.log(`Entered "${query}" in global search - field reads "${text}": ${text === query ? 'PASS' : 'FAIL'}`);
        return text === query;
    }

    // Backspaces (focused first, as above) until the field reads empty. Tapping the field drops the
    // cursor where the tap lands - mid-text for a longer query like "GOLD 149000", which left "00"
    // behind (verified live) - so the cursor is moved to the end before deleting.
    async clearSearch(timeout = 5000) {
        await this.click(this.searchField, timeout);
        await this.pause(300);
        let text = await this.getSearchText();
        for (let attempt = 0; attempt < 3 && text; attempt++) {
            await this.driver.pressKeyCode(123); // KEYCODE_MOVE_END
            for (let i = 0; i < text.length; i++) {
                await this.driver.pressKeyCode(67); // KEYCODE_DEL
                await this.pause(40);
            }
            await this.pause(300);
            text = await this.getSearchText();
        }
        console.log(`Cleared the global search text: ${text ? `FAIL (still reads "${text}")` : 'PASS'}`);
        return !text;
    }

    // Result rows read "SYMBOL\nIDEA, Double tap to open Quote Screen." (or "SYMBOL\nAdd Watchlist,
    // ..."); the same symbol can be listed once per exchange. A contract search like "NIFTY 22750"
    // lists "NIFTY 13OCT 22750 CE", ... Waits for a first row containing every word of `query` so a
    // stale list from the previous search isn't read.
    async getSearchResults(query, timeout = 6000) {
        const words = query.toUpperCase().split(/\s+/);
        let results = [];
        const deadline = Date.now() + timeout;
        do {
            results = (await this.getDescribedElements())
                .filter(n => n.desc.includes('Double tap to open Quote Screen'))
                .map(n => ({ symbol: n.desc.split('\n')[0].trim(), node: n }));
            if (results.length && words.every(w => results[0].symbol.toUpperCase().includes(w))) break;
            await this.pause(500);
        } while (Date.now() < deadline);
        return results;
    }

    // Taps the `position`-th (1-based) search result and returns its symbol. The multi-line
    // content-desc can't be matched with a UiSelector description, so the row is tapped by bounds.
    async tapSearchResult(query, position = 1) {
        const results = await this.getSearchResults(query);
        console.log(`Search results for "${query}": ${results.slice(0, 5).map(r => r.symbol).join(', ') || 'none'}${results.length > 5 ? ', ...' : ''}`);
        const result = results[position - 1];
        if (!result) {
            console.log(`No result #${position} listed for "${query}": FAIL`);
            return null;
        }
        const { x1, y1, x2, y2 } = result.node;
        await this.driver.action('pointer', { parameters: { pointerType: 'touch' } })
            .move({ duration: 0, x: Math.round((x1 + x2) / 2), y: Math.round((y1 + y2) / 2) })
            .down().pause(80).up()
            .perform();
        console.log(`Clicked search result #${position} for "${query}": ${result.symbol}`);
        return result.symbol;
    }

    // One back-press from a Quote opened via search lands back on the search screen with the
    // query still entered (verified live).
    async navigateBackToSearch(timeout = 5000) {
        await this.driver.back();
        await this.pause(1000);
        const back = await this.isElementVisible(this.searchCancelButton, timeout);
        console.log(`Navigated back from Quote to global search: ${back ? 'PASS' : 'FAIL'}`);
        return back;
    }

    async closeGlobalSearch(timeout = 5000) {
        await this.click(this.searchCancelButton, timeout);
        await this.pause(800);
        console.log('Clicked Cancel on global search');
    }

    async scrollToRecentlyViewed() {
        return this.scrollToSection('Stocks You Viewed Recently', isRecentCard);
    }

    // Recently viewed cards currently on screen, left to right, as { symbol, node, remove } - `remove`
    // is the card's own X ("remove this stock from recent search history, ..."), a separate node
    // sitting inside the card's top-right corner (verified live). The row is a horizontal scroller
    // showing about two cards, so a card cut off at either edge (or without its X) is left out.
    async getRecentCards() {
        const { width } = await this.driver.getWindowSize();
        const nodes = await this.getDescribedElements();
        const removes = nodes.filter(n => n.desc.startsWith('remove this stock from recent search history'));
        return nodes
            .filter(n => isRecentCard(n.desc))
            .map(n => ({
                symbol: n.desc.trim().match(/^(.+?)\. Last traded price/)[1],
                node: n,
                remove: removes.find(r => r.x1 >= n.x1 && r.x2 <= n.x2 && r.y1 >= n.y1 && r.y2 <= n.y2),
            }))
            .filter(c => c.node.x1 >= 0 && c.node.x2 <= width && c.remove)
            .sort((a, b) => a.node.x1 - b.node.x1);
    }

    async tapAt(x, y) {
        await this.driver.action('pointer', { parameters: { pointerType: 'touch' } })
            .move({ duration: 0, x: Math.round(x), y: Math.round(y) })
            .down().pause(80).up()
            .perform();
    }

    // The row keeps its horizontal offset between visits - swipes it back to the first card.
    async rewindRecentRow(y, maxSwipes = 4) {
        for (let i = 0; i < maxSwipes; i++) {
            const before = (await this.getRecentCards()).map(c => c.symbol).join('|');
            await this.swipeRowAt(y, 'right');
            if ((await this.getRecentCards()).map(c => c.symbol).join('|') === before) return;
        }
    }

    // Scrolls to Stocks You Viewed Recently and taps the first card under the header (on its left
    // half, clear of the X) - returns its symbol.
    async tapFirstRecentlyViewed() {
        const firstRow = await this.scrollToRecentlyViewed();
        if (!firstRow) return null;
        await this.rewindRecentRow(Math.round((firstRow.y1 + firstRow.y2) / 2));
        const [first] = await this.getRecentCards();
        if (!first) {
            console.log('No symbol displayed under Stocks You Viewed Recently: FAIL');
            return null;
        }
        const { x1, x2, y1, y2 } = first.node;
        await this.tapAt(x1 + (x2 - x1) / 4, (y1 + y2) / 2);
        console.log(`Clicked the first symbol under Stocks You Viewed Recently: ${first.symbol}`);
        return first.symbol;
    }

    // Taps the X on `symbol`'s card (swiping the row left to find it) and checks the card is gone.
    // With nothing left to show, the whole section disappears, which also counts as removed.
    async removeRecentlyViewed(symbol, maxSwipes = 6) {
        const firstRow = (await this.getDescribedElements()).find(n => isRecentCard(n.desc)) || await this.scrollToRecentlyViewed();
        if (!firstRow) {
            console.log(`Stocks You Viewed Recently not found while removing ${symbol}: FAIL`);
            return false;
        }
        const rowY = Math.round((firstRow.y1 + firstRow.y2) / 2);
        await this.rewindRecentRow(rowY);
        let card = null;
        for (let i = 0; i <= maxSwipes && !card; i++) {
            card = (await this.getRecentCards()).find(c => c.symbol === symbol);
            if (!card && i < maxSwipes) await this.swipeRowAt(rowY, 'left');
        }
        if (!card) {
            console.log(`${symbol} not displayed under Stocks You Viewed Recently - could not remove it: FAIL`);
            return false;
        }
        const before = (await this.getRecentCards()).filter(c => c.symbol === symbol).length;
        const { x1, x2, y1, y2 } = card.remove;
        await this.tapAt((x1 + x2) / 2, (y1 + y2) / 2);
        await this.pause(1200);
        const sectionGone = !(await this.getDescribedElements()).some(n => n.desc === 'Stocks You Viewed Recently');
        const after = sectionGone ? 0 : (await this.getRecentCards()).filter(c => c.symbol === symbol).length;
        const removed = after < before;
        console.log(`Clicked X on ${symbol} - removed from Stocks You Viewed Recently${sectionGone ? ' (section no longer shown)' : ''}: ${removed ? 'PASS' : 'FAIL'}`);
        return removed;
    }

    async clickSeeAllRecentlyViewed(timeout = 8000) {
        await this.click(this.seeAllRecentlyViewed, timeout);
        console.log('Clicked "See all" on Stocks You Viewed Recently');
    }

    async verifyRecentlyViewedSeeAllOpened(timeout = 8000) {
        const opened = await this.isElementVisible(this.backButton, timeout)
            && await this.isElementVisible(this.recentlyViewedTitle, 2000);
        console.log(`Stocks You Viewed Recently "See all" screen opened: ${opened ? 'PASS' : 'FAIL'}`);
        return opened;
    }

    // "See all" rows read " IDEA. VODAFONE IDEA LIMITED. Last traded price ..., Double tap to view
    // IDEA details, ..." with the most recently viewed first - the symbol is taken from "view X details".
    // The same symbol can be listed once per exchange (" HDFCAMC. HDFC AMC LIMITED." and " HDFCAMC.
    // HDFC ASSET MANAGEMENT COMPANY ." - verified live), so each entry is keyed by the text before
    // "Last traded price", which tells those apart.
    async getVisibleRecentlyViewed() {
        return (await this.getDescribedElements())
            .map(n => {
                const symbol = (n.desc.match(/Double tap to view (.+?) details/) || [])[1];
                return symbol && { symbol, key: n.desc.split('Last traded price')[0].trim() };
            })
            .filter(Boolean);
    }

    // Every entry on the "See all" screen, in order, scrolling down until a swipe shows nothing new.
    async getAllRecentlyViewed(maxScrolls = 15) {
        const entries = new Map();
        const collect = async () => {
            let added = 0;
            for (const e of await this.getVisibleRecentlyViewed()) {
                if (!entries.has(e.key)) { entries.set(e.key, e); added++; }
            }
            return added;
        };
        await collect();
        for (let i = 0; i < maxScrolls; i++) {
            await this.swipe('down');
            await this.pause(800);
            if (!(await collect())) break;
        }
        return [...entries.values()];
    }

    // The "See all" list must hold exactly the symbols just opened via search: no more than
    // `maxListed` entries in all, and every one of `symbols` among them.
    async verifyRecentlyViewedList(symbols, maxListed = symbols.length) {
        const entries = await this.getAllRecentlyViewed();
        console.log(`Stocks You Viewed Recently lists ${entries.length} symbol(s): ${entries.map(e => e.symbol).join(', ') || 'none'}`);
        const countOk = entries.length <= maxListed;
        console.log(`Only the last ${maxListed} searched symbols listed: ${countOk ? 'PASS' : `FAIL (${entries.length} listed, expected at most ${maxListed})`}`);
        const listed = new Set(entries.map(e => e.symbol));
        for (const s of symbols) {
            console.log(`${s} listed under Stocks You Viewed Recently: ${listed.has(s) ? 'PASS' : 'FAIL'}`);
        }
        return countOk && symbols.every(s => listed.has(s));
    }

    async closeRecentlyViewedSeeAll(timeout = 5000) {
        await this.click(this.backButton, timeout);
        console.log('Clicked Back on the Stocks You Viewed Recently screen');
    }

    // A single device back-press from the (expanded) Quote screen lands straight back on Markets
    // (verified live); navigateBackToMarkets covers anything deeper.
    async navigateBackFromQuote() {
        await this.driver.back();
        await this.pause(1200);
        const back = await this.waitForEquityLoaded(3000) || await this.navigateBackToMarkets();
        console.log(`Navigated back from Quote to Markets: ${back ? 'PASS' : 'FAIL'}`);
        return back;
    }

    // Tapping the bottom nav's Market icon again is the primary way back - it's present on every
    // native screen (confirmed for Market/Orders/Portfolio/Mutual Funds elsewhere in this app) and
    // reliably switches straight back to Equity from a sibling tab. A webview or nested screen that
    // hides the floating nav falls back to a device back-press instead, mirroring the retry pattern
    // MutualFundsPage.navigateBackToHome already uses for its own "get back to a known screen" case.
    async navigateBackToMarkets(maxAttempts = 5) {
        for (let i = 0; i < maxAttempts; i++) {
            if (await this.waitForEquityLoaded(1000)) {
                console.log('Back on Markets (Equity) screen');
                return true;
            }
            if (await this.isElementVisible(this.marketNavButton, 1000)) {
                await this.clickMarketNavButton();
            } else {
                await this.driver.back();
            }
            await this.pause(800);
        }
        const reached = await this.waitForEquityLoaded(1500);
        if (!reached) console.log(`Could not navigate back to Markets after ${maxAttempts} attempts`);
        return reached;
    }
}

module.exports = { MarketsPage, HRA_TABS, HRA_PERIODS, SIR_TABS };
