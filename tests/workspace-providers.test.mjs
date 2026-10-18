import test from 'node:test';
import assert from 'node:assert/strict';
import {compileWorkspaceRoster,createActivityApprovalRouter} from '../lib/events/workspace-providers.js';

const account=(accountId,changes={})=>({accountId,username:accountId,realName:`姓名-${accountId}`,email:`${accountId}@example.test`,emailVerified:true,status:'启用',studentId:`99${String([...accountId].reduce((sum,char)=>sum+char.charCodeAt(0),0)).slice(-6).padStart(6,'0')}`,...changes});
const event=(mode='legacy')=>({_id:mode,'状态':'待审核','活动地区':'南京地区',组织类别:'生命中心',报名页配置:JSON.stringify({center:'生命中心',region:'南京活动',...(mode==='workspace'?{approval:{mode:'workspace-regional'},workspaceSubmission:{}}: {})})});

test('roster file gives only role and region bindings; account identity comes from the current snapshot',()=>{
  const roster=compileWorkspaceRoster({rows:[
    {accountId:'chair',region:'nanjing',role:'presidium',categories:[]},
    {accountId:'director',region:'suzhou',role:'director',categories:['生命中心'],name:'合成主任'},
  ]},[
    account('chair'),
    account('director',{email:'verified@example.test'}),
  ]);
  assert.equal(roster.complete,true);
  const chair=roster.rows.find(row=>row.accountId==='chair');
  const director=roster.rows.find(row=>row.accountId==='director');
  assert.equal(chair.active,true);
  assert.equal(chair.emailVerified,true);
  assert.equal(director.name,'合成主任');
  assert.equal(director.email,'verified@example.test');
});

test('missing, unverified, duplicate or region-invalid roster entries stay closed',()=>{
  for(const rows of [
    [],
    [{accountId:'noped',region:'suzhou',role:'director',categories:['献血车专项']}],
    [{accountId:'a',region:'nanjing',role:'presidium',categories:[]},{accountId:'a',region:'nanjing',role:'director',categories:['生命中心']}],
    [{accountId:'a',region:'nanjing',role:'presidium',categories:[],extra:true}],
  ]){
    assert.throws(()=>compileWorkspaceRoster({rows},[account('a'),account('noped')]),{statusCode:503});
  }
  const missing=compileWorkspaceRoster({rows:[{accountId:'missing',region:'nanjing',role:'presidium',categories:[]}]},[account('a')]);
  assert.equal(missing.rows[0].active,false);
  const unverified=compileWorkspaceRoster({rows:[{accountId:'a',region:'nanjing',role:'presidium',categories:[]}]},[account('a',{emailVerified:false})]);
  assert.equal(unverified.rows[0].active,false);
});

test('legacy and regional approval evidence remain separate',async()=>{
  const calls=[];
  const legacy={
    assign:async()=>{calls.push('legacy-assign');return {mode:'legacy'};},
    assertReviewer:async()=>{calls.push('legacy-review');return {role:'platform_admin'};},
    describe:async rows=>rows.map(row=>({...row,access:'legacy'})),
  };
  const chair=account('chair');
  const router=createActivityApprovalRouter({
    legacy,
    getRoster:async()=>({complete:true,rows:[{accountId:'chair',region:'nanjing',role:'presidium',active:true,categories:[],name:'合成主席'}]}),
  });
  await router.assign(event('legacy'));
  await router.assertReviewer(event('legacy'),'chair');
  assert.deepEqual(calls,['legacy-assign','legacy-review']);
  const workspace=event('workspace');
  workspace['申请版本']='1';
  workspace['报名页配置']=JSON.stringify({center:'生命中心',region:'南京活动',approval:{mode:'workspace-regional',region:'nanjing',category:'生命中心',version:'1',reviewerIds:['chair']},workspaceSubmission:{}});
  const assigned=await router.assign(workspace);
  assert.deepEqual(assigned.reviewerIds,['chair']);
  assert.equal((await router.assertReviewer(workspace,'chair')).reviewerId,'chair');
  const suzhou={...workspace,'活动地区':'苏州地区','报名页配置':JSON.stringify({center:'生命中心',region:'苏州活动',approval:{mode:'workspace-regional',region:'suzhou',category:'生命中心',version:'1',reviewerIds:['chair']},workspaceSubmission:{}})};
  await assert.rejects(router.assertReviewer(suzhou,'chair'),{statusCode:403});
});
