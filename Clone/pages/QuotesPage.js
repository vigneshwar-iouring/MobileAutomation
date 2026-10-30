const BasePage = require('./BasePage');

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

    async clickSwipeUpIfAvailable() {
        const available = await this.isElementVisible(this.swipeUpForDetails, 2000);
        if (available) {
            await this.click(this.swipeUpForDetails);
            console.log('Clicked Swipe Up to expand quote details');
        } else {
            console.log('Swipe Up option not available - skipping');
        }
        return available;
    }

    async scrollToBottom() {
        await this.scrollToBoundary(this.anyDescribedElement, 'down');
        console.log('Scrolled to bottom of Quotes screen');
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
}

module.exports = QuotesPage;
