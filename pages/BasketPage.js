const BasePage = require('./BasePage');

class BasketPage extends BasePage {
    constructor(driver) {
        super(driver);
        this.basketTab = 'android=new UiSelector().descriptionContains("Basket").descriptionContains("Tab")';
        // "Basket Orders" in the hamburger drawer navigates to the same Basket tab as
        // Orders -> Basket - just a different entry point into the identical screen.
        this.basketOrdersMenuItem = 'android=new UiSelector().descriptionContains("Basket").descriptionContains("Orders")';
        this.noBasketText = 'No basket found. Group your trades with Basket order.';
        // Saved basket rows read "NAME\nCreated on 21st September 2026\n1 items >".
        this.basketRow = '//*[contains(@content-desc,"Created on") and contains(@content-desc,"items")]';
        // content-desc is "New Basket\nNew Basket" (verified live), so an exact '~New Basket' never matches.
        this.newBasketButton = 'android=new UiSelector().descriptionStartsWith("New Basket")';

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
        // Order-pad confirm buttons. The pad's confirm label follows the side picked on the Quote
        // screen - "ADD BUY"/"ADD SELL" (with plain "BUY"/"SELL" accepted as a fallback).
        this.orderPadBuyButton = '//*[@content-desc="ADD BUY" or @content-desc="BUY"]';
        this.orderPadSellButton = '//*[@content-desc="ADD SELL" or @content-desc="SELL"]';
        // Set by clickAddBuy()/clickAddSell() so confirmOrderPad() taps the matching side.
        this.lastAddSide = null;

        // Order pad controls - same layout as the regular Order Pad (ui_dumps/r20_orderpad_fields.xml):
        // exchange toggles "NSE \nExchange is NSE and the last traded price is ..." (same for BSE),
        // the price field's swap icon "Swap, Double tap to switch between Market and Limit" whose
        // label reads "Price (Limit)"/"Price (Market)", and the "Delivery"/"Intraday" product options.
        this.orderPadLoaded = 'android=new UiSelector().description("Order Type:")';
        this.marketLimitSwap = 'android=new UiSelector().descriptionStartsWith("Swap, Double tap to switch between Market and Limit")';
        // After the first symbol is added the basket screen may show a search bar instead of the
        // "Add symbols to your basket" button - either one opens global search.
        this.globalSearchBar = 'android=new UiSelector().descriptionContains("Search")';

        // Basket item row: "Side: X ,Name: Y, ... Double tap to View option". Tapping it opens a
        // bottom sheet with the item summary and two buttons, "CLONE" and "MODIFY" (verified live).
        this.basketItemRow = '//*[starts-with(@content-desc,"Side:") and contains(@content-desc,"Double tap to View option")]';
        this.cloneOption = '//*[@content-desc="CLONE" or @text="CLONE"]';
        this.modifyOption = '//*[@content-desc="MODIFY" or @text="MODIFY"]';
        // Basket detail -> "Edit" opens the "Edit Basket" screen (verified live). Its name field is a
        // Compose text box exposed as a Button whose text is the current name, so it is typed into
        // with real key events. Leaving it with the Back arrow after a change asks "Do you want to
        // save the changes?" with No/Yes. That screen also has per-item Remove buttons and DELETE
        // BASKET - never tapped here.
        this.editBasketButton = '//*[@content-desc="Edit"]';
        this.editBasketTitle = '//*[@content-desc="Edit Basket"]';
        this.editBasketBack = '//*[@content-desc="Back, Double tap to go back"]';
        this.saveChangesPrompt = '//*[@content-desc="Do you want to save the changes?"]';
        // Edit Basket rows: one Remove icon per item ("Remove TATASTEEL from basket, Double tap to
        // remove the stock from the basket."). Removing shows a message "TATASTEEL Removed \nUndo"
        // as one tappable element - Undo has no node of its own, it's the text at its right end.
        // "Done" saves the edits and returns to the basket detail screen.
        this.removeSymbolIcon = '//*[starts-with(@content-desc,"Remove ") and contains(@content-desc,"from basket")]';
        this.removedMessage = '//*[contains(@content-desc," Removed")]';
        this.editBasketDone = '//*[@content-desc="Done"]';
        // Edit Basket -> "DELETE BASKET" asks "Are you sure, you want to Delete the basket?" (under
        // the basket's name) with No/Yes. No stays on Edit Basket; Yes deletes the basket and shows
        // "Basket deleted successfully" (verified live).
        this.deleteBasketButton = '//*[@content-desc="DELETE BASKET"]';
        this.deleteBasketPrompt = '//*[@content-desc="Are you sure, you want to Delete the basket?"]';
        // Order pad's Buy/Sell swap icon, next to the ADD BUY/ADD SELL button.
        this.swapBuySellButton = 'android=new UiSelector().descriptionStartsWith("Swap Buy Sell")';
        // Basket detail screen's "Analyze" button - shown only for NFO, BFO and MCX baskets. It is a
        // clickable ImageView next to "Edit" (verified live, ui_dumps/basket_strategy_builder_bfo.xml).
        // Class + clickable are required: a basket NAMED "Analyze" puts a second, non-clickable
        // View with the same content-desc in the header, which a bare description("Analyze") hits.
        this.analyzeButton = 'android=new UiSelector().description("Analyze")';
    }

