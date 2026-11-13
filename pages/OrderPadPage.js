const BasePage = require('./BasePage');
const { decodePng, pixelAt } = require('../utils/pngPixels');

// Selected radios/chips (NSE/BSE, Delivery/Intraday, Validity) are drawn in the accent blue, but
// the accessibility tree reports selected="false"/checked="false" for every one of them - so
// selection is read off a screenshot. Measured on a Pixel 4a (RTNPOWER, 12 Nov 2026): the
// selected option scores ~90-590 blue pixels (sampled every 2px), the unselected one 0.
const SELECTED_MIN_BLUE = 30;

const round2 = n => Math.round(n * 100) / 100;
const num = text => Number(String(text || '').replace(/[₹,\s]/g, ''));

class OrderPadPage extends BasePage {
    constructor(driver) {
        super(driver);
        this.backButton = 'android=new UiSelector().description("Back, Double tap to go back")';
        this.orderTypeLabel = 'android=new UiSelector().description("Order Type:")';
        this.buyIndicator = 'android=new UiSelector().description("BUY")';
        this.sellIndicator = 'android=new UiSelector().description("SELL")';

        // Field labels as exposed on the Order Pad (ui_dumps/r20_orderpad_fields.xml).
        this.quantityLabel = 'android=new UiSelector().description("Quantity")';
        this.priceLabel = 'android=new UiSelector().descriptionStartsWith("Price (")';
        this.addStoplossLabel = 'android=new UiSelector().description("Add Stoploss")';
        this.moreToggle = 'android=new UiSelector().descriptionStartsWith("More")';
        this.marketLimitSwap = 'android=new UiSelector().description("Swap, Double tap to switch between Market and Limit")';
        // Exactly two EditTexts on the pad, neither with a resource-id: quantity first, price second.
        this.quantityInput = 'android=new UiSelector().className("android.widget.EditText").instance(0)';
        this.priceInput = 'android=new UiSelector().className("android.widget.EditText").instance(1)';
        this.deliveryOption = 'android=new UiSelector().description("Delivery")';
        this.intradayOption = 'android=new UiSelector().description("Intraday")';
        this.carryforwardOption = 'android=new UiSelector().descriptionMatches("(?i)carry ?forward")';

        // Controls below were captured live on RTNPOWER (NSE) on 12 Nov 2026.
        this.regularLabel = 'android=new UiSelector().description("Regular")';
        this.qtyAmountSwap = 'android=new UiSelector().description("Swap, Double tap to switch between Amount and Quantity.")';
        this.amountLabel = 'android=new UiSelector().description("Amount")';
        this.marketDepthButton = 'android=new UiSelector().descriptionStartsWith("Open Market Depth")';
        // Bottom sheet over a "Scrim", heading "Market Depth" then Bid/Ord/Qty/Ask/Ord/Qty rows.
        this.marketDepthHeading = 'android=new UiSelector().description("Market Depth")';
        // The ImageView is the exact "toggle stoploss"; its wrapper View adds ", Double tap to ...".
        this.stoplossToggle = 'android=new UiSelector().description("toggle stoploss")';
        this.triggerPriceLabel = 'android=new UiSelector().description("Trigger Price")';
        this.moreCollapsed = 'android=new UiSelector().description("More, Collapsed")';
        this.moreExpanded = 'android=new UiSelector().description("More, Expanded")';
        this.validityLabel = 'android=new UiSelector().description("Validity")';
        this.disclosedQtyLabel = 'android=new UiSelector().description("Disclosed Qty")';
        this.buySellSwap = 'android=new UiSelector().descriptionStartsWith("Swap Buy Sell")';

        // Derivative pads (NFO/BFO/MCX/CDS) open in Quantity mode with a "65 Qty = 1 Lot" note above
        // the box, and a Quantity <-> Lot swap in place of Amount (Lot mode: label "Lot", note
        // "1 Lot = 65 Qty"). The exchange row is a single tile ("NFO \nExchange is NFO and the last
        // traded price is ...") - no NSE/BSE choice. Live: NIFTY 17NOV 25100 CE, 13 Nov 2026.
        this.lotLabel = 'android=new UiSelector().description("Lot")';
        this.qtyOrLotLabel = 'android=new UiSelector().descriptionMatches("Quantity|Lot")';
        this.lotSizeNote = 'android=new UiSelector().descriptionMatches("1 Lot = .*")';
        this.lotQtySwap = 'android=new UiSelector().descriptionMatches("(?i)Swap, Double tap to switch between LOT and Quantity.*")';

        // Shown after BUY instead of placing anything - the order only goes out on its CONFIRM.
        this.confirmationHeading = 'android=new UiSelector().description("Confirmation Preview")';
        // Shown instead of the popup when the price is outside the daily price range.
        this.dprError = 'android=new UiSelector().descriptionStartsWith("DPR Range")';

        // Confirmation Preview -> "Applicable Charges" -> "Brokerage and Charges" panel: each charge
        // label followed by its value ("Brokerage", "0.02", ...), then "Disclaimer : ..."
        // (ui_dumps/r26_charges_breakdown_invalid.xml; same flow as Regression R25/R26).
        this.applicableChargesLink = 'android=new UiSelector().description("Applicable Charges")';
        this.chargesHeading = 'android=new UiSelector().description("Brokerage and Charges")';
        // Some symbols show a surveillance (GSM/ASM) warning before the popup; PROCEED only moves
        // on to the Confirmation Preview, it does not place anything (Regression R25).
        this.surveillanceWarning = 'android=new UiSelector().descriptionMatches("(?s).*(Surveillance|GSM|ASM).*")';
        this.surveillanceProceed = 'android=new UiSelector().descriptionMatches("(?i)proceed")';
    }

    async getQuantity() {
        try {
            return (await (await this.driver.$(this.quantityInput)).getAttribute('text')) || '';
        } catch (_) {
            return '';
        }
    }

