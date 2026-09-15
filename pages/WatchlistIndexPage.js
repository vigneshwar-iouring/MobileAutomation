const BasePage = require('./BasePage');

class WatchlistIndexPage extends BasePage {
    constructor(driver) {
        super(driver);
        this.watchlistNavButton = 'android=new UiSelector().className("android.widget.ImageView").description("Watchlist")';
        // The bottom nav's own "Watchlist" icon is present on every screen (Market, Orders,
        // Portfolio, Mutual Funds all show the same floating nav) so it can't confirm the CURRENT
        // screen - "Manage Watchlist" only renders on the Watchlist screen itself.
        this.manageWatchlistIcon = 'android=new UiSelector().description("Manage Watchlist, Double tap to manage watchlist")';
        this.swipeUpForDetails = 'android=new UiSelector().description("Swipe up for Stock Details")';
        this.viewChartButton = 'android=new UiSelector().description("View Chart, Double tap to open the chart.")';
        this.addAlertButton = 'android=new UiSelector().description("Add Alert, Double tap to create a price alert.")';
        this.optionChainButton = 'android=new UiSelector().description("Option chain Button, Double tap to open the option chain.")';
        // The chart itself is a WebView-hosted charting widget (ChartIQ) with no accessible text
        // or content-desc anywhere - verified live that only its internal resource-id ("chart0",
        // bridged from the underlying HTML element id) is exposed, so that's the only thing that
        // can confirm the chart actually rendered.
        this.chartMarker = 'android=new UiSelector().resourceId("chart0")';
        // Both the search trigger and the search input itself are Buttons exposing their label
        // only via "hint" (empty content-desc), the same pattern seen on the Watchlist screen's
        // own search entry point - so these need XPath (@hint) rather than a UiSelector.
        this.optionChainSearchButton = '//android.widget.Button[@hint="Search"]';
        this.optionChainSearchInput = '//android.widget.Button[@hint="Add or search stocks"]';
        this.optionChainCancelButton = 'android=new UiSelector().description("Cancel")';
        // The live-price marker row interleaved between the two nearest-the-money strike rows -
        // format "<price>\n<change>\n(<change%>)", e.g. "23939.50\n66.05\n(0.27%)". Its value
        // changes on every load (it's not a fixed strike), and unlike every other row in the
        // table it is NOT clickable, so it can only be located by matching this shape.
        this.optionChainMarkerRegex = /^\d[\d.]*\n-?\d[\d.]*\n\(-?[\d.]+%\)$/;
        // Expiry date tabs read like "08 Sep 2026\nW2\n(4 D)" - the date/week/days-left all shift
        // daily, so tabs are matched by shape and picked by left-to-right position, never by a
        // hardcoded date. The first (leftmost) tab is selected by default.
        this.optionChainDateTabRegex = /^\d{2} \w{3} \d{4}\nW\d+\n\(\d+ D\)$/;
        // Strike price cells are the only content-desc in the table that's a bare 4-6 digit
        // number (Vol./LTP/Greeks cells all carry extra text, "Cr", "%", or newlines) - none of
        // the tabs expose a selected="true"/checked="true" state, so which tab is active can only
        // be inferred from which columns are showing (see isOptionChainOnLtpTab below), and this
        // same shape doubles as a stable, non-ticking signature for scrolling the table.
        //
        // Used via scrollToBoundaryByDescRegex (a single getPageSource() fetch), not a UiSelector
        // string queried live via driver.$$() - that per-element query pattern was observed to
        // hang indefinitely against this exact screen (Option Chain's OI tab) even though a plain
        // getPageSource() against it returned instantly.
        this.optionChainStrikeRowRegex = /^[0-9]{4,6}$/;
        this.strikePriceHeader = 'android=new UiSelector().description("Strike Price")';
        // The Quotes screen's tab strip ("Overview\nTab 1 of 4", "Futures\nTab 2 of 4", ...) - the
        // total tab count varies by instrument (an index has 4, a future contract's own Quotes
        // screen has 3), so this matches on the "Futures\nTab N of M" shape rather than a fixed count.
        this.futuresTabButton = 'android=new UiSelector().descriptionMatches("^Futures\\nTab \\d+ of \\d+$")';
        // A Futures tab row reads like "Future contract SENSEX 24SEP FUT, BFO. Last traded price
        // 77074.35. Change 150.05. Change percentage 0.19 percent., Double tap to view future
        // details." - the expiry ("24SEP") never carries a year, since the app only ever lists the
        // next few live monthly contracts.
        this.futureContractRegex = /^Future contract (\S+) (\d{2}[A-Z]{3}) FUT, (\S+)\. Last traded price ([\d.]+)\. Change (-?[\d.]+)\. Change percentage (-?[\d.]+) percent\./;
        // Matches any described element - used via scrollToBoundaryByDescRegex for scrolling a
        // single static details screen (no repeating list) to its end, the same "anything with a
        // content-desc" boundary-scroll idea used elsewhere in this repo (see QuotesPage.js/
        // MutualFundsPage.js), but built on getPageSource() rather than a live driver.$$() query.
        //
        // Requires a letter, which excludes every bare order-book depth number (Bid/Ask "119.15",
        // "1", "325"...) from the signature entirely, rather than relying on stableEntryId to
        // neutralize each one's *value*. That per-value neutralization isn't enough on a highly
        // liquid, actively-traded contract (e.g. the nearest-expiry Future) - live-observed
        // repeatedly overscrolling there while the same scroll on a quieter, farther-expiry
        // contract stopped cleanly - because the depth block's very ROW COUNT can shift as real
        // order-book levels appear/disappear, which a per-value placeholder can't paper over.
        // Excluding the whole block up front sidesteps both problems: the signature is built only
        // from static labels/headers, which only change when scrolling reveals genuinely new
        // content.
        this.anyDescribedElementRegex = /[A-Za-z]/;
        this.technicalsTabButton = 'android=new UiSelector().descriptionMatches("^Technicals\\nTab \\d+ of \\d+$")';
        // The Technicals tab's own duration strip ("1 Minute\nTab 1 of 8", "5 Min\nTab 2 of 8", ...)
        // reuses the exact same "Label\nTab N of M" shape as the main Overview/Futures/Technicals/
        // Constituents strip, so duration tabs are picked out by excluding those 4 known labels
        // rather than by the "of 8" count (which isn't guaranteed the same for every instrument).
        // Only the tabs currently rendered are returned - this is a Compose lazy row, so tabs
        // beyond what's on-screen (6, 7, 8 of 8) don't exist in the tree until scrolled into view,
        // and a horizontal swipe here bubbles up to the outer tab pager instead of scrolling this
        // row, switching to the next main tab (Technicals -> Constituents) rather than revealing
        // more durations - so only the visible/reachable duration tabs are covered.
        this.mainQuoteTabLabels = ['Overview', 'Futures', 'Technicals', 'Constituents'];
        this.smaButton = 'android=new UiSelector().description("SMA")';
        this.emaButton = 'android=new UiSelector().description("EMA")';
        // Standalone section/subsection titles on the Technicals screen - these sit directly above
        // a header/value row (e.g. "Technical Indicators" above "RSI(14)"/"ROC(20)"/"CCI(20)") but
        // aren't a header themselves. Left unexcluded, a title like this merges into the row
        // beneath it as one long header run (4 labels: title + 3 real headers) that no longer
        // matches the row's 3 values, so the whole row silently fails to group at all - which is
        // how a genuinely all-zero RSI/ROC/CCI row went unreported while the very next row
        // (Williamson%R(14)/MFI(14)) was correctly flagged.
        this.technicalsSectionTitles = new Set([
            'Technical Indicators', 'Moving Average', 'Bollinger Band(20,2)',
            'Moving Averages Crossover', 'Short Term CrossOver', 'Medium Term CrossOver', 'Long Term CrossOver',
        ]);
        this.constituentsTabButton = 'android=new UiSelector().descriptionMatches("^Constituents\\nTab \\d+ of \\d+$")';
        // A Constituents row reads like "Stock ADANIENT, NSE. Weightage 0.83 percent. Last traded
        // price 3095.10. Change 141.90. Change percentage 4.80 percent., Double tap to view stock
        // details." - not clickable at this node (same as a Futures contract row), so it needs
        // tapNode rather than a selector-based click.
        this.constituentStockRegex = /^Stock (\S+), (\S+)\. Weightage ([\d.]+) percent\. Last traded price ([\d.]+)\. Change (-?[\d.]+)\. Change percentage (-?[\d.]+) percent\., Double tap to view stock details\.$/;
        // The count label shown directly above the Symbol/Weightage/Price table header, e.g.
        // "50 Stocks" for Nifty 50 or "30 Stocks" for Sensex - varies by index, not hardcoded.
        this.constituentsCountRegex = /^\d+ Stocks$/;
        this.editIndicesButton = 'android=new UiSelector().description("edit Indices, Double tap to edit indices")';
        // In edit mode, a currently-added index reads "<NAME>\nRemove Indices, Double tap to
        // remove indices" - a single merged node (name + the red "-" icon), same one-node-per-row
        // pattern as everywhere else on this screen.
        this.removableIndexRegex = /\nRemove Indices, Double tap to remove indices$/;
        // Same merged-node pattern as removableIndexRegex, for the not-yet-added indices shown
        // below the "-" section, e.g. "BSE 200\nAdd Indices, Double tap to add indices".
        this.addableIndexRegex = /\nAdd Indices, Double tap to add indices$/;
        // The Watchlist screen's own tab strip - one tab per user-created watchlist ("Watchlist1",
        // "Watchlist2", ... "Tab N of M") - reuses the exact same "Label\nTab N of M" shape as the
        // bottom nav (which is present on every screen, so must be excluded by name here) and the
        // various sub-screen tab strips elsewhere in this file. The tab count grows/shrinks as
        // watchlists are added/removed, so this is never matched against a fixed "of M".
        this.watchlistNameTabRegex = /^.+\nTab \d+ of \d+$/;
        this.bottomNavTabLabels = ['Watchlist', 'Market', 'Orders', 'Portfolio', 'Mutual Funds'];
        // A watchlist with no symbols added shows these three exact standalone nodes instead of
        // any rows - confirmed live on freshly-created "Watchlist1"-"Watchlist5" here.
        this.emptyWatchlistText = 'Empty Watchlist';
        this.emptyWatchlistSubtext = 'Add symbols to your watchlist group';
        this.addSymbolsButtonText = 'ADD SYMBOLS';
        // A symbol row reads like "Name: ADANIENT. Exchange: NSE. Last traded value: 3077.20.
        // Change: -27.50. Change percentage: -0.88 percent., Double tap to open Quote Screen." -
        // the "Name:"/"Exchange:" prefixes are unique to this screen's rows (the similarly-shaped
        // Option Chain search results and Constituents rows use different prefixes), so no extra
        // screen-context filtering is needed.
        this.watchlistSymbolRowRegex = /^Name: (\S+)\. Exchange: (\S+)\. Last traded value/;
        // The "ADD SYMBOLS" button (empty-state only) opens a search screen with its input
        // already focused - same "Add or search stocks" hint-only Button seen on the Option
        // Chain search (see optionChainSearchInput above), reused verbatim here.
        this.addSymbolsButton = 'android=new UiSelector().description("ADD SYMBOLS")';
        this.addSymbolsSearchInput = '//android.widget.Button[@hint="Add or search stocks"]';
        // A result row reads "HDFCBANK\nAdd Watchlist, Double tap to open Quote Screen." - tapping
        // the row itself opens the Quote screen, so adding to the watchlist instead needs the
        // separate "+" icon node ("Double tap to add to watchlist") that sits to its right, paired
        // up by matching y-position the same way findInlineValue pairs a label to its value.
        this.addSymbolsResultRowRegex = /^(\S+)\nAdd Watchlist, Double tap to open Quote Screen\.$/;
        this.addToWatchlistIconText = 'Double tap to add to watchlist';
        // On a NON-empty watchlist tab, "Add Symbols" is reached via a persistent search bar
        // instead of the empty-state's "ADD SYMBOLS" button - its own hint carries a live
        // "(<current>/<max>)" symbol count (e.g. "Search Symbols\nAdd or search stocks (1/50),
        // Double tap to open Search Symbols."), confirmed live as the app's per-watchlist cap.
        this.searchSymbolsBar = '//android.widget.Button[contains(@hint,"Search Symbols")]';
        this.searchSymbolsCountRegex = /Add or search stocks \((\d+)\/(\d+)\)/;
        // The Add Symbols overlay's top-right button reads "Cancel" while the keyboard/search is
        // active and "Done" once it isn't - confirmed live both dismiss the overlay and persist
        // any adds made, so either label is accepted rather than assuming one.
        this.searchDoneOrCancelButton = 'android=new UiSelector().descriptionMatches("^(Done|Cancel)$")';
        this.watchlistUpdatedToastText = 'Watchlist updated Successfully!';
        // Search results already in the watchlist read "<SYMBOL>\n<SYMBOL>, Double tap to open
        // Quote Screen." (paired with their own "Remove <SYMBOL> from watchlist" icon instead of
        // an add one) - the already-added counterpart to addSymbolsResultRowRegex, used only to
        // build a whole-list scroll signature: a common prefix like "HDFC" can return several
        // screens of already-added NSE/BSE variants before any addable one appears.
        this.addSymbolsAlreadyAddedRowRegex = /^(\S+)\n\1, Double tap to open Quote Screen\.$/;
        // Tapping a watchlist GROUP row on the Manage Watchlist screen (rather than long-pressing
        // it to drag/reorder) opens a second, unrelated "Edit Watchlist" screen: that specific
        // group's own SYMBOLS, each with a "Remove <SYMBOL> from watchlist" icon - the same
        // description text/shape used by the Add Symbols search screen's already-added rows.
        this.editWatchlistTitle = 'Edit Watchlist';
        this.removeSymbolFromWatchlistRegex = /^Remove (\S+) from watchlist\. Double tap to remove$/;
        // The group's name is an inline, directly-editable EditText on Edit Watchlist (pre-filled
        // with the current name, e.g. "Watchlist1") - not a separate pencil-icon button - so
        // renaming just means focusing/clearing/typing into it like any other text field.
        this.editWatchlistNameField = 'android=new UiSelector().className("android.widget.EditText")';
        // Unlike the Add Symbols overlay (which saves immediately on Done/Cancel), leaving Edit
        // Watchlist with unsaved changes was confirmed live to show the same "Do You want to Save
        // the Changes?" DISCARD/CHANGE prompt used elsewhere in this app (see clickDiscardChanges/
        // clickSaveChanges below) - reusing those rather than duplicating identical selectors.
    }

