import {defineConfig,devices} from '@playwright/test';
import config from './playwright.config.mjs';

/** Use the installed Microsoft Edge; no separate Chromium download is needed. */
export default defineConfig({...config,projects:[
 {name:'desktop-edge',use:{...devices['Desktop Edge'],channel:'msedge'}},
 {name:'mobile-edge',use:{...devices['Pixel 7'],channel:'msedge'}},
]});
