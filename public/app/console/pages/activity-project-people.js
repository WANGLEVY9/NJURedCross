import {h} from '../../core/dom.js';
import {field} from '../../ui/primitives.js';
import {getSessionState} from '../../core/api.js';
import {workspaceResponsibleIds} from '../../shared/activity-workspace.js';

/** One scoped request supplies collaboration choices and verified approval defaults. */
export function activityProjectPeople({ownerId,getContent,load,onChange,editable}){
  let sequence=0,disposed=false,options=null;
  const user=getSessionState().user||{};
  const owner=field({label:'立项负责人（本人）',value:(user.accountId||user.username)===ownerId?user.realName||user.label||ownerId:ownerId,readonly:true});
  const picker=label=>h('fieldset',{class:'field activity-responsible-picker'},h('legend',{class:'field__label',text:label}));
  const collaborators=picker('协作负责人（可选择）'),reviewers=picker('审批人（可多选）'),message=h('p',{class:'t-caption','aria-live':'polite'});
  const node=h('div',{class:'activity-draft-field-wide activity-project-people'},owner,collaborators,reviewers,message);
  const name=id=>[options?.self,...options?.collaborators||[],...options?.reviewers||[]].find(person=>person?.id===id)?.name||id;
  function choices(host,list,selected,onSelect){
    host.disabled=!editable||!options;host.querySelector('.activity-responsible-choices')?.remove();
    const rows=[...list,...selected.filter(id=>!list.some(row=>row.id===id)).map(id=>({id,name:id+'（已不在有效名单）'}))];
    host.append(h('div',{class:'activity-responsible-choices'},...rows.map(row=>h('label',{},h('input',{type:'checkbox',value:row.id,checked:selected.includes(row.id),on:{change:ev=>onSelect(row.id,ev.target.checked)}}),h('span',{text:rows.filter(other=>other.name===row.name).length>1?`${row.name}（${row.id}）`:row.name}))),!rows.length?h('span',{class:'t-caption',text:options?'暂无候选人员':'请先选择活动地区和类别'}):null));
  }
  function sync(){
    const d=getContent(),selected=workspaceResponsibleIds(d).filter(id=>id!==ownerId);owner.control.value=name(ownerId);
    choices(collaborators,options?.collaborators.filter(row=>row.id!==ownerId)||[],selected,(id,checked)=>{
      const ids=workspaceResponsibleIds(getContent()).filter(id=>id!==ownerId);
      getContent().responsibleId=ownerId;getContent().responsibleIds=[ownerId,...(checked?[...ids,id]:ids.filter(value=>value!==id))];onChange();
    });
    choices(reviewers,options?.reviewers||[],d.reviewerIds||[],(id,checked)=>{const ids=getContent().reviewerIds||[];getContent().reviewerIds=checked?[...ids,id]:ids.filter(value=>value!==id);onChange();});
  }
  async function refresh({reset=false}={}){
    const current=++sequence,d=getContent();options=null;
    if(reset){d.responsibleId='';d.responsibleIds=[];delete d.projectOwnerId;delete d.reviewerIds;}
    sync();if(!d.region||!d.category){message.textContent='请选择活动地区和类别后配置协作负责人及审批人。';return;}
    message.textContent='正在加载当前地区和中心的人员…';
    try{
      const result=await load({region:d.region,category:d.category});if(disposed||current!==sequence)return;options=result;
      const target=getContent();target.projectOwnerId=ownerId;target.responsibleIds=[ownerId,...workspaceResponsibleIds(target).filter(id=>id!==ownerId)];target.responsibleId=ownerId;
      if(target.reviewerIds===undefined)target.reviewerIds=[...result.defaultReviewerIds];
      sync();onChange();message.textContent=result.unavailableDefaults.length?`默认审批人中 ${result.unavailableDefaults.join('、')} 尚未配置有效审批角色，请核对人员配置；当前已选审批人任意一位通过即生效。`:'默认选中对应中心主席、金中宸和袁金雨的有效账号；任意一位通过即生效。';
    }catch(error){if(!disposed&&current===sequence)message.textContent=error.message||'人员名单加载失败，请稍后重试。';}
  }
  return {node,refresh,sync,previewNames:()=>({projectOwnerName:name(ownerId),collaboratorNames:workspaceResponsibleIds(getContent()).filter(id=>id!==ownerId).map(name),reviewerNames:(getContent().reviewerIds||[]).map(name)}),dispose:()=>{disposed=true;sequence++;}};
}
