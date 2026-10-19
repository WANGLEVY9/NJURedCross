import {spawn,spawnSync} from 'node:child_process';
import {createServer} from 'node:net';
import http from 'node:http';
import {seedExamples} from './fixtures/admin-preview-seed.mjs';
import {openSync,closeSync,writeFileSync,mkdirSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
const repo=fileURLToPath(new URL('../',import.meta.url)),dir=repo+'.write-state/admin-ui-preview/';
mkdirSync(dir,{recursive:true});
const revision=spawnSync('git',['rev-parse','--short','HEAD'],{cwd:repo,encoding:'utf8',windowsHide:true}).stdout.trim();
const port=await new Promise((resolve,reject)=>{const server=createServer();server.once('error',reject);server.listen(0,'127.0.0.1',()=>{const port=server.address().port;server.close(()=>resolve(port));});});
const out=openSync(dir+'server.log','a'),err=openSync(dir+'server-error.log','a');
const child=spawn(process.execPath,[repo+'/scripts/preview-workflow.mjs'],{cwd:repo,env:{...process.env,PORT:String(port),PREVIEW_START_SIGNED_OUT:'0',PREVIEW_SUPER_ADMIN:'0'},windowsHide:true,stdio:['ignore',out,err]});
process.once('SIGINT',()=>{child.kill();process.exit(0);});
process.once('SIGTERM',()=>{child.kill();process.exit(0);});
process.once('exit',()=>{child.kill();});
closeSync(out);closeSync(err);child.unref();
const origin='http://127.0.0.1:'+port;
let ready=false;for(let i=0;i<100;i++){try{if((await fetch(origin+'/api/auth/session')).ok){ready=true;break;}}catch{}await new Promise(resolve=>setTimeout(resolve,200));}
if(!ready){child.kill();throw Error('预览启动失败，请检查 '+dir+'server-error.log');}
let seeded;try{seeded=await seedExamples(origin);}catch(error){child.kill();throw error;}
const roles={director:'synthetic-organizer',chair:'synthetic-super',suzhou:'synthetic-suzhou-chair'};
const escape=value=>String(value).replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('"','&quot;');
const panel=http.createServer(async(req,res)=>{
 const url=new URL(req.url,'http://localhost');
 if(url.pathname.startsWith('/as/')){
  const role=roles[url.pathname.slice(4)];if(!role){res.writeHead(404);return res.end();}
  await fetch(origin+'/api/auth/login',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({username:role})});
  res.writeHead(303,{Location:role==='synthetic-organizer'?seeded.firstUrl:origin+'/console/events?workspace=v2'});return res.end();
 }
 res.writeHead(200,{'Content-Type':'text/html; charset=utf-8'});
 res.end(`<!doctype html><meta charset=utf-8><title>管理端完整 UI 预览</title><style>body{font:16px/1.7 system-ui;max-width:1000px;margin:36px auto;padding:0 24px;background:#f6f7fa;color:#202632}a{color:#9f1239}nav{display:flex;gap:16px;padding:16px;background:white;border-radius:14px}table{width:100%;border-collapse:collapse;background:white;margin-top:20px}td,th{text-align:left;padding:10px;border-bottom:1px solid #eee}small{color:#687080}</style><h1>管理端完整 UI 预览</h1><p>当前代码 ${revision}，仅使用可重置的隔离模拟数据。关闭启动窗口后停止服务，重新启动会恢复样例。</p><nav><a href=/as/director>南京负责主任</a><a href=/as/chair>南京主席团</a><a href=/as/suzhou>苏州主席团</a></nav><small>默认南京负责主任。切换身份后刷新已打开的页面；所有样例共用当前模拟身份。</small><table><tr><th>阶段</th><th>样例</th></tr>${seeded.examples.map(e=>`<tr><td>${escape(e.stage)}</td><td><a href="${escape(e.url)}" target=_blank rel=noopener>${escape(e.name)}</a></td></tr>`).join('')}</table><p><a href="${origin}/console/overview">管理端总览</a> <a href="${origin}/console/admin">管理员中心</a> <a href="${origin}/console/events">活动管理</a> <a href="${origin}/console/outreach">宣传管理</a> <a href="${origin}/console/community">内建管理</a> <a href="${origin}/console/materials">物资管理</a></p>`);
});
await new Promise(resolve=>panel.listen(0,'127.0.0.1',resolve));
const panelUrl='http://127.0.0.1:'+panel.address().port;
writeFileSync(dir+'current-preview.json',JSON.stringify({repo,revision,pid:child.pid,origin,url:panelUrl,examples:seeded.examples,stages:seeded.stages},null,2));
console.log('样例目录与身份切换：'+panelUrl+'\n六阶段样例：'+seeded.stages.join(' / '));
console.log('当前代码：'+revision+'\n项目目录：'+repo+'\n活动管理：'+origin+'/console/events\n管理总览：'+origin+'/console/overview\n公众端：'+origin+'/\n仅使用隔离模拟数据，不读取 .env。请保持本终端运行；Ctrl+C 停止预览。');
if(process.argv.includes('--check')){console.log('预览服务与六阶段样例初始化通过');child.kill();panel.close();process.exit(0);}
if(!process.argv.includes('--no-open'))spawnSync('powershell.exe',['-NoProfile','-Command',`Start-Process '${origin}/console/overview'`],{windowsHide:true});

const previewLifetime=await new Promise(resolve=>{child.ref();child.once('exit',code=>resolve(code??1));});process.exitCode=previewLifetime;
