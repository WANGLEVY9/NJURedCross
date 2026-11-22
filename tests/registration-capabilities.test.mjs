import test from 'node:test';
import assert from 'node:assert/strict';
import {registrationCapabilities,registrationExperience,REGISTRATION_ENTRY_FLAGS} from '../public/app/shared/registration-capabilities.js';
test('workspace and historical roster entries share the same action matrix',()=>{
 const legacy={报名页配置:'{}'},workspace={报名页配置:JSON.stringify({workspaceSubmission:{origin:true}})};
 assert.equal(registrationExperience(legacy),'legacy');assert.equal(registrationExperience(workspace),'workspace');
 assert.equal(registrationCapabilities(legacy),registrationCapabilities(workspace));
 assert.deepEqual(Object.keys(registrationCapabilities(legacy)),['batchAdmission','batchLeave','rangeSelection','exportRegistration']);
 assert.equal(REGISTRATION_ENTRY_FLAGS.unifiedWorkspace,true);
});
