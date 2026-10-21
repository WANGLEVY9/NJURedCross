import {workspaceResponsibleOptions,workspaceResponsibleProfile} from './workspace-responsible.js';
const root='/api/volunteer/workflow/workspace-drafts';
const fail=message=>Object.assign(new Error(message),{statusCode:400,code:'workspace_request_invalid'});
function exact(body,keys){if(!body||typeof body!=='object'||Array.isArray(body)||Object.keys(body).some(k=>!keys.includes(k))||keys.some(k=>body[k]===undefined))throw fail('草稿请求字段无效');return body;}

/** workflowRoutes establishes session, CSRF and trusted-origin checks before calling this handler. */
export async function workspaceDraftRoutes(req,res,url,ctx,session){
  if(url.pathname!==root&&!url.pathname.startsWith(root+'/'))return false;
  if(!ctx.getWorkspaceDrafts)return ctx.json(res,503,{ok:false,code:'workspace_not_enabled',message:'活动草稿工作区尚未开放'});
  const service=await ctx.getWorkspaceDrafts(session,ctx.workspaceAuthority),actor=ctx.actor(session);
  if(typeof actor!=='string'||!actor)throw Object.assign(new Error('登录身份无效'),{statusCode:401});
  if(url.pathname===root+'/role-settings'&&ctx.getWorkspaceRoleStore){
    const store=await ctx.getWorkspaceRoleStore();
    if(req.method==='GET')return ctx.json(res,200,{ok:true,result:await store.settings(actor)});
    if(req.method==='PUT'){const result=await store.save(actor,await ctx.readJson(req));await ctx.audit(req,session,'workflow.workspace.roles.update','activity-roles');ctx.queueApprovalReminders?.();return ctx.json(res,200,{ok:true,result});}
  }
  if(url.pathname===root+'/capabilities'&&req.method==='GET'){
    let rosterAvailable=false;
    if(ctx.getWorkspaceRoster){
      try{rosterAvailable=(await ctx.getWorkspaceRoster(session,ctx.workspaceAuthority))?.complete===true;}
      catch{/* The capability response is a closed boolean, not a roster diagnostic. */}
    }
    return ctx.json(res,200,{ok:true,capabilities:{enabled:true,rosterAvailable,canSubmit:rosterAvailable&&typeof ctx.getWorkspaceSubmissions==='function'}});
  }
  const eventCopy=url.pathname.match(/^\/api\/volunteer\/workflow\/workspace-drafts\/from-event\/([a-zA-Z0-9_-]{1,100})\/copy$/);
  if(eventCopy&&req.method==='POST'){const result=await service.copyEvent(eventCopy[1],exact(await ctx.readJson(req),['requestId','expectedVersion']),actor);await ctx.audit(req,session,'workflow.workspace.copy-event',result.id);return ctx.json(res,201,{ok:true,result});}
  if(url.pathname===root+'/responsible-profile'&&req.method==='GET'){
    if(!ctx.getWorkspaceRoster||!ctx.getWorkspaceProfileData)return ctx.json(res,503,{ok:false,message:'个人资料档案尚未接入'});
    const region=url.searchParams.get('region'),category=url.searchParams.get('category'),targetId=url.searchParams.get('accountId'),roster=await ctx.getWorkspaceRoster(session,ctx.workspaceAuthority);
    if(!workspaceResponsibleOptions(actor,region,category,roster).some(row=>row.id===targetId))return ctx.json(res,403,{ok:false,message:'无法查看该负责人的资料'});
    const profile=workspaceResponsibleProfile(actor,region,category,targetId,roster,await ctx.getWorkspaceProfileData(targetId,session,ctx.workspaceAuthority));
    return ctx.json(res,200,{ok:true,profile});
  }
  if(url.pathname===root+'/responsible-options'&&req.method==='GET'){
    if(!ctx.getWorkspaceRoster)return ctx.json(res,503,{ok:false,message:'负责人名单尚未接入'});
    const options=workspaceResponsibleOptions(actor,url.searchParams.get('region'),url.searchParams.get('category'),await ctx.getWorkspaceRoster(session,ctx.workspaceAuthority));
    return ctx.json(res,200,{ok:true,options});
  }
  if(url.pathname===root){
    if(req.method==='GET')return ctx.json(res,200,{ok:true,drafts:await service.list(actor),capabilities:{canSubmit:typeof ctx.getWorkspaceSubmissions==='function'}});
    if(req.method==='POST'){const result=await service.create(exact(await ctx.readJson(req),['requestId','content']),actor);await ctx.audit(req,session,'workflow.workspace.create',result.id);return ctx.json(res,201,{ok:true,result});}
  }
  const match=url.pathname.match(/^\/api\/volunteer\/workflow\/workspace-drafts\/([a-zA-Z0-9_-]{1,100})(?:\/(preview|confirm-preview|submit|copy|remove))?$/);
  if(match){
    const [,id,action]=match;
    if(req.method==='POST'&&action==='remove'){const result=await service.remove(id,exact(await ctx.readJson(req),['requestId','expectedVersion']),actor);await ctx.audit(req,session,'workflow.workspace.remove',id);return ctx.json(res,200,{ok:true,result});}
    if(req.method==='POST'&&action==='copy'){const result=await service.copy(id,exact(await ctx.readJson(req),['requestId','expectedVersion']),actor);await ctx.audit(req,session,'workflow.workspace.copy',result.id);return ctx.json(res,201,{ok:true,result});}
    if(req.method==='POST'&&action==='submit'&&ctx.getWorkspaceSubmissions){const body=exact(await ctx.readJson(req),['expectedVersion','digest']);const submissions=await ctx.getWorkspaceSubmissions(session,ctx.workspaceAuthority);const result=await submissions.submit(id,body,actor);ctx.queueApprovalReminders?.();await ctx.audit(req,session,'workflow.workspace.submit',id);return ctx.json(res,200,{ok:true,result});}
    if(req.method==='GET'&&!action)return ctx.json(res,200,{ok:true,result:await service.get(id,actor)});
    if(req.method==='PATCH'&&!action){const result=await service.save(id,exact(await ctx.readJson(req),['expectedVersion','content']),actor);await ctx.audit(req,session,'workflow.workspace.save',id);return ctx.json(res,200,{ok:true,result});}
    if(req.method==='POST'&&action==='preview')return ctx.json(res,200,{ok:true,result:await service.preview(id,exact(await ctx.readJson(req),['expectedVersion']),actor)});
    if(req.method==='POST'&&action==='confirm-preview'){const result=await service.confirmPreview(id,exact(await ctx.readJson(req),['expectedVersion','digest']),actor);await ctx.audit(req,session,'workflow.workspace.preview-confirm',id);return ctx.json(res,200,{ok:true,result});}
  }
  return ctx.json(res,405,{ok:false,message:'此草稿操作暂不支持'});
}
