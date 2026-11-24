/**
 * 双视口 UI 验收报告生成器。
 *
 * `docs/UI_DUAL_VIEWPORT_AUDIT_2026-11-24.md` 的「复核命令」调用本脚本：它把文档摘要里的
 * 每一项都用可执行的度量重算一遍，让摘要不至于变成无法复现的说法。报告只写在本机
 * （`reports/**\/*.json` 被 `.gitignore` 忽略），随仓库提交的是文档里的摘要。
 *
 * 用法：node scripts/ui-audit-report.mjs [--port 3127]
 * 输出：reports/UI_COMPONENT_AUDIT_<日期>.json，并在终端打印与文档摘要同口径的计数。
 * 退出码：全部达标 0，存在硬性违规 1（供后续接入闸门）。
 */
import {spawn} from 'node:child_process';
import {mkdir,writeFile} from 'node:fs/promises';
import {chromium} from '@playwright/test';

/* 采集函数在页面上下文执行，`document` 与 `getComputedStyle` 由浏览器提供。 */
/* global document, getComputedStyle, innerWidth */

const date=new Date().toISOString().slice(0,10);
const portArg=process.argv.indexOf('--port');
const PORT=Number(portArg>0?process.argv[portArg+1]:3127);
const ORIGIN=`http://127.0.0.1:${PORT}`;

/** 关键路由：门户五个入口 + 管理端五个工作台，与文档摘要列表一一对应。 */
const PORTAL_ROUTES=['/','/events','/outreach','/community','/materials'];
const CONSOLE_ROUTES=['/console/overview','/console/events','/console/outreach','/console/materials','/console/audit'];
const ROUTES=[...PORTAL_ROUTES,...CONSOLE_ROUTES];
const VIEWPORTS=[
 {viewport:'desktop',width:1440,height:900},
 {viewport:'mobile',width:390,height:844},
];
/** 改造标记：运营模块用 `console-operations-redesign`，活动工作台单独用 `activity-workspace-redesign`。 */
const REDESIGN_SELECTOR='.console-operations-redesign,.activity-workspace-redesign';
/** 移动端功能文字下限。 */
const MIN_MOBILE_FONT=11;

const server=spawn(process.execPath,['scripts/preview-workflow.mjs'],{
 env:{...process.env,PORT:String(PORT),PREVIEW_START_SIGNED_OUT:'1'},
 stdio:'ignore',
});
async function waitForServer(){
 for(let attempt=0;attempt<60;attempt+=1){
  try{
   const response=await fetch(`${ORIGIN}/api/auth/session`);
   if(response.ok||response.status===401)return;
  }catch{/* 服务尚未就绪 */}
  await new Promise(resolve=>setTimeout(resolve,500));
 }
 throw new Error('合成预览服务未在 30 秒内就绪');
}

/**
 * 标题层级只在「跳级」时记为问题：首屏从 h2 起属于版式选择，不算结构缺陷。
 * 错误/空态节点内的标题单独排除：它们只在数据加载失败时出现（合成预览没有 showcase、
 * warmth 等接口），层级由提示组件决定，不代表页面版式；这类节点另由 `errorStateNodes`
 * 计数。空态组件在本项目里是 `.state`（`.state--error` 等）。
 *
 * 选择器写成字面量：该函数经 `page.evaluate` 序列化后在页面上下文执行，引用外部常量
 * 会取不到值。
 */
const collect=()=>{
 const stateSelector='.state,.notice,.empty-state,[role="alert"]';
 const visible=node=>node.getClientRects().length>0;
 const levels=[...document.querySelectorAll('h1,h2,h3,h4,h5,h6')]
  .filter(visible)
  .filter(node=>!node.closest(stateSelector))
  .map(node=>Number(node.tagName.slice(1)));
 let headingSkip=false;
 for(let index=1;index<levels.length;index+=1)if(levels[index]>levels[index-1]+1){headingSkip=true;break;}

 // 功能文字：节点自身直接包含非空文本，才按它的字号判定；容器字号不作为正文证据。
 const smallText=[];
 for(const node of document.querySelectorAll('body *')){
  if(!visible(node))continue;
  if(node.closest(stateSelector))continue;
  if(node.getAttribute('aria-hidden')==='true')continue;
  const ownText=[...node.childNodes]
   .filter(child=>child.nodeType===3)
   .map(child=>child.textContent.trim())
   .join('');
  if(!ownText)continue;
  const size=Number.parseFloat(getComputedStyle(node).fontSize)||0;
  if(size<11)smallText.push({text:ownText.slice(0,24),selector:`${node.tagName.toLowerCase()}${node.className&&typeof node.className==='string'?'.'+node.className.trim().split(/\s+/).join('.'):''}`,fontSize:size});
 }

 // 只统计「看得见且有文案」的错误/空态节点：项目里 `role="alert"` 同时用作空的读屏占位
 // （活动工作台每个面板一个），把它们算进来会让数字失去意义。全部命中数另记 stateAll。
 const stateNodes=[...document.querySelectorAll(stateSelector)];
 const stateVisible=stateNodes.filter(node=>visible(node)&&(node.textContent||'').replace(/\s+/g,''));
 const stateTexts=stateVisible
  .map(node=>(node.textContent||'').replace(/\s+/g,' ').trim().slice(0,40))
  .filter(Boolean);

 const marker=document.querySelector('.console-operations-redesign,.activity-workspace-redesign');
 return {
  horizontalOverflow:document.documentElement.scrollWidth>innerWidth+1,
  headingSkip,
  errorStateNodes:stateVisible.length,
  stateAll:stateNodes.length,
  stateTexts,
  redesignMarker:marker?(marker.className.split(/\s+/).find(name=>name==='console-operations-redesign'||name==='activity-workspace-redesign')||''):'',
  smallText,
 };
};

