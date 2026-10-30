# Globe Capital - Mutual Funds Test Cases

App: `com.iouring.globecapital` · Suite runner: `node tests/MutualFunds/RunAll.test.js`

## Home (`tests/MutualFunds/Home.test.js`)

| TC ID | Script | Scenario | Pre-condition | Test Steps | Test Data | Expected Result | Priority |
|---|---|---|---|---|---|---|---|
| MF_HOME_01 | TC 1 | Open Mutual Funds from bottom navigation | User is logged in to Globe Capital app; app is on Watchlist/Home screen | 1. Tap "Mutual Funds" in the bottom navigation bar | - | 1. Mutual Funds screen opens | High |
| MF_HOME_02 | TC 2 | Home tab - portfolio summary is displayed | Mutual Funds screen is open | 1. Tap the Home tab<br>2. Read the portfolio summary card | - | 1. Home tab is selected<br>2. Portfolio summary card is displayed with all fields populated (invested, current value, returns etc.) | High |
| MF_HOME_03 | TC 3 | Handpick Collections - High Returns count and list scroll | Home tab is open | 1. Note the fund count shown on the "High Returns" tile<br>2. Tap the "High Returns" tile<br>3. Note the fund count in the list header<br>4. Scroll the list to the bottom, then back to the top | Collection: High Returns | 1. Tile fund count equals the list header fund count<br>2. List scrolls to the bottom and back to the top without errors | High |
| MF_HOME_04 | TC 4 | Open fund detail from High Returns list | High Returns list is open | 1. Tap the first fund in the list | - | 1. Fund detail screen opens for the selected fund | High |
| MF_HOME_05 | TC 5 | One Time and Start SIP order pad defaults | Fund detail screen is open | 1. Tap "One Time"<br>2. Read default amount and the "Min. ₹..." text<br>3. Tap the quick-add amount button<br>4. Go back<br>5. Tap "Start SIP" (if available) and repeat the checks<br>6. Go back | - | 1. One Time: default amount equals the minimum amount shown<br>2. One Time: amount increases after quick-add<br>3. Start SIP (if applicable): default equals minimum and quick-add increases amount<br>4. If Start SIP is not available / does not open an order pad, step is skipped | High |
| MF_HOME_06 | TC 6 | NAV with date and Annualised return | Fund detail screen is open | 1. Read "NAV as on <date>" value<br>2. Read "Annualised" value | - | 1. NAV and Annualised values are displayed<br>2. NAV date is on or before today (never a future date) | High |
| MF_HOME_07 | TC 7 | Fund additional info | Fund detail screen is open | 1. Read Min. Invest Amt, Total Assets and Exit Load | - | 1. Min. Invest Amt, Total Assets and Exit Load are displayed with values | Medium |
| MF_HOME_08 | TC 8 | Annualised return period options | Fund detail screen is open | 1. Open the Annualised return period picker<br>2. Select each available option in turn<br>3. Read NAV/Annualised for each | - | 1. Picker lists the available periods; first period is selected by default<br>2. Annualised value updates for each selected period<br>3. NAV date remains on or before today | Medium |
| MF_HOME_09 | TC 9 | Chart period tabs | Fund detail screen is open | 1. Tap each chart period tab starting from threeMonths up to max | - | 1. Each chart period tab is selectable and chart updates | Medium |
| MF_HOME_10 | TC 10 | Peer Comparison section | Fund detail screen is open | 1. Scroll to "Peer Comparison"<br>2. Tap "View More" if present<br>3. Cycle through each return period option | - | 1. Peer Comparison section is displayed<br>2. View More expands the list (when shown)<br>3. Each return period option can be selected | Medium |
| MF_HOME_11 | TC 11 | Funds in this Category section | Fund detail screen is open | 1. Scroll to the bottom<br>2. Locate "Funds in this Category"<br>3. Tap "View More" if present<br>4. Cycle through each return period option | - | 1. Section is displayed (if applicable)<br>2. Each return period option can be selected | Medium |
| MF_HOME_12 | TC 12 | Collection list return period filter | Fund detail screen is open | 1. Go back to the High Returns list<br>2. Open the return period filter<br>3. Select 1Y (default), 3Y and 5Y | Periods: 1Y, 3Y, 5Y | 1. 1Y is selected by default<br>2. List updates for 3Y and 5Y | Medium |
| MF_HOME_13 | TC 13 | Navigate back to MF Home | High Returns list is open | 1. Press back until MF Home is displayed | - | 1. MF Home tab is displayed | Low |
| MF_HOME_14 | TC 14 | Remaining Handpick Collections - count check | MF Home tab is open | 1. For each collection: note tile count, open the collection, note list header count, go back to Home | Collections: Debt, Tax Saving, Large Cap, Mid Cap, Small Cap | 1. For every collection, tile count equals list header count | High |
| MF_HOME_15 | TC 15 | Global Mutual Fund search | MF Home tab is open | 1. Tap the search icon near Handpick Collections<br>2. Enter "tata" | Search: tata | 1. Search results are shown<br>2. Every result contains "tata" | High |
| MF_HOME_16 | TC 16 | Navigate back to MF Home from search | Search results are shown | 1. Press back until MF Home is displayed | - | 1. MF Home tab is displayed | Low |
| MF_HOME_17 | TC 17 | New Fund Offering (NFO) - list, dates and remaining time | MF Home tab is open | 1. Tap "Invest in New Fund Offering" banner<br>2. Scroll the NFO list to the bottom<br>3. Tap the last NFO fund<br>4. Read Open Date, Close Date, Allotment Date<br>5. Read the "NFO will close in N days" banner | - | 1. NFO list opens and scrolls to the bottom<br>2. NFO detail shows Open/Close/Allotment dates<br>3. Days stated in the banner equal the days computed from today to Close Date | High |
| MF_HOME_18 | TC 18 | NFO minimum investment amount | NFO detail screen is open | 1. Read "Minimum Investment Amount" | - | 1. Minimum Investment Amount is displayed with a value | Medium |
| MF_HOME_19 | TC 19 | NFO order pads | NFO detail screen is open | 1. Scroll to bottom then back to top<br>2. Tap "One Time" and verify defaults, go back<br>3. Tap "Start SIP" (if applicable) and verify defaults, go back | - | 1. Default amount equals minimum amount; quick-add increases amount<br>2. Start SIP step is skipped for NFOs where it does not open an order pad (e.g. ETF/Index NFOs) | High |
| MF_HOME_20 | TC 20 | Navigate back to MF Home from NFO | NFO detail screen is open | 1. Press back until MF Home is displayed | - | 1. MF Home tab is displayed | Low |
| MF_HOME_21 | TC 21 | Trending Funds - 3Y return and categories | MF Home tab is open | 1. Scroll Home to the bottom<br>2. Change Trending Funds return period to "3 Years Return"<br>3. For Equity, Debt and Hybrid: select the category, open the first fund, go back | Period: 3 Years Return; Categories: Equity, Debt, Hybrid | 1. Return period changes to 3Y<br>2. Each category tab lists funds and the first fund detail opens | Medium |

