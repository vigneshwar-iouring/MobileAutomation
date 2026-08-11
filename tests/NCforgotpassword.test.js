const fs = require('fs');
const DriverManager = require('../driver/DriverManager');
const SplashPage = require('../pages/SplashPage');
const LoginPage = require('../pages/LoginPage');
const ForgotPasswordPage = require('../pages/ForgotPasswordPage');
const permissionHandler = require('../utils/permissionHandler');
const { getLatestUid, fetchLatestOtp } = require('../utils/gmailOtpHelper');
const { createLogger } = require('../utils/logger');

const { logFile } = createLogger('NCforgotpassword');
console.log(`Logging this run to: ${logFile}`);

const NEW_PASSWORD = 'Globe@123';
const CONFIRM_PASSWORD = 'Globe@123';

//Scenario 1 - Validation of Forgot password with empty Login ID
async function scenario1_EmptyLoginId(driver, splashPage, loginPage, forgotPage) {
    // Step 1: Launch app
    console.log('Step 1: Launching app...');
    await splashPage.pause(8000);
    await permissionHandler.dismissAllPermissions(driver);
    await driver.pause(2000);
    console.log('App ready on login page');

    // Step 2: Tap Forgot Password
    console.log('Step 2: Tapping Forgot Password...');
    await loginPage.clickForgotPassword();
    await driver.pause(2000);

    // Step 3: Click Next with empty login ID → print error
    console.log('Step 3: Clicking Next with empty login ID...');
    await forgotPage.clickNext();
    await driver.pause(1500);
    const emptyError = await forgotPage.getErrorMessage();
    if (emptyError) {
        console.log(`✔ Empty login ID error: "${emptyError}"`);
    } else {
        console.log('✘ Expected error not displayed for empty login ID');
    }

    // Step 4: Tap back navigation button
    console.log('Step 4: Tapping back navigation button...');
    await driver.pressKeyCode(4);
    await driver.pause(2000);
    console.log('Navigated back to login page');
}

//Scenario 2 - Validation of Forgot password with invalid Login ID
async function scenario2_InvalidLoginId(driver, loginPage, forgotPage) {
    // Step 5: Tap Forgot Password again
    console.log('Step 5: Tapping Forgot Password again...');
    await loginPage.clickForgotPassword();
    await driver.pause(2000);

    // Step 6: Enter ABCD@1234 → Next → error → print → back → Forgot Password again
    console.log('Step 6: Entering invalid username ABCD@1234...');
    await forgotPage.clickLoginIdField();
    await forgotPage.enterLoginId('ABCD@1234');
    await forgotPage.clickNext();
    await driver.pause(4000);
    const abcdError = await forgotPage.getAnyError();
    if (abcdError) {
        console.log(`✔ Step 6 error: "${abcdError}"`);
    } else {
        console.log('✘ No error found for ABCD@123');
    }

    // Navigate back to login page → Forgot Password again
    await driver.pressKeyCode(4);
    await driver.pause(2000);
}

//Scenario 3 - Validation of Forgot password with mismatch of password
async function scenario3_MismatchedPasswords(driver, loginPage, forgotPage) {
    // Try Forgot Password; if not on login page yet, press back one more time
    try {
        await loginPage.clickForgotPassword();
    } catch (_) {
        await driver.pressKeyCode(4);
        await driver.pause(2000);
        await loginPage.clickForgotPassword();
    }
    await driver.pause(2000);

    // Enter TEMPMF11 to reach Set Password page
    console.log('Entering TEMPMF11 to reach Set Password page...');
    await forgotPage.clickLoginIdField();
    await forgotPage.enterLoginId('TEMPMF11');
    await forgotPage.clickNext();
    await driver.pause(3000);
    const src = await driver.getPageSource();
    console.log('On Set Password page (TEMPMF11)');

    // Step 7: Enter OTP '123456'
    console.log('Step 7: Entering OTP 123456...');
    await forgotPage.enterOtp('123456');
    await driver.pause(500);

    // Step 8: Enter new password 'qwert'
    console.log('Step 8: Entering new password qwert...');
    await forgotPage.enterNewPassword('qwerty');
    await driver.pause(500);

    // Step 9: Enter confirm password 'qwert'
    console.log('Step 9: Entering confirm password qwert...');
    await forgotPage.enterConfirmPassword('qwert');
    await driver.pause(500);

    // Step 10: Click Submit → print error
    console.log('Step 10: Clicking Submit...');
    await forgotPage.clickSubmit();
    await driver.pause(4000);
    const submitError1 = await forgotPage.getOtpErrorMessage();
    if (submitError1) {
        console.log(`✔ Step 10 error: "${submitError1}"`);
    } else {
        console.log('✘ No error message found after submit (step 10)');
    }

    // Navigate back to login page → Forgot Password again
    console.log('Navigating back to login page...');
    await driver.pressKeyCode(4);
    await driver.pressKeyCode(4);
    await driver.pause(2000);
}