    // Overrides BasePage's stableEntryId to also neutralize fields this screen keeps live-updating:
    // the price marker row, the on-screen timestamp, bare order-book/moving-average numbers with no
    // label of their own, and the "<Label>. <value>., Displays..." fields (Pr. Close/Open/High/Low/
    // Total Buy Qty/Total Sell Qty/Volume/Average traded price/Circuit limits/52 week range).
    // Without this, scrollToBoundaryByDescRegex would never see two identical signatures - some
    // ticking value always differs - so it would burn through every one of maxScrolls on every
    // call instead of stopping as soon as it's truly at the top/bottom. Missing "Circuit limits"/
    // "52 week range" from this list specifically was the cause of a live-observed repeated
    // overscroll bounce on a Future contract's Quotes screen - once scrolled to the true bottom,
    // their embedded circuit/52-week values kept ticking just enough to prevent two consecutive
    // captures from ever matching, so every scroll call kept bouncing against the bottom edge for
    // its full maxScrolls instead of stopping after the first no-op swipe.
    stableEntryId(desc) {
        if (!desc) return desc;
        if (this.optionChainMarkerRegex.test(desc)) return ' marker';
        if (/^\d{2} \w{3} \d{4}, \d{2}:\d{2}:\d{2}$/.test(desc)) return ' timestamp';
        if (/^-?[\d,]+(\.\d+)?%?$/.test(desc)) return null;
        for (const label of ['Pr. Close', 'Open', 'High', 'Low', 'Total Buy Qty', 'Total Sell Qty', 'Volume', 'Average traded price', 'Circuit limits', '52 week range']) {
            if (desc.startsWith(`${label}.`)) return label;
        }
        return super.stableEntryId(desc);
    }

    async isOnWatchlistScreen(timeout = 5000) {
        return this.isElementVisible(this.manageWatchlistIcon, timeout);
    }

