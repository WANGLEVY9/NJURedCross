import {createWorkflow,workflowEventApproved,workflowApprovalHash} from './workflow.js';
import {workspaceWorkflowInput} from './workspace-workflow-bridge.js';
import {workspaceEditDigest,workspaceBeforeStart} from './workspace-live-edit.js';
import {workspaceEditReference} from './workspace-edit-receipt.js';
import {assertWorkflowConfigWrite} from './workflow-config-integrity.js';

const stop=message=>{throw Error(`恢复停止：${message}`);};
function valueEnd(text,start){
 const stack=[];let quoted=false,escaped=false;
 for(let i=start;i<text.length;i++){
  const c=text[i];
  if(quoted){if(escaped)escaped=false;else if(c==='\\')escaped=true;else if(c==='"'){quoted=false;if(!stack.length)return i+1;}continue;}
  if(c==='"')quoted=true;
  else if(c==='{'||c==='[')stack.push(c);
  else if(c==='}'||c===']'){
   if(!stack.length)return i;
   if(stack.pop()!==(c==='}'?'{':'['))stop('JSON 括号不匹配');
   if(!stack.length)return i+1;
  }else if(!stack.length&&(c===','||/\s/.test(c)))return i;
 }
 return -1;
}
/** Extract complete members only; never invent the end of an incomplete value. */
function members(text){
 if(text[0]!=='{')stop('不是 JSON 对象');
 const result={};let i=1;
 while(i<text.length){
  while(/\s/.test(text[i]||'')&&i<text.length)i++;
  if(text[i]==='}')return {result};
  if(text[i]!=='"')stop('JSON 属性名不完整');
  const keyEnd=valueEnd(text,i);if(keyEnd<0)stop('JSON 属性名被截断');
  const key=JSON.parse(text.slice(i,keyEnd));if(Object.hasOwn(result,key))stop('JSON 属性重复');
  i=keyEnd;while(/\s/.test(text[i]||'')&&i<text.length)i++;
  if(text[i++]!==':')stop('JSON 分隔符损坏');
  while(/\s/.test(text[i]||'')&&i<text.length)i++;
  const end=valueEnd(text,i);if(end<0)return {result,incomplete:key,tail:text.slice(i)};
  result[key]=JSON.parse(text.slice(i,end));i=end;
  while(/\s/.test(text[i]||'')&&i<text.length)i++;
  if(text[i]==='}')return {result};
  if(text[i++]!==',')stop('JSON 属性之间缺少逗号');
 }
 stop('JSON 在属性之间结束');
}

export function extractLegacyWorkspaceEdit(parent){
 const raw=parent['报名页配置'];if(typeof raw!=='string'||raw.length!==10_000)stop('不是已知的 10000 字符截断记录');
 const root=members(raw);if(root.incomplete!=='workspaceEdit')stop('截断位置不是旧修改回执');
 const edit=members(root.tail);if(edit.incomplete!=='plan')stop('完整修改请求无法提取');
 const p=edit.result;
 if(p.status!=='applying'||!p.actor||!/^[a-f0-9]{64}$/.test(p.token)||p.expectedVersion!==Number(parent['申请版本'])
  ||String(parent['批准版本'])!==String(parent['申请版本'])||workspaceEditDigest(p.content)!==p.digest)stop('原请求身份、版本或内容摘要不一致');
 const old=root.result;if(!old.workspaceSubmission||old.bookingMode!=='grouped'||!old.positionPlan?.complete||old.workspaceRemoval)stop('原活动不是可恢复的已发布多岗位活动');
 return {old,pending:p};
}

