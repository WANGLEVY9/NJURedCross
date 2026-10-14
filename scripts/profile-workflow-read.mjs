/** Read-only timing probe. Outputs counts/timings only, never rows or SDK errors. */
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';
import { gzipSync } from 'node:zlib';
const require = createRequire(`${process.cwd()}/package.json`);
const { Base } = require('seatable-api');
const local = name => import(pathToFileURL(`${process.cwd()}/${name}`));
const { createSeaTableAccess } = await local('lib/seatable-auth.js');
const { createWorkflow } = await local('lib/events/workflow.js');
const { workflowMode } = await local('lib/events/workflow-mode.js');
const { withDisplayReads } = await local('lib/http/display-reads.js');
const { withRequestBudget } = await local('lib/http/request-budget.js');
const config = workflowMode(process.env);
const base = new Base({server:process.env.SEATABLE_SERVER_URL,APIToken:process.env.SEATABLE_VOLUNTEER_API_TOKEN});
const counts = new Map();
function instrument(){const list = base.listRows.bind(base);
base.listRows = async (...args) => {
 const start=performance.now();
 const entry=counts.get(args[0])||{table:args[0],pages:0,rows:0,ms:0};counts.set(args[0],entry);
 try {const rows=await list(...args);entry.pages++;entry.rows+=rows.length;return rows;}
 finally {entry.ms+=Math.round(performance.now()-start);}
};}
try {
 const start=performance.now();await createSeaTableAccess(base)();
 if(base.dtableUuid!==config.expected)throw Error('Unexpected Base');
 console.log(JSON.stringify({authMs:Math.round(performance.now()-start)}));
 instrument();
 const workflow=createWorkflow(base,{mode:config.mode,bloodSourceTable:config.bloodSourceTable});
 for(const run of ['cold','warm']){
  const begin=performance.now();
  try {const data=await withRequestBudget(()=>withDisplayReads(()=>workflow.overview()));const body=JSON.stringify(data);console.log(JSON.stringify({run,ms:Math.round(performance.now()-begin),events:data.events.length,registrations:data.registrations.length,ledger:data.ledger.length,bytes:Buffer.byteLength(body),gzipBytes:gzipSync(body,{level:4}).length}));}
  catch {console.log(JSON.stringify({run,ms:Math.round(performance.now()-begin),failed:true}));break;}
 }
 console.log(JSON.stringify({reads:[...counts.values()],writes:0}));
} catch {console.error('Read-only timing probe failed; sensitive error details suppressed.');process.exitCode=1;}
