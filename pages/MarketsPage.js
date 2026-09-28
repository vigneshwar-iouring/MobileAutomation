const BasePage = require('./BasePage');

class MarketsPage extends BasePage {
    constructor(driver) {
        super(driver);
        // Same bottom-nav icon shape as WatchlistIndexPage's own nav buttons (a plain ImageView
        // whose content-desc is just the tab name, no "Tab N of M" suffix).
        this.marketNavButton = 'android=new UiSelector().className("android.widget.ImageView").description("Market")';

        // Equity is the default, left-most segment tab the instant the Markets screen renders -
        // the same "pick a marker exclusive to this screen having loaded" approach NewsPage uses
        // for its own tab strip.
        this.equityTabLoaded = 'android=new UiSelector().descriptionContains("Equity")';

        // Compose merges this control's label and its own "Double tap to..." hint into one
        // content-desc, so the selector has to match that full string rather than just "See All".
        this.seeAllMarketLive = 'android=new UiSelector().description("See all Market Live., Double tap to view all Market Live.")';

        // Quick-access icon row near the top of the Equity screen. "AI Algo"/"NxtOption"/"IPO" fit
        // on screen first; "Mutual Funds"/"Basket" only scroll into view after swiping the row left
        // (verified live).
        this.aiAlgoTile = 'android=new UiSelector().description("AI Algo")';
        this.nxtOptionTile = 'android=new UiSelector().description("NxtOption")';
        this.ipoTile = 'android=new UiSelector().description("IPO")';
        // The bottom floating nav's own icon shares the exact content-desc "Mutual Funds" with this
        // tile - instance(0) is confirmed to land on the tile, not the nav icon.
        this.mutualFundsTile = 'android=new UiSelector().description("Mutual Funds").instance(0)';
        this.basketTile = 'android=new UiSelector().description("Basket")';

        // The Basket screen (however it's reached) always shows this EXECUTE button - the same
        // selector BasketPage itself uses - regardless of whether the basket is empty or has items.
        this.basketExecuteButton = 'android=new UiSelector().description("EXECUTE")';
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

    // "Market Live" sits further down the Equity page, below the indices/movers cards - swipe up
    // until its heading enters the accessibility tree rather than assume a fixed scroll count.
    async scrollToMarketLive(maxScrolls = 8) {
        for (let i = 0; i < maxScrolls; i++) {
            if (/Market Live/i.test(await this.driver.getPageSource())) {
                console.log('"Market Live" section is now visible');
                return true;
            }
            await this.swipe('up');
            await this.pause(500);
        }
        const found = /Market Live/i.test(await this.driver.getPageSource());
        console.log(found ? '"Market Live" section is now visible' : `Could not find "Market Live" section after ${maxScrolls} scrolls`);
        return found;
    }

    // The Equity page carries more than one "See All" button (Market Movers has its own too), but
    // Market Live's copy has its own distinct, full content-desc (label + Compose's merged "Double
    // tap to..." hint), so it can be targeted directly instead of disambiguating by position.
    async clickSeeAllNearMarketLive(timeout = 8000) {
        await this.click(this.seeAllMarketLive, timeout);
        console.log('Clicked "See All" near Market Live');
    }

    // Swipes the quick-access tile row left so tiles past IPO (Mutual Funds, Basket) scroll into
    // view - a single swipe was observed live to be enough to reveal both.
    async scrollTilesRight(times = 1) {
        for (let i = 0; i < times; i++) {
            await this.swipe('left');
            await this.pause(400);
        }
        console.log('Scrolled quick-access tile row to reveal further tiles');
    }

    async clickAiAlgoTile(timeout = 12000) {
        await this.click(this.aiAlgoTile, timeout);
        console.log('Clicked "AI Algo" tile');
    }

    async clickNxtOptionTile(timeout = 8000) {
        await this.click(this.nxtOptionTile, timeout);
        console.log('Clicked "NxtOption" tile');
    }

    async clickIpoTile(timeout = 8000) {
        await this.click(this.ipoTile, timeout);
        console.log('Clicked "IPO" tile');
    }

    async clickBasketTile(timeout = 8000) {
        await this.click(this.basketTile, timeout);
        console.log('Clicked "Basket" tile');
    }

    async clickMutualFundsTile(timeout = 8000) {
        await this.click(this.mutualFundsTile, timeout);
        console.log('Clicked "Mutual Funds" tile');
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
        const loaded = await this.isElementVisible(this.basketExecuteButton, timeout);
        console.log(loaded ? 'Basket screen loaded' : `Basket screen did not load within ${timeout}ms`);
        return loaded;
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

module.exports = { MarketsPage };
