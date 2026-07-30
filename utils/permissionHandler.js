const permissionHandler = {
    async dismissAllPermissions(driver) {
        const selectors = [
            'id=com.android.permissioncontroller:id/permission_allow_button',
            'id=com.android.packageinstaller:id/permission_allow_button',
            'android=new UiSelector().textContains("Allow").className("android.widget.Button")',
            'android=new UiSelector().textContains("ALLOW").className("android.widget.Button")'
        ];

        let dismissed = 0;

        for (let attempt = 0; attempt < 5; attempt++) {
            let found = false;
            for (const selector of selectors) {
                try {
                    const btn = await driver.$(selector);
                    if (await btn.isDisplayed()) {
                        await btn.click();
                        console.log(`Permission popup dismissed (attempt ${attempt + 1})`);
                        await driver.pause(1000);
                        dismissed++;
                        found = true;
                        break;
                    }
                } catch (_) {}
            }
            if (!found) break;
        }

        if (dismissed === 0) {
            console.log('No permission popups found');
        }
    }
};

module.exports = permissionHandler;
