import {canonicalActivityCategory} from '../../public/app/shared/activity-taxonomy.js';
import {createHash,randomUUID} from 'node:crypto';
import {normalizeWorkspaceDraft,workspaceDraftErrors,workspaceNotice,isWorkspaceNoticeAuto} from '../../public/app/shared/activity-workspace.js';
import {workspaceContentFromEvent} from './workspace-event-copy.js';
const hash=value=>createHash('sha256').update(JSON.stringify(value)).digest('hex');
const fail=(code,message)=>Object.assign(new Error(message),{statusCode:code,code:'activity_workspace_conflict'});

/** Storage and authority are injected; callers must supply authoritative reads and a shared write queue. */
export function createWorkspaceDrafts({readCandidates,readById,readByRequest,append,update,authorize,queue,getCopyEvent,getAccess,getListScope=async actor=>({ownerId:actor,regions:[]}),validateResponsible=async content=>{if(content.responsibleId)throw fail(503,'负责人名单尚未接入');},now=()=>new Date().toISOString()}) {
  if([readCandidates,readById,readByRequest,append,update,authorize,queue,getListScope].some(f=>typeof f!=='function'))throw new Error('草稿服务缺少权威数据或权限依赖');
  const get=async id=>{const rows=await readById(id);if(rows.length!==1)throw fail(rows.length?409:404,'草稿不存在或标识重复');return rows[0];};
  const checkVersion=(row,version)=>{if(row.submission)throw fail(409,'此草稿已提交或提交结果待核对，不能继续修改');if(!Number.isSafeInteger(version)||version!==row.version)throw fail(409,'活动已被修改，请重新加载后核对');if(row.stage!=='草稿')throw fail(409,'当前阶段不能保存草稿');};
  const publicRow=async(row,actor)=>{if(row.removal)throw fail(410,'活动草稿已删除');return ({...(getAccess?{access:await getAccess(row,actor)}:{}),id:row.id,ownerId:row.ownerId,version:row.version,stage:row.stage,updatedAt:row.updatedAt,content:{...structuredClone(row.content),category:canonicalActivityCategory(row.content.category)},...(row.submission?{submissionStatus:row.submission.status,activityId:row.submission.activityId,submissionRequest:{expectedVersion:row.submission.draftVersion,digest:row.submission.digest}}:{})});};
  return {
    async list(actor){const result=[];for(const row of await readCandidates(await getListScope(actor))){if(row.removal)continue;try{await authorize(row,actor,'view');result.push(await publicRow(row,actor));}catch(error){if(error.statusCode!==403)throw error;}}return result;},
    async get(id,actor){const row=await get(id);await authorize(row,actor,'view');if(row.removal)throw fail(410,'活动草稿已删除');return publicRow(row,actor);},
    remove:(id,{expectedVersion,requestId},actor)=>queue(async()=>{
      const row=await get(id);await authorize(row,actor,'edit');
      if(typeof requestId!=='string'||!/^[a-zA-Z0-9_-]{16,100}$/.test(requestId))throw fail(400,'删除请求标识无效');
      if(row.removal){if(row.removal.actor!==actor||row.removal.requestId!==requestId||row.removal.expectedVersion!==expectedVersion)throw fail(409,'此草稿已被删除，请刷新列表');return {id,removed:true};}
      checkVersion(row,expectedVersion);
      const at=now();await update(id,{stage:'已归档',version:row.version+1,updatedAt:at,removal:{actor,requestId,expectedVersion,at}},row.version);
      return {id,removed:true};
    }),
    copyEvent:(sourceId,{requestId,expectedVersion},actor)=>queue(async()=>{
      if(!getCopyEvent)throw fail(503,'正式活动复制尚未开放');
      if(typeof requestId!=='string'||!/^[a-zA-Z0-9_-]{16,100}$/.test(requestId)||typeof expectedVersion!=='string'||!/^\d{1,20}$/.test(expectedVersion))throw fail(400,'复制标识或版本无效');
      // This provider must enforce fresh source-event authority before returning a row.
      const source=await getCopyEvent(sourceId,actor);
      if(!source||source._id!==sourceId)throw fail(404,'原活动不存在');
      const same=row=>row.eventCopySource?.id===sourceId&&row.eventCopySource.version===expectedVersion;
      const previous=await readByRequest(actor,requestId);
      if(previous.length){if(previous.length!==1||!same(previous[0]))throw fail(409,'复制请求标识已被使用');return publicRow(previous[0],actor);}
      if(String(source['申请版本'])!==expectedVersion)throw fail(409,'原活动已变化，请刷新后复制');
      const content=workspaceContentFromEvent(source);content.name=content.name.slice(0,496)+'（副本）';content.positions=content.positions.map(p=>({...p,id:randomUUID()}));
      await authorize({content,ownerId:actor,stage:'草稿'},actor,'create');
      try{await validateResponsible(content,actor);}catch(error){if(!content.responsibleId||![403,503].includes(error.statusCode))throw error;content.responsibleId='';if(content.responsibleIds)content.responsibleIds=[];await validateResponsible(content,actor);}
      if(getAccess&&!(await getAccess({content,ownerId:actor,stage:'草稿'},actor)).canEdit){content.responsibleId='';if(content.responsibleIds)content.responsibleIds=[];}
      content.notice=workspaceNotice(content);normalizeWorkspaceDraft(content);
      const row={id:randomUUID(),ownerId:actor,requestId,creationDigest:hash(content),version:1,stage:'草稿',content,preview:null,updatedAt:now(),eventCopySource:{id:sourceId,version:expectedVersion}};
      try{await append(row);}catch(error){if(error.code!=='workspace_duplicate_request')throw error;const matches=await readByRequest(actor,requestId);if(matches.length!==1||!same(matches[0]))throw fail(409,'复制请求冲突，请核对');return publicRow(matches[0],actor);}return publicRow(row,actor);
    }),
    copy:(sourceId,{requestId,expectedVersion},actor)=>queue(async()=>{
      if(typeof requestId!=='string'||!/^[a-zA-Z0-9_-]{16,100}$/.test(requestId)||typeof actor!=='string'||!actor||!Number.isSafeInteger(expectedVersion))throw fail(400,'复制标识或版本无效');
      const source=await get(sourceId);await authorize(source,actor,'view');if(source.removal)throw fail(410,'活动草稿已删除');
      const previous=await readByRequest(actor,requestId);
      const sameSource=row=>row.copySource?.id===sourceId&&row.copySource.version===expectedVersion;
      if(previous.length){if(previous.length!==1||!sameSource(previous[0]))throw fail(409,'复制请求标识已被使用');return publicRow(previous[0],actor);}
      if(source.version!==expectedVersion)throw fail(409,'原活动已修改，请重新加载后复制');
      const content=normalizeWorkspaceDraft({...source.content,name:source.content.name.slice(0,496)+'（副本）',positions:source.content.positions.map(position=>({...position,id:randomUUID()}))});
      if(getAccess&&!(await getAccess({content,ownerId:actor,stage:'草稿'},actor)).canEdit){content.responsibleId='';if(content.responsibleIds)content.responsibleIds=[];}
      content.notice=workspaceNotice(content);
      normalizeWorkspaceDraft(content);
      await authorize({content,ownerId:actor,stage:'草稿'},actor,'create');await validateResponsible(content,actor);
      const row={id:randomUUID(),ownerId:actor,requestId,creationDigest:hash(content),version:1,stage:'草稿',content,preview:null,updatedAt:now(),copySource:{id:sourceId,version:expectedVersion}};
      try{await append(row);}catch(error){if(error.code!=='workspace_duplicate_request')throw error;const matches=await readByRequest(actor,requestId);if(matches.length!==1||!sameSource(matches[0]))throw fail(409,'复制请求冲突，请核对');return publicRow(matches[0],actor);}
      return publicRow(row,actor);
    }),
    create:({requestId,content},actor)=>queue(async()=>{
      if(typeof requestId!=='string'||!/^[a-zA-Z0-9_-]{16,100}$/.test(requestId)||typeof actor!=='string'||!actor)throw fail(400,'创建标识无效');
      const normalized=normalizeWorkspaceDraft(content);await authorize({content:normalized,ownerId:actor,stage:'草稿'},actor,'create');await validateResponsible(normalized,actor);
      const matches=await readByRequest(actor,requestId);
      if(matches.length>1)throw fail(409,'创建标识重复，请核对');
      if(matches.length){if(hash(normalized)!==matches[0].creationDigest)throw fail(409,'创建请求已使用，不能替换内容');return publicRow(matches[0],actor);}
      const row={id:randomUUID(),requestId,creationDigest:hash(normalized),ownerId:actor,version:1,stage:'草稿',content:normalized,updatedAt:now(),preview:null};
      try{await append(row);}catch(error){
        if(error.code!=='workspace_duplicate_request')throw error;
        const matches=await readByRequest(actor,requestId);
        if(matches.length!==1||matches[0].creationDigest!==row.creationDigest)throw fail(409,'创建请求冲突，请重新核对');
        return publicRow(matches[0],actor);
      }return publicRow(row,actor);
    }),
    save:(id,{expectedVersion,content},actor)=>queue(async()=>{
      const row=await get(id);await authorize(row,actor,'edit');checkVersion(row,expectedVersion);
      const normalized=normalizeWorkspaceDraft(content);
      if(isWorkspaceNoticeAuto(row.content)&&normalized.notice===row.content.notice){normalized.notice=workspaceNotice(normalized);normalizeWorkspaceDraft(normalized);}
      await authorize({...row,content:normalized},actor,'edit-target');
      await validateResponsible(normalized,actor);
      const patch={content:normalized,version:row.version+1,preview:null,updatedAt:now()};await update(row.id,patch,row.version);return publicRow({...row,...patch},actor);
    }),
    preview:(id,{expectedVersion},actor)=>queue(async()=>{
      const row=await get(id);await authorize(row,actor,'view');if(row.removal)throw fail(410,'活动草稿已删除');if(!Number.isSafeInteger(expectedVersion)||expectedVersion!==row.version)throw fail(409,'活动已被修改，请重新加载后核对');
      const digest=hash({id:row.id,version:row.version,content:row.content});
      // Generating a view alone never records that the user has read it.
      return {...(await publicRow(row,actor)),digest,errors:workspaceDraftErrors(row.content)};
    }),
    confirmPreview:(id,{expectedVersion,digest},actor)=>queue(async()=>{
      const row=await get(id);await authorize(row,actor,'edit');checkVersion(row,expectedVersion);
      const expected=hash({id:row.id,version:row.version,content:row.content});
      if(typeof digest!=='string'||digest!==expected)throw fail(409,'预览版本已失效，请重新预览');
      await update(row.id,{preview:{actor,digest,version:row.version}},row.version);return {id:row.id,version:row.version,digest};
    }),
    async submission(id,{expectedVersion,digest},actor){
      // This returns a plan only. The workflow must revalidate inside its own mutation queue before applying.
      const row=await get(id);await authorize(row,actor,'edit');checkVersion(row,expectedVersion);
      const expected=hash({id:row.id,version:row.version,content:row.content});
      if(!row.preview||row.preview.actor!==actor||row.preview.version!==row.version||row.preview.digest!==expected||digest!==expected)throw fail(409,'提交前必须预览最新版本');
      const errors=workspaceDraftErrors(row.content);if(errors.length)throw fail(400,errors.join('；'));
      await validateResponsible(row.content,actor,{required:true});
      return {...(await publicRow(row,actor)),digest:expected};
    },
  };
}
