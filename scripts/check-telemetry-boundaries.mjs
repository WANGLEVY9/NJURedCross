import { ESLint } from 'eslint';

// Exceptions are existing transport boundaries and legacy callers. New
// call sites use request/requestBlob, traced XHR, or a server dependency adapter.
const ceilings = new Map([
  ['public/app/core/api.js', 6],
  ['public/app/console/pages/outreach.js', 1],
  ['public/app/console/pages/reimbursement-ledger.js', 1],
  ['public/app/games/uno/client.js', 2],
  ['public/app/portal/reimbursement-retained-materials.js', 1],
  ['public/app/shared/reimbursement-details.js', 1],
  ['lib/agent/compatible-model.js', 1],
  ['lib/events/njubox.js', 1],
  ['lib/games/uno-stats-sink.js', 4],
  ['lib/http/seatable-image.js', 2],
  ['lib/observability.js', 1],
]);
const direct = [
  "CallExpression[callee.type='Identifier'][callee.name=/^(fetch|fetchImpl)$/]",
  "CallExpression[callee.type='MemberExpression'][callee.object.name=/^(globalThis|window|self)$/][callee.property.name='fetch']",
  "NewExpression[callee.name=/^(XMLHttpRequest|WebSocket|EventSource)$/]",
];
const eslint = new ESLint({overrideConfig:{
  rules:{'no-restricted-syntax':['error',...direct.map(selector=>({
    selector,message:'Use the shared traced request or dependency boundary.',
  }))]},
}});
const reports = await eslint.lintFiles(['public/app/**/*.js','lib/**/*.js','server.js']);
for(const report of reports){
  const path=report.filePath.slice(process.cwd().length+1).replaceAll('\\','/');
  const calls=report.messages.filter(message=>message.ruleId==='no-restricted-syntax');
  if(calls.length<=(ceilings.get(path)||0))continue;
  for(const {line,message} of calls)console.error(`${path}:${line} ${message}`);
  process.exitCode=1;
}
if(!process.exitCode)console.log('Telemetry transport boundaries verified.');
