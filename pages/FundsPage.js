const BasePage = require('./BasePage');

class FundsPage extends BasePage {
    constructor(driver) {
        super(driver);
        this.fundsMenuItem = 'android=new UiSelector().descriptionContains("Funds")';
        this.backButton = 'android=new UiSelector().description("Back, Double tap to go back")';

        this.marginAvailableLabel = 'android=new UiSelector().descriptionContains("Margin available to trade")';
        this.availableFundLabel = 'android=new UiSelector().descriptionContains("Available Fund")';
        this.marginUtilisedLabel = 'android=new UiSelector().descriptionContains("Margin utilised")';

        this.viewTransactionsButton = 'android=new UiSelector().descriptionContains("View Transactions")';
        this.withdrawFundsButton = 'android=new UiSelector().descriptionContains("Withdraw Funds")';
        this.addFundsButton = 'android=new UiSelector().descriptionContains("Add Funds")';

        this.withdrawSummary = 'android=new UiSelector().descriptionContains("Withdrawable amount")';

        this.amountField = 'android=new UiSelector().descriptionContains("Enter Amount Text Field")';
        this.neftOption = 'android=new UiSelector().descriptionContains("NEFT / RTGS / IMPS")';
    }

    async openFunds() {
        await this.click(this.fundsMenuItem);
        console.log('Opened Funds/Margin screen');
    }

    // Extracts the numeric value from each summary field's own content-desc (e.g. "Margin
    // available to trade: ₹0.00, Displays margin available to trade.") - no separate value
    // element to read, the label and value are one merged accessibility node.
    async readMarginSummary() {
        const parseValue = desc => {
            const m = desc.match(/:\s*₹?([\d,]+\.\d+)/);
            return m ? m[1] : null;
        };
        const nodes = await this.getDescribedElements();
        const fieldStarts = {
            'Margin available to trade': 'Margin available to trade',
            'Available Fund': 'Available Fund',
            'Margin Utilised': 'Margin utilised',
            'Cash Equivalent': 'Cash Equivalent',
            'Collateral': 'Collateral',
            'Option Credit for Sale': 'Option Credit for Sale',
        };

        const result = {};
        for (const [field, startsWith] of Object.entries(fieldStarts)) {
            const node = nodes.find(n => n.desc.startsWith(startsWith));
            result[field] = node ? parseValue(node.desc) : null;
        }

        console.log('--- Margin Summary ---');
        for (const [field, value] of Object.entries(result)) {
            console.log(`  ${field}: ${value}`);
        }
        return result;
    }

    // The info ("i") icon next to "Margin Utilised" has no accessible element of its own - it's
    // merged into the same node as the label/value text, positioned near the node's top-right
    // rather than its center. Coordinates are computed as a fraction of the element's own bounds
    // (via getLocation/getSize) rather than hardcoded screen pixels, so this holds up across
    // different screen sizes.
    async tapMarginUtilisedTooltip() {
        const el = await this.driver.$(this.marginUtilisedLabel);
        await el.waitForDisplayed({ timeout: 5000 });
        const loc = await el.getLocation();
        const size = await el.getSize();
        const x = Math.round(loc.x + size.width * 0.94);
        const y = Math.round(loc.y + size.height * 0.22);
        await this.driver.action('pointer').move({ duration: 0, x, y }).down().up().perform();
        console.log('Tapped Margin Utilised tooltip icon');
    }

    async isTooltipInfoAvailable(timeout = 2000) {
        try {
            await this.driver.waitUntil(async () => {
                const src = await this.driver.getPageSource();
                return /margin utilised includes/i.test(src);
            }, { timeout, interval: 300 });
            return true;
        } catch (_) {
            return false;
        }
    }

    // The tooltip is a modal overlay - left open, it silently absorbs the next tap (e.g. on "View
    // Transactions") instead of that tap reaching the screen underneath, so callers must dismiss
    // it before navigating anywhere else. Tapping the screen title area is always safe: it sits
    // above the card and isn't itself interactive.
    async dismissTooltip() {
        await this.driver.action('pointer').move({ duration: 0, x: 100, y: 300 }).down().up().perform();
        await this.driver.pause(400);
        console.log('Dismissed tooltip');
    }

    async clickViewTransactions() {
        await this.click(this.viewTransactionsButton);
        console.log('Clicked View Transactions');
    }

    async clickWithdrawFunds() {
        await this.click(this.withdrawFundsButton);
        console.log('Clicked Withdraw Funds');
    }

    // "Withdrawable amount: 0.00. Balance: 0.00." - both figures in one merged node.
    async readWithdrawSummary() {
        const el = await this.driver.$(this.withdrawSummary);
        await el.waitForDisplayed({ timeout: 5000 });
        const desc = await el.getAttribute('content-desc');
        const m = desc.match(/Withdrawable amount:\s*([\d,.]+)\.\s*Balance:\s*([\d,.]+)\./i);
        const result = {
            'Withdrawable amount': m ? m[1] : null,
            Balance: m ? m[2] : null,
        };
        console.log('--- Withdraw Summary ---');
        for (const [field, value] of Object.entries(result)) {
            console.log(`  ${field}: ${value}`);
        }
        return result;
    }

    async clickAddFunds() {
        await this.click(this.addFundsButton);
        console.log('Clicked Add Funds');
    }

    // amountLabel matches the button's own text, e.g. "10,000", "25,000", "50,000", "1 Lakh".
    async tapQuickAmount(amountLabel) {
        const el = await this.driver.$(`android=new UiSelector().descriptionContains("₹${amountLabel}")`);
        await el.click();
        console.log(`Tapped quick amount option: ₹${amountLabel}`);
    }

    async getEnteredAmount() {
        const el = await this.driver.$(this.amountField);
        await el.waitForDisplayed({ timeout: 5000 });
        const desc = await el.getAttribute('content-desc');
        // Requiring digits after the decimal point (rather than a greedy [\d,.]+) stops the match
        // at "10000.00" instead of swallowing the sentence-ending period too ("10000.00.").
        const m = desc.match(/Entered Amount:\s*([\d,]+(?:\.\d+)?)/i);
        return m ? m[1] : null;
    }

    async clickNeftOption() {
        await this.click(this.neftOption);
        console.log('Opened NEFT / RTGS / IMPS Transfer details');
    }

    // Beneficiary/Bank Ac/No/Bank Name/IFSC Code sit as label-then-value pairs side by side in
    // the same row (findInlineValue, inherited from BasePage), not stacked label-row/value-row
    // like the research-call dialog - simpler layout, same reusable lookup.
    async readNeftDetails() {
        const nodes = await this.getDescribedElements();
        const labels = ['Beneficiary', 'Bank Ac/No', 'Bank Name', 'IFSC Code'];
        const result = {};
        for (const label of labels) {
            const labelNode = nodes.find(n => n.desc.trim() === label);
            if (!labelNode) continue;
            result[label] = this.findInlineValue(nodes, labelNode);
        }
        console.log('--- NEFT / RTGS / IMPS Transfer Details ---');
        for (const [field, value] of Object.entries(result)) {
            console.log(`  ${field}: ${value}`);
        }
        return result;
    }

    // None of Transaction History, Withdraw Funds, or the NEFT dialog expose a described "Back"
    // element - the device back gesture is the only reliable way off them.
    async goBackHardware() {
        await this.driver.back();
        console.log('Navigated back');
    }

    async goBack() {
        await this.click(this.backButton);
        console.log('Navigated back');
    }
}

module.exports = FundsPage;
