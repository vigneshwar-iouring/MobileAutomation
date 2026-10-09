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
        this.backButton = 'android=new UiSelector().description("Back, Double tap to go back")';

        // Each movers row is one content-desc (" SYMBOL. COMPANY. Last traded price ..., Double tap
        // to view SYMBOL details, or swipe right for next category"). The index ticker above
        // ("...or swipe right for more options") never says "next category", so this skips it.
        this.moversRow = '//*[contains(@content-desc,"Double tap to view") and contains(@content-desc,"next category")]';

        // The Basket tile opens Orders on its "Basket" tab ("Basket\nTab 2 of 2"). EXECUTE (the
        // selector BasketPage uses) only shows when baskets exist - an empty one shows "Basket
        // order is Empty" plus "New Basket" instead (verified live).
        this.basketTab = '//*[starts-with(@content-desc,"Basket") and contains(@content-desc,"Tab ")]';
        this.basketContent = 'android=new UiSelector().descriptionMatches("EXECUTE|New Basket|Basket order is Empty")';
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
        await el.click();
        await this.pause(1500);

        const selected = (await (await this.driver.$(sel)).getAttribute('selected')) === 'true';
        const rows = await this.driver.$$(this.moversRow);
        const firstDesc = rows.length ? await rows[0].getAttribute('content-desc') : '';
        const firstSymbol = (firstDesc.trim().match(/^([^.\s]+)\./) || [])[1] || null;
        console.log(`Market Movers "${label}" tab - selected: ${selected ? 'PASS' : 'FAIL'} | symbols listed: ${rows.length}${firstSymbol ? ` (first: ${firstSymbol})` : ''}`);
        return { label, selected, rowCount: rows.length, firstSymbol };
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
            .map(n => ({ symbol: (n.desc.trim().match(/^([^.\s]+)\./) || [])[1] || null, desc: n.desc }));
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
        const loaded = await this.isElementVisible(this.basketTab, timeout)
            && await this.isElementVisible(this.basketContent, 3000);
        console.log(loaded ? 'Basket screen loaded' : `Basket screen did not load within ${timeout}ms`);
        return loaded;
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

module.exports = { MarketsPage, HRA_TABS, HRA_PERIODS };
