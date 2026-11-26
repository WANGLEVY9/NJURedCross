import test from 'node:test';
import assert from 'node:assert/strict';
import {materialAccess} from '../lib/attachment/material-access.js';
import {mediaRoutes,consoleMediaRoutes} from '../lib/attachment/media.js';
import {outreachSubmissionAttachments} from '../lib/attachment/api.js';

const accounts={uploader:{accountId:'U1',username:'writer',role:'member',emailVerified:true},
 director:{accountId:'U2',username:'director',role:'platform_admin',permissions:['outreach'],emailVerified:true},
 super:{accountId:'U3',username:'super',role:'super_admin',emailVerified:true}};
const roster={complete:true,rows:[{accountId:'U2',region:'nanjing',role:'director',active:true,categories:['博爱中心']}]};
const rows=[['PHO-1','U1','博爱中心','image/png','2026-10-01'],['PHO-2','U4','博爱中心','image/jpeg','2026-11-01'],
 ['PHO-3','U5','生命中心','image/png','2026-11-02']].map(([id,user,center,mime,time])=>({_id:id,
  照片ID:id,上传人:user,中心:center,活动名:'合成活动',文件名:`${id}.png`,MIME类型:mime,上传时间:time,删除申请状态:'待审核'}));

test('material visibility follows account, trusted center, and verified site-wide role',async()=>{
 const route=async(account,tail='',method='GET',console=false)=>{
  const access=materialAccess(account,roster),session={username:account.username};
  const ctx={session,materialAccess:console?access:undefined,resolveMaterialAccess:async()=>access,
   ownsBusinessRef:(_session,ref)=>ref===account.accountId,requirePortalSession:()=>session,requireCsrf:()=>true,
   getBase:async()=>({listRows:async()=>rows}),config:{},tables:{media:'media'},readJson:async()=>({decision:'reject',keep:'留用'}),
   json:(_res,status,body)=>({status,body})};
  return (console?consoleMediaRoutes:mediaRoutes)({method,headers:{}},{},new URL(`http://localhost/api/${console?'console':'public'}/media${tail}`),ctx);
 };
 const mine=await route(accounts.uploader);
 assert.deepEqual(mine.body.scopes,['mine']);assert.deepEqual(mine.body.photos.map(row=>row.id),['PHO-1']);
 assert.equal((await route(accounts.uploader,'?scope=center')).status,403);
 assert.deepEqual((await route(accounts.director,'?scope=center&order=oldest')).body.photos.map(row=>row.id),['PHO-1','PHO-2']);
 assert.deepEqual((await route(accounts.director,'?scope=center&type=image/jpeg')).body.photos.map(row=>row.id),['PHO-2']);
 assert.equal((await route(accounts.director,'?scope=all')).status,403);
 assert.equal((await route(accounts.super,'?scope=all')).body.photos.length,3);
 assert.equal((await route(accounts.director,'/PHO-3/link?scope=center')).status,403);
 assert.equal((await route(accounts.director,'/PHO-1?scope=center','PATCH')).status,403);
 assert.deepEqual((await route(accounts.director,'/deletes','GET',true)).body.queue.map(row=>row.id),['PHO-2','PHO-1']);
 assert.equal((await route(accounts.director,'/PHO-3/delete-review','POST',true)).status,403);
});

test('chair or owner claims, unverified membership and missing outreach cannot broaden material scope',()=>{
 const actor=accounts.director;
 const center=overrides=>({complete:true,rows:[{...roster.rows[0],...overrides}]});
 assert.deepEqual(materialAccess(actor,center({role:'presidium'})).scopes,['mine']);
 assert.deepEqual(materialAccess({...actor,permissions:['events']},roster).scopes,['mine']);
 assert.deepEqual(materialAccess({...actor,emailVerified:false},roster).scopes,['mine']);
 assert.deepEqual(materialAccess(actor,{...roster,complete:false}).scopes,['mine']);
});

test('submission attachments only expose allowed records in the same submission',async()=>{
 const attachments=rows.map(row=>({...row,附件ID:row.照片ID,投稿ID:'SUB-test',上传状态:'已上传'}));
 const ctx={getBase:async()=>({listRows:async()=>attachments}),tables:{attachment:'attachments'},config:{},
  materialAccess:materialAccess(accounts.director,roster),json:(_res,status,body)=>({status,body})};
 const response=await outreachSubmissionAttachments({}, {},ctx,'SUB-test');
 assert.deepEqual(response.body.attachments.map(row=>row.id),['PHO-1','PHO-2']);
});
