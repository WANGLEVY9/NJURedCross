import {displayRead} from '../http/display-reads.js';
import {rowsByValues} from '../http/rows-by-values.js';

// Identifiers are fixed by the caller; values are quoted, never interpolated raw.
export async function scopedRows(base,table,ids,columns='*') {
  const unique=[...new Set(ids)];
  if(!unique.length)return [];
  return displayRead(base,JSON.stringify(['scopedRows',table,unique,columns]),async()=>{
    return rowsByValues(base,table,'活动ID',unique,columns);
  },5_000,[table]);
}
