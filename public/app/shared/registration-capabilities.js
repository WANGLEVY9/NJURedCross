/** Presentation capabilities only. Every mutation retains server authorization. */
export const REGISTRATION_ENTRY_FLAGS=Object.freeze({unifiedWorkspace:true});
const actions=Object.freeze({batchAdmission:true,batchLeave:true,rangeSelection:true,exportRegistration:true});
export const REGISTRATION_CAPABILITIES=Object.freeze({workspace:actions,legacy:actions});
export function registrationExperience(event){
 try{return JSON.parse(event['报名页配置']||'{}').workspaceSubmission?'workspace':'legacy';}
 catch{return 'legacy';}
}
export const registrationCapabilities=event=>REGISTRATION_CAPABILITIES[registrationExperience(event)];
