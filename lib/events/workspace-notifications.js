import {workflowConfig} from './blood-roster.js';
import {workspaceDraftAccess} from './workspace-draft-access.js';
import {createWorkspaceApprovalRouting} from './workspace-approval-routing.js';

/** Actor-scoped projection; never treats an unsubmitted draft as an approval task. */
export async function workspaceNotificationItems({drafts,events,actor,roster}){
 if(!actor)return [];
 if(roster?.complete!==true)throw Object.assign(Error('活动待办的可信地区名单尚未就绪'),{statusCode:503});
 const items=[];
 for(const row of drafts){if(row.removal||row.submission||row.stage!=='草稿'||!workspaceDraftAccess(row,actor,roster).canEdit)continue;
  items.push({type:'活动草稿待完善',priority:'medium',title:row.content.name,detail:'草稿尚未提交，可继续完善活动与岗位安排',view:'activities',target:{kind:'draft',id:row.id}});
 }
 const routing=createWorkspaceApprovalRouting({getRoster:async()=>roster});
 const roots=events.filter(event=>{const c=workflowConfig(event);return c.workspaceSubmission&&!c.parentActivityId&&!c.workspaceRemoval&&['草稿','待审核','可发布'].includes(event['状态']);});
 for(const event of await routing.describe(roots,actor)){
  const c=workflowConfig(event),access=event.approvalAccess,status=event['状态'];
  const task=status==='待审核'&&access.canReview?['活动待审批','等待本地区主席团审批']:status==='可发布'&&access.canPublish&&!c.publishAt?['活动待发布','审批已通过，等待选择立即或定时发布']:status==='草稿'&&access.canManageRegistration?['活动退回待修改','活动已退回，请修改并重新预览提交']:null;
  if(task)items.push({type:task[0],priority:'medium',title:event['活动名称'],detail:task[1],view:'activities',target:{kind:'event',id:event._id}});
 }
 return items;
}
