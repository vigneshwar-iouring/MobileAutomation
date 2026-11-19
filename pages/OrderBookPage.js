const fs = require('fs');
const path = require('path');
const BasePage = require('./BasePage');

// Order Book (bottom-nav "Orders" -> "Regular" tab), DriverManager stack. Read-only: never taps
// Cancel All / Convert to Market / Modify / Cancel - an order row is only tapped to open its
// details popup, which is closed with back.
// From a real dump (ui_dumps/cds_after_mover_tap.xml):
//   - top tabs "Regular\nTab 1 of 2" / "Basket\nTab 2 of 2";
//   - status tabs are Buttons whose whole label is merged into one content-desc,
//     "There are N <ALL|Pending|Executed|Cancelled> orders, Double Tap to view ... orders" - the
//     count is in there even when it's 0, so the a11y tree can't tell whether a badge is drawn;
//   - order rows: " BUY order for RTNPOWER. Status: Rejected. Quantity: 0 of 1. Price: 5.68, ...".
// The empty-state text uses a curly apostrophe ("don’t"), so matching normalises both forms.
const TABS = ['ALL', 'Pending', 'Executed', 'Cancelled'];

class OrderBookPage extends BasePage {
    constructor(driver) {
        super(driver);
        this.ordersNavButton = 'android=new UiSelector().className("android.widget.ImageView").description("Orders")';
        this.regularTab = 'android=new UiSelector().descriptionStartsWith("Regular")';
        this.tabs = TABS;
    }

    // The four status tabs as { name, count, node } - null when the tab row isn't on screen.
    async getStatusTabs() {
        const nodes = await this.getDescribedElements();
        const tabs = [];
        for (const name of TABS) {
            const re = new RegExp(`^There are (\\d+) ${name} orders`, 'i');
            const node = nodes.find(n => re.test(n.desc));
            if (!node) return null;
            tabs.push({ name, count: Number(node.desc.match(re)[1]), node });
        }
        return tabs;
    }

    async isOnOrderBook(timeout = 3000) {
        try {
            await this.driver.waitUntil(async () => !!(await this.getStatusTabs()), { timeout, interval: 500 });
            return true;
        } catch (_) {
            return false;
        }
    }

    async clickOrdersNav(timeout = 8000) {
        await this.click(this.ordersNavButton, timeout);
        console.log('Clicked Orders in the bottom navigation');
    }

    // Orders can reopen on its Basket tab - make sure Regular (the Order Book) is selected.
    async selectRegularTab() {
        const el = await this.driver.$(this.regularTab);
        if (!(await el.isExisting())) return false;
        if ((await el.getAttribute('selected')) !== 'true') {
            await el.click();
            await this.pause(1000);
            console.log('Switched Orders to the Regular tab');
        }
        return true;
    }

    // The status-tab Buttons report clickable="false", so tap the centre of their bounds.
    async tapStatusTab(name) {
        const tab = ((await this.getStatusTabs()) || []).find(t => t.name === name);
        if (!tab) throw new Error(`"${name}" tab not found on the Order Book`);
        await this.tapNode(tab.node);
        await this.pause(1500);
    }

    async getTabCount(name) {
        const tab = ((await this.getStatusTabs()) || []).find(t => t.name === name);
        return tab ? tab.count : null;
    }

    async getOrderRows() {
        return (await this.getDescribedElements())
            .map(n => n.desc.trim())
            .filter(d => /^(BUY|SELL) order for /i.test(d));
    }

    // Every order row in the current tab, scrolling down until no new rows appear, then back to
    // the top. Rows are de-duplicated by their content-desc (each screen overlaps the last), so
    // two orders with identical text count once - this can only under-count, never over-count.
    async collectAllOrderRows(maxScrolls = 15) {
        const seen = new Set(await this.getOrderRows());
        let scrolls = 0;
        for (; scrolls < maxScrolls; scrolls++) {
            const before = seen.size;
            await this.swipe('down');
            await this.pause(700);
            (await this.getOrderRows()).forEach(r => seen.add(r));
            if (seen.size === before) break;
        }
        for (let i = 0; i <= scrolls; i++) {
            await this.swipe('up');
            await this.pause(400);
        }
        return [...seen];
    }

    // Order rows parsed into { raw, action, symbol, status, filledQty, totalQty, price } - same
    // row grammar as the Regression Orderbook page (symbol can hold spaces, price comma groups).
    async getParsedOrderRows() {
        return (await this.getOrderRows()).map(raw => {
            const m = raw.match(/^(BUY|SELL) order for (.+?)\.\s*Status:\s*([A-Za-z ]+?)\.\s*Quantity:\s*(\d+)\s*of\s*(\d+)\.\s*Price:\s*([\d,]+(?:\.\d+)?)/i);
            return m
                ? { raw, action: m[1].toUpperCase(), symbol: m[2].trim(), status: m[3].trim(), filledQty: Number(m[4]), totalQty: Number(m[5]), price: Number(m[6].replace(/,/g, '')) }
                : { raw };
        });
    }

