/** Read-only audit fixtures: extracted functions run against synthetic memory, never server.js imports or .env. */
import {readFile} from 'node:fs/promises';import vm from 'node:vm';
import {pathToFileURL} from 'node:url';
const current=await readFile('server.js','utf8');const production=process.argv[2]?await readFile(process.argv[2],'utf8'):null;
function section(source,start,end){const a=source.indexOf(start),b=source.indexOf(end,a);if(a<0||b<0)throw Error('Extraction marker not found');return source.slice(a,b);}
async function upstream(source,status){const handler=section(source,'async function api(req, res, url)',source.includes('\nconst mimeTypes =')?'\nconst mimeTypes =':'\nconst staticFile =');const box={URL,accountLoad:{source:'synthetic'},getSession:()=>null,scopeForConsolePath:()=>null,requireConsoleAccess:()=>({username:'synthetic',role:'platform_admin'}),getBase:async()=>{throw {response:{status,data:{detail:'synthetic upstream failure'}}};},json:(res,status,body)=>({status,body})};vm.createContext(box);vm.runInContext(section(source,'function errorMessage(error)','async function readJson(req)')+handler+';globalThis.invoke=api;',box);return box.invoke({method:'GET',headers:{}},{},new URL('http://synthetic/api/health'));}
const result={upstream:[]};for(const status of [401,403])result.upstream.push({sourceStatus:status,production:production?await upstream(production,status):null,candidate:await upstream(current,status)});
const {normalizePermissions}=await import(pathToFileURL(process.cwd()+'/lib/permissions.js'));
result.invalidScope={input:'event_typo',granted:normalizePermissions('event_typo','platform_admin')};
const registrations=Array.from({length:5000},(_,i)=>({_id:'noise-'+i,活动ID:'OTHER',报名状态:'已确认',南大邮箱:'synthetic'+i+'@example.test'}));
registrations.push({_id:'existing-own-registration',活动ID:'TARGET',报名状态:'已确认',南大邮箱:'239999999@smail.nju.edu.cn'});
const tables={projects:[{_id:'target',活动ID:'TARGET',状态:'报名中',容量:'1'}],sessions:[],registrations};let writes=0;
const client={listRows:async(table,_v,_o,_c,start=0,limit=100)=>tables[table].slice(start,start+limit),appendRow:async(table,row)=>{writes++;return {_id:'duplicate-write',...row};}};
let registrationSequence=0;
const box={eventProjectTable:'projects',eventSessionTable:'sessions',eventRegistrationTable:'registrations',requiredText:v=>v,httpError:(status,message)=>Object.assign(new Error(message),{statusCode:status}),toFiniteNumber:v=>Number(v||0),eventIdentifier:()=> 'REG-SYNTHETIC-'+(++registrationSequence),randomCheckinCode:()=> 'SYNTHETIC',eventCheckinToken:()=> 'SYNTHETIC',eventCheckinHash:()=> 'SYNTHETIC',QRCode:{toDataURL:async()=> 'SYNTHETIC'}};
vm.createContext(box);vm.runInContext(section(current,'async function listAllRows(','function readMeta(')+section(current,'async function registerForEvent(','function isPubliclyListed(')+';globalThis.register=registerForEvent;',box);
try{const r=await box.register(client,{eventKey:'target',body:{name:'模拟同学',email:'239999999@smail.nju.edu.cn',consent:true},participantRef:'ACC-SYNTHETIC'});result.truncatedRegistration={sourceRows:registrations.length,duplicateWriteOccurred:writes>0,status:r.status};}catch(e){result.truncatedRegistration={sourceRows:registrations.length,statusCode:e.statusCode,writes};}
tables.registrations=[];writes=0;
const concurrent=await Promise.all(['239999991','239999992'].map(id=>box.register(client,{eventKey:'target',body:{name:'模拟同学',email:id+'@smail.nju.edu.cn',consent:true},participantRef:'ACC-'+id})));
result.concurrentRegistration={capacity:1,confirmed:concurrent.filter(r=>r.status==='已确认').length,writes};
console.log(JSON.stringify(result,null,2));
