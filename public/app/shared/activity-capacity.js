/** Optional extra applications. Missing fields preserve existing activity contracts. */
export function flexibleCapacity(value){
  if(value===undefined||value==='')return 0;
  if(!['string','number'].includes(typeof value)||!/^(?:0|[5-9]|10)$/.test(String(value)))throw Object.assign(new Error('弹性名额须为0（关闭）或5至10人的整数'),{statusCode:400,code:'activity_capacity_invalid'});
  return Number(value);
}

/** Display demand stays in 容量. Only explicit, approved flexibility widens new workspace bookings. */
export function activityRegistrationLimit(event,config){
  if(!config){try{config=JSON.parse(event?.['报名页配置']||'{}');}catch{config={};}}
  const capacity=Number(event?.['容量']),extra=flexibleCapacity(config.flexibleCapacity);
  if(extra)return capacity+extra;
  const positions=config.positionPlan?.positions||config.positionDraft?.positions;
  if(config.bookingMode==='grouped'&&positions?.some(p=>flexibleCapacity(p.flexibleCapacity)>0))return positions.reduce((sum,p)=>sum+Number(p.capacity)+flexibleCapacity(p.flexibleCapacity),0);
  if(config.bookingMode==='grouped')return Number(config.registrationLimit??capacity);
  return Number(config.approval?.mode==='workspace-regional'?capacity:config.registrationLimit??capacity);
}
