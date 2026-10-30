import {organizationDirectory} from './organization-directory.js';
import {eventAccess} from './organization-access.js';
import {activityKind} from '../../public/app/shared/activity-taxonomy.js';
import {workflowConfig} from './blood-roster.js';
import {isAccountActive} from '../permissions.js';
import {readPagedRows} from '../http/paged-rows.js';
import {displayRead} from '../http/display-reads.js';
import {projectEvents} from '../../public/app/shared/activity-projects.js';
import {workspaceCategories} from '../../public/app/shared/activity-workspace.js';
import {workspaceRosterEvidence} from './workspace-roster.js';

/** 权限证据的来源表。写入这张表会让缓存的投影失效。 */
export const AUTHORITY_EVENTS_TABLE = '网站活动流程表';

const denied=()=>Object.assign(new Error('当前账号不能管理此活动'),{statusCode:403,code:'event_scope_forbidden'});
const idOf=a=>a?.accountId||a?.username;

/** Request-local evidence only. Callers must supply fresh account and event rows. */
export async function organizationAuthority(account,base,events,{workspaceRoster}={}){
 if(!isAccountActive(account))throw denied();
 const regional=['nanjing','suzhou'].map(region=>workspaceRosterEvidence(idOf(account),region,workspaceRoster?.rows,{complete:workspaceRoster?.complete===true}));
 const configured=regional.some(row=>row.verified);
 const explicitPolicy=workspaceRoster?.policy==='two-stage'&&(!Array.isArray(workspaceRoster.managedAccountIds)||workspaceRoster.managedAccountIds.includes(idOf(account)));
 const verified=account.role==='super_admin'||configured||explicitPolicy?account:(await organizationDirectory([account],base))[0];
 const regionalAccess=(region,category,ownerIds=[])=>{
  const evidence=regional.find(row=>row.region===region&&row.verified);
  const organization=evidence?{verified:true,global:evidence.role==='global',categories:evidence.categories}:configured||explicitPolicy?{verified:false,categories:[]}:verified.organization;
  return eventAccess({account:verified,organization,category,ownerIds});
 };
 // 逐活动判定会遍历整表：先建索引，把 O(n²) 的查找降到 O(1)。
 // 保留首次出现，与原先 find() 的语义一致。
 const byId=new Map();
 for(const event of events)if(!byId.has(event._id))byId.set(event._id,event);
 const access=event=>{
  const current=byId.get(event._id);
  const evidence=current||(/^BS-[a-f0-9]{24}$/.test(event._id||'')?{组织类别:'献血车专项'}:{});
  const config=workflowConfig(evidence),region=['苏州地区','苏州活动'].includes(evidence['活动地区']||config.region)?'suzhou':'nanjing';
  return regionalAccess(region,activityKind({center:evidence['组织类别']||config.center}),current?[current['负责人账号ID'],...(config.coOwners||[])]:[]);
 };
 const global=verified.role==='super_admin'||regional.some(row=>row.verified&&row.role==='global')||!configured&&!explicitPolicy&&verified.organization?.global===true;
 const visible=events.filter(event=>access(event).manage);
 const creationScopes=['nanjing','suzhou'].flatMap(region=>workspaceCategories(region).filter(category=>regionalAccess(region,category).create).map(category=>({region,category})));
 return {
  account:verified,events,global,creationScopes,actor:idOf(verified),
  canEnter:Boolean(global||configured||!explicitPolicy&&verified.organization?.categories?.length||visible.length),
  categories:global?null:configured?[...new Set(regional.flatMap(row=>row.categories))]:explicitPolicy?[]:verified.organization?.categories||[],
  access,
  assertCreate(body){const region=['suzhou','苏州活动','苏州地区'].includes(body?.region)?'suzhou':'nanjing';if(!regionalAccess(region,activityKind({center:body?.center})).create)throw denied();},
  assertEvent(id){
   // Generated source IDs are never manually owned. Their workflow lookup still
   // verifies existence; regional blood-category authority may pass this namespace.
   if(/^BS-[a-f0-9]{24}$/.test(id)&&regionalAccess('nanjing','献血车专项').manage)return;
   const matches=events.filter(e=>e._id===id||e['活动ID']===id);if(matches.length!==1||!access(matches[0]).manage)throw denied();
   if(projectEvents(events,matches[0]).some(e=>!access(e).manage))throw denied();
   return matches[0];
  },
  assertGlobal(){if(!global)throw denied();},
  filter(data){
   const permitted=(data.events||[]).filter(e=>access(e).manage),ids=new Set(permitted.flatMap(e=>{
    const fresh=byId.get(e._id);
    return [fresh?.['活动ID']||e['活动ID'],...((global||!fresh&&/^BS-[a-f0-9]{24}$/.test(e._id||'')&&access(e).manage)?workflowConfig(fresh||e).sourceActivityIds||[]:[])];
   }));
   const result={...data,events:permitted};
   for(const key of ['registrations','ledger','checkins'])if(Array.isArray(data[key]))result[key]=data[key].filter(row=>ids.has(row['活动ID']));
   // These are lifetime cross-activity aggregates, not event-scoped evidence.
   if(!global)for(const key of ['summaries','profiles'])if(Array.isArray(data[key]))result[key]=[];
   return result;
  },
 };
}

/**
 * 权限证据缓存窗口（毫秒）。`0` 表示完全回到逐请求直读。
 *
 * 缓存只在展示读上下文内生效：`displayRead` 在 `withDisplayReads()` 之外
 * 直接取数，因此写请求拿到的永远是权威源，权限判定不会因为缓存而落后。
 */
export function authorityEventsTtlMs(env = process.env) {
  const raw = Number(env?.PLATFORM_AUTHORITY_CACHE_MS);
  if (Number.isSafeInteger(raw) && raw >= 0) return raw;
  // 15 秒与展示缓存窗口一致：管理端目录、详情与权限证据共享一次整表读取，
  // 明显降低跨境链路与上游限流下的重复回源；写入仍按表标签立即失效。
  return 15_000;
}

/** 权威读取：直接分页读取整张活动表，不经过任何缓存。 */
export async function readAuthorityEventsFresh(base){
 return readPagedRows(base,AUTHORITY_EVENTS_TABLE,{pageSize:1000,maxRows:100000,requireComplete:true});
}

/**
 * 请求级权限证据。
 *
 * 展示读上下文内使用带表标签的展示缓存（默认 3 秒），写入请求结束时会按
 * 「网站活动流程表」标签失效；上下文之外（写请求、脚本、测试）仍整表直读。
 * 判断依据始终是活动行本身，而不是缓存下来的鉴权结论。
 */
export async function readAuthorityEvents(base){
 const ttlMs=authorityEventsTtlMs();
 if(!ttlMs)return readAuthorityEventsFresh(base);
 return displayRead(base,JSON.stringify(['authorityEvents']),()=>readAuthorityEventsFresh(base),ttlMs,[AUTHORITY_EVENTS_TABLE]);
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
