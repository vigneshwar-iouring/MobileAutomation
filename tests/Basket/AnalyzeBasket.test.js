const DriverManager = require('../../driver/DriverManager');
const ResearchCalls = require('../../pages/ResearchCalls');
const BasketPage = require('../../pages/BasketPage');
const { createLogger, getFailedTCs } = require('../../utils/logger');

const { logFile, entries } = createLogger('AnalyzeBasket');
console.log(`Logging this run to: ${logFile}`);

async function run() {
    const driver = await DriverManager.getDriver();
    try {
        const researchCalls = new ResearchCalls(driver);
        const basketPage = new BasketPage(driver);

        console.log('TC 1: Navigating to Basket via the hamburger menu...');
        await basketPage.goToHome();
        await researchCalls.clickHamburgerMenu();
        await basketPage.clickBasketOrdersMenuItem();
        let onBasketScreen = await basketPage.waitForBasketScreen();
        if (onBasketScreen) {
            console.log('Basket screen loaded via hamburger -> Basket Orders');
        } else {
            console.error('FAIL: Basket screen did not load within 10s of tapping "Basket Orders" in the hamburger menu');
            await basketPage.openBasketViaOrdersTab();
            onBasketScreen = await basketPage.waitForBasketScreen();
            if (!onBasketScreen) {
                throw new Error('Basket screen did not load via the hamburger menu or via Orders -> Basket tab');
            }
            console.log('Basket screen loaded via fallback (Orders -> Basket tab)');
        }

        // RESUME_MULTI=1: skip creating/filling a basket and resume on the last scenario - open the
        // saved "<CDS_BASKET_NAME>" basket that already holds CRUDEOIL + NIFTY + SENSEX (left by a
        // previous full run) and run only the Analyze / underlying-dropdown checks on it.
        // RESUME_LIMIT=1: start straight on the Basket list and run only the 20-basket limit checks.
        if (process.env.RESUME_LIMIT === '1') {
            await basketLimitChecks(basketPage, 2);
            console.log('Analyze Basket flow completed (basket limit only)');
            return;
        }

        if (process.env.RESUME_MULTI === '1') {
            console.log(`TC 2: Opening the saved "${CDS_BASKET_NAME}" basket with 3 items (RESUME_MULTI)...`);
            const opened = await basketPage.openSavedBasket(CDS_BASKET_NAME, 3);
            console.log(`Saved basket opened: ${opened} ${opened ? 'PASS' : 'FAIL'}`);
            if (!opened) throw new Error(`No saved "${CDS_BASKET_NAME}" basket with 3 items to resume on`);
            const symbols = (await basketPage.getBasketItems()).map(it => it.name).filter(Boolean);
            console.log(`In the basket: ${symbols.join(', ')}`);
            const next = await multiAnalyzeChecks(basketPage, 3, symbols);
            if (next) await basketLimitChecks(basketPage, next);
            console.log('Analyze Basket flow completed (resumed)');
            return;
        }

        let tc = await cdsBasketChecks(basketPage, researchCalls, 2);
        if (tc) tc = await analyzeSymbolChecks(basketPage, tc,
            { removeSymbol: 'USDINR', query: 'SENSEX 77100 CE', exchange: 'BFO' });
        if (tc) tc = await analyzeSymbolChecks(basketPage, tc,
            { removeSymbol: 'SENSEX', query: 'NIFTY 25100 CE', exchange: 'NFO' });
        // Crude oil is listed as CRUDEOIL on MCX; the first matching search result is used.
        if (tc) tc = await analyzeSymbolChecks(basketPage, tc,
            { removeSymbol: 'NIFTY', query: 'CRUDEOIL', exchange: 'MCX' });
        // CRUDEOIL stays in the basket; NIFTY and SENSEX are added alongside it.
        if (tc) tc = await multiSymbolAnalyzeChecks(basketPage, tc, {
            toAdd: [
                { query: 'NIFTY 25100 CE', exchange: 'NFO' },
                { query: 'SENSEX 77100 CE', exchange: 'BFO' },
            ],
        });
        if (tc) tc = await basketLimitChecks(basketPage, tc);

        console.log('Analyze Basket flow completed');
    } catch (err) {
        console.error('Test failed:', err.message);
        console.error(err.stack);
    } finally {
        await DriverManager.closeDriver();

        const failedTCs = getFailedTCs(entries);
        if (failedTCs.length) {
            console.log('\n=== Failed Test Cases ===');
            failedTCs.forEach(f => {
                console.log(`${f.tc}:`);
                f.messages.forEach(m => console.log(`  - ${m}`));
            });
        } else {
            console.log('\nAll test cases passed.');
        }
    }
}

