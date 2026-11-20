const fs = require('fs');
const path = require('path');
const BasePage = require('./BasePage');

// Order Book (bottom-nav "Orders" -> "Regular" tab), DriverManager stack. Reading is passive (an
// order row is only tapped to open its details popup, closed with back); the Modify / Cancel /
// Cancel All / Convert to Market methods below act on REAL orders and are only called by tests
// that mean to. Nothing here ever answers Yes on a Convert to Market confirmation.
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
        return (await this.getOrderRows()).map(raw => this.parseOrderRow(raw));
    }

    parseOrderRow(raw) {
        const m = raw.match(/^(BUY|SELL) order for (.+?)\.\s*Status:\s*([A-Za-z ]+?)\.\s*Quantity:\s*(\d+)\s*of\s*(\d+)\.\s*Price:\s*([\d,]+(?:\.\d+)?)/i);
        return m
            ? { raw, action: m[1].toUpperCase(), symbol: m[2].trim(), status: m[3].trim(), filledQty: Number(m[4]), totalQty: Number(m[5]), price: Number(m[6].replace(/,/g, '')) }
            : { raw };
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
    // Captured once, after a Modify (2026-11-19): separate content-desc nodes "Rejected",
    // "2 X RTNPOWER", "View Orderbook", "Close". After a fresh order it was not seen (the app went
    // straight back to the Quote). Still matched loosely: a status word (Placed, Queued,
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

    // ---- Cancel order (order details -> Cancel -> Yes -> OK) ----
    // Confirmation, live 2026-11-19 (ui_dumps/probe_cancel_dialog.xml): the details sheet shrinks
    // to a summary (PENDING / BUY / symbol / Order Price / NSE DELIVERY LMT) with
    // "Are you sure you want to cancel this order?" and "No" / "Yes" buttons. After Yes the same
    // summary shows "Order submitted for cancellation" with an "OK" button
    // (ui_dumps/orderbook_cancel_ok_popup.xml); the order then turns Cancelled on its own.

    // Taps Cancel on the open details and waits for the confirmation. Returns { question, yes, no }
    // (nodes) or null when the dialog did not appear. Does not answer it.
    async tapCancelOnDetails(od, timeout = 6000) {
        await this.tapNode(od.buttons.cancel);
        let dialog = null;
        try {
            await this.driver.waitUntil(async () => {
                const nodes = await this.getDescribedElements();
                const question = nodes.find(n => /sure you want to cancel/i.test(n.desc));
                if (!question) return false;
                dialog = {
                    question,
                    yes: nodes.find(n => /^yes$/i.test(n.desc.trim())) || null,
                    no: nodes.find(n => /^no$/i.test(n.desc.trim())) || null,
                };
                return true;
            }, { timeout, interval: 400 });
        } catch (_) { /* no dialog */ }
        await this.dumpPageSource('orderbook_cancel_dialog');
        return dialog;
    }

    // Taps No - nothing is cancelled. Live 2026-11-19 this closes the whole details sheet, back to
    // the Order Book list. Returns whether the confirmation is gone.
    async answerCancelNo(dialog) {
        await this.tapNode(dialog.no);
        await this.pause(1500);
        return !(await this.getDescribedElements()).some(n => /sure you want to cancel/i.test(n.desc));
    }

    // Taps Yes (CANCELS the real order), waits for the OK popup and taps OK. Returns
    // { okShown, message }.
    async confirmCancelAndAcknowledge(dialog, timeout = 10000) {
        await this.tapNode(dialog.yes);
        let ok = null;
        let message = null;
        try {
            await this.driver.waitUntil(async () => {
                const texts = [
                    ...(await this.getDescribedElements()).map(n => ({ label: n.desc.trim(), node: n })),
                    ...(await this.getTextElements()).map(n => ({ label: n.text.trim(), node: n })),
                ];
                const okHit = texts.find(t => /^ok(ay)?$/i.test(t.label));
                if (!okHit) return false;
                ok = okHit.node;
                // The popup's message: the text nearest above the OK button.
                const above = texts.filter(t => t.node.y2 <= ok.y1 && t.label && !/^(scrim|ok)$/i.test(t.label) && ok.y1 - t.node.y2 < 600);
                above.sort((a, b) => b.node.y2 - a.node.y2);
                message = above.length ? above.slice(0, 2).reverse().map(t => t.label.replace(/\s+/g, ' ')).join(' | ') : null;
                return true;
            }, { timeout, interval: 300 });
        } catch (_) { /* no OK popup */ }
        await this.dumpPageSource('orderbook_cancel_ok_popup');
        if (ok) {
            await this.tapNode(ok);
            await this.pause(1500);
        }
        return { okShown: !!ok, message };
    }

    // Closes the details popup with back (never taps Modify / Cancel) and waits for the list.
    async closeOrderDetails() {
        if (await this.readOrderDetails()) {
            await this.driver.back();
            await this.pause(1000);
        }
        return this.isOnOrderBook(5000);
    }

    // ---- Bulk actions on the Pending tab: Cancel All / Convert to Market selection mode ----
    // Live (ui_dumps/probe_cancel_after_no.xml): above the Pending list sit
    //   "Cancel All, Double tap to enter cancel selection mode" and
    //   "Convert to Market, Double tap to enter convert to market selection mode".
    // The selection mode itself (row checkboxes, Select All, Convert / Clear All / Cancel All
    // actions, the Yes / No confirmation) has not been captured yet, so it is matched loosely -
    // checkboxes by checkable="true", buttons by label in content-desc or text - and every screen
    // is dumped (ui_dumps/orderbook_bulk_*.xml) so the matchers can be tightened.

    // Every node with a label or a checkable state: { desc, text, label, cls, checkable, checked, ... }.
    async getAllNodes() {
        const src = await this.driver.getPageSource();
        const decode = s => s.replace(/&#10;/g, '\n').replace(/&quot;/g, '"').replace(/&apos;/g, "'")
            .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&');
        const nodes = [];
        for (const tag of src.match(/<[\w.]+[^>]*>/g) || []) {
            const b = tag.match(/bounds="\[(-?\d+),(-?\d+)\]\[(-?\d+),(-?\d+)\]"/);
            if (!b) continue;
            const attr = name => { const m = tag.match(new RegExp(`\\s${name}="([^"]*)"`)); return m ? decode(m[1]) : ''; };
            const desc = attr('content-desc').trim();
            const text = attr('text').trim();
            const checkable = attr('checkable') === 'true';
            if (!desc && !text && !checkable) continue;
            nodes.push({
                desc, text, label: desc || text,
                cls: (tag.match(/^<([\w.]+)/) || [])[1] || '',
                checkable, checked: attr('checked') === 'true',
                x1: +b[1], y1: +b[2], x2: +b[3], y2: +b[4],
            });
        }
        return nodes;
    }

    // The bulk-mode entry buttons above the Pending list ({ cancelAll, convert } nodes or null).
    async getBulkButtons() {
        const nodes = await this.getAllNodes();
        return {
            cancelAll: nodes.find(n => /enter cancel selection mode/i.test(n.desc))
                || nodes.find(n => /^cancel all\b/i.test(n.label)) || null,
            convert: nodes.find(n => /enter convert to market selection mode/i.test(n.desc))
                || nodes.find(n => /^convert to market\b/i.test(n.label)) || null,
        };
    }

    // Selection-mode state. Live (ui_dumps/orderbook_bulk_convert_mode.xml, 2026-11-20) there are
    // no checkable nodes - the checkbox state is in each row's label:
    //   "Not selected BUY order for IDEA. Status: Pending. ... , Double tap to select order"
    //   ("Selected BUY order for ..." once ticked), plus
    //   "Select All, Double tap to select all orders" above the list,
    //   "0/5 Order(s) will be converted and placed at Market price" (the selected / total counter),
    //   bottom bar "Cancel, Double tap to exit selection mode" | "Convert 0 selected orders to market, ...".
    // Returns { selectAll, clear, exit: nodes|null, counter: { selected, total }|null,
    // boxes: [{ node, checked, label }] } - boxes are fully drawn rows only (a row clipped under
    // the header is skipped so its tap can't land on the header).
    async getSelectionState() {
        const nodes = await this.getAllNodes();
        const boxes = nodes
            .filter(n => /^(not selected|selected)\s+(BUY|SELL) order for /i.test(n.desc) && n.y2 - n.y1 >= 120)
            .sort((a, b) => a.y1 - b.y1)
            .map(node => ({ node, checked: /^selected\b/i.test(node.desc), label: node.desc.replace(/^(not selected|selected)\s+/i, '').split(',')[0] }));
        const c = nodes.map(n => n.desc.match(/^(\d+)\s*\/\s*(\d+)\s*Order\(s\)/i)).find(Boolean);
        return {
            selectAll: nodes.find(n => /^(select|deselect|unselect) all\b/i.test(n.label)) || null,
            clear: nodes.find(n => /^clear all\b/i.test(n.label)) || null,
            exit: nodes.find(n => /exit selection mode/i.test(n.desc)) || null,
            counter: c ? { selected: Number(c[1]), total: Number(c[2]), text: c.input.split(',')[0] } : null,
            boxes,
        };
    }

    async isInSelectionMode() {
        const s = await this.getSelectionState();
        return !!s.exit || !!s.counter || s.boxes.length > 0;
    }

    // Taps Cancel All / Convert to Market (`kind` 'cancel' / 'convert') and waits for the
    // checkboxes. Only enters the mode - nothing is cancelled or converted.
    async enterSelectionMode(kind, timeout = 6000) {
        const btn = (await this.getBulkButtons())[kind === 'convert' ? 'convert' : 'cancelAll'];
        if (!btn) return false;
        await this.tapNode(btn);
        let ok = false;
        try {
            await this.driver.waitUntil(async () => (ok = await this.isInSelectionMode()), { timeout, interval: 500 });
        } catch (_) { /* not entered */ }
        await this.dumpPageSource(`orderbook_bulk_${kind}_mode`);
        return ok;
    }

    async tapCheckbox(node) {
        await this.tapNode(node);
        await this.pause(800);
    }

    // A selection-mode action button by label: 'convert' ("Convert N selected orders to market"),
    // 'clear' (Clear All) or 'cancel' (the bulk-cancel action, e.g. "Cancel N selected orders").
    // NEVER returns the bottom "Cancel, Double tap to exit selection mode" button, the entry
    // buttons ("... enter ... selection mode") or order rows. Lowest on screen wins.
    async findSelectionAction(kind) {
        const re = {
            convert: /^convert\b/i,
            clear: /^clear( all)?\b/i,
            cancel: /^cancel\b(?!led)/i,
        }[kind];
        const hits = (await this.getAllNodes())
            .filter(n => re.test(n.label)
                && !/(enter|exit) .*selection mode/i.test(n.desc)
                && !/order for /i.test(n.label))
            .sort((a, b) => b.y1 - a.y1);
        return hits[0] || null;
    }

    // Taps the action and waits for a Yes / No confirmation. Returns { question, yes, no } (nodes,
    // question = the text just above Yes / No) or null. Never answers it.
    async tapSelectionActionForConfirmation(kind, timeout = 6000) {
        const action = await this.findSelectionAction(kind);
        if (!action) throw new Error(`"${kind}" action not found in selection mode`);
        console.log(`Tapping "${action.label.split(',')[0]}"`);
        await this.tapNode(action);
        const dialog = await this.waitForYesNo(timeout);
        await this.dumpPageSource(`orderbook_bulk_${kind}_confirmation`);
        return dialog;
    }

    async readYesNo() {
        const nodes = await this.getAllNodes();
        const yes = nodes.find(n => /^yes\s*(,|$)/i.test(n.label));
        const no = nodes.find(n => /^no\s*(,|$)/i.test(n.label));
        if (!yes && !no) return null;
        const btnTop = Math.min(...[yes, no].filter(Boolean).map(n => n.y1));
        const question = nodes.filter(n => n.y2 <= btnTop && btnTop - n.y2 < 600 && !/^scrim$/i.test(n.label) && !n.checkable)
            .sort((a, b) => b.y2 - a.y2)[0];
        return { yes: yes || null, no: no || null, question: question ? question.label.replace(/\s+/g, ' ') : null };
    }

    async waitForYesNo(timeout = 6000) {
        let dialog = null;
        try {
            await this.driver.waitUntil(async () => !!(dialog = await this.readYesNo()), { timeout, interval: 400 });
        } catch (_) { /* none */ }
        return dialog;
    }

    // Closes an open Yes / No confirmation WITHOUT tapping either button: back presses only.
    // Returns whether it is gone.
    async dismissConfirmationWithBack(maxPresses = 2) {
        for (let i = 0; i < maxPresses && await this.readYesNo(); i++) {
            await this.driver.back();
            await this.pause(1000);
        }
        return !(await this.readYesNo());
    }

    // Leaves selection mode via its "Cancel, Double tap to exit selection mode" button (back as a
    // fallback, only while the mode is still shown, so it never backs out of the Order Book).
    // Refuses while a Yes / No confirmation is open. Returns whether the mode is gone.
    async exitSelectionMode(maxTries = 2) {
        for (let i = 0; i < maxTries && await this.isInSelectionMode(); i++) {
            if (await this.readYesNo()) return false;
            const { exit } = await this.getSelectionState();
            if (exit) await this.tapNode(exit);
            else await this.driver.back();
            await this.pause(1200);
        }
        return !(await this.isInSelectionMode());
    }

    // After Yes on a bulk cancel: taps OK on a follow-up popup if one appears. Returns its message.
    async acknowledgeIfShown(timeout = 8000) {
        let ok = null;
        let message = null;
        try {
            await this.driver.waitUntil(async () => {
                const nodes = await this.getAllNodes();
                ok = nodes.find(n => /^ok(ay)?$/i.test(n.label)) || null;
                if (!ok) return false;
                const above = nodes.filter(n => n.y2 <= ok.y1 && ok.y1 - n.y2 < 600 && !/^(scrim|ok)$/i.test(n.label))
                    .sort((a, b) => b.y2 - a.y2);
                message = above.length ? above[0].label.replace(/\s+/g, ' ') : null;
                return true;
            }, { timeout, interval: 400 });
        } catch (_) { /* none */ }
        await this.dumpPageSource('orderbook_bulk_cancel_result');
        if (ok) {
            await this.tapNode(ok);
            await this.pause(1500);
        }
        return { okShown: !!ok, message };
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
