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

        // Set Password screen
        this.otpInput = 'android=new UiSelector().className("android.widget.EditText").instance(0)';
        this.newPasswordInput = 'android=new UiSelector().className("android.widget.EditText").instance(1)';
        this.confirmPasswordInput = 'android=new UiSelector().className("android.widget.EditText").instance(2)';
        this.submitButton = 'android=new UiSelector().descriptionContains("SUBMIT")';
        this.continueButton = 'android=new UiSelector().descriptionContains("CONTINUE")';
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
            const skipPatterns = ['login id', 'enter your login', 'next', 'forgot', 'otp', 'new password', 'confirm', 'set password', 'submit', 'resend', 'back', 'globe capital'];
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

    async printSetPasswordHeader() {
        console.log('\n--- Set Password Page Header ---');
        try {
            const textViews = await this.driver.$$('android=new UiSelector().className("android.widget.TextView")');
            for (const el of textViews) {
                const text = await el.getAttribute('text').catch(() => '');
                const desc = await el.getAttribute('content-desc').catch(() => '');
                const value = text || desc;
                if (value && value.trim()) console.log('  Header text: "' + value.trim() + '"');
            }
        } catch (e) {
            console.log('  (Could not read TextViews: ' + e.message + ')');
        }
        try {
            const views = await this.driver.$$('android=new UiSelector().className("android.view.View")');
            let printed = 0;
            for (const el of views) {
                const desc = await el.getAttribute('content-desc').catch(() => '');
                if (desc && desc.trim() && printed < 5) {
                    console.log('  Page element: "' + desc.trim() + '"');
                    printed++;
                }
            }
        } catch (e) { }
        console.log('--------------------------------\n');
    }

    async printFieldNames() {
        console.log('\n--- Set Password Page: Available Fields ---');
        try {
            const fields = await this.driver.$$('android=new UiSelector().className("android.widget.EditText")');
            if (fields.length === 0) console.log('  (No input fields found)');
            for (let i = 0; i < fields.length; i++) {
                const hint = await fields[i].getAttribute('hint').catch(() => '');
                const text = await fields[i].getAttribute('text').catch(() => '');
                const desc = await fields[i].getAttribute('content-desc').catch(() => '');
                console.log('  Field[' + i + ']: hint="' + hint + '"  text="' + text + '"  content-desc="' + desc + '"');
            }
        } catch (e) {
            console.log('  (Could not read fields: ' + e.message + ')');
        }
        console.log('------------------------------------------\n');
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
        // Try EditText first (first visit to Set Password); fall back to View + driver.keys
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

    async getOtpErrorMessage() {
        try {
            const views = await this.driver.$$('android=new UiSelector().className("android.view.View")');
            const knownLabels = ['set password', 'otp', 'new password', 'confirm password', 'resend otp'];
            for (const el of views) {
                const desc = (await el.getAttribute('content-desc').catch(() => '')) || '';
                const lower = desc.trim().toLowerCase();
                if (lower && !knownLabels.some(l => lower.startsWith(l))) {
                    return desc.trim();
                }
            }
        } catch (_) { }
        return null;
    }

    async enterNewPassword(password) {
        await this.driver.hideKeyboard().catch(() => { });
        await this.driver.pause(500);
        try {
            const el = await this.driver.$(this.newPasswordInput);
            await el.waitForDisplayed({ timeout: 3000 });
            await el.click();
            await this.driver.pause(300);
            await el.clearValue();
            await el.setValue(password);
        } catch (_) {
            console.log('[enterNewPassword] EditText not found, trying View fallback...');
            let clicked = false;
            for (const pat of ['New Password', 'New password', 'new password', 'Password']) {
                try {
                    const el = await this.driver.$(`android=new UiSelector().descriptionContains("${pat}").clickable(true)`);
                    await el.waitForDisplayed({ timeout: 2000 });
                    await el.click();
                    clicked = true;
                    console.log('[enterNewPassword] Clicked View with pattern: ' + pat);
                    break;
                } catch (_2) { }
            }
            if (!clicked) console.log('[enterNewPassword] WARNING: field not found, typing via keys');
            await this.driver.pause(300);
            for (const char of password) {
                await this.driver.keys(char);
                await this.driver.pause(80);
            }
        }
        console.log('Entered new password: ' + password);
    }

    async enterConfirmPassword(password) {
        await this.driver.hideKeyboard().catch(() => { });
        await this.driver.pause(500);
        await this.scrollDown().catch(() => { });
        await this.driver.pause(500);
        try {
            const el = await this.driver.$(this.confirmPasswordInput);
            await el.waitForDisplayed({ timeout: 3000 });
            await el.click();
            await this.driver.pause(300);
            await el.clearValue();
            await el.setValue(password);
        } catch (_) {
            console.log('[enterConfirmPassword] EditText not found, trying View fallback...');
            let clicked = false;
            for (const pat of ['Confirm Password', 'Confirm password', 'confirm password', 'Confirm']) {
                try {
                    const el = await this.driver.$(`android=new UiSelector().descriptionContains("${pat}").clickable(true)`);
                    await el.waitForDisplayed({ timeout: 2000 });
                    await el.click();
                    clicked = true;
                    console.log('[enterConfirmPassword] Clicked View with pattern: ' + pat);
                    break;
                } catch (_2) { }
            }
            if (!clicked) console.log('[enterConfirmPassword] WARNING: field not found, typing via keys');
            await this.driver.pause(300);
            for (const char of password) {
                await this.driver.keys(char);
                await this.driver.pause(80);
            }
        }
        console.log('Entered confirm password: ' + password);
    }

    async clickSubmit() {
        await this.driver.hideKeyboard().catch(() => { });
        await this.click(this.submitButton);
        console.log('Clicked Submit');
    }

    async clickContinue() {
        await this.click(this.continueButton);
        console.log('Clicked Continue');
    }
}

module.exports = ForgotPasswordPage;
