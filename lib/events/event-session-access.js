/** Navigation projection only. Every activity API independently checks fresh authority. */
export function projectEventSessionAccess(payload,access,{unavailable=false}={}){
 const user=payload.user;
 if(unavailable)user.eventAuthorityUnavailable=true;
 // Module visibility must not depend on a successful read of all activity/role tables.
 // Keep existing module grants; scoped authority can additionally open the section.
 if(access?.canEnter){
  user.permissions=[...new Set([...(user.permissions||[]),'events'])];
  user.consoleAccess=true;
  user.surfaces=[...new Set([...(user.surfaces||[]),'console'])];
 }
 return payload;
}
