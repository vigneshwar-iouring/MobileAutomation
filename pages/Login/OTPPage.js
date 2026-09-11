const BasePage = require('./BasePage');

const SEL = {
  heading:   '~OTP Verification',
  otpInput:  '//android.widget.EditText[1]',
  verifyBtn: '//android.view.View[contains(@content-desc,"VERIFY") or contains(@content-desc,"Verify") or contains(@content-desc,"SUBMIT") or contains(@content-desc,"Submit") or contains(@content-desc,"CONFIRM")]',
  resendBtn: '//android.view.View[starts-with(@content-desc,"Resend OTP")]',
  backBtn:   '//android.widget.ImageView[1]',
};

class OTPPage extends BasePage {

  async isLoaded(timeout = 20000) {
    return this.isDisplayed(SEL.heading, timeout);
  }

  async enterOTP(code) {
    const field = await this.waitForElement(SEL.otpInput);
    await this._tap(field);
    await browser.pause(300);
    await field.setValue(String(code));
    await browser.pause(800);
    try {
      const btn = await $(SEL.verifyBtn);
      if (await btn.isDisplayed()) await btn.click();
    } catch {}
    await browser.pause(500);
  }

  async tapResend() { await this.click(SEL.resendBtn); }
  async tapBack()   { await this.click(SEL.backBtn); }

  // Waits until OTP heading is gone on two consecutive checks (rules out transient flashes).
  async waitForNavigation(timeoutMs = 120000) {
    return this.pollUntil(async () => {
      if (await this.isDisplayed(SEL.heading, 1000)) return false;
      await browser.pause(1000);
      return !(await this.isDisplayed(SEL.heading, 1000));
    }, timeoutMs, 2000);
  }
}

module.exports = new OTPPage();
