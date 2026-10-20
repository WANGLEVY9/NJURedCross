import {h} from '../../core/dom.js';
import {request} from '../../core/api.js';
import {button,field,notice,emptyState,definitionList,runWithLoading} from '../../ui/primitives.js';
import {openDrawer,openModal} from '../../ui/overlay.js';
import {notify,reportError} from '../../core/toast.js';
import {ACTIVITY_CENTERS} from '../../shared/activity-management.js';

const root='/api/volunteer/workflow';
const config=event=>{try{return JSON.parse(event?.['报名页配置']||'{}');}catch{return {};}};

/** Load source rows on demand and turn one into a normal legacy draft inside the unified directory. */
export async function openSourceIntake({events,onAdopted}){
 let response;
 try{response=await request(`${root}/sources`,{fresh:true});}
 catch(error){reportError(error,'来源活动暂时无法加载');return;}
 const adopted=new Set(events.map(event=>config(event).source?.key).filter(Boolean));
 const available=(response.sources||[]).filter(source=>!adopted.has(source.key));
 const list=h('div',{class:'activity-source-list'}),count=h('span',{class:'t-caption'});
 const search=field({label:'搜索来源活动',type:'search',placeholder:'名称、岗位或日期'});
 const drawer=openDrawer({title:'来源活动纳入',description:'来源记录会生成活动草稿；原有报名和签到记录不会被迁移或改写。',width:960,
  body:h('div',{class:'stack-4'},
   ...(response.warnings||[]).map(text=>notice(text,{tone:'warning'})),
   h('div',{class:'activity-registration-filters'},search,count),list),
  footer:[button({label:'关闭',onClick:()=>drawer.close()})]});
 function render(){
  const query=search.control.value.trim().toLowerCase();
  const rows=available.filter(source=>!query||`${source.name||''} ${source.position||''} ${source.date||''}`.toLowerCase().includes(query));
  count.textContent=`待纳入 ${available.length} 条 · 当前显示 ${Math.min(rows.length,50)} 条`;
  list.replaceChildren(...(rows.length?rows.slice(0,50).map(source=>h('article',{class:'activity-source-row stack-3'},
   h('div',{class:'row-between row-wrap'},h('strong',{text:source.name||'未命名来源活动'}),button({label:'纳入活动',variant:'primary',size:'sm',onClick:()=>openForm(source)})),
   definitionList([['来源表',source.table||'未提供'],['日期',source.date||'待填写'],['时段 / 岗位',[source.slot,source.position].filter(Boolean).join(' · ')||'待填写'],['地点',source.location||'待填写']])
  )):[emptyState({title:available.length?'没有匹配的来源活动':'来源活动均已纳入',description:available.length?'尝试调整搜索词。':'来源表发生变化后可重新打开此面板核对。'})]));
 }
 async function openForm(source){
  const categoryOptions=[{value:'',label:'请选择活动类别'},...ACTIVITY_CENTERS.map(value=>({value,label:value}))];
  const categoryDefault=ACTIVITY_CENTERS.includes(source.category)?source.category:'';
  const name=field({label:'活动名称',required:true,value:source.name||''}),
   region=field({label:'活动地区',value:'南京活动',options:[{value:'南京活动',label:'南京地区'},{value:'苏州活动',label:'苏州地区'}]}),
   category=field({label:'活动类别',required:true,value:categoryDefault,options:categoryOptions}),
   date=field({label:'活动日期',type:'date',required:true,value:/^\d{4}-\d{2}-\d{2}$/.test(source.date||'')?source.date:''}),
   slot=field({label:'活动时段',required:true,value:source.slot||''}),
   position=field({label:'岗位',value:source.position||'默认服务岗'}),
   capacity=field({label:'报名人数',type:'number',min:1,step:1,required:true,value:source.capacity||1}),
   serviceHours=field({label:'服务时长（小时）',type:'number',min:0.01,step:'any',required:true,value:source.serviceHours||1}),
   trainingHours=field({label:'培训时长（小时）',type:'number',min:0,step:'any',value:source.trainingHours??0}),
   travelHours=field({label:'交通时长（小时）',type:'number',min:0,step:'any',value:source.travelHours??0}),
   location=field({label:'活动地点',required:true,value:source.location||''}),
   work=field({label:'工作内容',multiline:true,rows:3,maxlength:500,required:true,value:source.work||source.name||''});
  const controls=[name,region,category,date,slot,position,capacity,serviceHours,trainingHours,travelHours,location,work];
  let saving=false,modal,save;
  save=button({label:'生成活动草稿',variant:'primary',onClick:async()=>{
   if(saving||controls.some(control=>!control.control.reportValidity()))return;
   saving=true;
   try{
    const result=await runWithLoading(save,()=>request(`${root}/adopt`,{method:'POST',body:{key:source.key,config:{
     name:name.control.value,region:region.control.value,category:category.control.value,center:category.control.value,
     date:date.control.value,slot:slot.control.value,position:position.control.value,capacity:capacity.control.value,
     serviceHours:serviceHours.control.value,trainingHours:trainingHours.control.value,travelHours:travelHours.control.value,
     location:location.control.value,work:work.control.value,bookingMode:'unified',submit:false,
    }}}));
    saving=false;await modal.close();await drawer.close();notify.success('来源活动已纳入为草稿');await onAdopted?.(result.result);
   }catch(error){reportError(error,'来源活动纳入未完成');}
   finally{saving=false;save.disabled=false;}
  }});
  modal=openModal({title:'纳入来源活动',width:900,body:h('div',{class:'stack-4'},notice(`来源：${source.table||'未提供'} · ${source.name||source.key}`,{tone:'neutral'}),h('div',{class:'activity-draft-grid'},...controls)),
   footer:[button({label:'取消',onClick:()=>modal.close()}),save]});
  modal.setCloseGuard(()=>!saving);
 }
 search.control.addEventListener('input',render);render();
}
