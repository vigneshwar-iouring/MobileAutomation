const BasePage = require('./BasePage');

// NAV dates read like "31-07-2026" - DD-MM-YYYY.
function parseNavDate(text) {
    const m = text.trim().match(/^(\d{1,2})-(\d{1,2})-(\d{4})$/);
    if (!m) return null;
    return new Date(Number(m[3]), Number(m[2]) - 1, Number(m[1]));
}

const MONTHS = { JAN: 0, FEB: 1, MAR: 2, APR: 3, MAY: 4, JUN: 5, JUL: 6, AUG: 7, SEP: 8, OCT: 9, NOV: 10, DEC: 11 };

// NFO dates read like "17th Aug 2026" - day + ordinal suffix + month abbreviation + year.
function parseNfoDate(text) {
    const m = text.trim().match(/^(\d{1,2})(?:st|nd|rd|th)?\s+([A-Za-z]{3,9})\s+(\d{4})$/);
    if (!m) return null;
    const month = MONTHS[m[2].slice(0, 3).toUpperCase()];
    if (month === undefined) return null;
    return new Date(Number(m[3]), month, Number(m[1]));
}

// "NFO will close in 13 days" / "...close today" / "...close tomorrow" -> number of days.
function parseRemainingDaysText(text) {
    if (/close today/i.test(text)) return 0;
    if (/close tomorrow/i.test(text)) return 1;
    const m = text.match(/close in (\d+) days?/i);
    return m ? Number(m[1]) : null;
}

function daysBetween(from, to) {
    const oneDayMs = 24 * 60 * 60 * 1000;
    return Math.round((to.getTime() - from.getTime()) / oneDayMs);
}

// The Home tab's portfolio summary is one merged content-desc, e.g.:
// "Mutual Funds Portfolio Summary.\nCurrent\n₹6790.00\nInvestment\n₹6513.00\nExtended Internal
// Rate of Return: 20.49%.\nTotal Return\nAmount: ₹277.00. Return percentage: 4.\nDAY Return %\n
// Amount: ₹17.76. Return percentage: 0.26.\nExport portfolio button., Double tap to download..."
function parsePortfolioSummary(text) {
    const currentMatch = text.match(/Current\n₹?([\d,]+\.?\d*)/);
    const investmentMatch = text.match(/Investment\n₹?([\d,]+\.?\d*)/);
    const xirrMatch = text.match(/Extended Internal Rate of Return:\s*([\d.]+%)/);
    // Return percentage capture excludes the trailing "." - that's the sentence's own full stop
    // (e.g. "Return percentage: 4."), not part of the number, and [\d.]+ would otherwise swallow it.
    const totalReturnMatch = text.match(/Total Return\nAmount:\s*₹?([\d,]+\.?\d*)\.\s*Return percentage:\s*(\d+(?:\.\d+)?)/);
    const dayReturnMatch = text.match(/DAY Return %\nAmount:\s*₹?([\d,]+\.?\d*)\.\s*Return percentage:\s*(\d+(?:\.\d+)?)/);

    return {
        Current: currentMatch ? `₹${currentMatch[1]}` : null,
        Investment: investmentMatch ? `₹${investmentMatch[1]}` : null,
        'Total Return': totalReturnMatch ? `₹${totalReturnMatch[1]} (${totalReturnMatch[2]}%)` : null,
        'Day Return %': dayReturnMatch ? `₹${dayReturnMatch[1]} (${dayReturnMatch[2]}%)` : null,
        XIRR: xirrMatch ? xirrMatch[1] : null,
    };
}

