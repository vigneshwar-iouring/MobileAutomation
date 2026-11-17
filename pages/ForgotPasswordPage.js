const BasePage = require('./BasePage');

class ForgotPasswordPage extends BasePage {
    constructor(driver) {
        super(driver);

        // Forgot Password login ID entry screen
        this.header = 'android=new UiSelector().descriptionContains("Enter your login ID")';
        this.loginIdInput = 'android=new UiSelector().description("Login ID, Double tap to enter your login ID")';
        this.loginIdEditText = 'android=new UiSelector().className("android.widget.EditText").instance(0)';
        this.nextButton = 'android=new UiSelector().descriptionContains("NEXT")';
        this.errorText = 'android=new UiSelector().descriptionContains("Login ID cannot be empty")';

        // OTP screen - its own step now (after NEXT, before Set Password), with a single OTP
        // EditText and a "Verify OTP" button. The app clicks Verify OTP by itself once the full
        // OTP is entered and navigates on - it's never tapped here.
        this.otpInput = 'android=new UiSelector().className("android.widget.EditText").instance(0)';
        // Matched by prefix, not exact desc: an exact description("Verify OTP") silently misses if the
        // node carries an accessibility hint suffix, which made isOnOtpScreen() always false.
        this.verifyOtpButton = 'android=new UiSelector().descriptionMatches("(?i)^verify otp.*")';
        // Same in-place error text the login OTP screen shows for a wrong OTP (LoginPage.incorrectOtpText).
        this.incorrectOtpText = 'android=new UiSelector().descriptionContains("Incorrect OTP")';

        // Set Password screen (ui_dumps/fp_launch_state.xml) holds the OTP, New Password and
        // Confirm Password EditTexts together. "New Password"/"Confirm Password" are placeholder
        // label Views drawn *over* their EditText, not the input itself - setValue() on the label
        // is silently a no-op (Submit then shows "Please enter a new password"). The input is found
        // as the EditText whose bounds contain the label (see findInputByLabel()).
        this.newPasswordLabel = 'New Password';
        this.confirmPasswordLabel = 'Confirm Password';
        this.submitButton = 'android=new UiSelector().descriptionContains("SUBMIT")';
        // A successful Submit returns straight to the login screen with this toast - there is no
        // success screen / CONTINUE button.
        this.resetSuccessToastText = 'Password reset successful';
    }

    async getHeaderText() {
        const el = await this.driver.$(this.header);
        await el.waitForDisplayed({ timeout: 5000 });
        return await el.getAttribute('content-desc');
    }

    async dumpCurrentPage() {
        console.log('\n--- Page Dump ---');
        try {
            const src = await this.driver.getPageSource();
            // Extract all content-desc values from XML
            const descMatches = [...src.matchAll(/content-desc="([^"]+)"/g)].map(m => m[1]).filter(d => d.trim());
            if (descMatches.length > 0) {
                console.log('  content-descs: ' + descMatches.slice(0, 15).join(' | '));
            }
            // Extract all text values
            const textMatches = [...src.matchAll(/\btext="([^"]+)"/g)].map(m => m[1]).filter(t => t.trim());
            if (textMatches.length > 0) {
                console.log('  texts: ' + textMatches.slice(0, 15).join(' | '));
            }
            // Count element types
            const editCount = (src.match(/android\.widget\.EditText/g) || []).length;
            const viewCount = (src.match(/android\.view\.View/g) || []).length;
            console.log(`  EditTexts: ${editCount}, Views: ${viewCount}`);
        } catch (e) { console.log('  Page source error: ' + e.message); }
        console.log('-----------------\n');
    }

