import test from 'node:test';
import assert from 'node:assert/strict';
import {ordinaryRegistrationOpen} from '../lib/events/ordinary-groups.js';
const time=Date.parse('2030-11-01T10:00:00+08:00');
const event={报名页配置:JSON.stringify({publishAt:'2030-11-01T10:00:00+08:00',ordinary:{start:'2030-11-02T10:00:00+08:00'}}),registrationControl:{enabled:true,deadline:'2030-11-01T18:00:00+08:00'}};
test('ordinary session gates registration before scheduled opening even when parent switch is open',()=>{assert.equal(ordinaryRegistrationOpen(event,time-1),false);assert.equal(ordinaryRegistrationOpen(event,time),true);});
test('invalid publication time cannot open a session',()=>assert.equal(ordinaryRegistrationOpen({...event,报名页配置:JSON.stringify({publishAt:'invalid',ordinary:{start:'2030-11-02T10:00:00+08:00'}})},time),false));
test('closed registration switch remains closed after opening time',()=>assert.equal(ordinaryRegistrationOpen({...event,registrationControl:{...event.registrationControl,enabled:false}},time),false));
