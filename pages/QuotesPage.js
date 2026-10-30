const BasePage = require('./BasePage');
const { decodePng, pixelAt } = require('../utils/pngPixels');

// The NSE/BSE toggle under the symbol name is drawn inside the header's merged node - nothing of
// its own in the tree - so it is read off a screenshot. Offsets are from the header node's top-left
// (verified live on 1080x2340, header [42,150][1038,362] on the expanded Quote): the label row sits
// 111px down, the NSE label spans x+100..x+180 and the BSE label x+215..x+295. Labels are white,
// and the selected one is blue (112,176,224) on a dark-blue pill.
const TOGGLE_ROW_DY = 111;
const TOGGLE_SLOTS = [{ name: 'NSE', from: 100, to: 180 }, { name: 'BSE', from: 215, to: 295 }];
const EQUITY_EXCHANGES = ['NSE', 'BSE'];

// Quote fields come from the app as accessibility strings in one of two shapes:
//   "<Label>. <Value>., Displays the <Label> value."       (Open/High/Low/Pr. Close/Total Buy Qty/...)
//   "<Label>. <Value>., Displays the <rephrased description>."  (Volume/52 week range/Circuit limits/...)
// The trailing clause repeats the label verbatim only in the first shape, so that's tried first
// (also handles labels that themselves contain a period, e.g. "Pr. Close"); otherwise the leading
// segment of the value clause is taken as the label instead of guessing from the description.
function parseLabeledDesc(desc) {
    const m = desc.match(/^(.+?),\s*Displays the (.+)\.$/);
    if (!m) return null;
    const part0 = m[1];
    const descriptor = m[2].trim();

    let label, value;
    if (/ value$/i.test(descriptor)) {
        const candidateLabel = descriptor.replace(/ value$/i, '').trim();
        const prefix = candidateLabel + '. ';
        if (part0.startsWith(prefix)) {
            label = candidateLabel;
            value = part0.slice(prefix.length);
        }
    }
    if (label === undefined) {
        const dotIdx = part0.indexOf('. ');
        if (dotIdx === -1) {
            label = descriptor;
            value = part0;
        } else {
            label = part0.slice(0, dotIdx);
            value = part0.slice(dotIdx + 2);
        }
    }
    return { field: label.trim(), value: value.replace(/\.$/, '').trim() };
}

// The stock header packs Symbol/Exchange/LTP/Change/Change% into one sentence-style content-desc;
// nothing about it fits the generic "<Label>. <Value>." shape above, so it gets its own parser.
function parseStockSummary(desc) {
    const m = desc.match(/^Stock\s+(.+?),\s*([A-Za-z]+)\.\s*Last traded price\s+([\d.,-]+)\.\s*Change\s+(-?[\d.,]+)\.\s*Change percentage\s+(-?[\d.,]+)\s*percent\./);
    if (!m) return null;
    return {
        'Symbol Name': m[1].trim(),
        Exchange: m[2].trim(),
        LTP: m[3].trim(),
        Change: m[4].trim(),
        'Change %': m[5].trim() + '%',
    };
}

// Dates on the call-detail dialog read like "13 JAN 2027" - not a format Date() parses natively.
const MONTHS = { JAN: 0, FEB: 1, MAR: 2, APR: 3, MAY: 4, JUN: 5, JUL: 6, AUG: 7, SEP: 8, OCT: 9, NOV: 10, DEC: 11 };
function parseAppDate(text) {
    const m = text.trim().match(/^(\d{1,2})\s+([A-Za-z]{3})\s+(\d{4})$/);
    if (!m) return null;
    const month = MONTHS[m[2].toUpperCase()];
    if (month === undefined) return null;
    return new Date(Number(m[3]), month, Number(m[1]));
}

class QuotesPage extends BasePage {
    constructor(driver) {
        super(driver);
        this.quoteButton = 'android=new UiSelector().description("QUOTE")';
        this.watchlistButton = 'android=new UiSelector().description("WATCHLIST")';
        this.buyButton = 'android=new UiSelector().description("BUY")';
        this.sellButton = 'android=new UiSelector().description("SELL")';

        // The call-detail dialog has TWO "BUY" elements: a non-clickable View tagging the call's
        // own transaction type, and the actual clickable Button. A plain description("BUY") match
        // returns the tag first (document order) and silently no-ops on click - className narrows
        // it to the real button. The Quotes screen's own BUY has no such duplicate, so buyButton
        // above still works fine there.
        this.dialogBuyButton = 'android=new UiSelector().className("android.widget.Button").description("BUY")';
        this.swipeUpForDetails = 'android=new UiSelector().description("Swipe up for Stock Details")';
        this.advancedOptionsIcon = 'android=new UiSelector().description("Advanced Options")';
        this.addToBasketOption = 'android=new UiSelector().description("Add To Basket")';
        this.compareWithPeerOption = 'android=new UiSelector().description("Compare with Peer")';
        this.stockSummary = 'android=new UiSelector().descriptionContains("Swipe up to explore quote details")';
        this.anyDescribedElement = 'android=new UiSelector().descriptionMatches(".+")';
    }

