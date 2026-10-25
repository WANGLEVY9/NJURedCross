import {runningPositions} from './activity-running.js';

/** Count leave work from the already scoped project detail, without additional reads. */
export function positionLeaveSummary(data){
  const positions=runningPositions(data),owners=new Map();
  const result=new Map(positions.map(position=>[position['活动ID'],{rows:[],pending:0}]));
  for(const position of positions){
    let config={};try{config=JSON.parse(position['报名页配置']||'{}');}catch{/* Match only the known activity ID. */}
    const sources=Array.isArray(config.sourceActivityIds)?config.sourceActivityIds:[];
    for(const id of [position['活动ID'],...sources].filter(Boolean)){
      if(!owners.has(id))owners.set(id,new Set());
      owners.get(id).add(position);
    }
  }
  for(const row of data.registrations){
    if(!row['请假状态'])continue;
    const matches=owners.get(row['活动ID']);if(matches?.size!==1)continue;
    const position=[...matches][0],summary=result.get(position['活动ID']);
    summary.rows.push(row);
    if(row['请假状态']==='待审批'&&['待筛选','已确认'].includes(row['报名状态']))summary.pending++;
  }
  return result;
}