// Creates a second basket "F&O", adds the first USDINR search result (a CDS instrument) as a
// Market BUY, verifies it is in the basket, and verifies there is no Analyze button - Analyze is
// only shown for NFO, BFO and MCX baskets. Adding to a basket never places an order (EXECUTE is
// never tapped). Starts on the Basket screen.
const CDS_BASKET_NAME = 'Analyze Basket';
async function cdsBasketChecks(basketPage, researchCalls, tc) {
    console.log(`TC ${tc}: Creating a new basket "${CDS_BASKET_NAME}"...`);
    if (!(await basketPage.waitForBasketScreen(5000))) {
        await basketPage.goToHome();
        await researchCalls.clickHamburgerMenu();
        await basketPage.clickBasketOrdersMenuItem();
        if (!(await basketPage.waitForBasketScreen())) {
            console.error('FAIL: could not get back to the Basket screen to create a new basket');
            return;
        }
    }
    await basketPage.clickNewBasket();
    if (!(await basketPage.verifyNewBasketDialogOpened())) {
        console.error('FAIL: "New Basket" dialog did not open');
        return;
    }
    await basketPage.enterBasketName(CDS_BASKET_NAME);
    await basketPage.clickCreateBasket();
    const createdToast = await basketPage.waitForBasketCreatedToast();
    console.log(`"Basket created successfully" toast shown: ${createdToast} ${createdToast ? 'PASS' : 'FAIL'}`);
    const name = await basketPage.getOpenBasketName();
    const nameOk = name === CDS_BASKET_NAME;
    console.log(`Open basket name: "${name}" (expected "${CDS_BASKET_NAME}") ${nameOk ? 'PASS' : 'FAIL'}`);
    tc++;

    console.log(`TC ${tc}: Adding the first USDINR result as a Market BUY...`);
    const countBefore = await basketPage.getItemCount();
    await basketPage.openGlobalSearch();
    await basketPage.searchSymbol('USDINR');
    await basketPage.pause(1000);
    const symbolName = await basketPage.clickFirstSearchResult('USDINR');
    await basketPage.clickAddBuy();
    if (!(await basketPage.waitForOrderPad())) {
        console.error('FAIL: order pad did not open after ADD BUY');
        return;
    }
    const marketOk = await basketPage.setOrderType('Market');
    await basketPage.confirmOrderPad('BUY');
    const addedToast = await basketPage.waitForAddedToBasketToast(3000);
    console.log(`"Added To Basket" toast shown: ${addedToast} ${addedToast ? 'PASS' : 'FAIL'}`);
    if (!marketOk) console.error('FAIL: price field could not be switched to Market');
    await basketPage.pause(1000);
    tc++;

    console.log(`TC ${tc}: Verifying ${symbolName} is in the basket...`);
    const countAfter = await basketPage.getItemCount();
    const countOk = countBefore !== null && countAfter === countBefore + 1;
    console.log(`Item count ${countBefore} -> ${countAfter} ${countOk ? 'PASS' : 'FAIL'}`);
    const items = await basketPage.getBasketItems();
    items.forEach((it, i) => console.log(`  [${i}] ${it.side} ${it.name} ${it.exchange} ${it.orderType} ${it.product}`));
    const item = items.find(it => it.name && it.name.toUpperCase().includes('USDINR'));
    if (!item) {
        console.error(`FAIL: no USDINR item found in basket "${CDS_BASKET_NAME}"`);
    } else {
        const sideOk = (item.side || '').toUpperCase() === 'BUY';
        const typeOk = ['MARKET', 'MKT'].includes((item.orderType || '').toUpperCase());
        const exchOk = (item.exchange || '').toUpperCase() === 'CDS';
        console.log(`Found in basket: ${item.name} - side ${item.side} ${sideOk ? 'PASS' : 'FAIL'}, ` +
            `order type ${item.orderType} ${typeOk ? 'PASS' : 'FAIL'}, exchange ${item.exchange} ${exchOk ? 'PASS' : 'FAIL'}`);
        if (!sideOk || !typeOk || !exchOk) console.error(`FAIL: USDINR basket item is not a CDS Market BUY: ${item.raw}`);
    }
    tc++;

    console.log(`TC ${tc}: Verifying the Analyze button is NOT shown for a CDS basket...`);
    const analyzeShown = await basketPage.isAnalyzeVisible(3000);
    console.log(`Analyze button visible: ${analyzeShown} (expected false - only NFO/BFO/MCX) ${analyzeShown ? 'FAIL' : 'PASS'}`);
    if (analyzeShown) {
        console.error('FAIL: Analyze button is shown for a CDS basket');
        await basketPage.dumpPage('basket_analyze_shown_cds');
    }
    return tc + 1;
}