    // Quantity must come pre-filled (e.g. "1" for equity, the lot size for derivatives).
    async verifyQuantityPrefilled() {
        const text = await this.getQuantity();
        const qty = Number(text.replace(/,/g, ''));
        const ok = text !== '' && Number.isFinite(qty) && qty > 0;
        console.log(`Quantity filled by default (reads "${text}"): ${ok ? 'PASS' : 'FAIL'}`);
        return ok;
    }

    // Product options depend on the segment: equity (NSE/BSE) shows Intraday + Delivery, derivatives
    // (NFO/BFO/CDS/MCX) show Intraday + Carryforward - and not the other segment's option.
    // A derivative expiring today or tomorrow has no Intraday (expected app behaviour, confirmed
    // live on SENSEX 12NOV 77100 CE the day before expiry) - pass `nearExpiry` to expect it absent.
    async verifyProductOptions(exchange, { nearExpiry = false } = {}) {
        const equity = ['NSE', 'BSE'].includes(exchange);
        const noIntraday = !equity && nearExpiry;
        const expected = equity
            ? [['Intraday', this.intradayOption], ['Delivery', this.deliveryOption]]
            : noIntraday
                ? [['Carryforward', this.carryforwardOption]]
                : [['Intraday', this.intradayOption], ['Carryforward', this.carryforwardOption]];
        const absent = equity
            ? [['Carryforward', this.carryforwardOption]]
            : noIntraday
                ? [['Delivery', this.deliveryOption], ['Intraday', this.intradayOption]]
                : [['Delivery', this.deliveryOption]];
        const why = noIntraday ? ' (contract expires today/tomorrow)' : '';
        let ok = true;
        for (const [name, sel] of expected) {
            if (!equity && name === 'Intraday') {
                // Derivative Intraday can be shown but disabled (BFO) - present is what's checked
                // here; whether it can be tapped is logged and decides if the Intraday steps run.
                const { present, actionable } = await this.getProductState('Intraday');
                console.log(`Intraday product displayed for ${exchange}${present && !actionable ? ' (not actionable for this contract - Intraday steps will be skipped)' : ''}: ${present ? 'PASS' : 'FAIL'}`);
                ok = ok && present;
                continue;
            }
            const shown = await this.isElementVisible(sel, 3000);
            console.log(`${name} product displayed for ${exchange}: ${shown ? 'PASS' : 'FAIL'}`);
            ok = ok && shown;
        }
        for (const [name, sel] of absent) {
            const wrong = await this.isElementVisible(sel, 1000);
            console.log(`${name} product not displayed for ${exchange}${name === 'Intraday' ? why : ''}: ${wrong ? 'FAIL (displayed)' : 'PASS'}`);
            ok = ok && !wrong;
        }
        return ok;
    }

    // Checks every field the Order Pad must show: Order Type, Quantity (pre-filled), Price, Add
    // Stoploss, the segment's product options, More, Approx / Avail margin (labels and values) and
    // the BUY button. Read-only.
    async verifyOrderPadFields(exchange, { nearExpiry = false } = {}) {
        const checks = [
            ['Order Type', this.orderTypeLabel],
            ['Quantity/Lot', this.qtyOrLotLabel],
            ['Price', this.priceLabel],
            ['Add Stoploss', this.addStoplossLabel],
            ['More', this.moreToggle],
        ];
        let allOk = true;
        for (const [name, sel] of checks) {
            const shown = await this.isElementVisible(sel, 3000);
            console.log(`${name} displayed on Order Pad: ${shown ? 'PASS' : 'FAIL'}`);
            allOk = allOk && shown;
        }
        allOk = (await this.verifyQuantityPrefilled()) && allOk;
        if (exchange) {
            allOk = (await this.verifyProductOptions(exchange, { nearExpiry })) && allOk;
        } else {
            console.log('Segment unknown - cannot check the Intraday/Delivery/Carryforward options: FAIL');
            allOk = false;
        }
        const { approxText, availText } = await this.readMargins();
        console.log(`Approx margin displayed ("${approxText}"): ${approxText !== null ? 'PASS' : 'FAIL'}`);
        console.log(`Avail margin displayed ("${availText}"): ${availText !== null ? 'PASS' : 'FAIL'}`);
        const buyShown = await this.isElementVisible(this.buyIndicator, 3000);
        console.log(`BUY button displayed: ${buyShown ? 'PASS' : 'FAIL'}`);
        return allOk && approxText !== null && availText !== null && buyShown;
    }

    // "Price (Limit)" / "Price (Market)" - the mode is in the label's parens.
    async getPriceMode() {
        try {
            const desc = await (await this.driver.$(this.priceLabel)).getAttribute('content-desc');
            const m = desc && desc.match(/\((\w+)\)/);
            return m ? m[1] : null;
        } catch (_) {
            return null;
        }
    }

    async ensureLimitMode() {
        let mode = await this.getPriceMode();
        if (mode && mode.toLowerCase() === 'market') {
            await this.click(this.marketLimitSwap, 3000);
            await this.pause(500);
            mode = await this.getPriceMode();
        }
        console.log(`Price mode is Limit (reads "${mode}"): ${mode && mode.toLowerCase() === 'limit' ? 'PASS' : 'FAIL'}`);
        return !!mode && mode.toLowerCase() === 'limit';
    }

    async getPrice() {
        try {
            return (await (await this.driver.$(this.priceInput)).getAttribute('text')) || '';
        } catch (_) {
            return '';
        }
    }

    // Real key events only (focus, move to end, backspace, type). clearValue()/setValue() update
    // the accessibility text without the Compose form's real state changing, so BUY would go out
    // at the untouched price - the Confirmation Preview price check below is what proves it took.
    async setPrice(value) {
        await this.click(this.priceInput, 3000);
        await this.pause(300);
        await this.driver.pressKeyCode(123); // KEYCODE_MOVE_END
        for (let i = 0; i < 15; i++) await this.driver.pressKeyCode(67); // KEYCODE_DEL
        await this.pause(200);
        for (const ch of String(value)) {
            await this.driver.keys(ch);
            await this.pause(60);
        }
        await this.pause(400);
        const text = await this.getPrice();
        const ok = Number(text.replace(/,/g, '')) === Number(value);
        console.log(`Entered ${value} in Price - field reads "${text}": ${ok ? 'PASS' : 'FAIL'}`);
        return ok;
    }

