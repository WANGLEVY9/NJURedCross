import {h} from '../core/dom.js';
import {request} from '../core/api.js';
import {button} from '../ui/primitives.js';
import {openDrawer} from '../ui/overlay.js';
import {reportError} from '../core/toast.js';
const titles={training:'前期培训',location:'服务点位',hours:'时长查询',checkin:'签到示例'};
let cached=null,loadedAt=0;
async function load(){if(!cached||Date.now()-loadedAt>30000){loadedAt=Date.now();cached=request('/api/public/participation-guide').then(data=>data.guide).catch(error=>{cached=null;throw error;});}return cached;}
function link(key){return h('a',{href:'#blood-guide-'+key,on:{click:async e=>{e.preventDefault();try{const guide=await load();openDrawer({title:titles[key],width:880,body:guideSection(guide,key),footer:[]});}catch(error){reportError(error,'参与说明暂时无法加载');}}},text:titles[key]});}
function guideSection(guide,key){
 const paragraphs=String(guide[key]||'说明待补充').split(/\n\s*\n/);
 return h('section',{class:'blood-participation-guide'},...paragraphs.map(text=>{const [title,...rest]=text.split('\n');return h('div',{class:'blood-guide-block'},...(rest.length?[h('h3',{text:title}),h('p',{text:rest.join('\n')})]:[h('p',{text:title})]));}),...String(guide[key+'Image']||'').split('\n').filter(url=>/^https:\/\//.test(url)||/^\/assets\/blood-guide\/[A-Za-z0-9_.-]+$/.test(url)).map((url,index)=>h('figure',{},h('a',{href:url,target:'_blank',rel:'noopener noreferrer'},h('img',{src:url,alt:titles[key]+'参考图 '+(index+1),loading:'lazy'})),h('figcaption',{text:'点击图片可查看大图'}))));
}
export function bloodParticipationSummary(){
 const overview=h('p',{text:'本活动为预报名，报名结果需等待市血液中心确认。'});
 void load().then(guide=>{overview.textContent=guide.overview;}).catch(()=>{});
 return h('div',{class:'blood-participation-summary'},overview,h('p',{},'参加前请完成',link('training'),'，核对',link('location'),'，并了解',link('hours'),'；签到时可查看',link('checkin'),'。'));
}
export function bloodCheckinGuide(){const body=h('div',{class:'blood-participation-guide'},h('p',{text:'正在加载签到示例…'}));void load().then(guide=>body.replaceChildren(guideSection(guide,'checkin'))).catch(()=>body.replaceChildren(h('p',{},'签到说明暂时无法加载，请稍后重试。',link('checkin'))));return body;}
export function bloodRecordDetails(record){return h('div',{class:'blood-participation-summary'},h('p',{text:`您报名的是${record.eventName}，请按${record.date} ${record.slot}的班次安排前往${record.location||'指定点位'}。报名编号：${record.code}。`}),bloodParticipationSummary(),h('p',{text:`时长录入：${record.entryStatus||'待核对'}。`}));}
export const bloodGuidePreview=guide=>h('div',{class:'stack-4'},...Object.keys(titles).map(key=>h('section',{},h('h2',{text:titles[key]}),guideSection(guide,key))));
