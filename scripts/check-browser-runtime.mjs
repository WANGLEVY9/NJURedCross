import {access} from 'node:fs/promises';
import {chromium,firefox,webkit} from '@playwright/test';

const engine=process.argv[2];
const browserType={chromium,firefox,webkit}[engine];
if(!browserType)throw new Error('Expected chromium, firefox or webkit');
// Check and launch what the image contains. Missing runtimes fail promptly;
// no package-manager or browser-download fallback can consume the test budget.
await access(browserType.executablePath());
const browser=await browserType.launch({headless:true,timeout:30_000});
try{
 const page=await browser.newPage();
 await page.setContent('<title>runtime ready</title>');
 if(await page.title()!=='runtime ready')throw new Error('Browser runtime check failed');
 console.log(`${engine} runtime ready: ${browser.version()}`);
}finally{await browser.close();}