// Edit -> remove the basket's only symbol (`removeSymbol`) and verify the "<SYMBOL> Removed"
// message -> Done -> add `query` (first matching search result) as a Market BUY -> verify the
// Analyze button is shown (NFO/BFO/MCX only) -> tap it and verify the NxtOption strategy builder
// opens with the symbol's name and LTP -> Back to the basket detail screen.
// Starts and ends on the basket detail screen. Returns the next TC number, or null to stop.
async function analyzeSymbolChecks(basketPage, tc, { removeSymbol, query, exchange }) {
    console.log(`TC ${tc}: Removing ${removeSymbol} from the basket...`);
    if (!(await basketPage.clickEditBasket())) return null;
    const message = await basketPage.removeFirstSymbol();
    const messageOk = !!message && message.toUpperCase().includes(removeSymbol.toUpperCase());
    console.log(`Removed message: "${message}" (expected "${removeSymbol} ... Removed") ${messageOk ? 'PASS' : 'FAIL'}`);
    if (!messageOk) console.error(`FAIL: "${removeSymbol} Removed" message not shown`);
    await basketPage.clickDone();
    const countAfterRemove = await basketPage.getItemCount();
    const emptyOk = countAfterRemove === 0;
    console.log(`Item count after removing: ${countAfterRemove} (expected 0) ${emptyOk ? 'PASS' : 'FAIL'}`);
    tc++;

    console.log(`TC ${tc}: Adding ${query} as a Market BUY...`);
    const symbolName = await addMarketBuy(basketPage, query, exchange);
    if (!symbolName) return null;
    tc++;

    console.log(`TC ${tc}: Verifying the Analyze button is shown for a ${exchange} basket...`);
    const analyzeShown = await basketPage.isAnalyzeVisible(5000);
    console.log(`Analyze button visible: ${analyzeShown} (expected true) ${analyzeShown ? 'PASS' : 'FAIL'}`);
    if (!analyzeShown) {
        console.error(`FAIL: Analyze button is not shown for a ${exchange} basket`);
        await basketPage.dumpPage(`basket_analyze_missing_${exchange.toLowerCase()}`);
        return null;
    }
    tc++;

    console.log(`TC ${tc}: Clicking Analyze and verifying the NxtOption strategy builder...`);
    const analyzeTapped = await basketPage.clickAnalyze();
    console.log(`Analyze tap left the basket screen: ${analyzeTapped} ${analyzeTapped ? 'PASS' : 'FAIL'}`);
    const builderOpen = analyzeTapped && await basketPage.waitForStrategyBuilder();
    console.log(`NxtOption strategy builder opened: ${builderOpen} ${builderOpen ? 'PASS' : 'FAIL'}`);
    if (!builderOpen) {
        console.error('FAIL: NxtOption strategy builder did not open after tapping Analyze');
        await basketPage.dumpPage(`basket_strategy_builder_${exchange.toLowerCase()}`);
    } else {
        await checkBuilderForSymbol(basketPage, symbolName, `basket_strategy_builder_${exchange.toLowerCase()}`);
    }
    if (!(await basketPage.backToBasketDetail())) return null;
    return tc + 1;
}

