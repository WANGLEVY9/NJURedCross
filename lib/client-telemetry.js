import { collectRequestBody } from './http/request-body.js';
import { withHttpRequestBudget } from './http/request-budget.js';
import { observer } from './observability.js';

export async function clientTelemetry(req,res,{json,limit,report=observer.client}) {
 if(req.method!=='POST')return json(res,405,{ok:false});
 const origin=req.headers.origin;
 if(req.headers['sec-fetch-site']==='cross-site'||(origin&&origin!==`https://${req.headers.host}`&&origin!==`http://${req.headers.host}`))return json(res,403,{ok:false});
 limit(req);
 return withHttpRequestBudget(req,res,async()=>{
  const bytes=await collectRequestBody(req,2048);let body;
  try{body=JSON.parse(bytes.toString('utf8'));}catch{return json(res,400,{ok:false});}
  if(!report(body))return json(res,400,{ok:false});
  res.writeHead(204,{'Cache-Control':'no-store'});res.end();
 },{timeoutMs:3000});
}
