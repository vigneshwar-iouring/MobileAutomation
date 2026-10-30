const BasePage = require('./BasePage');

const SEL = {
  heading:   '~OTP Verification',
  otpInput:  '//android.widget.EditText[1]',
  verifyBtn: 'android=new UiSelector().description("Verify OTP")',
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
    await this.tapVerify();
  }

  // Both login OTP screens (after LOGIN and after ENABLE NOW) need an explicit "Verify OTP" tap -
  // the OTP no longer auto-validates on entry.
  async tapVerify() {
    await this.hideKeyboard();
    await this.click(SEL.verifyBtn);
    console.log('  ✓  Tapped Verify OTP');
    await browser.pause(500);
  }

  // Verify OTP is greyed out (enabled="false", clickable="false") until an OTP is entered. While the
  // keyboard is open Verify OTP is not in the accessibility tree at all, so hide it first.
  async isVerifyEnabled(timeout = 10000) {
    await this.hideKeyboard();
    await browser.pause(500);
    const btn = await this.waitForElement(SEL.verifyBtn, timeout);
    return (await btn.getAttribute('enabled')) === 'true';
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
