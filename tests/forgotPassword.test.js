const DriverManager = require('../driver/DriverManager');
const SplashPage = require('../pages/SplashPage');
const LoginPage = require('../pages/LoginPage');
const ForgotPasswordPage = require('../pages/ForgotPasswordPage');
const permissionHandler = require('../utils/permissionHandler');
const { getLatestUid, fetchLatestOtp } = require('../utils/gmailOtpHelper');
const { createLogger, getFailedTCs } = require('../utils/logger');

const { logFile, entries } = createLogger('forgotPassword');
console.log(`Logging this run to: ${logFile}`);

// ── Fill in your passwords before running ──────────────────────────
const NEW_PASSWORD = 'Globe@1234';
const CONFIRM_PASSWORD = 'Globe@1234';
// ───────────────────────────────────────────────────────────────────

async function run() {
    const driver = await DriverManager.getDriver();

    try {
        const splashPage = new SplashPage(driver);
        const loginPage = new LoginPage(driver);
        const forgotPage = new ForgotPasswordPage(driver);

        // TC 1: Relaunch app
        console.log('TC 1: Relaunching app...');
        await splashPage.relaunch();
        await splashPage.pause(8000);
        await permissionHandler.dismissAllPermissions(driver);
        console.log('App ready on login page');

        // TC 2: Tap Forgot Password
        console.log('TC 2: Tapping Forgot Password...');
        await loginPage.clickForgotPassword();
        await driver.pause(2000);
        console.log('Navigated to Forgot Password page');

        // TC 3: Snapshot inbox BEFORE triggering OTP
        console.log('TC 3: Snapshotting Gmail inbox...');
        const sinceUid = await getLatestUid();

        // TC 4: Enter login ID → click Next
        console.log('TC 4: Entering login ID and clicking Next...');
        await forgotPage.clickLoginIdField();
        await forgotPage.enterLoginId('TEMPMF11');
        await forgotPage.clickNext();
        await driver.pause(3000);
        console.log('Navigated to Set Password page');

        // TC 5: Fetch OTP from Gmail
        console.log('TC 5: Fetching OTP from Gmail...');
        const otp = await fetchLatestOtp(sinceUid, 'One time password');
        console.log(`OTP fetched: ${otp}`);

        // TC 6: Enter OTP digit by digit
        console.log('TC 6: Entering OTP...');
        await forgotPage.enterOtp(otp);
        await driver.pause(2000);

        // TC 7: Enter new password — click field first to ensure focus
        console.log('TC 7: Entering new password...');
        await forgotPage.enterNewPassword(NEW_PASSWORD);
        await driver.pause(1500);
        console.log(`New password entered: ${NEW_PASSWORD}`);

        // TC 8: Scroll down, enter confirm password — click field first to ensure focus
        console.log('TC 8: Entering confirm password...');
        await forgotPage.enterConfirmPassword(CONFIRM_PASSWORD);
        await driver.pause(1500);
        console.log(`Confirm password entered: ${CONFIRM_PASSWORD}`);

        // TC 9: Click Submit only after both passwords are filled
        console.log('TC 9: Clicking Submit...');
        await forgotPage.clickSubmit();
        await driver.pause(4000);

        // TC 10: Click Continue on the success screen
        console.log('TC 10: Clicking Continue...');
        await forgotPage.clickContinue();
        console.log('Done — password reset complete');

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

run();
