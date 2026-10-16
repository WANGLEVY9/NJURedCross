import { defineConfig, devices } from '@playwright/test';
export default defineConfig({
  testDir:'./tests/browser',
  testMatch:['cross-engine.spec.mjs','activity-explorer.spec.mjs','notification-workspace.spec.mjs','field-workspace.spec.mjs','admin-modules.spec.mjs','success-mail-composer.spec.mjs','activity-approval.spec.mjs','overlay-close-guard.spec.mjs','business-search.spec.mjs'],
  timeout:30_000,
  retries:0,
  workers:1,
  reporter:[['list'],['html',{open:'never',outputFolder:'playwright-cross-report'}],['junit',{outputFile:'test-results/cross-browser.xml'}]],
  use:{baseURL:'http://127.0.0.1:3123',trace:'retain-on-failure',screenshot:'only-on-failure'},
  projects:[
    {name:'firefox',use:{...devices['Desktop Firefox']}},
    {name:'webkit',use:{...devices['Desktop Safari']}},
  ],
  webServer:{command:'node scripts/preview-workflow.mjs',url:'http://127.0.0.1:3123/api/auth/session',reuseExistingServer:false,env:{PORT:'3123',PREVIEW_START_SIGNED_OUT:'1'}},
});
