const fs = require('fs');
const DriverManager = require('../driver/DriverManager');
const SplashPage = require('../pages/SplashPage');
const LoginPage = require('../pages/LoginPage');
const permissionHandler = require('../utils/permissionHandler');
const ResearchCalls = require('../pages/ResearchCalls');
const { createLogger } = require('../utils/logger');

async function run() {
    const driver = await DriverManager.getDriver();
    try {
        const splashPage = new SplashPage(driver);
        const researchCalls = new ResearchCalls(driver);

        console.log('Step 1: Waiting for app to load...');
        await splashPage.pause(8000);
        await permissionHandler.dismissAllPermissions(driver);
        await driver.pause(2000);

        console.log('Step 2: Clicking hamburger menu...');
        await researchCalls.clickHamburgerMenu();
        await driver.pause(2000);

        console.log('Step 3: Clicking Research option...');
        await researchCalls.clickResearchOption();
        await driver.pause(2000);

        console.log('Step 4: Counting symbols under Equity - Fundamental...');
        await researchCalls.clickFundamentalTab();
        await driver.pause(1500);
        await researchCalls.scrollUp();
        await driver.pause(500);
        const fundamentalCount = await researchCalls.countSymbols();
        console.log(`Equity Fundamental symbol count: ${fundamentalCount}`);

        console.log('Step 4: Counting symbols under Equity - Technical...');
        await researchCalls.clickTechnicalTab();
        await driver.pause(1500);
        await researchCalls.scrollUp();
        await driver.pause(500);
        const technicalCount = await researchCalls.countSymbols();
        console.log(`Equity Technical symbol count: ${technicalCount}`);

        console.log('Step 5: Selecting Derivative tab...');
        await researchCalls.clickDerivativeTab();
        await driver.pause(1500);

        console.log('Step 5: Counting symbols under Derivative - Technical...');
        await researchCalls.clickTechnicalTab();
        await driver.pause(1500);
        await researchCalls.scrollUp();
        await driver.pause(500);
        const derivativeTechnicalCount = await researchCalls.countSymbols();
        console.log(`Derivative Technical symbol count: ${derivativeTechnicalCount}`);

        console.log('Step 5: Counting symbols under Derivative - Strategies...');
        await researchCalls.clickStrategiesTab();
        await driver.pause(1500);
        await researchCalls.scrollUp();
        await driver.pause(500);
        const derivativeStrategiesCount = await researchCalls.countSymbols();
        console.log(`Derivative Strategies symbol count: ${derivativeStrategiesCount}`);

        console.log('Step 6: Selecting Commodity tab...');
        await researchCalls.clickCommodityTab();
        await driver.pause(1500);

        console.log('Step 6: Counting symbols under Commodity - Technical...');
        await researchCalls.clickTechnicalTab();
        await driver.pause(1500);
        const commodityTechnicalCount = await researchCalls.countSymbols();
        console.log(`Commodity Technical symbol count: ${commodityTechnicalCount}`);

        console.log('Step 6: Counting symbols under Commodity - Strategies...');
        await researchCalls.clickStrategiesTab();
        await driver.pause(1500);
        const commodityStrategiesCount = await researchCalls.countSymbols();
        console.log(`Commodity Strategies symbol count: ${commodityStrategiesCount}`);

    } catch (err) {
        console.error('Test failed:', err.message);
        console.error(err.stack);
    } finally {
        await DriverManager.closeDriver();
    };
}
run();