// Up to 20 baskets can exist. From the open basket's detail screen: closes it back to the Basket
// list, counts the saved baskets, creates baskets named A, B, C, ... until the account holds 20,
// then attempts one more (the next letter) and verifies it is refused with a message and that the
// list still holds 20. Baskets already on the account count towards the 20, so fewer than 20
// letters are created when some exist. Returns the next TC number.
const BASKET_LIMIT = 20;
const MAX_BASKETS_TOAST = 'You have created maximum baskets';
async function basketLimitChecks(basketPage, tc) {
    console.log(`TC ${tc}: Navigating back to the Basket list...`);
    // Coming from a basket's detail screen, close it; with RESUME_LIMIT it's already on the list.
    if (await basketPage.isElementVisible(basketPage.closeBasketButton, 2000)) await basketPage.closeBasket();
    const onList = await basketPage.waitForBasketScreen(5000);
    console.log(`Basket list shown: ${onList} ${onList ? 'PASS' : 'FAIL'}`);
    if (!onList) {
        console.error('FAIL: did not get back to the Basket list from the basket detail screen');
        return null;
    }
    const existing = (await basketPage.getAllBasketRows()).length;
    console.log(`Saved baskets: ${existing} (limit ${BASKET_LIMIT})`);
    tc++;

    const toCreate = Math.max(0, BASKET_LIMIT - existing);
    console.log(`TC ${tc}: Creating ${toCreate} basket(s) named A, B, C, ... up to the ${BASKET_LIMIT}-basket limit...`);
    const letters = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
    let created = 0;
    for (let i = 0; i < toCreate; i++) {
        const name = letters[i];
        const res = await basketPage.createBasketAndReturn(name);
        console.log(`Basket "${name}" created: ${res.created} ${res.created ? 'PASS' : 'FAIL'}`);
        if (!res.created) {
            console.error(`FAIL: basket "${name}" (#${existing + i + 1} of ${BASKET_LIMIT}) was not created - ` +
                `messages: ${res.messages.join(' | ') || '(none)'}`);
            break;
        }
        created++;
    }
    const countAtLimit = (await basketPage.getAllBasketRows()).length;
    const atLimit = countAtLimit === BASKET_LIMIT;
    console.log(`Saved baskets: ${existing} -> ${countAtLimit} (expected ${BASKET_LIMIT}) ${atLimit ? 'PASS' : 'FAIL'}`);
    if (!atLimit) console.error(`FAIL: ${countAtLimit} baskets after creating ${created}, expected ${BASKET_LIMIT}`);
    tc++;

    const extraName = letters[toCreate] || 'Z';
    console.log(`TC ${tc}: Attempting a ${BASKET_LIMIT + 1}st basket "${extraName}" - expecting the limit message...`);
    const extra = await basketPage.createBasketAndReturn(extraName);
    const msgs = extra.messages.filter(m => m !== extraName);
    console.log(`New Basket dialog opened: ${extra.dialogOpened}`);
    console.log(`Message(s) shown: ${msgs.join(' | ') || '(none)'}`);
    const refused = !extra.created;
    console.log(`${BASKET_LIMIT + 1}st basket refused: ${refused} ${refused ? 'PASS' : 'FAIL'}`);
    if (!refused) console.error(`FAIL: a ${BASKET_LIMIT + 1}st basket "${extraName}" was created`);
    const toastShown = msgs.some(m => m.includes(MAX_BASKETS_TOAST));
    console.log(`"${MAX_BASKETS_TOAST}" toast shown: ${toastShown} ${toastShown ? 'PASS' : 'FAIL'}`);
    if (!toastShown) {
        console.error(`FAIL: "${MAX_BASKETS_TOAST}" not shown when creating a ${BASKET_LIMIT + 1}st basket`);
        await basketPage.dumpPage('basket_limit_no_message');
    }
    const countAfter = (await basketPage.getAllBasketRows()).length;
    const unchanged = countAfter === countAtLimit;
    console.log(`Saved baskets after the attempt: ${countAfter} (expected ${countAtLimit}) ${unchanged ? 'PASS' : 'FAIL'}`);
    return tc + 1;
}