    // Polls the ALL tab for a row matching `predicate`. The list can lag the order (Regression
    // saw the tab count update while the rows stayed stale), so every 4th poll it reloads the
    // list by switching Pending -> ALL, and finally scrolls down through the list once.
    async findOrderRow(predicate, timeout = 30000) {
        const end = Date.now() + timeout;
        for (let polls = 1; Date.now() < end; polls++) {
            const row = (await this.getParsedOrderRows()).find(predicate);
            if (row) return row;
            if (polls % 4 === 0) {
                console.log('Order not listed yet - reloading the ALL tab (Pending -> ALL)');
                await this.tapStatusTab('Pending');
                await this.tapStatusTab('ALL');
            } else {
                await this.pause(1000);
            }
        }
        for (let i = 0; i < 5; i++) {
            await this.swipe('down');
            await this.pause(700);
            const row = (await this.getParsedOrderRows()).find(predicate);
            if (row) return row;
        }
        return null;
    }

    // ---- Order status popup shown after CONFIRM ----
    // Not captured in a UI dump yet, so it is matched loosely: a status word (Placed, Queued,
    // Scheduled, Failed, Rejected) anywhere in its text, plus "Close" / "View Order Book"
    // buttons. Every popup seen is saved to ui_dumps/orderbook_status_popup.xml so these
    // matchers can be tightened against the real screen.
    async readOrderStatusPopup(timeout = 10000) {
        const STATUS_RE = /\b(placed|queued|scheduled|failed|rejected)\b/i;
        // On 2026-11-19 (live NSE order) nothing was found within 10s and the app was already back
        // on the Quote screen - the popup is either skipped on the fast path (the Regression
        // suite sees the same) or only shown briefly. So: one page-source fetch per poll every
        // 200ms (instead of two), and android.widget.Toast text counts too.
        let popup = null;
        const decode = s => s.replace(/&#10;/g, '\n').replace(/&quot;/g, '"').replace(/&apos;/g, "'")
            .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&');
        try {
            await this.driver.waitUntil(async () => {
                const src = await this.driver.getPageSource();
                const texts = [];
                for (const tag of src.match(/<[\w.]+[^>]*>/g) || []) {
                    const b = tag.match(/bounds="\[(-?\d+),(-?\d+)\]\[(-?\d+),(-?\d+)\]"/);
                    const node = b ? { x1: +b[1], y1: +b[2], x2: +b[3], y2: +b[4] } : null;
                    for (const attr of ['content-desc', 'text']) {
                        const m = tag.match(new RegExp(`\\s${attr}="([^"]+)"`));
                        if (m) texts.push({ label: decode(m[1]).trim(), node, toast: /android\.widget\.Toast/.test(tag) });
                    }
                }
                const statusHit = texts.find(t => STATUS_RE.test(t.label));
                const close = texts.find(t => /^close$/i.test(t.label));
                const viewOrderBook = texts.find(t => /^view order ?book$/i.test(t.label));
                if (!statusHit && !close && !viewOrderBook) return false;
                popup = {
                    status: statusHit ? statusHit.label.match(STATUS_RE)[1].replace(/^./, c => c.toUpperCase()) : null,
                    message: statusHit ? statusHit.label.replace(/\s+/g, ' ') : null,
                    close: close ? close.node : null,
                    viewOrderBook: viewOrderBook ? viewOrderBook.node : null,
                };
                return true;
            }, { timeout, interval: 200 });
        } catch (_) { /* nothing appeared */ }
        await this.dumpPageSource('orderbook_status_popup');
        return popup;
    }

    // ---- Order details popup (tap an order row) ----
    // From a real dump (ui_dumps/orderbook_detail_probe.xml, a Cancelled NFO order) - every field
    // is its own "Label: value" content-desc node:
    //   "BUY order details. Status: Cancelled. Order time: 13:16:02. Quantity: 0 of 65."
    //   "Stock name: NIFTY 23NOV 27900 CE" | "Order Price: 0.40"
    //   "Exchange: NFO. Product: CARRY FORWARD. Order Type: LMT."
    //   "Avg Price: 0.00" | "Traded Value: 0.00" | "Order Value: 26.00" | "Trigger Price: 0.00"
    //   "Order ID: OLPSL00020C;" | "Order Time: 13:15:51" | "Disclosed Qty: 0"
    //   "Exchange Order Number: 1500000118176907" | "Exchange Order Time: 19-11-2026 13:16:02"
    // plus action buttons at the bottom: "Repeat Order, ..." for a closed order; "Modify Order,
    // Double tap to modify this order" / "Cancel Order, Double tap to cancel this order" for a
    // pending one (ui_dumps/orderbook_order_details.xml, live NSE order 2026-11-19). The order
    // time in the Order Book row itself is drawn on screen (e.g. "PENDING BUY 14:27:49 0/1") but
    // NOT exposed in its content-desc (" BUY order for X. Status: ... Price: ..., Double tap ...").

    // The on-screen row node whose (trimmed) content-desc is `raw`.
    async findRowNode(raw) {
        return (await this.getDescribedElements()).find(n => n.desc.trim() === raw) || null;
    }

    // A time ("13:16" / "13:16:02") in an Order Book row's label, or null - current builds don't
    // expose it (see above), so callers must treat null as "not readable", not as a mismatch.
    rowTime(raw) {
        const m = String(raw || '').match(/\b(\d{1,2}:\d{2}(?::\d{2})?)\b/);
        return m ? m[1] : null;
    }

    // Taps the row and waits for the details popup. The row Buttons report clickable="false", so
    // the centre of their bounds is tapped. Read-only: only opens the popup.
    async openOrderDetails(raw, timeout = 8000) {
        const node = await this.findRowNode(raw);
        if (!node) throw new Error(`Order row not on screen: "${raw}"`);
        await this.tapNode(node);
        try {
            await this.driver.waitUntil(async () => !!(await this.readOrderDetails()), { timeout, interval: 500 });
        } catch (_) { /* reported below */ }
        await this.dumpPageSource('orderbook_order_details');
        return this.readOrderDetails();
    }

    // The open details popup as { action, status, headerTime, filledQty, totalQty, fields, buttons }
    // - `fields` maps every "Label: value" in the popup (e.g. fields['Order ID']), `buttons` holds
    // the Modify / Cancel / Repeat Order nodes (or null). Returns null when no popup is open.
    async readOrderDetails() {
        const nodes = await this.getDescribedElements();
        const header = nodes.find(n => /^(BUY|SELL) order details\./i.test(n.desc.trim()));
        if (!header) return null;
        const h = header.desc.trim().match(/^(BUY|SELL) order details\.\s*Status:\s*([^.]+)\.\s*Order time:\s*([\d:]+)\.\s*Quantity:\s*(\d+)\s*of\s*(\d+)/i) || [];

        const fields = {};
        for (const n of nodes) {
            if (n === header || /double tap/i.test(n.desc)) continue;
            // "Exchange: NFO. Product: CARRY FORWARD. Order Type: LMT." holds several pairs.
            for (const part of n.desc.trim().split(/\.\s+(?=[A-Z][A-Za-z ]*:)/)) {
                const m = part.match(/^([A-Z][A-Za-z ]*?):\s*(.*)$/);
                if (m) fields[m[1].trim()] = m[2].trim().replace(/[.;]+$/, '');
            }
        }
        const button = re => nodes.find(n => re.test(n.desc.trim())) || null;
        return {
            action: h[1] ? h[1].toUpperCase() : null,
            status: h[2] ? h[2].trim() : null,
            headerTime: h[3] || null,
            filledQty: h[4] !== undefined ? Number(h[4]) : null,
            totalQty: h[5] !== undefined ? Number(h[5]) : null,
            fields,
            buttons: {
                modify: button(/^modify\b/i),
                cancel: button(/^cancel(\b(?!led))/i),
                repeat: button(/^repeat order\b/i),
            },
            raw: header.desc.trim(),
        };
    }

    // Closes the details popup with back (never taps Modify / Cancel) and waits for the list.
    async closeOrderDetails() {
        if (await this.readOrderDetails()) {
            await this.driver.back();
            await this.pause(1000);
        }
        return this.isOnOrderBook(5000);
    }

    async dumpPageSource(name) {
        try {
            const src = await this.driver.getPageSource();
            const file = path.join(__dirname, '..', 'ui_dumps', `${name}.xml`);
            fs.mkdirSync(path.dirname(file), { recursive: true });
            fs.writeFileSync(file, src);
            console.log(`Saved UI dump: ui_dumps/${name}.xml`);
        } catch (e) {
            console.log(`Could not save UI dump ${name}: ${e.message}`);
        }
    }

    // The "You don't have any ... orders" text on screen (content-desc or text), or null.
    async getEmptyMessage() {
        const nodes = [
            ...(await this.getDescribedElements()).map(n => n.desc),
            ...(await this.getTextElements()).map(n => n.text),
        ];
        const hit = nodes.find(t => /you don['’]t have any/i.test(t));
        return hit ? hit.replace(/\s+/g, ' ').trim() : null;
    }

    // "ALL" -> "You don't have any orders"; others -> "You don't have any <Tab> orders".
    expectedEmptyMessage(name) {
        return name === 'ALL' ? "You don't have any orders" : `You don't have any ${name} orders`;
    }

    // Case-insensitive, curly/straight apostrophe agnostic comparison.
    emptyMessageMatches(actual, name) {
        const norm = s => (s || '').replace(/[’‘]/g, "'").replace(/\s+/g, ' ').trim().toLowerCase();
        // includes(), not ===: the node may carry a second line under the message.
        return norm(actual).includes(norm(this.expectedEmptyMessage(name)));
    }
}

module.exports = OrderBookPage;
