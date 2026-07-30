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

    async clickHamburgerMenu() {
        await this.click(this.hamburgerMenu);
        console.log('Clicked hamburger menu');
    }
    async clickResearchOption() {
        await this.click(this.ResearchOption);
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

    async countSymbols(maxScrolls = 20) {
        if (await this.isNoDataFound()) {
            console.log('No Data Found - returning 0 symbols');
            return 0;
        }
        const seen = new Set();
        let previousSize = 0;
        for (let i = 0; i < maxScrolls; i++) {
            const cards = await this.driver.$$(this.symbolEntry);
            for (const card of cards) {
                const desc = await card.getAttribute('content-desc').catch(() => '');
                if (desc) seen.add(desc);
            }
            if (seen.size === previousSize) break;
            previousSize = seen.size;
            await this.scrollDown();
            await this.driver.pause(500);
        }
        return seen.size;
    }
}

module.exports = ResearchCalls;