    // If deep in a sub-screen (e.g. a Quotes detail page) the bottom nav isn't visible at all, so
    // this presses back first until either the Watchlist screen is reached directly or the nav
    // button itself becomes visible - not just a single click attempt.
    async navigateToWatchlist(maxBackPresses = 5) {
        for (let i = 0; i <= maxBackPresses; i++) {
            if (await this.isOnWatchlistScreen(1000)) {
                console.log('Already on Watchlist screen');
                return;
            }
            if (await this.isElementVisible(this.watchlistNavButton, 1000)) {
                await this.click(this.watchlistNavButton);
                console.log('Clicked Watchlist bottom navigation button');
                await this.pause(800);
                return;
            }
            if (i === maxBackPresses) break;
            await this.driver.back();
            await this.pause(600);
        }
        console.log(`Could not reach Watchlist screen after ${maxBackPresses} back presses`);
    }

    // Like the indices strip below it, only the tabs currently in/near the viewport are in the
    // tree - tabs further right (e.g. #6-8 of 8) don't exist until the strip is scrolled.
    async getWatchlistNameTabs() {
        const nodes = await this.getDescribedElements();
        return nodes
            .filter(n => this.watchlistNameTabRegex.test(n.desc))
            .filter(n => !this.bottomNavTabLabels.some(label => n.desc.startsWith(`${label}\n`)))
            .sort((a, b) => a.x1 - b.x1);
    }

    // Unlike the indices strip, this tab row does NOT respond to a manual drag gesture at all
    // (confirmed live: repeated swipes at the strip's own y left the exact same 4 tabs on screen
    // every time) - it's a Compose ScrollableTabRow, which only auto-scrolls to bring the newly
    // SELECTED tab into view. So tabs are revealed by clicking through them, not by scrolling: each
    // tab's content-desc carries its own fixed position ("Tab N of M"), and clicking the lowest-N
    // unclicked tab currently visible was observed live to reliably shift the window rightward
    // (e.g. clicking tab 4 of 8 revealed tabs 2-6; clicking 5 then revealed 3-7, etc.) until every
    // tab from 1 to M has been reached.
    // `onTabSelected({ name, n, total })`, when given, is awaited right after each tab is clicked
    // and settled - e.g. to check that tab's own symbol list before moving on to the next one.
    async clickAllWatchlistNameTabs(maxIterations = 30, onTabSelected) {
        const clicked = [];
        const clickedIndices = new Set();
        let total = null;

        for (let i = 0; i < maxIterations; i++) {
            const tabs = await this.getWatchlistNameTabs();
            const parsed = tabs
                .map(t => {
                    const m = t.desc.match(/^(.*)\nTab (\d+) of (\d+)$/s);
                    return m ? { node: t, name: m[1], n: Number(m[2]), total: Number(m[3]) } : null;
                })
                .filter(Boolean);
            if (total === null && parsed.length) total = parsed[0].total;
            if (total !== null && clickedIndices.size >= total) break;

            const candidates = parsed.filter(p => !clickedIndices.has(p.n)).sort((a, b) => a.n - b.n);
            if (!candidates.length) {
                throw new Error(`Stuck at ${clickedIndices.size}/${total} watchlist tabs clicked - no unclicked tab currently visible`);
            }

            const target = candidates[0];
            await this.tapNode(target.node);
            clickedIndices.add(target.n);
            clicked.push(target.name);
            console.log(`Clicked watchlist tab ${target.n} of ${total}: "${target.name}"`);
            await this.pause(700);

            if (onTabSelected) await onTabSelected({ name: target.name, n: target.n, total });
        }

        if (total !== null && clickedIndices.size < total) {
            console.log(`Only clicked ${clickedIndices.size} of ${total} watchlist tabs after ${maxIterations} iterations`);
        }
        return clicked;
    }

    // Brings watchlist tab 1 back into view and selects it - the tab strip only scrolls in
    // response to a click (see clickAllWatchlistNameTabs), so this repeatedly clicks whichever tab
    // is currently leftmost, which was observed live to shift the visible window further left each
    // time, until tab 1 itself is the leftmost (and gets clicked).
    async clickFirstWatchlistTab(maxIterations = 30) {
        for (let i = 0; i < maxIterations; i++) {
            const tabs = await this.getWatchlistNameTabs();
            const parsed = tabs
                .map(t => {
                    const m = t.desc.match(/^(.*)\nTab (\d+) of \d+$/s);
                    return m ? { node: t, name: m[1], n: Number(m[2]) } : null;
                })
                .filter(Boolean)
                .sort((a, b) => a.n - b.n);
            if (!parsed.length) throw new Error('No watchlist tabs visible');

            const leftmost = parsed[0];
            await this.tapNode(leftmost.node);
            await this.pause(700);
            if (leftmost.n === 1) {
                console.log(`Clicked watchlist tab 1: "${leftmost.name}"`);
                return leftmost.name;
            }
        }
        throw new Error(`Could not reach watchlist tab 1 after ${maxIterations} iterations`);
    }

    async isWatchlistEmpty() {
        const nodes = await this.getDescribedElements();
        return nodes.some(n => n.desc === this.emptyWatchlistText);
    }

    // Reads whether each of the three elements of the empty-watchlist state is present:
    // the "Empty Watchlist" heading, its "Add symbols to your watchlist group" subtext, and the
    // "ADD SYMBOLS" button.
    async getEmptyWatchlistDetails() {
        const nodes = await this.getDescribedElements();
        return {
            hasHeading: nodes.some(n => n.desc === this.emptyWatchlistText),
            hasSubtext: nodes.some(n => n.desc === this.emptyWatchlistSubtext),
            hasAddSymbolsButton: nodes.some(n => n.desc === this.addSymbolsButtonText),
        };
    }

    async getWatchlistSymbolRows() {
        const nodes = await this.getDescribedElements();
        return nodes.filter(n => this.watchlistSymbolRowRegex.test(n.desc)).sort((a, b) => a.y1 - b.y1);
    }

    async clickAddSymbols(timeout = 5000) {
        await this.click(this.addSymbolsButton, timeout);
        console.log('Clicked ADD SYMBOLS');
    }

    async searchAddSymbols(query, timeout = 5000) {
        const input = await this.findElement(this.addSymbolsSearchInput, timeout);
        await input.click();
        await this.pause(300);
        await input.setValue(query);
        await this.pause(1000);
        console.log(`Typed "${query}" into Add Symbols search`);

        // The on-screen keyboard stays up after typing (setValue doesn't submit/blur the field)
        // and covers the lower half of the results list, so it's dismissed here rather than left
        // for every caller to remember on its own.
        await this.driver.hideKeyboard().catch(() => {});
        console.log('Dismissed keyboard');
    }

    async getAddSymbolsResults() {
        const nodes = await this.getDescribedElements();
        const rows = nodes.filter(n => this.addSymbolsResultRowRegex.test(n.desc)).sort((a, b) => a.y1 - b.y1);
        return rows.map(row => ({
            symbol: row.desc.match(this.addSymbolsResultRowRegex)[1],
            rowNode: row,
            addIconNode: nodes.find(n => n.desc === this.addToWatchlistIconText && Math.abs(n.y1 - row.y1) <= 40),
        }));
    }

    // Taps the "+" icon (not the row itself, which opens the Quote screen instead) for whichever
    // result currently sits topmost in the search results list.
    async clickAddIconForFirstResult() {
        const results = await this.getAddSymbolsResults();
        if (!results.length) throw new Error('No search results found on Add Symbols screen');
        const first = results[0];
        if (!first.addIconNode) throw new Error(`No "+" add icon found for first result "${first.symbol}"`);
        await this.tapNode(first.addIconNode);
        console.log(`Clicked "+" to add "${first.symbol}" to watchlist`);
        return first.symbol;
    }

    // Reads the live "(current/max)" counter out of the search bar's own hint text - only
    // rendered on a non-empty watchlist tab (the empty-state screen has no search bar at all,
    // just the "ADD SYMBOLS" button), so this returns null there rather than throwing.
    async getWatchlistSymbolCount() {
        const src = await this.driver.getPageSource();
        const m = src.match(this.searchSymbolsCountRegex);
        return m ? { current: Number(m[1]), max: Number(m[2]) } : null;
    }