    async getAnyError() {
        try {
            const src = await this.driver.getPageSource();
            const skipPatterns = ['login id', 'enter your login', 'next', 'forgot', 'otp', 'new password', 'confirm', 'set password', 'submit', 'verify otp', 'resend', 'back', 'globe capital'];
            // Check content-desc attributes
            const descs = [...src.matchAll(/content-desc="([^"]+)"/g)].map(m => m[1].trim()).filter(d => {
                const lower = d.toLowerCase();
                return d && !skipPatterns.some(p => lower.startsWith(p) || lower === p);
            });
            if (descs.length > 0) return descs[0];
            // Check text attributes
            const texts = [...src.matchAll(/\btext="([^"]+)"/g)].map(m => m[1].trim()).filter(t => t.length > 3);
            if (texts.length > 0) return texts[0];
        } catch (_) { }
        return null;
    }

    async clickLoginIdField() {
        await this.click(this.loginIdInput, 20000);
        console.log('Clicked login ID field');
    }

    async enterLoginId(loginId) {
        const el = await this.driver.$(this.loginIdInput);
        await el.waitForDisplayed({ timeout: 10000 });
        await el.click();
        await this.driver.pause(1000);
        // Try EditText clearValue first
        try {
            const editEl = await this.driver.$(this.loginIdEditText);
            await editEl.clearValue();
        } catch (_) { }
        // Also send backspaces to clear any residual text in View-based fields
        for (let i = 0; i < 20; i++) {
            await this.driver.keys('');
            await this.driver.pause(30);
        }
        await this.driver.pause(200);
        for (const char of loginId) {
            await this.driver.keys(char);
            await this.driver.pause(50);
        }
        console.log('Entered login ID: ' + loginId);
    }

    async clickNext() {
        await this.driver.hideKeyboard();
        await this.click(this.nextButton);
    }

    async getErrorMessage() {
        try {
            const el = await this.driver.$(this.errorText);
            await el.waitForDisplayed({ timeout: 5000 });
            return await el.getAttribute('content-desc');
        } catch (_) {
            return null;
        }
    }

    async enterOtp(otp) {
        // Try EditText first (first visit to the OTP screen); fall back to View + driver.keys
        try {
            const el = await this.driver.$(this.otpInput);
            await el.waitForDisplayed({ timeout: 3000 });
            await el.click();
        } catch (_) {
            console.log('[enterOtp] EditText not found, trying View fallback...');
            let clicked = false;
            for (const pat of ['OTP', 'otp', 'One Time', 'Otp', 'Enter OTP']) {
                try {
                    const el = await this.driver.$(`android=new UiSelector().descriptionContains("${pat}").clickable(true)`);
                    await el.waitForDisplayed({ timeout: 2000 });
                    await el.click();
                    clicked = true;
                    console.log('[enterOtp] Clicked View with pattern: ' + pat);
                    break;
                } catch (_2) { }
            }
            if (!clicked) console.log('[enterOtp] WARNING: OTP field not found by any pattern, typing blindly');
        }
        await this.driver.pause(300);
        for (const digit of otp.toString()) {
            await this.driver.keys(digit);
            await this.driver.pause(150);
        }
        console.log('Entered OTP: ' + otp);
    }

    async clearAndEnterOtp(otp) {
        try {
            const el = await this.driver.$(this.otpInput);
            await el.waitForDisplayed({ timeout: 3000 });
            await el.click();
        } catch (_) { }
        await this.driver.pause(300);
        for (let i = 0; i < 6; i++) {
            await this.driver.keys('');
            await this.driver.pause(100);
        }
        await this.driver.pause(300);
        for (const digit of otp.toString()) {
            await this.driver.keys(digit);
            await this.driver.pause(150);
        }
        console.log('Cleared and entered OTP: ' + otp);
    }

    // Returns an error/validation message on the OTP or Set Password screen, or null. Previously this
    // returned the first unlabelled View, which was the back arrow ("Back, Double tap to go back") -
    // so TC 10/TC 13 "passed" without any real error being shown. Interactive controls carry a
    // "Double tap to ..." hint and are never the error text, so they're skipped too.
    async getOtpErrorMessage() {
        try {
            if (await this.isElementVisible(this.incorrectOtpText, 1000)) {
                const el = await this.driver.$(this.incorrectOtpText);
                return (await el.getAttribute('content-desc')).trim();
            }
            const src = await this.driver.getPageSource();
            const knownLabels = ['set password', 'otp', 'verify otp', 'verification code', 'new password',
                'confirm password', 'resend otp', 'submit', 'back', 'forgot', 'globe capital'];
            const descs = [...src.matchAll(/content-desc="([^"]+)"/g)].map(m => m[1].trim());
            for (const desc of descs) {
                const lower = desc.toLowerCase();
                if (!lower || lower.includes('double tap')) continue;
                if (knownLabels.some(l => lower.startsWith(l))) continue;
                return desc;
            }
        } catch (_) { }
        return null;
    }

    // Saves the current page source to ui_dumps/<name>.xml and logs its content-descs, so a run
    // records what the screen actually showed at a step whose outcome isn't captured yet.
    async dumpPage(name) {
        const fs = require('fs');
        const path = require('path');
        try {
            const src = await this.driver.getPageSource();
            const file = path.join(__dirname, '..', 'ui_dumps', `${name}.xml`);
            fs.writeFileSync(file, src);
            const descs = [...src.matchAll(/content-desc="([^"]+)"/g)].map(m => m[1].trim()).filter(Boolean);
            console.log(`Saved page source to ${file}`);
            console.log(`  content-descs: ${descs.join(' | ') || '(none)'}`);
            return descs;
        } catch (e) {
            console.log(`dumpPage(${name}) failed: ${e.message}`);
            return [];
        }
    }

    async isSubmitVisible(timeout = 2000) {
        await this.driver.hideKeyboard().catch(() => { });
        return await this.isElementVisible(this.submitButton, timeout);
    }

    // True while still on the OTP screen (e.g. after an invalid OTP was rejected), false once the
    // auto-clicked Verify OTP has moved on to Set Password. Like the login OTP screen, Verify OTP drops out of
    // the accessibility tree while the keyboard is open, so hide it first.
    async isOnOtpScreen(timeout = 3000) {
        await this.driver.hideKeyboard().catch(() => { });
        return await this.isElementVisible(this.verifyOtpButton, timeout);
    }

    // Returns the EditText under the label View with this exact content-desc: the one whose bounds
    // contain the label's centre, or else (if the label has floated up onto the field's border once
    // it has text) the EditText vertically nearest to it.
    async findInputByLabel(label, timeout = 5000) {
        const labelEl = await this.driver.$(`android=new UiSelector().description("${label}")`);
        await labelEl.waitForDisplayed({ timeout });
        const lr = await this.driver.getElementRect(labelEl.elementId);
        const cx = lr.x + lr.width / 2;
        const cy = lr.y + lr.height / 2;
        const inputs = await this.driver.$$('android=new UiSelector().className("android.widget.EditText")');
        let best = null;
        let bestDist = Infinity;
        for (const input of inputs) {
            const r = await this.driver.getElementRect(input.elementId);
            if (cx >= r.x && cx <= r.x + r.width && cy >= r.y && cy <= r.y + r.height) return input;
            const dist = Math.abs(cy - (r.y + r.height / 2));
            if (dist < bestDist) { bestDist = dist; best = input; }
        }
        if (!best) throw new Error(`No EditText found for label "${label}"`);
        return best;
    }

    // Focuses the input, clears it, then types with real key events (like enterLoginId/enterOtp),
    // since Compose can accept setValue() without its form state changing.
    async typeIntoLabelledInput(label, value) {
        await this.driver.hideKeyboard().catch(() => { });
        await this.driver.pause(500);
        const input = await this.findInputByLabel(label);
        await input.click();
        await this.driver.pause(300);
        await input.clearValue().catch(() => { });
        for (const char of value) {
            await this.driver.keys(char);
            await this.driver.pause(80);
        }
    }

    async enterNewPassword(password) {
        await this.typeIntoLabelledInput(this.newPasswordLabel, password);
        console.log('Entered new password: ' + password);
    }

    async enterConfirmPassword(password) {
        await this.typeIntoLabelledInput(this.confirmPasswordLabel, password);
        console.log('Entered confirm password: ' + password);
    }

    async clickSubmit() {
        await this.driver.hideKeyboard().catch(() => { });
        await this.click(this.submitButton);
        console.log('Clicked Submit');
    }

    // Taps SUBMIT and watches for the "Password reset successful" toast starting straight after
    // the tap (it's short-lived, so a pause before checking would miss it). enableMultiWindows
    // makes system Toast windows visible in the page source (same as BasketPage's toast checks).
    async submitAndWaitForResetSuccess(timeout = 6000) {
        await this.driver.hideKeyboard().catch(() => { });
        await this.driver.updateSettings({ enableMultiWindows: true }).catch(() => { });
        try {
            await this.click(this.submitButton);
            console.log('Clicked Submit');
            return await this.waitForToast(this.resetSuccessToastText, { timeout, interval: 150 });
        } finally {
            await this.driver.updateSettings({ enableMultiWindows: false }).catch(() => { });
        }
    }
}

module.exports = ForgotPasswordPage;
