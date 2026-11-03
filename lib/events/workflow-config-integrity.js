// NJUTable 文本列按 UTF-8 字节在 10000 处静默截断（不是字符数）：中文配置
// 按字符校验会放过近三倍的体积，写进去后整行不可解析。这里统一按字节守。
export const WORKFLOW_CONFIG_LIMIT=10_000;
const configBytes=value=>Buffer.byteLength(value,'utf8');
const invalid=()=>Object.assign(new Error('活动配置不完整，请管理员从完整备份恢复后再操作；已有报名记录未删除'),{statusCode:409,code:'workflow_configuration_invalid'});

export function readWorkflowConfig(row){
 const raw=row?.['报名页配置'];
 if(raw==null||raw==='')return {};
 try{
  const config=JSON.parse(raw);
  if(!config||typeof config!=='object'||Array.isArray(config))throw invalid();
  return config;
 }catch{throw invalid();}
}
export function workflowConfigurationInvalid(row){
 try{readWorkflowConfig(row);return false;}catch{return true;}
}
export function assertWorkflowConfigWrite(row){
 readWorkflowConfig(row);
 if(typeof row['报名页配置']==='string'&&configBytes(row['报名页配置'])>WORKFLOW_CONFIG_LIMIT)
  throw Object.assign(new Error('活动配置超过安全存储长度，已停止保存；请精简内容或由管理员处理'),{statusCode:409,code:'workflow_configuration_too_large'});
}