    async openSearchSymbols(timeout = 5000) {
        await this.click(this.searchSymbolsBar, timeout);
        console.log('Opened Search Symbols');
    }

    async closeSearchSymbols(timeout = 5000) {
        await this.click(this.searchDoneOrCancelButton, timeout);
        console.log('Closed Search Symbols');
    }

    async isWatchlistUpdatedToastShown(timeout = 3000) {
        return this.waitForToast(this.watchlistUpdatedToastText, { timeout });
    }

    // Repeatedly taps the "+" icon on the topmost still-addable search result, scrolling for more
    // once the visible ones run out, until either the query has no addable results left or the
    // watchlist's own symbol cap is hit. The app enforces that cap silently - tapping "+" past it
    // leaves the same row in the "Add Watchlist" (not-yet-added) state instead of flipping it to
    // "already added" (confirmed live: past 50/50 the same row kept reappearing as the topmost
    // result forever) - so a row that survives two consecutive taps unchanged is read as "cap
    // reached" and stops the loop, rather than hammering the same tap for the rest of maxIterations.
    //
    // "No addable rows visible" is NOT the same as "nothing left to add" - a query like "HDFC"
    // was observed live to return 6+ screens of already-added NSE/BSE variants before the next
    // addable one appears, so bailing out as soon as a few scrolls in a row show zero addable rows
    // (as an earlier version of this method did) stops long before the list is actually exhausted.
    // Instead, the whole visible row set (added + addable) is signature-compared across scrolls,
    // the same "did the screen actually change" check scrollToBoundary uses elsewhere - only once
    // THAT stops changing has the true end of the results been reached.
    async addSearchResultsUntilCapped(maxIterations = 300) {
        const added = [];
        let previousTopSymbol = null;
        let stallCount = 0;
        let previousRowSignature = null;
        let noProgressScrolls = 0;

        for (let i = 0; i < maxIterations; i++) {
            const nodes = await this.getDescribedElements();
            const addableRows = nodes
                .filter(n => this.addSymbolsResultRowRegex.test(n.desc))
                .sort((a, b) => a.y1 - b.y1)
                .map(row => ({
                    symbol: row.desc.match(this.addSymbolsResultRowRegex)[1],
                    addIconNode: nodes.find(n => n.desc === this.addToWatchlistIconText && Math.abs(n.y1 - row.y1) <= 40),
                }));
            const rowSignature = nodes
                .filter(n => this.addSymbolsResultRowRegex.test(n.desc) || this.addSymbolsAlreadyAddedRowRegex.test(n.desc))
                .map(n => n.desc)
                .join('|');

            if (!addableRows.length) {
                if (rowSignature === previousRowSignature) {
                    noProgressScrolls++;
                    if (noProgressScrolls >= 3) {
                        console.log('Reached the end of the search results with nothing left to add');
                        break;
                    }
                } else {
                    noProgressScrolls = 0;
                }
                previousRowSignature = rowSignature;
                await this.scrollDown();
                await this.pause(400);
                continue;
            }
            noProgressScrolls = 0;
            previousRowSignature = rowSignature;

            const first = addableRows[0];
            if (first.symbol === previousTopSymbol) {
                stallCount++;
                if (stallCount >= 2) {
                    console.log(`"${first.symbol}" didn't leave the results after 2 taps - watchlist cap likely reached`);
                    break;
                }
            } else {
                stallCount = 0;
            }
            previousTopSymbol = first.symbol;

            if (!first.addIconNode) {
                await this.scrollDown();
                await this.pause(400);
                continue;
            }
            await this.tapNode(first.addIconNode);
            added.push(first.symbol);
            console.log(`Added "${first.symbol}" (${added.length} added so far)`);
            await this.pause(700);
        }
        return added;
    }

    async openManageWatchlist(timeout = 5000) {
        await this.click(this.manageWatchlistIcon, timeout);
        console.log('Opened Manage Watchlist');
    }

    // Tapping near the row's left/name area rather than dead-center - the same row also carries a
    // long-press-to-drag gesture for reordering, and a plain tap too close to the drag handle risks
    // being read as the start of a drag instead of an "open" tap.
    async openEditWatchlistForGroup(groupName) {
        const nodes = await this.getDescribedElements();
        const row = nodes.find(n => n.desc.startsWith(`${groupName}.`));
        if (!row) throw new Error(`"${groupName}" row not found on Manage Watchlist screen`);
        const tapX = Math.round(row.x1 + 0.15 * (row.x2 - row.x1));
        const tapY = Math.round((row.y1 + row.y2) / 2);
        await this.driver.action('pointer').move({ duration: 0, x: tapX, y: tapY }).down().up().perform();
        console.log(`Opened Edit Watchlist for "${groupName}"`);
    }

    async isOnEditWatchlistScreen(timeout = 3000) {
        return this.isElementVisible(`android=new UiSelector().description("${this.editWatchlistTitle}")`, timeout);
    }

    async getEditWatchlistRemovableSymbols() {
        const nodes = await this.getDescribedElements();
        return nodes
            .filter(n => this.removeSymbolFromWatchlistRegex.test(n.desc))
            .sort((a, b) => a.y1 - b.y1)
            .map(n => ({ symbol: n.desc.match(this.removeSymbolFromWatchlistRegex)[1], node: n }));
    }

    async removeFirstEditWatchlistSymbol() {
        const symbols = await this.getEditWatchlistRemovableSymbols();
        if (!symbols.length) throw new Error('No removable symbols found on Edit Watchlist screen');
        const first = symbols[0];
        await this.tapNode(first.node);
        console.log(`Tapped Remove for "${first.symbol}"`);
        return first.symbol;
    }

    async removeEditWatchlistSymbol(symbol) {
        const symbols = await this.getEditWatchlistRemovableSymbols();
        const target = symbols.find(s => s.symbol === symbol);
        if (!target) throw new Error(`"${symbol}" not found among removable symbols`);
        await this.tapNode(target.node);
        console.log(`Tapped Remove for "${symbol}"`);
    }

    async isSymbolRemovedToastShown(symbol, timeout = 3000) {
        return this.waitForToast(`${symbol} Removed`, { timeout });
    }

    // Same merged toast+Undo node pattern as clickUndoOnToast (indices) - "<SYMBOL> Removed
    // \nUndo" in one node, "Undo" sitting at roughly 90% across its width (message left-aligned,
    // "Undo" right-aligned Material Design snackbar convention). The toast is short-lived, so this
    // must be called immediately after removeFirstEditWatchlistSymbol()/removeEditWatchlistSymbol().
    async clickUndoOnSymbolRemovedToast(symbol, timeout = 3000) {
        const deadline = Date.now() + timeout;
        while (Date.now() < deadline) {
            const nodes = await this.getDescribedElements();
            const toast = nodes.find(n => n.desc.startsWith(`${symbol} Removed`) && n.desc.includes('Undo'));
            if (toast) {
                const tapX = Math.round(toast.x1 + 0.90 * (toast.x2 - toast.x1));
                const tapY = Math.round((toast.y1 + toast.y2) / 2);
                await this.driver.action('pointer').move({ duration: 0, x: tapX, y: tapY }).down().up().perform();
                console.log(`Clicked "Undo" on the "${symbol} Removed" toast`);
                return true;
            }
            await this.pause(100);
        }
        console.log(`"${symbol} Removed" toast with Undo not found in time`);
        return false;
    }

    async closeEditWatchlist(timeout = 5000) {
        await this.click(this.searchDoneOrCancelButton, timeout);
        console.log('Closed Edit Watchlist');
    }

    async renameEditWatchlistGroup(newName, timeout = 5000) {
        const input = await this.findElement(this.editWatchlistNameField, timeout);
        await input.click();
        await this.pause(300);
        await input.clearValue();
        await input.setValue(newName);
        await this.pause(300);
        await this.driver.hideKeyboard().catch(() => {});
        console.log(`Renamed watchlist group to "${newName}"`);
    }

    async clickFirstWatchlistSymbol() {
        const rows = await this.getWatchlistSymbolRows();
        if (!rows.length) throw new Error('No watchlist symbol rows found to click');
        const first = rows[0];
        const symbol = first.desc.match(this.watchlistSymbolRowRegex)[1];
        await this.tapNode(first);
        console.log(`Clicked first watchlist symbol: "${symbol}"`);
        return symbol;
    }

