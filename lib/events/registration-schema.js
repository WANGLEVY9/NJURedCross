import {ACTIVITY_CATEGORY_OPTIONS,activityKind,activityRegion} from '../../public/app/shared/activity-taxonomy.js';
import {createHash} from 'node:crypto';

export const REGISTRATION_TABLE = '网站活动报名总表';
const select = (name,options) => ({name,type:'single-select',options});
const date = (name,time=false) => ({name,type:'date',data:{format:time?'YYYY-MM-DD HH:mm':'YYYY-MM-DD'}});
export const REGISTRATION_COLUMNS = [
 {name:'活动名称',type:'text'},select('活动类别',[...ACTIVITY_CATEGORY_OPTIONS]),
 ...['报名ID','活动ID','账号ID','学号','姓名','邮箱'].map(name=>({name,type:'text'})),
 select('院系',[]),date('报名日期'),select('报名时段',[]),select('岗位',[]),
 select('报名状态',['待筛选','已确认','已签到','未入选','已请假']),
 {name:'是否报名成功',type:'checkbox',data:{default_value:false,enable_fill_default_value:false}},
 {name:'志愿时长',type:'number',data:{format:'number',precision:2,enable_precision:true,decimal:'dot',thousands:'no'}},
 select('录入状态',['待录入','已录入','网站待核对','时长规则待确定','网站已入账']),
 {name:'签到行ID',type:'text'},date('创建时间',true),select('请假状态',['待审批','已批准','已驳回']),
 ...['请假原因'].map(name=>({name,type:'long-text'})),date('请假申请时间',true),
 {name:'处理说明',type:'long-text'},{name:'签到照片ID',type:'text'},date('签到提交时间',true),
 select('报名类型',['普通']),select('校区',['鼓楼校区','仙林校区','苏州校区','浦口校区']),
 {name:'岗位源行ID',type:'text'},select('岗位同步状态',['待同步','已同步','已释放','关联待核对']),
 select('地区',['南京地区','苏州地区']),{name:'活动类型',type:'text'},{name:'地点',type:'text'},
 date('开始时间',true),date('结束时间',true),
 select('部门',['综事','博爱','生命','苏州','志愿者','主席团 & 指导组','综事中心主任团','生命中心主任团','博爱中心主任团','工作组主任团']),select('性别',['男','女']),select('年级',[]),
 {name:'电话',type:'text'},{name:'QQ号',type:'text'},
 select('急救证',['是，AHA证书','是，红十字CPR+AED/初级救护员/救护员','否','否，但参加过“一加·急救培训”','未知']),
 ...['备注','备注2','注意事项'].map(name=>({name,type:'long-text'})),
 {name:'献血量',type:'number',data:{format:'number',precision:0,enable_precision:true,decimal:'dot',thousands:'no'}},
 {name:'图片',type:'image'},{name:'QQ群号',type:'text'},{name:'邀请链接',type:'url'},
 select('关联状态',['已关联','待补全','关联待核对']),
 {name:'序号',type:'auto-number',data:{format:'000',digits:3,prefix_type:null}},
 {name:'修改时间',type:'mtime'},{name:'修改者',type:'last-modifier'},{name:'系统创建时间',type:'ctime'},
 ...['创建时间原值','请假申请时间原值','签到提交时间原值'].map(name=>({name,type:'text'})),
 {name:'资料来源',type:'text'},date('资料补录时间',true),
];
export const REGISTRATION_LINKS = [
 {name:'活动名称2',target:'网站活动流程表',display:'活动名称'},
 {name:'签到表',target:'网站活动签到表',display:'签到ID'},
 {name:'时长明细',target:'网站服务时长明细表',display:'幂等键'},
 {name:'个人主页',target:'网站个人主页表',display:'姓名'},
];
const definitions = new Map(REGISTRATION_COLUMNS.map(c=>[c.name,c]));
const automatic = new Set(['auto-number','mtime','last-modifier','ctime','link','link-formula']);
export const cellText = v => typeof v==='object'&&v!==null&&!Array.isArray(v)?String(v.text??''):String(v??'');
export function certificateValue(v){const s=cellText(v).trim();if(!s)return '';if(/^是.*AHA/i.test(s))return '是，AHA证书';if(/^是.*(红十字|CPR|AED|救护)/i.test(s))return '是，红十字CPR+AED/初级救护员/救护员';if(/^否.*参加过/.test(s))return '否，但参加过“一加·急救培训”';return s==='否'?'否':'未知';}
export function canonicalCampus(v){const s=cellText(v).trim();return ['鼓楼','仙林','苏州','浦口'].includes(s)?`${s}校区`:s;}
const invalid = name => Object.assign(new Error(`报名表“${name}”值或列类型无效，请先核对底表。`),{statusCode:409,code:'registration_schema_conflict'});
export function typedCell(column,v){
 const s=cellText(v).trim();
 if(column.type==='checkbox'){
  if(v===true||['true','1','是','成功'].includes(s))return true;
  if(v===false||['','false','0','否'].includes(s))return false;
  throw invalid(column.name);
 }
 if(column.type==='number'){
  if(!s)return null;
  const n=Number(s);if(!Number.isFinite(n)||n<0||n>100000||(column.name==='献血量'&&!Number.isInteger(n)))throw invalid(column.name);
  return n;
 }
 if(column.type==='date'){
  if(!s)return null;
  if(column.name==='报名日期'){
   const d=s.slice(0,10);if(!/^\d{4}-\d{2}-\d{2}$/.test(d)||s.length>10&&!Number.isFinite(Date.parse(s))||!Number.isFinite(Date.parse(d))||new Date(`${d}T00:00:00Z`).toISOString().slice(0,10)!==d)throw invalid(column.name);
   return d;
  }
  const input=/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?$/.test(s)?s.replace(' ','T')+'Z':s;
  if(!/[Zz]$|[+-]\d{2}:\d{2}$/.test(input)||!Number.isFinite(Date.parse(input)))throw invalid(column.name);
  return new Date(input).toISOString();
 }
 if(column.type==='single-select')return column.name==='校区'?(canonicalCampus(s)||null):(s||null);
 if(column.type==='long-text')return s?{text:cellText(v)}:null;
 if(column.type==='image')return Array.isArray(v)?v:[];
 return cellText(v);
}

