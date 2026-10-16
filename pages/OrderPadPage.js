const BasePage = require('./BasePage');

class OrderPadPage extends BasePage {
    constructor(driver) {
        super(driver);
        this.backButton = 'android=new UiSelector().description("Back, Double tap to go back")';
        this.orderTypeLabel = 'android=new UiSelector().description("Order Type:")';
        this.buyIndicator = 'android=new UiSelector().description("BUY")';
        this.sellIndicator = 'android=new UiSelector().description("SELL")';
    }

    async isDisplayed(timeout = 5000) {
        return await this.isElementVisible(this.orderTypeLabel, timeout);
    }

    // The symbol shows as a bare ticker (e.g. "PERSISTENT") in the header, alongside the Back
    // button and NSE/BSE exchange toggles - filtered out here by their own descriptive text.
    async getDisplayedSymbol() {
        const nodes = await this.getDescribedElements();
        const headerNode = nodes.find(n => n.y1 < 350 && !/back|exchange|double tap/i.test(n.desc));
        return headerNode ? headerNode.desc.trim() : null;
    }

    // The bottom CTA is the transaction-type indicator itself: it reads "BUY" or "SELL" depending
    // on which action opened this Order Pad - no separate label element to read instead.
    async getTransactionType() {
        if (await this.isElementVisible(this.buyIndicator, 1500)) return 'Buy';
        if (await this.isElementVisible(this.sellIndicator, 1500)) return 'Sell';
        return null;
    }

    // Checks the Order Pad opened from a Quote's SELL/BUY shows that same action on its bottom
    // button (`expected` is 'Buy' or 'Sell'). Only reads the screen - never taps the button.
    async verifyOpenedFor(expected, timeout = 8000) {
        const displayed = await this.isDisplayed(timeout);
        const type = displayed ? await this.getTransactionType() : null;
        const ok = displayed && type === expected;
        console.log(`${expected} Order Pad displayed (${displayed ? `${type ? type.toUpperCase() : 'no BUY/SELL'} button shown` : 'Order Pad not shown'}): ${ok ? 'PASS' : 'FAIL'}`);
        return ok;
    }

    async getApproxMargin() {
        return (await this.readMargins()).approxText;
    }

    async getAvailMargin() {
        return (await this.readMargins()).availText;
    }

    // The margin row renders only after the app fetches margins, well after "Order Type:" (what
    // isDisplayed() waits on) is already up - so re-read the screen until both labels and their
    // values are present instead of reading a single snapshot taken too early.
    // Labels render as "Approx margin"/"Avail" (no colon - older builds had one) with the value
    // stacked below them; "Avail" is right-aligned, so its value starts left of the label's x1 and
    // findValueBelow's x1 tolerance misses it - match on horizontal overlap instead.
    async readMargins(timeout = 5000) {
        const value = (nodes, label) => {
            const node = nodes.find(n => n.desc.trim().replace(/:$/, '') === label);
            if (!node) return null;
            const below = nodes
                .filter(n => n !== node && n.y1 >= node.y2 && n.x1 < node.x2 && n.x2 > node.x1)
                .sort((a, b) => a.y1 - b.y1);
            return below.length ? below[0].desc.trim() : null;
        };
        let nodes = [];
        try {
            await this.driver.waitUntil(async () => {
                nodes = await this.getDescribedElements();
                return value(nodes, 'Approx margin') !== null && value(nodes, 'Avail') !== null;
            }, { timeout, interval: 500 });
        } catch (_) { /* timed out - report whatever is on screen */ }
        const result = { approxText: value(nodes, 'Approx margin'), availText: value(nodes, 'Avail') };
        if (result.approxText === null || result.availText === null) await this.dumpMarginRow(nodes);
        return result;
    }

    // Diagnostic for a margin that couldn't be read: logs every described node in the bottom
    // third of the screen (where the margin row lives) and saves the full page source.
    async dumpMarginRow(nodes) {
        const fs = require('fs');
        const path = require('path');
        const maxY = Math.max(0, ...nodes.map(n => n.y2));
        console.log('Margin row diagnostic - described nodes near the bottom of the Order Pad:');
        nodes.filter(n => n.y1 > maxY * 0.6).sort((a, b) => a.y1 - b.y1 || a.x1 - b.x1)
            .forEach(n => console.log(`  "${n.desc}" [${n.x1},${n.y1}][${n.x2},${n.y2}]`));
        const file = path.join(__dirname, '..', 'ui_dumps', 'orderpad_margins_missing.xml');
        fs.writeFileSync(file, await this.driver.getPageSource());
        console.log(`Saved page source to ${file}`);
    }

    // Confirms both the required margin for this order and the account's available margin are
    // positive - reads whatever is actually displayed rather than assuming a value.
    async validateMargins(label = 'Order Pad') {
        const { approxText, availText } = await this.readMargins();
        const approx = this.parseCurrency(approxText);
        const avail = this.parseCurrency(availText);
        const approxOk = !isNaN(approx) && approx > 0;
        const availOk = !isNaN(avail) && avail > 0;
        console.log(`${label}: Approx margin="${approxText}" (${approxOk ? 'PASS' : 'FAIL'}: > 0), Avail margin="${availText}" (${availOk ? 'PASS' : 'FAIL'}: > 0)`);
        return { approxText, availText, approxOk, availOk };
    }

    async goBackToQuotes() {
        await this.click(this.backButton);
        console.log('Navigated back to Quotes screen');
    }
}

module.exports = OrderPadPage;
