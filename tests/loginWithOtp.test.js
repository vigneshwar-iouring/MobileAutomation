const DriverManager = require('../driver/DriverManager');
const SplashPage = require('../pages/SplashPage');
const LoginPage = require('../pages/LoginPage');
const permissionHandler = require('../utils/permissionHandler');
const { getLatestUid, fetchLatestOtp } = require('../utils/gmailOtpHelper');
const { createLogger, getFailedTCs } = require('../utils/logger');

const { logFile, entries } = createLogger('loginWithOtp');
console.log(`Logging this run to: ${logFile}`);

// ── Credentials ─────────────────────────────────────────────────────
const LOGIN_ID = 'TEMPMF11';
const PASSWORD = 'Globe@1234';
const LOGIN_ID2 = 'HOGC1103';
const PASSWORD2 = 'Jaya@0006';
const LOGIN_ID3 = 'TEMPMF2';
const PASSWORD3 = 'Globe@9876';
const LOGIN_ID4 = 'EKY6998';
const PASSWORD4 = 'May@2026';
const DEVICE_PASSWORD = '11111'; // device screen-lock PIN, used to confirm biometric enrollment
// ─────────────────────────────────────────────────────────────────────

// SUBMIT on the OTP screen must stay greyed out until an OTP is entered - logged as FAIL
// (picked up by getFailedTCs) rather than thrown, so the login itself still proceeds.
async function verifyOtpSubmitDisabled(loginPage, label) {
    const enabled = await loginPage.isOtpSubmitEnabled();
    console.log(enabled
        ? `${label}: SUBMIT is enabled with no OTP entered - FAIL`
        : `${label}: SUBMIT is greyed out with no OTP entered - PASS`);
}

async function run() {
    const driver = await DriverManager.getDriver();
    // Tracks whichever step is currently in progress, so if one throws, the catch block below can
    // report exactly which step never completed alongside the real error the device raised for it.
    let currentStep = 'Driver setup';

    try {
        const splashPage = new SplashPage(driver);
        const loginPage = new LoginPage(driver);

        currentStep = 'TC 1: Launching app...';
        console.log(currentStep);
        await splashPage.launch();
        await splashPage.pause(4000);

        // If a permission popup is observed, allow it; if not, proceed straight to the next step.
        await permissionHandler.dismissAllPermissions(driver);

        currentStep = 'TC 1b: Reading build version...';
        console.log(currentStep);
        const buildVersion = await splashPage.getBuildVersion().catch(() => null);
        console.log(buildVersion ? `Build version: ${buildVersion}` : 'Build version label not found - FAIL');


        currentStep = 'TC 2: Snapshotting Gmail inbox...';
        console.log(currentStep);
        let sinceUid = await getLatestUid();
        await splashPage.pause(5000);

        currentStep = 'TC 3: Entering login ID and password...';
        console.log(currentStep);
        await loginPage.enterLoginId(LOGIN_ID2);
        await loginPage.enterPassword(PASSWORD2);
        await loginPage.clickLogin();

        // Wrong credentials show a Toast here instead of advancing to OTP - it vanishes from the
        // accessibility tree well under a second after appearing, so this checks immediately
        // (polling page source internally) rather than pausing first and risking checking after
        // it's already gone. Catching it here surfaces the real cause instead of TC 4 timing out
        // on an OTP email that was never sent.
        if (await loginPage.isLoginErrorShown()) {
            throw new Error(`Login rejected by device: "${loginPage.loginErrorText}"`);
        }
        await driver.pause(1000);

        currentStep = 'TC 4: Fetching and entering login OTP...';
        console.log(currentStep);
        await verifyOtpSubmitDisabled(loginPage, 'Login OTP');
        const loginOtp = await fetchLatestOtp(sinceUid, 'One time password');
        await loginPage.enterOtp(loginOtp);
        await loginPage.clickOtpSubmit();
        await driver.pause(2000);

        // If the fetched OTP was somehow already stale/wrong by the time it's submitted, the
        // screen shows "Incorrect OTP." in place rather than advancing. Resend and retry with a freshly fetched OTP instead of
        // failing the run outright.
        if (await loginPage.isIncorrectOtpShown()) {
            currentStep = 'TC 5: Incorrect OTP shown - waiting to resend...';
            console.log(currentStep);
            const resendEnabled = await loginPage.waitForResendOtpEnabled();
            if (!resendEnabled) throw new Error('Resend OTP never became enabled after incorrect OTP');

            const resendUid = await getLatestUid();
            await loginPage.clickResendOtp();
            await driver.pause(1500);

            currentStep = 'TC 5: Fetching and entering resent OTP...';
            console.log(currentStep);
            const resentOtp = await fetchLatestOtp(resendUid, 'One time password');
            await loginPage.enterOtp(resentOtp);
            await loginPage.clickOtpSubmit();
            await driver.pause(2000);

            if (await loginPage.isIncorrectOtpShown()) {
                throw new Error('Resent OTP was also rejected as incorrect');
            }
        }

        // First-time (or reset) logins are met with a mandatory biometric-lock enrollment prompt,
        // which itself requires a second OTP and a device-credential confirmation. Guarded so this
        // test still passes cleanly on accounts where it doesn't appear.
        if (await loginPage.isEnableGlobeSecureShown()) {
            currentStep = 'TC 6: "Enable Globe Secure" prompt shown - enabling...';
            console.log(currentStep);
            sinceUid = await getLatestUid();
            await loginPage.clickEnableNow();
            await driver.pause(2000);

            currentStep = 'TC 7: Fetching and entering Enable Globe Secure OTP...';
            console.log(currentStep);
            await verifyOtpSubmitDisabled(loginPage, 'Enable Globe Secure OTP');
            const secureOtp = await fetchLatestOtp(sinceUid, 'One time password');
            await loginPage.enterOtp(secureOtp);
            await loginPage.clickOtpSubmit();
            await driver.pause(2000);

            if (await loginPage.isDeviceCredentialPromptShown()) {
                currentStep = 'TC 8: Confirming device credential...';
                console.log(currentStep);
                await loginPage.enterDevicePassword(DEVICE_PASSWORD);
                await driver.pause(2500);
            }
        }

        // "Risk Disclosure on Derivatives" is shown only on an account's very first login, but
        // surfaces once the app lands on the default Watchlist screen post-login - not right
        // after the biometric device-credential step. Give the app time to reach that screen
        // before checking, so the popup isn't missed while it's still navigating there.
        currentStep = 'TC 9: Waiting for Watchlist screen to load...';
        console.log(currentStep);
        await driver.pause(2000);

        currentStep = 'TC 9: Checking Risk Disclosure on Derivatives popup...';
        if (await loginPage.isRiskDisclosureShown(2000)) {
            console.log('Risk Disclosure on Derivatives popup shown - clicking "I Understand"...');
            await loginPage.acknowledgeRiskDisclosure();
            await driver.pause(1000);
        } else {
            console.log('Risk Disclosure on Derivatives popup not shown - proceeding');
        }

        currentStep = 'Final check: verifying home screen';
        const loggedIn = await loginPage.isLoggedIn();
        console.log(loggedIn ? 'Login successful - home screen displayed' : 'Login flow finished, but home screen was not detected');

    } catch (err) {
        console.error(`TC not executed: ${currentStep}`);
        console.error(`Real device error: ${err.message}`);
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
