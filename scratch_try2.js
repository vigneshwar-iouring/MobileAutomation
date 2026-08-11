const DriverManager = require('./driver/DriverManager');
async function run() {
    const driver = await DriverManager.getDriver();
    try {
        console.log('--- mobile: doubleClickGesture ---');
        try {
            await driver.execute('mobile: doubleClickGesture', { x: 838, y: 1296 });
            await driver.pause(1000);
            let src = await driver.getPageSource();
            console.log('Dialog opened:', src.includes('Create New Basket'));
        } catch (e) { console.log('doubleClickGesture error:', e.message); }

        if (!(await driver.getPageSource()).includes('Create New Basket')) {
            console.log('--- driver.touchAction (legacy API) ---');
            try {
                await driver.touchAction([
                    { action: 'press', x: 838, y: 1296 },
                    { action: 'wait', ms: 100 },
                    { action: 'release' }
                ]);
                await driver.pause(1000);
                const src = await driver.getPageSource();
                console.log('Dialog opened:', src.includes('Create New Basket'));
            } catch (e) { console.log('touchAction error:', e.message); }
        }
    } catch (err) {
        console.error('Failed:', err.message);
    } finally {
        await DriverManager.closeDriver();
    }
}
run();
