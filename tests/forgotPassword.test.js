const DriverManager = require('../driver/DriverManager');
const SplashPage = require('../pages/SplashPage');
const LoginPage = require('../pages/LoginPage');
const ForgotPasswordPage = require('../pages/ForgotPasswordPage');
const permissionHandler = require('../utils/permissionHandler');
const { getLatestUid, fetchLatestOtp } = require('../utils/gmailOtpHelper');
const { createLogger } = require('../utils/logger');

const { logFile } = createLogger('forgotPassword');
console.log(`Logging this run to: ${logFile}`);

// ── Fill in your passwords before running ──────────────────────────
const NEW_PASSWORD = 'Globe@123456';
const CONFIRM_PASSWORD = 'Globe@123456';
// ───────────────────────────────────────────────────────────────────

async function run() {
    const driver = await DriverManager.getDriver();

    try {
        const splashPage = new SplashPage(driver);
        const loginPage = new LoginPage(driver);
        const forgotPage = new ForgotPasswordPage(driver);

        // Step 1: Relaunch app
        console.log('Step 1: Relaunching app...');
        await splashPage.relaunch();
        await splashPage.pause(8000);
        await permissionHandler.dismissAllPermissions(driver);
        console.log('App ready on login page');

        // Step 2: Tap Forgot Password
        console.log('Step 2: Tapping Forgot Password...');
        await loginPage.clickForgotPassword();
        await driver.pause(2000);
        console.log('Navigated to Forgot Password page');

        // Step 3: Snapshot inbox BEFORE triggering OTP
        console.log('Step 3: Snapshotting Gmail inbox...');
        const sinceUid = await getLatestUid();

        // Step 4: Enter login ID → click Next
        console.log('Step 4: Entering login ID and clicking Next...');
        await forgotPage.clickLoginIdField();
        await forgotPage.enterLoginId('TEMPMF11');
        await forgotPage.clickNext();
        await driver.pause(3000);
        console.log('Navigated to Set Password page');

        // Step 5: Print page header and available fields
        await forgotPage.printSetPasswordHeader();
        await forgotPage.printFieldNames();

        // Step 6: Fetch OTP from Gmail
        console.log('Step 6: Fetching OTP from Gmail...');
        const otp = await fetchLatestOtp(sinceUid, 'One time password');
        console.log(`OTP fetched: ${otp}`);

        // Step 7: Enter OTP digit by digit
        console.log('Step 7: Entering OTP...');
        await forgotPage.enterOtp(otp);
        await driver.pause(2000);

        // Step 8: Enter new password — click field first to ensure focus
        console.log('Step 8: Entering new password...');
        await forgotPage.enterNewPassword(NEW_PASSWORD);
        await driver.pause(1500);
        console.log(`New password entered: ${NEW_PASSWORD}`);

        // Step 9: Scroll down, enter confirm password — click field first to ensure focus
        console.log('Step 9: Entering confirm password...');
        await forgotPage.enterConfirmPassword(CONFIRM_PASSWORD);
        await driver.pause(1500);
        console.log(`Confirm password entered: ${CONFIRM_PASSWORD}`);

        // Step 10: Click Submit only after both passwords are filled
        console.log('Step 10: Clicking Submit...');
        await forgotPage.clickSubmit();
        await driver.pause(4000);

        // Step 11: Click Continue on the success screen
        console.log('Step 11: Clicking Continue...');
        await forgotPage.clickContinue();
        console.log('Done — password reset complete');

    } catch (err) {
        console.error('Test failed:', err.message);
        console.error(err.stack);
    } finally {
        await DriverManager.closeDriver();
    }
}

run();