class MutualFundsPage extends BasePage {
    constructor(driver) {
        super(driver);
        // Bottom floating nav - persists across screens (Watchlist/Market/Orders/Portfolio also
        // sit here), so it's present whether or not Mutual Funds is already open.
        this.mutualFundsNavButton = 'android=new UiSelector().description("Mutual Funds")';
        // Only the Mutual Funds screen itself has a Home/Explore/Portfolio/Accounts tab strip -
        // its presence is what tells "already on this screen" apart from "on some other tab".
        this.homeTab = 'android=new UiSelector().descriptionContains("Home")';
        this.portfolioSummary = 'android=new UiSelector().descriptionContains("Mutual Funds Portfolio Summary")';

        this.highReturnsCollection = 'android=new UiSelector().descriptionContains("High Returns")';
        // Every fund card in a collection list (Handpick Collections, Peer Comparison, etc.) ends
        // its content-desc the same way - "<Name>. Categories: ...% ., Double tap to view details."
        this.fundCard = 'android=new UiSelector().descriptionContains("Double tap to view details")';

        // The fund detail screen has TWO "Return period button" elements - this one (exact text)
        // belongs to the NAV/Annualised summary box; the other, further down, belongs to Peer
        // Comparison and reads "...Currently showing X Year Return values..." instead.
        this.annualisedReturnPeriodButton = 'android=new UiSelector().description("Return period button., Double tap to show return period options.")';

        this.handpickCollectionsLabel = 'android=new UiSelector().description("Handpick Collections")';
        this.searchButton = 'android=new UiSelector().descriptionContains("Search button")';
        // The search field (and, on a different screen, the order pad's amount field) has no
        // content-desc of its own (just a hint) and is the only EditText on its screen, so
        // className is the only selector that reaches either one.
        this.searchInput = 'android=new UiSelector().className("android.widget.EditText")';
        this.amountInput = 'android=new UiSelector().className("android.widget.EditText")';

        this.nfoBanner = 'android=new UiSelector().descriptionContains("Invest in New Fund Offering")';
        // NFO cards are the only cards on their list screen carrying "Open Date" - regular fund
        // cards elsewhere end in "Double tap to view details" instead.
        this.nfoCard = 'android=new UiSelector().descriptionContains("Open Date")';
        this.oneTimeButton = 'android=new UiSelector().descriptionContains("One Time button")';
        this.startSipButton = 'android=new UiSelector().descriptionContains("Start Systematic Investment Plan")';
    }

    async isOnMutualFundsScreen(timeout = 1500) {
        // "Tab 1 of 4" (Home/Explore/Portfolio/Accounts) is unique to the Mutual Funds screen's own
        // tab strip - literal-newline description() matches proved unreliable through the
        // UiAutomator2 driver (see NewsPage), so this sticks to a plain substring match instead.
        return await this.isElementVisible('android=new UiSelector().descriptionContains("Tab 1 of 4")', timeout);
    }

    // Only taps the bottom nav's "Mutual Funds" button when some other screen is active - tapping
    // it while already on Mutual Funds is harmless in itself, but the instruction explicitly wants
    // it skipped in that case.
    async openMutualFunds(timeout = 8000) {
        if (await this.isOnMutualFundsScreen()) {
            console.log('Already on Mutual Funds screen - skipping bottom nav tap');
            return;
        }
        await this.click(this.mutualFundsNavButton, timeout);
        console.log('Clicked Mutual Funds in bottom navigation');
    }

    async clickHomeTab(timeout = 5000) {
        await this.click(this.homeTab, timeout);
        console.log('Clicked Home tab');
    }

