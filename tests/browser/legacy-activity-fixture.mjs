import {test as base,expect} from '@playwright/test';
// Keep the historical component's business regressions without a production URL.
export const test=base.extend({page:async({page},use)=>{
 await page.route('**/app/console/pages/activity-management-entry.js',route=>route.fulfill({contentType:'text/javascript',body:"export {default} from '/app/console/pages/activity-center.js';"}));
 await use(page);
}});
export {expect};
