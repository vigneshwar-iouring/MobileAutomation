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

    async getApproxMargin() {
        const nodes = await this.getDescribedElements();
        const labelNode = nodes.find(n => n.desc.trim() === 'Approx margin:');
        return labelNode ? this.findInlineValue(nodes, labelNode) : null;
    }

    async getAvailMargin() {
        const nodes = await this.getDescribedElements();
        const labelNode = nodes.find(n => n.desc.trim() === 'Avail:');
        return labelNode ? this.findInlineValue(nodes, labelNode) : null;
    }

    // Confirms both the required margin for this order and the account's available margin are
    // positive - reads whatever is actually displayed rather than assuming a value.
    async validateMargins(label = 'Order Pad') {
        const approxText = await this.getApproxMargin();
        const availText = await this.getAvailMargin();
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