    // Taps "Basket Orders" in the hamburger drawer (content-desc "Basket Orders\nPlace Multiple
    // Orders in one go", verified live). Navigation is NOT assumed - call waitForBasketScreen().
    async clickBasketOrdersMenuItem(timeout = 5000) {
        const el = await this.driver.$(this.basketOrdersMenuItem);
        await el.waitForDisplayed({ timeout });
        // Let the drawer's slide-in animation settle so the tap lands where the item is now.
        await this.driver.pause(600);
        await el.click();
        console.log('Tapped Basket Orders menu item');
    }

    // The app keeps whatever screen the previous run ended on (e.g. a basket's detail screen), so
    // press Back until the home screen's hamburger menu is visible again.
    async goToHome(maxBackPresses = 5) {
        const hamburger = 'android=new UiSelector().descriptionStartsWith("Hamburger menu")';
        for (let i = 0; i <= maxBackPresses; i++) {
            if (await this.isElementVisible(hamburger, 1500)) return true;
            await this.driver.back();
            await this.driver.pause(800);
        }
        console.error('FAIL: could not get back to the home screen (hamburger menu not visible)');
        return false;
    }

    // Confirms the Basket screen actually loaded: its "Basket" tab or the "New Basket" button
    // (shown whether or not baskets exist) must appear.
    async waitForBasketScreen(timeout = 10000) {
        return await this.driver.waitUntil(async () =>
            (await this.isElementVisible(this.basketTab, 300)) || (await this.isElementVisible(this.newBasketButton, 300)),
            { timeout, interval: 500 }
        ).then(() => true).catch(() => false);
    }

    // Fallback route to the same screen: bottom-nav Orders -> Basket tab.
    async openBasketViaOrdersTab() {
        await this.click('android=new UiSelector().description("Orders")');
        await this.driver.pause(1000);
        await this.click(this.basketTab);
        console.log('Opened Basket via bottom-nav Orders -> Basket tab');
    }

