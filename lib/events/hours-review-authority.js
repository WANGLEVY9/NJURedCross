/** Hours review has a different lifecycle from approval of a pending activity. */
export async function assertHoursReviewAuthority(routing,event,actor){
 const authorize=routing.assertHoursReviewer??routing.assertReviewer;
 if(typeof authorize!=='function')throw Object.assign(new Error('时长审核权限尚未就绪'),{statusCode:503});
 return authorize.call(routing,event,actor);
}