    // The indices strip's leading entry isn't guaranteed to be Nifty 50 - whichever index the app
    // shows first varies, so this reads whichever "Index <Name>. Last traded price..." button
    // comes first in visual (left-to-right) order rather than assuming a specific index name.
    async getIndexButtons() {
        const nodes = await this.getDescribedElements();
        return nodes.filter(n => /^Index .+\. Last traded price/.test(n.desc)).sort((a, b) => a.x1 - b.x1);
    }

    async clickFirstIndex() {
        const indices = await this.getIndexButtons();
        if (!indices.length) throw new Error('No index buttons found in the indices strip');
        const first = indices[0];
        const nameMatch = first.desc.match(/^Index (.+?)\./);
        const name = nameMatch ? nameMatch[1] : first.desc;
        await this.tapNode(first);
        console.log(`Clicked first index: "${name}"`);
        return name;
    }

    // The indices strip is a single custom-drawn (canvas-like) horizontal scroller - every card
    // (SENSEX, Nifty 50, ...) and the trailing "Add Indices" affordance are all rendered inside
    // ONE accessibility node whose bounds never change ([132,153][1032,278] observed live), with
    // only its content-desc updating as it scrolls. So there's no separate element to select/click
    // by description - scrolling means dragging that whole node's bounds from right to left.
    // Right after navigating to the Watchlist screen, the strip can take a moment to render its
    // live data - a lookup fired the instant the screen switches sometimes finds nothing at all
    // yet, rather than a stale-but-present node, so this polls briefly instead of failing on the
    // very first empty check.
    async _findIndicesStrip(timeout = 5000, interval = 300) {
        const deadline = Date.now() + timeout;
        while (Date.now() < deadline) {
            const nodes = await this.getDescribedElements();
            const strip = nodes.find(n => /^Index .+\. Last traded price/.test(n.desc) || /Add Indices/i.test(n.desc));
            if (strip) return strip;
            await this.pause(interval);
        }
        return null;
    }

    // Drags across most of the SCREEN width, not the matched node's own bounds - live-observed
    // that how many separate accessibility nodes represent the strip varies (sometimes one wide
    // node spanning multiple cards, sometimes several narrow single-card nodes), and dragging
    // within a narrow node's own bounds is too short a distance to register as a real scroll,
    // silently stalling the whole list after the first genuine swipe.
    async _swipeIndicesStripRight() {
        const strip = await this._findIndicesStrip();
        if (!strip) throw new Error('Could not locate the indices strip to scroll');
        const y = Math.round((strip.y1 + strip.y2) / 2);
        const { width } = await this.driver.getWindowSize();
        await this.driver.action('pointer')
            .move({ duration: 0, x: Math.round(width * 0.95), y })
            .down()
            .move({ duration: 400, x: Math.round(width * 0.05), y })
            .up()
            .perform();
    }

    // Scrolls right until the strip's visible content truly stops changing, returning whichever
    // node's content-desc contains "Add Indices" at that point (or null if there isn't one) - the
    // SAME node the caller then acts on, rather than just logging success and letting the caller
    // re-fetch it separately (see the timing note on clickAddIndices below).
    //
    // Stopping as soon as ANY node's desc merely CONTAINS "Add Indices" is not enough: that text is
    // baked into the last real index card's own content-desc, and was observed live to already be
    // present while that card (and the actual "Add Indices" chip beside it) was still only half
    // scrolled into view at the right edge - e.g. with 6 real added indices, a screenshot confirmed
    // no chip was visibly on screen yet even though the last card's desc already matched. So this
    // compares the set of visible index names between swipes and only stops once a swipe produces
    // no change - the strip genuinely can't scroll any further right.
    async _scrollToAddIndicesNode(maxScrolls = 10) {
        let previousNames = null;
        for (let i = 0; i < maxScrolls; i++) {
            const nodes = await this.getDescribedElements();
            const names = nodes.filter(n => /^Index /.test(n.desc)).map(n => n.desc.split('.')[0]).join('|');
            if (names === previousNames) {
                return nodes.find(n => /Add Indices/i.test(n.desc)) || null;
            }
            previousNames = names;
            await this._swipeIndicesStripRight();
            await this.pause(300);
        }
        const nodes = await this.getDescribedElements();
        return nodes.find(n => /Add Indices/i.test(n.desc)) || null;
    }

    async scrollIndicesToAddButton(maxScrolls = 10) {
        const node = await this._scrollToAddIndicesNode(maxScrolls);
        if (!node) throw new Error('Could not reach "Add Indices" after scrolling the indices strip');
        console.log('"Add Indices" is now visible');
    }

    // "Add Indices" isn't its own accessibility node - it's merged into the last real index card's
    // own content-desc once scrolled fully into view (e.g. "Index SENSEX. Last traded price:
    // ...\nAdd Indices, Double tap to view SENSEX details, or swipe right for more options"),
    // rendered on screen as a separate chip near the right edge of that merged node's bounds -
    // confirmed live via screenshot to sit at roughly 80% of the node's own width.
    //
    // The unreliable part isn't the tap position itself - it's TIMING: the strip was observed live
    // to periodically reset its own scroll position back to the start (apparently on its own
    // price-refresh recompose, unrelated to anything this driver does), so a tap computed from a
    // node fetched even one getPageSource() round-trip earlier can land on whatever card the reset
    // put back in that position instead. So this taps the very node _scrollToAddIndicesNode just
    // found - no re-fetch in between - and on a miss, redoes the whole scroll-detect-tap cycle
    // (rather than just retrying a different fraction against a now-stale node).
    async clickAddIndices(maxAttempts = 5) {
        const fraction = 0.80;
        for (let attempt = 0; attempt < maxAttempts; attempt++) {
            const node = await this._scrollToAddIndicesNode();
            if (!node) throw new Error('"Add Indices" not found after scrolling');

            const tapX = Math.round(node.x1 + fraction * (node.x2 - node.x1));
            const tapY = Math.round((node.y1 + node.y2) / 2);
            await this.driver.action('pointer').move({ duration: 0, x: tapX, y: tapY }).down().up().perform();
            await this.pause(1000);

            const afterNodes = await this.getDescribedElements();
            if (afterNodes.some(n => n.desc === 'All Indices')) {
                console.log('Clicked "Add Indices"');
                return;
            }

            console.log('Tap missed "Add Indices" (the strip likely auto-reset before the tap landed) - retrying...');
            if (!afterNodes.some(n => /^Index .+\. Last traded price/.test(n.desc))) {
                await this.driver.back();
                await this.pause(500);
            }
        }
        throw new Error('Could not click "Add Indices" after multiple attempts');
    }

    async clickEditIndices(timeout = 5000) {
        await this.click(this.editIndicesButton, timeout);
        console.log('Clicked "edit Indices"');
    }

    async getRemovableIndices() {
        const nodes = await this.getDescribedElements();
        return nodes.filter(n => this.removableIndexRegex.test(n.desc)).sort((a, b) => a.y1 - b.y1);
    }

    async getAddableIndices() {
        const nodes = await this.getDescribedElements();
        return nodes.filter(n => this.addableIndexRegex.test(n.desc)).sort((a, b) => a.y1 - b.y1);
    }

    // Both the red "-" and the outlined "+" icon sit at roughly 94% along their row's width, not
    // its center (verified live via screenshot) - each row is one merged node (name + the
    // "Remove/Add Indices..." label) and neither tapping its center nor a standard accessibility
    // click() on the whole row does anything; only tapping the actual icon's own position works.
    async _tapIndexRowIcon(node) {
        const tapX = Math.round(node.x1 + 0.94 * (node.x2 - node.x1));
        const tapY = Math.round((node.y1 + node.y2) / 2);
        const name = node.desc.split('\n')[0];
        await this.driver.action('pointer').move({ duration: 0, x: tapX, y: tapY }).down().up().perform();
        return name;
    }

    async removeIndex(node) {
        const name = await this._tapIndexRowIcon(node);
        console.log(`Clicked remove for "${name}"`);
        return name;
    }

    async addIndex(node) {
        const name = await this._tapIndexRowIcon(node);
        console.log(`Clicked add for "${name}"`);
        return name;
    }

    async isIndexRemovedToastShown(name, timeout = 3000) {
        return this.waitForToast(`${name} Removed`, { timeout });
    }

