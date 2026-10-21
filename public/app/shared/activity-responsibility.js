/** Reads persisted event ownership; callers must still validate current role evidence. */
export function eventResponsibleIds(event){
 let config;try{config=JSON.parse(event['报名页配置']||'{}');}catch{config={};}
 return [...new Set([event['负责人账号ID'],...(Array.isArray(config.coOwners)?config.coOwners:[])].filter(id=>typeof id==='string'&&/^[A-Za-z0-9_-]{1,100}$/.test(id)))];
}
