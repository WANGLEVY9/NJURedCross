/** Cold-cache typography checks; throttled and failed-font paths stay readable. */
/* global document, innerWidth, requestAnimationFrame */
import { chromium } from '@playwright/test';
import { mkdir, writeFile } from 'node:fs/promises';
import assert from 'node:assert/strict';
const browser = await chromium.launch({channel:'msedge'});
const base = process.env.PLAZA_PREVIEW_URL || 'http://127.0.0.1:3140';
const baseline = process.argv.includes('--baseline');
const results=[];
try {
  for (const scenario of baseline ? ['throttled'] : ['throttled','slow','failed','integrated']) {
    const context=await browser.newContext({viewport:{width:1024,height:900},reducedMotion:'reduce'});
    const page=await context.newPage();
    const session=await context.newCDPSession(page);
    await session.send('Network.enable');
    await session.send('Network.setCacheDisabled',{cacheDisabled:true});
    await session.send('Network.emulateNetworkConditions',{offline:false,latency:80,downloadThroughput:scenario==='slow'?128_000:3_000_000,uploadThroughput:1_000_000});
    if(scenario==='failed')await page.route('**/*.woff2',route=>route.abort());
    await page.addInitScript(()=>{
      globalThis.fontQA={cls:0,samples:[],shifts:[]};
      new PerformanceObserver(list=>{for(const entry of list.getEntries())if(!entry.hadRecentInput){globalThis.fontQA.cls+=entry.value;globalThis.fontQA.shifts.push({value:entry.value,sources:(entry.sources||[]).map(source=>source.node?.className||source.node?.nodeName)});}}).observe({type:'layout-shift',buffered:true});
      const selectors=['.plaza-example-header .plaza-example-brand>span, .phead .plogo__text b','.events-hero h1','.events-hero__motto','.events-hero__description','.events-hero__copy .btn span','.events-category strong'];
      let firstElementsAt;
      function sample(){
        const values=selectors.map(selector=>{
          const element=document.querySelector(selector);if(!element)return null;
          const range=document.createRange();range.selectNodeContents(element);
          const rect=range.getBoundingClientRect();return [rect.width,rect.height].map(value=>Math.round(value*10)/10);
        });
        if(values.every(Boolean)){
          firstElementsAt ??= performance.now();
          // font-display:optional has a brief initial block, never a late swap.
          if(performance.now()-firstElementsAt>=150)globalThis.fontQA.samples.push(values);
        }
        if(globalThis.fontQA.samples.length<600)requestAnimationFrame(sample);
      }
      requestAnimationFrame(sample);
    });
    const errors=[];page.on('pageerror',error=>errors.push(error.message));
    const url=scenario==='integrated'?`${process.env.PLAZA_WORKFLOW_URL||'http://127.0.0.1:3141'}/events`:`${base}/design/events-plaza.html`;
    await page.goto(url,{waitUntil:'domcontentloaded'});
    await page.locator('.events-category').first().waitFor();
    await page.evaluate(async()=>{await document.fonts.ready;await new Promise(resolve=>setTimeout(resolve,600));});
    const report=await page.evaluate(()=>{
      const samples=globalThis.fontQA.samples;
      const first=samples[0];
      return {cls:globalThis.fontQA.cls,shifts:globalThis.fontQA.shifts,samples:samples.length,metricChanges:samples.filter(sample=>JSON.stringify(sample)!==JSON.stringify(first)).length,
        fontBytes:performance.getEntriesByType('resource').filter(entry=>entry.name.includes('.woff2')).reduce((sum,entry)=>sum+entry.encodedBodySize,0),
        fontFiles:performance.getEntriesByType('resource').filter(entry=>entry.name.includes('.woff2')).map(entry=>entry.name.split('/').at(-1)),
        overflow:document.documentElement.scrollWidth>innerWidth};
    });
    console.log(scenario,JSON.stringify(report));
    if(!baseline){
      assert.equal(report.overflow,false);
      assert.deepEqual(errors,[]);
      assert.ok(report.samples>0);
      assert.equal(report.metricChanges,0,`${scenario}: typography changed after first render`);
      if(scenario!=='integrated')assert.ok(report.cls<0.01,`${scenario}: layout shift ${report.cls}`);
      if(scenario==='throttled'){
        assert.ok(report.fontBytes<900_000,`Unexpected initial font bytes ${report.fontBytes}`);
        assert.ok(!report.fontFiles.some(file=>file.includes('full.woff2')));
      }
    }
    if(!baseline&&scenario==='throttled'){
      await session.send('DOM.enable');await session.send('CSS.enable');
      const {root}=await session.send('DOM.getDocument');
      const {nodeId}=await session.send('DOM.querySelector',{nodeId:root.nodeId,selector:'.events-hero h1'});
      const {fonts}=await session.send('CSS.getPlatformFontsForNode',{nodeId});
      report.titleFonts=fonts.map(font=>({family:font.familyName,custom:font.isCustomFont}));
      assert.ok(fonts.some(font=>font.isCustomFont),'Normal load should keep the chosen title font');
    }
    if(!baseline&&scenario==='throttled'){
      const rareFaces=await page.evaluate(async()=> (await document.fonts.load('400 16px "Plaza Sans"','龘')).length);
      assert.ok(rareFaces>0,'Rare CJK character lost after sharding');
      report.rareCharacterFaces=rareFaces;
    }
    results.push({scenario,...report,errors});
    await context.close();
  }
  await mkdir('reports',{recursive:true});
  await writeFile(`reports/plaza-fonts-${baseline?'before':'after'}.json`,JSON.stringify(results,null,2)+'\n');
  console.log(JSON.stringify(results));
}finally{await browser.close();}