    // The "Undo" action lives inside the SAME merged toast node as the "<Name> Removed" message
    // (e.g. "SENSEX Removed \nUndo"), not a separate element - verified live via screenshot that
    // it sits at roughly 90% across that node's width (message left-aligned, "Undo" right-aligned
    // Material Design snackbar convention), not at the row-icon 94%/72% used elsewhere on this
    // screen. The toast is short-lived, so this must be called immediately after removeIndex().
    async clickUndoOnToast(name, timeout = 3000) {
        const deadline = Date.now() + timeout;
        while (Date.now() < deadline) {
            const nodes = await this.getDescribedElements();
            const toast = nodes.find(n => n.desc.startsWith(`${name} Removed`) && n.desc.includes('Undo'));
            if (toast) {
                const tapX = Math.round(toast.x1 + 0.90 * (toast.x2 - toast.x1));
                const tapY = Math.round((toast.y1 + toast.y2) / 2);
                await this.driver.action('pointer').move({ duration: 0, x: tapX, y: tapY }).down().up().perform();
                console.log(`Clicked "Undo" on the "${name} Removed" toast`);
                return true;
            }
            await this.pause(100);
        }
        console.log(`"${name} Removed" toast with Undo not found in time`);
        return false;
    }

    async isMinimumIndicesToastShown(timeout = 3000) {
        return this.waitForToast('Minimum 2 Indices needed', { timeout });
    }

    // The ceiling-limit toast reads "Max 6 indices can be added" - the EXACT same text as the
    // persistent static label already shown above the list at all times, so a plain substring
    // check (waitForToast) would always report true regardless of whether the toast actually
    // fired. Distinguishing them requires counting occurrences: the static label alone is one
    // match, the label plus the toast together is two.
    async isMaximumIndicesToastShown(timeout = 3000, interval = 150) {
        const deadline = Date.now() + timeout;
        while (Date.now() < deadline) {
            const src = await this.driver.getPageSource();
            const matches = src.match(/Max 6 indices can be added/g) || [];
            if (matches.length >= 2) return true;
            await this.pause(interval);
        }
        return false;
    }

    // Confirmed live that adding an index shows no toast/snackbar at all - only removal does
    // (with an "Undo" action, which only makes sense for a destructive change). This still checks
    // for one, so a future app change adding this feedback would be picked up rather than assumed.
    async isIndexAddedToastShown(name, timeout = 3000) {
        return this.waitForToast(`${name} Added`, { timeout });
    }

    // Leaving Manage Indices (via the back arrow/hardware back) with unsaved add/remove changes
    // prompts "Do You want to Save the Changes?" with DISCARD/CHANGE actions - confirmed live that
    // DISCARD reverts to the pre-edit set and lands back on the plain "All Indices" screen (edit
    // mode exited), while CHANGE commits it.
    async clickDiscardChanges(timeout = 5000) {
        await this.click('android=new UiSelector().description("DISCARD")', timeout);
        console.log('Clicked DISCARD');
    }

    async clickSaveChanges(timeout = 5000) {
        await this.click('android=new UiSelector().description("CHANGE")', timeout);
        console.log('Clicked CHANGE (save)');
    }

    // Reads the indices currently added to the watchlist from the "All Indices" screen's own
    // (non-edit-mode) list. Outside edit mode, BOTH the pinned/added indices and the still-available
    // ones below them read as plain "Index <NAME>. Last traded price..." rows with no other visible
    // difference - the one distinguishing signal is that only the added (reorderable) ones carry
    // the drag-instruction suffix ("First, select the item. Then double-tap and keep your finger on
    // the screen..."), since only they can be reordered.
    async getAddedIndexNames() {
        const nodes = await this.getDescribedElements();
        return nodes
            .filter(n => /^Index .+\. Last traded price/.test(n.desc) && n.desc.includes('First, select the item'))
            .map(n => n.desc.match(/^Index (.+?)\./)[1]);
    }

    // The NSE/BSE filter toggle on the "All Indices" screen exposes zero selected-state via
    // accessibility (both read selected="false" always - confirmed live) - a screenshot shows the
    // active one has a plain white background instead, a purely visual cue this driver can't read
    // directly. The only reliable signal left is content-based: the indices already added to the
    // watchlist stay pinned at the top regardless of which filter is active, while the list below
    // them is the live NSE/BSE-filtered set - and every BSE-filtered entry seen there is named with
    // a "BSE " prefix (BSE 200, BSE AUTO, BSE Energy, ...) except the one pinned exception, "BSE
    // 100", which can appear in the pinned set regardless of the active filter.
    async isBseFilterSelected() {
        const nodes = await this.getDescribedElements();
        const names = nodes
            .filter(n => /^Index /.test(n.desc))
            .map(n => n.desc.match(/^Index (.+?)\./)[1]);
        return names.some(name => name.startsWith('BSE ') && name !== 'BSE 100');
    }

    // Clicks whichever of NSE/BSE is NOT currently active, toggling to the other one.
    async clickOtherExchangeFilter() {
        const bseSelected = await this.isBseFilterSelected();
        const target = bseSelected ? 'NSE' : 'BSE';
        await this.click(`android=new UiSelector().description("${target}")`);
        console.log(`"${bseSelected ? 'BSE' : 'NSE'}" was selected - clicked "${target}"`);
        return target;
    }

    // The "All Indices" list's own live tickers are truncated the same way as everywhere else via
    // stableEntryId ("Last traded price" marker), so the shared anyDescribedElementRegex/
    // scrollToBoundaryByDescRegex combo already used for a Quote screen works unchanged here too.
    async scrollAllIndicesToBottom(maxScrolls = 20, settleMs = 150) {
        await this.scrollToBoundaryByDescRegex(this.anyDescribedElementRegex, 'down', { maxScrolls, settleMs });
        console.log('Scrolled All Indices list to bottom');
    }

    async scrollAllIndicesToTop(maxScrolls = 20, settleMs = 150) {
        await this.scrollToBoundaryByDescRegex(this.anyDescribedElementRegex, 'up', { maxScrolls, settleMs });
        console.log('Scrolled All Indices list to top');
    }

    async clickSwipeUpForDetails(timeout = 5000) {
        await this.click(this.swipeUpForDetails, timeout);
        console.log('Clicked "Swipe up for Stock Details"');
    }

    async clickViewChart(timeout = 5000) {
        await this.click(this.viewChartButton, timeout);
        console.log('Clicked View Chart');
    }

    async isChartOpened(timeout = 15000) {
        return this.isElementVisible(this.chartMarker, timeout);
    }

    async clickAddAlert(timeout = 5000) {
        await this.click(this.addAlertButton, timeout);
        console.log('Clicked Add Alert');
    }

    // Not every index has an Option Chain (e.g. sector/thematic indices with no listed options) -
    // same optional-tab situation as isFuturesTabShown, checked the same way rather than assuming
    // every instrument's Quotes screen has one.
    async isOptionChainShown(timeout = 2000) {
        return this.isElementVisible(this.optionChainButton, timeout);
    }

    async clickOptionChain(timeout = 5000) {
        await this.click(this.optionChainButton, timeout);
        console.log('Clicked Option Chain');
    }

    async clickOptionChainSearch(timeout = 5000) {
        await this.click(this.optionChainSearchButton, timeout);
        console.log('Clicked Search on Option Chain screen');
    }

    async searchOptionChainSymbol(query, timeout = 5000) {
        const input = await this.findElement(this.optionChainSearchInput, timeout);
        await input.click();
        await this.pause(300);
        await input.setValue(query);
        await this.pause(1000);
        console.log(`Typed "${query}" into Option Chain search`);
    }

    // Result rows read like "TATASTEEL\nAdd Watchlist, Double tap to open Quote Screen." - the
    // symbol name is whatever precedes that fixed suffix.
    async getOptionChainSearchResults() {
        const nodes = await this.getDescribedElements();
        return nodes
            .filter(n => n.desc.includes('Add Watchlist, Double tap to open Quote Screen.'))
            .map(n => n.desc.split('\n')[0].trim());
    }

    async clickOptionChainFilterTab(label, timeout = 5000) {
        await this.click(`android=new UiSelector().description("${label}")`, timeout);
        console.log(`Clicked "${label}" filter tab`);
    }

    async clickOptionChainCancel(timeout = 5000) {
        await this.click(this.optionChainCancelButton, timeout);
        console.log('Clicked Cancel on Option Chain search');
    }

