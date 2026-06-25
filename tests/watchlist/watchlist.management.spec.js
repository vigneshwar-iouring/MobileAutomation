const { expect }    = require('chai');
const watchlistPage = require('../../pages/Watchlist/WatchlistPage');
const { doLogin }   = require('../../utils/loginHelper');
const { dumpScreen }= require('../../utils/helpers');

// Run:  npx wdio config/wdio.android.conf.js --spec tests/watchlist/watchlist.management.spec.js

const TEST_WL_NAME    = 'AutoTest1';
const TEST_WL_RENAME  = 'AutoRenamed';
const LONG_NAME_30    = 'A'.repeat(30);

describe('Watchlist Management — Globe Capital Dev', () => {

  before(async function () {
    this.timeout(600000);
    await doLogin();
    const onWatchlist = await watchlistPage.isLoaded(30000);
    if (!onWatchlist) await dumpScreen('management-before: watchlist not found');
    expect(onWatchlist, 'Watchlist screen should be visible after login').to.be.true;
  });

  beforeEach(async () => {
    await watchlistPage.tapNavWatchlist();
    if (!await watchlistPage.isLoaded(8000))
      throw new Error('Could not return to Watchlist screen');
  });

  // ── Create ────────────────────────────────────────────────────────────────────

  it('Verify Create New Watchlist Functionality', async function () {
    this.timeout(30000);

    const created = await watchlistPage.createWatchlist(TEST_WL_NAME);
    if (!created) await dumpScreen('create-watchlist: tab not found after create');
    expect(created, `Tab "${TEST_WL_NAME}" should appear after creation`).to.be.true;

    // Cleanup
    await watchlistPage.deleteWatchlistByName(TEST_WL_NAME);
  });

  // ── Name validation ───────────────────────────────────────────────────────────

  it('Verify Watchlist Name Validation', async function () {
    this.timeout(20000);

    await watchlistPage.tapAddWatchlist();

    // Attempt to create with empty name
    await watchlistPage.tapCreateWatchlist();

    const errMsg = await watchlistPage.getDialogErrorMessage();
    if (!errMsg) await dumpScreen('name-validation: no error message found');
    expect(errMsg, 'Validation error should appear for empty name').to.be.a('string').and.not.empty;

    await watchlistPage.tapCancelDialog();
  });

  // ── Character limit ───────────────────────────────────────────────────────────

  it('Verify Watchlist Name Character Limit', async function () {
    this.timeout(20000);

    await watchlistPage.tapAddWatchlist();
    await watchlistPage.enterWatchlistName(LONG_NAME_30);

    const input = await $('//android.widget.EditText[1]');
    const entered = await input.getText();

    // The input should either be capped below 30 chars or show a validation error
    const withinLimit = entered.length < LONG_NAME_30.length;
    const errorShown  = await watchlistPage.getDialogErrorMessage();
    if (!withinLimit && !errorShown) await dumpScreen('char-limit: no truncation or error');
    expect(
      withinLimit || !!errorShown,
      'App should enforce a character limit (truncate input or show error)'
    ).to.be.true;

    await watchlistPage.tapCancelDialog();
  });

  // ── Duplicate name ────────────────────────────────────────────────────────────

  it('Verify Duplicate Watchlist Name Validation', async function () {
    this.timeout(30000);

    // Create the watchlist first
    await watchlistPage.createWatchlist(TEST_WL_NAME);
    await watchlistPage.tapNavWatchlist();
    await watchlistPage.isLoaded(5000);

    // Try to create again with the same name
    await watchlistPage.tapAddWatchlist();
    await watchlistPage.enterWatchlistName(TEST_WL_NAME);
    await watchlistPage.tapCreateWatchlist();

    const errMsg = await watchlistPage.getDialogErrorMessage();
    if (!errMsg) await dumpScreen('duplicate-name: no error message found');
    expect(errMsg, 'Duplicate name should show a validation error').to.be.a('string').and.not.empty;

    await watchlistPage.tapCancelDialog();

    // Cleanup
    await watchlistPage.deleteWatchlistByName(TEST_WL_NAME);
  });

  // ── Rename ────────────────────────────────────────────────────────────────────

  it('Verify Rename Watchlist Functionality', async function () {
    this.timeout(30000);

    // Create a watchlist to rename
    await watchlistPage.createWatchlist(TEST_WL_NAME);
    await watchlistPage.tapNavWatchlist();
    await watchlistPage.isLoaded(5000);

    // Find which tab number it is and long-press it
    const tabs = await $$(('//android.view.View[contains(@content-desc,"of 11")]'));
    let tabIdx = -1;
    for (let i = 0; i < tabs.length; i++) {
      const desc = await tabs[i].getAttribute('content-desc').catch(() => '');
      if (desc.includes(TEST_WL_NAME)) { tabIdx = i + 1; break; }
    }
    expect(tabIdx, 'Created watchlist tab should be findable').to.be.above(0);

    await watchlistPage.longPressTab(tabIdx);
    await watchlistPage.tapRenameOption();

    // Clear existing name and enter new name
    const input = await $('//android.widget.EditText[1]');
    await input.clearValue();
    await input.setValue(TEST_WL_RENAME);
    await watchlistPage.tapCreateWatchlist();
    await browser.pause(500);

    const renamed = await watchlistPage.watchlistExists(TEST_WL_RENAME);
    if (!renamed) await dumpScreen('rename: new tab name not found');
    expect(renamed, `Tab should appear with new name "${TEST_WL_RENAME}"`).to.be.true;

    // Cleanup
    await watchlistPage.deleteWatchlistByName(TEST_WL_RENAME);
  });

  // ── Delete ────────────────────────────────────────────────────────────────────

  it('Verify Delete Watchlist Functionality', async function () {
    this.timeout(30000);

    // Create a watchlist to delete
    await watchlistPage.createWatchlist(TEST_WL_NAME);
    await watchlistPage.tapNavWatchlist();
    await watchlistPage.isLoaded(5000);

    const tabs = await $$(('//android.view.View[contains(@content-desc,"of 11")]'));
    let tabIdx = -1;
    for (let i = 0; i < tabs.length; i++) {
      const desc = await tabs[i].getAttribute('content-desc').catch(() => '');
      if (desc.includes(TEST_WL_NAME)) { tabIdx = i + 1; break; }
    }
    expect(tabIdx, 'Watchlist to delete should be present').to.be.above(0);

    await watchlistPage.longPressTab(tabIdx);
    await watchlistPage.tapDeleteOption();
    await watchlistPage.tapDeleteConfirm();
    await browser.pause(500);

    const stillExists = await watchlistPage.watchlistExists(TEST_WL_NAME);
    expect(stillExists, `Tab "${TEST_WL_NAME}" should be gone after deletion`).to.be.false;
  });
});
