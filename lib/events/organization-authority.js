import {organizationDirectory} from './organization-directory.js';
import {eventAccess} from './organization-access.js';
import {activityKind} from '../../public/app/shared/activity-taxonomy.js';
import {workflowConfig} from './blood-roster.js';
import {isAccountActive} from '../permissions.js';
import {readPagedRows} from '../http/paged-rows.js';
import {projectEvents} from '../../public/app/shared/activity-projects.js';

const denied=()=>Object.assign(new Error('当前账号不能管理此活动'),{statusCode:403,code:'event_scope_forbidden'});
const idOf=a=>a?.accountId||a?.username;

/** Request-local evidence only. Callers must supply fresh account and event rows. */
export async function organizationAuthority(account,base,events){
 if(!isAccountActive(account))throw denied();
 const verified=account.role==='super_admin'?account:(await organizationDirectory([account],base))[0];
 const access=event=>{
  const current=events.find(e=>e._id===event._id);
  const evidence=current||(/^BS-[a-f0-9]{24}$/.test(event._id||'')?{组织类别:'献血车专项'}:{});
  return eventAccess({account:verified,organization:verified.organization,
   category:activityKind({center:evidence['组织类别']||workflowConfig(evidence).center}),
   ownerIds:current?[current['负责人账号ID'],...(workflowConfig(current).coOwners||[])]:[]});
 };
 const global=verified.role==='super_admin'||verified.organization?.global===true;
 const visible=events.filter(event=>access(event).manage);
 return {
  account:verified,global,actor:idOf(verified),
  canEnter:Boolean(global||verified.organization?.categories?.length||visible.length),
  categories:verified.role==='super_admin'?null:verified.organization?.categories||[],
  access,
  assertCreate(body){if(!eventAccess({account:verified,organization:verified.organization,category:activityKind({center:body?.center})}).create)throw denied();},
  assertEvent(id){
   // Generated source IDs are never manually owned. Their workflow lookup still
   // verifies existence; only presidium/super-admin may pass this namespace.
   if(/^BS-[a-f0-9]{24}$/.test(id)&&global)return;
   const matches=events.filter(e=>e._id===id||e['活动ID']===id);if(matches.length!==1||!access(matches[0]).manage)throw denied();
   if(projectEvents(events,matches[0]).some(e=>!access(e).manage))throw denied();
   return matches[0];
  },
  assertGlobal(){if(!global)throw denied();},
  filter(data){
   const permitted=(data.events||[]).filter(e=>access(e).manage),ids=new Set(permitted.flatMap(e=>{
    const fresh=events.find(current=>current._id===e._id);
    return [fresh?.['活动ID']||e['活动ID'],...(global?workflowConfig(fresh||e).sourceActivityIds||[]:[])];
   }));
   const result={...data,events:permitted};
   for(const key of ['registrations','ledger','checkins'])if(Array.isArray(data[key]))result[key]=data[key].filter(row=>ids.has(row['活动ID']));
   // These are lifetime cross-activity aggregates, not event-scoped evidence.
   if(!global)for(const key of ['summaries','profiles'])if(Array.isArray(data[key]))result[key]=[];
   return result;
  },
 };
}

/** Raw table transport deliberately bypasses all display caches. */
export async function readAuthorityEvents(base){
 return readPagedRows(base,'网站活动流程表',{pageSize:1000,maxRows:100000,requireComplete:true});
}

export async function assertRecordAuthority(base,authority,kind,ids){
 const table={registrations:'网站活动报名总表',hours:'网站服务时长明细表'}[kind];
 if(!table||!Array.isArray(ids)||!ids.length||ids.length>100||new Set(ids).size!==ids.length||ids.some(id=>typeof id!=='string'||!id||id.length>150))throw denied();
 const quote=id=>`'${id.replace(/'/g,"''")}'`;
 const rows=base.query?await base.query(`SELECT _id,活动ID FROM \`${table}\` WHERE _id IN (${ids.map(quote).join(',')}) LIMIT 101`):
  (await readPagedRows(base,table,{pageSize:1000,maxRows:100000,requireComplete:true})).filter(r=>ids.includes(r._id));
 if(!Array.isArray(rows)||rows.length!==ids.length||rows.readMeta?.truncated||new Set(rows.map(r=>r._id)).size!==ids.length||rows.some(r=>!ids.includes(r._id)))throw denied();
 rows.forEach(row=>authority.assertEvent(row['活动ID']));
}