//Scenario 4 - Validation of Forgot password with valid Login ID and invalid OTP
async function scenario4_InvalidOtp(driver, loginPage, forgotPage) {
    try {
        await loginPage.clickForgotPassword();
    } catch (_) {
        await driver.pressKeyCode(4);
        await driver.pause(2000);
        await loginPage.clickForgotPassword();
    }
    await driver.pause(2000);

    // Step 11: Enter valid login ID 'TEMPMF11' → click Next
    console.log('Step 11: Entering valid login ID TEMPMF11...');
    await forgotPage.clickLoginIdField();
    await forgotPage.enterLoginId('TEMPMF11');
    await forgotPage.clickNext();
    await driver.pause(3000);
    console.log('On Set Password page (TEMPMF11)');

    // Step 12: Enter invalid OTP '123456'
    console.log('Step 12: Entering invalid OTP 123456...');
    await forgotPage.enterOtp('123456');
    await driver.pause(500);

    // Step 13: Enter new password 'Globe@123456'
    console.log('Step 13: Entering new password Globe@123456...');
    await forgotPage.enterNewPassword('Globe@123456');
    await driver.pause(500);

    // Step 14: Enter confirm password 'Globe@123456'
    console.log('Step 14: Entering confirm password Globe@123456...');
    await forgotPage.enterConfirmPassword('Globe@123456');
    await driver.pause(500);

    // Step 15: Click Submit → print error
    console.log('Step 15: Clicking Submit...');
    await forgotPage.clickSubmit();
    await driver.pause(4000);
    const submitError2 = await forgotPage.getOtpErrorMessage();
    if (submitError2) {
        console.log(`✔ Step 15 error: "${submitError2}"`);
    } else {
        console.log('✘ No error message found after submit (step 15)');
    }
}

//Sceanario 5 - Validation of Forgot password with valid Login ID and valid OTP
async function scenario5_HappyPath(driver, loginPage, forgotPage) {
    // Step 16: Normal forgot password flow (happy path)
    console.log('Step 16: Starting normal forgot password flow...');
    await driver.pressKeyCode(4);
    await driver.pressKeyCode(4);
    await driver.pause(2000);
    try {
        await loginPage.clickForgotPassword();
    } catch (_) {
        await driver.pressKeyCode(4);
        await driver.pause(2000);
        await loginPage.clickForgotPassword();
    }
    await driver.pause(2000);

    // Snapshot inbox before triggering OTP send
    const sinceUid = await getLatestUid();

    await forgotPage.clickLoginIdField();
    await forgotPage.enterLoginId('TEMPMF11');
    await forgotPage.clickNext();
    await driver.pause(3000);

    console.log('Fetching OTP from Gmail...');
    const otp = await fetchLatestOtp(sinceUid, 'One time password');
    console.log(`OTP fetched: ${otp}`);

    await forgotPage.enterOtp(otp);
    await driver.pause(1000);

    await forgotPage.enterNewPassword(NEW_PASSWORD);
    await driver.pause(1000);

    await forgotPage.enterConfirmPassword(CONFIRM_PASSWORD);
    await driver.pause(1000);

    await forgotPage.clickSubmit();
    await driver.pause(4000);

    await forgotPage.clickContinue();
    console.log('Done — password reset complete');
}

async function run() {
    const driver = await DriverManager.getDriver();

    try {
        const splashPage = new SplashPage(driver);
        const loginPage = new LoginPage(driver);
        const forgotPage = new ForgotPasswordPage(driver);

        await scenario1_EmptyLoginId(driver, splashPage, loginPage, forgotPage);
        await scenario2_InvalidLoginId(driver, loginPage, forgotPage);
        await scenario3_MismatchedPasswords(driver, loginPage, forgotPage);
        await scenario4_InvalidOtp(driver, loginPage, forgotPage);
        await scenario5_HappyPath(driver, loginPage, forgotPage);

    } catch (err) {
        console.error('Test failed:', err.message);
        console.error(err.stack);
    } finally {
        await DriverManager.closeDriver();
    }
}

run();