    async readPortfolioSummary(timeout = 8000) {
        const el = await this.findElement(this.portfolioSummary, timeout);
        const raw = (await el.getAttribute('content-desc')) || '';
        const text = raw.replace(/&#10;/g, '\n').replace(/&amp;/g, '&');
        const summary = parsePortfolioSummary(text);

        console.log('--- Mutual Funds Portfolio Summary (Home tab) ---');
        for (const [field, value] of Object.entries(summary)) {
            console.log(`  ${field}: ${value}`);
        }
        return summary;
    }

    // The Handpick Collections tile reads "High Returns\n12\nFunds" - read before navigating away,
    // so it can be compared against the list screen's own count after the tap.
    async getHighReturnsTileCount(timeout = 5000) {
        const el = await this.findElement(this.highReturnsCollection, timeout);
        const desc = (await el.getAttribute('content-desc')) || '';
        const m = desc.match(/(\d+)\s+Funds/i);
        return m ? Number(m[1]) : null;
    }

    // The list screen's own header is a standalone "<N> Funds" element (distinct from any fund
    // card's "Fund of Funds" category text, which also happens to contain the word "Funds").
    async getHighReturnsListCount(timeout = 5000) {
        await this.findElement(this.fundCard, timeout);
        const nodes = await this.getDescribedElements();
        const headerNode = nodes.find(n => /^\d+\s+Funds$/i.test(n.desc.trim()));
        return headerNode ? Number(headerNode.desc.match(/\d+/)[0]) : null;
    }

    async clickHighReturnsCollection(timeout = 5000) {
        await this.click(this.highReturnsCollection, timeout);
        console.log('Clicked "High Returns" under Handpick Collections');
    }

    // "Trending Funds" is the last section on the Home tab (verified live - scrolling to the true
    // page boundary lands exactly there, nothing renders below it), so a generic boundary-scroll
    // reaches it reliably without needing a section-specific selector.
    async scrollHomeToBottom(maxScrolls = 20) {
        await this.scrollToBoundary('android=new UiSelector().descriptionMatches(".+")', 'down', { maxScrolls });
        console.log('Scrolled to bottom of Mutual Funds Home tab');
    }

    // Boundary-aware, like ResearchCalls' scrollUp/countSymbols - swipes until the visible set of
    // fund cards stops changing in each direction, rather than a fixed swipe count.
    async scrollListToBottomThenTop(maxScrolls = 20) {
        await this.scrollToBoundary(this.fundCard, 'down', { maxScrolls });
        console.log('Scrolled to bottom of fund list');
        await this.scrollToBoundary(this.fundCard, 'up', { maxScrolls });
        console.log('Scrolled back to top of fund list');
    }

    async clickFirstFund(timeout = 5000) {
        const el = await this.findElement(this.fundCard, timeout);
        const desc = (await el.getAttribute('content-desc')) || '';
        const name = desc.split('.')[0].trim();
        await el.click();
        console.log(`Clicked first fund: "${name}"`);
        return name;
    }

    // NAV and Annualised sit as label-above-value pairs (findValueBelow), not side-by-side like
    // most of the app's other detail screens - "NAV as on <date>" carries the date inline with the
    // label rather than as its own element.
    async readFundNavAndAnnualised(timeout = 8000) {
        await this.findElement('android=new UiSelector().descriptionContains("NAV as on")', timeout);
        const nodes = await this.getDescribedElements();

        const navLabelNode = nodes.find(n => n.desc.startsWith('NAV as on'));
        const annualisedLabelNode = nodes.find(n => n.desc.trim() === 'Annualised');

        const dateMatch = navLabelNode ? navLabelNode.desc.match(/NAV as on\s+(.+)/) : null;
        const asOnDate = dateMatch ? dateMatch[1].trim() : null;
        const nav = navLabelNode ? this.findValueBelow(nodes, navLabelNode) : null;
        const annualised = annualisedLabelNode ? this.findValueBelow(nodes, annualisedLabelNode) : null;

        console.log(`NAV: ${nav} (as on ${asOnDate})`);
        console.log(`Annualised: ${annualised} (as on ${asOnDate})`);

        // NAV is only ever published for a trading day that has already closed, so the latest
        // available NAV date can never be later than today - it can lag behind (weekends,
        // holidays), but never lead.
        const navDate = asOnDate ? parseNavDate(asOnDate) : null;
        let isLatestOrToday = null;
        if (navDate) {
            const today = new Date();
            today.setHours(0, 0, 0, 0);
            isLatestOrToday = navDate.getTime() <= today.getTime();
            console.log(`NAV date check: "${asOnDate}" - ${isLatestOrToday ? 'PASS (on or before today)' : 'FAIL (in the future)'}`);
        }

        return { nav, asOnDate, annualised, isLatestOrToday };
    }

    // "Min. Invest Amt" / "Total Assets" / "Exit Load" sit in one label row with their values in
    // one row below - but unlike NAV/Annualised, the columns aren't consistently left-aligned
    // (Exit Load's value is right-aligned under a wider label), so findValueBelow's x-tolerance
    // match doesn't line up. Instead, both rows are sorted left-to-right and zipped by position,
    // which holds regardless of each column's own text alignment.
    async readFundAdditionalInfo(timeout = 5000) {
        const labelTexts = ['Min. Invest Amt', 'Total Assets', 'Exit Load'];
        await this.findElement(`android=new UiSelector().description("${labelTexts[0]}")`, timeout);
        const nodes = await this.getDescribedElements();

        const labelNodes = labelTexts
            .map(text => nodes.find(n => n.desc.trim() === text))
            .filter(Boolean)
            .sort((a, b) => a.x1 - b.x1);

        const rowTop = Math.min(...labelNodes.map(n => n.y2));
        const valueNodes = nodes
            .filter(n => !labelNodes.includes(n) && n.y1 >= rowTop && n.y1 <= rowTop + 120)
            .sort((a, b) => a.x1 - b.x1);

        const result = {};
        labelNodes.forEach((labelNode, i) => {
            result[labelNode.desc.trim()] = valueNodes[i] ? valueNodes[i].desc.trim() : null;
        });

        console.log('--- Additional Fund Info ---');
        for (const [field, value] of Object.entries(result)) {
            console.log(`  ${field}: ${value}`);
        }
        return result;
    }

    async openAnnualisedReturnPeriodPicker(timeout = 5000) {
        await this.click(this.annualisedReturnPeriodButton, timeout);
        console.log('Opened return period picker (Annualised box)');
    }

    // Picker options are short chips ("1Y", "3Y", "5Y", ...) alongside a "Scrim" backdrop element
    // used only to dismiss the picker - excluded here since it isn't a selectable period.
    async getAnnualisedReturnPeriodOptions() {
        const nodes = await this.getDescribedElements();
        return nodes.filter(n => /^\d+[A-Za-z]+$/.test(n.desc.trim())).map(n => n.desc.trim());
    }

    async selectAnnualisedReturnPeriod(label, timeout = 3000) {
        await this.click(`android=new UiSelector().description("${label}")`, timeout);
        console.log(`Selected return period: ${label}`);
    }

    // Tapping the backdrop closes any of this screen's return-period pickers without choosing
    // anything - used to back out once the already-selected default period has been read, since
    // re-selecting it is unnecessary. Shared by the Annualised box and the section pickers below.
    async dismissReturnPeriodPicker(timeout = 3000) {
        await this.click('android=new UiSelector().description("Scrim")', timeout);
        console.log('Dismissed return period picker without selecting');
    }

    // Selecting a period only changes what's under "Annualised" (NA when the fund doesn't have
    // enough history for that period yet) - NAV itself never depends on the selected period.
    //
    // The picker exposes no "selected" attribute on its options (verified against the raw page
    // source - every chip reports selected="false"), so there's no accessibility signal for which
    // one is already active. The app always pre-selects the first/shortest period in the list
    // (e.g. "1Y") whenever the fund detail screen first loads - so that value is read directly off
    // the screen before ever opening the picker, and only the remaining options get clicked.
    async cycleAnnualisedReturnPeriods() {
        const defaultInfo = await this.readFundNavAndAnnualised();

        await this.openAnnualisedReturnPeriodPicker();
        const options = await this.getAnnualisedReturnPeriodOptions();
        console.log(`Available return period options: ${options.join(', ') || '(none found)'}`);
        if (!options.length) {
            await this.dismissReturnPeriodPicker();
            return [];
        }

        const [defaultPeriod, ...otherPeriods] = options;
        console.log(`--- Return period: ${defaultPeriod} (already selected by default - not re-clicking) ---`);
        await this.dismissReturnPeriodPicker();
        const results = [{ period: defaultPeriod, ...defaultInfo }];

        for (const option of otherPeriods) {
            const pickerOpen = await this.isElementVisible(`android=new UiSelector().description("${option}")`, 1000);
            if (!pickerOpen) {
                await this.openAnnualisedReturnPeriodPicker();
            }
            await this.selectAnnualisedReturnPeriod(option);
            await this.pause(800);

            console.log(`--- Return period: ${option} ---`);
            const info = await this.readFundNavAndAnnualised();
            results.push({ period: option, ...info });
        }
        return results;
    }

    // "Peer Comparison" and "Funds in this Category" are two separate instances of the exact same
    // widget (section label, "Return period button. Currently showing <period> values..." button,
    // a short fund list, a "View More" that expands it once then disappears) - handled generically
    // by section label rather than duplicating this per section.
    // Stops once the section's return-period button is found, not just its label - this screen
    // mounts a section's children progressively as it scrolls into view, so the label alone can be
    // present (barely on-screen) while the button/list beneath it aren't rendered yet.
    //
    // The button/label surfacing is only the top edge of the section - its fund list and trailing
    // "View More" sit further down and are confirmed (via a live bounds check) to still be
    // unmounted at that exact scroll position, just past the bottom of the screen. One more swipe
    // brings them into view - safe because the label was only just entering the viewport, so it
    // still has most of the screen's height of room to move up without scrolling off the top.
    async scrollToSection(labelText, maxScrolls = 15) {
        for (let i = 0; i < maxScrolls; i++) {
            if (await this.getSectionReturnPeriodInfo(labelText)) {
                await this.swipe('down');
                await this.pause(400);
                console.log(`Scrolled to "${labelText}" section`);
                return true;
            }
            await this.swipe('down');
            await this.pause(400);
        }
        const found = !!(await this.getSectionReturnPeriodInfo(labelText));
        if (!found) console.log(`"${labelText}" section not found after ${maxScrolls} scrolls`);
        return found;
    }

    // "View More" expands the list in place and disappears once the whole list is showing, rather
    // than paginating repeatedly - so this only ever needs to click it once, if it's there at all.
    async clickSectionViewMoreIfPresent(labelText) {
        const nodes = await this.getDescribedElements();
        const labelNode = nodes.find(n => n.desc.trim() === labelText);
        if (!labelNode) {
            console.log(`"${labelText}" section not found - skipping View More`);
            return false;
        }
        const viewMoreNode = nodes
            .filter(n => n.desc.trim() === 'View More' && n.y1 > labelNode.y1)
            .sort((a, b) => a.y1 - b.y1)[0];
        if (!viewMoreNode) {
            console.log(`No "View More" to click under "${labelText}"`);
            return false;
        }
        await this.tapNode(viewMoreNode);
        console.log(`Clicked "View More" under "${labelText}"`);
        await this.pause(1000);
        return true;
    }

    // Unlike the Annualised box, this button's own text names the currently active period
    // ("Currently showing 3 Years Return values...") - read directly instead of guessing a
    // default, and the node itself is what openSectionReturnPeriodPicker taps (via tapNode, since
    // both sections can render this exact same text when they default to the same period, which a
    // plain description() selector can't tell apart).
    //
    // The button sits in the SAME row as the section label (title on the left, button on the
    // right) rather than below it - its y1 can even be a few px less than the label's own due to
    // baseline/padding differences, so "nearest by row" is matched on absolute y distance rather
    // than requiring y1 to be strictly greater.
    async getSectionReturnPeriodInfo(labelText) {
        const nodes = await this.getDescribedElements();
        const labelNode = nodes.find(n => n.desc.trim() === labelText);
        if (!labelNode) return null;
        const buttonNode = nodes
            .filter(n => n.desc.includes('Currently showing'))
            .sort((a, b) => Math.abs(a.y1 - labelNode.y1) - Math.abs(b.y1 - labelNode.y1))[0];
        if (!buttonNode) return null;
        const m = buttonNode.desc.match(/Currently showing (.+?) values/);
        return { node: buttonNode, currentPeriod: m ? m[1].trim() : null };
    }

    async openSectionReturnPeriodPicker(labelText) {
        const info = await this.getSectionReturnPeriodInfo(labelText);
        if (!info) throw new Error(`Return period button not found for "${labelText}"`);
        await this.tapNode(info.node);
        console.log(`Opened return period picker for "${labelText}"`);
    }

    // Options here read as full phrases ("1 Year Return", "3 Years Return", ...), unlike the
    // Annualised box's short "1Y"/"3Y"/"5Y" chips.
    async getSectionReturnPeriodOptions() {
        const nodes = await this.getDescribedElements();
        return nodes.filter(n => /^\d+\s+Years?\s+Return$/i.test(n.desc.trim())).map(n => n.desc.trim());
    }

    async selectSectionReturnPeriod(label, timeout = 3000) {
        await this.click(`android=new UiSelector().description("${label}")`, timeout);
        console.log(`Selected return period: ${label}`);
    }

    // Scrolls to the section, expands its list via View More (if present), then cycles every
    // return-period option that isn't already selected - skipping the current one without
    // clicking it, exactly as cycleAnnualisedReturnPeriods does for the box above.
    //
    // scrollToBottom: "Funds in this Category" paginates - tapping View More once only loads a few
    // more rows and reveals a second View More further down, unlike Peer Comparison's short list
    // which reveals everything in one tap. When set, an extra generic scroll-to-bottom pass runs
    // after the tap, settling the list before the return-period button is touched (the button
    // itself stays reachable throughout - verified live, it isn't scrolled off-screen by this).
    async cycleSectionReturnPeriods(labelText, { scrollToBottom = false } = {}) {
        const scrolled = await this.scrollToSection(labelText);
        if (!scrolled) return [];

        const viewMoreClicked = await this.clickSectionViewMoreIfPresent(labelText);
        if (viewMoreClicked && scrollToBottom) {
            console.log(`Scrolling to bottom after expanding "${labelText}" list...`);
            await this.scrollToBoundary('android=new UiSelector().descriptionMatches(".+")', 'down', { maxScrolls: 15 });
        }

        const before = await this.getSectionReturnPeriodInfo(labelText);
        if (!before) {
            console.log(`"${labelText}" - return period button not found - skipping`);
            return [];
        }
        console.log(`"${labelText}" - currently showing: ${before.currentPeriod}`);

        await this.openSectionReturnPeriodPicker(labelText);
        const options = await this.getSectionReturnPeriodOptions();
        console.log(`"${labelText}" - available return period options: ${options.join(', ') || '(none found)'}`);

        let pickerOpen = options.length > 0;
        const results = [];
        for (const option of options) {
            if (option === before.currentPeriod) {
                console.log(`"${labelText}" - "${option}" already selected by default - not re-clicking`);
                if (pickerOpen) {
                    await this.dismissReturnPeriodPicker();
                    pickerOpen = false;
                }
                results.push({ period: option, skipped: true });
                continue;
            }

            if (!pickerOpen) {
                await this.openSectionReturnPeriodPicker(labelText);
            }
            await this.selectSectionReturnPeriod(option);
            pickerOpen = false;
            await this.pause(1000);

            const after = await this.getSectionReturnPeriodInfo(labelText);
            console.log(`"${labelText}" - selected "${option}", button now reads: "${after ? after.currentPeriod : null}"`);
            results.push({ period: option, currentPeriod: after ? after.currentPeriod : null });
        }
        return results;
    }

    // For a section like Home's "Trending Funds", where only a single specific period switch is
    // wanted (not a full cycle through every option) - opens the picker and selects `newPeriod`
    // directly, skipping the click entirely if it's already the one showing.
    async changeSectionReturnPeriod(labelText, newPeriod) {
        const before = await this.getSectionReturnPeriodInfo(labelText);
        console.log(`"${labelText}" - currently showing: ${before ? before.currentPeriod : null}`);
        if (before && before.currentPeriod === newPeriod) {
            console.log(`"${labelText}" - "${newPeriod}" already selected - not re-clicking`);
            return before;
        }

        await this.openSectionReturnPeriodPicker(labelText);
        await this.selectSectionReturnPeriod(newPeriod);
        await this.pause(1000);

        const after = await this.getSectionReturnPeriodInfo(labelText);
        console.log(`"${labelText}" - changed to: ${after ? after.currentPeriod : null}`);
        return after;
    }

    // Category tabs ("Equity", "Debt", "Hybrid" under Trending Funds) are short, exact-text
    // elements - distinct from the Handpick Collections tile that happens to share the same word
    // (e.g. "Debt\nTab...\n23\nFunds" vs. the plain "Debt" tab here), so an exact description()
    // match is safe without needing position-based disambiguation.
    async clickTrendingFundsCategory(category, timeout = 5000) {
        await this.click(`android=new UiSelector().description("${category}")`, timeout);
        console.log(`Clicked "${category}" category under Trending Funds`);
    }

    // Backs out of however many screens deep the fund detail flow went (collection list -> fund
    // detail, or search -> fund detail) until the Home tab's Handpick Collections section is
    // visible again - no fixed press count, since the depth varies by how we got here.
    async navigateBackToHome(maxBackPresses = 5) {
        for (let i = 0; i < maxBackPresses; i++) {
            if (await this.isElementVisible(this.handpickCollectionsLabel, 500)) {
                console.log('Reached Mutual Funds Home screen');
                return true;
            }
            await this.driver.back();
            await this.pause(800);
        }
        const reached = await this.isElementVisible(this.handpickCollectionsLabel, 500);
        if (!reached) console.log(`Could not reach Mutual Funds Home after ${maxBackPresses} back presses`);
        return reached;
    }

    async clickSearchIcon(timeout = 5000) {
        await this.click(this.searchButton, timeout);
        console.log('Opened Mutual Funds search');
    }

    async searchMutualFunds(query, timeout = 5000) {
        const el = await this.findElement(this.searchInput, timeout);
        await el.click();
        await el.setValue(query);
        console.log(`Searched for "${query}"`);
        await this.pause(1000);
    }

    // Result cards share the same content-desc shape as any other fund list on this screen
    // ("<Name>. Categories: ..., Double tap to view details.") - the fund name is everything
    // before the first period.
    async getSearchResultNames() {
        const nodes = await this.getDescribedElements();
        return nodes.filter(n => n.desc.includes('Double tap to view details')).map(n => n.desc.split('.')[0].trim());
    }

    async verifySearchResults(query) {
        const names = await this.getSearchResultNames();
        const matching = names.filter(n => n.toLowerCase().includes(query.toLowerCase()));
        const allMatch = names.length > 0 && matching.length === names.length;

        console.log(`Search results for "${query}" (${names.length} found):`);
        names.forEach(n => console.log(`  - ${n}`));
        console.log(names.length === 0
            ? `FAIL - no results found for "${query}"`
            : (allMatch ? `PASS - all results contain "${query}"` : `FAIL - ${names.length - matching.length} result(s) do not contain "${query}"`));

        return { names, allMatch };
    }

    async clickNfoBanner(timeout = 5000) {
        await this.click(this.nfoBanner, timeout);
        console.log('Opened "Invest in New Fund Offering" list');
    }

    // NFO cards are unusually tall, text-heavy paragraphs that (like Peer Comparison's contents
    // earlier) can still be settling into the accessibility tree right as scrollToBoundary reads
    // its "stable" signature - occasionally reporting the boundary one card early. An explicit
    // confirmation swipe catches that: if it reveals anything new, scrolling resumes.
    async scrollNfoListToBottom(maxScrolls = 20) {
        await this.scrollToBoundary(this.nfoCard, 'down', { maxScrolls });

        const cardNames = async () => (await this.getDescribedElements())
            .filter(n => n.desc.includes('Open Date')).map(n => n.desc).join('|');
        const before = await cardNames();
        await this.swipe('down');
        await this.pause(600);
        const after = await cardNames();

        if (after !== before) {
            console.log('Confirmation swipe revealed more NFO cards - continuing to scroll...');
            await this.scrollToBoundary(this.nfoCard, 'down', { maxScrolls });
        }
        console.log('Scrolled to bottom of NFO list');
    }

    // The last fund is whichever NFO card sits lowest on screen once scrolled to the bottom -
    // taps it via tapNode (bounds-based) since its content-desc is a long free-form paragraph, not
    // a stable string a plain description() selector could safely target.
    async clickLastNfoFund() {
        const nodes = await this.getDescribedElements();
        const cards = nodes.filter(n => n.desc.includes('Open Date')).sort((a, b) => b.y1 - a.y1);
        if (!cards.length) throw new Error('No NFO fund cards found');
        const lastCard = cards[0];
        const name = lastCard.desc.split('\n')[0].trim();
        await this.tapNode(lastCard);
        console.log(`Clicked last NFO fund: "${name}"`);
        await this.pause(1500);
        return name;
    }

    // Open Date / Close Date / Allotment Date form the same label-row-then-value-row layout as
    // Min. Invest Amt / Total Assets / Exit Load on a regular fund's detail screen - sorted and
    // zipped by x-position rather than matched by x-tolerance, for the same alignment reasons.
    async readNfoDates(timeout = 8000) {
        await this.findElement('android=new UiSelector().description("Open Date")', timeout);
        const nodes = await this.getDescribedElements();

        const labelTexts = ['Open Date', 'Close Date', 'Allotment Date'];
        const labelNodes = labelTexts
            .map(text => nodes.find(n => n.desc.trim() === text))
            .filter(Boolean)
            .sort((a, b) => a.x1 - b.x1);

        // Window is tighter here than readFundAdditionalInfo's - the very next label
        // ("Minimum Investment Amount") sits only ~95px below this row, and a wider window (that
        // worked fine elsewhere, where the next content is further away) swept it in as if it
        // were a 4th date value, shifting the whole zip by one position.
        const rowTop = Math.min(...labelNodes.map(n => n.y2));
        const valueNodes = nodes
            .filter(n => !labelNodes.includes(n) && n.y1 >= rowTop && n.y1 <= rowTop + 70)
            .sort((a, b) => a.x1 - b.x1);

        const dates = {};
        labelNodes.forEach((labelNode, i) => {
            dates[labelNode.desc.trim()] = valueNodes[i] ? valueNodes[i].desc.trim() : null;
        });

        console.log('--- NFO Dates ---');
        for (const [field, value] of Object.entries(dates)) {
            console.log(`  ${field}: ${value}`);
        }
        return dates;
    }

    // Cross-checks the "NFO will close in N days" banner against the Close Date itself, referring
    // to Open/Close/Allotment together in the log the way the instruction asks.
    async verifyNfoRemainingTime(dates) {
        const remainingNode = (await this.getDescribedElements()).find(n => /NFO will close/i.test(n.desc));
        const remainingText = remainingNode ? remainingNode.desc.trim() : null;
        const statedDays = remainingText ? parseRemainingDaysText(remainingText) : null;

        const closeDate = dates['Close Date'] ? parseNfoDate(dates['Close Date']) : null;
        const today = new Date();
        today.setHours(0, 0, 0, 0);
        const actualDays = closeDate ? daysBetween(today, closeDate) : null;

        const matches = statedDays !== null && actualDays !== null && statedDays === actualDays;
        console.log(`Remaining time check - Open: ${dates['Open Date']}, Close: ${dates['Close Date']}, Allotment: ${dates['Allotment Date']}`);
        console.log(`  Banner: "${remainingText}" (${statedDays} day(s) stated) vs computed ${actualDays} day(s) until Close Date - ${matches ? 'PASS (match)' : 'FAIL (mismatch)'}`);
        return { remainingText, statedDays, actualDays, matches };
    }

    // Single label-above-value pair, same shape as NAV/Annualised on a regular fund's detail
    // screen.
    async readNfoMinInvestAmount(timeout = 5000) {
        const nodes = await this.getDescribedElements();
        const labelNode = nodes.find(n => n.desc.trim() === 'Minimum Investment Amount');
        const value = labelNode ? this.findValueBelow(nodes, labelNode) : null;
        console.log(`Minimum Investment Amount: ${value}`);
        return value;
    }

    // Generic scroll-to-bottom-then-top for a whole screen (not a specific list) - reused from the
    // same descriptionMatches(".+") technique as cycleSectionReturnPeriods's scrollToBottom.
    async scrollScreenToBottomThenTop(maxScrolls = 20) {
        await this.scrollToBoundary('android=new UiSelector().descriptionMatches(".+")', 'down', { maxScrolls });
        console.log('Scrolled to bottom of fund detail screen');
        await this.scrollToBoundary('android=new UiSelector().descriptionMatches(".+")', 'up', { maxScrolls });
        console.log('Scrolled back to top of fund detail screen');
    }

    async clickOneTimeButton(timeout = 5000) {
        await this.click(this.oneTimeButton, timeout);
        console.log('Opened One Time order pad');
    }

    // Some schemes (e.g. index/ETF NFOs) genuinely don't support SIP mode and render the button
    // unusable - but the raw accessibility tree's clickable="false" on this exact node turned out
    // to be an unreliable signal for that (verified live: it read false for a fund whose SIP pad
    // opened and worked fine moments later) - clickable only means "this view has its own tap
    // listener", not "this control is enabled", and can be false while a parent view still handles
    // the tap. So this attempts the real click - using BasePage.click()'s own isDisplayed()+
    // isEnabled() wait, the same real enabled-state WebDriver query a live tap would depend on -
    // and only treats it as "not applicable" if that genuinely times out.
    async clickStartSipButtonIfApplicable(timeout = 4000) {
        try {
            await this.click(this.startSipButton, timeout);
            console.log('Opened Systematic Investment Plan order pad');
            return true;
        } catch (err) {
            console.log('Start SIP is not applicable for this fund (not clickable) - skipping');
            return false;
        }
    }

    // A SIP pad in particular renders an "Auto Pay" bank-account section fetched live from the
    // server before finishing layout, occasionally pushing the amount field's own render past a
    // short timeout - a longer wait here absorbs that instead of failing on a slow but genuine load.
    async getOrderPadAmount(timeout = 9000) {
        const el = await this.findElement(this.amountInput, timeout);
        return await el.getText();
    }

    // The minimum shown here is the order pad's own - it's frequently NOT the same figure as the
    // fund detail screen's "Minimum Investment Amount" (verified live: a fund whose lump-sum
    // minimum is ₹5000 opened a SIP pad defaulting to ₹1500 instead), so it has to be read fresh
    // off whichever pad is currently open rather than reused from the fund detail screen.
    async getOrderPadMinAmount() {
        const nodes = await this.getDescribedElements();
        const minNode = nodes.find(n => /^Min\.\s*₹/.test(n.desc.trim()));
        if (!minNode) return null;
        const m = minNode.desc.match(/₹([\d,]+)/);
        return m ? Number(m[1].replace(/,/g, '')) : null;
    }

    // "+ ₹<amount>" adds that amount to whatever's currently entered (verified live: ₹1000 -> click
    // -> ₹2000 -> click -> ₹3000) - not a fixed "set to" button.
    async clickAddAmountButton(timeout = 5000) {
        const el = await this.findElement('android=new UiSelector().descriptionContains("+ ₹")', timeout);
        const label = (await el.getAttribute('content-desc')) || '';
        await el.click();
        console.log(`Clicked "${label}" quick-add button`);
        await this.pause(800);
        return label;
    }

    async goBackFromOrderPad() {
        await this.driver.back();
        await this.pause(800);
        console.log('Navigated back from order pad');
    }

    // One back-press returns from a fund detail screen straight to whatever list opened it (e.g.
    // Trending Funds) - verified live, no intermediate screen to get through first.
    async goBackFromFundDetail() {
        await this.driver.back();
        await this.pause(1000);
        console.log('Navigated back from fund detail');
    }

    // Shared by both One Time and Start SIP: confirms the amount field defaults to the minimum
    // stated on THIS pad (One Time and SIP can - and did, live - have different minimums for the
    // same fund), then confirms the "+₹<amount>" button actually increases it.
    async verifyOrderPadDefaults(label) {
        await this.pause(1000);
        const before = this.parseCurrency(await this.getOrderPadAmount());
        const expected = await this.getOrderPadMinAmount();
        const defaultMatches = !isNaN(before) && expected !== null && before === expected;
        console.log(`${label}: default amount = ${before} (expected minimum ${expected}, per "Min. ₹..." text) - ${defaultMatches ? 'PASS' : 'FAIL'}`);

        await this.clickAddAmountButton();
        const after = this.parseCurrency(await this.getOrderPadAmount());
        const increased = !isNaN(after) && !isNaN(before) && after > before;
        console.log(`${label}: amount after quick-add = ${after} - ${increased ? 'PASS (increased)' : 'FAIL'}`);

        return { before, after, defaultMatches, increased };
    }

    // Wraps the whole Start SIP flow so any way it can fail to pan out - the button not being
    // clickable at all, or the tap succeeding but landing on a screen without the expected amount
    // field (verified live: happens for pure ETF/Index NFOs, whose SIP button is tappable but
    // doesn't lead to a real order pad) - is treated the same way: skip it and let the caller carry
    // on with the rest of its flow, rather than letting either failure crash the whole run.
    async attemptStartSipFlow(label = 'Start SIP') {
        const opened = await this.clickStartSipButtonIfApplicable();
        if (!opened) return null;

        try {
            const result = await this.verifyOrderPadDefaults(label);
            await this.goBackFromOrderPad();
            return result;
        } catch (err) {
            console.log(`Start SIP did not open a usable order pad for this fund (${err.message}) - skipping`);
            await this.driver.back().catch(() => {});
            await this.pause(800);
            return null;
        }
    }
}

module.exports = { MutualFundsPage, parsePortfolioSummary };
