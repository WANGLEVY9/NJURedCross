import {Base} from 'seatable-api';
import {createSeaTableAccess} from '../lib/seatable-auth.js';
import {QUOTE_TABLE,QUOTE_COLUMNS,quoteSchemaReady} from '../lib/community/quotes.js';
const base=new Base({server:process.env.SEATABLE_SERVER_URL||'https://table.nju.edu.cn',APIToken:process.env.SEATABLE_API_TOKEN});
await createSeaTableAccess(base)();
if(process.env.NODE_ENV==='production'&&base.dtableUuid!==process.env.SEATABLE_BUSINESS_BASE_UUID)throw Error('Business Base mismatch');
const existing=(await base.getMetadata()).tables.find(t=>t.name===QUOTE_TABLE);
if(existing){if(!await quoteSchemaReady(base))throw Error('Existing quote schema is incomplete; no changes made');console.log('Quote table already verified');}
else if(process.argv.includes('--apply')){
 if(!process.argv.includes('--confirm=CREATE-QUOTE-WALL'))throw Error('Missing schema confirmation');
 await base.addTable(QUOTE_TABLE,'zh-cn',QUOTE_COLUMNS.map((name,i)=>({column_name:name,column_type:'text',anchor_column:i?QUOTE_COLUMNS[i-1]:''})));
 if(!await quoteSchemaReady(base))throw Error('Quote schema verification failed');
 console.log('Quote table created and verified; no content inserted');
}else console.log(JSON.stringify({create:QUOTE_TABLE,columns:QUOTE_COLUMNS,write:false}));
