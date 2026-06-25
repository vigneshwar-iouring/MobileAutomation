const { expect } = require('chai');
const loginPage        = require('../../pages/Login/LoginPage');
const otpPage          = require('../../pages/Login/OTPPage');
const enableSecurePage = require('../../pages/Login/EnableSecurePage');
const biometricPage    = require('../../pages/Login/BiometricSetupPage');
const homePage         = require('../../pages/Login/HomePage');
const testData         = require('../../data/testData');
const { fetchOtpFromGmail, purgeStaleOtps } = require('../../utils/emailOtp');
const { retryOtpWithDelay, createGmailOtpFetcher } = require('../../utils/otpRetry');
const { clearAndLaunch, dumpScreen } = require('../../utils/helpers');

const GMAIL_CONFIGURED = !!(process.env.GMAIL_USER && process.env.GMAIL_APP_PASSWORD);

async function getOtp(label) {
  if (GMAIL_CONFIGURED) {
    console.log(`\n  📧 Fetching ${label} from Gmail...`);
    const otp = await fetchOtpFromGmail({
      user:     process.env.GMAIL_USER,
      password: process.env.GMAIL_APP_PASSWORD,
      timeout:  120000,
    });
    console.log(`  ✅ Got ${label}: ${otp}`);
    return otp;
  }
  console.log(`\n  📱 ENTER ${label} ON YOUR DEVICE NOW (2 min)\n`);
  return null;
}

// ── Login screen UI / navigation tests ────────────────────────────────────────

describe('Login Screen — Globe Capital Dev', () => {
  beforeEach(async () => {
    await clearAndLaunch();
    if (!await loginPage.waitForLoginScreen(60000))
      throw new Error('Login screen did not appear within 60 s');
  });

  describe.skip('UI Elements', () => {
    it('should display the Login ID input field',    async () => expect(await $('//android.widget.EditText[1]').isDisplayed()).to.be.true);
    it('should display the Password input field',    async () => expect(await $('//android.widget.EditText[2]').isDisplayed()).to.be.true);
    it('should display the LOGIN button',            async () => expect(await loginPage.isLoaded()).to.be.true);
    it('should display the SIGN UP button',          async () => expect(await loginPage.isSignUpButtonDisplayed()).to.be.true);
    it('should display FORGET PASSWORD link',        async () => expect(await loginPage.isForgotPasswordDisplayed()).to.be.true);
    it('should display Terms and Conditions text',   async () => expect(await loginPage.isTermsTextDisplayed()).to.be.true);
  });

  describe.skip('Input Field Behaviour', () => {
    it('should accept text in Login ID field', async () => {
      await loginPage.enterLoginId('TESTUSER');
      expect(await loginPage.getLoginIdFieldValue()).to.equal('TESTUSER');
    });
    it('should mask text in Password field', async () => {
      expect(await (await $('//android.widget.EditText[2]')).getAttribute('password')).to.equal('true');
    });
    it('should clear Login ID and accept new text', async () => {
      await loginPage.enterLoginId('FIRST');
      await loginPage.enterLoginId('SECOND');
      expect(await loginPage.getLoginIdFieldValue()).to.equal('SECOND');
    });
  });

  describe.skip('Login Validation', () => {
    it('should stay on login screen with invalid credentials', async () => {
      await loginPage.login(testData.invalidUser.id, testData.invalidUser.password);
      expect(await loginPage.isLoaded(), 'Should remain on login screen').to.be.true;
    });
    it('should stay on login screen when fields are blank', async () => {
      await loginPage.tapLogin();
      expect(await loginPage.isLoaded()).to.be.true;
    });
  });

  describe.skip('Navigation', () => {
    it('should navigate to Sign Up screen', async () => {
      await loginPage.tapSignUp();
      expect(await loginPage.isLoaded(), 'Should leave login after SIGN UP').to.be.false;
    });
    it('should navigate to Forgot Password screen', async () => {
      await loginPage.tapForgotPassword();
      expect(await loginPage.isLoaded(), 'Should leave login after FORGET PASSWORD').to.be.false;
    });
    it('should open Terms and Conditions', async () => {
      await loginPage.tapTermsAndConditions();
      await browser.pause(1500);
      expect(await loginPage.isLoaded(), 'Should navigate away on T&C tap').to.be.false;
    });
  });
});