## Explore (`tests/MutualFunds/Explore.test.js`)

| TC ID | Script | Scenario | Pre-condition | Test Steps | Test Data | Expected Result | Priority |
|---|---|---|---|---|---|---|---|
| MF_EXP_01 | TC 21 | Open Mutual Funds from bottom navigation | User is logged in to Globe Capital app; app is on Watchlist/Home screen | 1. Tap "Mutual Funds" in the bottom navigation bar | - | 1. Mutual Funds screen opens | High |
| MF_EXP_02 | TC 22 | Open Explore tab | Mutual Funds screen is open | 1. Tap the Explore tab | - | 1. Explore tab is displayed with Category Solutions | High |
| MF_EXP_03 | TC 23 | Category Solutions headers | Explore tab is open | 1. Scroll through Category Solutions<br>2. Count the distinct category headers | - | 1. All category headers are listed (Equity, Debt, Hybrid, Index Fund, Funds of Funds, Solution Oriented) | Medium |
| MF_EXP_04 | TC 24 | Expand Equity category and read tags | Explore tab is open | 1. Scroll back to top<br>2. Note the fund count on the Equity card<br>3. Tap the Equity card<br>4. Scroll to the category tags<br>5. Read tags in order | Category: Equity | 1. Equity card shows a fund count<br>2. Equity expands and shows its sub-category tags, starting with "All" | High |
| MF_EXP_05 | TC 25 | Equity "All" count matches card count | Equity category is expanded | 1. Tap the "All" tag<br>2. Read the results count | Tag: All | 1. "All" results count equals the fund count on the Equity card | High |
| MF_EXP_06 | TC 26 | Open first Equity fund | Equity - All list is open | 1. Tap the first fund | - | 1. Fund detail screen opens | High |
| MF_EXP_07 | TC 27 | One Time - SUBMIT disabled with empty amount | Fund detail screen is open | 1. Tap "One Time"<br>2. Clear the amount field<br>3. Close the keypad<br>4. Check SUBMIT button | Amount: (empty) | 1. SUBMIT button is disabled when amount is empty | High |
| MF_EXP_08 | TC 28 | Start SIP - SUBMIT disabled with empty amount | Fund detail screen is open | 1. Tap "Start SIP" (if applicable)<br>2. Clear the amount field<br>3. Close the keypad<br>4. Check SUBMIT button | Amount: (empty) | 1. SUBMIT button is disabled when amount is empty<br>2. Skipped if Start SIP is not applicable for the fund | High |
| MF_EXP_09 | TC 29 | Navigate back to Equity fund list | Fund detail screen is open | 1. Press back | - | 1. Equity fund list is displayed | Low |
| MF_EXP_10 | TC 30 | Local search within Equity list | Equity fund list is open | 1. Enter "SBI" in the list search bar<br>2. Read the results | Search: SBI | 1. Results are shown and every result name contains "SBI" | High |
| MF_EXP_11 | TC 30a | Clear local search | SBI search results are shown | 1. Backspace to clear the search bar<br>2. Read the results count | - | 1. Search is cleared and the full list count is restored | Medium |
| MF_EXP_12 | TC 31 | Add filter - next sub-category tag | Equity fund list is open | 1. Tap "+"<br>2. Select the tag after "All"<br>3. Read the results count | Tag: 2nd Equity tag | 1. Selected tag filter is applied and the list shows its results count | Medium |
| MF_EXP_13 | TC 32 | Equity list return periods | Equity fund list is open | 1. Change return period to "3 Years Return"<br>2. Change return period to "5 Years Return"<br>3. Go back to Explore and collapse Equity | Periods: 3Y, 5Y | 1. List updates for each selected return period | Medium |
| MF_EXP_14 | TC 33 | Repeat flow for remaining categories | Explore tab is open | 1. For each category: scroll to and expand the card, read tags, tap the first tag<br>2. Search "SBI" and verify results, then clear<br>3. Tap "+" and select the next tag (skipped for Index Fund, which has only one tag)<br>4. Go back and collapse the category | Categories: Debt, Hybrid, Index Fund, Funds of Funds, Solution Oriented; Search: SBI | 1. Each category expands and shows its tags<br>2. SBI search returns only SBI funds<br>3. Next tag filter applies and shows results (where applicable) | High |

