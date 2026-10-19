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

/** The rebuilt workspace is opt-in and requires a complete provider/roster.
 * Existing activity records stay on the legacy workbench when it is unavailable. */
export default async function activityManagementEntry(context,shell){
 const forceLegacy=context.query.get('legacy')==='1';
 const workspaceEnabled=getSessionState().user?.activityWorkspaceV2===true;
 if(forceLegacy||!workspaceEnabled){
  return (await import('./activity-center.js')).default(context,shell);
 }
 if(!await workspaceReady()){
  return (await import('./activity-center.js')).default(context,shell);
 }
 return (await import('./activity-workspace-page.js')).default(context,shell);
}
