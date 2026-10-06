const BasePage = require('./BasePage');

// Options of the two dropdowns on the "See all" Corporate Action screen (verified live): the left
// one filters by period, the right one by action type. Both start on "ALL".
const PERIOD_FILTERS = ['ALL', 'Today', 'This Week', 'Next Week'];
const TYPE_FILTERS = ['ALL', 'DIVIDEND', 'BONUS', 'STOCK SPLIT', 'RIGHTS', 'COMP.ANNCMENT'];

// Covers two screens that share the same layout (Back button + title + list of actions):
//   - "Corporate Action": Markets > Corporate Action > See all, with the two filter dropdowns.
//   - "Corporate Action - <SYMBOL>": opened by tapping the Event tag on a symbol's Quote.
class CorporateActionPage extends BasePage {
    constructor(driver) {
        super(driver);
        this.backButton = 'android=new UiSelector().description("Back, Double tap to go back")';
        this.seeAllTitle = 'android=new UiSelector().description("Corporate Action")';
        this.noDataFound = 'android=new UiSelector().descriptionStartsWith("No Data Found")';
        this.periodFilters = PERIOD_FILTERS;
        this.typeFilters = TYPE_FILTERS;
    }

    async isSeeAllScreenOpen(timeout = 8000) {
        const opened = await this.isElementVisible(this.backButton, timeout)
            && await this.isElementVisible(this.seeAllTitle, 2000);
        console.log(`Corporate Action "See all" screen opened: ${opened ? 'PASS' : 'FAIL'}`);
        return opened;
    }

    // "Corporate Action - BLSE": the symbol's own corporate action history.
    async isSymbolScreenOpen(symbol, timeout = 8000) {
        const title = `android=new UiSelector().description("Corporate Action - ${symbol}")`;
        const opened = await this.isElementVisible(title, timeout);
        const rows = opened ? await this.getListedActions() : [];
        console.log(`Corporate Action screen for ${symbol} opened (${rows.length} action(s) listed): ${opened ? 'PASS' : 'FAIL'}`);
        return opened;
    }

    async clickBack(timeout = 5000) {
        await this.click(this.backButton, timeout);
        console.log('Clicked Back on the Corporate Action screen');
    }

    // On the See all screen the list is grouped by date: each group is ONE merged node
    // ("07 Oct 2026\nCorporate action type DIVIDEND. ...\nCorporate action type ..."); on the
    // per-symbol screen every action is its own node ("DIVIDEND. Rs. 0.5 Per share. ...").
    // Both end their action text with "Displays corporate action details."
    async getListedActions() {
        const nodes = await this.getDescribedElements();
        return nodes.filter(n => /Displays corporate action details/.test(n.desc));
    }

    async hasNoData(timeout = 1500) {
        return this.isElementVisible(this.noDataFound, timeout);
    }

    // The dropdown buttons show their current value as content-desc, so the left one is whichever
    // clickable period value sits in the left half of the filter row, the right one a type value
    // in the right half. The open menu covers the dropdowns, so the option is the last exact match.
    async selectFilter(side, option) {
        const { width } = await this.driver.getWindowSize();
        const values = side === 'left' ? PERIOD_FILTERS : TYPE_FILTERS;
        const nodes = await this.getDescribedElements();
        const dropdown = nodes.find(n => n.clickable && values.includes(n.desc)
            && (side === 'left' ? n.x1 < width / 2 : n.x1 >= width / 2));
        if (!dropdown) throw new Error(`Corporate Action ${side} filter dropdown not found`);
        await this.tapNode(dropdown);
        await this.pause(1000);

        const options = (await this.getDescribedElements()).filter(n => n.desc === option);
        if (!options.length) throw new Error(`"${option}" not found in the ${side} filter menu`);
        await this.tapNode(options[options.length - 1]);
        await this.pause(1500);
        console.log(`Selected "${option}" in the ${side} filter (was "${dropdown.desc}")`);
    }

    // Selects `preferred` in the given filter; if that leaves the list empty ("No Data Found!"),
    // tries the remaining options of the same filter in order until one lists data. Returns the
    // option that ended up selected with data, or null if every option was empty.
    async selectFilterWithData(side, preferred) {
        const all = side === 'left' ? PERIOD_FILTERS : TYPE_FILTERS;
        for (const option of [preferred, ...all.filter(o => o !== preferred)]) {
            await this.selectFilter(side, option);
            const rows = await this.getListedActions();
            if (rows.length && !(await this.hasNoData(500))) {
                console.log(`"${option}" lists data (${rows.length} date group(s) on screen)`);
                return option;
            }
            console.log(`No data listed for "${option}" - trying another ${side} filter option`);
        }
        return null;
    }

    // Taps the first action in the list. On the See all screen a date group's node starts with
    // its date header (~90px tall), so the tap lands below that, on the first card's title line.
    async tapFirstListed() {
        const rows = await this.getListedActions();
        if (!rows.length) return null;
        const first = rows[0];
        const grouped = /^\d{1,2} \w{3} \d{4}\n/.test(first.desc);
        const y = grouped ? Math.min(first.y1 + 150, first.y2 - 20) : Math.round((first.y1 + first.y2) / 2);
        const x = Math.round(first.x1 + (first.x2 - first.x1) * 0.3);
        await this.driver.action('pointer').move({ duration: 0, x, y }).down().up().perform();

        const firstAction = (first.desc.match(/Corporate action type ([^.]+)\. company name (.+?)(?:Rs\.|Ratio|\. Ex date)/) || []);
        console.log(`Tapped first listed corporate action: ${firstAction[1] || ''} ${firstAction[2] ? `- ${firstAction[2].trim()}` : ''}`.trim());
        return { type: firstAction[1] || null, company: firstAction[2] ? firstAction[2].trim() : null };
    }
}

module.exports = { CorporateActionPage };
