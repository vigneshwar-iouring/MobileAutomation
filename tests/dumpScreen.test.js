const DriverManager = require('../driver/DriverManager');
const { APP_PACKAGE } = require('../config/appium.config');

async function run() {
    const driver = await DriverManager.getDriver();

    try {
        await driver.terminateApp(APP_PACKAGE);
        await driver.pause(1000);
        await driver.activateApp(APP_PACKAGE);
        await driver.pause(5000);

        const source = await driver.getPageSource();

        const texts = [...source.matchAll(/text="([^"]+)"/g)].map(m => m[1]).filter(t => t.trim());
        console.log('=== text= attributes ===');
        texts.forEach(t => console.log(' -', t));

        const descs = [...source.matchAll(/content-desc="([^"]+)"/g)].map(m => m[1]).filter(d => d.trim());
        console.log('\n=== content-desc= attributes ===');
        descs.forEach(d => console.log(' -', d));

        const hints = [...source.matchAll(/hint="([^"]+)"/g)].map(m => m[1]).filter(h => h.trim());
        console.log('\n=== hint= attributes ===');
        hints.forEach(h => console.log(' -', h));

        console.log('\n=== Full XML ===');
        console.log(source);

    } catch (err) {
        console.error('Failed:', err.message);
    } finally {
        await DriverManager.closeDriver();
    }
}

run();
