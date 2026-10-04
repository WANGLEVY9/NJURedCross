/** Source adapters expose activity definitions, never historical student records. */
import {createHash} from 'node:crypto';
const text=v=>typeof v==='string'?v.trim():'';
const hash=v=>createHash('sha256').update(JSON.stringify(v)).digest('hex');
export function sourceActivities(registrations,applications,managed=[]){
 const groups=new Map();
 for(const r of registrations){const name=text(r['活动名称']);if(!name)continue;const fields=[text(r['活动类别']),name,text(r['报名日期']).slice(0,10),text(r['报名时段']),text(r['岗位'])];const id=hash(fields);if(!groups.has(id))groups.set(id,{key:`registrations:${id}`,table:'活动报名总表',sourceId:id,name,category:fields[0]||'公益活动',date:fields[2],slot:fields[3],position:fields[4],location:'',work:'',capacity:'',serviceHours:'',trainingHours:0,travelHours:0,sourceHash:id,kind:'registrations',count:0});groups.get(id).count++;}
 const app=applications.filter(r=>text(r['活动名称'])).map(r=>{const definition={name:text(r['活动名称']),category:text(r['活动类别'])||'公益活动',date:text(r['活动日期']).slice(0,10),slot:'',position:'',location:text(r['场地']),work:text(r['活动信息']),capacity:'',serviceHours:'',trainingHours:0,travelHours:0};return {key:`applications:${r._id}`,table:'登记审批',sourceId:r._id,sourceHash:hash(definition),kind:'applications',...definition};});
 const projects=managed.map(r=>{const definition={name:r.name,category:r.type||'公益活动',date:String(r.startAt||'').slice(0,10),slot:'',position:'',location:r.location||'',work:r.description||'',capacity:r.capacity||'',serviceHours:'',trainingHours:0,travelHours:0};return {key:`managed:${r.eventId}`,table:'活动项目表',sourceId:r.eventId,sourceHash:hash(definition),kind:'managed',...definition};});
 return [...groups.values(),...app,...projects];
}
