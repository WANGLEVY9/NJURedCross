import {createHash,randomUUID} from 'node:crypto';
import {normalizeWorkspaceDraft,workspaceDraftErrors} from '../../public/app/shared/activity-workspace.js';
const hash=value=>createHash('sha256').update(JSON.stringify(value)).digest('hex');
const fail=(code,message)=>Object.assign(new Error(message),{statusCode:code,code:'activity_workspace_conflict'});

/** Storage and authority are injected; callers must supply authoritative reads and a shared write queue. */
export function createWorkspaceDrafts({read,append,update,authorize,queue,validateResponsible=async content=>{if(content.responsibleId)throw fail(503,'负责人名单尚未接入');},now=()=>new Date().toISOString()}) {
  if([read,append,update,authorize,queue].some(f=>typeof f!=='function'))throw new Error('草稿服务缺少权威数据或权限依赖');
  const get=async id=>{const rows=(await read()).filter(r=>r.id===id);if(rows.length!==1)throw fail(rows.length?409:404,'草稿不存在或标识重复');return rows[0];};
  const checkVersion=(row,version)=>{if(row.submission)throw fail(409,'此草稿已提交或提交结果待核对，不能继续修改');if(!Number.isSafeInteger(version)||version!==row.version)throw fail(409,'活动已被修改，请重新加载后核对');if(row.stage!=='草稿')throw fail(409,'当前阶段不能保存草稿');};
  const publicRow=row=>({id:row.id,ownerId:row.ownerId,version:row.version,stage:row.stage,updatedAt:row.updatedAt,content:structuredClone(row.content),...(row.submission?{submissionStatus:row.submission.status,activityId:row.submission.activityId}:{})});
  return {
    async list(actor){const result=[];for(const row of await read()){try{await authorize(row,actor,'view');result.push(publicRow(row));}catch(error){if(error.statusCode!==403)throw error;}}return result;},
    async get(id,actor){const row=await get(id);await authorize(row,actor,'view');return publicRow(row);},
    create:({requestId,content},actor)=>queue(async()=>{
      if(typeof requestId!=='string'||!/^[a-zA-Z0-9_-]{16,100}$/.test(requestId)||typeof actor!=='string'||!actor)throw fail(400,'创建标识无效');
      const normalized=normalizeWorkspaceDraft(content);await authorize({content:normalized,ownerId:actor,stage:'草稿'},actor,'create');await validateResponsible(normalized,actor);
      const matches=(await read()).filter(r=>r.requestId===requestId&&r.ownerId===actor);
      if(matches.length>1)throw fail(409,'创建标识重复，请核对');
      if(matches.length){if(hash(normalized)!==matches[0].creationDigest)throw fail(409,'创建请求已使用，不能替换内容');return publicRow(matches[0]);}
      const row={id:randomUUID(),requestId,creationDigest:hash(normalized),ownerId:actor,version:1,stage:'草稿',content:normalized,updatedAt:now(),preview:null};
      try{await append(row);}catch(error){
        if(error.code!=='workspace_duplicate_request')throw error;
        const matches=(await read()).filter(r=>r.requestId===requestId&&r.ownerId===actor);
        if(matches.length!==1||matches[0].creationDigest!==row.creationDigest)throw fail(409,'创建请求冲突，请重新核对');
        return publicRow(matches[0]);
      }return publicRow(row);
    }),
    save:(id,{expectedVersion,content},actor)=>queue(async()=>{
      const row=await get(id);await authorize(row,actor,'edit');checkVersion(row,expectedVersion);
      const normalized=normalizeWorkspaceDraft(content);
      await authorize({...row,content:normalized},actor,'edit-target');
      await validateResponsible(normalized,actor);
      const patch={content:normalized,version:row.version+1,preview:null,updatedAt:now()};await update(row.id,patch,row.version);return publicRow({...row,...patch});
    }),
    preview:(id,{expectedVersion},actor)=>queue(async()=>{
      const row=await get(id);await authorize(row,actor,'view');if(!Number.isSafeInteger(expectedVersion)||expectedVersion!==row.version)throw fail(409,'活动已被修改，请重新加载后核对');
      const digest=hash({id:row.id,version:row.version,content:row.content});
      // Generating a view alone never records that the user has read it.
      return {...publicRow(row),digest,errors:workspaceDraftErrors(row.content)};
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
      return {...publicRow(row),digest:expected};
    },
  };
}