## Portfolio (`tests/MutualFunds/Portfolio.test.js`)

| TC ID | Script | Scenario | Pre-condition | Test Steps | Test Data | Expected Result | Priority |
|---|---|---|---|---|---|---|---|
| MF_PF_01 | TC 30 | Portfolio tab - summary | User is logged in to Globe Capital app; app is on Watchlist/Home screen; account holds MF investments | 1. Open Mutual Funds<br>2. Tap the Portfolio tab<br>3. Read the portfolio summary | - | 1. Portfolio tab is displayed with the summary populated | High |
| MF_PF_02 | TC 31 | Active SIPs count matches Manage SIP | Portfolio tab is open; account has at least one active SIP | 1. Note the "Active SIPs" count<br>2. Tap the Active SIPs tile<br>3. Count the SIP cards on Manage SIP | - | 1. Manage SIP screen opens<br>2. Active SIPs count equals number of SIP cards listed | High |
| MF_PF_03 | TC 32 | Open first Active SIP | Manage SIP screen is open | 1. Note Name, Frequency and Amount of the first SIP<br>2. Tap the first SIP card | - | 1. SIP Detail screen opens | High |
| MF_PF_04 | TC 33 | SIP Detail fields | SIP Detail screen is open | 1. Read Name, Due Date, Amount, SIP ID, Mandate Bank, Mandate ID | - | 1. All fields are displayed<br>2. Name matches the SIP card name<br>3. Amount matches the SIP card amount | High |
| MF_PF_05 | TC 34 | SIP Detail scroll | SIP Detail screen is open | 1. Scroll to the bottom | - | 1. Instalment history is visible at the bottom | Low |
| MF_PF_06 | TC 35 | Navigate back to Portfolio | SIP Detail screen is open | 1. Press back until Portfolio tab is displayed | - | 1. Portfolio tab is displayed | Low |
| MF_PF_07 | TC 36 | Fund holding detail | Portfolio tab is open | 1. Tap the first fund below Active SIPs<br>2. Read the holding fields | - | 1. Holding detail shows Name, Category, Invest Amount, Current Value, Return (%), XIRR, Day Change, Day Change (%), Average NAV, Current NAV, Balance Units, Folio Number, Dividend | High |
| MF_PF_08 | TC 37 | Redeem Fund - Folio No and Redeem All | Fund holding detail is open | 1. Tap Actions button<br>2. Tap "Redeem Fund"<br>3. Read Folio No<br>4. Tap "Redeem All" (toggle on and off)<br>5. Go back to the Actions menu | - | 1. Redeem screen opens<br>2. Folio No equals the holding detail Folio Number<br>3. Redeem All can be toggled<br>4. No redemption is submitted | High |
| MF_PF_09 | TC 38 | Switch Fund | Actions menu is open | 1. Tap "Switch Fund"<br>2. Go back to the Actions menu | - | 1. Switch Fund screen opens | Medium |
| MF_PF_10 | TC 39 | Transaction Details | Actions menu is open | 1. Tap "Transaction Details"<br>2. Go back to the Actions menu | - | 1. Transaction Details screen opens | Medium |
| MF_PF_11 | TC 40 | Fund Overview and back to Portfolio | Actions menu is open | 1. Tap "Fund Overview"<br>2. Go back to the Actions menu<br>3. Go back to the Portfolio tab | - | 1. Fund Overview screen opens<br>2. User returns to the Portfolio tab | Medium |

