/** Tab-memory read cache. Private callers must invalidate on session changes and writes. */
export function createPublicReadCache({ now = Date.now, ttlMs = 15_000, maxAgeMs = 45_000 } = {}) {
  const values=new Map(),pending=new Map();let generation=0;
  const clone=value=>structuredClone(value);
  const tagged = key => {
    const path = String(key).split('?')[0];
    if (path === '/api/public/events' || path === '/api/public/overview' || path === '/api/public/workflow/events') return ['events'];
    if (path === '/api/public/warmth/capabilities') return ['community'];
    if (path === '/api/materials/overview' || path.startsWith('/api/public/materials/')) return ['materials'];
    if (path === '/api/events/overview' || path === '/api/volunteer/overview' || path.startsWith('/api/volunteer/workflow/')) return ['events'];
    if (path === '/api/outreach/overview' || path.startsWith('/api/outreach/') || path.startsWith('/api/public/showcase')) return ['outreach'];
    if (path === '/api/community/overview' || path.startsWith('/api/community/') || path.startsWith('/api/morning/')) return ['community'];
    if (path === '/api/notifications/overview') return ['events','materials','outreach','community'];
    return [];
  };
  const matches = (key, tags) => {
    if (!tags.length) return true;
    const entryTags = tagged(key);
    return !entryTags.length || entryTags.some(tag => tags.includes(tag));
  };
  return {
    peek(key){const entry=values.get(key);return entry&&now()-entry.at<maxAgeMs?clone(entry.value):null;},
    async get(key,load,{fresh=false}={}){
      const entry=values.get(key);
      if(!fresh&&entry){
        const age=now()-entry.at;
        if(age<ttlMs)return clone(entry.value);
        // 旧值兜底：先回到上一次的数据并在后台重取，页面切换不再等整表回源。
        // 写入仍会整体失效，因此写后读取永远回源。
        if(age<maxAgeMs){void this.refresh(key,load);return clone(entry.value);}
      }
      if(pending.has(key))return clone(await pending.get(key));
      const version=generation;
      const task=Promise.resolve().then(load).then(value=>{if(version===generation)values.set(key,{value:clone(value),at:now()});return value;}).finally(()=>{if(pending.get(key)===task)pending.delete(key);});
      pending.set(key,task);return clone(await task);
    },
    /** 后台重取：与 get 共享单飞，失败不抛给当前调用方。 */
    refresh(key,load){
      if(pending.has(key))return pending.get(key);
      const version=generation;
      const task=Promise.resolve().then(load).then(value=>{if(version===generation)values.set(key,{value:clone(value),at:now()});return value;}).finally(()=>{if(pending.get(key)===task)pending.delete(key);});
      pending.set(key,task);return task.catch(()=>undefined);
    },
    clear(){generation++;values.clear();pending.clear();},
    invalidate(tags = []){
      if (!tags.length) return this.clear();
      generation++;
      for (const key of values.keys()) if (matches(key, tags)) values.delete(key);
      for (const key of pending.keys()) if (matches(key, tags)) pending.delete(key);
    },
  };
}
