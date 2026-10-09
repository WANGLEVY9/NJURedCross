import { randomUUID } from 'node:crypto';

export const QUOTE_TABLE = '红会语录墙';
export const QUOTE_COLUMNS = ['语录ID','内容','署名','来源','状态','创建人','创建时间','更新人','更新时间'];
const states = ['草稿','已发布','已下架'];
const fail = (statusCode,message) => Object.assign(new Error(message),{statusCode});
export function quotePayload(body) {
  const result={};
  for(const [key,column,max,required] of [['content','内容',1000,true],['author','署名',80,true],['source','来源',200,false]]) {
    const value=String(body[key]??'').trim();
    if((required&&!value)||value.length>max)throw fail(400,`${column}${!value?'不能为空':`不能超过 ${max} 字`}`);
    result[column]=value;
  }
  if(!states.includes(body.status||'草稿'))throw fail(400,'无效语录状态');
  result['状态']=body.status||'草稿';
  return result;
}
export async function quoteSchemaReady(base) {
  const table=(await base.getMetadata()).tables?.find(t=>t.name===QUOTE_TABLE);
  return Boolean(table && QUOTE_COLUMNS.every(n=>table.columns?.some(c=>c.name===n&&c.type==='text')));
}
export async function quoteRows(base) {
  const all=[];
  for(let start=0;;start+=500){const page=await base.listRows(QUOTE_TABLE,'','',false,start,500);all.push(...page);if(page.length<500)break;}
  return all.map(r=>({id:r._id,content:r['内容']||'',author:r['署名']||'',source:r['来源']||'',status:r['状态']||'草稿',updatedAt:r['更新时间']||r['创建时间']||''})).sort((a,b)=>b.updatedAt.localeCompare(a.updatedAt));
}
/** Authentication, scope, CSRF and audit are provided by the console API boundary. */
export async function quoteRoutes(req,res,url,{base,session,json,readJson,audit}) {
  const root='/api/community/quotes';
  if(url.pathname!==root&&!url.pathname.startsWith(root+'/'))return false;
  const ready=await quoteSchemaReady(base);
  if(req.method==='GET'&&url.pathname===root)return json(res,200,{ok:true,ready,items:ready?await quoteRows(base):[]});
  if(!ready)throw fail(503,'红会语录墙数据表尚未配置，请联系平台维护人。');
  const now=new Date().toISOString();
  if(req.method==='POST'&&url.pathname===root){
    const row={...quotePayload(await readJson(req)),语录ID:`QUOTE-${randomUUID()}`,创建人:session.username,创建时间:now,更新人:session.username,更新时间:now};
    const result=await base.appendRow(QUOTE_TABLE,row);
    await audit(req,session,'quotes.create',result._id,'success',{});
    return json(res,201,{ok:true});
  }
  const match=url.pathname.match(/^\/api\/community\/quotes\/([^/]+)$/);
  if(match&&req.method==='PATCH') {
    const id=decodeURIComponent(match[1]);
    if(!(await quoteRows(base)).some(r=>r.id===id))throw fail(404,'语录不存在');
    const row={...quotePayload(await readJson(req)),更新人:session.username,更新时间:now};
    await base.updateRow(QUOTE_TABLE,id,row);
    await audit(req,session,'quotes.update',id,'success',{status:row['状态']});
    return json(res,200,{ok:true});
  }
  throw fail(405,'不支持此语录操作');
}