    // Taps the pad's own BUY. This does NOT place the order - it opens the Confirmation Preview
    // (or shows a DPR error); only that popup's CONFIRM sends it.
    async clickBuy() {
        await this.click(this.buyIndicator, 3000);
        console.log('Clicked BUY on the Order Pad');
    }

    // After BUY: waits for the Confirmation Preview or a DPR range error, whichever appears.
    async waitForBuyOutcome(timeout = 8000) {
        let outcome = null;
        try {
            await this.driver.waitUntil(async () => {
                if (await this.isElementVisible(this.confirmationHeading, 300)) outcome = 'confirmation';
                else if (await this.isElementVisible(this.dprError, 300)) outcome = 'dpr';
                return !!outcome;
            }, { timeout, interval: 300 });
        } catch (_) { /* neither appeared */ }
        if (outcome === 'dpr') {
            const msg = await (await this.driver.$(this.dprError)).getAttribute('content-desc').catch(() => '');
            return { outcome, message: msg };
        }
        return { outcome };
    }

    // Popup content-descs: "Confirmation Preview", bare Symbol, (expiry for F&O,) Exchange, then
    // "Label" / ":" / "Value" triples (Order Action, Quantity, Price, Product Type, Order Type,
    // Validity). Pairs are found via the ":" separator rather than fixed positions.
    async getConfirmationDetails() {
        const descs = (await this.getDescribedElements()).map(n => n.desc.trim());
        const start = descs.indexOf('Confirmation Preview');
        if (start === -1) return {};
        const end = descs.findIndex((d, i) => i > start && /^confirm$/i.test(d));
        const body = descs.slice(start + 1, end === -1 ? undefined : end).filter(d => d !== 'Applicable Charges');
        const details = {};
        for (let i = 1; i < body.length - 1; i++) {
            if (body[i] === ':') details[body[i - 1]] = body[i + 1];
        }
        const firstLabel = body.findIndex((d, i) => body[i + 1] === ':');
        const header = firstLabel > 0 ? body.slice(0, firstLabel) : [];
        details.Symbol = header[0] || null;
        details.Exchange = header.find(d => ['NSE', 'BSE', 'NFO', 'BFO', 'CDS', 'MCX'].includes(d)) || null;
        return details;
    }

