import {getSessionState,request} from '../../core/api.js';

const root='/api/volunteer/workflow/workspace-drafts';

async function workspaceReady(){
  try{
    const response=await request(`${root}/capabilities`,{fresh:true});
    return response.capabilities?.enabled===true
      && response.capabilities?.rosterAvailable===true
      && response.capabilities?.canSubmit===true;
  }catch{
    return false;
  }
}

/** Keep the legacy workbench available until the regional roster and durable
 * submission provider are both configured. The explicit preview flag is for
 * synthetic or operator QA only. */
export default async function activityManagementEntry(context,shell){
  const forcePreview=context.query.get('workspace')==='v2';
  const forceLegacy=context.query.get('legacy')==='1';
  const workspaceEnabled=getSessionState().user?.activityWorkspaceV2===true;
  if(!forcePreview&&(forceLegacy||!workspaceEnabled)){
    return (await import('./activity-center.js')).default(context,shell);
  }
  if(!forcePreview&&!await workspaceReady()){
    return (await import('./activity-center.js')).default(context,shell);
  }
  return (await import('./activity-workspace-page.js')).default(context,shell);
}
