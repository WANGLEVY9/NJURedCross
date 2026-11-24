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
  const searches=new WeakMap(),filters=new WeakMap();
  for(const [host,label] of [[collaborators,'搜索协作负责人'],[reviewers,'搜索审批人']]){
    const search=h('input',{class:'input activity-people-search',type:'search',placeholder:`${label}…`,'aria-label':label,autocomplete:'off',disabled:true});
    const count=h('span',{class:'t-caption activity-people-count',text:'已选 0 人','aria-live':'polite'});
    searches.set(host,search);filters.set(host,'');
    host.append(h('div',{class:'activity-people-tools'},search,count));
    search.addEventListener('input',()=>{
      filters.set(host,String(search.value||'').trim().toLowerCase());
      const choices=host.querySelector('.activity-responsible-choices');
      if(choices){
        for(const row of choices.querySelectorAll('.activity-person-choice')){
          row.hidden=Boolean(filters.get(host))&&!row.textContent.toLowerCase().includes(filters.get(host));
        }
      }
    });
  }
  const node=h('div',{class:'activity-draft-field-wide activity-project-people'},owner,collaborators,reviewers,message);
  const name=id=>[options?.self,...options?.collaborators||[],...options?.reviewers||[]].find(person=>person?.id===id)?.name||((user.accountId||user.username)===id?user.realName||user.label||id:id);
  function choices(host,list,selected,onSelect){
    host.disabled=!editable||!options;host.querySelector('.activity-responsible-choices')?.remove();
    const search=searches.get(host),count=host.querySelector('.activity-people-count');
    if(search)search.disabled=!editable||!options||!list.length;
    if(count)count.textContent=`已选 ${selected.length} 人`;
    const rows=[...list,...selected.filter(id=>!list.some(row=>row.id===id)).map(id=>({id,name:id+'（已不在有效名单）'}))];
    const filter=filters.get(host)||'';
    const choiceRows=rows.map(row=>{
      const text=rows.filter(other=>other.name===row.name).length>1?`${row.name}（${row.id}）`:row.name;
      return h('label',{class:'activity-person-choice',hidden:Boolean(filter)&&!text.toLowerCase().includes(filter)},h('input',{type:'checkbox',value:row.id,checked:selected.includes(row.id),on:{change:ev=>onSelect(row.id,ev.target.checked)}}),h('span',{text}));
    });
    host.append(h('div',{class:'activity-responsible-choices','aria-label':host.querySelector('legend')?.textContent||'候选人员'},...choiceRows,!rows.length?h('span',{class:'t-caption',text:options?'暂无候选人员':'请先选择活动地区和类别'}):null));
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
    for(const search of [searches.get(collaborators),searches.get(reviewers)])if(search)search.value='';
    filters.set(collaborators,'');filters.set(reviewers,'');
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
  return {node,refresh,sync,previewNames:()=>({projectOwnerName:name(ownerId),collaboratorNames:workspaceResponsibleIds(getContent()).filter(id=>id!==ownerId).map(name),reviewerNames:(getContent().reviewerIds||[]).map(name)}),dispose:()=>{disposed=true;sequence++;}};
}