    // Each strike row in the Option Chain table is [Strike Price][Call LTP][Put LTP], laid out
    // around the live marker row as: ...[strike][call][put][MARKER][strike][call][put]... - so
    // the "above" row's cells sit 3/2/1 positions before the marker and the "below" row's sit
    // 1/2/3 positions after it.
    async clickOptionRow(direction, cellType = 'call') {
        const nodes = await this.getDescribedElements();
        const markerIdx = nodes.findIndex(n => this.optionChainMarkerRegex.test(n.desc));
        if (markerIdx === -1) throw new Error('Could not locate the live price marker row in Option Chain');

        let targetIdx, strikeIdx;
        if (direction === 'above') {
            strikeIdx = markerIdx - 3;
            targetIdx = cellType === 'put' ? markerIdx - 1 : markerIdx - 2;
        } else if (direction === 'below') {
            strikeIdx = markerIdx + 1;
            targetIdx = cellType === 'put' ? markerIdx + 3 : markerIdx + 2;
        } else {
            throw new Error(`Unknown direction "${direction}", expected "above" or "below"`);
        }

        const target = nodes[targetIdx];
        if (!target) throw new Error(`Could not find the ${direction} ${cellType} option row`);

        const strike = nodes[strikeIdx] ? nodes[strikeIdx].desc : 'unknown strike';
        await this.tapNode(target);
        console.log(`Clicked the option row ${direction} the live price marker (strike ${strike}, ${cellType.toUpperCase()})`);
    }

    // Reads the strike values of the rows immediately above/below the live price marker, without
    // clicking either - used to check the table's current sort order (ascending by default,
    // descending once the Strike Price header is clicked).
    async getMarkerNeighborStrikes() {
        const nodes = await this.getDescribedElements();
        const markerIdx = nodes.findIndex(n => this.optionChainMarkerRegex.test(n.desc));
        if (markerIdx === -1) throw new Error('Could not locate the live price marker row in Option Chain');
        return {
            above: Number(nodes[markerIdx - 3].desc),
            below: Number(nodes[markerIdx + 1].desc),
        };
    }

    async clickStrikePriceHeader(timeout = 5000) {
        await this.click(this.strikePriceHeader, timeout);
        console.log('Clicked Strike Price column header');
    }

    // None of the OI/LTP/Greeks tabs expose a selected/checked accessibility state, so "LTP is
    // the default tab" can only be confirmed indirectly - by checking that the table's column
    // headers are the LTP-view ones ("Call LTP"/"Put LTP"), which only render while that tab is active.
    async isOptionChainOnLtpTab() {
        const nodes = await this.getDescribedElements();
        return nodes.some(n => n.desc === 'Call LTP') && nodes.some(n => n.desc === 'Put LTP');
    }

    async clickOptionChainTab(label, timeout = 5000) {
        await this.click(`android=new UiSelector().description("${label}")`, timeout);
        console.log(`Clicked "${label}" tab on Option Chain`);
    }

    async scrollOptionChainToBottom(maxScrolls = 20, settleMs = 100) {
        await this.scrollToBoundaryByDescRegex(this.optionChainStrikeRowRegex, 'down', { maxScrolls, settleMs });
        console.log('Scrolled Option Chain table to bottom');
    }

    async scrollOptionChainToTop(maxScrolls = 20, settleMs = 100) {
        await this.scrollToBoundaryByDescRegex(this.optionChainStrikeRowRegex, 'up', { maxScrolls, settleMs });
        console.log('Scrolled Option Chain table to top');
    }

    async getExpiryDateTabs() {
        const nodes = await this.getDescribedElements();
        return nodes.filter(n => this.optionChainDateTabRegex.test(n.desc)).sort((a, b) => a.x1 - b.x1);
    }

    async clickExpiryDateTab(index) {
        const tabs = await this.getExpiryDateTabs();
        const tab = tabs[index];
        if (!tab) throw new Error(`Could not find expiry date tab at index ${index} (found ${tabs.length} tabs)`);
        const label = tab.desc.replace(/\n/g, ' ');
        await this.tapNode(tab);
        console.log(`Clicked expiry date tab: "${label}"`);
        return label;
    }

    // Expiry tab labels read like "08 Sep 2026\nW2\n(4 D)" - only the leading "DD Mon YYYY" part
    // is a real calendar date, parseable directly by the JS Date constructor.
    _parseExpiryDateLabel(desc) {
        const m = desc.match(/^(\d{2} \w{3} \d{4})/);
        if (!m) return null;
        const date = new Date(m[1]);
        return isNaN(date.getTime()) ? null : date;
    }

    // Every expiry tab shown should be today's date or later - an option chain never lists an
    // already-expired series - checked generically off the device's own current date rather than
    // a hardcoded one, since the tabs shift day to day.
    async verifyExpiryDatesAreTodayOrFuture() {
        const tabs = await this.getExpiryDateTabs();
        const today = new Date();
        today.setHours(0, 0, 0, 0);

        let allValid = tabs.length > 0;
        for (const tab of tabs) {
            const label = tab.desc.replace(/\n/g, ' ');
            const date = this._parseExpiryDateLabel(tab.desc);
            const isTodayOrFuture = date !== null && date >= today;
            console.log(`  Expiry tab "${label}": ${isTodayOrFuture ? 'PASS (today or future)' : 'FAIL'}`);
            if (!isTodayOrFuture) allValid = false;
        }
        return allValid;
    }

    // Not every index has a listed futures contract - the Futures tab is simply absent from the
    // Overview/Futures/Technicals/Constituents strip for those (Technicals/Constituents shift left
    // to fill the gap), rather than being present-but-disabled.
    async isFuturesTabShown(timeout = 2000) {
        return this.isElementVisible(this.futuresTabButton, timeout);
    }

    async clickFuturesTab(timeout = 5000) {
        await this.click(this.futuresTabButton, timeout);
        console.log('Clicked Futures tab');
    }

    async getFuturesContracts() {
        const nodes = await this.getDescribedElements();
        return nodes.filter(n => this.futureContractRegex.test(n.desc)).sort((a, b) => a.y1 - b.y1);
    }

    _parseFutureContract(desc) {
        const m = desc.match(this.futureContractRegex);
        if (!m) return null;
        return { symbol: m[1], expiryLabel: m[2], exchange: m[3], ltp: m[4], change: m[5], changePercent: m[6] };
    }

    // "24SEP" carries no year, so it's inferred as the current year - rolling to next year if
    // that date has already passed (a contract expiring in an earlier month than "today").
    _parseFutureExpiryDate(expiryLabel, today) {
        const m = expiryLabel.match(/^(\d{2})([A-Z]{3})$/);
        if (!m) return null;
        const [, day, mon] = m;
        const year = today.getFullYear();
        let date = new Date(`${day} ${mon} ${year}`);
        if (isNaN(date.getTime())) return null;
        if (date < today) date = new Date(`${day} ${mon} ${year + 1}`);
        return date;
    }

    async verifyFuturesExpiryDatesAreTodayOrFuture() {
        const contracts = await this.getFuturesContracts();
        const today = new Date();
        today.setHours(0, 0, 0, 0);

        let allValid = contracts.length > 0;
        for (const node of contracts) {
            const parsed = this._parseFutureContract(node.desc);
            const date = parsed ? this._parseFutureExpiryDate(parsed.expiryLabel, today) : null;
            const isTodayOrFuture = date !== null && date >= today;
            const label = parsed ? `${parsed.symbol} ${parsed.expiryLabel}` : node.desc;
            console.log(`  Future contract "${label}": ${isTodayOrFuture ? 'PASS (today or future)' : 'FAIL'}`);
            if (!isTodayOrFuture) allValid = false;
        }
        return allValid;
    }

    printFutureContractFields(node) {
        const parsed = this._parseFutureContract(node.desc);
        console.log('--- Future Contract Fields ---');
        console.log(`  Symbol: ${parsed.symbol} ${parsed.expiryLabel} FUT`);
        console.log(`  Exchange: ${parsed.exchange}`);
        console.log(`  LTP: ${parsed.ltp}`);
        console.log(`  Change: ${parsed.change}`);
        console.log(`  Change %: ${parsed.changePercent}`);
        console.log('------------------------------');
        return parsed;
    }

