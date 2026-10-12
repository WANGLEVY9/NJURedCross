/** Synthetic, isolated schema compatibility probe. Never runs against production. */
import {Base} from 'seatable-api';
import {randomUUID} from 'node:crypto';
import assert from 'node:assert/strict';
import {createSeaTableAccess} from '../lib/seatable-auth.js';
import {TEST_WORKFLOW_BASE} from '../lib/events/workflow-mode.js';
import {modifyColumn} from '../lib/events/registration-migration.js';
const name=`网站类型验证-${randomUUID()}`,other=`网站关联验证-${randomUUID()}`;let base,created=[],stage='authenticate';
try{
 if(!process.argv.includes('--confirm=ISOLATED-SCHEMA-PROBE')||process.env.SEATABLE_VOLUNTEER_BASE_UUID!==TEST_WORKFLOW_BASE)throw Error();
 base=new Base({server:process.env.SEATABLE_SERVER_URL,APIToken:process.env.SEATABLE_VOLUNTEER_API_TOKEN});await createSeaTableAccess(base)();if(base.dtableUuid!==TEST_WORKFLOW_BASE)throw Error();
 stage='create synthetic tables';await base.addTable(name,'zh-cn',['活动名称','标记','小时','日期','备注','状态'].map(column_name=>({column_name,column_type:'text'})));created.push(name);
 await base.addTable(other,'zh-cn',[{column_name:'编号',column_type:'text'},{column_name:'名称',column_type:'text'}]);created.push(other);
 stage='append synthetic row';const r=await base.appendRow(name,{活动名称:'合成类型验证',标记:'true',小时:'2.5',日期:'2026-10-12T11:36:48.198Z',备注:'合成备注',状态:'待录入'});
 let m=await base.getMetadata();
 for(const [column,type,data]of [['标记','checkbox',{}],['小时','number',{format:'number',precision:2,enable_precision:true}],['日期','date',{format:'YYYY-MM-DD HH:mm:ss'}],['备注','long-text',{}],['状态','single-select',{options:[{id:'a3f9058b',name:'待录入',color:'#FFDDE5',textColor:'#212529'}]}]]){
  stage=`convert ${column}`;await modifyColumn(base,name,m.tables.find(t=>t.name===name).columns.find(c=>c.name===column),{type},data);
 }
 stage='update typed values';await base.updateRow(name,r._id,{标记:true,小时:2.5,日期:'2026-10-12T11:36:48.198Z',备注:{text:'合成备注'},状态:'待录入'});
 stage='additional column types';for(const [column,type,data]of [['日期2','date',{format:'YYYY-MM-DD'}],['序号','auto-number',{format:'000',digits:3,prefix_type:null}],['修改时间','mtime',{}],['创建时间','ctime',{}],['修改者','last-modifier',{}],['图片','image',{}],['网址','url',{}]])await base.insertColumn(name,column,type,'',data);
 stage='new single-select option';await base.addColumnOptions(name,'状态',[{id:'b8f5c941',name:'已核对',color:'#FFDDE5',textColor:'#212529'}]);await base.updateRow(name,r._id,{状态:'已核对',日期2:'2026-10-12'});
 stage='insert link';m=await base.getMetadata();const display=m.tables.find(t=>t.name===other).columns.find(c=>c.name==='名称').key;await base.insertColumn(name,'关联','link','',{table:name,other_table:other,display_column_key:display});
 const linked=await base.appendRow(other,{编号:'synthetic-id',名称:'合成关联'});m=await base.getMetadata();const c=m.tables.find(t=>t.name===name).columns.find(c=>c.name==='关联');await base.updateLink(c.data.link_id,name,other,r._id,[linked._id]);
 stage='verify native values';const [a]=await base.listRows(name,'','',false,0,10);
 console.log(JSON.stringify({syntheticReadback:{checkbox:a.标记,number:a.小时,date:a.日期,longText:a.备注,select:a.状态,linkCount:a.关联?.length||0},columns:m.tables.find(t=>t.name===name).columns.map(c=>({name:c.name,type:c.type,data:c.data}))}));
 assert.equal(a.标记,true);assert.equal(a.小时,2.5);assert.equal(a.状态,'已核对');assert.ok(a.关联.length);assert.ok(a.日期);assert.ok(a.备注);assert.equal(a.日期2.slice(0,10),'2026-10-12');assert.ok(a.序号);assert.ok(a.创建时间);
 console.log(JSON.stringify({verified:true,syntheticOnly:true,values:{checkbox:a.标记,number:a.小时,date:a.日期,longText:a.备注},formats:m.tables.find(t=>t.name===name).columns.map(c=>({name:c.name,type:c.type,data:c.data}))}));
}catch(error){console.error(JSON.stringify({probeFailed:true,stage,httpStatus:error.response?.status||null,code:error.code==='ERR_ASSERTION'?'assertion':null}));process.exitCode=1;}
finally{if(base?.dtableUuid===TEST_WORKFLOW_BASE)for(const table of created.reverse())try{await base.deleteTable(table);console.log(JSON.stringify({removedSyntheticTable:table}));}catch{console.error('Synthetic probe cleanup needs attention');process.exitCode=1;}}
