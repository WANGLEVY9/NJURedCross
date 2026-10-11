/** Explicitly bind workflow writes to one verified environment. */
export const PRODUCTION_VOLUNTEER_BASE = 'cc304b1d-a726-4f92-a9be-a6ffcaa54038';
export const TEST_WORKFLOW_BASE = '6be54741-fbd0-4e16-9c66-cda281a5d899';
export function workflowMode(env) {
 const mode=env.PLATFORM_WORKFLOW_MODE || (env.PLATFORM_TEST_WORKFLOW==='true'?'test':'disabled');
 const expected=mode==='production'?PRODUCTION_VOLUNTEER_BASE:mode==='test'?TEST_WORKFLOW_BASE:null;
 if(!expected||env.SEATABLE_VOLUNTEER_BASE_UUID!==expected)throw Object.assign(new Error('活动数据源配置不匹配'),{statusCode:503,code:'workflow_disabled'});
 return {mode,expected,bloodSourceTable:env.SEATABLE_BLOOD_SOURCE_TABLE?.trim()||(mode==='production'?'市献血车汇总':'市血液献血车排班表（汇总底表）')};
}