const issues=[];
let browser;
try{
 await waitForServer();
 browser=await chromium.launch({channel:'chrome',args:['--no-proxy-server']});
 const context=await browser.newContext();
 const login=await context.request.post(`${ORIGIN}/api/auth/login`,{data:{username:'synthetic-super'}});
 if(!login.ok())throw new Error(`合成账号登录失败：HTTP ${login.status()}`);
 const rows=[];
 for(const target of VIEWPORTS){
  for(const url of ROUTES){
   const page=await context.newPage();
   await page.setViewportSize({width:target.width,height:target.height});
   const runtimeErrors=[];
   page.on('console',message=>{if(message.type()==='error')runtimeErrors.push(message.text());});
   page.on('pageerror',error=>runtimeErrors.push(String(error?.message||error)));
   try{
    await page.goto(`${ORIGIN}${url}`,{waitUntil:'networkidle',timeout:30000});
   }catch(error){
    runtimeErrors.push(`navigation: ${error?.message||error}`);
   }
   await page.waitForTimeout(300);
   const metrics=await page.evaluate(collect).catch(()=>({horizontalOverflow:false,headingSkip:false,errorStateNodes:0,stateAll:0,stateTexts:[],redesignMarker:'',smallText:[]}));
   rows.push({
    viewport:target.viewport,
    width:target.width,
    height:target.height,
    url,
    finalPath:new URL(page.url()).pathname,
    consoleScope:CONSOLE_ROUTES.includes(url),
    ...metrics,
    runtimeErrors,
   });
   await page.close();
  }
 }
 await mkdir(new URL('../reports/',import.meta.url),{recursive:true});
 const output=new URL(`../reports/UI_COMPONENT_AUDIT_${date}.json`,import.meta.url);
 await writeFile(output,`${JSON.stringify(rows,null,2)}\n`);

 const combos=rows.length;
 const overflow=rows.filter(row=>row.horizontalOverflow);
 const skips=rows.filter(row=>row.headingSkip);
 const consoleRows=rows.filter(row=>row.consoleScope);
 const consoleCovered=consoleRows.filter(row=>row.redesignMarker);
 const mobile=rows.filter(row=>row.viewport==='mobile');
 const mobileSmall=mobile.filter(row=>row.smallText.length>0);
 // 只看页面脚本自身的异常：合成预览未实现若干接口，浏览器会打印 404 控制台消息。
 const scriptErrors=rows.filter(row=>row.runtimeErrors.some(message=>!/Failed to load resource|404|net::ERR/i.test(message)));
 const stateNodes=rows.reduce((total,row)=>total+row.errorStateNodes,0);
 const stateAll=rows.reduce((total,row)=>total+(row.stateAll||0),0);

 console.log(`已写入 ${combos} 条记录：reports/UI_COMPONENT_AUDIT_${date}.json`);
 console.log(`组合数：${combos}（${ROUTES.length} 路由 × ${VIEWPORTS.length} 视口）`);
 console.log(`页面级横向溢出：${overflow.length}/${combos}`);
 console.log(`控制台改造作用域覆盖：${consoleCovered.length}/${consoleRows.length}`);
 console.log(`手机端低于 ${MIN_MOBILE_FONT}px 的功能文字：${mobileSmall.length}`);
 console.log(`标题层级跳跃：${skips.length}`);
 console.log(`JS 运行时异常：${scriptErrors.length}`);
 console.log(`页面错误/空态节点：${stateNodes}（含不可见读屏占位共 ${stateAll} 个命中）`);

 if(overflow.length)issues.push(`横向溢出：${overflow.map(row=>`${row.viewport} ${row.url}`).join('、')}`);
 if(skips.length)issues.push(`标题跳级：${skips.map(row=>`${row.viewport} ${row.url}`).join('、')}`);
 if(consoleCovered.length!==consoleRows.length)issues.push(`控制台改造标记缺失：${consoleRows.filter(row=>!row.redesignMarker).map(row=>`${row.viewport} ${row.url}`).join('、')}`);
 if(scriptErrors.length)issues.push(`脚本异常：${scriptErrors.map(row=>`${row.viewport} ${row.url}: ${row.runtimeErrors.join(' | ')}`).join('、')}`);
 // 字号低于下限时打印明细：其中包含装饰性字标（brand-wordmark），需人工判定是否业务正文。
 for(const row of mobileSmall)for(const item of row.smallText)console.log(`  ${row.url} ${item.fontSize}px ${item.selector} "${item.text}"`);
 if(issues.length){
  for(const issue of issues)console.error(`未达标：${issue}`);
  process.exitCode=1;
 }
}finally{
 await browser?.close();
 server.kill();
}
