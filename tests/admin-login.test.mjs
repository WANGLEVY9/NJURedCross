import test from 'node:test';
import assert from 'node:assert/strict';
import { administratorLoginIdentifier } from '../public/app/portal/campus-login.js';

test('administrator student IDs use the selected campus suffix without changing legacy identities',()=>{
 assert.equal(administratorLoginIdentifier(' 231250082 '),'231250082@smail.nju.edu.cn');
 assert.equal(administratorLoginIdentifier('231250082','nju.edu.cn'),'231250082@nju.edu.cn');
 for(const value of ['231250082@smail.nju.edu.cn','231250082@nju.edu.cn','legacy-admin','合成管理员','admin@example.test'])assert.equal(administratorLoginIdentifier(value,'nju.edu.cn'),value);
 assert.equal(administratorLoginIdentifier('  '),'');
 assert.throws(()=>administratorLoginIdentifier('231250082','evil.example'));
});
