const BasePage = require('./BasePage');
const { isResultRow, parseResultRow } = require('./ResultsPage');
const { decodePng, pixelAt } = require('../utils/pngPixels');

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
// Last Visited cards on Markets read " IDEA. Last traded price 12.80. ...\nIDEA \n12.80..."
// (" NIFTY 13OCT 22750 CE. Last traded price ..." for a contract) - unlike the other sections' rows,
// with no "Double tap to view".
const isRecentCard = desc => desc.includes('\n') && !desc.includes('Double tap to view') && /^\s*\S.*?\. Last traded price/.test(desc);

// Symbol of a movers row. Equity rows read " RELIANCE. RELIANCE INDUSTRIES. Last traded ...", but
// F&O Market Insights rows name a contract with spaces (" KAYNES 23NOV FUT. NFOLast traded ...,
// Double tap to view KAYNES 23NOV FUT details, ..."), so the "Double tap to view X details" hint
// is read first.
const moverSymbol = desc => (desc.match(/Double tap to view (.+?) details/) || desc.trim().match(/^([^.\s]+)\./) || [])[1] || null;

// F&O Market Insights rows put the exchange straight after the contract, with no separator before
// "Last traded price" (verified live): " KEI 27OCT FUT. NFOLast traded price 3881.70. ...".
const FNO_EXCHANGES = ['NFO', 'BFO'];
// Commodity Market Insights rows read "... GOLD 05DEC FUT. MCXLast traded price ..." (see
// Regression/New_Regression.spec.js MARKET_SEL), so they parse like F&O's.
const COMMODITY_EXCHANGES = ['MCX'];
// Currency rows read " GBPINR 26NOV FUT. CDSLast traded price ..." (verified live).
const CURRENCY_EXCHANGES = ['CDS'];
// Per-segment settings: the segment tab's name, the "<Segment> Market Insights", trending and "Top"
// section headings, the exchanges their symbols must belong to, and the contract type those
// exchanges trade.
const INSIGHTS = {
    fno: { segment: 'F&O', section: 'F&O Market Insights', trending: 'Trending Options', exchanges: FNO_EXCHANGES, kind: 'F&O' },
    commodity: { segment: 'Commodity', section: 'Commodity Market Insights', trending: 'Trending Commodities Options', top: 'Top Commodities', exchanges: COMMODITY_EXCHANGES, kind: 'Commodity' },
    currency: { segment: 'Currency', section: 'Currency Market Insights', trending: 'Trending Currencies Options', top: 'Top Currencies', exchanges: CURRENCY_EXCHANGES, kind: 'Currency' },
};
// Expiry a contract name carries as DDMON ("KAYNES 27OCT FUT" -> { day: 27, month: 9, text:
// "27OCT" }), or null.
const contractExpiry = symbol => {
    const m = (symbol || '').match(/\b(\d{1,2})([A-Z]{3})\b/);
    return m && MONTHS[m[2]] !== undefined ? { day: Number(m[1]), month: MONTHS[m[2]], text: m[0] } : null;
};
// OI Analysis rows (verified live): " AMBUJACEM 29DEC FUT. Exchange NFO. Open interest 422400. Open
// interest change percentage 255.56 percent. Last traded price 355.85. Change 4.40. ...". The list's
// column headers sit on the tab's description node, one per line: "...sentiments.\nSymbol\nOpen
// Interest\nPrice".
// Values can be blank (Currency, seen live: "Open interest . ... Last traded price . Change") - the
// row is still matched, and its Open Interest / Price read as 0 so the value check reports it.
const OI_ROW_RE = /^\s*(.+?)\. Exchange (\w+)\. Open interest (\d*)\..*?Last traded price ([\d.]*)\./;
const OI_COLUMNS = ['Symbol', 'Open Interest', 'Price'];
// Rollover Analysis rows (verified live): "NIFTY 23NOV FUT. Rollover percentage 7.46 percent.
// Rollover cost 153.7. Rollover cost percentage 0.67 percent., Double tap to view ...". Its column
// headers are separate nodes. Each toggle lists its options left to right.
const ROLLOVER_ROW_RE = /^\s*(.+?)\. Rollover percentage (-?[\d.]+) percent\. Rollover cost (-?[\d.]+)\./;
const ROLLOVER_COLUMNS = ['Symbol', 'Percentage%', 'Rollover cost'];
const ROLLOVER_SEGMENTS = ['INDEX', 'STOCK'];
const ROLLOVER_TYPES = ['HIGH', 'LOW'];
// Rollover "See all" swaps HIGH/LOW for tabs, in this order.
const ROLLOVER_SEE_ALL_TABS = { HIGH: 'Highest Rollover', LOW: 'Lowest Rollover' };
// Index futures' underlyings - how Rollover "See all" tells an INDEX list from a STOCK one, since its
// segment toggle's own content-desc doesn't report the segment (see getRolloverSeeAllSelection).
const INDEX_FUTURE_ROOTS = ['NIFTY', 'BANKNIFTY', 'FINNIFTY', 'MIDCPNIFTY', 'NIFTYNXT50', 'SENSEX', 'SENSEX50', 'BANKEX'];
const parseFnoInsightRow = desc => {
    const m = desc.match(/^\s*(.+?)\.\s*([A-Z]+)Last traded price/);
    return { symbol: m ? m[1] : moverSymbol(desc), exchange: m ? m[2] : null, desc };
};

// The NxtOption banner on F&O opens a popup with these three tools. Each tool's screen has no title
// of its own, so it is recognised by labels only it shows (verified live) - matched on the first
// line of the content-desc, since its tabs read "IV Charts\nTab 1 of 2".
const NXT_OPTION_TOOLS = {
    'Strategy Builder': ['Predefined', 'Custom'],
    'IV Analysis': ['IV Charts', 'IVR-IVP Scan'],
    'OI Analysis': ['OI', 'OI Change', 'PCR Chart'],
};

// What each NxtOption tool's screen is exercised with once open, and how long each tap is given to
// load its data/graph. Labels as Regression R52/R54/R56 tap them (pages/NxtOption/NxtOptionPage.js).
const NXT_OPTION_TOOL_TAPS = {
    'Strategy Builder': { labels: ['Buy Call'], waitMs: 5000 },
    'IV Analysis': { labels: ['IV Charts', 'IVR-IVP Scan'], waitMs: 3000 },
    'OI Analysis': { labels: ['OI', 'OI Change', 'PCR Chart'], waitMs: 3000 },
};

// Same loader NxtOptionPage watches for: a ProgressBar or a "Loading..."/"Please wait" label.
const NXT_OPTION_LOADER = '//android.widget.ProgressBar | //*[contains(translate(@content-desc,"LOADINGPLEASWT","loadingpleaswt"),"loading") or contains(translate(@content-desc,"LOADINGPLEASWT","loadingpleaswt"),"please wait")]';

// Left-to-right order of the "Trading Tools & Products" quick-access row (verified live). The row
// is a horizontal scroller that keeps its scroll offset between visits, so any one of these can be
// off-screen at either edge - the order tells revealTile() which way to swipe for a missing tile.
const TILE_ORDER = ['AI Algo', 'NxtOption', 'IPO', 'Mutual Funds', 'Basket'];

// FII/DII (last section on Equity) rows, top to bottom (verified live). Each label and its value
// ("-1,305.13") are separate nodes on one line; the date ("13th Oct 2026") and the unit "(Rs. Cr.)"
// sit on the line under the heading. The bar between label and value is custom-drawn - nothing in
// the tree - so its colour is read from a screenshot: red (206,64,61) left of the grey centre axis
// for a negative value, green (73,157,101) right of it for a positive one (verified live).
const FII_DII_ROWS = ['FII Cash', 'DII Cash', 'FII Future', 'FII Option'];
// FII/DII "See all": period tabs ("Daily\nTab 1 of 3", selected="true" on the current one), and the
// ALL/STOCK/INDEX sub-tabs with the rows each one lists (verified live). The sub-tabs carry no
// selected attribute - the selected one is the pill filled blue (40,94,163) instead of grey (33,33,33).
const FII_DII_PERIODS = ['Daily', 'Monthly', 'Yearly'];
const FII_DII_SEGMENTS = {
    ALL: FII_DII_ROWS,
    STOCK: ['FII Cash', 'DII Cash'],
    INDEX: ['FII Future', 'FII Option'],
};
// F&O's "FII Trend in F&O" (verified live): an "As on 27th Oct 2026" date, a dropdown with these
// filters (Stock Futures by default), and Buy / Sell / Net Positions rows valued "36,284.48 Cr", each
// with its own custom-drawn bar left of its label. Its "See all" ("FII") is the FII/DII "See all"
// screen with these rows per sub-tab instead, and an X with no content-desc.
const FNO_FII_FILTERS = ['Stock Futures', 'Stock Options', 'Index Futures', 'Index Options'];
const FNO_FII_ROWS = ['Buy', 'Sell', 'Net Positions'];
const FNO_FII_SEGMENTS = {
    ALL: FNO_FII_FILTERS,
    STOCK: ['Stock Futures', 'Stock Options'],
    INDEX: ['Index Futures', 'Index Options'],
};
// A drawn bar pixel: any clearly coloured pixel (green, red, blue bars) - not the grey axis/text.
const isBarPixel = ([r, g, b]) => Math.max(r, g, b) - Math.min(r, g, b) > 60 && Math.max(r, g, b) > 120;
const FII_TREND_MIN_BAR_PX = 8;
// Each "See all" entry is one node: "13th Oct 2026\nFII Cash\n-1,305.13\nDII Cash\n2,439.24\n..."
// - headed by a date on Daily, "Oct 2026" on Monthly, "2026" on Yearly.
const FII_DII_ENTRY_HEAD = /^(\d{1,2}(?:st|nd|rd|th)? [A-Za-z]{3} \d{4}|[A-Za-z]{3} \d{4}|\d{4})$/;
const MONTHS = { JAN: 0, FEB: 1, MAR: 2, APR: 3, MAY: 4, JUN: 5, JUL: 6, AUG: 7, SEP: 8, OCT: 9, NOV: 10, DEC: 11 };
const isRedBar = ([r, g, b]) => r > 150 && r - g > 80 && r - b > 80;
const isGreenBar = ([r, g, b]) => g > 120 && g - r > 50 && g - b > 30;
// Future Index Contracts badges ("Current Expiry" green, "Next Expiry" grey, "Far Expiry" red) are
// drawn only - absent from the accessibility tree - so each is told apart by its colour in the
// left-bottom half of its row. Sampled live (every 2nd px): ~510 green / ~640 grey / ~400 red px
// for the badge, against ~150 grey px of plain "NFO" text and no green/red elsewhere there.
const isGreyBadge = ([r, g, b]) => r > 90 && Math.abs(r - g) < 15 && Math.abs(g - b) < 15;
const BADGE_MIN_PX = 100;
const NEXT_BADGE_MIN_GREY_PX = 350;
const EXPIRY_CATEGORIES = ['Current Expiry', 'Next Expiry', 'Far Expiry'];
const isAxis = ([r, g, b]) => r > 90 && Math.abs(r - g) < 10 && Math.abs(g - b) < 10;

// "13th Oct 2026" -> Date (local midnight), or null.
function parseFiiDiiDate(text) {
    const m = text.trim().match(/^(\d{1,2})(?:st|nd|rd|th)?\s+([A-Za-z]{3,9})\s+(\d{4})$/);
    if (!m) return null;
    const month = MONTHS[m[2].slice(0, 3).toUpperCase()];
    return month === undefined ? null : new Date(Number(m[3]), month, Number(m[1]));
}

