const permissionHandler = {
    async dismissAllPermissions(driver) {
        // Resource-id selectors first: exact, version-specific "allow" buttons.
        const selectors = [
            'id=com.android.permissioncontroller:id/permission_allow_button',
            'id=com.android.permissioncontroller:id/permission_allow_foreground_only_button',
            'id=com.android.permissioncontroller:id/permission_allow_one_time_button',
            'id=com.android.packageinstaller:id/permission_allow_button',
            // Exact text match only - textContains("Allow") would also match "Don't Allow".
            'android=new UiSelector().text("Allow").className("android.widget.Button")',
            'android=new UiSelector().text("ALLOW").className("android.widget.Button")',
            'android=new UiSelector().textContains("While using the app").className("android.widget.Button")',
            'android=new UiSelector().textContains("Only this time").className("android.widget.Button")'
        ];

        const allowIfPresent = async () => {
            for (const selector of selectors) {
                try {
                    const [btn] = await driver.$$(selector);
                    if (!btn || !(await btn.isDisplayed())) continue;

                    // Safety net: never click a "Don't allow" / "Deny" labelled button.
                    const label = (await btn.getText()) || '';
                    if (/don't|deny|cancel/i.test(label)) continue;

                    await btn.click();
                    return true;
                } catch (_) {}
            }
            return false;
        };

        let dismissed = 0;
        const overallStart = Date.now();

        // First check: no popup observed - skip straight to the calling flow, nothing more to do here.
        if (!(await allowIfPresent())) {
            console.log(`No permission popup observed (${Date.now() - overallStart}ms) - proceeding with flow`);
            return;
        }

        dismissed++;
        console.log('Permission popup observed - allowed it (1)');
        await driver.pause(500);

        // Some flows show multiple stacked permission popups in a row - allow each until none remain.
        for (let attempt = 2; attempt <= 5; attempt++) {
            if (!(await allowIfPresent())) break;
            dismissed++;
            console.log(`Permission popup observed - allowed it (${attempt})`);
            await driver.pause(500);
        }

        console.log(`dismissAllPermissions took ${Date.now() - overallStart}ms total (allowed ${dismissed})`);
    }
};

module.exports = permissionHandler;
