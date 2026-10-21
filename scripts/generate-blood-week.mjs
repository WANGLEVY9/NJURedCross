/**
 * Owner-authorized maintenance: generate the next blood-vehicle week into the source table.
 *
 * 默认只读：只输出将要写入的计划。写入必须显式 `--apply --confirm=GENERATE-BLOOD-WEEK`。
 * 凭据由 stdin 临时传入，不写入源码、文件或日志；不复制任何志愿者身份信息。
 *
 * 用法：
 *   echo '{"server":"https://table.nju.edu.cn","volunteer":{"expected":"<uuid>","token":"<api-token>"}}' \
 *     | node scripts/generate-blood-week.mjs [--monday=2026-11-02] [--publish-at=2026-10-22T09:00:00+08:00|now]
 *                                            [--source-table=市献血车汇总] [--state-dir=/opt/njuredcross/.write-state]
 */
import {Base} from 'seatable-api';
import {createSeaTableAccess} from '../lib/seatable-auth.js';
import {createWorkflow} from '../lib/events/workflow.js';
import {createBloodWeekStore} from '../lib/events/blood-week-store.js';
import {planBloodWeek} from '../lib/events/blood-week-automation.js';

const PRODUCTION_VOLUNTEER_BASE='cc304b1d-a726-4f92-a9be-a6ffcaa54038';
const args=Object.fromEntries(process.argv.slice(2).filter(value=>value.startsWith('--')).map(value=>{const [key,rest]=value.slice(2).split('=');return [key,rest??'true'];}));
const apply=Boolean(args.apply),confirm=args.confirm==='GENERATE-BLOOD-WEEK';
const sourceTable=args['source-table']||'市献血车汇总';
const monday=args.monday||null;
const publishAt=args['publish-at']==='now'?null:args['publish-at'];
const actor='owner-authorized-maintenance:WANGLEVY9';

try{
 if(apply&&!confirm)throw new Error('Apply confirmation required');
 let input='';for await(const chunk of process.stdin){input+=chunk;if(input.length>16384)throw new Error('Invalid configuration envelope');}
 const cfg=JSON.parse(input);
 if(cfg.server!=='https://table.nju.edu.cn')throw new Error('Unexpected server');
 if(cfg.volunteer?.expected!==PRODUCTION_VOLUNTEER_BASE)throw new Error('Unexpected configured UUID');
 const base=new Base({server:cfg.server,APIToken:String(cfg.volunteer.token||'').trim()});
 await createSeaTableAccess(base)();
 if(base.dtableUuid!==PRODUCTION_VOLUNTEER_BASE)throw new Error('Authenticated UUID mismatch');
 const metadata=await base.getMetadata();
 if(!metadata.tables?.some(table=>table.name===sourceTable))throw new Error('Blood source table missing');
 const store=args['state-dir']?createBloodWeekStore(`${args['state-dir'].replace(/\/$/,'')}/blood-week-${cfg.volunteer.expected.slice(0,8)}.sqlite`):null;
 // 计划先算一次，预览就能看到将要写入的周次、模板与岗位数量。
 const preview=planBloodWeek({rows:await workflowSourceRows(base),now:Date.now(),monday});
 const previewPublishAt=publishAt===null?null:publishAt||(store?'按服务端配置的发布时间':'未指定，写入后立即开放');
 console.log(JSON.stringify({mode:apply?'apply':'preview',uuidVerified:true,sourceTable,monday:preview.monday,label:preview.label,week:preview.week,
  template:{monday:preview.template.monday,label:preview.template.label,week:preview.template.week,rows:preview.template.rows},
  positionCount:preview.positions.length,existing:preview.existing,publishAt:previewPublishAt,writes:false,emails:0}));
 if(!apply)process.exit(0);
 const workflow=createWorkflow(base,{mode:'production',bloodSourceTable:sourceTable,bloodWeekStore:store,assertWritable:async()=>{if(base.dtableUuid!==PRODUCTION_VOLUNTEER_BASE)throw new Error('Scope changed');}});
 const result=await workflow.generateBloodWeek({monday,publishAt,actor});
 const written=await workflowSourceRows(base);
 const inWeek=written.filter(row=>String(row['日期']||'').slice(0,10)>=result.monday&&String(row['日期']||'').slice(0,10)<=result.sunday);
 if(inWeek.length<result.rows)throw new Error('Post-write verification failed');
 console.log(JSON.stringify({ok:true,sourceTable,monday:result.monday,sunday:result.sunday,label:result.label,week:result.week,
  templateMonday:result.templateMonday,rows:result.rows,sessionRows:inWeek.length,publishAt:result.publishAt,emails:0}));
}catch{
 console.error(JSON.stringify({ok:false,message:'Generation stopped; credentials/raw SDK errors suppressed. Inspect the source table before retry.',partialWritesPossible:apply}));
 process.exitCode=1;
}

async function workflowSourceRows(base){
 const {readPagedRows}=await import('../lib/http/paged-rows.js');
 return readPagedRows(base,sourceTable,{maxRows:100000,requireComplete:true});
}