    async openQuote() {
        await this.click(this.quoteButton);
        console.log('Opened Quotes screen');
    }

    async clickDialogBuy() {
        await this.click(this.dialogBuyButton);
        console.log('Clicked BUY on the call-detail dialog');
    }

    // Unlike the Quotes screen, this dialog's fields have no field name embedded in their own
    // content-desc - a label ("End Date") and its value ("13 JAN 2027") are separate sibling
    // elements positioned in adjacent rows. This finds whichever other row sits closest to the
    // label's row and picks the cell in that row whose x-position is closest to the label's own -
    // i.e. same column - without hardcoding a fixed row offset or column index.
    findAdjacentValue(nodes, labelNode, rowTolerance = 15) {
        const outsideOwnRow = nodes.filter(n => n !== labelNode && Math.abs(n.y1 - labelNode.y1) > rowTolerance);
        if (!outsideOwnRow.length) return null;

        // Cluster into contiguous rows by y-proximity first, then pick the single nearest row -
        // comparing every element's distance to the tolerance independently (the earlier approach)
        // let two distinct-but-nearby rows bleed into one "row" whenever their distances from the
        // label happened to differ by less than the tolerance, occasionally preferring the wrong row.
        const sorted = [...outsideOwnRow].sort((a, b) => a.y1 - b.y1);
        const rows = [[sorted[0]]];
        for (let i = 1; i < sorted.length; i++) {
            const row = rows[rows.length - 1];
            if (sorted[i].y1 - row[row.length - 1].y1 <= rowTolerance) row.push(sorted[i]);
            else rows.push([sorted[i]]);
        }

        const nearestRow = rows.reduce((best, row) =>
            Math.abs(row[0].y1 - labelNode.y1) < Math.abs(best[0].y1 - labelNode.y1) ? row : best
        );
        nearestRow.sort((a, b) => Math.abs(a.x1 - labelNode.x1) - Math.abs(b.x1 - labelNode.x1));
        return nearestRow[0] ? nearestRow[0].desc.trim() : null;
    }

    // Reads the call-detail dialog shown right after tapping a symbol card (before QUOTE is
    // clicked) - the entry summary already known from the research-call card, plus fields only
    // visible here (Entry Price, Stop Loss, LTP, P&L, Start/End Date), located by row/column
    // adjacency to their known structural labels rather than a hardcoded field list.
    async readCallDetails(entrySummaryDesc) {
        console.log('--- Call Details (from tapped symbol) ---');
        if (entrySummaryDesc) {
            console.log('  Entry summary: ' + entrySummaryDesc.replace(/\n/g, ' | '));
        }

        const nodes = await this.getDescribedElements();
        const knownLabels = ['Entry Price', 'Stop Loss', 'LTP', 'Partial Gain/Loss', 'Total Realized Gain/Loss', 'Start Date', 'End Date'];
        const details = {};
        for (const labelText of knownLabels) {
            const labelNode = nodes.find(n => n.desc.trim() === labelText);
            if (!labelNode) continue;
            const value = this.findAdjacentValue(nodes, labelNode);
            if (value !== null) details[labelText] = value;
        }

        for (const [field, value] of Object.entries(details)) {
            console.log(`  ${field}: ${value}`);
        }
        return details;
    }

    // Compares the call's End Date against today to report whether it's still active or expired.
    async validateEndDate(details) {
        const endDateText = details && details['End Date'];
        if (!endDateText) {
            console.log('End Date field not found - skipping validation');
            return null;
        }
        const endDate = parseAppDate(endDateText);
        if (!endDate) {
            console.log(`Could not parse End Date "${endDateText}" - skipping validation`);
            return null;
        }
        const today = new Date();
        today.setHours(0, 0, 0, 0);
        const isActive = endDate.getTime() >= today.getTime();
        console.log(`End Date check: End Date=${endDateText}, Today=${today.toDateString()}, Call is ${isActive ? 'ACTIVE (end date is today or later)' : 'EXPIRED (end date is before today)'}`);
        return { endDateText, endDate, isActive };
    }

