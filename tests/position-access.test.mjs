import {test} from 'node:test';
import assert from 'node:assert/strict';
import {canViewPositionRoster} from '../public/app/shared/position-access.js';
test('roster entry is limited to authenticated events administrators',()=>{
 const session=(role,permissions=['events'],consoleAccess=true)=>({authenticated:true,user:{role,permissions,consoleAccess}});
 assert.equal(canViewPositionRoster(session('super_admin')),true);
 assert.equal(canViewPositionRoster(session('platform_admin')),true);
 for(const s of [undefined,{authenticated:false,user:{role:'super_admin',consoleAccess:true}},session('member'),session('platform_admin',[]),session('platform_admin',undefined,false)])assert.equal(canViewPositionRoster(s),false);
});