/** Read-only reconstruction. Existing signed jobs must already prove the entire intended edit. */
export async function planLegacyWorkspaceRecovery(data,{now=Date.now()}={}){
 const parent=data.parent,{old,pending}=extractLegacyWorkspaceEdit(parent),input=workspaceWorkflowInput(pending.content);
 const ids=old.positionPlan.eventIds;
 if(!Array.isArray(ids)||new Set(ids).size!==ids.length||input.content.bookingMode!=='grouped'||ids.length!==input.content.positions.length
  ||input.content.positions.some((p,i)=>p.id!==`source-${i}`))stop('原岗位身份不完整或涉及增删岗位');
 const children=data.events.filter(row=>{try{return JSON.parse(row['报名页配置']).parentActivityId===parent['活动ID'];}catch{return false;}});
 if(children.length!==ids.length||ids.some(id=>children.filter(row=>row['活动ID']===id).length!==1))stop('原岗位关联缺失或重复');
 const first=children[0],config=JSON.parse(first['报名页配置']),version=pending.expectedVersion+1,stamp=Date.parse(first['审批时间']);
 if(!Number.isFinite(stamp)||stamp>now||!workspaceBeforeStart({...parent,报名页配置:JSON.stringify(old)},now)
  ||children.some(row=>!workflowEventApproved(row)||Number(row['申请版本'])!==version||row['审批人']!==pending.actor
   ||row['审批时间']!==first['审批时间']||JSON.stringify(JSON.parse(row['报名页配置']).approval)!==JSON.stringify(config.approval)))stop('现有岗位的批准证据不一致');
 if(config.approval?.mode!=='workspace-regional'||config.approval.version!==String(version)
  ||config.approval.region!==input.content.region||config.approval.category!==input.content.category)stop('地区批准绑定不一致');
 const allIds=new Set([parent['活动ID'],...ids]);
 if(data.checkins.some(row=>allIds.has(row['活动ID']))||data.ledger.some(row=>allIds.has(row['活动ID'])))stop('已有签到或时长证据');
 // This adapter has no real write capability; prepare cannot alter production schema or data.
 const workflow=createWorkflow({getMetadata:async()=>({tables:[]})},{now:()=>stamp});
 input.responsibleNames=config.workspaceResponsibleNames;input.responsibleName=config.workspaceResponsibleName;
 const prepared=await workflow.prepareWorkspaceSubmission(input,pending.actor,{assign:async()=>structuredClone(config.approval)},{version});
 const previous={...parent,报名页配置:JSON.stringify(old)};
 const plan=workflow.planWorkspaceEdit({event:previous,data,prepared,content:input.content,actor:pending.actor});
 const differs=(row,patch)=>Object.entries(patch).filter(([key,val])=>String(row[key]??'')!==String(val??'')).map(([key])=>key);
 if(plan.removed.length||plan.jobs.some(item=>!item.id))stop('恢复计划试图创建或删除岗位');
 for(const item of plan.jobs){const row=children.find(row=>row._id===item.id),different=differs(row,item.row);if(different.length)stop(`已批准岗位与原请求不一致：${different.join('、')}`);}
 const registrationPatches=plan.registrationPatches.filter(item=>{
  const rows=data.registrations.filter(row=>row._id===item.id);if(rows.length!==1)stop('报名行身份不唯一');return differs(rows[0],item.patch).length;
 });
 const groups=data.groups.filter(row=>row['活动组ID']===plan.group?.id);
 if(groups.length!==1)stop('项目控制行缺失或重复');
 const group=groups[0],groupPatch=Object.fromEntries(Object.entries(plan.group.patch).filter(([key,val])=>!['修改人','更新时间'].includes(key)&&String(group[key]??'')!==String(val??'')));
 if(Object.keys(groupPatch).length&&Date.parse(group['更新时间'])>stamp)stop('原修改后项目门禁有新变更');
 const receipt={...pending,previousEvent:structuredClone(parent),plan,recovery:{kind:'legacy-truncated-v1',sourceDigest:workspaceEditDigest(data)}};
 const c=JSON.parse(plan.parentPatch['报名页配置']);c.workspaceEdit=workspaceEditReference(receipt,'complete');
 const parentPatch={...plan.parentPatch,报名页配置:JSON.stringify(c)};parentPatch['批准摘要']=workflowApprovalHash({...parent,...parentPatch});assertWorkflowConfigWrite(parentPatch);
 return {receipt,parentPatch,registrationPatches,groupId:group._id,groupPatch,sourceDigest:receipt.recovery.sourceDigest};
}