/** Domain compatibility keeps existing signed evidence stable across wire type conversion. */
export function normalizeRegistration(row){
 const out={...row};
 for(const c of REGISTRATION_COLUMNS){
  if(!Object.hasOwn(row,c.name)||automatic.has(c.type)||c.type==='image')continue;
  if(c.type==='checkbox')out[c.name]=row[c.name]===true?'true':row[c.name]===false?'false':cellText(row[c.name]);
  else if(c.type==='long-text')out[c.name]=cellText(row[c.name]);
  else if(c.type==='date'&&c.name!=='报名日期'&&row[c.name]){
   const current=typedCell(c,row[c.name]),original=row[`${c.name}原值`];
   out[c.name]=original&&Math.floor(Date.parse(original)/60000)===Math.floor(Date.parse(current)/60000)?original:current;
  }
  else out[c.name]=c.name==='报名日期'?cellText(row[c.name]).slice(0,10):cellText(row[c.name]);
 }
 return out;
}

export function registrationDetails(event,account={}){
 let config={};try{config=JSON.parse(event['报名页配置']||'{}');}catch{/* Validation is performed by the workflow. */}
 return {
  活动类别:activityKind({center:event['组织类别']||config.center,type:event['活动类别']}),活动类型:event['活动类别']||'',
  地区:activityRegion({region:event['活动地区']||config.region,campus:config.ordinary?.campus,location:event['地点']})==='suzhou'?'苏州地区':'南京地区',
  地点:event['地点']||'',开始时间:config.ordinary?.start||config.blood?.start||(config.startTime?`${event['报名日期']}T${config.startTime}:00+08:00`:''),
  结束时间:config.ordinary?.end||config.blood?.end||(config.endTime?`${event['报名日期']}T${config.endTime}:00+08:00`:''),
  报名类型:'普通',
  部门:account.division||'',性别:account.gender||'',年级:account.grade||'',电话:account.phone||'',QQ号:account.qq||'',急救证:certificateValue(account.certificate),资料来源:account.accountId?'已验证账号资料':'',
 };
}

/** Metadata-aware writer supports the old text schema during deployment and the typed schema afterwards. */
export function createRegistrationWriter(base){
 let metadata,expires=0;
 async function schema(){
  if(typeof base.getMetadata!=='function')return null; // Synthetic legacy fixtures.
  if(!metadata||Date.now()>expires){metadata=await base.getMetadata();expires=Date.now()+15000;}
  return metadata.tables?.find(t=>t.name===REGISTRATION_TABLE);
 }
 async function encode(row){
  const table=await schema();
  if(!table?.columns?.length)return Object.fromEntries(Object.entries({...row,...(row['活动类型']?{活动类别:row['活动类型']}: {})}).map(([k,v])=>[k,String(v??'')]));
  const output={},options=[];
  const source={...row};
  if(source['活动类别']==='未分类')source['活动类别']='';
  for(const c of REGISTRATION_COLUMNS)if(c.type==='date'&&Object.hasOwn(row,c.name)&&table.columns?.some(x=>x.name===`${c.name}原值`))source[`${c.name}原值`]=row[c.name]||'';
  for(const [name,v]of Object.entries(source)){
   const c=table.columns?.find(c=>c.name===name);if(!c||automatic.has(c.type))continue;
   const def=definitions.get(name);
   if(c.type!=='text'&&def&&c.type!==def.type)throw invalid(name);
   const value=c.type==='text'?cellText(v):typedCell(c,v);output[name]=value;
   if(c.type==='single-select'&&value&&!(c.data?.options||[]).some(o=>o.name===value))options.push({column:c,value});
  }
  if(!table.columns?.some(c=>c.name==='活动类型')&&row['活动类型'])output['活动类别']=row['活动类型'];
  for(const {column,value}of options){
   const allowed=definitions.get(column.name)?.options||[];
   if(allowed.length&&!allowed.includes(value))throw invalid(column.name);
   if(typeof base.addColumnOptions!=='function')throw invalid(column.name);
   const id=createHash('sha256').update(JSON.stringify([column.name,value])).digest('hex').slice(0,8);
   await base.addColumnOptions(REGISTRATION_TABLE,column.name,[{id,name:value,color:'#FFDDE5',textColor:'#212529'}]);
   column.data||={};column.data.options||=[];if(!column.data.options.some(o=>o.name===value))column.data.options.push({name:value});
  }
  return output;
 }
 async function encodeTable(name,row){
  if(name===REGISTRATION_TABLE)return encode(row);
  await schema();const columns=metadata?.tables?.find(t=>t.name===name)?.columns;
  if(!columns?.length)return Object.fromEntries(Object.entries(row).map(([k,v])=>[k,String(v??'')]));
  return Object.fromEntries(Object.entries(row).filter(([key])=>columns.some(c=>c.name===key&&!automatic.has(c.type))).map(([key,v])=>[key,String(v??'')]));
 }
 return {encode,encodeTable,metadata:async()=>{await schema();return metadata;},invalidate:()=>{metadata=null;expires=0;}};
}

export function registrationColumnType(name){return definitions.get(name)?.type||'text';}
