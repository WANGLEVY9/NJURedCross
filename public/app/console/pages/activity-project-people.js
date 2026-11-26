import {h} from '../../core/dom.js';
import {field} from '../../ui/primitives.js';
import {activityMultiSelect} from './activity-multi-select.js';
import {getSessionState} from '../../core/api.js';
import {workspaceResponsibleIds} from '../../shared/activity-workspace.js';

/** One scoped request supplies collaboration choices and verified approval defaults. */
export function activityProjectPeople({ownerId,getContent,load,onChange,editable}){
  let sequence=0,disposed=false,options=null;
  const user=getSessionState().user||{};
  const owner=field({label:'立项负责人（本人）',value:(user.accountId||user.username)===ownerId?user.realName||user.label||ownerId:ownerId,readonly:true});
  const collaborators=activityMultiSelect({label:'协作负责人（可多选）',placeholder:'选择协作负责人',disabled:true,onChange:ids=>{
    const content=getContent();content.responsibleId=ownerId;content.responsibleIds=[ownerId,...ids];onChange();
  }});
  const reviewers=activityMultiSelect({label:'审批人（可多选）',placeholder:'选择审批人',disabled:true,onChange:ids=>{getContent().reviewerIds=ids;onChange();}});
  collaborators.classList.add('activity-people-picker');reviewers.classList.add('activity-people-picker');
  const message=h('p',{class:'t-caption activity-responsible-message','aria-live':'polite'});
  const pair=h('div',{class:'activity-people-pair'},collaborators,reviewers);
  const node=h('div',{class:'activity-draft-field-wide activity-project-people'},owner,pair,message);
  const name=id=>[options?.self,...options?.collaborators||[],...options?.reviewers||[]].find(person=>person?.id===id)?.name||((user.accountId||user.username)===id?user.realName||user.label||id:id);
  function optionList(list,selected){
    const rows=[...list,...selected.filter(id=>!list.some(row=>row.id===id)).map(id=>({id,name:id+'（已不在有效名单）'}))];
    return rows.map(row=>({id:row.id,name:rows.filter(other=>other.name===row.name).length>1?`${row.name}（${row.id}）`:row.name}));
  }
  function sync(){
    const d=getContent(),selected=workspaceResponsibleIds(d).filter(id=>id!==ownerId);owner.control.value=name(ownerId);
    collaborators.setOptions(optionList(options?.collaborators.filter(row=>row.id!==ownerId)||[],selected),selected);
    reviewers.setOptions(optionList(options?.reviewers||[],d.reviewerIds||[]),d.reviewerIds||[]);
    const locked=!editable||!options;
    collaborators.setDisabled(locked);reviewers.setDisabled(locked);
  }
  async function refresh({reset=false}={}){
    const current=++sequence,d=getContent();options=null;
    collaborators.setOptions([],[]);reviewers.setOptions([],[]);
    collaborators.setDisabled(true);reviewers.setDisabled(true);
    if(reset){d.responsibleId='';d.responsibleIds=[];delete d.projectOwnerId;delete d.reviewerIds;}
    sync();if(!d.region||!d.category){message.textContent='请选择活动地区和类别后配置协作负责人及审批人。';return;}
    message.textContent='正在加载当前地区和中心的人员…';
    try{
      const result=await load({region:d.region,category:d.category});if(disposed||current!==sequence)return;options=result;
      const target=getContent();
      if(editable){target.projectOwnerId=ownerId;target.responsibleIds=[ownerId,...workspaceResponsibleIds(target).filter(id=>id!==ownerId)];target.responsibleId=ownerId;if(target.reviewerIds===undefined)target.reviewerIds=[...result.defaultReviewerIds];}
      sync();onChange({automatic:!reset});message.textContent=result.unavailableDefaults.length?`默认审批人中 ${result.unavailableDefaults.join('、')} 尚未配置有效审批角色，请核对人员配置；当前已选审批人任意一位通过即生效。`:'默认选中对应中心主席、金中宸和袁金雨的有效账号；任意一位通过即生效。';
    }catch(error){if(!disposed&&current===sequence)message.textContent=error.message||'人员名单加载失败，请稍后重试。';}
  }
  return {node,refresh,sync,previewNames:()=>({projectOwnerName:name(ownerId),collaboratorNames:workspaceResponsibleIds(getContent()).filter(id=>id!==ownerId).map(name),reviewerNames:(getContent().reviewerIds||[]).map(name)}),dispose:()=>{disposed=true;sequence++;collaborators.dispose?.();reviewers.dispose?.();}};
}
