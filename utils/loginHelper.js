const loginPage        = require('../pages/Login/LoginPage');
const otpPage          = require('../pages/Login/OTPPage');
const enableSecurePage = require('../pages/Login/EnableSecurePage');
const biometricPage    = require('../pages/Login/BiometricSetupPage');
const testData         = require('../data/testData');
const { purgeStaleOtps }                    = require('./emailOtp');
const { retryOtpWithDelay, createGmailOtpFetcher } = require('./otpRetry');
const { clearAndLaunch, dumpScreen }        = require('./helpers');

const GMAIL_CONFIGURED = !!(process.env.GMAIL_USER && process.env.GMAIL_APP_PASSWORD);

async function doLogin() {
  await clearAndLaunch();

  if (GMAIL_CONFIGURED) {
    await purgeStaleOtps({ user: process.env.GMAIL_USER, password: process.env.GMAIL_APP_PASSWORD });
  }

  if (!await loginPage.waitForLoginScreen(60000))
    throw new Error('Login screen did not appear within 60 s');

  await loginPage.enterLoginId(testData.validUser.id);
  await loginPage.enterPassword(testData.validUser.password);
  await loginPage.tapLogin();

  // First OTP
  const onOTP1 = await otpPage.isLoaded(35000);
  if (!onOTP1) await dumpScreen('loginHelper: OTP1 not found');
  if (!onOTP1) throw new Error('First OTP screen did not appear');

  if (GMAIL_CONFIGURED) {
    const fetcher = createGmailOtpFetcher({ user: process.env.GMAIL_USER, password: process.env.GMAIL_APP_PASSWORD });
    await retryOtpWithDelay({ getOtpFunction: fetcher, label: 'FIRST OTP', maxRetries: 3, delaySeconds: 5 });
  } else {
    console.log('\n  📱 ENTER FIRST OTP ON YOUR DEVICE NOW (2 min)\n');
    await otpPage.waitForNavigation(120000);
  }

  // Enable Globe Secure
  if (!await enableSecurePage.isLoaded(10000)) throw new Error('Enable Globe Secure screen not found');
  await enableSecurePage.tapEnableNow();

  // Second OTP
  if (!await otpPage.isLoaded(20000)) throw new Error('Second OTP screen did not appear');

  if (GMAIL_CONFIGURED) {
    const fetcher = createGmailOtpFetcher({ user: process.env.GMAIL_USER, password: process.env.GMAIL_APP_PASSWORD });
    await retryOtpWithDelay({ getOtpFunction: fetcher, label: 'SECOND OTP', maxRetries: 3, delaySeconds: 5 });
  } else {
    console.log('\n  📱 ENTER SECOND OTP ON YOUR DEVICE NOW (2 min)\n');
    await otpPage.waitForNavigation(120000);
  }

  await browser.pause(1500);

  // The biometric auth screen can appear up to ~12 s after OTP acceptance.
  // It may show face/touch overlay first — cancel that and fall back to PIN.
  if (await biometricPage.isLoaded(15000)) {
    const handledOverlay = await biometricPage.handleBiometricAuth(testData.devicePin);
    if (!handledOverlay) {
      // Direct PIN screen (no face/touch overlay) — enter PIN immediately
      await biometricPage.enterPin(testData.devicePin);
    }
    await browser.pause(1500);
  }
}

module.exports = { doLogin };
