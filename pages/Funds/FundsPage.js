const BasePage = require('../Login/BasePage');

// Funds/Margin screen (hamburger menu -> Funds) and its sub-screens (View
// Transactions, Withdraw Funds, Add Funds). Confirmed via real UI dump: most fields
// expose their full label+value as one content-desc string. Withdraw's "Proceed" and
// Add Funds' payment-method options move real money — this page only ever reads
// them, never taps them.
const SEL = {
  hamburgerBtn:   '//*[contains(@content-desc,"Hamburger") or contains(@content-desc,"hamburger")]',
  // Each drawer row is a two-line "Title\nSubtitle" content-desc (e.g. "Funds\nStock
  // F&O Balance") — confirmed via a real R32 failure dump — so match by prefix, not
  // an exact "Funds" string which never occurs.
  fundsMenuItem:  '//*[starts-with(@content-desc,"Funds") or @text="Funds"]',

  // ── Funds/Margin screen ────────────────────────────────────────────────────
  fundsHeader:        '//*[@content-desc="Funds/Margin"]',
  marginAvailable:    '//*[contains(@content-desc,"Margin available to trade")]',
  availableFund:      '//*[contains(@content-desc,"Available Fund:")]',
  marginUtilised:     '//*[contains(@content-desc,"Margin utilised")]',
  cashEquivalent:     '//*[contains(@content-desc,"Cash Equivalent")]',
  collateral:         '//*[contains(@content-desc,"Collateral:")]',
  optionCreditForSale: '//*[contains(@content-desc,"Option Credit for Sale")]',
  pledgeLink:         '//*[contains(@content-desc,"Pledge Holdings")]',
  viewTransactionsBtn: '//*[contains(@content-desc,"View Transactions")]',
  withdrawFundsBtn:   '//*[contains(@content-desc,"Withdraw Funds")]',
  addFundsBtn:        '//*[contains(@content-desc,"Add Funds")]',

  // ── View Transactions screen ───────────────────────────────────────────────
  transactionHistoryHeader: '//*[@content-desc="Transaction History"]',
  noTransactionsMsg:  '//*[contains(@content-desc,"No transactions found") or contains(@text,"No transactions found")]',

  // ── Withdraw Funds screen ──────────────────────────────────────────────────
  withdrawableAmount: '//*[contains(@content-desc,"Withdrawable amount")]',
  amountToWithdrawField: '//*[contains(@content-desc,"Amount to withdraw")]',
  selectedBankAccount: '//*[contains(@content-desc,"Selected Bank Account")]',
  withdrawProceedBtn: '//*[contains(@content-desc,"Proceed")]',

  // ── Add Funds screen ───────────────────────────────────────────────────────
  addFundsHeader:     '//*[@content-desc="Add Funds"]',
  enterAmountField:   '//*[contains(@content-desc,"Enter Amount")]',
  paymentMethodLabel: '//*[@content-desc="Choose a payment method"]',
  upiOption:          '//*[contains(@content-desc,"UPI Apps payment method")]',
  netBankingOption:   '//*[contains(@content-desc,"Net Banking payment method")]',
};

class FundsPage extends BasePage {

  async openFunds() {
    const hamburgerTapped = await this.findAndTap(SEL.hamburgerBtn, 5000);
    if (!hamburgerTapped) return false;
    await browser.pause(800);
    return this.findAndTap(SEL.fundsMenuItem, 5000);
  }

  async isLoaded(timeout = 8000) { return this.isDisplayed(SEL.fundsHeader, timeout); }

  async getField(selector) {
    try {
      const el = await $(selector);
      await el.waitForDisplayed({ timeout: 3000 });
      return (await el.getAttribute('content-desc')) || (await el.getText());
    } catch { return null; }
  }

  async getAllFields() {
    const [marginAvailable, availableFund, marginUtilised, cashEquivalent, collateral, optionCreditForSale, pledgeVisible] = await Promise.all([
      this.getField(SEL.marginAvailable),
      this.getField(SEL.availableFund),
      this.getField(SEL.marginUtilised),
      this.getField(SEL.cashEquivalent),
      this.getField(SEL.collateral),
      this.getField(SEL.optionCreditForSale),
      this.isDisplayed(SEL.pledgeLink, 2000),
    ]);
    return { marginAvailable, availableFund, marginUtilised, cashEquivalent, collateral, optionCreditForSale, pledgeVisible };
  }

  async isViewTransactionsVisible() { return this.isDisplayed(SEL.viewTransactionsBtn, 3000); }
  async isWithdrawFundsVisible()    { return this.isDisplayed(SEL.withdrawFundsBtn, 3000); }
  async isAddFundsVisible()         { return this.isDisplayed(SEL.addFundsBtn, 3000); }

  async tapViewTransactions() { return this.findAndTap(SEL.viewTransactionsBtn, 5000); }
  async tapWithdrawFunds()    { return this.findAndTap(SEL.withdrawFundsBtn, 5000); }
  async tapAddFunds()         { return this.findAndTap(SEL.addFundsBtn, 5000); }

  async isTransactionHistoryLoaded(timeout = 5000) { return this.isDisplayed(SEL.transactionHistoryHeader, timeout); }
  async isNoTransactionsVisible(timeout = 3000)     { return this.isDisplayed(SEL.noTransactionsMsg, timeout); }

  // Best-effort: any content-desc row that isn't part of the screen's fixed chrome
  // (header/date-filter/filter-button) is treated as a transaction entry.
  async getTransactions() {
    try {
      const src = await driver.getPageSource();
      const descs = [...src.matchAll(/content-desc="([^"]{1,200})"/g)].map(m => m[1].split(/\n|&#10;/).join(' / '));
      const chrome = ['Transaction History', 'Filter Transactions', 'No transactions found'];
      return descs.filter(d => d && !chrome.some(c => d.includes(c)) && !/^Double tap to choose date range$/i.test(d) && !d.startsWith('Date range filter'));
    } catch { return []; }
  }

  async isWithdrawScreenLoaded(timeout = 5000) { return this.isDisplayed(SEL.withdrawableAmount, timeout); }
  async isWithdrawProceedVisible(timeout = 3000) { return this.isDisplayed(SEL.withdrawProceedBtn, timeout); }

  async isAddFundsScreenLoaded(timeout = 5000) { return this.isDisplayed(SEL.addFundsHeader, timeout); }
  async isPaymentMethodsVisible(timeout = 3000) {
    const [label, upi, netBanking] = await Promise.all([
      this.isDisplayed(SEL.paymentMethodLabel, timeout),
      this.isDisplayed(SEL.upiOption, timeout),
      this.isDisplayed(SEL.netBankingOption, timeout),
    ]);
    return label && upi && netBanking;
  }
}

module.exports = new FundsPage();
