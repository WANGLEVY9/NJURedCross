import { Base } from 'seatable-api';
import { WORKFLOW_SCHEMA } from '../lib/events/workflow.js';
import { workflowMode } from '../lib/events/workflow-mode.js';
const apply=process.argv.includes('--apply');
try {
 const base=new Base({server:process.env.SEATABLE_SERVER_URL,APIToken:process.env.SEATABLE_VOLUNTEER_API_TOKEN});await base.auth();
 const config=workflowMode(process.env);if(base.dtableUuid!==config.expected)throw Error('Workflow Base mismatch');
 const meta=await base.getMetadata();const plan=[];
 for(const definition of WORKFLOW_SCHEMA){const table=meta.tables.find(t=>t.name===definition.name);if(table&&definition.columns.some(name=>table.columns.some(c=>c.name===name&&c.type!=='text')))throw Error('Column type mismatch');plan.push({...definition,create:!table,columns:definition.columns.filter(name=>!table?.columns.some(c=>c.name===name))});}
 console.log(JSON.stringify({mode:apply?'apply':'preview',baseVerified:true,environment:config.mode,plan,rowWrites:0,legacyTableWrites:0}));
 if(apply){for(const item of plan){if(item.create)await base.addTable(item.name,'zh-cn',item.columns.map((name,index)=>({column_name:name,column_type:'text',anchor_column:index?item.columns[index-1]:''})));else for(const column of item.columns)await base.insertColumn(item.name,column,'text','');}
 const after=await base.getMetadata();if(WORKFLOW_SCHEMA.some(d=>d.columns.some(name=>!after.tables.find(t=>t.name===d.name)?.columns.some(c=>c.name===name&&c.type==='text'))))throw Error('Schema verification failed');console.log(JSON.stringify({verified:true,rowWrites:0,legacyTableWrites:0}));}
}catch{console.error('Workflow schema operation failed; raw SDK errors suppressed');process.exitCode=1;}