// A "See all" entry heading -> the Date it starts on: "13th Oct 2026" (Daily), "Oct 2026"
// (Monthly -> 1st of the month), "2026" (Yearly -> 1st Jan), or null.
function parseFiiDiiPeriod(text) {
    const day = parseFiiDiiDate(text);
    if (day) return day;
    const mo = text.trim().match(/^([A-Za-z]{3}) (\d{4})$/);
    if (mo) {
        const month = MONTHS[mo[1].toUpperCase()];
        return month === undefined ? null : new Date(Number(mo[2]), month, 1);
    }
    return /^\d{4}$/.test(text.trim()) ? new Date(Number(text.trim()), 0, 1) : null;
}

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
        // "F&O\nTab 2 of 4" - the "F&O Market Insights" heading and its "See all" never say "Tab ".
        this.fnoTab = '//*[starts-with(@content-desc,"F&O") and contains(@content-desc,"Tab 2 of")]';
        this.seeAllFnoInsights = 'android=new UiSelector().descriptionStartsWith("See all F&O Market Insights")';
        this.seeAllOiAnalysis = 'android=new UiSelector().descriptionStartsWith("See all OI Analysis")';
        this.seeAllRollover = 'android=new UiSelector().descriptionStartsWith("See all Rollover Analysis")';
        this.fnoInsightsTitle = 'android=new UiSelector().description("F&O Market Insights")';
        // "Commodity\nTab 3 of 4" (same position Regression/New_Regression.spec.js taps), with the
        // same Market Insights section / "See all" shape as F&O.
        this.commodityTab = '//*[starts-with(@content-desc,"Commodity") and contains(@content-desc,"Tab 3 of")]';
        this.seeAllCommodityInsights = 'android=new UiSelector().descriptionStartsWith("See All")';
        this.commodityInsightsTitle = 'android=new UiSelector().description("Commodity Market Insights")';
        this.topCommoditiesHeading = INSIGHTS.commodity.top;
        // "Currency\nTab 4 of 4" - same Market Insights / Trending / Top / OI Analysis layout as
        // Commodity, minus the NxtOption banner, and Top Currencies has no tab row (verified live).
        this.currencyTab = '//*[starts-with(@content-desc,"Currency") and contains(@content-desc,"Tab 4 of")]';
        this.seeAllTopCommodities = 'android=new UiSelector().descriptionStartsWith("See All")';
        // The two dropdowns above the "See all" list read "Expiry filter. Selected All Expiry., Double
        // tap to change expiry." and "Instrument filter. Selected Stock Future., ..." (verified live).
        this.expiryFilter = 'android=new UiSelector().descriptionStartsWith("Expiry filter")';
        this.instrumentFilter = 'android=new UiSelector().descriptionStartsWith("Instrument filter")';
        // Banner below F&O Market Insights ("Explore the Smart Option Trading\nwith our new strategy
        // builder NxtOption"). Tapping it opens a popup over a full-screen "Dismiss" scrim.
        this.nxtOptionBanner = 'android=new UiSelector().descriptionStartsWith("Explore the Smart Option Trading")';
        this.optionChainButton = 'android=new UiSelector().descriptionStartsWith("Option chain Button")';
        // Trending Options on F&O: "Most Traded\nTab 1 of 2" / "Highest OI\nTab 2 of 2", with real
        // selected="true" on the current tab (verified live).
        this.trendingTab = label => `//*[starts-with(@content-desc,"${label}") and contains(@content-desc," of 2")]`;

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
        this.seeAllFiiDii = 'android=new UiSelector().descriptionStartsWith("See all FII/DII")';
        this.fiiDiiTitle = 'android=new UiSelector().description("FII/DII")';
        // Which FII "See all" screen the FII/DII "See all" helpers below are driving - Equity's
        // FII/DII by default, or F&O's FII (see useFnoFiiSeeAll).
        this.fiiSeeAll = { name: 'FII/DII', title: this.fiiDiiTitle, close: this.backButton, segments: FII_DII_SEGMENTS };

        // Global search bar under the index ticker - a Button with no content-desc, only the hint
        // "Search Globe" (verified live). It opens the search screen, whose field is that screen's
        // first Button (hint "Add or search stocks", dropped once text is typed) - same as
        // BasketPage.searchField - with "Cancel" beside it.
        this.globalSearchBar = '//android.widget.Button[@hint="Search Globe"]';
        this.searchField = 'android=new UiSelector().className("android.widget.Button").instance(0)';
        this.searchCancelButton = 'android=new UiSelector().description("Cancel")';
        this.seeAllRecentlyViewed = 'android=new UiSelector().descriptionStartsWith("See all Last Visited")';
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

    // Taps the F&O segment tab and checks it reports selected="true" (same real attribute as Equity).
    async clickFnoTab(timeout = 8000) {
        return this.clickSegmentTab('F&O', this.fnoTab, timeout);
    }

    // Commodity carries the same real selected="true" attribute as the other segment tabs.
    async clickCommodityTab(timeout = 8000) {
        return this.clickSegmentTab('Commodity', this.commodityTab, timeout);
    }

    async clickCurrencyTab(timeout = 8000) {
        return this.clickSegmentTab('Currency', this.currencyTab, timeout);
    }

    // Segment tab selector for an INSIGHTS entry.
    segmentTabOf(insights) {
        return { 'F&O': this.fnoTab, Commodity: this.commodityTab, Currency: this.currencyTab }[insights.segment];
    }

    async isSegmentTabSelected(selector) {
        return (await (await this.driver.$(selector)).getAttribute('selected').catch(() => null)) === 'true';
    }

    async clickSegmentTab(name, selector, timeout = 8000) {
        await this.click(selector, timeout);
        console.log(`Clicked ${name} tab`);
        await this.pause(2000);
        const selected = await this.isSegmentTabSelected(selector);
        console.log(`${name} tab selected: ${selected ? 'PASS' : 'FAIL'}`);
        return selected;
    }

    // F&O (or Commodity) Market Insights rows currently on screen, as { symbol, exchange, desc, node }.
    // Same row shape as Equity's Market Movers ("..., or swipe right for next category"), so
    // moversRow's test is reused.
    async getFnoInsightRows() {
        const nodes = await this.getDescribedElements();
        return nodes
            .filter(n => n.desc.includes('Double tap to view') && n.desc.includes('next category'))
            .map(n => ({ ...parseFnoInsightRow(n.desc), node: n }));
    }

    // Logs whether `label` lists any symbols, and whether every one is an F&O (NFO/BFO) contract.
    logFnoInsightRows(label, rows) {
        return this.logInsightRows(INSIGHTS.fno, label, rows);
    }

    // Logs whether `label` lists any symbols, and whether every one is on one of `insights`'
    // exchanges (an INSIGHTS entry).
    logInsightRows(insights, label, rows) {
        const { section, exchanges, kind } = insights;
        if (!rows.length) {
            console.log(`${section} "${label}" - symbols listed: 0 - FAIL`);
            return false;
        }
        console.log(`${section} "${label}" - symbols listed: ${rows.length} - PASS`);
        rows.forEach(r => console.log(`  ${r.symbol} (${r.exchange || '?'})`));
        const foreign = rows.filter(r => !exchanges.includes(r.exchange));
        console.log(`All "${label}" symbols are ${kind} (${exchanges.join('/')}) contracts: ${foreign.length ? `FAIL - ${foreign.map(r => `${r.symbol} (${r.exchange || '?'})`).join(', ')}` : 'PASS'}`);
        return foreign.length === 0;
    }

    // On landing on F&O, Tab 1 of the F&O Market Insights row must be "Top Gainers", selected, and
    // listing F&O symbols. Checked as found - before any rewind - so a stale selection shows as FAIL.
    async verifyFnoInsightsDefault() {
        return this.verifyInsightsDefault(INSIGHTS.fno);
    }

    async verifyCommodityInsightsDefault() {
        return this.verifyInsightsDefault(INSIGHTS.commodity);
    }

    async verifyCurrencyInsightsDefault() {
        return this.verifyInsightsDefault(INSIGHTS.currency);
    }

    async verifyInsightsDefault(insights) {
        const tabs = await this.getMoversTabs();
        const total = tabs.length ? tabs[0].total : 0;
        const first = tabs.find(t => t.index === 1);
        let selected = false;
        if (first) {
            const el = await this.driver.$(`(//*[contains(@content-desc,"Tab 1 of ${total}")])[last()]`);
            selected = (await el.getAttribute('selected').catch(() => null)) === 'true';
        }
        const isTopGainers = !!first && first.label === 'Top Gainers';
        console.log(`${insights.section} tab 1: "${first ? first.label : 'not found'}" - ${isTopGainers ? 'PASS' : 'FAIL (expected "Top Gainers")'}`);
        console.log(`Top Gainers selected by default: ${isTopGainers && selected ? 'PASS' : 'FAIL'}`);
        const rows = await this.getFnoInsightRows();
        const allOnSegment = this.logInsightRows(insights, 'Top Gainers', rows);
        return isTopGainers && selected && allOnSegment;
    }

    // Taps F&O Market Insights sub-tab `index` of `total` and checks it lists F&O symbols.
    async clickFnoInsightsTab(index, total) {
        return this.clickInsightsTab(INSIGHTS.fno, index, total);
    }

    // Taps Commodity Market Insights sub-tab `index` of `total` and checks it lists MCX symbols.
    async clickCommodityInsightsTab(index, total) {
        return this.clickInsightsTab(INSIGHTS.commodity, index, total);
    }

    async clickCurrencyInsightsTab(index, total) {
        return this.clickInsightsTab(INSIGHTS.currency, index, total);
    }

    async clickInsightsTab(insights, index, total) {
        const result = await this.clickMoversTab(index, total, 5000, insights.section);
        if (!result) return null;
        const rows = await this.getFnoInsightRows();
        this.logInsightRows(insights, result.label, rows);
        return { ...result, rows };
    }

    async clickSeeAllCommodityInsights(timeout = 8000) {
        return this.clickSeeAllInsights(INSIGHTS.commodity, timeout);
    }

    async clickSeeAllCurrencyInsights(timeout = 8000) {
        return this.clickSeeAllInsights(INSIGHTS.currency, timeout);
    }

    async clickSeeAllInsights(insights, timeout = 8000) {
        await this.clickSeeAllBeside(insights.section, this.seeAllCommodityInsights, timeout);
        console.log(`Clicked "See all" on ${insights.section}`);
    }

    async verifyCommodityInsightsSeeAllOpened(timeout = 8000) {
        return this.verifyInsightsSeeAllOpened(INSIGHTS.commodity, timeout);
    }

    async verifyCurrencyInsightsSeeAllOpened(timeout = 8000) {
        return this.verifyInsightsSeeAllOpened(INSIGHTS.currency, timeout);
    }

    // The full "<Segment> Market Insights" screen: title + Back button and a symbol list. The segment
    // tabs disappearing confirms it isn't still the Markets screen.
    async verifyInsightsSeeAllOpened(insights, timeout = 8000) {
        const backVisible = await this.isElementVisible(this.backButton, timeout);
        const titleVisible = backVisible && await this.isElementVisible(`android=new UiSelector().description("${insights.section}")`, 2000);
        const leftMarkets = titleVisible && !(await this.isElementVisible(this.segmentTabOf(insights), 500));
        const rows = leftMarkets ? await this.getFnoInsightRows() : [];
        const opened = leftMarkets && rows.length > 0;
        console.log(`${insights.section} "See all" screen opened (${rows.length} symbols listed): ${opened ? 'PASS' : 'FAIL'}`);
        return opened;
    }

    async navigateBackToCommodityInsightsSeeAll(from) {
        return this.navigateBackToInsightsSeeAll(INSIGHTS.commodity, from);
    }

    async navigateBackToCurrencyInsightsSeeAll(from) {
        return this.navigateBackToInsightsSeeAll(INSIGHTS.currency, from);
    }

    // Device back from a Quote opened on "<Segment> Market Insights" "See all" - expected to return
    // to that screen, as it does on F&O's.
    async navigateBackToInsightsSeeAll(insights, from) {
        await this.driver.back();
        await this.pause(1500);
        const back = await this.isElementVisible(this.backButton, 3000)
            && await this.isElementVisible(`android=new UiSelector().description("${insights.section}")`, 1000);
        console.log(`Back on ${insights.section} "See all" from ${from}: ${back ? 'PASS' : 'FAIL'}`);
        return back;
    }

    async closeCommodityInsightsSeeAll(timeout = 5000) {
        return this.closeInsightsSeeAll(INSIGHTS.commodity, timeout);
    }

    async closeCurrencyInsightsSeeAll(timeout = 5000) {
        return this.closeInsightsSeeAll(INSIGHTS.currency, timeout);
    }

    async closeInsightsSeeAll(insights, timeout = 5000) {
        await this.click(this.backButton, timeout);
        console.log(`Clicked Back on the ${insights.section} screen`);
    }

    async clickSeeAllFnoInsights(timeout = 8000) {
        await this.click(this.seeAllFnoInsights, timeout);
        console.log('Clicked "See all" on F&O Market Insights');
    }

    // The full F&O Market Insights screen: title + Back button, both filter dropdowns and a symbol
    // list. The segment tabs disappearing confirms it isn't still the Markets screen.
    async verifyFnoInsightsSeeAllOpened(timeout = 8000) {
        const backVisible = await this.isElementVisible(this.backButton, timeout);
        const titleVisible = backVisible && await this.isElementVisible(this.fnoInsightsTitle, 2000);
        const filtersVisible = titleVisible && await this.isElementVisible(this.expiryFilter, 2000) && await this.isElementVisible(this.instrumentFilter, 500);
        const leftMarkets = filtersVisible && !(await this.isElementVisible(this.fnoTab, 500));
        const rows = leftMarkets ? await this.getFnoInsightRows() : [];
        const opened = leftMarkets && rows.length > 0;
        console.log(`F&O Market Insights "See all" screen opened (${rows.length} symbols listed): ${opened ? 'PASS' : 'FAIL'}`);
        return opened;
    }

    // Current value of a filter dropdown ("Expiry filter. Selected 27 October 2026., ..." ->
    // "27 October 2026"), or null if the dropdown isn't on screen.
    async getFnoFilterSelection(selector) {
        try {
            const desc = await (await this.driver.$(selector)).getAttribute('content-desc');
            return (desc.match(/Selected (.+?)\.,/) || [])[1] || null;
        } catch (_) {
            return null;
        }
    }

    async verifyFnoFilterDefault(name, selector, expected) {
        const value = await this.getFnoFilterSelection(selector);
        const pass = value === expected;
        console.log(`${name} dropdown default: "${value}" - ${pass ? 'PASS' : `FAIL (expected "${expected}")`}`);
        return pass;
    }

    // Opens the Expiry dropdown and returns its options in listed order as { label, selected }. Each
    // option is "27 October 2026, Double tap to select 27 October 2026." - with ", selected" after
    // the label on the current one.
    async openExpiryFilter(timeout = 5000) {
        await this.click(this.expiryFilter, timeout);
        console.log('Clicked the Expiry dropdown');
        await this.pause(1200);
        const nodes = await this.getDescribedElements();
        const options = nodes
            .map(n => n.desc.match(/^(.+?), (selected, )?Double tap to select /))
            .filter(Boolean)
            .map(m => ({ label: m[1], selected: !!m[2] }));
        console.log(`Expiry options: ${options.map(o => o.label + (o.selected ? ' (selected)' : '')).join(', ') || 'none - FAIL'}`);
        return options;
    }

    // Taps `label` in the open Expiry sheet (which closes it), then checks the dropdown shows it and
    // the list holds only that expiry's contracts.
    async selectExpiryOption(label, timeout = 5000) {
        await this.click(`android=new UiSelector().descriptionStartsWith("${label},")`, timeout);
        console.log(`Selected expiry "${label}"`);
        await this.pause(2500);
        const shown = await this.getFnoFilterSelection(this.expiryFilter);
        console.log(`Expiry dropdown now shows "${shown}": ${shown === label ? 'PASS' : `FAIL (expected "${label}")`}`);
        const rows = await this.getFnoInsightRows();
        return { shown, rows, matches: this.verifyRowsMatchExpiry(label, rows) };
    }

    // Contract names carry their expiry as DDMON ("KAYNES 27OCT FUT"). "All Expiry" only needs some
    // symbols listed; a dated expiry ("27 October 2026") needs every listed contract to be on it.
    verifyRowsMatchExpiry(label, rows) {
        if (!rows.length) {
            console.log(`Symbols listed for "${label}": 0 - FAIL`);
            return false;
        }
        const expiryOf = r => contractExpiry(r.symbol);
        const seen = [...new Set(rows.map(r => (expiryOf(r) || { text: '?' }).text))];
        console.log(`Symbols listed for "${label}": ${rows.length} - PASS (expiries: ${seen.join(', ')})`);
        rows.forEach(r => console.log(`  ${r.symbol} (${r.exchange || '?'})`));
        const wanted = parseFiiDiiDate(label);
        if (!wanted) {
            if (label !== 'All Expiry') console.log(`Could not parse expiry "${label}" - skipping the per-symbol expiry check`);
            return true;
        }
        const mismatched = rows.filter(r => {
            const e = expiryOf(r);
            return !e || e.day !== wanted.getDate() || e.month !== wanted.getMonth();
        });
        console.log(`All symbols expire on ${label}: ${mismatched.length ? `FAIL - ${mismatched.map(r => r.symbol).join(', ')}` : 'PASS'}`);
        return mismatched.length === 0;
    }

    async closeFnoInsightsSeeAll(timeout = 5000) {
        await this.click(this.backButton, timeout);
        console.log('Clicked Back on the F&O Market Insights screen');
    }

    // Scrolls F&O until the NxtOption banner sits fully above the floating bottom nav (right below
    // F&O Market Insights it can be partly behind it), then returns its node. The banner is near the
    // top, so the page is only scrolled back up when the banner isn't already on screen.
    async scrollToNxtOptionBanner(maxScrolls = 5) {
        const isBanner = n => n.desc.startsWith('Explore the Smart Option Trading');
        if (!(await this.getDescribedElements()).some(isBanner)) await this.scrollToTop();
        const { height } = await this.driver.getWindowSize();
        for (let i = 0; i <= maxScrolls; i++) {
            const nodes = await this.getDescribedElements();
            const navTop = (nodes.find(n => n.desc === 'Watchlist') || { y1: Math.floor(height * 0.87) }).y1;
            const banner = nodes.find(isBanner);
            if (banner && banner.y2 <= navTop) return banner;
            if (i < maxScrolls) await this.nudgeDown();
        }
        console.log(`NxtOption banner not found on Markets after ${maxScrolls} scrolls: FAIL`);
        return null;
    }

    // Taps the NxtOption banner and checks its popup lists Strategy Builder, IV Analysis and OI
    // Analysis.
    async clickNxtOptionBanner() {
        const banner = await this.scrollToNxtOptionBanner();
        if (!banner) return false;
        await this.tapNode(banner);
        console.log('Clicked the NxtOption banner');
        await this.pause(1500);
        let missing = [];
        for (const tool of Object.keys(NXT_OPTION_TOOLS)) {
            if (!(await this.isElementVisible(`android=new UiSelector().description("${tool}")`, 3000))) missing.push(tool);
        }
        console.log(`NxtOption popup shows ${Object.keys(NXT_OPTION_TOOLS).join(', ')}: ${missing.length ? `FAIL - missing ${missing.join(', ')}` : 'PASS'}`);
        return missing.length === 0;
    }

    // Taps `tool` in the NxtOption popup and waits (its data loads first) for that screen's own
    // labels, with the Markets segment tabs gone.
    async openNxtOptionTool(tool, timeout = 15000) {
        await this.click(`android=new UiSelector().description("${tool}")`, 5000);
        console.log(`Clicked ${tool}`);
        const markers = NXT_OPTION_TOOLS[tool];
        let found = [];
        await this.driver.waitUntil(async () => {
            const labels = new Set((await this.getDescribedElements()).map(n => n.desc.split('\n')[0]));
            found = markers.filter(m => labels.has(m));
            return found.length === markers.length && !labels.has('F&O');
        }, { timeout, interval: 1000 }).catch(() => { });
        const opened = found.length === markers.length && !(await this.isElementVisible(this.fnoTab, 500));
        console.log(`App navigated to ${tool} (${markers.join(', ')} shown): ${opened ? 'PASS' : `FAIL - found only ${found.join(', ') || 'none'}`}`);
        return opened;
    }

    // On an open NxtOption tool: taps each of its NXT_OPTION_TOOL_TAPS labels in turn (Strategy
    // Builder's Buy Call, IV/OI Analysis' tabs) and waits on each for its data/graph to load. Labels
    // are matched on the content-desc's first line ("IV Charts\nTab 1 of 2"), case-insensitively.
    // Returns false if any label is missing or still loading after its wait.
    async exploreNxtOptionTool(tool) {
        const { labels, waitMs } = NXT_OPTION_TOOL_TAPS[tool];
        let ok = true;
        for (const label of labels) {
            const node = (await this.getDescribedElements())
                .find(n => n.desc.split('\n')[0].trim().toLowerCase() === label.toLowerCase());
            if (!node) {
                console.log(`${tool}: "${label}" not found: FAIL`);
                ok = false;
                continue;
            }
            await this.tapNode(node);
            console.log(`${tool}: clicked "${label}" - waiting ${waitMs / 1000}s for the data to load...`);
            await this.pause(waitMs);
            const loading = await this.isElementVisible(NXT_OPTION_LOADER, 500);
            console.log(`${tool}: "${label}" data loaded: ${loading ? 'FAIL (still loading)' : 'PASS'}`);
            if (loading) ok = false;
        }
        return ok;
    }

    // Scrolls F&O down from where it is (see wrapToTopAtBottom) until section `title`'s heading and
    // tab row are on screen with the next section's heading below them - i.e. its whole list is visible.
    async scrollToFnoSection(title, maxScrolls = 8) {
        const wrap = { last: null, wrapped: false };
        for (let i = 0; i <= maxScrolls; i++) {
            const nodes = await this.getDescribedElements();
            if (await this.wrapToTopAtBottom(nodes, wrap)) { i = 0; continue; }
            const tabsBottom = (nodes.find(n => /^Equity\nTab 1 of \d+$/.test(n.desc)) || { y2: 0 }).y2;
            const heading = nodes.find(n => n.desc === title);
            if (heading && heading.y1 < tabsBottom) { wrap.last = null; await this.swipe('up'); }
            else if (heading && this.getSectionEnd(nodes, heading) !== null) {
                console.log(`"${title}" section is now visible`);
                return true;
            } else if (i < maxScrolls) await this.nudgeDown();
        }
        console.log(`Could not bring the "${title}" section on screen after ${maxScrolls} scrolls: FAIL`);
        return false;
    }

    // Trending Options ends at the "Future Index Contracts" heading.
    async scrollToTrendingOptions(insights = INSIGHTS.fno) {
        return this.scrollToFnoSection(insights.trending);
    }

    async scrollToTrendingCommodities() {
        return this.scrollToTrendingOptions(INSIGHTS.commodity);
    }

    async scrollToTrendingCurrencies() {
        return this.scrollToTrendingOptions(INSIGHTS.currency);
    }

    // Future Index Contracts ends at the "OI Analysis" heading.
    async scrollToFutureIndexContracts() {
        return this.scrollToFnoSection('Future Index Contracts');
    }

    // y where a section's list ends: the first plain heading below its tab row (not a tab, not a
    // row, not the floating bottom nav), or null if that isn't on screen yet.
    getSectionEnd(nodes, heading) {
        const nav = ['Watchlist', 'Market', 'Orders', 'Portfolio', 'Mutual Funds'];
        const next = nodes
            .filter(n => n.y1 > heading.y2 && !nav.includes(n.desc) && !/\nTab \d+ of \d+$/.test(n.desc) && !n.desc.includes('Double tap to view'))
            .sort((a, b) => a.y1 - b.y1)[0];
        return next ? next.y1 : null;
    }

    // Trending Options rows on screen (between its tab row and the next section), parsed like the
    // F&O Market Insights rows - the two sections share one row shape. Same for Commodity's
    // "Trending Commodities Options" (pass INSIGHTS.commodity).
    async getTrendingOptionRows(insights = INSIGHTS.fno) {
        const nodes = await this.getDescribedElements();
        const heading = nodes.find(n => n.desc === insights.trending);
        if (!heading) return [];
        const end = this.getSectionEnd(nodes, heading) ?? Infinity;
        return nodes
            .filter(n => n.y1 > heading.y2 && n.y2 <= end && n.desc.includes('Double tap to view') && n.desc.includes('next category'))
            .map(n => ({ ...parseFnoInsightRow(n.desc), node: n }));
    }

    // Future Index Contracts rows on screen, top to bottom: "Index NIFTY 27OCT FUT. Exchange NFO.
    // Expiry 2026-10-27. Last traded price ..., Double tap to view NIFTY 27OCT FUT details."
    async getFutureIndexRows() {
        const nodes = await this.getDescribedElements();
        const heading = nodes.find(n => n.desc === 'Future Index Contracts');
        if (!heading) return [];
        const end = this.getSectionEnd(nodes, heading) ?? Infinity;
        return nodes
            .filter(n => n.y1 > heading.y2 && n.y2 <= end && /^Index .+\. Exchange \w+\. Expiry \d{4}-\d{2}-\d{2}\./.test(n.desc))
            .sort((a, b) => a.y1 - b.y1)
            .map(n => ({
                symbol: moverSymbol(n.desc),
                exchange: (n.desc.match(/Exchange (\w+)\./) || [])[1] || null,
                expiry: n.desc.match(/Expiry (\d{4}-\d{2}-\d{2})\./)[1],
                node: n,
            }));
    }

    // Future Index Contracts tabs on screen ("Nifty 50\nTab 1 of 5", ...) - those between its heading
    // and its first row, so the other sections' "of 5" tabs never count.
    async getFutureIndexTabs() {
        const nodes = await this.getDescribedElements();
        const heading = nodes.find(n => n.desc === 'Future Index Contracts');
        if (!heading) return [];
        const end = this.getSectionEnd(nodes, heading) ?? Infinity;
        return nodes
            .filter(n => n.y1 >= heading.y2 && n.y2 <= end)
            .map(n => n.desc.match(/^(.+)\nTab (\d+) of (\d+)$/))
            .filter(Boolean)
            .map(m => ({ label: m[1], index: Number(m[2]), total: Number(m[3]) }));
    }

    async getSelectedFutureIndexTab() {
        for (const t of await this.getFutureIndexTabs()) {
            const el = await this.driver.$(`(//*[contains(@content-desc,"Tab ${t.index} of ${t.total}")])[last()]`);
            if ((await el.getAttribute('selected').catch(() => null)) === 'true') return t.label;
        }
        return null;
    }

    // Same click-only tab row as the others: it keeps its scroll offset (seen left on BANKEX, with
    // Nifty 50 out of the tree), so it is rewound by tapping the left-most visible tab until Tab 1.
    async rewindFutureIndexTabs(maxTaps = 6) {
        for (let i = 0; i < maxTaps; i++) {
            const tabs = await this.getFutureIndexTabs();
            if (!tabs.length) break;
            const first = tabs.reduce((a, b) => (b.index < a.index ? b : a));
            await (await this.driver.$(`(//*[contains(@content-desc,"Tab ${first.index} of ${first.total}")])[last()]`)).click();
            await this.pause(800);
            if (first.index === 1) return true;
        }
        console.log('Could not rewind the Future Index Contracts tab row to Tab 1');
        return false;
    }

    // Taps Future Index Contracts tab `label` and checks it reports selected. Tabs further right only
    // enter the tree once their left neighbour is tapped, so tap them in order.
    async clickFutureIndexTab(label, timeout = 5000) {
        const tab = (await this.getFutureIndexTabs()).find(t => t.label === label);
        if (!tab) {
            console.log(`Future Index Contracts "${label}" tab not found: FAIL`);
            return false;
        }
        const sel = `(//*[contains(@content-desc,"Tab ${tab.index} of ${tab.total}")])[last()]`;
        await this.click(sel, timeout);
        await this.pause(2000);
        const selected = (await (await this.driver.$(sel)).getAttribute('selected').catch(() => null)) === 'true';
        console.log(`Clicked Future Index Contracts "${label}" tab - selected: ${selected ? 'PASS' : 'FAIL'}`);
        return selected;
    }

    // Which badge a row shows, read from the screenshot's colours (see isGreyBadge above).
    classifyExpiryBadge(img, scale, node) {
        let red = 0, green = 0, grey = 0;
        const x1 = Math.round(node.x1 * scale), x2 = Math.round((node.x1 + (node.x2 - node.x1) * 0.45) * scale);
        const y1 = Math.round(((node.y1 + node.y2) / 2) * scale), y2 = Math.round(node.y2 * scale);
        for (let y = y1; y < y2; y += 2) {
            for (let x = x1; x < x2; x += 2) {
                const p = pixelAt(img, x, y);
                if (isRedBar(p)) red++;
                else if (isGreenBar(p)) green++;
                else if (isGreyBadge(p)) grey++;
            }
        }
        if (green >= BADGE_MIN_PX && green > red) return 'Current Expiry';
        if (red >= BADGE_MIN_PX) return 'Far Expiry';
        if (grey >= NEXT_BADGE_MIN_GREY_PX) return 'Next Expiry';
        return null;
    }

    // `tab` must list exactly 3 contracts - Current, Next and Far Expiry, in that order - each an F&O
    // contract whose expiry is later than the one above it.
    async verifyFutureIndexCategories(tab) {
        const rows = await this.getFutureIndexRows();
        console.log(`Future Index Contracts "${tab}" - contracts listed: ${rows.length} - ${rows.length === EXPIRY_CATEGORIES.length ? 'PASS' : `FAIL (expected ${EXPIRY_CATEGORIES.length})`}`);
        if (!rows.length) return false;
        const img = decodePng(Buffer.from(await this.driver.takeScreenshot(), 'base64'));
        const { width } = await this.driver.getWindowSize();
        const scale = img.width / width;
        let allOk = rows.length === EXPIRY_CATEGORIES.length;
        rows.forEach((r, i) => {
            const badge = this.classifyExpiryBadge(img, scale, r.node);
            const expected = EXPIRY_CATEGORIES[i] || null;
            const isFno = FNO_EXCHANGES.includes(r.exchange);
            const later = i === 0 || r.expiry > rows[i - 1].expiry;
            const ok = badge === expected && isFno && later;
            allOk = allOk && ok;
            console.log(`  ${r.symbol} (${r.exchange}, expiry ${r.expiry}): ${badge || 'no badge'}${expected ? ` - expected ${expected}` : ''}${isFno ? '' : ' - not an F&O contract'}${later ? '' : ' - expiry not later than the row above'}: ${ok ? 'PASS' : 'FAIL'}`);
        });
        console.log(`"${tab}" shows ${EXPIRY_CATEGORIES.join(', ')}: ${allOk ? 'PASS' : 'FAIL'}`);
        return allOk;
    }

    // scrollToFnoSection can stop with only a section's heading and controls on screen (OI Analysis
    // and Rollover Analysis sit low on F&O) - nudge on until the heading is in the upper half and its
    // rows are visible below. Back from a Quote, F&O keeps its scroll offset - so when the heading
    // is already on screen it is used as-is instead of scrolling to the top and back down each time.
    async scrollFnoSectionIntoView(title, maxNudges = 3) {
        const onScreen = (await this.getDescribedElements()).some(n => n.desc === title);
        if (!onScreen && !(await this.scrollToFnoSection(title))) return false;
        const { height } = await this.driver.getWindowSize();
        for (let i = 0; i < maxNudges; i++) {
            const heading = (await this.getDescribedElements()).find(n => n.desc === title);
            if (heading && heading.y1 < height * 0.5) break;
            await this.nudgeDown();
            await this.pause(800);
        }
        return true;
    }

    async scrollToOiAnalysis() {
        return this.scrollFnoSectionIntoView('OI Analysis');
    }

    async scrollToRolloverAnalysis() {
        return this.scrollFnoSectionIntoView('Rollover Analysis');
    }

    // Rollover Analysis' two toggles (verified live): "Segment. Currently selected INDEX., click left
    // or right to choose another option." and "Roll over type. Currently selected HIGH., ...". Each
    // is one node - tapping its left half picks the first option, its right half the second.
    async getRolloverToggles() {
        const nodes = await this.getDescribedElements();
        const read = prefix => {
            const node = nodes.find(n => n.desc.startsWith(prefix));
            return node ? { value: (node.desc.match(/Currently selected (\w+)/) || [])[1] || null, node } : null;
        };
        return { segment: read('Segment.'), type: read('Roll over type.') };
    }

    async verifyRolloverSelection(segment, type) {
        const t = await this.getRolloverToggles();
        const ok = t.segment?.value === segment && t.type?.value === type;
        console.log(`Rollover Analysis shows ${t.segment?.value || '?'}, ${t.type?.value || '?'} selected (expected ${segment}, ${type}): ${ok ? 'PASS' : 'FAIL'}`);
        return ok;
    }

    // Sets the Segment toggle to `segment` (INDEX/STOCK) and Roll over type to `type` (HIGH/LOW),
    // tapping only the toggles not already on the wanted option, then checks both.
    async selectRollover(segment, type) {
        const toggles = await this.getRolloverToggles();
        for (const [key, want, options] of [['segment', segment, ROLLOVER_SEGMENTS], ['type', type, ROLLOVER_TYPES]]) {
            const toggle = toggles[key];
            if (!toggle) {
                console.log(`Rollover Analysis ${key} toggle not found: FAIL`);
                return false;
            }
            if (toggle.value === want) continue;
            const { x1, x2, y1, y2 } = toggle.node;
            const x = options.indexOf(want) === 0 ? x1 + Math.round((x2 - x1) * 0.2) : x2 - Math.round((x2 - x1) * 0.2);
            await this.tapNode({ x1: x, x2: x, y1, y2 });
            await this.pause(2000);
        }
        console.log(`Clicked Rollover Analysis ${segment}, ${type}`);
        return this.verifyRolloverSelection(segment, type);
    }

    // Rollover Analysis rows on screen, top to bottom: "NIFTY 23NOV FUT. Rollover percentage 7.46
    // percent. Rollover cost 153.7. ..." - only rows fully above the floating bottom nav.
    async getRolloverRows() {
        const nodes = await this.getDescribedElements();
        const heading = nodes.find(n => n.desc === 'Rollover Analysis');
        if (!heading) return [];
        const { height } = await this.driver.getWindowSize();
        return nodes
            .filter(n => n.y1 > heading.y2 && n.y2 - n.y1 > 100 && n.y2 < height * 0.95)
            .map(n => ({ m: n.desc.match(ROLLOVER_ROW_RE), node: n }))
            .filter(r => r.m)
            .sort((a, b) => a.node.y1 - b.node.y1)
            .map(({ m, node }) => ({ symbol: m[1], percentage: Number(m[2]), cost: Number(m[3]), node }));
    }

    // The list must show the Symbol / Percentage% / Rollover cost column headers, and every row an
    // F&O future named with its expiry, plus its rollover percentage and cost.
    async verifyRolloverRows(label) {
        const nodes = await this.getDescribedElements();
        const heading = nodes.find(n => n.desc === 'Rollover Analysis');
        const missing = ROLLOVER_COLUMNS.filter(c => !nodes.some(n => n.desc.trim() === c && heading && n.y1 > heading.y2));
        console.log(`Rollover Analysis "${label}" - columns ${ROLLOVER_COLUMNS.join(', ')} shown: ${missing.length ? `FAIL - missing ${missing.join(', ')}` : 'PASS'}`);
        const rows = await this.getRolloverRows();
        const noData = !rows.length && await this.isElementVisible('android=new UiSelector().descriptionContains("No Data Found")', 500);
        if (!rows.length) {
            console.log(`Rollover Analysis "${label}" - symbols listed: 0${noData ? ' - "No Data Found" shown' : ' - FAIL'}`);
            return { ok: noData && !missing.length, rows, noData };
        }
        console.log(`Rollover Analysis "${label}" - symbols listed: ${rows.length} - PASS`);
        rows.forEach(r => console.log(`  ${r.symbol} | Percentage ${r.percentage}% | Rollover cost ${r.cost}`));
        const notFno = rows.filter(r => !/\bFUT$/.test(r.symbol) || !contractExpiry(r.symbol));
        console.log(`All "${label}" symbols are F&O futures with an expiry: ${notFno.length ? `FAIL - ${notFno.map(r => r.symbol).join(', ')}` : 'PASS'}`);
        return { ok: !missing.length && !notFno.length, rows, noData };
    }

    async clickSeeAllRollover(timeout = 8000) {
        await this.click(this.seeAllRollover, timeout);
        console.log('Clicked "See all" on Rollover Analysis');
    }

    // "See all" is a full screen titled "Rollover Analysis" with Highest/Lowest Rollover tabs and no
    // Markets segment tabs.
    async verifyRolloverSeeAllOpened(timeout = 8000) {
        const opened = await this.isElementVisible('android=new UiSelector().descriptionStartsWith("Highest Rollover")', timeout)
            && await this.isElementVisible('android=new UiSelector().description("Rollover Analysis")', 1000)
            && !(await this.isElementVisible(this.fnoTab, 500));
        console.log(`Rollover Analysis "See all" screen opened: ${opened ? 'PASS' : 'FAIL'}`);
        return opened;
    }

    // Device back from a Quote opened on Rollover "See all" returns to that screen (verified live).
    async navigateBackToRolloverSeeAll(from) {
        await this.driver.back();
        await this.pause(1500);
        const back = await this.isElementVisible('android=new UiSelector().descriptionStartsWith("Highest Rollover")', 3000)
            && await this.isElementVisible('android=new UiSelector().description("Rollover Analysis")', 1000);
        console.log(`Back on Rollover Analysis "See all" from ${from}: ${back ? 'PASS' : 'FAIL'}`);
        return back;
    }

    // On "See all", HIGH/LOW is the selected tab. INDEX/STOCK is a left/right toggle like on F&O, but
    // its content-desc is wrong (verified live): it reads "Roll over type. Currently selected HIGH."
    // and its value doesn't follow taps - so the segment is read from the symbols listed instead:
    // all index futures -> INDEX, none -> STOCK, a mix -> null.
    async getRolloverSeeAllSelection() {
        let type = null;
        for (const [value, label] of Object.entries(ROLLOVER_SEE_ALL_TABS)) {
            const el = await this.driver.$(`android=new UiSelector().descriptionStartsWith("${label}")`);
            if ((await el.getAttribute('selected').catch(() => null)) === 'true') type = value;
        }
        const rows = await this.getRolloverRows();
        const isIndex = r => INDEX_FUTURE_ROOTS.includes(r.symbol.split(' ')[0]);
        const segment = !rows.length ? null : rows.every(isIndex) ? 'INDEX' : rows.some(isIndex) ? null : 'STOCK';
        return { segment, type };
    }

    async verifyRolloverSeeAllSelection(segment, type) {
        const s = await this.getRolloverSeeAllSelection();
        const ok = s.segment === segment && s.type === type;
        console.log(`Rollover Analysis "See all" shows ${s.segment || '?'} symbols on "${ROLLOVER_SEE_ALL_TABS[s.type] || '?'}" (expected ${segment}, "${ROLLOVER_SEE_ALL_TABS[type]}"): ${ok ? 'PASS' : 'FAIL'}`);
        return ok;
    }

    // Picks `type` (HIGH/LOW) by its tab and `segment` (INDEX/STOCK) by tapping the toggle's left or
    // right half - each only when not already showing - then checks both.
    async selectRolloverSeeAll(segment, type) {
        const current = await this.getRolloverSeeAllSelection();
        if (current.type !== type) {
            await this.click(`android=new UiSelector().descriptionStartsWith("${ROLLOVER_SEE_ALL_TABS[type]}")`, 5000);
            await this.pause(2000);
        }
        if ((await this.getRolloverSeeAllSelection()).segment !== segment) {
            const toggle = (await this.getDescribedElements()).find(n => /Currently selected/.test(n.desc));
            if (!toggle) {
                console.log('Rollover Analysis "See all" segment toggle not found: FAIL');
                return false;
            }
            const { x1, x2, y1, y2 } = toggle;
            const x = ROLLOVER_SEGMENTS.indexOf(segment) === 0 ? x1 + Math.round((x2 - x1) * 0.2) : x2 - Math.round((x2 - x1) * 0.2);
            await this.tapNode({ x1: x, x2: x, y1, y2 });
            await this.pause(2000);
        }
        console.log(`Clicked Rollover Analysis "See all" ${segment}, "${ROLLOVER_SEE_ALL_TABS[type]}"`);
        return this.verifyRolloverSeeAllSelection(segment, type);
    }

    // FII Trend in F&O is the last F&O section, so scrolling to the bottom brings it whole on screen.
    // Returns readFiiTrend()'s snapshot, or null if the heading isn't on screen.
    async scrollToFiiTrend() {
        await this.scrollToBoundaryByMovement('down', { maxScrolls: 25 });
        await this.pause(800);
        const trend = await this.readFiiTrend();
        console.log(trend ? '"FII Trend in F&O" section is now visible' : 'Could not bring the "FII Trend in F&O" section on screen: FAIL');
        return trend;
    }

    // { dateText, date, filter, filterNode, seeAllNode, rows: [{ label, valueText, value, labelNode,
    // valueNode }] } for the section as currently shown, or null if its heading isn't on screen.
    async readFiiTrend() {
        const nodes = await this.getDescribedElements();
        const heading = nodes.find(n => n.desc === 'FII Trend in F&O');
        if (!heading) return null;
        const below = nodes.filter(n => n.y1 >= heading.y1);
        const dateNode = below.find(n => /^As on /.test(n.desc.trim()));
        const dateText = dateNode ? dateNode.desc.trim().replace(/^As on /, '') : null;
        const filterNode = below.find(n => FNO_FII_FILTERS.includes(n.desc.trim()));
        const seeAllNode = below.find(n => n.desc === 'See All' && n.y1 < heading.y2 && n.y2 > heading.y1) || null;
        const rows = FNO_FII_ROWS.map(label => {
            const labelNode = below.find(n => n.desc === label);
            if (!labelNode) return null;
            const mid = (labelNode.y1 + labelNode.y2) / 2;
            const valueNode = below.find(n => n !== labelNode && n.x1 > labelNode.x2 && n.y1 <= mid && n.y2 >= mid
                && /^-?[\d,]+(\.\d+)?( Cr)?$/.test(n.desc.trim()));
            const valueText = valueNode ? valueNode.desc.trim() : null;
            return { label, valueText, value: valueText === null ? null : Number(valueText.replace(/[^\d.-]/g, '')), labelNode, valueNode };
        }).filter(Boolean);
        return { dateText, date: dateText ? parseFiiDiiDate(dateText) : null, filter: filterNode ? filterNode.desc.trim() : null, filterNode, seeAllNode, rows };
    }

    // The "As on" date must be today or at most `maxDays` calendar days back (a Monday still shows
    // Friday's figures).
    verifyFiiTrendDate(trend, maxDays = 3) {
        if (!trend || !trend.date) {
            console.log(`FII Trend in F&O date displayed: FAIL (${trend && trend.dateText ? `could not parse "${trend.dateText}"` : 'not shown'})`);
            return false;
        }
        const now = new Date();
        const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
        const daysOld = Math.round((today - trend.date) / (24 * 60 * 60 * 1000));
        const ok = daysOld >= 0 && daysOld <= maxDays;
        console.log(`FII Trend in F&O date "${trend.dateText}" - ${daysOld} day(s) old, not older than ${maxDays} days: ${ok ? 'PASS' : daysOld < 0 ? 'FAIL (in the future)' : 'FAIL'}`);
        return ok;
    }

    // Exactly Buy, Sell and Net Positions, in that order, each valued in crores ("36,284.48 Cr").
    verifyFiiTrendRows(trend, label = trend && trend.filter) {
        const rows = trend ? trend.rows : [];
        const labels = rows.map(r => r.label);
        const orderOk = labels.length === FNO_FII_ROWS.length && FNO_FII_ROWS.every((l, i) => labels[i] === l);
        console.log(`FII Trend in F&O "${label}" rows: ${labels.join(', ') || 'none'} - ${orderOk ? 'PASS' : `FAIL (expected ${FNO_FII_ROWS.join(', ')})`}`);
        let valuesOk = rows.length > 0;
        rows.forEach(r => {
            const ok = r.valueText !== null && / Cr$/.test(r.valueText) && !Number.isNaN(r.value);
            valuesOk = valuesOk && ok;
            console.log(`  ${r.label}: ${r.valueText === null ? 'value not shown' : r.valueText} - ${ok ? 'PASS' : 'FAIL (expected a value in Cr)'}`);
        });
        return orderOk && valuesOk;
    }

    // Each row's own bar, read from a screenshot along the row's midline left of its label (the bars
    // are drawn only): { label, px, colour } - px is the bar's length in coloured pixels.
    async measureFiiTrendBars(trend) {
        const rows = trend ? trend.rows : [];
        if (!rows.length) return [];
        const img = decodePng(Buffer.from(await this.driver.takeScreenshot(), 'base64'));
        const { width } = await this.driver.getWindowSize();
        const scale = img.width / width;
        return rows.map(r => {
            const y = ((r.labelNode.y1 + r.labelNode.y2) / 2) * scale;
            let px = 0, sum = [0, 0, 0];
            for (let x = 0; x < Math.round((r.labelNode.x1 - 5) * scale); x++) {
                const p = pixelAt(img, x, y);
                if (!isBarPixel(p)) continue;
                px++;
                sum = sum.map((s, i) => s + p[i]);
            }
            const [cr, cg, cb] = sum;
            const colour = !px ? 'none' : cg >= cr && cg >= cb ? 'green' : cr >= cb ? 'red' : 'blue';
            return { label: r.label, px, colour };
        });
    }

    // Buy, Sell and Net Positions must each be drawn as their own bar.
    async verifyFiiTrendBars(trend, label = trend && trend.filter) {
        const bars = await this.measureFiiTrendBars(trend);
        let ok = bars.length === FNO_FII_ROWS.length;
        bars.forEach(b => {
            const drawn = b.px >= FII_TREND_MIN_BAR_PX;
            ok = ok && drawn;
            console.log(`  ${b.label}: ${drawn ? `${b.colour} bar, ${b.px}px long` : 'no bar drawn'} - ${drawn ? 'PASS' : 'FAIL'}`);
        });
        console.log(`FII Trend in F&O "${label}" - Buy, Sell, Net Positions each shown as its own bar: ${ok ? 'PASS' : 'FAIL'}`);
        return { ok, bars };
    }

    verifyFiiTrendFilter(trend, expected) {
        const ok = !!trend && trend.filter === expected;
        console.log(`FII Trend in F&O dropdown shows "${trend && trend.filter || 'nothing'}" (expected "${expected}"): ${ok ? 'PASS' : 'FAIL'}`);
        return ok;
    }

    // Opens the dropdown, picks `filter`, and returns the section re-read once the dropdown shows it.
    async selectFiiTrendFilter(filter, timeout = 6000) {
        const current = await this.readFiiTrend();
        if (!current || !current.filterNode) {
            console.log('FII Trend in F&O dropdown not found: FAIL');
            return current;
        }
        await this.tapNode(current.filterNode);
        await this.pause(1200);
        const option = (await this.getDescribedElements()).filter(n => n.desc === filter && n.clickable).pop();
        if (!option) {
            console.log(`FII Trend in F&O dropdown option "${filter}" not found: FAIL`);
            await this.driver.back();
            return current;
        }
        await this.tapNode(option);
        console.log(`Selected "${filter}" in the FII Trend in F&O dropdown`);
        let trend = null;
        const deadline = Date.now() + timeout;
        do {
            await this.pause(800);
            trend = await this.readFiiTrend();
        } while (!(trend && trend.filter === filter) && Date.now() < deadline);
        this.verifyFiiTrendFilter(trend, filter);
        return trend;
    }

    // After a new filter, the graph must change: different Buy/Sell/Net Positions values, or bars.
    verifyFiiTrendUpdated(before, after, beforeBars, afterBars) {
        const values = t => (t ? t.rows.map(r => r.valueText).join(' | ') : '');
        const lengths = b => b.map(x => x.px).join(' | ');
        const ok = values(before) !== values(after) || lengths(beforeBars) !== lengths(afterBars);
        console.log(`FII Trend in F&O graph updated from "${before && before.filter}" to "${after && after.filter}" (${values(after) || 'no values'}): ${ok ? 'PASS' : 'FAIL (same values and bars as before)'}`);
        return ok;
    }

    async clickSeeAllFiiTrend() {
        const trend = await this.readFiiTrend() || await this.scrollToFiiTrend();
        if (!trend || !trend.seeAllNode) {
            console.log('"See All" on FII Trend in F&O not found: FAIL');
            return false;
        }
        await this.tapNode(trend.seeAllNode);
        console.log('Clicked "See All" on FII Trend in F&O');
        return true;
    }

    // Points the FII/DII "See all" helpers (verifyFiiDiiSeeAllOpened, clickFiiDiiSegment,
    // verifyFiiDiiHistory, ...) at F&O's "FII" screen: its title, its X (no content-desc - the first
    // clickable image), and its rows per sub-tab.
    useFnoFiiSeeAll() {
        this.fiiSeeAll = {
            name: 'FII',
            title: 'android=new UiSelector().description("FII")',
            close: '(//android.widget.ImageView[@clickable="true"])[1]',
            segments: FNO_FII_SEGMENTS,
        };
    }

    // OI Analysis tabs on screen ("Long Buildup\nTab 1 of 4", ...) - those below its heading, so the
    // F&O segment tabs (also "of 4") never count.
    async getOiAnalysisTabs() {
        const nodes = await this.getDescribedElements();
        const heading = nodes.find(n => n.desc === 'OI Analysis');
        if (!heading) return [];
        return nodes
            .filter(n => n.y1 >= heading.y2)
            .map(n => n.desc.match(/^(.+)\nTab (\d+) of (\d+)$/))
            .filter(Boolean)
            .map(m => ({ label: m[1], index: Number(m[2]), total: Number(m[3]) }));
    }

    async getSelectedOiAnalysisTab() {
        for (const t of await this.getOiAnalysisTabs()) {
            const el = await this.driver.$(`(//*[contains(@content-desc,"Tab ${t.index} of ${t.total}")])[last()]`);
            if ((await el.getAttribute('selected').catch(() => null)) === 'true') return t.label;
        }
        return null;
    }

    // Taps OI Analysis tab `index` and checks it reports selected. Same click-only tab row as the
    // others - a tab only enters the tree once its neighbour is tapped, so the visible tab nearest to
    // `index` is tapped until `index` shows up (e.g. after the row was reset, or left scrolled).
    async clickOiAnalysisTab(index, maxSteps = 4) {
        let tab = null;
        for (let i = 0; i <= maxSteps; i++) {
            const tabs = await this.getOiAnalysisTabs();
            tab = tabs.find(t => t.index === index);
            if (tab || !tabs.length) break;
            const nearest = tabs.reduce((a, b) => (Math.abs(b.index - index) < Math.abs(a.index - index) ? b : a));
            await (await this.driver.$(`(//*[contains(@content-desc,"Tab ${nearest.index} of ${nearest.total}")])[last()]`)).click();
            await this.pause(800);
        }
        if (!tab) {
            console.log(`OI Analysis tab ${index} not found: FAIL`);
            return null;
        }
        const sel = `(//*[contains(@content-desc,"Tab ${tab.index} of ${tab.total}")])[last()]`;
        let selected = false;
        for (let attempt = 1; attempt <= 3 && !selected; attempt++) {
            await (await this.driver.$(sel)).click();
            await this.pause(1500);
            selected = (await (await this.driver.$(sel)).getAttribute('selected').catch(() => null)) === 'true';
        }
        console.log(`Clicked OI Analysis "${tab.label}" tab - selected: ${selected ? 'PASS' : 'FAIL'}`);
        return { label: tab.label, selected };
    }

    // OI Analysis rows on screen, top to bottom - only rows fully above the floating bottom nav, so
    // the first one is safe to tap.
    async getOiAnalysisRows() {
        const nodes = await this.getDescribedElements();
        const heading = nodes.find(n => n.desc === 'OI Analysis');
        if (!heading) return [];
        const { height } = await this.driver.getWindowSize();
        return nodes
            .filter(n => n.y1 > heading.y2 && n.y2 - n.y1 > 100 && n.y2 < height * 0.95)
            .map(n => ({ m: n.desc.match(OI_ROW_RE), node: n }))
            .filter(r => r.m)
            .sort((a, b) => a.node.y1 - b.node.y1)
            .map(({ m, node }) => ({ symbol: m[1], exchange: m[2], openInterest: Number(m[3]), price: Number(m[4]), node }));
    }

    // `label`'s list must show the Symbol / Open Interest / Price column headers, and every row an
    // F&O contract (or one on `insights`' own exchanges, e.g. INSIGHTS.commodity) named with its
    // expiry, plus its open interest and price.
    async verifyOiAnalysisRows(label, insights = INSIGHTS.fno) {
        const { exchanges, kind } = insights;
        const nodes = await this.getDescribedElements();
        const header = nodes.find(n => OI_COLUMNS.every(c => n.desc.split('\n').map(l => l.trim()).includes(c)));
        console.log(`OI Analysis "${label}" - columns ${OI_COLUMNS.join(', ')} shown: ${header ? 'PASS' : 'FAIL'}`);
        const rows = await this.getOiAnalysisRows();
        const noData = !rows.length && await this.isElementVisible('android=new UiSelector().descriptionContains("No Data Found")', 500);
        if (!rows.length) {
            console.log(`OI Analysis "${label}" - symbols listed: 0${noData ? ' - "No Data Found" shown' : ' - FAIL'}`);
            return { ok: noData && !!header, rows, noData };
        }
        console.log(`OI Analysis "${label}" - symbols listed: ${rows.length} - PASS`);
        rows.forEach(r => console.log(`  ${r.symbol} (${r.exchange}) | Open Interest ${r.openInterest} | Price ${r.price}`));
        const foreign = rows.filter(r => !exchanges.includes(r.exchange));
        console.log(`All "${label}" symbols are ${kind} (${exchanges.join('/')}) contracts: ${foreign.length ? `FAIL - ${foreign.map(r => `${r.symbol} (${r.exchange})`).join(', ')}` : 'PASS'}`);
        const noExpiry = rows.filter(r => !contractExpiry(r.symbol));
        console.log(`All "${label}" symbols show an expiry: ${noExpiry.length ? `FAIL - ${noExpiry.map(r => r.symbol).join(', ')}` : 'PASS'}`);
        const noValues = rows.filter(r => !(r.openInterest > 0) || !(r.price > 0));
        console.log(`All "${label}" symbols show Open Interest and Price: ${noValues.length ? `FAIL - ${noValues.map(r => r.symbol).join(', ')}` : 'PASS'}`);
        return { ok: !!header && !foreign.length && !noExpiry.length && !noValues.length, rows, noData };
    }

    // Commodity's OI Analysis - assumed to match F&O's (same tabs, row shape, message and "See all"),
    // with MCX contracts.
    async verifyCommodityOiAnalysisRows(label) {
        return this.verifyOiAnalysisRows(label, INSIGHTS.commodity);
    }

    async verifyCurrencyOiAnalysisRows(label) {
        return this.verifyOiAnalysisRows(label, INSIGHTS.currency);
    }

    // The explanation shown above the selected tab's list ("The prices and the open interest (OI),
    // both are rising. ...") - the text before the Symbol / Open Interest / Price headers on the
    // same node (verified live), or null.
    async getOiAnalysisMessage() {
        const node = (await this.getDescribedElements())
            .find(n => OI_COLUMNS.every(c => n.desc.split('\n').map(l => l.trim()).includes(c)));
        if (!node) return null;
        const lines = node.desc.split('\n').map(l => l.trim());
        return lines.slice(0, lines.indexOf(OI_COLUMNS[0])).join(' ').trim() || null;
    }

    // Commodity's "See all" links are plain "See All" nodes, several on screen at once (verified
    // live), so the one on `title`'s heading row is tapped - falling back to `selector` (F&O's "See
    // all <title>" shape) when there isn't one.
    async clickSeeAllBeside(title, selector, timeout = 8000) {
        const nodes = await this.getDescribedElements();
        const heading = nodes.find(n => n.desc === title);
        const seeAll = heading && nodes.find(n => n.desc === 'See All' && n.y1 < heading.y2 && n.y2 > heading.y1);
        if (seeAll) await this.tapNode(seeAll);
        else await this.click(selector, timeout);
    }

    async clickSeeAllOiAnalysis(timeout = 8000) {
        await this.clickSeeAllBeside('OI Analysis', this.seeAllOiAnalysis, timeout);
        console.log('Clicked "See all" on OI Analysis');
    }

    // "See all" opens a full screen titled "OI Analysis" with a back button and the same tabs - and
    // without the Markets segment tabs.
    async verifyOiAnalysisSeeAllOpened(timeout = 8000) {
        const opened = await this.isElementVisible(this.backButton, timeout)
            && await this.isElementVisible('android=new UiSelector().description("OI Analysis")', 2000)
            && !(await this.isElementVisible(this.fnoTab, 500));
        console.log(`OI Analysis "See all" screen opened: ${opened ? 'PASS' : 'FAIL'}`);
        return opened;
    }

    async isTrendingTabSelected(label, insights = INSIGHTS.fno) {
        const selected = (await (await this.driver.$(this.trendingTab(label))).getAttribute('selected').catch(() => null)) === 'true';
        console.log(`${insights.trending} "${label}" selected: ${selected ? 'PASS' : 'FAIL'}`);
        return selected;
    }

    async clickTrendingTab(label, timeout = 5000, insights = INSIGHTS.fno) {
        await this.click(this.trendingTab(label), timeout);
        console.log(`Clicked ${insights.trending} "${label}" tab`);
        await this.pause(2000);
    }

    // `label`'s list must hold F&O (NFO/BFO) contracts - or `insights`' own exchanges - each named
    // with its expiry (DDMON).
    async verifyTrendingOptionRows(label, insights = INSIGHTS.fno) {
        const { trending, exchanges, kind } = insights;
        const rows = await this.getTrendingOptionRows(insights);
        if (!rows.length) {
            console.log(`${trending} "${label}" - symbols listed: 0 - FAIL`);
            return false;
        }
        console.log(`${trending} "${label}" - symbols listed: ${rows.length} - PASS`);
        rows.forEach(r => console.log(`  ${r.symbol} (${r.exchange || '?'})`));
        const foreign = rows.filter(r => !exchanges.includes(r.exchange));
        console.log(`All "${label}" symbols are ${kind} (${exchanges.join('/')}) contracts: ${foreign.length ? `FAIL - ${foreign.map(r => `${r.symbol} (${r.exchange || '?'})`).join(', ')}` : 'PASS'}`);
        const noExpiry = rows.filter(r => !contractExpiry(r.symbol));
        console.log(`All "${label}" symbols show an expiry: ${noExpiry.length ? `FAIL - ${noExpiry.map(r => r.symbol).join(', ')}` : 'PASS'}`);
        return !foreign.length && !noExpiry.length;
    }

    // Commodity's "Trending Commodities Options" - assumed to have the same Most Traded / Highest OI
    // tabs and row shape as F&O's Trending Options, with MCX contracts.
    async getTrendingCommodityRows() {
        return this.getTrendingOptionRows(INSIGHTS.commodity);
    }

    async isTrendingCommodityTabSelected(label) {
        return this.isTrendingTabSelected(label, INSIGHTS.commodity);
    }

    async clickTrendingCommodityTab(label, timeout = 5000) {
        return this.clickTrendingTab(label, timeout, INSIGHTS.commodity);
    }

    async verifyTrendingCommodityRows(label) {
        return this.verifyTrendingOptionRows(label, INSIGHTS.commodity);
    }

    // Currency's "Trending Currencies Options" - same Most Traded / Highest OI tabs and row shape
    // (verified live), with CDS contracts.
    async getTrendingCurrencyRows() {
        return this.getTrendingOptionRows(INSIGHTS.currency);
    }

    async isTrendingCurrencyTabSelected(label) {
        return this.isTrendingTabSelected(label, INSIGHTS.currency);
    }

    async clickTrendingCurrencyTab(label, timeout = 5000) {
        return this.clickTrendingTab(label, timeout, INSIGHTS.currency);
    }

    async verifyTrendingCurrencyRows(label) {
        return this.verifyTrendingOptionRows(label, INSIGHTS.currency);
    }

    // Top Commodities on Commodity. Not captured in a dump yet, so its tabs and rows are found by
    // position rather than by name: the tab row is the first "...\nTab N of M" row under the
    // heading, and its rows are the "Double tap to view" nodes between that tab row and the next
    // section's heading. Works the same on its "See all" screen, which is headed by the same title.
    async scrollToTopCommodities(maxNudges = 3, title = this.topCommoditiesHeading) {
        const row = await this.scrollToSection(title, desc => /\nTab \d+ of \d+$/.test(desc) || desc.includes('Double tap to view'));
        if (!row) return false;
        // Stops as soon as the tab row clears the bottom nav - nudge on so the list is on screen too.
        const { height } = await this.driver.getWindowSize();
        for (let i = 0; i < maxNudges; i++) {
            const heading = (await this.getDescribedElements()).find(n => n.desc === title);
            if (!heading || heading.y1 < height * 0.5) break;
            await this.nudgeDown();
        }
        return true;
    }

    // Top Currencies on Currency: same heading / "See All" / row shape as Top Commodities, but no tab
    // row - its rows sit straight under the heading (verified live).
    async scrollToTopCurrencies(maxNudges = 3) {
        return this.scrollToTopCommodities(maxNudges, INSIGHTS.currency.top);
    }

    async getTopCommoditiesTabs(title = this.topCommoditiesHeading) {
        const nodes = await this.getDescribedElements();
        const heading = nodes.find(n => n.desc === title);
        if (!heading) return [];
        const tabs = nodes
            .filter(n => n.y1 >= heading.y2 && /\nTab \d+ of \d+$/.test(n.desc))
            .map(n => {
                const m = n.desc.match(/^(.+)\nTab (\d+) of (\d+)$/s);
                return m && { label: m[1].trim(), index: Number(m[2]), total: Number(m[3]), node: n };
            })
            .filter(Boolean);
        if (!tabs.length) return [];
        // Only the row right under the heading - any lower tab row belongs to the next section.
        const rowY = Math.min(...tabs.map(t => t.node.y1));
        return tabs.filter(t => t.node.y1 - rowY <= 15).sort((a, b) => a.index - b.index);
    }

    async getTopCommoditiesRows(title = this.topCommoditiesHeading) {
        const nodes = await this.getDescribedElements();
        const heading = nodes.find(n => n.desc === title);
        if (!heading) return [];
        const tabs = await this.getTopCommoditiesTabs(title);
        const top = tabs.length ? Math.max(...tabs.map(t => t.node.y2)) : heading.y2;
        // Rows run until the first plain node after them (the next section's heading) - anything
        // plain above the first row (column headers) is skipped. The bottom nav is never an end.
        const nav = ['Watchlist', 'Market', 'Orders', 'Portfolio', 'Mutual Funds'];
        const rows = [];
        for (const n of nodes.filter(n => n.y1 >= top).sort((a, b) => a.y1 - b.y1)) {
            if (n.desc.includes('Double tap to view')) rows.push(n);
            else if (rows.length && !nav.includes(n.desc) && !/\nTab \d+ of \d+$/.test(n.desc)) break;
        }
        return rows.map(n => ({ ...parseFnoInsightRow(n.desc), node: n }));
    }

    async getTopCurrenciesRows() {
        return this.getTopCommoditiesRows(INSIGHTS.currency.top);
    }

    // Top Currencies has no tabs, so its list is checked as it stands: symbols listed, all CDS.
    async verifyTopCurrenciesRows(where = INSIGHTS.currency.top) {
        const rows = await this.getTopCurrenciesRows();
        this.logInsightRows({ ...INSIGHTS.currency, section: where }, 'Top Currencies', rows);
        return rows;
    }

    // The tab node's own element, for its real selected="true" attribute: matched on its index/total
    // and label, and - should another section share them - on its on-screen y.
    async isTopCommoditiesTabSelected(tab) {
        const els = await this.driver.$$(`//*[contains(@content-desc,"Tab ${tab.index} of ${tab.total}")]`);
        for (const el of els) {
            const desc = await el.getAttribute('content-desc').catch(() => '');
            if (!desc.startsWith(tab.label)) continue;
            const { y } = await el.getLocation().catch(() => ({ y: -1 }));
            if (Math.abs(y - tab.node.y1) > 15) continue;
            return (await el.getAttribute('selected').catch(() => null)) === 'true';
        }
        return false;
    }

    // Like the movers rows, the tab row is assumed click-only with a kept scroll offset - rewound by
    // tapping the left-most visible tab until Tab 1 is selected.
    async rewindTopCommoditiesTabs(maxTaps = 8) {
        for (let i = 0; i < maxTaps; i++) {
            const tabs = await this.getTopCommoditiesTabs();
            if (!tabs.length) break;
            await this.tapNode(tabs[0].node);
            await this.pause(800);
            if (tabs[0].index === 1) {
                console.log(`Top Commodities tab row rewound to "${tabs[0].label}"`);
                return true;
            }
        }
        console.log('Could not rewind the Top Commodities tab row to Tab 1');
        return false;
    }

    // Taps Top Commodities tab `index` and checks it is selected and lists symbols - FAIL if either
    // isn't the case. Tapping a tab is expected to bring the next one into view, as on Market Movers.
    async clickTopCommoditiesTab(index, where = 'Top Commodities') {
        let tab = (await this.getTopCommoditiesTabs()).find(t => t.index === index);
        if (!tab) {
            console.log(`${where} tab ${index} not found: FAIL`);
            return null;
        }
        let selected = false;
        for (let attempt = 1; attempt <= 3 && !selected; attempt++) {
            await this.tapNode(tab.node);
            await this.pause(1500);
            tab = (await this.getTopCommoditiesTabs()).find(t => t.index === index) || tab;
            selected = await this.isTopCommoditiesTabSelected(tab);
            if (!selected && attempt < 3) console.log(`${where} "${tab.label}" tab not selected after tap ${attempt} - tapping again`);
        }
        const rows = await this.getTopCommoditiesRows();
        const noData = !rows.length && await this.isElementVisible('android=new UiSelector().description("No Data Found!")', 500);
        console.log(`${where} "${tab.label}" tab (${index} of ${tab.total}) selected: ${selected ? 'PASS' : 'FAIL'}`);
        console.log(`${where} "${tab.label}" - symbols listed: ${rows.length} - ${rows.length ? 'PASS' : `FAIL${noData ? ' ("No Data Found!" shown)' : ''}`}`);
        rows.forEach(r => console.log(`  ${r.symbol} (${r.exchange || '?'})`));
        return { label: tab.label, total: tab.total, selected, rows };
    }

    async clickSeeAllTopCommodities(timeout = 8000, title = this.topCommoditiesHeading) {
        await this.clickSeeAllBeside(title, this.seeAllTopCommodities, timeout);
        console.log(`Clicked "See all" on ${title}`);
    }

    async clickSeeAllTopCurrencies(timeout = 8000) {
        return this.clickSeeAllTopCommodities(timeout, INSIGHTS.currency.top);
    }

    // The full Top Commodities screen: title + Back button, its own tab row, and the segment tabs gone.
    async verifyTopCommoditiesSeeAllOpened(timeout = 8000) {
        return this.verifyTopSeeAllOpened(INSIGHTS.commodity, timeout);
    }

    // Top Currencies has no tab row, so its "See all" screen is checked for a symbol list instead.
    async verifyTopCurrenciesSeeAllOpened(timeout = 8000) {
        return this.verifyTopSeeAllOpened(INSIGHTS.currency, timeout);
    }

    async verifyTopSeeAllOpened(insights, timeout = 8000) {
        const title = insights.top;
        const backVisible = await this.isElementVisible(this.backButton, timeout);
        const titleVisible = backVisible && await this.isElementVisible(`android=new UiSelector().description("${title}")`, 2000);
        const leftMarkets = titleVisible && !(await this.isElementVisible(this.segmentTabOf(insights), 500));
        const tabs = leftMarkets ? await this.getTopCommoditiesTabs(title) : [];
        const rows = leftMarkets && !tabs.length ? await this.getTopCommoditiesRows(title) : [];
        const opened = leftMarkets && (tabs.length > 0 || rows.length > 0);
        console.log(`${title} "See all" screen opened (${tabs.length ? `${tabs[0].total} tabs` : `${rows.length} symbols listed`}): ${opened ? 'PASS' : 'FAIL'}`);
        return opened;
    }

    async closeTopCommoditiesSeeAll(timeout = 5000, title = this.topCommoditiesHeading) {
        await this.click(this.backButton, timeout);
        console.log(`Clicked Back on the ${title} screen`);
    }

    async closeTopCurrenciesSeeAll(timeout = 5000) {
        return this.closeTopCommoditiesSeeAll(timeout, INSIGHTS.currency.top);
    }

    // Device back from a Quote opened on a "See all" screen titled `title` (e.g. "Top Commodities",
    // "OI Analysis") - expected to return to that screen, as F&O Market Insights' does: its Back
    // button and title shown, the Markets segment tabs (`segmentTab`) not.
    async navigateBackToSeeAll(title, from, segmentTab = this.commodityTab) {
        await this.driver.back();
        await this.pause(1500);
        const back = await this.isElementVisible(this.backButton, 3000)
            && await this.isElementVisible(`android=new UiSelector().description("${title}")`, 1000)
            && !(await this.isElementVisible(segmentTab, 500));
        console.log(`Back on ${title} "See all" from ${from}: ${back ? 'PASS' : 'FAIL'}`);
        return back;
    }

    // Taps the top-most of `rows` (from getFnoInsightRows/getTrendingOptionRows) and checks its
    // Quote opens - headed "Stock KAYNES 23NOV FUT, NFO. ..." for a contract too (verified live).
    async openFirstFnoSymbol(section, rows) {
        if (!rows.length) {
            console.log(`No symbol listed under ${section} to click: FAIL`);
            return null;
        }
        const first = rows.reduce((a, b) => (b.node.y1 < a.node.y1 ? b : a));
        await this.tapNode(first.node);
        console.log(`Clicked first ${section} symbol: ${first.symbol}`);
        const opened = await this.verifyQuoteOpened(first.symbol);
        return { symbol: first.symbol, opened };
    }

    // Device back from an NxtOption tool or a Quote opened from F&O lands straight on Markets, still
    // on F&O (verified live).
    async navigateBackToEquityTab(from, maxBackPresses = 3) {
        return this.navigateBackToSegmentTab('Equity', this.equityTab, from, maxBackPresses);
    }

    async navigateBackToFnoTab(from, maxBackPresses = 3) {
        return this.navigateBackToSegmentTab('F&O', this.fnoTab, from, maxBackPresses);
    }

    async navigateBackToCommodityTab(from, maxBackPresses = 3) {
        return this.navigateBackToSegmentTab('Commodity', this.commodityTab, from, maxBackPresses);
    }

    async navigateBackToCurrencyTab(from, maxBackPresses = 3) {
        return this.navigateBackToSegmentTab('Currency', this.currencyTab, from, maxBackPresses);
    }

    async navigateBackToSegmentTab(name, selector, from, maxBackPresses = 3) {
        for (let i = 0; i < maxBackPresses; i++) {
            await this.driver.back();
            await this.pause(1500);
            if (await this.isSegmentTabSelected(selector)) {
                console.log(`Back on Markets (${name}) from ${from}: PASS`);
                return true;
            }
        }
        console.log(`Could not get back to Markets (${name}) from ${from}: FAIL`);
        return false;
    }

    // Device back from a Quote opened on F&O Market Insights "See all" returns to that screen
    // (verified live), with its title and filters.
    async navigateBackToFnoInsightsSeeAll(from) {
        await this.driver.back();
        await this.pause(1500);
        const back = await this.isElementVisible(this.backButton, 3000)
            && await this.isElementVisible(this.fnoInsightsTitle, 1000)
            && await this.isElementVisible(this.expiryFilter, 1000);
        console.log(`Back on F&O Market Insights "See all" from ${from}: ${back ? 'PASS' : 'FAIL'}`);
        return back;
    }

    // The Equity page keeps its vertical scroll offset between visits, so "the first field" is
    // only meaningful after scrolling back to the top.
    async scrollToTop() {
        await this.scrollToBoundaryByMovement('up', { maxScrolls: 15 });
    }

    // Scrolls to the top only if `firstTitle` (the segment's first section) isn't already the first
    // heading under the segment tabs - skips the up-swipe scrollToTop needs to detect the boundary.
    async scrollToTopUnlessAt(firstTitle) {
        if ((await this.getFirstSectionTitle()) !== firstTitle) await this.scrollToTop();
    }

    // Section scrolls start from wherever the page already is - tests visit sections top to bottom,
    // so the next one is usually on screen or just below. Call with each loop's fresh `nodes` and a
    // shared `{ last: null, wrapped: false }` (reset `last` after scrolling up): when the screen is
    // unchanged since the previous nudge down the page is at the bottom, so the section is above -
    // scroll to the top once and return true so the caller searches down again from there.
    async wrapToTopAtBottom(nodes, wrap) {
        const sig = nodes.map(n => `${n.desc}@${n.y1}`).join('|');
        const atBottom = sig === wrap.last;
        wrap.last = sig;
        if (!atBottom || wrap.wrapped) return false;
        wrap.wrapped = true;
        wrap.last = null;
        console.log('Reached the bottom without finding the section - scrolling back to the top');
        await this.scrollToTop();
        return true;
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
        }, { timeout, interval: 300 }).catch(() => { });
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

    // Index bar above the search bar. On Commodity its "indices" are MCX futures ("Index GOLD.
    // Expiry: 2026-12-04. Last traded price: ...", verified live) and the Quote it opens is headed
    // with the contract: "Stock GOLD 04DEC FUT, MCX. Last traded price 143299.00. ...". Taps the
    // left-most one and returns { symbol, ltp, segment } read off that Quote header.
    async openFirstIndexBarQuote(timeout = 8000) {
        const firstIndex = async () => (await this.getDescribedElements())
            .filter(n => /^Index [^,]+\. (Expiry|Last traded)/.test(n.desc))
            .sort((a, b) => a.x1 - b.x1)[0];
        let first = await firstIndex();
        // The bar scrolls with the page, and Equity keeps its scroll offset between visits.
        if (!first) {
            await this.scrollToTop();
            first = await firstIndex();
        }
        if (!first) {
            console.log('No index shown in the index bar above the search bar: FAIL');
            return null;
        }
        await this.tapNode(first);
        console.log(`Clicked the first index in the index bar: ${first.desc.match(/^Index (.+?)\./)[1]}`);
        let quote = null;
        await this.driver.waitUntil(async () => {
            // Equity/F&O index bars hold real indices ("Index Nifty 50. Last traded price: ..."); their
            // Quote header may be "Index ..." rather than "Stock ..." - the ", EXCHANGE." part tells
            // either apart from the index bar's own nodes.
            const m = (await this.getDescribedElements())
                .map(n => n.desc.match(/^(?:Stock|Index) (.+?), (\w+)\. Last traded price ([\d,]+(?:\.\d+)?)?/))
                .find(Boolean);
            quote = m && { symbol: m[1], segment: m[2], ltp: m[3] || null };
            return !!quote;
        }, { timeout, interval: 1000 }).catch(() => { });
        if (!quote) {
            console.log('Quote screen did not open from the index bar: FAIL');
            return null;
        }
        console.log(`Quote screen opened for ${quote.symbol}: PASS`);
        console.log(`  Symbol: ${quote.symbol} | LTP: ${quote.ltp || 'not shown'} | Segment: ${quote.segment}`);
        return quote;
    }

    // "Option chain Button" on a Quote opens Option Chain: OI/LTP/Greeks tabs over a Call LTP /
    // Strike Price / Put LTP table (verified live from a Commodity index's Quote).
    async openOptionChain(timeout = 15000) {
        await this.click(this.optionChainButton, 5000);
        console.log('Clicked Option Chain');
        const opened = await this.isElementVisible('android=new UiSelector().description("Strike Price")', timeout);
        console.log(`Option Chain screen opened: ${opened ? 'PASS' : 'FAIL'}`);
        return opened;
    }

    // Option Chain shows the NxtOption banner (same "Explore the Smart Option Trading..." node as on
    // Markets) for Commodity and F&O underlyings, but not for Equity or Currency - `expected` says
    // which applies.
    async verifyOptionChainNxtOptionBanner(expected, timeout = 5000) {
        const shown = await this.isElementVisible(this.nxtOptionBanner, timeout);
        console.log(`NxtOption banner on Option Chain: ${shown ? 'displayed' : 'not displayed'} - ${shown === expected ? 'PASS' : `FAIL (expected ${expected ? 'displayed' : 'not displayed'})`}`);
        return shown === expected;
    }

    // Visible Market Movers sub-tabs ("Top Gainers\nTab 1 of 6", ...) - the first tab row below the
    // segment tab row. Only gives what is currently on screen; `total` comes from the "of N" suffix.
    // Lower rows belong to later sections (Commodity's "Most Traded" row, seen live) - rewinding
    // onto one of those tapped it behind the floating bottom nav and landed on Watchlist.
    async getMoversTabs() {
        const nodes = await this.getDescribedElements();
        const equity = nodes.find(n => /^Equity\nTab 1 of \d+$/.test(n.desc));
        const minY = equity ? equity.y2 : 0;
        const tabs = nodes
            .filter(n => n.y1 >= minY)
            .map(n => ({ n, m: n.desc.match(/^(.+)\nTab (\d+) of (\d+)$/) }))
            .filter(t => t.m);
        if (!tabs.length) return [];
        const rowY = Math.min(...tabs.map(t => t.n.y1));
        return tabs
            .filter(t => t.n.y1 - rowY <= 15)
            .map(({ m }) => ({ label: m[1], index: Number(m[2]), total: Number(m[3]) }));
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
    async clickMoversTab(index, total, timeout = 5000, section = 'Market Movers') {
        const sel = `(//*[contains(@content-desc,"Tab ${index} of ${total}")])[last()]`;
        const el = await this.driver.$(sel);
        try {
            await el.waitForDisplayed({ timeout });
        } catch (_) {
            console.log(`${section} tab ${index} of ${total} not found: FAIL`);
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
            if (!selected && attempt < 3) console.log(`${section} "${label}" tab not selected after tap ${attempt} - tapping again`);
        }
        const rows = await this.driver.$$(this.moversRow);
        const firstDesc = rows.length ? await rows[0].getAttribute('content-desc') : '';
        const firstSymbol = firstDesc ? moverSymbol(firstDesc) : null;
        // An empty category (e.g. Upper Circuit, All Time Low on "See all") shows "No Data Found!".
        const noData = !rows.length && await this.isElementVisible('android=new UiSelector().description("No Data Found!")', 500);
        console.log(`${section} "${label}" tab - selected: ${selected ? 'PASS' : 'FAIL'} | symbols listed: ${rows.length}${firstSymbol ? ` (first: ${firstSymbol})` : ''}${noData ? ' - "No Data Found!" shown' : ''}`);
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
    // nav, then returns that row's node. The page keeps its scroll offset between visits, so it
    // scrolls down from there (see wrapToTopAtBottom) rather than from the top every time.
    async scrollToSection(title, isRow, maxScrolls = 15) {
        const { height } = await this.driver.getWindowSize();
        const wrap = { last: null, wrapped: false };
        for (let i = 0; i <= maxScrolls; i++) {
            const nodes = await this.getDescribedElements();
            if (await this.wrapToTopAtBottom(nodes, wrap)) { i = 0; continue; }
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
            if (heading && heading.y1 < tabsBottom) { wrap.last = null; await this.swipe('up'); }
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
    // stops at the next section's heading ("Last Visited", whose rows look the same);
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
        }, { timeout, interval: 500 }).catch(() => { });
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
        }, { timeout: 5000, interval: 500 }).catch(() => { });
        console.log(state ? `Basket screen loaded - ${state}` : 'Basket tab opened, but neither saved baskets nor "Basket order is Empty" is shown');
        return !!state;
    }

    // ── Global search / Last Visited ─────────────────────────────

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
        return this.scrollToSection('Last Visited', isRecentCard);
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

    // Scrolls to Last Visited and taps the first card under the header (on its left
    // half, clear of the X) - returns its symbol.
    async tapFirstRecentlyViewed() {
        const firstRow = await this.scrollToRecentlyViewed();
        if (!firstRow) return null;
        await this.rewindRecentRow(Math.round((firstRow.y1 + firstRow.y2) / 2));
        const [first] = await this.getRecentCards();
        if (!first) {
            console.log('No symbol displayed under Last Visited: FAIL');
            return null;
        }
        const { x1, x2, y1, y2 } = first.node;
        await this.tapAt(x1 + (x2 - x1) / 4, (y1 + y2) / 2);
        console.log(`Clicked the first symbol under Last Visited: ${first.symbol}`);
        return first.symbol;
    }

    // Taps the X on `symbol`'s card (swiping the row left to find it) and checks the card is gone.
    // With nothing left to show, the whole section disappears, which also counts as removed.
    async removeRecentlyViewed(symbol, maxSwipes = 6) {
        const firstRow = (await this.getDescribedElements()).find(n => isRecentCard(n.desc)) || await this.scrollToRecentlyViewed();
        if (!firstRow) {
            console.log(`Last Visited not found while removing ${symbol}: FAIL`);
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
            console.log(`${symbol} not displayed under Last Visited - could not remove it: FAIL`);
            return false;
        }
        const before = (await this.getRecentCards()).filter(c => c.symbol === symbol).length;
        const { x1, x2, y1, y2 } = card.remove;
        await this.tapAt((x1 + x2) / 2, (y1 + y2) / 2);
        await this.pause(1200);
        const sectionGone = !(await this.getDescribedElements()).some(n => n.desc === 'Last Visited');
        const after = sectionGone ? 0 : (await this.getRecentCards()).filter(c => c.symbol === symbol).length;
        const removed = after < before;
        console.log(`Clicked X on ${symbol} - removed from Last Visited${sectionGone ? ' (section no longer shown)' : ''}: ${removed ? 'PASS' : 'FAIL'}`);
        return removed;
    }

    async clickSeeAllRecentlyViewed(timeout = 8000) {
        await this.click(this.seeAllRecentlyViewed, timeout);
        console.log('Clicked "See all" on Last Visited');
    }

    async verifyRecentlyViewedSeeAllOpened(timeout = 8000) {
        const opened = await this.isElementVisible(this.backButton, timeout)
            && await this.isElementVisible(this.recentlyViewedTitle, 2000);
        console.log(`Last Visited "See all" screen opened: ${opened ? 'PASS' : 'FAIL'}`);
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
    async getAllRecentlyViewed(maxScrolls = 30) {
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

    // The "See all" list must hold no more than `maxListed` entries in all, with every one of
    // `symbols` (the ones just opened via search) among them.
    async verifyRecentlyViewedList(symbols, maxListed = symbols.length) {
        const entries = await this.getAllRecentlyViewed();
        console.log(`Last Visited lists ${entries.length} symbol(s): ${entries.map(e => e.symbol).join(', ') || 'none'}`);
        const countOk = entries.length <= maxListed;
        console.log(`At most ${maxListed} symbols listed: ${countOk ? 'PASS' : `FAIL (${entries.length} listed, expected at most ${maxListed})`}`);
        const listed = new Set(entries.map(e => e.symbol));
        for (const s of symbols) {
            console.log(`${s} listed under Last Visited: ${listed.has(s) ? 'PASS' : 'FAIL'}`);
        }
        return countOk && symbols.every(s => listed.has(s));
    }

    async closeRecentlyViewedSeeAll(timeout = 5000) {
        await this.click(this.backButton, timeout);
        console.log('Clicked Back on the Last Visited screen');
    }

    // ── FII/DII ─────────────────────────────────────────────────────────────────

    // FII/DII is the last section on Equity, so scrolling to the bottom brings all four rows on
    // screen. Returns { date, dateText, unit, rows: [{ label, valueText, value, labelNode, valueNode }] }
    // for the rows found, or null if the heading isn't on screen.
    async scrollToFiiDii() {
        await this.scrollToBoundaryByMovement('down', { maxScrolls: 25 });
        await this.pause(800);
        const nodes = await this.getDescribedElements();
        const heading = nodes.find(n => n.desc === 'FII/DII');
        if (!heading) {
            console.log('Could not bring the "FII/DII" section on screen: FAIL');
            return null;
        }
        console.log('"FII/DII" section is now visible');
        const below = nodes.filter(n => n.y1 >= heading.y2);
        const dateNode = below.find(n => parseFiiDiiDate(n.desc));
        const unitNode = below.find(n => /^\(Rs\.? ?Cr\.?\)$/i.test(n.desc.trim()));
        const rows = FII_DII_ROWS.map(label => {
            const labelNode = below.find(n => n.desc === label);
            if (!labelNode) return null;
            const mid = (labelNode.y1 + labelNode.y2) / 2;
            const valueNode = below.find(n => n !== labelNode && n.x1 > labelNode.x2 && n.y1 <= mid && n.y2 >= mid
                && /^-?[\d,]+(\.\d+)?$/.test(n.desc.trim()));
            const valueText = valueNode ? valueNode.desc.trim() : null;
            return { label, valueText, value: valueText === null ? null : Number(valueText.replace(/,/g, '')), labelNode, valueNode };
        }).filter(Boolean);
        return {
            dateText: dateNode ? dateNode.desc.trim() : null,
            date: dateNode ? parseFiiDiiDate(dateNode.desc) : null,
            unit: unitNode ? unitNode.desc.trim() : null,
            rows,
        };
    }

    // The FII/DII date must be the previous trading day - the last Mon-Fri before today (Monday
    // expects Friday). Exchange holidays are not known here, so the day after one still expects
    // the holiday's date (and fails).
    verifyFiiDiiDate(fii) {
        if (!fii || !fii.date) {
            console.log(`FII/DII date displayed: FAIL (${fii && fii.dateText ? `could not parse "${fii.dateText}"` : 'not shown'})`);
            return false;
        }
        const now = new Date();
        const expected = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 1);
        while (expected.getDay() === 0 || expected.getDay() === 6) expected.setDate(expected.getDate() - 1);
        const ok = fii.date.getTime() === expected.getTime();
        const expectedText = expected.toDateString().slice(4); // "Oct 13 2026"
        console.log(`FII/DII date "${fii.dateText}" - previous trading day (${expectedText}): ${ok ? 'PASS' : 'FAIL'}`);
        return ok;
    }

    // Exactly FII Cash, DII Cash, FII Future and FII Option, in that order, each with a numeric
    // value, and the values labelled as crores ("(Rs. Cr.)").
    verifyFiiDiiRows(fii) {
        const rows = fii ? fii.rows : [];
        const labels = rows.map(r => r.label);
        const orderOk = labels.length === FII_DII_ROWS.length && FII_DII_ROWS.every((l, i) => labels[i] === l);
        console.log(`FII/DII rows: ${labels.join(', ') || 'none'} - ${orderOk ? 'PASS' : `FAIL (expected ${FII_DII_ROWS.join(', ')})`}`);
        rows.forEach(r => console.log(`  ${r.label}: ${r.valueText === null ? 'value not shown - FAIL' : `${r.valueText} Cr. - PASS`}`));
        const valuesOk = rows.length > 0 && rows.every(r => r.value !== null && !Number.isNaN(r.value));
        const unitOk = !!(fii && fii.unit);
        console.log(`FII/DII values displayed in Crore (${fii && fii.unit ? `"${fii.unit}"` : 'unit label not shown'}): ${unitOk ? 'PASS' : 'FAIL'}`);
        return orderOk && valuesOk && unitOk;
    }

    // Reads each row's bar off a screenshot along the row's midline, between the label and the
    // value: a negative value must draw a red bar (left of the axis), a positive one a green bar
    // (right of it). A zero value is expected to draw no bar.
    async verifyFiiDiiBars(fii) {
        const rows = fii ? fii.rows.filter(r => r.value !== null && r.valueNode) : [];
        if (!rows.length) {
            console.log('FII/DII graph: no rows with values to check - FAIL');
            return false;
        }
        const img = decodePng(Buffer.from(await this.driver.takeScreenshot(), 'base64'));
        const { width } = await this.driver.getWindowSize();
        const scale = img.width / width;
        let allOk = true;
        for (const r of rows) {
            const y = ((r.labelNode.y1 + r.labelNode.y2) / 2) * scale;
            const from = Math.round(r.labelNode.x2 * scale), to = Math.round(r.valueNode.x1 * scale);
            let red = 0, green = 0, redX = 0, greenX = 0, axisX = null;
            for (let x = from; x < to; x++) {
                const p = pixelAt(img, x, y);
                if (isRedBar(p)) { red++; redX += x; }
                else if (isGreenBar(p)) { green++; greenX += x; }
                else if (axisX === null && isAxis(p)) axisX = x;
            }
            const colour = red > green ? 'red' : green > 0 ? 'green' : 'none';
            const expected = r.value < 0 ? 'red' : r.value > 0 ? 'green' : 'none';
            let side = '';
            if (axisX !== null && colour !== 'none') {
                const centre = colour === 'red' ? redX / red : greenX / green;
                side = centre < axisX ? ' left of the axis' : ' right of the axis';
            }
            const ok = colour === expected;
            allOk = allOk && ok;
            console.log(`  ${r.label} ${r.valueText}: bar is ${colour}${side} (${Math.max(red, green)}px) - expected ${expected}: ${ok ? 'PASS' : 'FAIL'}`);
        }
        console.log(`FII/DII graph bars - red for negative, green for positive values: ${allOk ? 'PASS' : 'FAIL'}`);
        return allOk;
    }

    async clickSeeAllFiiDii(timeout = 8000) {
        if (!(await this.isElementVisible(this.seeAllFiiDii, 1000))) await this.scrollToFiiDii();
        await this.click(this.seeAllFiiDii, timeout);
        console.log('Clicked "See all" on FII/DII');
    }

    // The "See all" screen: X (Back) + "FII/DII" title, the Daily/Monthly/Yearly tabs and the
    // ALL/STOCK/INDEX sub-tabs. The Equity tab disappearing confirms it isn't still Markets.
    async verifyFiiDiiSeeAllOpened(timeout = 8000) {
        const backVisible = await this.isElementVisible(this.fiiSeeAll.close, timeout);
        const titleVisible = backVisible && await this.isElementVisible(this.fiiSeeAll.title, 2000);
        const leftMarkets = titleVisible && !(await this.isElementVisible(this.equityTab, 500));
        const nodes = leftMarkets ? await this.getDescribedElements() : [];
        const tabs = FII_DII_PERIODS.filter(p => nodes.some(n => n.desc.startsWith(`${p}\nTab `)));
        const segments = Object.keys(this.fiiSeeAll.segments).filter(s => nodes.some(n => n.desc === s));
        const opened = leftMarkets && tabs.length === FII_DII_PERIODS.length && segments.length === Object.keys(this.fiiSeeAll.segments).length;
        const why = !backVisible ? 'no Back button' : !titleVisible ? 'no title' : !leftMarkets ? 'Markets still on screen' : 'opened';
        console.log(`${this.fiiSeeAll.name} "See all" screen opened (${why}): ${leftMarkets ? 'PASS' : 'FAIL'}`);
        console.log(`  Tabs displayed: ${tabs.join(', ') || 'none'} - ${tabs.length === FII_DII_PERIODS.length ? 'PASS' : `FAIL (expected ${FII_DII_PERIODS.join(', ')})`}`);
        console.log(`  Sub-tabs displayed: ${segments.join(', ') || 'none'} - ${segments.length === Object.keys(this.fiiSeeAll.segments).length ? 'PASS' : `FAIL (expected ${Object.keys(this.fiiSeeAll.segments).join(', ')})`}`);
        return opened;
    }

    // Entries listed on "See all", top to bottom, as { period, rows: [{ label, valueText }] }.
    async getFiiDiiEntries() {
        return (await this.getDescribedElements())
            .map(n => n.desc.split('\n').map(s => s.trim()))
            .filter(parts => parts.length > 2 && FII_DII_ENTRY_HEAD.test(parts[0]))
            .map(([period, ...rest]) => {
                const rows = [];
                for (let i = 0; i + 1 < rest.length; i += 2) rows.push({ label: rest[i], valueText: rest[i + 1] });
                return { period, rows };
            });
    }

    async getSelectedFiiDiiPeriod() {
        for (const p of FII_DII_PERIODS) {
            try {
                const el = await this.driver.$(`//*[starts-with(@content-desc,"${p}") and contains(@content-desc,"Tab ")]`);
                if ((await el.getAttribute('selected')) === 'true') return p;
            } catch (_) { /* not on screen */ }
        }
        return null;
    }

    // The sub-tab whose pill is filled blue, read from a screenshot (see FII_DII_SEGMENTS).
    async getSelectedFiiDiiSegment() {
        const nodes = await this.getDescribedElements();
        const img = decodePng(Buffer.from(await this.driver.takeScreenshot(), 'base64'));
        const { width } = await this.driver.getWindowSize();
        const scale = img.width / width;
        for (const seg of Object.keys(this.fiiSeeAll.segments)) {
            const n = nodes.find(x => x.desc === seg);
            if (!n) continue;
            // Sample a horizontal strip just inside the pill's top edge, clear of the label text.
            let blue = 0, total = 0;
            for (let x = n.x1 + 10; x < n.x2 - 10; x += 4) {
                const [r, g, b] = pixelAt(img, x * scale, (n.y1 + 12) * scale);
                total++;
                if (b > 120 && b - r > 60) blue++;
            }
            if (total && blue / total > 0.5) return seg;
        }
        return null;
    }

    // Logs and checks that every listed entry shows exactly `segment`'s rows, in order.
    logFiiDiiEntries(entries, segment) {
        const expected = this.fiiSeeAll.segments[segment];
        let ok = entries.length > 0;
        entries.forEach(e => {
            const labels = e.rows.map(r => r.label);
            const match = labels.length === expected.length && expected.every((l, i) => labels[i] === l);
            ok = ok && match;
            console.log(`  ${e.period}: ${e.rows.map(r => `${r.label} ${r.valueText}`).join(' | ')} - ${match ? 'PASS' : `FAIL (expected ${expected.join(', ')})`}`);
        });
        console.log(`${segment} lists only ${expected.join(', ')} (${entries.length} entries): ${ok ? 'PASS' : 'FAIL'}`);
        return ok;
    }

    // On opening, Daily + ALL must be selected, and the latest entry must carry the same date the
    // Markets screen's FII/DII section showed (`marketsDateText`, e.g. "13th Oct 2026").
    async verifyFiiDiiSeeAllDefault(marketsDateText) {
        const period = await this.getSelectedFiiDiiPeriod();
        const segment = await this.getSelectedFiiDiiSegment();
        console.log(`Default tab "Daily" selected (selected: ${period || 'none'}): ${period === 'Daily' ? 'PASS' : 'FAIL'}`);
        console.log(`Default sub-tab "ALL" selected (selected: ${segment || 'none'}): ${segment === 'ALL' ? 'PASS' : 'FAIL'}`);
        const entries = await this.getFiiDiiEntries();
        const latest = entries.length ? entries[0].period : null;
        const dateOk = !!marketsDateText && latest === marketsDateText;
        console.log(`Latest date "${latest || 'none'}" matches the Markets FII/DII date "${marketsDateText || 'none'}": ${dateOk ? 'PASS' : 'FAIL'}`);
        const rowsOk = this.logFiiDiiEntries(entries, 'ALL');
        return period === 'Daily' && segment === 'ALL' && dateOk && rowsOk;
    }

    // Taps sub-tab `segment` (ALL/STOCK/INDEX), then checks its pill is the one selected and every
    // entry lists only that segment's rows. The list reloads a moment after the tap, so it is
    // polled until the rows change over.
    async clickFiiDiiSegment(segment, timeout = 6000) {
        const node = (await this.getDescribedElements()).find(n => n.desc === segment);
        if (!node) {
            console.log(`FII/DII "${segment}" sub-tab not found: FAIL`);
            return false;
        }
        await this.tapNode(node);
        console.log(`Clicked "${segment}" on FII/DII`);
        const expected = this.fiiSeeAll.segments[segment];
        const matches = e => e.rows.length === expected.length && expected.every((l, i) => e.rows[i].label === l);
        let entries = [];
        const deadline = Date.now() + timeout;
        do {
            await this.pause(600);
            entries = await this.getFiiDiiEntries();
        } while (!(entries.length && entries.every(matches)) && Date.now() < deadline);
        // A sub-tab can open part-way down its list, left over from the previous sub-tab's scroll
        // (seen live: Yearly STOCK opened at 2024, hiding 2026/2025) - start from its latest entry.
        await this.scrollToBoundaryByMovement('up', { maxScrolls: 10 });
        entries = await this.getFiiDiiEntries();
        const selected = await this.getSelectedFiiDiiSegment();
        console.log(`"${segment}" sub-tab selected (selected: ${selected || 'none'}): ${selected === segment ? 'PASS' : 'FAIL'}`);
        const rowsOk = this.logFiiDiiEntries(entries, segment);
        return selected === segment && rowsOk;
    }

    // Taps period tab `period` (Monthly/Yearly/Daily) and checks it carries selected="true" and that
    // the latest entry is the current period: today's month ("Oct 2026") on Monthly, the current
    // year ("2026") on Yearly. Polls until the entries' headings switch to the new period's format.
    async clickFiiDiiPeriod(period, timeout = 6000) {
        const node = (await this.getDescribedElements()).find(n => n.desc.startsWith(`${period}\nTab `));
        if (!node) {
            console.log(`FII/DII "${period}" tab not found: FAIL`);
            return false;
        }
        await this.tapNode(node);
        console.log(`Clicked "${period}" on FII/DII`);
        const headFormat = { Daily: /^\d{1,2}(?:st|nd|rd|th)? [A-Za-z]{3} \d{4}$/, Monthly: /^[A-Za-z]{3} \d{4}$/, Yearly: /^\d{4}$/ }[period];
        let entries = [];
        const deadline = Date.now() + timeout;
        do {
            await this.pause(600);
            entries = await this.getFiiDiiEntries();
        } while (!(entries.length && entries.every(e => headFormat.test(e.period))) && Date.now() < deadline);
        const selected = await this.getSelectedFiiDiiPeriod();
        console.log(`"${period}" tab selected (selected: ${selected || 'none'}): ${selected === period ? 'PASS' : 'FAIL'}`);

        let currentOk = true;
        if (period !== 'Daily') {
            const now = new Date();
            const expected = period === 'Monthly'
                ? `${now.toDateString().slice(4, 7)} ${now.getFullYear()}` // "Oct 2026"
                : String(now.getFullYear());
            const latest = entries.length ? entries[0].period : null;
            currentOk = latest === expected;
            console.log(`Latest ${period} entry "${latest || 'none'}" is the current ${period === 'Monthly' ? 'month' : 'year'} "${expected}": ${currentOk ? 'PASS' : 'FAIL'}`);
        }
        return selected === period && currentOk;
    }

    // Scrolls the current period/sub-tab's list to its end (it is finite - about a month of trading
    // days on Daily, 13 months on Monthly, 6 years on Yearly, verified live; the tab rows stay
    // pinned) and checks the past entries: more than one listed, newest first with no repeats,
    // none in the future, each with only `segment`'s rows; on Daily weekdays only, on Monthly/Yearly
    // no month/year skipped, and the latest being the current month/year. Starts from the top (a list
    // can be left part-way down) and scrolls back there afterwards so the next tab starts from the latest.
    async verifyFiiDiiHistory(period, segment, maxScrolls = 30) {
        const entries = new Map();
        const collect = async () => {
            let added = 0;
            for (const e of await this.getFiiDiiEntries()) {
                if (!entries.has(e.period)) { entries.set(e.period, e); added++; }
            }
            return added;
        };
        await this.scrollToBoundaryByMovement('up', { maxScrolls: 10 });
        await collect();
        for (let i = 0; i < maxScrolls; i++) {
            await this.swipe('down');
            await this.pause(700);
            if (!(await collect())) break;
        }
        const list = [...entries.values()];
        console.log(`${period} / ${segment} - ${list.length} entries listed after scrolling: ${list.map(e => e.period).join(', ') || 'none'}`);

        const expected = this.fiiSeeAll.segments[segment];
        const now = new Date();
        const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
        const problems = [];
        if (list.length < 2) problems.push('no past entries listed');
        if (period !== 'Daily') {
            const current = period === 'Monthly' ? `${now.toDateString().slice(4, 7)} ${now.getFullYear()}` : String(now.getFullYear());
            if (list.length && list[0].period !== current) problems.push(`latest entry is ${list[0].period}, not the current ${period === 'Monthly' ? 'month' : 'year'} ${current}`);
        }
        list.forEach((e, i) => {
            const date = parseFiiDiiPeriod(e.period);
            const labels = e.rows.map(r => r.label);
            if (!date) { problems.push(`"${e.period}" is not a valid ${period} heading`); return; }
            if (date > today) problems.push(`${e.period} is in the future`);
            if (labels.length !== expected.length || expected.some((l, j) => labels[j] !== l)) {
                problems.push(`${e.period} lists ${labels.join(', ') || 'no rows'}`);
            }
            if (e.rows.some(r => !/^-?[\d,]+(\.\d+)?$/.test(r.valueText || ''))) problems.push(`${e.period} has a missing/non-numeric value`);
            if (period === 'Daily' && (date.getDay() === 0 || date.getDay() === 6)) problems.push(`${e.period} is a weekend`);
            const prev = i > 0 && parseFiiDiiPeriod(list[i - 1].period);
            if (!prev) return;
            if (date >= prev) problems.push(`${e.period} is listed after ${list[i - 1].period} (not newest first)`);
            const gap = period === 'Monthly'
                ? (prev.getFullYear() - date.getFullYear()) * 12 + prev.getMonth() - date.getMonth()
                : period === 'Yearly' ? prev.getFullYear() - date.getFullYear() : 1;
            if (gap > 1) problems.push(`${period === 'Monthly' ? 'month' : 'year'}(s) missing between ${e.period} and ${list[i - 1].period}`);
        });
        problems.forEach(p => console.log(`  ${p}: FAIL`));
        const ok = !problems.length;
        console.log(`${period} / ${segment} past entries listed newest first with only ${expected.join(', ')}: ${ok ? 'PASS' : 'FAIL'}`);

        await this.scrollToBoundaryByMovement('up', { maxScrolls: maxScrolls });
        return ok;
    }

    async closeFiiDiiSeeAll(timeout = 5000) {
        await this.click(this.backButton, timeout);
        console.log('Clicked Back on the FII/DII screen');
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

module.exports = { MarketsPage, HRA_TABS, HRA_PERIODS, SIR_TABS, NXT_OPTION_TOOLS };