// Checks the strategy builder currently shows `symbolName`'s underlying and its leg. Expected
// values come from the symbol actually clicked, e.g. "SENSEX 12NOV 77100 CE" -> underlying
// "SENSEX", contract "12NOV77100CE"; the builder shows the leg as "1 x 12 Nov 77100 CE", so both
// are compared upper-cased with spaces removed (futures work the same: "CRUDEOIL 19NOV FUT" ->
// "19NOVFUT"). The header shows one underlying at a time, so only that underlying's legs are
// listed. Saves the screen to ui_dumps/<dumpName>.xml if anything fails. Returns true if all pass.
async function checkBuilderForSymbol(basketPage, symbolName, dumpName) {
    const d = await basketPage.getStrategyBuilderDetails();
    const isNum = v => !!v && /^-?[\d,]+(\.\d+)?$/.test(v);
    const squash = s => (s || '').toUpperCase().replace(/\s+/g, '');
    const [underlyingName, ...contractParts] = symbolName.split(/\s+/);
    const contract = squash(contractParts.join(''));
    const leg = d.legs.find(l => squash(l.instrument).includes(contract)) || {};
    d.legs.forEach((l, i) => console.log(`  leg [${i}] ${l.side} | ${l.instrument} | ${l.price} | ${l.ltp}`));
    const checks = [
        // NIFTY's underlying is shown as "NIFTY 50", so compare by prefix.
        [`Underlying: ${d.underlying} (expected ${underlyingName})`,
            !!d.underlying && d.underlying.toUpperCase().startsWith(underlyingName.toUpperCase())],
        [`Underlying spot: ${d.spot} (${d.change})`, isNum(d.spot)],
        [`Instrument: "${leg.instrument}" (expected ${contractParts.join(' ')})`, !!contract && !!leg.instrument],
        [`Side: ${leg.side} (expected B for a BUY)`, leg.side === 'B'],
        [`Price: ${leg.price}`, isNum(leg.price)],
        [`LTP: ${leg.ltp}`, isNum(leg.ltp)],
        [`Net Premium: ${d.payOrReceive || ''} ${d.netPremium}`, isNum(d.netPremium)],
    ];
    for (const [label, ok] of checks) {
        console.log(`${label} ${ok ? 'PASS' : 'FAIL'}`);
        if (!ok) console.error(`FAIL: strategy builder for ${symbolName} - ${label}`);
    }
    const allOk = checks.every(([, ok]) => ok);
    if (!allOk) await basketPage.dumpPage(dumpName);
    return allOk;
}

// From the basket detail screen: global search -> first result matching `query` -> ADD BUY ->
// Market -> ADD BUY, then checks "Added To Basket" and that the basket lists the symbol on
// `exchange`. Returns the clicked symbol's name (e.g. "SENSEX 12NOV 77100 CE"), or null if the
// order pad never opened.
async function addMarketBuy(basketPage, query, exchange) {
    const tokens = query.split(/\s+/);
    await basketPage.openGlobalSearch();
    await basketPage.searchSymbol(query);
    await basketPage.pause(1500);
    const symbolName = await basketPage.clickFirstSearchResultMatching(tokens);
    await basketPage.clickAddBuy();
    if (!(await basketPage.waitForOrderPad())) {
        console.error('FAIL: order pad did not open after ADD BUY');
        return null;
    }
    const marketOk = await basketPage.setOrderType('Market');
    if (!marketOk) console.error('FAIL: price field could not be switched to Market');
    await basketPage.confirmOrderPad('BUY');
    const addedToast = await basketPage.waitForAddedToBasketToast(3000);
    console.log(`"Added To Basket" toast shown: ${addedToast} ${addedToast ? 'PASS' : 'FAIL'}`);
    await basketPage.pause(1000);
    const items = await basketPage.getBasketItems();
    items.forEach((it, i) => console.log(`  [${i}] ${it.side} ${it.name} ${it.exchange} ${it.orderType} ${it.product}`));
    const item = items.find(it => it.name && it.name.toUpperCase() === symbolName.toUpperCase())
        || items.find(it => it.name && tokens.every(t => it.name.toUpperCase().includes(t.toUpperCase())));
    if (!item) {
        console.error(`FAIL: ${symbolName} not found in the basket`);
    } else {
        const exchOk = (item.exchange || '').toUpperCase() === exchange;
        console.log(`Found in basket: ${item.name} - exchange ${item.exchange} (expected ${exchange}) ${exchOk ? 'PASS' : 'FAIL'}`);
        if (!exchOk) console.error(`FAIL: ${symbolName} basket item exchange is ${item.exchange}, expected ${exchange}`);
    }
    return symbolName;
}