    // True when the empty-Basket message is on screen with exactly the expected wording. Matched
    // over all content-desc/text in the page source (whitespace-normalised and joined) so it still
    // matches if Compose splits the two sentences across lines or separate nodes.
    async isNoBasketMessageShown() {
        try {
            const src = await this.driver.getPageSource();
            const joined = [...src.matchAll(/(?:content-desc|text)="([^"]*)"/g)]
                .map(m => m[1].replace(/&#10;|&#xA;|\n/gi, ' '))
                .join(' ')
                .replace(/\s+/g, ' ');
            return joined.includes(this.noBasketText);
        } catch {
            return false;
        }
    }

    async isBasketEmpty(timeout = 3000) {
        return await this.driver.waitUntil(() => this.isNoBasketMessageShown(), { timeout, interval: 500 })
            .then(() => true).catch(() => false);
    }

    // Waits for the Basket screen to settle into one of its two states and reports which:
    // { count: N, rows: [...] } when saved baskets exist, or { count: 0, emptyMessageShown }
    // when none have been created.
    async getBasketListState(timeout = 5000) {
        let state = null;
        await this.driver.waitUntil(async () => {
            const rows = await this.driver.$$(this.basketRow);
            if (rows.length) {
                const texts = [];
                for (const r of rows) texts.push(await r.getAttribute('content-desc'));
                state = { count: rows.length, rows: texts, emptyMessageShown: false };
            } else if (await this.isNoBasketMessageShown()) {
                state = { count: 0, rows: [], emptyMessageShown: true };
            }
            return !!state;
        }, { timeout, interval: 500 }).catch(() => { });
        return state || { count: 0, rows: [], emptyMessageShown: false };
    }

    // Every saved basket row on the Basket list, top to bottom, scrolling through the whole list
    // (20 baskets don't fit on one screen) and back to the top. Rows can be identical (several
    // "Analyze Basket" rows created the same day with the same item count), so they can't be
    // de-duplicated by text: each screen's rows are appended after the longest overlap between the
    // end of what's been collected and the start of the new screen. Returns the row descs.
    async getAllBasketRows(maxScrolls = 10) {
        const visibleRows = async () => (await this.getDescribedElements())
            .filter(n => /\nCreated on .*\n\d+ items/.test(n.desc))
            .sort((a, b) => a.y1 - b.y1)
            .map(n => n.desc);
        const all = await visibleRows();
        let previous = all.join('|');
        let scrolls = 0;
        for (let i = 0; i < maxScrolls; i++) {
            await this.swipe('down');
            scrolls++;
            await this.driver.pause(500);
            const screen = await visibleRows();
            if (screen.join('|') === previous) break;
            previous = screen.join('|');
            let overlap = 0;
            for (let k = Math.min(all.length, screen.length); k > 0; k--) {
                if (all.slice(all.length - k).join('|') === screen.slice(0, k).join('|')) { overlap = k; break; }
            }
            all.push(...screen.slice(overlap));
        }
        for (let i = 0; i < scrolls; i++) await this.swipe('up');
        return all;
    }

    // Every content-desc/text string that appears on screen within `timeout` ms and wasn't in
    // `before` (a Set from getScreenStrings()) - used to catch a toast whose wording isn't known
    // in advance. Polls so a short-lived toast isn't missed.
    // Strings that differ from a `before` string only in their numbers are ignored: the index
    // ticker (NIFTY/SENSEX LTP, change, %) rewrites itself every second and would otherwise look
    // like a new message (observed live - it made a missing toast look like a shown one).
    // `stopWhen` (optional, async) ends the wait early, e.g. once a dialog has opened.
    async captureNewMessages(before, timeout = 4000, stopWhen = null) {
        const shape = s => s.replace(/[-+]?[\d][\d,]*(\.\d+)?/g, '#');
        const beforeShapes = new Set([...before].map(shape));
        const found = new Set();
        const end = Date.now() + timeout;
        while (Date.now() < end) {
            for (const s of await this.getScreenStrings()) {
                if (!before.has(s) && !beforeShapes.has(shape(s))) found.add(s);
            }
            if (stopWhen && await stopWhen()) break;
            await this.driver.pause(200);
        }
        return [...found];
    }

    // From the Basket list: New Basket -> `name` -> Create Basket. On success the app opens the new
    // basket, which is closed again to return to the list. When the app refuses (e.g. the basket
    // limit is reached) the refusal may come on tapping New Basket or on Create; either way every
    // new on-screen message is captured and any open dialog is dismissed.
    // Returns { created, dialogOpened, messages }.
    // The "You have created maximum baskets" toast (shown on tapping New Basket with 20 baskets)
    // is drawn in a separate window: it is NOT in the default page source nor findable as
    // //android.widget.Toast, only with UiAutomator2's enableMultiWindows setting on (verified
    // live, ~1.5s after the tap). So that setting is switched on while watching for messages after
    // the New Basket tap, and restored afterwards.
    async createBasketAndReturn(name) {
        await this.driver.updateSettings({ enableMultiWindows: true }).catch(() => { });
        const before = new Set(await this.getScreenStrings());
        await this.clickNewBasket();
        // Start watching straight after the tap - a refusal toast is short-lived, so waiting for the
        // dialog first (as before) let it disappear unseen. Stops as soon as the dialog opens.
        const nameField = await this.driver.$(this.basketNameField);
        let tapMessages;
        try {
            tapMessages = await this.captureNewMessages(before, 4000, () => nameField.isExisting().catch(() => false));
        } finally {
            await this.driver.updateSettings({ enableMultiWindows: false }).catch(() => { });
        }
        const dialogOpened = await nameField.isExisting().catch(() => false);
        if (!dialogOpened) {
            return { created: false, dialogOpened, messages: tapMessages };
        }
        await this.enterBasketName(name);
        const beforeCreate = new Set(await this.getScreenStrings());
        await this.clickCreateBasket();
        const messages = await this.captureNewMessages(beforeCreate, 3000);
        const created = messages.some(m => m.includes('Basket created successfully'))
            || await this.isElementVisible(this.editBasketButton, 1500);
        if (created) {
            if (await this.isElementVisible(this.closeBasketButton, 3000)) await this.closeBasket();
            await this.waitForBasketScreen(5000);
        } else if (await this.isElementVisible(this.basketNameField, 1000)) {
            // Dismiss the still-open New Basket dialog (the keyboard would swallow the first Back).
            if (await this.driver.isKeyboardShown().catch(() => false)) await this.driver.hideKeyboard().catch(() => { });
            await this.driver.back();
            await this.driver.pause(800);
        }
        return { created, dialogOpened, messages };
    }

    // On the basket detail screen: taps the global-search entry ("Add symbols to your basket") and
    // captures any message that appears, with enableMultiWindows on - the app's limit toasts are
    // drawn in a separate window and only show up in the page source that way (see
    // createBasketAndReturn). Then checks whether it stayed on the basket (Edit still visible) or
    // global search opened. Returns { messages, stayedOnBasket }.
    async tapGlobalSearchCapturingMessages() {
        await this.driver.updateSettings({ enableMultiWindows: true }).catch(() => { });
        let messages;
        try {
            const before = new Set(await this.getScreenStrings());
            if (await this.isElementVisible(this.addSymbolsButton, 3000)) await this.click(this.addSymbolsButton);
            else await this.click(this.globalSearchBar);
            console.log('Tapped global search (Add symbols to your basket)');
            messages = await this.captureNewMessages(before, 4000);
        } finally {
            await this.driver.updateSettings({ enableMultiWindows: false }).catch(() => { });
        }
        const stayedOnBasket = await this.isElementVisible(this.editBasketButton, 2000);
        return { messages, stayedOnBasket };
    }

    // On the Basket list: opens the first saved basket named `name` (row desc "NAME\nCreated on
    // ...\nN items >") - with exactly `itemCount` items when given - and waits for its detail
    // screen. Returns false if no such row is listed.
    async openSavedBasket(name, itemCount = null, timeout = 5000, { quiet = false } = {}) {
        const { rows } = await this.getBasketListState(timeout);
        const match = rows.find(r => {
            const lines = r.split('\n').map(s => s.trim());
            if (lines[0] !== name) return false;
            if (itemCount === null) return true;
            const m = r.match(/(\d+)\s+items/);
            return !!m && Number(m[1]) === itemCount;
        });
        if (!match) {
            if (quiet) return false;
            console.error(`FAIL: no saved basket "${name}"${itemCount !== null ? ` with ${itemCount} items` : ''} in: ${rows.map(r => r.replace(/\n/g, ' | ')).join(' || ')}`);
            return false;
        }
        const el = await this.driver.$(`android=new UiSelector().description("${match.replace(/"/g, '\\"')}")`);
        await el.click();
        console.log(`Opened saved basket: ${match.replace(/\n/g, ' | ')}`);
        return await this.isElementVisible(this.editBasketButton, timeout);
    }

    // The floating "+ New Basket" button reports the whole list area as its bounds
    // ([0,483][1080,2208] on the Pixel 4a), so a plain element click() taps empty space in the
    // middle of the list. The visible pill sits in the bottom-right corner of those bounds, just
    // above the bottom nav (~[647,1886][1035,2008], verified live), so it is tapped there instead.
    // verifyNewBasketDialogOpened() below confirms whether the tap landed.
    async clickNewBasket(timeout = 5000) {
        const el = await this.driver.$(this.newBasketButton);
        await el.waitForDisplayed({ timeout });
        const { x, y } = await el.getLocation();
        const { width, height } = await el.getSize();
        const navTop = ((await this.getDescribedElements()).find(n => n.desc === 'Orders') || { y1: y + height }).y1;
        const tapX = x + width - 240;
        const tapY = Math.min(y + height, navTop) - 100;
        await this.driver.action('pointer').move({ duration: 0, x: tapX, y: tapY }).down().up().perform();
        console.log(`Clicked New Basket (tapped at ${tapX},${tapY})`);
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

    // Opens global search from the basket screen - via "Add symbols to your basket" when shown,
    // otherwise via the search bar.
    async openGlobalSearch() {
        if (await this.isElementVisible(this.addSymbolsButton, 3000)) {
            await this.clickAddSymbols();
            return;
        }
        await this.click(this.globalSearchBar);
        console.log('Clicked global search bar');
    }

    async waitForOrderPad(timeout = 8000) {
        return await this.isElementVisible(this.orderPadLoaded, timeout);
    }

    async selectExchange(exchange) {
        await this.click(`android=new UiSelector().descriptionStartsWith("${exchange} ")`);
        await this.driver.pause(500);
        console.log(`Selected exchange: ${exchange}`);
    }

    async selectProduct(product) {
        await this.click(`android=new UiSelector().description("${product}")`);
        await this.driver.pause(300);
        console.log(`Selected product: ${product}`);
    }

    // Reads the price field's mode from its label "Price (Limit)"/"Price (Market)"; null if unread.
    async getPriceMode() {
        const nodes = await this.getDescribedElements();
        const label = nodes.find(n => /^Price\s*\((Market|Limit)\)/i.test(n.desc));
        if (!label) return null;
        const mode = label.desc.match(/\((Market|Limit)\)/i)[1];
        return mode.charAt(0).toUpperCase() + mode.slice(1).toLowerCase();
    }

    // Switches the price field to `type` ('Market'/'Limit') by tapping its swap icon only when it
    // isn't already in that mode. Returns true when the label confirms the requested mode.
    async setOrderType(type) {
        let mode = await this.getPriceMode();
        if (mode === null) {
            console.error(`FAIL: could not read the price mode ("Price (Market/Limit)") on the order pad`);
            return false;
        }
        if (mode !== type) {
            await this.click(this.marketLimitSwap);
            await this.driver.pause(500);
            mode = await this.getPriceMode();
        }
        const ok = mode === type;
        console.log(`Order type: ${mode} (wanted ${type}) ${ok ? 'PASS' : 'FAIL'}`);
        return ok;
    }

    // Reads "<n>/<max> items" from the basket header as a number; null if not shown.
    async getItemCount() {
        const { itemCount } = await this.readBasketHeader();
        const m = itemCount && itemCount.match(/^(\d+)\//);
        return m ? Number(m[1]) : null;
    }

    // Full add-to-basket pass for one combination: global search -> symbol -> ADD BUY/ADD SELL ->
    // set exchange, product and Market/Limit on the order pad -> confirm with the pad's ADD BUY/
    // ADD SELL. Adding to a basket never places an order (that only happens on EXECUTE).
    // Returns true when the pad was set as asked and "Added To Basket" was shown.
    async addSymbolToBasket({ query, symbol, side, exchange, orderType, product }) {
        await this.openGlobalSearch();
        await this.searchSymbol(query);
        await this.driver.pause(1000);
        await this.clickFirstSearchResult(symbol);

        if (side === 'BUY') await this.clickAddBuy();
        else await this.clickAddSell();

        if (!(await this.waitForOrderPad())) {
            console.error(`FAIL: order pad did not open after ADD ${side}`);
            return false;
        }
        await this.selectExchange(exchange);
        await this.selectProduct(product);
        const typeOk = await this.setOrderType(orderType);

        await this.confirmOrderPad(side);
        const toast = await this.waitForAddedToBasketToast(3000);
        console.log(`"Added To Basket" toast shown: ${toast}`);
        return typeOk && toast;
    }

    // Collects every item row in the open basket ("Side: X ,Name: Y, Quantity: N, Order price: P,
    // Exchange: E, Product type: T, Order type: O, Double tap to View option"), scrolling down
    // until no new rows appear, then parses each into its fields.
    async getBasketItems(maxScrolls = 10) {
        const seen = new Map();
        let scrolls = 0;
        for (let i = 0; i <= maxScrolls; i++) {
            const before = seen.size;
            const nodes = await this.getDescribedElements();
            nodes.filter(n => /^Side:/.test(n.desc)).forEach(n => seen.set(n.desc, n.desc));
            if (i > 0 && seen.size === before) break;
            await this.swipe('down');
            scrolls++;
            await this.driver.pause(500);
        }
        // Scroll back to the top so the header and EXECUTE are where later steps expect them.
        for (let i = 0; i < scrolls; i++) await this.swipe('up');
        const field = (raw, re) => { const m = raw.match(re); return m ? m[1].trim() : null; };
        return [...seen.values()].map(raw => ({
            raw,
            side: field(raw, /Side:\s*([a-zA-Z]+)/),
            name: field(raw, /Name:\s*([^,]+)/),
            exchange: field(raw, /Exchange:\s*([A-Z]+)/),
            product: field(raw, /Product type:\s*([a-zA-Z]+)/),
            orderType: field(raw, /Order type:\s*([a-zA-Z]+)/),
        }));
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
        // Symbol name without the trailing ", Double tap to open Quote Screen." hint.
        return match.desc.split(',')[0].trim();
    }

    // Clicks the top-most search result whose description starts with tokens[0] and contains every
    // other token (case-insensitive) - e.g. ['SENSEX', '77100', 'CE'] matches "SENSEX 26NOV 77100 CE,
    // Double tap to open Quote Screen." whether or not the expiry sits between the words, while
    // startsWith keeps 'NIFTY' from matching BANKNIFTY/FINNIFTY. Returns the symbol name.
    async clickFirstSearchResultMatching(tokens) {
        const up = tokens.map(t => t.toUpperCase());
        const nodes = (await this.getDescribedElements())
            .filter(n => n.desc.includes('Double tap to open Quote Screen'))
            .sort((a, b) => a.y1 - b.y1);
        const match = nodes.find(n => {
            const d = n.desc.toUpperCase();
            return d.startsWith(up[0]) && up.every(t => d.includes(t));
        });
        if (!match) throw new Error(`No search result found matching "${tokens.join(' ')}"`);
        await this.driver.action('pointer')
            .move({ duration: 0, x: Math.round((match.x1 + match.x2) / 2), y: Math.round((match.y1 + match.y2) / 2) })
            .down().up().perform();
        console.log(`Clicked first search result: ${match.desc}`);
        return match.desc.split(',')[0].trim();
    }

    // True when the basket detail screen's "Analyze" button is on screen. The app shows it only
    // for NFO, BFO and MCX baskets. Waits up to `timeout` ms so a late-rendering button isn't missed.
    async isAnalyzeVisible(timeout = 3000) {
        return await this.isElementVisible(this.analyzeButton, timeout);
    }

    // Taps the Analyze button and confirms the tap navigated away from the basket detail screen
    // (its "Edit" button gone). If the element click() didn't register, retries once with a raw
    // adb tap at the button's centre (some Compose controls only react to that). Returns true
    // once the basket screen has been left.
    async clickAnalyze(timeout = 5000) {
        if (!(await this.isAnalyzeVisible(timeout))) {
            console.error('FAIL: Analyze button not found');
            return false;
        }
        const el = await this.driver.$(this.analyzeButton);
        const { x, y } = await el.getLocation();
        const { width, height } = await el.getSize();
        const left = () => this.driver.waitUntil(async () => !(await this.isElementVisible(this.editBasketButton, 300)),
            { timeout: 5000, interval: 500 }).then(() => true).catch(() => false);

        await el.click();
        console.log(`Clicked Analyze (element click at [${x},${y}] ${width}x${height})`);
        if (await left()) return true;

        const cx = Math.round(x + width / 2), cy = Math.round(y + height / 2);
        console.log(`Still on the basket screen after click() - retrying with adb tap at ${cx},${cy}`);
        this.adbTap(cx, cy);
        if (await left()) return true;
        console.error('FAIL: tapping Analyze did not leave the basket detail screen');
        return false;
    }

    // Every content-desc and text value on screen, in page order (works for native Compose
    // screens and for WebView content exposed through accessibility).
    async getScreenStrings() {
        const descs = (await this.getDescribedElements()).map(n => n.desc);
        const texts = (await this.getTextElements()).map(n => n.text);
        return [...descs, ...texts].map(s => s.replace(/\s+/g, ' ').trim()).filter(Boolean);
    }

    // Waits for the NxtOption strategy builder opened by Analyze. The screen never shows the words
    // "NxtOption"/"Strategy Builder" (verified live, ui_dumps/basket_strategy_builder_bfo.xml), so
    // it is recognised by its own fixed labels: the "Instrument" and "LTP" leg-table headers, "Net
    // Premium", and the "Payoff Charts" tab.
    async waitForStrategyBuilder(timeout = 20000) {
        const has = (strings, re) => strings.some(s => re.test(s));
        return await this.driver.waitUntil(async () => {
            const s = await this.getScreenStrings();
            return has(s, /^Instrument$/) && has(s, /^LTP$/) && has(s, /^Net Premium$/) && has(s, /^Payoff Charts\b/);
        }, { timeout, interval: 1000 }).then(() => true).catch(() => false);
    }

    // Reads the strategy builder's details (layout verified live):
    //   header      "SENSEX\n81106.65\n+0.13%"            -> underlying, spot, change
    //   leg table   B/S | Instrument | Price | LTP headers; first row
    //               "B" | "1 x 12 Nov 77100 CE" | "3681.35" | "3681.35"
    //   "Net Premium" "Pay" "73,627.00"
    // Each leg cell is the node below its header whose horizontal centre is closest to the
    // header's (cells are wider/narrower than their headers, so exact x matches don't work).
    // `legs` holds every row of the leg table (a basket with several symbols has one row each):
    // rows are the nodes between the table headers and the "Lots" label, grouped by vertical
    // centre. side/instrument/price/ltp at the top level are the first leg's, as before.
    async getStrategyBuilderDetails() {
        const nodes = (await this.getDescribedElements()).map(n => ({ ...n, desc: n.desc.trim() }));
        const cx = n => (n.x1 + n.x2) / 2;
        const cy = n => (n.y1 + n.y2) / 2;
        const header = label => nodes.find(n => n.desc === label);
        const rows = (() => {
            const instr = header('Instrument');
            if (!instr) return [];
            const lots = header('Lots');
            const cells = nodes
                .filter(n => n.y1 >= instr.y2 && (!lots || n.y2 <= lots.y1) && n.x2 - n.x1 < 900)
                .sort((a, b) => cy(a) - cy(b));
            const grouped = [];
            for (const n of cells) {
                const row = grouped[grouped.length - 1];
                if (row && Math.abs(cy(row[0]) - cy(n)) < 40) row.push(n);   // a leg row is ~90px tall
                else grouped.push([n]);
            }
            return grouped;
        })();
        const cellUnder = (row, label) => {
            const h = header(label);
            if (!h || !row || !row.length) return null;
            return row.slice().sort((a, b) => Math.abs(cx(a) - cx(h)) - Math.abs(cx(b) - cx(h)))[0].desc;
        };
        const legs = rows
            .map(row => ({
                side: cellUnder(row, 'B/S'),
                instrument: cellUnder(row, 'Instrument'),
                price: cellUnder(row, 'Price'),
                ltp: cellUnder(row, 'LTP'),
            }))
            .filter(l => /^\d+\s*x\s/i.test(l.instrument || ''));   // real legs read "1 x 12 Nov 77100 CE"
        const firstLeg = legs[0] || { side: null, instrument: null, price: null, ltp: null };

        // The underlying header is the only node whose desc is "NAME\n<number>\n<±change>%" - NAME
        // can contain spaces ("SENSEX", "NIFTY 50").
        const top = nodes.find(n => /^[A-Z][A-Z0-9 &-]*\n[\d,.]+\n[+-]?[\d.]+%$/.test(n.desc));
        const [underlying, spot, change] = top ? top.desc.split('\n') : [null, null, null];

        const premiumLabel = header('Net Premium');
        const premiumRow = premiumLabel ? nodes.filter(n => Math.abs(n.y1 - premiumLabel.y1) < 20 && n.x1 > premiumLabel.x2) : [];
        const netPremium = (premiumRow.find(n => /^[\d,]+(\.\d+)?$/.test(n.desc)) || {}).desc || null;
        const payOrReceive = (premiumRow.find(n => /^(Pay|Receive)$/i.test(n.desc)) || {}).desc || null;

        return { underlying, spot, change, ...firstLeg, legs, netPremium, payOrReceive };
    }

    // The strategy builder's top header node ("CRUDEOIL\n8551.00\n0.00%"), or null. It shows one
    // underlying at a time - for a basket with several underlyings the first one added - and
    // the whole header (name + dropdown arrow, [154,183][1080,303]) is one clickable node that
    // opens the underlying dropdown (verified live, ui_dumps/basket_strategy_builder_multi.xml).
    async getBuilderHeaderNode() {
        const nodes = await this.getDescribedElements();
        return nodes.find(n => /^[A-Z][A-Z0-9 &-]*\n[\d,.]+\n[+-]?[\d.]+%$/.test(n.desc.trim())) || null;
    }

    // Opens the underlying dropdown and selects `underlying` (e.g. "NIFTY", "SENSEX"), then waits
    // for the header to switch to it. The open list has one entry per basket underlying, labelled
    // by name only ("CRUDEOIL", "NIFTY", "SENSEX" - verified live, ui_dumps/strategy_builder_dropdown.xml);
    // an option is any node other than the header whose first line is the name or starts with
    // "<name> ", and the top-most one is tapped. Returns { ok, options }.
    async selectBuilderUnderlying(underlying, timeout = 10000) {
        const name = underlying.toUpperCase();
        const firstLine = n => n.desc.trim().split('\n')[0].trim().toUpperCase();
        const isOption = n => firstLine(n) === name || firstLine(n).startsWith(name + ' ');

        const header = await this.getBuilderHeaderNode();
        if (!header) {
            console.error('FAIL: strategy builder header (underlying dropdown) not found');
            return { ok: false, options: [] };
        }
        const tapCentre = n => this.driver.action('pointer')
            .move({ duration: 0, x: Math.round((n.x1 + n.x2) / 2), y: Math.round((n.y1 + n.y2) / 2) })
            .down().up().perform();
        await tapCentre(header);
        console.log(`Opened the underlying dropdown (header "${header.desc.replace(/\n/g, ' ')}")`);
        await this.driver.pause(800);

        let option = null;
        let nodes = [];
        await this.driver.waitUntil(async () => {
            nodes = await this.getDescribedElements();
            option = nodes
                .filter(n => isOption(n) && !(n.y1 === header.y1 && n.x1 === header.x1))
                .sort((a, b) => a.y1 - b.y1)[0] || null;
            return !!option;
        }, { timeout: 5000, interval: 500 }).catch(() => { });
        // Everything that looks like a list entry, for the log (first lines of nodes below the header).
        const options = nodes.filter(n => n.y1 > header.y2 && n.clickable).map(n => n.desc.replace(/\n/g, ' ')).slice(0, 15);
        if (!option) {
            console.error(`FAIL: "${underlying}" not found in the underlying dropdown`);
            await this.dumpPage(`strategy_builder_dropdown_no_${underlying.toLowerCase()}`);
            await this.driver.back();   // close the dropdown
            return { ok: false, options };
        }
        await tapCentre(option);
        console.log(`Selected "${option.desc.replace(/\n/g, ' ')}" from the dropdown`);

        const switched = await this.driver.waitUntil(async () => {
            const h = await this.getBuilderHeaderNode();
            return !!h && (firstLine(h) === name || firstLine(h).startsWith(name + ' '));
        }, { timeout, interval: 500 }).then(() => true).catch(() => false);
        return { ok: switched, options };
    }

    // Saves the current page source to ui_dumps/<name>.xml (for checking selectors on screens
    // not yet captured).
    async dumpPage(name) {
        const fs = require('fs');
        const path = require('path');
        const file = path.join(__dirname, '..', 'ui_dumps', `${name}.xml`);
        fs.writeFileSync(file, await this.driver.getPageSource());
        console.log(`Saved page source to ${file}`);
    }

    // Presses Back until the basket detail screen (its "Edit" button) is visible again.
    async backToBasketDetail(maxBackPresses = 4) {
        for (let i = 0; i <= maxBackPresses; i++) {
            if (await this.isElementVisible(this.editBasketButton, 1500)) return true;
            await this.driver.back();
            await this.driver.pause(1000);
        }
        console.error('FAIL: could not get back to the basket detail screen');
        return false;
    }

    async clickAddBuy() {
        await this.click(this.addBuyButton);
        this.lastAddSide = 'BUY';
        console.log('Clicked ADD BUY');
    }

    async clickAddSell() {
        await this.click(this.addSellButton);
        this.lastAddSide = 'SELL';
        console.log('Clicked ADD SELL');
    }

    // Confirms the qty/price mini order-pad shown after ADD BUY/ADD SELL by tapping the pad's own
    // button for the same side: ADD BUY was clicked -> tap ADD BUY on the pad, else (ADD SELL was
    // clicked) -> tap ADD SELL. `side` can be passed explicitly to override.
    // While the pad opens the Quote screen's own ADD BUY/ADD SELL can still be in the tree, so
    // this waits for the pad to render and taps the last match (the pad is drawn on top, later
    // in the hierarchy).
    async confirmOrderPad(side = this.lastAddSide, timeout = 5000) {
        if (side !== 'BUY' && side !== 'SELL') {
            throw new Error('confirmOrderPad: call clickAddBuy() or clickAddSell() first (or pass side "BUY"/"SELL")');
        }
        const selector = side === 'BUY' ? this.orderPadBuyButton : this.orderPadSellButton;
        await this.driver.pause(800);
        let buttons = [];
        await this.driver.waitUntil(async () => {
            buttons = await this.driver.$$(selector);
            return buttons.length > 0;
        }, { timeout, interval: 300, timeoutMsg: `Order pad ${side} button not found within ${timeout}ms` });
        const target = buttons[buttons.length - 1];
        const label = await target.getAttribute('content-desc');
        await target.click();
        console.log(`Confirmed order pad with "${label}" (side picked: ADD ${side}) - symbol added to basket`);
    }

    // Returns the first (top-most) basket item row's raw content-desc; null if none is on screen.
    async getFirstItemDesc() {
        const nodes = await this.getDescribedElements();
        const rows = nodes.filter(n => /^Side:/.test(n.desc)).sort((a, b) => a.y1 - b.y1);
        return rows.length ? rows[0].desc : null;
    }

    static sideOf(desc) {
        const m = desc && desc.match(/Side:\s*([a-zA-Z]+)/);
        return m ? m[1].toUpperCase() : null;
    }

    // Taps the first item in the basket, which shows its Clone/Modify options.
    async tapFirstBasketItem(timeout = 5000) {
        const row = await this.driver.$(this.basketItemRow);
        await row.waitForDisplayed({ timeout });
        await row.click();
        console.log('Tapped first basket item');
    }

    async clickClone() {
        await this.click(this.cloneOption);
        console.log('Clicked Clone');
    }

    async clickModify() {
        await this.click(this.modifyOption);
        console.log('Clicked Modify');
    }

    // On the Modify order pad, taps the Buy/Sell swap icon next to ADD BUY/ADD SELL - which only
    // flips the pad's button (e.g. ADD SELL -> ADD BUY), it doesn't save - then taps that flipped
    // button to save and waits for "Basket updated successfully" (verified live).
    async swapSideAndSave() {
        if (!(await this.waitForOrderPad())) {
            console.error('FAIL: order pad did not open after Modify');
            return false;
        }
        const confirm = '//*[@content-desc="ADD BUY" or @content-desc="ADD SELL"]';
        const labelBefore = await (await this.driver.$(confirm)).getAttribute('content-desc');
        await this.click(this.swapBuySellButton);
        await this.driver.pause(500);
        const button = await this.driver.$(confirm);
        const labelAfter = await button.getAttribute('content-desc');
        const flipped = labelBefore !== labelAfter;
        console.log(`Swapped Buy/Sell: "${labelBefore}" -> "${labelAfter}" ${flipped ? 'PASS' : 'FAIL'}`);
        await button.click();
        console.log(`Clicked "${labelAfter}" to save`);
        return flipped && await this.waitForToast('Basket updated successfully', { timeout: 3000 });
    }

    // Name of the open basket, read from the detail screen's header: the label just before "Edit"
    // (header order is "Close, Double tap to close", <name>, ["Analyze" button,] "Edit"). The
    // clickable Analyze button (NFO/BFO/MCX baskets only) sits between the name and Edit, so it's
    // skipped; the name itself is never clickable.
    async getOpenBasketName(timeout = 5000) {
        if (!(await this.isElementVisible(this.editBasketButton, timeout))) return null;
        const nodes = await this.getDescribedElements();
        let idx = nodes.findIndex(n => n.desc === 'Edit') - 1;
        while (idx >= 0 && nodes[idx].desc === 'Analyze' && nodes[idx].clickable) idx--;
        return idx >= 0 ? nodes[idx].desc.trim() : null;
    }

    async clickEditBasket() {
        await this.click(this.editBasketButton);
        const opened = await this.isElementVisible(this.editBasketTitle, 5000);
        console.log(opened ? 'Opened Edit Basket' : 'FAIL: Edit Basket screen did not open');
        return opened;
    }

    // Replaces the basket name on Edit Basket: taps the name field, deletes the current name
    // with DEL key presses, and types the new one. Returns the name the field shows afterwards.
    async renameBasket(currentName, newName) {
        const field = await this.driver.$(`//android.widget.Button[@text="${currentName}"]`);
        await field.waitForDisplayed({ timeout: 5000 });
        await field.click();
        await this.driver.pause(400);
        for (let i = 0; i < currentName.length + 3; i++) await this.driver.pressKeyCode(67); // KEYCODE_DEL
        for (const ch of newName) {
            await this.driver.keys(ch);
            await this.driver.pause(60);
        }
        await this.driver.pause(400);
        const shown = await this.driver.$(`//android.widget.Button[@text="${newName}"]`).isExisting();
        console.log(`Renamed field "${currentName}" -> "${newName}": ${shown ? 'PASS' : 'FAIL'}`);
        return shown;
    }

    // Taps Edit Basket's Back arrow and reports whether the save-changes popup appeared. With the
    // keyboard still open the first Back only closes the keyboard, so it is hidden first.
    async leaveEditBasket() {
        if (await this.driver.isKeyboardShown().catch(() => false)) {
            await this.driver.hideKeyboard().catch(() => { });
            await this.driver.pause(500);
        }
        await this.click(this.editBasketBack);
        const prompt = await this.isElementVisible(this.saveChangesPrompt, 3000);
        console.log(`"Do you want to save the changes?" popup shown: ${prompt} ${prompt ? 'PASS' : 'FAIL'}`);
        return prompt;
    }

    // Basket item rows currently on screen, top to bottom (works on both the detail and the Edit
    // Basket screen - each uses its own "Side: ..." description format).
    async getVisibleItemRows() {
        const nodes = await this.getDescribedElements();
        return nodes.filter(n => /^Side:/.test(n.desc)).sort((a, b) => a.y1 - b.y1).map(n => n.desc);
    }

    // On Edit Basket: taps the first item's Remove icon and waits for the "<SYMBOL> Removed"
    // message. Returns the message text (without the trailing "Undo"), or null if none showed.
    async removeFirstSymbol() {
        await this.click(this.removeSymbolIcon);
        console.log('Clicked Remove on the first symbol');
        const msg = await this.driver.$(this.removedMessage);
        const shown = await msg.waitForExist({ timeout: 3000 }).then(() => true).catch(() => false);
        if (!shown) return null;
        const desc = await msg.getAttribute('content-desc');
        return desc.split('\n')[0].trim();
    }

    // Taps Undo on the "<SYMBOL> Removed" message - near its right end, where the Undo text sits.
    async undoRemove() {
        const msg = await this.driver.$(this.removedMessage);
        if (!(await msg.isExisting())) {
            console.error('FAIL: "Removed" message was gone before Undo could be tapped');
            return false;
        }
        const { x, y } = await msg.getLocation();
        const { width, height } = await msg.getSize();
        await this.driver.action('pointer')
            .move({ duration: 0, x: Math.round(x + width - 80), y: Math.round(y + height / 2) })
            .down().up().perform();
        await this.driver.pause(800);
        console.log('Clicked Undo');
        return true;
    }

    async clickDone() {
        await this.click(this.editBasketDone);
        console.log('Clicked Done');
        await this.driver.pause(1000);
    }

    // On Edit Basket: taps DELETE BASKET and reports whether the confirm popup appeared.
    async clickDeleteBasket() {
        await this.click(this.deleteBasketButton);
        console.log('Clicked DELETE BASKET');
        const prompt = await this.isElementVisible(this.deleteBasketPrompt, 3000);
        console.log(`"Are you sure, you want to Delete the basket?" popup shown: ${prompt} ${prompt ? 'PASS' : 'FAIL'}`);
        return prompt;
    }

    // Leaves Edit Basket via its Back arrow, answering No if the save-changes popup appears.
    async exitEditBasketWithoutSaving() {
        await this.click(this.editBasketBack);
        if (await this.isElementVisible(this.saveChangesPrompt, 2000)) await this.answerSaveChanges('No');
    }

    // Answers the save-changes popup with 'No' or 'Yes'.
    async answerSaveChanges(answer) {
        await this.click(`//*[@content-desc="${answer}" or @text="${answer}"]`);
        console.log(`Clicked ${answer} on the popup`);
        await this.driver.pause(1000);
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