// ── Full end-to-end login flow ─────────────────────────────────────────────────
//
// Run:  npx wdio config/wdio.android.conf.js --suite login
//   or: npm run test:login

describe('Full Login Flow', () => {
  before(async () => {
    await clearAndLaunch();
    if (GMAIL_CONFIGURED) {
      await purgeStaleOtps({ user: process.env.GMAIL_USER, password: process.env.GMAIL_APP_PASSWORD });
    }
    if (!await loginPage.waitForLoginScreen(60000))
      throw new Error('Login screen did not appear within 60 s');
  });

  it('should complete login → Enable Now → 2nd OTP → PIN', async function () {
    this.timeout(600000);

    // ── Step 1: credentials ───────────────────────────────────────────────────
    await loginPage.enterLoginId(testData.validUser.id);
    await loginPage.enterPassword(testData.validUser.password);
    await loginPage.tapLogin();

    // ── Step 2: first OTP ─────────────────────────────────────────────────────
    const onOTP1 = await otpPage.isLoaded(35000);
    if (!onOTP1) {
      await dumpScreen('After LOGIN — OTP screen not found');
      await loginPage.takeScreenshot('otp1-not-found');
    }
    expect(onOTP1, 'First OTP screen should appear after LOGIN').to.be.true;

    if (GMAIL_CONFIGURED) {
      // Use retry logic with automatic recovery
      const otpFetcher = createGmailOtpFetcher({
        user: process.env.GMAIL_USER,
        password: process.env.GMAIL_APP_PASSWORD,
      });
      
      await retryOtpWithDelay({
        getOtpFunction: otpFetcher,
        label: 'FIRST OTP',
        maxRetries: 3,
        delaySeconds: 5,
      });
    } else {
      // Manual OTP entry
      const otp1 = await getOtp('FIRST OTP');
      if (otp1) await otpPage.enterOTP(otp1);
      expect(await otpPage.waitForNavigation(120000), 'First OTP should be accepted').to.be.true;
    }

    // ── Step 3: Enable Globe Secure ───────────────────────────────────────────
    expect(await enableSecurePage.isLoaded(10000), 'Enable Globe Secure screen should appear').to.be.true;
    console.log('  🖱  Tapping ENABLE NOW...');
    await enableSecurePage.tapEnableNow();

    // ── Step 4: second OTP ────────────────────────────────────────────────────
    expect(await otpPage.isLoaded(20000), 'Second OTP screen should appear').to.be.true;
    
    if (GMAIL_CONFIGURED) {
      // Use retry logic with automatic recovery
      const otpFetcher = createGmailOtpFetcher({
        user: process.env.GMAIL_USER,
        password: process.env.GMAIL_APP_PASSWORD,
      });
      
      await retryOtpWithDelay({
        getOtpFunction: otpFetcher,
        label: 'SECOND OTP',
        maxRetries: 3,
        delaySeconds: 5,
      });
    } else {
      // Manual OTP entry
      const otp2 = await getOtp('SECOND OTP');
      if (otp2) await otpPage.enterOTP(otp2);
      expect(await otpPage.waitForNavigation(120000), 'Second OTP should be accepted').to.be.true;
    }
    await browser.pause(1500);

    // ── Step 5: system PIN (skipped if device credential already registered) ──
    if (await biometricPage.isLoaded(8000)) {
      console.log('  ⌨  Entering PIN...');
      await biometricPage.enterPin(testData.devicePin);
      await browser.pause(1500);
    }

    // ── Step 6: home screen ───────────────────────────────────────────────────
    const onHome = await homePage.isLoaded(30000);
    if (!onHome) {
      await dumpScreen('Home not found after login');
      await loginPage.takeScreenshot('home-not-found');
    }
    expect(onHome, 'Home screen (Watchlist tab) should be visible').to.be.true;
  });
});