    async isDisplayed(timeout = 5000) {
        return await this.isElementVisible(this.stockSummary, timeout);
    }

    // Dynamically captures every visible quote field - no hardcoded field list - by parsing
    // whatever labeled content-desc strings are currently on screen. The market-depth grid
    // (Bid/Ask/Ord/Qty) is deliberately skipped - it's order-book depth, not a quote field.
    async readQuoteDetails() {
        const nodes = await this.getDescribedElements();
        const details = {};

        for (const node of nodes) {
            const summary = parseStockSummary(node.desc);
            if (summary) { Object.assign(details, summary); continue; }
            const labeled = parseLabeledDesc(node.desc);
            if (labeled) { details[labeled.field] = labeled.value; continue; }
        }

        console.log('--- Quote Details (captured dynamically) ---');
        for (const [field, value] of Object.entries(details)) {
            console.log(`  ${field}: ${value}`);
        }
        return details;
    }

    // Expands the half-height Quotes sheet with a real swipe-up gesture (see
    // BasePage.swipeUpToExpandQuote) instead of tapping the "Swipe up for Stock Details" handle.
    async swipeUpQuoteScreen() {
        return this.swipeUpToExpandQuote();
    }

    // Derivative quotes (e.g. Research Calls' DERIVATIVE - TECHNICAL) keep rewriting their text
    // (LTP, OI, market depth...), so a text-signature boundary check never matches and swipes on
    // past the end - stop as soon as a swipe no longer moves anything instead.
    async scrollToBottom() {
        const swipes = await this.scrollToBoundaryByMovement('down');
        console.log(`Scrolled to bottom of Quotes screen (${swipes} swipe(s))`);
    }

    async clickBuy() {
        await this.click(this.buyButton);
        console.log('Clicked BUY');
    }

    async clickSell() {
        await this.click(this.sellButton);
        console.log('Clicked SELL');
    }

    async openAdvancedOptions() {
        await this.click(this.advancedOptionsIcon);
        console.log('Opened Options menu');
    }

    // Selecting a basket opens a mini order-pad to set qty/price; confirming there (its own BUY
    // button) is what actually adds the symbol to the basket and returns to the Quotes screen.
    async addToBasket(basketPosition) {
        await this.click(this.addToBasketOption);
        const chosen = await this.selectListItemByPosition(basketPosition, { exclude: ['New Basket'] });
        console.log(`Selected basket #${basketPosition}: "${chosen}"`);

        await this.click(this.buyButton);
        const added = await this.waitForToast('Added To Basket');
        console.log(added ? 'Confirmed: "Added To Basket" message shown' : 'Warning: no "Added To Basket" confirmation observed');
        return added;
    }

    // WATCHLIST lives one screen behind the Quotes screen (on the call-detail dialog), not on the
    // Quotes screen itself - go back a screen only if it isn't already visible.
    async openWatchlistPicker() {
        let visible = await this.isElementVisible(this.watchlistButton, 1500);
        if (!visible) {
            await this.driver.back();
            await this.driver.pause(800);
            visible = await this.isElementVisible(this.watchlistButton, 3000);
        }
        if (!visible) throw new Error('WATCHLIST option could not be found');
        await this.click(this.watchlistButton);
        console.log('Opened Watchlist picker');
    }

    async selectWatchlist(position) {
        const chosen = await this.selectListItemByPosition(position);
        console.log(`Selected watchlist #${position}: "${chosen}"`);
        const added = await this.waitForToast('Added to Watchlist');
        console.log(added ? 'Confirmed: "Added to Watchlist" message shown' : 'Warning: no "Added to Watchlist" confirmation observed');
        return added;
    }

    // From the watchlist picker: one back press dismisses it to the call-detail dialog, a second
    // dismisses that dialog back to the Research Calls list.
    async returnToResearchCallsList() {
        await this.driver.back();
        await this.driver.pause(600);
        await this.driver.back();
        await this.driver.pause(600);
        console.log('Returned to Research Calls list');
    }