    // Hardware back closes the popup back to the Order Pad without confirming (verified in the
    // Regression suite) - CONFIRM is never tapped here.
    async dismissConfirmationPopup() {
        await this.driver.back();
        await this.pause(600);
        const closed = !(await this.isElementVisible(this.confirmationHeading, 1000));
        console.log(`Closed the Confirmation Preview without confirming: ${closed ? 'PASS' : 'FAIL'}`);
        return closed;
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
        // Newer builds label them "Approx Margin"/"Available Margin" (ui_dumps/r20_orderpad_fields.xml).
        const LABELS = { 'Approx margin': /^approx\.? margin$/i, Avail: /^avail(able)?( margin)?$/i };
        const value = (nodes, label) => {
            const node = nodes.find(n => LABELS[label].test(n.desc.trim().replace(/:$/, '')));
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

    // ---- Detailed Order Pad checks (NSE flow in tests/Orders/NonExecutableOrders.test.js) ----

    // Every node with a content-desc, text, or EditText class, plus its hint and enabled flag.
    // getDescribedElements() alone misses the inputs: they carry their value in "text" and an
    // empty input shows its "0.00" only as a hint (Trigger Price, Disclosed Qty).
    async getPadNodes() {
        const src = await this.driver.getPageSource();
        const unescape = s => s.replace(/&#10;/g, '\n').replace(/&quot;/g, '"').replace(/&apos;/g, "'")
            .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&');
        return (src.match(/<[\w.]+ [^>]*>/g) || []).map(tag => {
            const attr = k => { const m = tag.match(new RegExp(` ${k}="([^"]*)"`)); return m ? unescape(m[1]) : ''; };
            const b = attr('bounds').match(/-?\d+/g);
            if (!b) return null;
            const [x1, y1, x2, y2] = b.map(Number);
            return {
                cls: attr('class').split('.').pop(), desc: attr('content-desc'), text: attr('text'),
                hint: attr('hint') === 'false' ? '' : attr('hint'), enabled: attr('enabled') !== 'false',
                clickable: attr('clickable') === 'true', x1, y1, x2, y2,
            };
        }).filter(n => n && (n.desc || n.text || n.cls === 'EditText'));
    }

    // The input box directly under a label ("Price (", "Trigger Price", "Disclosed Qty"). In Market
    // mode the price box stops being an EditText (a disabled View reading "0"), so any node with
    // text counts, not just EditTexts.
    async getInputBelow(labelRe) {
        const nodes = await this.getPadNodes();
        const label = nodes.find(n => labelRe.test(n.desc));
        if (!label) return null;
        const below = nodes
            .filter(n => n !== label && n.y1 >= label.y2 && n.y1 - label.y2 < 120 && n.x1 < label.x2 && n.x2 > label.x1)
            .filter(n => n.cls === 'EditText' || (n.text && !n.desc));
        below.sort((a, b) => a.y1 - b.y1);
        return below[0] || null;
    }

    // LTP the NSE/BSE radio advertises ("NSE \nExchange is NSE and the last traded price is 7.05").
    async getExchangeLtp(exchange) {
        const node = (await this.getPadNodes()).find(n => n.desc.includes(`Exchange is ${exchange} `));
        const m = node && node.desc.match(/last traded price is ([\d,.]+)/);
        return m ? num(m[1]) : null;
    }

    // Which of `names` (content-descs on screen) is drawn in the accent blue. null when none is
    // clearly highlighted - logged with the counts so a theme change shows up as a readable failure.
    async getHighlightedOption(names, matcher = (n, name) => n.desc === name || n.desc.startsWith(`${name} \n`)) {
        const nodes = await this.getPadNodes();
        const img = decodePng(Buffer.from(await this.driver.takeScreenshot(), 'base64'));
        const { width } = await this.driver.getWindowSize();
        const scale = img.width / width;
        const scores = names.map(name => {
            const n = nodes.find(x => matcher(x, name));
            if (!n) return { name, blue: -1 };
            let blue = 0;
            for (let y = n.y1; y < n.y2; y += 2) {
                for (let x = n.x1; x < n.x2; x += 2) {
                    const [r, , b] = pixelAt(img, x * scale, y * scale);
                    if (b > 150 && b - r > 60) blue++;
                }
            }
            return { name, blue };
        });
        const best = scores.reduce((a, b) => (b.blue > a.blue ? b : a));
        const clear = best.blue >= SELECTED_MIN_BLUE && scores.every(s => s === best || s.blue * 4 <= best.blue);
        return { selected: clear ? best.name : null, scores: scores.map(s => `${s.name}=${s.blue < 0 ? 'missing' : s.blue}`).join(', ') };
    }

    async verifyHighlighted(expected, names, what) {
        const { selected, scores } = await this.getHighlightedOption(names);
        const ok = selected === expected;
        console.log(`${what}: ${expected} selected (highlighted: ${selected || 'none clear'}; blue px ${scores}): ${ok ? 'PASS' : 'FAIL'}`);
        return ok;
    }

    // NSE/BSE: the radio for `exchange` is the highlighted one of the pair. Derivatives: the pad
    // shows a single tile for the contract's own exchange - check it is that one and the only one.
    async verifyExchangeSelected(exchange) {
        if (['NSE', 'BSE'].includes(exchange)) {
            return this.verifyHighlighted(exchange, ['NSE', 'BSE'], 'Exchange radio');
        }
        const tiles = (await this.getPadNodes())
            .map(n => (n.desc.match(/^(NSE|BSE|NFO|BFO|MCX|CDS)\s*\n?\s*Exchange is /) || [])[1])
            .filter(Boolean);
        const ok = tiles.length === 1 && tiles[0] === exchange;
        console.log(`Exchange tile is ${exchange} and the only exchange offered (tiles: ${tiles.join(', ') || 'none'}): ${ok ? 'PASS' : 'FAIL'}`);
        return ok;
    }

    // Which mode the Qty/Lot box is in, its lot-size note and the lot size parsed from it.
    // Seen live (13 Nov 2026): NIFTY/SENSEX options open in Quantity mode with "65 Qty = 1 Lot" /
    // "20 Qty = 1 Lot" above the box ("1 Lot = 65 Qty" in Lot mode). MCX/CDS word the note
    // differently (not captured yet - e.g. a unit instead of "Qty"), so any "<n> <unit> = 1 Lot",
    // "1 Lot = <n> <unit>" or "Lot size <n>" is accepted, and the raw note is returned for the log.
    // { mode: 'Quantity'|'Lot'|null, size: number|null, note: string|null }
    async getLotInfo() {
        const nodes = await this.getPadNodes();
        const label = nodes.find(n => n.desc === 'Quantity' || n.desc === 'Lot');
        const textOf = n => n.desc || n.text;
        const isNote = n => n !== label && !/^Swap/i.test(n.desc) && /\blots?\b/i.test(textOf(n));
        const midY = n => (n.y1 + n.y2) / 2;
        // Prefer the note on the label's row (right of "Quantity"/"Lot"), else any lot note on the pad.
        const note = (label && nodes.find(n => isNote(n) && Math.abs(midY(n) - midY(label)) < 60))
            || nodes.find(n => isNote(n) && /=|size/i.test(textOf(n)));
        const t = note ? textOf(note).replace(/\n/g, ' ') : '';
        const m = t.match(/([\d,]+(?:\.\d+)?)\s*[A-Za-z]*\s*=\s*1\s*Lots?\b/i)
            || t.match(/\b1\s*Lots?\s*=\s*([\d,]+(?:\.\d+)?)/i)
            || t.match(/lot\s*size\s*[:=-]?\s*([\d,]+(?:\.\d+)?)/i);
        return { mode: label ? label.desc : null, size: m ? num(m[1]) : null, note: note ? t : null };
    }

    // Fallback when the note can't be parsed: the box shows one lot by default, so swapping modes
    // and dividing gives the lot size (Quantity value / Lot value). Leaves the box in its original mode.
    async deriveLotSizeBySwap(mode) {
        const before = num(await this.getQuantity());
        await this.click(this.lotQtySwap, 3000);
        await this.pause(800);
        const after = num(await this.getQuantity());
        await this.click(this.lotQtySwap, 3000);
        await this.pause(800);
        const [qty, lots] = mode === 'Lot' ? [after, before] : [before, after];
        const size = lots > 0 && Number.isFinite(qty / lots) ? qty / lots : null;
        console.log(`Lot size worked out by swapping: ${qty} Qty / ${lots} Lot = ${size}`);
        return size;
    }

    // Product chip state: present in the tree, and actionable (displayed + enabled). Some contracts
    // show Intraday but disabled (live: BFO SENSEX 19NOV 77100 CE, 6 days to expiry) - tapping it
    // times out, so callers skip the Intraday steps when it isn't actionable.
    async getProductState(product) {
        const sel = { Intraday: this.intradayOption, Delivery: this.deliveryOption, Carryforward: this.carryforwardOption }[product];
        try {
            const el = await this.driver.$(sel);
            if (!(await el.isExisting())) return { present: false, actionable: false };
            const enabled = await el.isEnabled().catch(() => false);
            const shown = await el.isDisplayed().catch(() => false);
            return { present: true, actionable: enabled && shown };
        } catch (_) {
            return { present: false, actionable: false };
        }
    }

    // Derivative pads open in Quantity mode. Quantity -> Lot: the label flips to "Lot" and the box
    // holds qty / lot size. Then the lot count is raised by 1 in Lot mode, and swapping back to
    // Quantity must show the quantity recalculated as (lots + 1) x lot size.
    // Returns the quantity now on the pad.
    async verifySwapQuantityToLotAndBack(qty, lotSize) {
        const lots = qty / lotSize;
        await this.click(this.lotQtySwap, 3000);
        await this.pause(800);
        const lotLabel = await this.isElementVisible(this.lotLabel, 3000);
        const lotText = await this.getQuantity();
        const lotOk = lotLabel && num(lotText) === lots;
        console.log(`Quantity swapped to Lot: label "Lot" ${lotLabel ? 'shown' : 'missing'}, field "${lotText}" = ${qty} / ${lotSize} (${lots} lot(s)): ${lotOk ? 'PASS' : 'FAIL'}`);

        const newLots = lots + 1;
        const margin = (await this.readMargins()).approxText;
        const typed = await this.setQuantity(newLots);
        await this.verifyApproxMarginMoved(margin, 'up', `lots ${lots} -> ${newLots}`);

        await this.click(this.lotQtySwap, 3000);
        await this.pause(800);
        const qtyLabel = await this.isElementVisible(this.quantityLabel, 3000);
        const qtyText = await this.getQuantity();
        const expected = newLots * lotSize;
        const qtyOk = qtyLabel && num(qtyText) === expected;
        console.log(`Swapped back to Quantity - updated automatically to ${newLots} lot(s) x ${lotSize}: label "Quantity" ${qtyLabel ? 'shown' : 'missing'}, field "${qtyText}" (expected ${expected}): ${qtyOk ? 'PASS' : 'FAIL'}`);
        return { ok: lotOk && typed && qtyOk, qty: num(qtyText) || expected };
    }

    // Same check for a pad that opens in Lot mode (`lots` in the box): Lot -> Quantity shows
    // lots x lot size, back to Lot, +1 lot, and Quantity must update to (lots + 1) x lot size.
    // Leaves the box in Quantity mode. Returns the quantity now on the pad.
    async verifySwapLotToQuantityAndBack(lots, lotSize) {
        const toQty = async (n, why) => {
            await this.click(this.lotQtySwap, 3000);
            await this.pause(800);
            const label = await this.isElementVisible(this.quantityLabel, 3000);
            const text = await this.getQuantity();
            const ok = label && num(text) === n * lotSize;
            console.log(`${why}: label "Quantity" ${label ? 'shown' : 'missing'}, field "${text}" = ${n} lot(s) x ${lotSize} (${n * lotSize}): ${ok ? 'PASS' : 'FAIL'}`);
            return { ok, qty: num(text) || n * lotSize };
        };
        const first = await toQty(lots, 'Lot swapped to Quantity');
        await this.click(this.lotQtySwap, 3000);
        await this.pause(800);
        const lotLabel = await this.isElementVisible(this.lotLabel, 3000);
        const lotText = await this.getQuantity();
        const backOk = lotLabel && num(lotText) === lots;
        console.log(`Swapped back to Lot: label "Lot" ${lotLabel ? 'shown' : 'missing'}, field "${lotText}" (expected ${lots}): ${backOk ? 'PASS' : 'FAIL'}`);
        const margin = (await this.readMargins()).approxText;
        const typed = await this.setQuantity(lots + 1);
        await this.verifyApproxMarginMoved(margin, 'up', `lots ${lots} -> ${lots + 1}`);
        const second = await toQty(lots + 1, `Swapped to Quantity - updated automatically to ${lots + 1} lot(s)`);
        return { ok: first.ok && backOk && typed && second.ok, qty: second.qty };
    }

    // Coordinate tap on an element's centre - the Market Depth icon and the Buy/Sell swap are
    // clickable="false" Views (the gesture is handled by a parent), so element click() is unreliable.
    async tapCentre(selector, timeout = 3000) {
        const el = await this.findElement(selector, timeout);
        const { x, y } = await el.getLocation();
        const { width, height } = await el.getSize();
        await this.tapNode({ x1: x, y1: y, x2: x + width, y2: y + height });
    }

    async verifyOrderTypeRegular() {
        const shown = await this.isElementVisible(this.regularLabel, 3000);
        console.log(`Order Type is Regular: ${shown ? 'PASS' : 'FAIL'}`);
        return shown;
    }

    // Product chips as actually labelled on this pad: Delivery/Intraday on equity, Carryforward/
    // Intraday on derivatives (Carryforward matched loosely - "Carry Forward" in some builds).
    async getProductLabels() {
        const descs = (await this.getPadNodes()).map(n => n.desc);
        return descs.filter(d => d === 'Delivery' || d === 'Intraday' || /^carry ?forward$/i.test(d))
            .filter((d, i, all) => all.indexOf(d) === i);
    }

    // `product` is 'Delivery', 'Intraday' or 'Carryforward'.
    async verifyProductSelected(product) {
        const labels = await this.getProductLabels();
        const label = labels.find(l => l.replace(/\s/g, '').toLowerCase() === product.toLowerCase()) || product;
        return this.verifyHighlighted(label, labels.length ? labels : ['Delivery', 'Intraday'], 'Product');
    }

    async selectProduct(product) {
        const sel = { Intraday: this.intradayOption, Delivery: this.deliveryOption, Carryforward: this.carryforwardOption }[product];
        await this.click(sel, 3000);
        await this.pause(800);
        console.log(`Tapped ${product}`);
        return this.verifyProductSelected(product);
    }

    // 'Limit' or 'Market' - taps the price swap only when the pad is on the other one.
    async setPriceType(type) {
        let mode = await this.getPriceMode();
        if (mode !== type) {
            await this.click(this.marketLimitSwap, 3000);
            await this.pause(800);
            mode = await this.getPriceMode();
        }
        console.log(`Price type set to ${type} (label reads "Price (${mode})"): ${mode === type ? 'PASS' : 'FAIL'}`);
        return mode === type;
    }

    // Closes the soft keyboard only if it is up - a bare back() with no keyboard would leave the pad.
    async hideKeyboardIfShown() {
        try {
            if (await this.driver.isKeyboardShown()) {
                await this.driver.hideKeyboard().catch(() => this.driver.back());
                await this.pause(400);
            }
        } catch (_) { /* isKeyboardShown unsupported - leave it */ }
    }

    // Same real-key typing as setPrice (see there for why), into an input found by its label.
    async typeIntoInput(input, value) {
        await this.tapNode(input);
        await this.pause(300);
        await this.driver.pressKeyCode(123); // KEYCODE_MOVE_END
        for (let i = 0; i < 15; i++) await this.driver.pressKeyCode(67); // KEYCODE_DEL
        await this.pause(200);
        for (const ch of String(value)) {
            await this.driver.keys(ch);
            await this.pause(60);
        }
        await this.pause(400);
        await this.hideKeyboardIfShown();
    }

    async setQuantity(value) {
        await this.click(this.quantityInput, 3000);
        await this.pause(300);
        await this.driver.pressKeyCode(123);
        for (let i = 0; i < 10; i++) await this.driver.pressKeyCode(67);
        for (const ch of String(value)) {
            await this.driver.keys(ch);
            await this.pause(60);
        }
        await this.pause(400);
        await this.hideKeyboardIfShown();
        const text = await this.getQuantity();
        const ok = num(text) === Number(value);
        console.log(`Entered ${value} in Quantity - field reads "${text}": ${ok ? 'PASS' : 'FAIL'}`);
        return ok;
    }

    // Approx Margin shows a refresh spinner while it recalculates - wait for the value to move off
    // `previous` rather than reading straight after an edit. Returns the new text (or the old one).
    async waitForApproxMarginChange(previous, timeout = 6000) {
        let current = previous;
        try {
            await this.driver.waitUntil(async () => {
                current = (await this.readMargins(1500)).approxText;
                return current !== null && current !== previous;
            }, { timeout, interval: 500 });
        } catch (_) { /* unchanged */ }
        return current;
    }

    // Logs and returns whether Approx Margin moved the expected way ('up', 'down' or 'change').
    // 'any' only logs the movement (derivative margins where the direction isn't fixed, e.g. a
    // futures/option-sell margin that doesn't track the limit price) and never fails.
    async verifyApproxMarginMoved(previous, direction, why) {
        const now = await this.waitForApproxMarginChange(previous, direction === 'any' ? 3000 : 6000);
        if (direction === 'any') {
            console.log(`Approx margin after ${why}: "${previous}" -> "${now}" (logged only - direction not fixed for this contract/side)`);
            return { ok: true, text: now };
        }
        const before = num(previous), after = num(now);
        const ok = direction === 'up' ? after > before : direction === 'down' ? after < before : after !== before;
        console.log(`Approx margin after ${why}: "${previous}" -> "${now}" (expected ${direction === 'change' ? 'a change' : direction}): ${ok ? 'PASS' : 'FAIL'}`);
        return { ok, text: now };
    }

    // Quantity -> Amount: the label flips to "Amount" and the box holds the price rounded up to the
    // next whole rupee, times the quantity (live: 1 x 7.05 -> "8.00", 2 x 7.05 -> "16.00"), so it is always more than the LTP.
    async verifySwapToAmount(qty, price, ltp) {
        await this.click(this.qtyAmountSwap, 3000);
        await this.pause(800);
        const labelOk = await this.isElementVisible(this.amountLabel, 3000);
        console.log(`Quantity label changed to Amount: ${labelOk ? 'PASS' : 'FAIL'}`);
        const text = await this.getQuantity();
        const amount = num(text);
        const expected = qty * Math.ceil(price);
        const roundOk = Number.isInteger(amount) && amount === expected;
        const aboveLtp = amount > ltp;
        console.log(`Amount "${text}" is ${qty} x ${price} rounded up to ${Math.ceil(price)} (${expected}): ${roundOk ? 'PASS' : 'FAIL'}`);
        console.log(`Amount ${amount} is greater than LTP ${ltp}: ${aboveLtp ? 'PASS' : 'FAIL'}`);
        return labelOk && roundOk && aboveLtp;
    }

    async swapBackToQuantity() {
        await this.click(this.qtyAmountSwap, 3000);
        await this.pause(800);
        const ok = await this.isElementVisible(this.quantityLabel, 3000);
        console.log(`Swapped back to Quantity (reads "${await this.getQuantity()}"): ${ok ? 'PASS' : 'FAIL'}`);
        return ok;
    }

    // Opens the Market Depth bottom sheet from the icon inside the price box, then closes it with a
    // single back press and checks the pad (not the Quote) is what's left.
    async verifyMarketDepthOpensAndCloses() {
        await this.tapCentre(this.marketDepthButton);
        const shown = await this.isElementVisible(this.marketDepthHeading, 4000);
        const rows = shown ? (await this.getPadNodes()).filter(n => /^(Bid|Ask)$/.test(n.desc)).length : 0;
        console.log(`Market Depth sheet displayed at the bottom (heading + ${rows}/2 Bid/Ask headers): ${shown && rows === 2 ? 'PASS' : 'FAIL'}`);
        await this.driver.back();
        await this.pause(800);
        const closed = !(await this.isElementVisible(this.marketDepthHeading, 1000));
        const stillOnPad = await this.isDisplayed(3000);
        console.log(`Market Depth closed with one back press, Order Pad still shown: ${closed && stillOnPad ? 'PASS' : 'FAIL'}`);
        return shown && rows === 2 && closed && stillOnPad;
    }

    // Limit -> Market: label reads "Price (Market)" and the (now disabled) box reads 0.
    async verifySwapToMarket() {
        await this.click(this.marketLimitSwap, 3000);
        await this.pause(800);
        const mode = await this.getPriceMode();
        const box = await this.getInputBelow(/^Price \(/);
        const text = box ? box.text : null;
        const ok = mode === 'Market' && text !== null && text !== '' && num(text) === 0;
        console.log(`Price swapped to Market with 0 in the price field (label "${mode}", field "${text}"${box && !box.enabled ? ', disabled' : ''}): ${ok ? 'PASS' : 'FAIL'}`);
        return ok;
    }

    // Toggle on -> "Trigger Price" box appears, empty with its "0.00" placeholder.
    async verifyStoplossToggleShowsTrigger() {
        await this.click(this.stoplossToggle, 3000);
        await this.pause(800);
        const labelOk = await this.isElementVisible(this.triggerPriceLabel, 3000);
        const box = labelOk ? await this.getInputBelow(/^Trigger Price$/) : null;
        const shownValue = box ? (box.text || box.hint) : null;
        const ok = labelOk && !!box && num(shownValue) === 0 && /^0(\.00)?$/.test(shownValue);
        console.log(`Stoploss Trigger Price box displayed with 0.00 (text "${box && box.text}", placeholder "${box && box.hint}"): ${ok ? 'PASS' : 'FAIL'}`);
        return ok;
    }

    async setTriggerPrice(value) {
        const box = await this.getInputBelow(/^Trigger Price$/);
        if (!box) {
            console.log('Trigger Price box not found: FAIL');
            return false;
        }
        await this.typeIntoInput(box, value);
        const after = await this.getInputBelow(/^Trigger Price$/);
        const ok = !!after && num(after.text) === Number(value);
        console.log(`Entered ${value} in Trigger Price - field reads "${after && after.text}": ${ok ? 'PASS' : 'FAIL'}`);
        return ok;
    }

    // Expands More, scrolls the pad up so Validity/Disclosed Qty are clear of the margin bar.
    async expandMore() {
        await this.click(this.moreCollapsed, 3000);
        await this.pause(800);
        const expanded = await this.isElementVisible(this.moreExpanded, 3000);
        await this.swipe('down');
        await this.pause(800);
        console.log(`More expanded: ${expanded ? 'PASS' : 'FAIL'}`);
        return expanded;
    }

    // Validity chips sit in the row(s) between the "Validity" label and "Disclosed Qty" (live: just
    // "Day" for RTNPOWER, Limit or Market). Taps each non-default option, checks it highlights,
    // then reselects the default and checks that highlights again.
    async verifyValidityOptions() {
        const nodes = await this.getPadNodes();
        const label = nodes.find(n => n.desc === 'Validity');
        if (!label) {
            console.log('Validity field displayed: FAIL');
            return false;
        }
        const stop = nodes.find(n => n.desc === 'Disclosed Qty');
        const options = nodes
            .filter(n => n.clickable && n.desc && n.y1 >= label.y2 && (!stop || n.y2 <= stop.y1) && n.y1 - label.y2 < 300)
            .map(n => n.desc);
        const names = [...new Set(options)];
        console.log(`Validity field displayed with option(s) ${names.join(', ') || 'none'}: ${names.length ? 'PASS' : 'FAIL'}`);
        if (!names.length) return false;

        const { selected: def, scores } = await this.getHighlightedOption(names);
        console.log(`Default validity: ${def || 'none clear'} (blue px ${scores}): ${def ? 'PASS' : 'FAIL'}`);
        let ok = !!def;
        const tapAndCheck = async name => {
            const n = (await this.getPadNodes()).find(x => x.desc === name);
            await this.tapNode(n);
            await this.pause(700);
            return this.verifyHighlighted(name, names, `Validity after tapping ${name}`);
        };
        for (const name of names.filter(n => n !== def)) ok = (await tapAndCheck(name)) && ok;
        if (def) ok = (await tapAndCheck(def)) && ok;
        if (names.length === 1) console.log(`Only "${names[0]}" validity offered - reselected it`);
        return ok;
    }

    // "If applicable": absent label -> logged as not offered, not a failure.
    async enterDisclosedQty(value = 1) {
        const box = await this.getInputBelow(/^Disclosed Qty$/);
        if (!box) {
            console.log('Disclosed Qty not offered for this order - skipped');
            return true;
        }
        await this.typeIntoInput(box, value);
        const after = await this.getInputBelow(/^Disclosed Qty$/);
        const ok = !!after && num(after.text) === Number(value);
        console.log(`Entered ${value} in Disclosed Qty - field reads "${after && after.text}": ${ok ? 'PASS' : 'FAIL'}`);
        return ok;
    }

    // MTF checkbox above the BUY button - only for NSE BUY on MTF-eligible symbols. NOT YET SEEN
    // LIVE (RTNPOWER doesn't offer it), so it's matched loosely on "MTF" in its desc or text.
    async findMtfNode() {
        return (await this.getPadNodes()).find(n => /\bMTF\b/i.test(n.desc) || /\bMTF\b/i.test(n.text)) || null;
    }

    // ---- Confirmation Preview -> Applicable Charges -> Brokerage ----

    // Taps PROCEED on a surveillance warning if one is up. Returns whether it was shown.
    async proceedPastSurveillanceIfShown() {
        if (!(await this.isElementVisible(this.surveillanceWarning, 1500))) return false;
        const msg = await (await this.driver.$(this.surveillanceWarning)).getAttribute('content-desc').catch(() => '');
        console.log(`Surveillance warning shown: "${(msg || '').split('\n')[0]}" - tapping PROCEED (opens the Confirmation Preview only)`);
        await this.click(this.surveillanceProceed, 3000);
        await this.pause(800);
        return true;
    }

    // The panel's lines between "Brokerage and Charges" and the Disclaimer, as { label: value }
    // pairs (a label is any line followed by a number). Polled: values render after the labels
    // (Regression R26), so it waits until Brokerage has a value or an error is shown.
    async readChargesPanel(timeout = 6000) {
        const isNumber = d => /^-?₹?\s*\d[\d,]*(\.\d+)?$/.test(d);
        const isError = d => /something went wrong|error|failed|unable to|try again|not available|no data/i.test(d);
        let result = { lines: [], charges: {}, errors: [] };
        const deadline = Date.now() + timeout;
        do {
            const descs = (await this.getDescribedElements()).map(n => n.desc.trim());
            const start = descs.indexOf('Brokerage and Charges');
            const end = descs.findIndex(d => d.startsWith('Disclaimer'));
            const lines = start === -1 ? [] : descs.slice(start + 1, end === -1 ? undefined : end).filter(d => d !== 'Scrim');
            const charges = {};
            lines.forEach((d, i) => { if (!isNumber(d) && isNumber(lines[i + 1] || '')) charges[d] = lines[i + 1]; });
            result = { lines, charges, errors: lines.filter(isError) };
            if (charges.Brokerage !== undefined || result.errors.length) break;
            await this.pause(750);
        } while (Date.now() < deadline);
        return result;
    }

    // From the Order Pad: taps its own BUY/SELL, checks the Confirmation Preview carries the
    // expected side/order type/product, opens Applicable Charges and checks Brokerage is shown
    // with a value (every other charge is logged). Then backs out panel -> popup -> Order Pad.
    // CONFIRM is never tapped, so nothing is placed. `product` is Delivery/Intraday/Carryforward,
    // `priceType` Limit/Market. Returns true only if Brokerage was displayed.
    async verifyBrokerageOnConfirmation({ side, priceType, product }) {
        const label = `${side.toUpperCase()} ${priceType} ${product}`;
        let ok = false;
        try {
            await this.click(side === 'Sell' ? this.sellIndicator : this.buyIndicator, 3000);
            console.log(`Clicked ${side.toUpperCase()} on the Order Pad (opens the Confirmation Preview only)`);
            await this.proceedPastSurveillanceIfShown();
            const outcome = await this.waitForBuyOutcome();
            if (outcome.outcome !== 'confirmation') {
                console.log(`[${label}] Confirmation Preview displayed: FAIL (${outcome.outcome === 'dpr' ? `DPR error "${outcome.message}"` : 'nothing appeared'})`);
                return false;
            }
            console.log(`[${label}] Confirmation Preview displayed: PASS`);

            const details = await this.getConfirmationDetails();
            console.log(`Confirmation Preview: ${JSON.stringify(details)}`);
            const same = (a, b) => String(a || '').replace(/\s/g, '').toLowerCase() === String(b).replace(/\s/g, '').toLowerCase();
            for (const [field, expected] of [['Order Action', side], ['Order Type', priceType], ['Product Type', product]]) {
                console.log(`Confirmation ${field} "${details[field]}" is ${expected}: ${same(details[field], expected) ? 'PASS' : 'FAIL'}`);
            }

            await this.click(this.applicableChargesLink, 3000);
            const panel = await this.isElementVisible(this.chargesHeading, 5000);
            console.log(`[${label}] Applicable Charges opened ("Brokerage and Charges" panel): ${panel ? 'PASS' : 'FAIL'}`);
            if (!panel) return false;

            const { charges, errors, lines } = await this.readChargesPanel();
            console.log(`Charges: ${Object.entries(charges).map(([k, v]) => `${k} = ${v}`).join(', ') || `(none parsed; panel reads: ${lines.join(' | ')})`}`);
            if (errors.length) console.log(`[${label}] Applicable Charges shows an error ("${errors.join(' | ')}"): FAIL`);
            ok = charges.Brokerage !== undefined && !errors.length;
            console.log(`[${label}] Brokerage displayed (${charges.Brokerage !== undefined ? `₹ ${charges.Brokerage}` : 'not shown'}): ${ok ? 'PASS' : 'FAIL'}`);
            return ok;
        } finally {
            // One back per open layer (charges panel, then popup) - never more, so a stray back
            // can't leave the Order Pad. Nothing here confirms the order.
            for (let i = 0; i < 3; i++) {
                if (await this.isElementVisible(this.chargesHeading, 800)) await this.driver.back();
                else if (await this.isElementVisible(this.confirmationHeading, 800)) await this.driver.back();
                else break;
                await this.pause(700);
            }
            const onPad = await this.isDisplayed(3000);
            console.log(`[${label}] Closed Applicable Charges and the Confirmation Preview without confirming - back on the Order Pad: ${onPad ? 'PASS' : 'FAIL'}`);
        }
    }

    // `from` is the side the pad is on ('Buy' or 'Sell'): swaps to the other side and back, checking
    // the bottom button follows each time. With `mtfWasShown` (a BUY pad that offered MTF) it also
    // checks MTF disappears on the SELL side.
    async verifyBuySellSwap({ from = 'Buy', mtfWasShown = false } = {}) {
        const sel = side => (side === 'Buy' ? this.buyIndicator : this.sellIndicator);
        const to = from === 'Buy' ? 'Sell' : 'Buy';
        const swapTo = async (side, other) => {
            await this.tapCentre(this.buySellSwap);
            await this.pause(800);
            const shown = await this.isElementVisible(sel(side), 3000);
            const otherGone = !(await this.isElementVisible(sel(other), 1000));
            console.log(`Buy/Sell swap changed ${other.toUpperCase()} to ${side.toUpperCase()}: ${shown && otherGone ? 'PASS' : 'FAIL'}`);
            return shown && otherGone;
        };
        let ok = await swapTo(to, from);
        if (mtfWasShown && to === 'Sell') {
            const mtfOnSell = !!(await this.findMtfNode());
            console.log(`MTF hidden on a SELL order: ${mtfOnSell ? 'FAIL (still displayed)' : 'PASS'}`);
            ok = ok && !mtfOnSell;
        }
        return (await swapTo(from, to)) && ok;
    }
}

module.exports = OrderPadPage;