// Keeps whatever is already in the basket (CRUDEOIL from the previous round), adds each of
// `toAdd` as a Market BUY, then verifies: the item count, the Analyze button, and that the
// NxtOption strategy builder lists one leg per basket symbol with a BUY side, a price and an
// LTP. Starts and ends on the basket detail screen.
async function multiSymbolAnalyzeChecks(basketPage, tc, { toAdd }) {
    const countBefore = await basketPage.getItemCount();
    const symbols = (await basketPage.getBasketItems()).map(it => it.name).filter(Boolean);
    console.log(`Already in the basket: ${symbols.join(', ') || '(nothing)'}`);

    for (const { query, exchange } of toAdd) {
        console.log(`TC ${tc}: Adding ${query} to the same basket as a Market BUY...`);
        const name = await addMarketBuy(basketPage, query, exchange);
        if (!name) return null;
        symbols.push(name);
        tc++;
    }

    console.log(`TC ${tc}: Verifying the basket holds all ${symbols.length} symbols...`);
    const countAfter = await basketPage.getItemCount();
    const countOk = countBefore !== null && countAfter === countBefore + toAdd.length;
    console.log(`Item count ${countBefore} -> ${countAfter} (expected +${toAdd.length}) ${countOk ? 'PASS' : 'FAIL'}`);
    if (!countOk) console.error(`FAIL: item count is ${countAfter}, expected ${countBefore + toAdd.length}`);
    const names = (await basketPage.getBasketItems()).map(it => (it.name || '').toUpperCase());
    for (const s of symbols) {
        const found = names.includes(s.toUpperCase());
        console.log(`In basket: ${s} ${found ? 'PASS' : 'FAIL'}`);
        if (!found) console.error(`FAIL: ${s} is missing from the basket`);
    }
    tc++;

    return await multiAnalyzeChecks(basketPage, tc, symbols);
}

// For a basket holding several underlyings (`symbols`, in the order added): verifies the Analyze
// button, opens the strategy builder (it starts on symbols[0]), then switches to each other
// underlying through the header dropdown and verifies its data. Starts and ends on the basket
// detail screen.
async function multiAnalyzeChecks(basketPage, tc, symbols) {
    console.log(`TC ${tc}: Verifying the Analyze button is shown for a ${symbols.length}-symbol basket...`);
    const analyzeShown = await basketPage.isAnalyzeVisible(5000);
    console.log(`Analyze button visible: ${analyzeShown} (expected true) ${analyzeShown ? 'PASS' : 'FAIL'}`);
    if (!analyzeShown) {
        console.error('FAIL: Analyze button is not shown for the multi-symbol basket');
        await basketPage.dumpPage('basket_analyze_missing_multi');
        return null;
    }
    tc++;

    // The builder shows one underlying at a time, starting with the first symbol added (CRUDEOIL);
    // the others are reached through the dropdown on the header.
    console.log(`TC ${tc}: Clicking Analyze - strategy builder should open on ${symbols[0]}...`);
    const analyzeTapped = await basketPage.clickAnalyze();
    console.log(`Analyze tap left the basket screen: ${analyzeTapped} ${analyzeTapped ? 'PASS' : 'FAIL'}`);
    const builderOpen = analyzeTapped && await basketPage.waitForStrategyBuilder();
    console.log(`NxtOption strategy builder opened: ${builderOpen} ${builderOpen ? 'PASS' : 'FAIL'}`);
    if (!builderOpen) {
        console.error('FAIL: NxtOption strategy builder did not open after tapping Analyze');
        await basketPage.dumpPage('basket_strategy_builder_multi');
        await basketPage.backToBasketDetail();
        return null;
    }
    await checkBuilderForSymbol(basketPage, symbols[0], 'basket_strategy_builder_multi');
    tc++;

    for (const s of symbols.slice(1)) {
        const underlying = s.split(/\s+/)[0];
        console.log(`TC ${tc}: Selecting ${underlying} from the underlying dropdown and verifying ${s}...`);
        const { ok, options } = await basketPage.selectBuilderUnderlying(underlying);
        if (options.length) console.log(`Dropdown entries seen: ${options.join(' | ')}`);
        console.log(`Header switched to ${underlying}: ${ok} ${ok ? 'PASS' : 'FAIL'}`);
        if (!ok) {
            console.error(`FAIL: could not switch the strategy builder to ${underlying}`);
        } else {
            await checkBuilderForSymbol(basketPage, s, `basket_strategy_builder_multi_${underlying.toLowerCase()}`);
        }
        tc++;
    }

    if (!(await basketPage.backToBasketDetail())) return null;
    return tc;
}

run();