    // A symbol with an upcoming/current corporate action shows an "Event" tag under its header
    // ("Event  Stock split Ratio 10:5, Ex Date 06 Oct 2026"). Compose merges it into the header's
    // own content-desc ("Stock BLSE, NSE. Last traded price ...\nEvent\n<event text>, Swipe up..."),
    // so it's parsed from there. Returns { symbol, exchange, event } - event is null when the
    // Quote has no Event tag - or null if no Quote header appeared within `timeout`.
    async readEventTag(timeout = 8000) {
        if (!(await this.isElementVisible(this.stockSummary, timeout))) return null;
        const desc = await (await this.driver.$(this.stockSummary)).getAttribute('content-desc');
        const head = desc.match(/^Stock\s+(.+?),\s*([A-Za-z]+)\./);
        const event = desc.match(/\nEvent\n([\s\S]+?),\s*Swipe up to explore quote details/);
        return {
            symbol: head ? head[1].trim() : null,
            exchange: head ? head[2].trim() : null,
            event: event ? event[1].trim() : null,
        };
    }

    // { node, symbol, exchange } for the Quote header ("Stock SEJALLTD, NSE. Last traded ..."),
    // or null when no Quote is on screen.
    async getQuoteHeader() {
        const node = (await this.getDescribedElements()).find(n => n.desc.startsWith('Stock ') && n.desc.includes('Swipe up to explore quote details'));
        const m = node && node.desc.match(/^Stock\s+(.+?),\s*([A-Za-z]+)\./);
        return m ? { node, symbol: m[1].trim(), exchange: m[2].trim() } : null;
    }

    isEquity(exchange) {
        return EQUITY_EXCHANGES.includes(exchange);
    }

    // Reads the NSE/BSE toggle (see TOGGLE_SLOTS): which labels are drawn - both for a dual-listed
    // stock, one or none otherwise - and which one is highlighted.
    async readExchangeToggle() {
        const header = await this.getQuoteHeader();
        if (!header) return null;
        const img = decodePng(Buffer.from(await this.driver.takeScreenshot(), 'base64'));
        const { width } = await this.driver.getWindowSize();
        const scale = img.width / width;
        const y = (header.node.y1 + TOGGLE_ROW_DY) * scale;
        const slots = TOGGLE_SLOTS.map(s => {
            let text = 0, blue = 0;
            for (let x = header.node.x1 + s.from; x < header.node.x1 + s.to; x++) {
                const [r, g, b] = pixelAt(img, x * scale, y);
                if (Math.max(r, g, b) > 150) text++;
                if (b > 150 && b - r > 60) blue++;
            }
            return { ...s, shown: text > 3, blue, x: header.node.x1 + (s.from + s.to) / 2, y: header.node.y1 + TOGGLE_ROW_DY };
        });
        const shown = slots.filter(s => s.shown);
        const highlighted = shown.length ? shown.reduce((a, b) => (b.blue > a.blue ? b : a)) : null;
        return { ...header, slots: shown, selected: highlighted && highlighted.blue > 3 ? highlighted.name : null };
    }

    // Checks the highlighted toggle matches the header's exchange, then switches to the other one
    // (NSE -> BSE or BSE -> NSE) and checks both the header and the highlight follow. With only one
    // segment shown (or no toggle at all) nothing is tapped.
    async verifyAndSwitchExchange(timeout = 6000) {
        const before = await this.readExchangeToggle();
        if (!before) {
            console.log('Quote header not found - cannot check the NSE/BSE toggle: FAIL');
            return false;
        }
        if (before.slots.length < 2) {
            console.log(`Only one segment displayed for ${before.symbol} (${before.exchange}) - toggle not performed`);
            return true;
        }
        const selectedOk = before.selected === before.exchange;
        console.log(`Toggle selected under ${before.symbol}: ${before.selected || 'none'} (header exchange ${before.exchange}): ${selectedOk ? 'PASS' : 'FAIL'}`);

        const target = before.slots.find(s => s.name !== before.exchange);
        await this.driver.action('pointer', { parameters: { pointerType: 'touch' } })
            .move({ duration: 0, x: Math.round(target.x), y: Math.round(target.y) })
            .down().pause(80).up()
            .perform();
        console.log(`Clicked ${target.name} on the toggle`);

        let after = null;
        const deadline = Date.now() + timeout;
        do {
            await this.pause(600);
            after = await this.readExchangeToggle();
        } while (!(after && after.exchange === target.name && after.selected === target.name) && Date.now() < deadline);
        const switched = !!after && after.exchange === target.name && after.selected === target.name;
        console.log(`Switched ${before.exchange} -> ${target.name} (header now ${after ? `${after.symbol}, ${after.exchange}` : 'not found'}, toggle selected ${after ? after.selected || 'none' : 'none'}): ${switched ? 'PASS' : 'FAIL'}`);
        return selectedOk && switched;
    }

