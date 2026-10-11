import {Base} from 'seatable-api';
import {createSeaTableAccess} from '../lib/seatable-auth.js';
import {MESSAGE_TABLE,MESSAGE_COLUMNS,messageSchemaReady} from '../lib/community/messages.js';
const base=new Base({server:process.env.SEATABLE_SERVER_URL||'https://table.nju.edu.cn',APIToken:process.env.SEATABLE_API_TOKEN});
await createSeaTableAccess(base)();
if(process.env.NODE_ENV==='production'&&base.dtableUuid!==process.env.SEATABLE_BUSINESS_BASE_UUID)throw Error('Business Base mismatch');
const existing=(await base.getMetadata()).tables.find(t=>t.name===MESSAGE_TABLE);
if(existing){if(!await messageSchemaReady(base))throw Error('Existing message schema is incomplete; no changes made');console.log('Message table already verified');}
else if(process.argv.includes('--apply')){
 if(!process.argv.includes('--confirm=CREATE-MESSAGE-WALL'))throw Error('Missing schema confirmation');
 await base.addTable(MESSAGE_TABLE,'zh-cn',MESSAGE_COLUMNS.map((name,i)=>({column_name:name,column_type:'text',anchor_column:i?MESSAGE_COLUMNS[i-1]:''})));
 if(!await messageSchemaReady(base))throw Error('Message schema verification failed');
 console.log('Message table created and verified; no content inserted');
}else console.log(JSON.stringify({create:MESSAGE_TABLE,columns:MESSAGE_COLUMNS,write:false}));