## Accounts (`tests/MutualFunds/Accounts.test.js`)

| TC ID | Script | Scenario | Pre-condition | Test Steps | Test Data | Expected Result | Priority |
|---|---|---|---|---|---|---|---|
| MF_ACC_01 | TC 41 | Open Mutual Funds from bottom navigation | User is logged in to Globe Capital app; app is on Watchlist/Home screen | 1. Tap "Mutual Funds" in the bottom navigation bar | - | 1. Mutual Funds screen opens | High |
| MF_ACC_02 | TC 42 | Open Accounts tab | Mutual Funds screen is open | 1. Tap the Accounts tab | - | 1. Accounts tab is displayed with Reports, Order Book, Bank, Autopay | High |
| MF_ACC_03 | TC 43 | Reports screen header | Accounts tab is open | 1. Tap "Reports"<br>2. Read the header | - | 1. Reports screen opens with the correct header | Medium |
| MF_ACC_04 | TC 44 | Report options | Reports screen is open | 1. Read the listed report options in order | - | 1. Holdings Report, Portfolio Summary Report and Capital Gain Report are listed | Medium |
| MF_ACC_05 | TC 45 | Holdings Report - As on date | Reports screen is open | 1. Tap "Holdings Report"<br>2. Read the "As on" date | - | 1. Holdings Report expands<br>2. "As on" date equals today | High |
| MF_ACC_06 | TC 46 | Download Holdings Report | Holdings Report is expanded | 1. Tap Download | - | 1. "Report download completed" toast is shown | High |
| MF_ACC_07 | TC 47 | Collapse Holdings Report | Holdings Report is expanded | 1. Tap "Holdings Report" again | - | 1. Holdings Report collapses | Low |
| MF_ACC_08 | TC 48 | Portfolio Summary Report - dates | Reports screen is open | 1. Tap "Portfolio Summary Report"<br>2. Read Start Date and End Date | - | 1. Start Date equals today<br>2. End Date equals today | High |
| MF_ACC_09 | TC 49 | Download Portfolio Summary Report | Portfolio Summary Report is expanded | 1. Tap Download | - | 1. "Report download completed" toast is shown | High |
| MF_ACC_10 | TC 50 | Collapse Portfolio Summary Report | Portfolio Summary Report is expanded | 1. Tap "Portfolio Summary Report" again | - | 1. Portfolio Summary Report collapses | Low |
| MF_ACC_11 | TC 51 | Capital Gain Report - financial year | Reports screen is open | 1. Tap "Capital Gain Report"<br>2. Read the Financial Year | - | 1. Financial Year equals the current financial year (Apr-Mar) | High |
| MF_ACC_12 | TC 52 | Download Capital Gain Report | Capital Gain Report is expanded | 1. Tap Download | - | 1. "Report download completed" toast is shown | High |
| MF_ACC_13 | TC 53 | Collapse Capital Gain Report | Capital Gain Report is expanded | 1. Tap "Capital Gain Report" again | - | 1. Capital Gain Report collapses | Low |
| MF_ACC_14 | TC 54 | Navigate back to Accounts from Reports | Reports screen is open | 1. Press back | - | 1. Accounts tab is displayed | Low |
| MF_ACC_15 | TC 55 | Order Book header | Accounts tab is open | 1. Tap "Order Book"<br>2. Read the header | - | 1. Order Book screen opens with the correct header | Medium |
| MF_ACC_16 | TC 56 | Order Book default date range | Order Book screen is open | 1. Read the Start and End dates of the date range | - | 1. Default date range is exactly 7 days | High |
| MF_ACC_17 | TC 57 | Navigate back to Accounts from Order Book | Order Book screen is open | 1. Press back | - | 1. Accounts tab is displayed | Low |
| MF_ACC_18 | TC 58 | Banks header | Accounts tab is open | 1. Tap "Bank"<br>2. Read the header | - | 1. Banks screen opens with the correct header | Medium |
| MF_ACC_19 | TC 59 | Linked bank list | Banks screen is open | 1. Check whether any banks are listed<br>2. Go back | - | 1. Linked bank names are displayed, or the list is empty if no bank is linked<br>2. User returns to Accounts tab | Medium |
| MF_ACC_20 | TC 60 | Autopay mandates | Accounts tab is open | 1. Tap "Autopay"<br>2. Check the mandate list | - | 1. If mandates exist: every mandate shows the ACTIVE tag<br>2. If none: the "no autopay" empty-state message is shown | High |
| MF_ACC_21 | TC 61 | Navigate back to Accounts from Autopay | Autopay screen is open | 1. Press back | - | 1. Accounts tab is displayed | Low |
