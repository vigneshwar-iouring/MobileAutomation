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
const NEW_PASSWORD = 'Globe@67890';
const CONFIRM_PASSWORD = 'Globe@67890';
// ───────────────────────────────────────────────────────────────────

async function run() {
    const driver = await DriverManager.getDriver();

    try {
        const splashPage = new SplashPage(driver);
        const loginPage = new LoginPage(driver);
        const forgotPage = new ForgotPasswordPage(driver);

        // TC 1: Relaunch app
        // relaunch, not launch: activateApp alone resumes wherever a previous run stopped (e.g. mid
        // Set Password), and Forgot Password isn't reachable from there.
        console.log('TC 1: launching app...');
        await splashPage.launch();
        await splashPage.pause(8000);
        await permissionHandler.dismissAllPermissions(driver);
        console.log('App ready on login page');

        console.log('TC 1b: Reading build version...');
        const buildVersion = await splashPage.getBuildVersion().catch(() => null);
        console.log(buildVersion ? `Build version: ${buildVersion}` : 'Build version label not found - FAIL');

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
        await forgotPage.enterLoginId('TEMPMF2');
        await forgotPage.clickNext();
        await driver.pause(3000);
        console.log('Navigated to OTP page');

        // TC 5: Fetch OTP from Gmail
        console.log('TC 5: Fetching OTP from Gmail...');
        const otp = await fetchLatestOtp(sinceUid, 'One time password');
        console.log(`OTP fetched: ${otp}`);

        // TC 6: Enter OTP digit by digit - the app auto-clicks Verify OTP and moves on to Set Password
        console.log('TC 6: Entering OTP (Verify OTP is auto-clicked)...');
        await forgotPage.enterOtp(otp);
        await driver.pause(4000);
        if (await forgotPage.isOnOtpScreen()) {
            const otpError = await forgotPage.getOtpErrorMessage();
            throw new Error(`OTP was not accepted by Verify OTP${otpError ? `: "${otpError}"` : ''}`);
        }
        console.log('Navigated to Set Password page');

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
        const toastShown = await forgotPage.submitAndWaitForResetSuccess();

        // TC 10: A successful reset shows a "Password reset successful" toast and returns to login.
        console.log('TC 10: Verifying "Password reset successful" toast...');
        if (toastShown) {
            console.log('✔ "Password reset successful" toast shown');
        } else {
            console.error('FAIL: "Password reset successful" toast not shown after Submit');
        }

        // TC 11: Back on the login screen
        console.log('TC 11: Verifying return to login screen...');
        await driver.pause(1500);
        if (await loginPage.isElementVisible(loginPage.forgotPasswordLink, 5000)) {
            console.log('✔ Back on login screen - password reset complete');
        } else {
            await forgotPage.dumpPage('fp_after_submit');
            const err = await forgotPage.getOtpErrorMessage();
            console.error(`FAIL: not on login screen after Submit${err ? ` - screen shows: "${err}"` : ''}`);
        }

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