    // The 52 week section ("52 week range. Year low 381.00. Year high 1036.70., ...") with its
    // red-to-green range bar and marker drawn just below the labels. Only equity Quotes have it, so
    // for anything else (NFO/BFO/MCX/CDS...) it must not be displayed. The bar is confirmed from the
    // screenshot as saturated pixels in the node's lower part (the labels themselves are white).
    async verify52WeekIndicator(exchange, maxSwipes = 2) {
        const find = async () => (await this.getDescribedElements()).find(n => n.desc.startsWith('52 week range.'));
        let node = await find();
        for (let i = 0; i < maxSwipes && !node; i++) {
            await this.swipe('down');
            await this.pause(600);
            node = await find();
        }
        if (!this.isEquity(exchange)) {
            console.log(`52 week low/high indicator not displayed for a non-equity symbol (${exchange}): ${node ? 'FAIL (displayed)' : 'PASS'}`);
            return !node;
        }
        if (!node) {
            console.log('52 week low/high indicator not displayed: FAIL');
            return false;
        }
        const m = node.desc.match(/Year low ([\d,]+(?:\.\d+)?)\. Year high ([\d,]+(?:\.\d+)?)/);
        const low = m ? Number(m[1].replace(/,/g, '')) : NaN;
        const high = m ? Number(m[2].replace(/,/g, '')) : NaN;
        const valuesOk = !Number.isNaN(low) && !Number.isNaN(high) && low <= high;

        const img = decodePng(Buffer.from(await this.driver.takeScreenshot(), 'base64'));
        const { width } = await this.driver.getWindowSize();
        const scale = img.width / width;
        let coloured = 0, total = 0;
        const top = node.y1 + (node.y2 - node.y1) * 0.6;
        for (let y = top; y < node.y2 + 40; y += 3) {
            for (let x = node.x1; x < node.x2; x += 6) {
                const [r, g, b] = pixelAt(img, x * scale, Math.min(img.height - 1, y * scale));
                total++;
                if (Math.max(r, g, b) - Math.min(r, g, b) > 80) coloured++;
            }
        }
        const barOk = total > 0 && coloured / total > 0.02;
        console.log(`52 Week Low ${m ? m[1] : '?'} / 52 Week High ${m ? m[2] : '?'} displayed: ${valuesOk ? 'PASS' : 'FAIL'}`);
        console.log(`52 week range indicator bar drawn: ${barOk ? 'PASS' : 'FAIL'}`);
        return valuesOk && barOk;
    }

    // For a Quote just opened from a Markets list: reads its exchange off the header, expands it and
    // checks the 52 week indicator (shown for NSE/BSE, absent for everything else).
    async expandAndVerify52WeekIndicator() {
        const header = await this.getQuoteHeader();
        if (!header) {
            console.log('Quote header (symbol, exchange) not found - cannot check the 52 week indicator: FAIL');
            return false;
        }
        if (!(await this.swipeUpQuoteScreen())) return false;
        return this.verify52WeekIndicator(header.exchange);
    }

    // Opens Advanced Options ("..." beside SELL) and, for an equity symbol, checks "Compare with
    // Peer" is listed. Returns true when it is there to tap.
    async openAdvancedOptionsForPeer(exchange) {
        await this.openAdvancedOptions();
        const listed = await this.isElementVisible(this.compareWithPeerOption, 4000);
        if (!this.isEquity(exchange)) {
            console.log(`Compare with Peer ${listed ? 'listed' : 'not listed'} - not an equity symbol (${exchange}), skipped`);
            return false;
        }
        console.log(`"Compare with Peer" listed under Advanced Options: ${listed ? 'PASS' : 'FAIL'}`);
        return listed;
    }

    async clickCompareWithPeer() {
        await this.click(this.compareWithPeerOption);
        console.log('Clicked "Compare with Peer"');
    }

    // The Event tag has no node of its own (it's drawn inside the merged header node), so it's
    // tapped by position: the tag is the last line of the header card, at its left edge (verified
    // live on 1080x2340 - card [42,745][1038,1018], tag centred at ~(90, 994)).
    async tapEventTag() {
        const el = await this.driver.$(this.stockSummary);
        const { x, y } = await el.getLocation();
        const { height } = await el.getSize();
        await this.driver.action('pointer')
            .move({ duration: 0, x: Math.round(x + 48), y: Math.round(y + height - 24) })
            .down().up().perform();
        console.log('Tapped the "Event" tag on the Quote screen');
    }
}

module.exports = QuotesPage;
