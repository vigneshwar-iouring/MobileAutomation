const BasePage = require('./BasePage');

class ResearchCalls extends BasePage {
    constructor(driver) {
        super(driver);
        this.hamburgerMenu = 'android=new UiSelector().description("Hamburger menu, Double tap to open the hamburger menu")';
        this.ResearchOption = 'android=new UiSelector().descriptionContains("Research based ideas from Globe")';
        this.equityTab = 'android=new UiSelector().descriptionContains("Equity")';
        this.derivativeTab = 'android=new UiSelector().descriptionContains("Derivative")';
        this.commodityTab = 'android=new UiSelector().descriptionContains("Commodity")';
        this.fundamentalTab = 'android=new UiSelector().description("Fundamental")';
        this.technicalTab = 'android=new UiSelector().description("Technical")';
        this.strategiesTab = 'android=new UiSelector().description("Strategies")';
        this.symbolEntry = 'android=new UiSelector().descriptionStartsWith("Entry")';
        this.closeButton = 'android=new UiSelector().description("Close")';
    }

    async clickClose() {
        await this.click(this.closeButton);
        console.log('Clicked Close (X)');
    }

    async clickEquityTab() {
        await this.click(this.equityTab);
        console.log('Clicked Equity tab');
    }

    async clickDerivativeTab() {
        await this.click(this.derivativeTab);
        console.log('Clicked Derivative tab');
    }

    async clickCommodityTab() {
        await this.click(this.commodityTab);
        console.log('Clicked Commodity tab');
    }

    async clickHamburgerMenu(timeout = 8000) {
        await this.click(this.hamburgerMenu, timeout);
        console.log('Clicked hamburger menu');
    }
    async clickResearchOption(timeout = 8000) {
        await this.click(this.ResearchOption, timeout);
        console.log('Clicked Research option');
    }

    async clickFundamentalTab() {
        await this.click(this.fundamentalTab);
        console.log('Clicked Fundamental tab');
    }

    async clickTechnicalTab() {
        await this.click(this.technicalTab);
        console.log('Clicked Technical tab');
    }

    async clickStrategiesTab() {
        await this.click(this.strategiesTab);
        console.log('Clicked Strategies tab');
    }

    async isNoDataFound() {
        try {
            const source = await this.driver.getPageSource();
            return /no data found/i.test(source);
        } catch (_) {
            return false;
        }
    }

    async getNoDataMessage() {
        const selectors = [
            'android=new UiSelector().textContains("No Data Found")',
            'android=new UiSelector().descriptionContains("No Data Found")'
        ];
        for (const selector of selectors) {
            try {
                const el = await this.driver.$(selector);
                if (await el.isDisplayed()) {
                    const text = (await el.getText().catch(() => '')) || (await el.getAttribute('content-desc').catch(() => ''));
                    if (text) return text;
                }
            } catch (_) {}
        }
        return 'No Data Found';
    }

    async waitForContent(timeout = 8000) {
        await this.driver.waitUntil(async () => {
            if (await this.isNoDataFound()) return true;
            const cards = await this.driver.$$(this.symbolEntry);
            return cards.length > 0;
        }, { timeout, interval: 300, timeoutMsg: 'Tab content did not load in time' }).catch(() => {});

        // Data can arrive in more than one batch after the first card appears - wait for the
        // visible count to stop growing before counting starts, or an in-progress load undercounts.
        if (!(await this.isNoDataFound())) {
            let previousCount = -1;
            for (let i = 0; i < 8; i++) {
                const cards = await this.driver.$$(this.symbolEntry);
                if (cards.length === previousCount) break;
                previousCount = cards.length;
                await this.driver.pause(400);
            }
        }
    }

    async scrollUpUnlessNoData() {
        if (await this.isNoDataFound()) {
            const message = await this.getNoDataMessage();
            console.log(`No Data message observed: "${message}"`);
            return;
        }
        await this.scrollUp(this.symbolEntry);
    }

    async countSymbols(maxScrolls = 20) {
        if (await this.isNoDataFound()) {
            console.log('No Data Found - returning 0 symbols');
            return 0;
        }
        // Same boundary-aware helper used by scrollUp - accumulates distinct symbols as it goes
        // (via `seen`) and stops on the first swipe that reveals nothing new, so no scroll is
        // performed once the last symbol is already on screen.
        const seen = new Set();
        await this.scrollToBoundary(this.symbolEntry, 'down', { maxScrolls, seen });
        return seen.size;
    }

    // Entry cards read like "Entry\n<date>\nPositional\n<SYMBOL>\nTarget : \n...". The symbol is
    // whichever line follows the call-type marker, so this doesn't depend on a fixed line index
    // that would break if an earlier field were added/removed for a different call type.
    extractSymbolFromEntryDesc(desc) {
        const lines = desc.split('\n').map(l => l.trim()).filter(Boolean);
        const callTypeMarkers = ['Positional', 'Intraday', 'Delivery', 'Swing'];
        const idx = lines.findIndex(l => callTypeMarkers.includes(l));
        return idx >= 0 && lines[idx + 1] ? lines[idx + 1] : (lines[3] || null);
    }

    async getFirstSymbolCard() {
        const cards = await this.driver.$$(this.symbolEntry);
        if (!cards.length) return null;
        const desc = await cards[0].getAttribute('content-desc').catch(() => '');
        return { element: cards[0], symbol: this.extractSymbolFromEntryDesc(desc), rawDesc: desc };
    }
}

module.exports = ResearchCalls;