import { createInterface } from 'node:readline';
import { telemetryRoute } from '../public/app/shared/telemetry-route.js';

const id = process.argv[2]?.toLowerCase();
const uuid = value => typeof value === 'string' && /^[a-f\d]{8}(?:-[a-f\d]{4}){3}-[a-f\d]{12}$/i.test(value);
if (!uuid(id)) {
  console.error('Usage: journalctl ... -o cat | node scripts/read-telemetry-trace.mjs <UUID>');
  process.exit(2);
}
const rows = [];
const related = new Set([id]);
const labels = /^[a-z][a-z-]{0,40}$/;
for await (const line of createInterface({input:process.stdin,crlfDelay:Infinity})) {
  if (rows.length>=20000) break;
  try {
    const record=JSON.parse(line);
    if(record.schema!==1||!['http','dependency','browser'].includes(record.type))continue;
    if(uuid(record.clientTrace)&&record.clientTrace.toLowerCase()===id&&uuid(record.requestId))related.add(record.requestId.toLowerCase());
    const result={type:record.type,route:telemetryRoute(record.route)};
    for(const key of ['traceId','requestId','clientTrace','spanId','parentSpanId'])if(uuid(record[key]))result[key]=record[key];
    for(const key of ['method','service','operation','phase','outcome'])if(typeof record[key]==='string'&&labels.test(record[key].toLowerCase()))result[key]=record[key];
    for(const key of ['status','durationMs','dependencies','headersMs','transferMs','connectMs','dnsMs'])if(Number.isFinite(record[key]))result[key]=record[key];
    for(const key of ['ok','aborted'])if(typeof record[key]==='boolean')result[key]=record[key];
    if(typeof record.time==='string'&&/^\d{4}-\d\d-\d\dT[\d:.]+Z$/.test(record.time))result.time=record.time;
    rows.push(result);
  }catch{/* Ignore logs outside the telemetry schema. */}
}
console.log(JSON.stringify(rows.filter(row=>[row.traceId,row.requestId,row.clientTrace].some(value=>value&&related.has(value.toLowerCase()))).sort((a,b)=>(a.time||'').localeCompare(b.time||'')),null,2));