    async clickFuturesContract(index) {
        const contracts = await this.getFuturesContracts();
        const target = contracts[index];
        if (!target) throw new Error(`Could not find F&O contract at index ${index} (found ${contracts.length})`);
        await this.tapNode(target);
        console.log(`Clicked F&O contract at index ${index}`);
        return target;
    }

    async clickConstituentsTab(timeout = 5000) {
        await this.click(this.constituentsTabButton, timeout);
        console.log('Clicked Constituents tab');
    }

    async getConstituentStocks() {
        const nodes = await this.getDescribedElements();
        return nodes.filter(n => this.constituentStockRegex.test(n.desc)).sort((a, b) => a.y1 - b.y1);
    }

    async getConstituentsCountLabel() {
        const nodes = await this.getDescribedElements();
        const node = nodes.find(n => this.constituentsCountRegex.test(n.desc));
        return node ? node.desc : null;
    }

    async clickConstituentStock(index) {
        const stocks = await this.getConstituentStocks();
        const target = stocks[index];
        if (!target) throw new Error(`Could not find constituent stock at index ${index} (found ${stocks.length})`);
        const symbol = target.desc.match(this.constituentStockRegex)[1];
        await this.tapNode(target);
        console.log(`Clicked constituent stock at index ${index}: "${symbol}"`);
        return target;
    }

    async scrollQuoteScreenToBottom(maxScrolls = 20, settleMs = 150) {
        await this.scrollToBoundaryByDescRegex(this.anyDescribedElementRegex, 'down', { maxScrolls, settleMs });
        console.log('Scrolled Quote screen to bottom');
    }

    async scrollQuoteScreenToTop(maxScrolls = 20, settleMs = 150) {
        await this.scrollToBoundaryByDescRegex(this.anyDescribedElementRegex, 'up', { maxScrolls, settleMs });
        console.log('Scrolled Quote screen to top');
    }

    async clickTechnicalsTab(timeout = 5000) {
        await this.click(this.technicalsTabButton, timeout);
        console.log('Clicked Technicals tab');
    }

    async getDurationTabs() {
        const nodes = await this.getDescribedElements();
        return nodes
            .filter(n => /^.+\nTab \d+ of \d+$/.test(n.desc))
            .filter(n => !this.mainQuoteTabLabels.some(label => n.desc.startsWith(`${label}\n`)))
            .sort((a, b) => a.x1 - b.x1);
    }

    async clickDurationTab(index) {
        const tabs = await this.getDurationTabs();
        const tab = tabs[index];
        if (!tab) throw new Error(`Could not find duration tab at index ${index} (found ${tabs.length})`);
        const label = tab.desc.replace(/\n/g, ' ');
        await this.tapNode(tab);
        console.log(`Clicked duration tab: "${label}"`);
        return label;
    }

    // The "Weekly" and "Monthly" durations drop the Moving Average grid entirely (only "Technical
    // Indicators" remains) - so the SMA/EMA toggle simply doesn't exist on those two screens,
    // rather than existing-but-disabled.
    async isMovingAverageShown(timeout = 2000) {
        return this.isElementVisible(this.smaButton, timeout);
    }

    async clickSMA(timeout = 5000) {
        await this.click(this.smaButton, timeout);
        console.log('Clicked SMA');
    }

    async clickEMA(timeout = 5000) {
        await this.click(this.emaButton, timeout);
        console.log('Clicked EMA');
    }

    _isValueLike(desc) {
        return /^-?\d+(\.\d+)?$/.test(desc);
    }

    // Both the Moving Average grid ("5 Day"/"10 Day"/"20 Day" then their 3 values) and the
    // Technical Indicators row ("RSI(14)"/"MACD(12,26,9)"/"ROC(20)" then their 3 values) render as
    // a run of header labels immediately followed by an equal-length run of numeric values - so
    // pairing them up just means walking the node list for that shape, with no hardcoded header
    // names needed (aside from the section-title exclusions above).
    _groupHeaderValueRuns(nodes) {
        const groups = [];
        let i = 0;
        while (i < nodes.length) {
            const desc = nodes[i].desc;
            if (this._isValueLike(desc) || this.technicalsSectionTitles.has(desc)) { i++; continue; }
            let headerEnd = i;
            while (headerEnd < nodes.length && !this._isValueLike(nodes[headerEnd].desc) && !this.technicalsSectionTitles.has(nodes[headerEnd].desc)) headerEnd++;
            let valueEnd = headerEnd;
            while (valueEnd < nodes.length && this._isValueLike(nodes[valueEnd].desc)) valueEnd++;
            if (valueEnd - headerEnd === headerEnd - i) {
                groups.push({
                    headers: nodes.slice(i, headerEnd).map(n => n.desc),
                    values: nodes.slice(headerEnd, valueEnd).map(n => n.desc),
                });
            }
            i = valueEnd > headerEnd ? valueEnd : headerEnd + 1;
        }
        return groups;
    }

    // A single indicator genuinely reading 0.00 alongside otherwise-valid siblings in the same row
    // (e.g. MFI(14) at 0.00 next to CCI(20) at 121.59) is real data, not a loading failure - this
    // only fails a row where EVERY value in it came back 0.00.
    async verifyNoZeroValueFields(context) {
        const nodes = await this.getDescribedElements();
        const groups = this._groupHeaderValueRuns(nodes);

        let pass = true;
        for (const group of groups) {
            if (group.values.every(v => v === '0.00')) {
                console.log(`  [${context}] FAIL - all values under "${group.headers.join(', ')}" are 0.00`);
                pass = false;
            }
        }
        if (pass) console.log(`  [${context}] PASS (no header's values are all 0.00)`);
        return pass;
    }

    async goBackToQuotes() {
        await this.driver.back();
        await this.pause(1000);
        console.log('Navigated back to Quotes screen');
    }

    // A label row reads like "Open. 23910.90., Displays the Open value." - the value is a plain
    // number immediately following the label (one optional decimal point), stopping before the
    // sentence-ending period so it isn't swept up into the match.
    _getLabeledValue(nodes, label) {
        const node = nodes.find(n => n.desc.startsWith(label));
        if (!node) return null;
        const m = node.desc.slice(label.length).match(/^\.?\s*(\d+(?:\.\d+)?)/);
        return m ? m[1] : null;
    }

    // Prints only the index name (with its exchange), LTP, change value/percentage, and
    // Pr. Close/Open/High/Low - not the full page dump (tabs, action buttons, 52-week range,
    // CAS section, etc.).
    //
    // NOTE: the on-screen timestamp ("04 SEP 2026, 12:37:08 PM") is not included - verified live
    // that it carries no content-desc or text and doesn't appear anywhere in the raw page source
    // at all, so it has zero accessibility exposure and can't be read (or its date verified)
    // through Appium.
    async printQuoteDetails() {
        const nodes = await this.getDescribedElements();

        const summaryNode = nodes.find(n => /^Stock .+\. Last traded price/.test(n.desc));
        const summaryMatch = summaryNode && summaryNode.desc.match(
            /^Stock (.+?), (\S+)\. Last traded price ([\d.]+)\. Change (-?[\d.]+)\. Change percentage (-?[\d.]+) percent\./
        );

        const details = {
            name: summaryMatch ? summaryMatch[1] : null,
            exchange: summaryMatch ? summaryMatch[2] : null,
            ltp: summaryMatch ? summaryMatch[3] : null,
            change: summaryMatch ? summaryMatch[4] : null,
            changePercent: summaryMatch ? summaryMatch[5] : null,
            prClose: this._getLabeledValue(nodes, 'Pr. Close'),
            open: this._getLabeledValue(nodes, 'Open'),
            high: this._getLabeledValue(nodes, 'High'),
            low: this._getLabeledValue(nodes, 'Low'),
        };

        console.log('--- Quote Details ---');
        console.log(`  Name: ${details.name}`);
        console.log(`  Exchange: ${details.exchange}`);
        console.log(`  LTP: ${details.ltp}`);
        console.log(`  Change: ${details.change}`);
        console.log(`  Change %: ${details.changePercent}`);
        console.log(`  Pr. Close: ${details.prClose}`);
        console.log(`  Open: ${details.open}`);
        console.log(`  High: ${details.high}`);
        console.log(`  Low: ${details.low}`);
        console.log('---------------------');

        return details;
    }
}

module.exports = WatchlistIndexPage;
