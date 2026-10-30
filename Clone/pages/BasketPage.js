const BasePage = require('./BasePage');

class BasketPage extends BasePage {
    constructor(driver) {
        super(driver);
        this.basketTab = 'android=new UiSelector().descriptionContains("Basket").descriptionContains("Tab")';
        // "Basket Orders" in the hamburger drawer navigates to the same Basket tab as
        // Orders -> Basket - just a different entry point into the identical screen.
        this.basketOrdersMenuItem = 'android=new UiSelector().descriptionContains("Basket Orders")';
        this.emptyBasketMessage = 'android=new UiSelector().description("Basket order is Empty")';
        this.newBasketButton = '~New Basket';

        this.basketNameField = 'android=new UiSelector().className("android.widget.EditText")';
        this.createBasketButton = 'android=new UiSelector().description("Create Basket")';
        this.createBasketErrorMessage = 'android=new UiSelector().description("Please enter a basket name")';

        this.closeBasketButton = 'android=new UiSelector().description("Close, Double tap to close")';
        this.addSymbolsButton = 'android=new UiSelector().description("Add symbols to your basket")';
        this.emptyBasketCenterMessage = 'android=new UiSelector().description("Empty Basket")';
        this.executeButton = 'android=new UiSelector().description("EXECUTE")';

        // The global search field is a plain Button (not an EditText) with a hint, already
        // focused when the search screen opens - typed into via key events, same as other
        // View-based "fields" elsewhere in this app (e.g. ForgotPasswordPage's login ID fallback).
        this.searchField = 'android=new UiSelector().className("android.widget.Button").instance(0)';

        this.addBuyButton = 'android=new UiSelector().description("ADD BUY")';
        this.addSellButton = 'android=new UiSelector().description("ADD SELL")';
        this.orderPadBuyButton = 'android=new UiSelector().description("BUY")';
    }

    async clickBasketOrdersMenuItem() {
        await this.click(this.basketOrdersMenuItem);
        console.log('Clicked Basket Orders - navigated to Basket screen');
    }

    async isBasketEmpty(timeout = 3000) {
        return await this.isElementVisible(this.emptyBasketMessage, timeout);
    }

    async getEmptyBasketMessage() {
        const el = await this.driver.$(this.emptyBasketMessage);
        await el.waitForDisplayed({ timeout: 3000 });
        return await el.getAttribute('content-desc');
    }

    // NOTE: this specific floating action button has been observed to reject every form of
    // synthetic tap (raw pointer, adb input, double-tap, Appium's mobile:clickGesture, and this
    // standard element click) while responding normally to a real finger tap - most likely
    // deliberate anti-automation protection on basket creation. This is still the correct call to
    // make; verifyNewBasketDialogOpened() below detects whether it actually landed so the caller
    // can react (e.g. surface a clear message) instead of failing confusingly on a later step.
    async clickNewBasket() {
        await this.click(this.newBasketButton);
        console.log('Clicked New Basket');
    }

    async verifyNewBasketDialogOpened(timeout = 3000) {
        return await this.isElementVisible(this.basketNameField, timeout);
    }

    async clickCreateBasket() {
        await this.click(this.createBasketButton);
        console.log('Clicked Create Basket');
    }

    async getCreateBasketError(timeout = 2000) {
        try {
            const el = await this.driver.$(this.createBasketErrorMessage);
            await el.waitForDisplayed({ timeout });
            return await el.getAttribute('content-desc');
        } catch (_) {
            return null;
        }
    }

    async enterBasketName(name) {
        await this.enterText(this.basketNameField, name);
        console.log(`Entered basket name: ${name}`);
    }

    async waitForBasketCreatedToast(timeout = 2000) {
        return await this.waitForToast('Basket created successfully', { timeout });
    }

    // "Created on <date>" and "<n>/<max> items" are read dynamically (pattern-matched, not a
    // fixed field list) since the item count changes as symbols are added.
    async readBasketHeader() {
        const nodes = await this.getDescribedElements();
        const createdOn = nodes.find(n => n.desc.startsWith('Created on'));
        const itemCount = nodes.find(n => /^\d+\/\d+ items$/.test(n.desc));
        const result = {
            createdOn: createdOn ? createdOn.desc : null,
            itemCount: itemCount ? itemCount.desc : null,
        };
        console.log(`Basket header: ${result.createdOn}, ${result.itemCount}`);
        return result;
    }

    // Confirms the "Empty Basket" message is both visible and horizontally centered on screen,
    // rather than assuming a fixed position.
    async isEmptyBasketCentered(timeout = 3000) {
        const visible = await this.isElementVisible(this.emptyBasketCenterMessage, timeout);
        if (!visible) return { visible: false, centered: false };
        const el = await this.driver.$(this.emptyBasketCenterMessage);
        const loc = await el.getLocation();
        const size = await el.getSize();
        const windowSize = await this.driver.getWindowSize();
        const elementCenterX = loc.x + size.width / 2;
        const screenCenterX = windowSize.width / 2;
        const centered = Math.abs(elementCenterX - screenCenterX) < 50;
        return { visible: true, centered };
    }

    async isExecuteEnabled() {
        const el = await this.driver.$(this.executeButton);
        return await el.isEnabled();
    }

    async clickAddSymbols() {
        await this.click(this.addSymbolsButton);
        console.log('Clicked "Add symbols to your basket" - navigated to global search');
    }

    async searchSymbol(query) {
        const field = await this.driver.$(this.searchField);
        await field.click();
        await this.driver.pause(300);
        for (const ch of query) {
            await this.driver.keys(ch);
            await this.driver.pause(60);
        }
        console.log(`Searched for: ${query}`);
    }

    // Clicks the first search result whose description starts with `symbol` (e.g. "TATASTEEL,
    // Double tap to open Quote Screen.") - exact full-string match would break the moment the
    // instrument's live price/change values get appended to nearby rows.
    async clickFirstSearchResult(symbol) {
        const nodes = await this.getDescribedElements();
        const match = nodes.find(n => n.desc.startsWith(symbol) && n.desc.includes('Double tap to open Quote Screen'));
        if (!match) throw new Error(`No search result found starting with "${symbol}"`);
        const el = await this.driver.$(`android=new UiSelector().description("${match.desc}")`);
        await el.click();
        console.log(`Clicked first search result: ${match.desc}`);
    }

    async clickAddBuy() {
        await this.click(this.addBuyButton);
        console.log('Clicked ADD BUY');
    }

    async clickAddSell() {
        await this.click(this.addSellButton);
        console.log('Clicked ADD SELL');
    }

    // Confirms the qty/price mini order-pad shown after ADD BUY/ADD SELL - the same "confirm to
    // add" pattern used when adding a research-call symbol to a basket (QuotesPage.addToBasket).
    async confirmOrderPad() {
        await this.click(this.orderPadBuyButton);
        console.log('Confirmed order - symbol added to basket');
    }

    async waitForAddedToBasketToast(timeout = 2000) {
        return await this.waitForToast('Added To Basket', { timeout });
    }

    async closeBasket() {
        await this.click(this.closeBasketButton);
        console.log('Closed basket');
    }
}

module.exports = BasketPage;
