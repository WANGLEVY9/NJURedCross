/** Anonymous projections only, memory scoped to this browser tab. */
export function createPublicReadCache({ now = Date.now, ttlMs = 15_000, maxAgeMs = 45_000 } = {}) {
  const values=new Map(),pending=new Map();let generation=0;
  const clone=value=>structuredClone(value);
  return {
    peek(key){const entry=values.get(key);return entry&&now()-entry.at<maxAgeMs?clone(entry.value):null;},
    async get(key,load,{fresh=false}={}){
      const entry=values.get(key);
      if(!fresh&&entry&&now()-entry.at<ttlMs)return clone(entry.value);
      if(pending.has(key))return clone(await pending.get(key));
      const version=generation;
      const task=Promise.resolve().then(load).then(value=>{if(version===generation)values.set(key,{value:clone(value),at:now()});return value;}).finally(()=>{if(pending.get(key)===task)pending.delete(key);});
      pending.set(key,task);return clone(await task);
    },
    clear(){generation++;values.clear();pending.clear();},
  };
}
