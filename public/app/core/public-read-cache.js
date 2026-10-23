/** Tab-memory read cache. Private callers must invalidate on session changes and writes. */
export function createPublicReadCache({ now = Date.now, ttlMs = 15_000, maxAgeMs = 45_000 } = {}) {
  const values=new Map(),pending=new Map();let generation=0;
  const clone=value=>structuredClone(value);
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
  };
}
