import assert from 'node:assert/strict';
import { test } from 'node:test';
import { refreshSession, request, getSessionState, getAccountProfile, updateAccountProfile, peekAccountProfile, logout, login, consoleApi } from '../public/app/core/api.js';

test('upstream outage/permission denial retain session; only CSRF rejection retries; 401 clears session', async t => {
  const original = globalThis.fetch;
  t.after(() => { globalThis.fetch = original; });
  const session = { ok: true, authenticated: true, csrfToken: 'synthetic', user: { username: 'fixture' } };
  let calls = [];
  const response = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
  globalThis.fetch = async path => { calls.push(path); return path === '/api/auth/session' ? response(session) : response({ ok: false, code: 'seatable_auth_failed' }, 503); };
  await refreshSession();
  await assert.rejects(request('/synthetic-outage'));
  assert.equal(getSessionState().user.username, 'fixture');
  calls = [];
  globalThis.fetch = async path => { calls.push(path); return response({ ok: false, code: 'scope_denied' }, 403); };
  await assert.rejects(request('/synthetic-denied', { method: 'POST', body: {} }));
  assert.equal(calls.length, 1); assert.equal(getSessionState().user.username, 'fixture');
  calls = []; let writes = 0;
  globalThis.fetch = async path => {
    calls.push(path);
    if (path === '/api/auth/session') return response(session);
    return ++writes === 1 ? response({ ok: false, code: 'csrf_failed' }, 403) : response({ ok: true });
  };
  assert.equal((await request('/synthetic-csrf', { method: 'POST', body: {} })).ok, true);
  assert.equal(writes, 2); assert.equal(calls.filter(path => path === '/api/auth/session').length, 1);
  globalThis.fetch = async () => response({ ok: false }, 401);
  await assert.rejects(request('/synthetic-expired'));
  assert.equal(getSessionState().authenticated, false);
});

test('profile memory reuse expires, saves replace it, and changed sessions reject late responses', async t => {
  const originalFetch = globalThis.fetch, originalNow = Date.now;
  t.after(() => { globalThis.fetch = originalFetch; Date.now = originalNow; });
  let now = 1000, reads = 0, writes = 0;
  Date.now = () => now;
  let session = { ok:true, authenticated:true, csrfToken:'profile-a', user:{username:'synthetic-a'} };
  const response = body => new Response(JSON.stringify(body), {headers:{'Content-Type':'application/json'}});
  let slow = null;
  globalThis.fetch = async (path, init) => {
    if(path === '/api/auth/session') return response(session);
    if(path === '/api/auth/logout') return response({ok:true});
    if(init.method === 'PATCH') { writes++; return response({ok:true, account:{realName:'Updated synthetic'}}); }
    reads++;
    if(slow) return new Promise(resolve => { slow.resolve = () => resolve(response({ok:true,account:{realName:'Late old account'}})); });
    return response({ok:true,account:{realName:'Synthetic',username:session.user.username}});
  };
  await refreshSession();
  const [first,second] = await Promise.all([getAccountProfile(),getAccountProfile()]);
  assert.equal(reads,1); assert.deepEqual(first,second);
  first.account.realName = 'Changed browser copy';
  assert.equal((await getAccountProfile()).account.realName,'Synthetic');
  assert.equal(reads,1);
  now += 60_001;
  await getAccountProfile(); assert.equal(reads,2);
  await updateAccountProfile({realName:'Updated synthetic'});
  assert.equal((await getAccountProfile()).account.realName,'Updated synthetic');
  assert.equal(writes,1); assert.equal(reads,2);
  now += 60_001; slow = {};
  const obsolete = assert.rejects(getAccountProfile(),error => error.code === 'profile_obsolete');
  session = {...session,csrfToken:'profile-b',user:{username:'synthetic-b'}};
  await refreshSession();
  assert.equal(peekAccountProfile(),null);
  slow.resolve(); await obsolete; slow = null;
  assert.equal((await getAccountProfile()).account.username,'synthetic-b');
  await logout(); assert.equal(peekAccountProfile(),null);
  await assert.rejects(getAccountProfile(),error => error.status === 401);
});

test('catalog cache refreshes and invalidates on permission changes; overviews stay live',async t=>{
 const original=globalThis.fetch;t.after(()=>{globalThis.fetch=original;});
 let reads=0,permissions=['events'];
 globalThis.fetch=async path=>Response.json(path==='/api/auth/session'?{ok:true,authenticated:true,csrfToken:'overview-user',user:{username:'overview-user',consoleAccess:true,permissions}}:{ok:true,version:++reads});
 await refreshSession();
 assert.equal((await request('/api/volunteer/workflow/catalog')).version,1);
 assert.equal((await request('/api/volunteer/workflow/catalog')).version,1);
 assert.equal((await request('/api/volunteer/workflow/catalog',{fresh:true})).version,2);
 permissions=['events','outreach'];await refreshSession();
 assert.equal((await request('/api/volunteer/workflow/catalog')).version,3);
 assert.equal((await consoleApi.outreach.overview()).version,4);
 assert.equal((await consoleApi.outreach.overview({fresh:true})).version,5);
});

test('a late startup session response cannot overwrite a newer login or logout',async t=>{
 const original=globalThis.fetch;t.after(()=>{globalThis.fetch=original;});
 const session={ok:true,authenticated:true,csrfToken:'new-login',user:{username:'new-login'}};
 let finish;
 globalThis.fetch=async path=>path==='/api/auth/session'?new Promise(resolve=>{finish=()=>resolve(Response.json({ok:true,authenticated:false}));}):Response.json(session);
 const startup=refreshSession();
 await login('new-login','synthetic-password');
 finish();await startup;
 assert.equal(getSessionState().user.username,'new-login');
 assert.equal(getSessionState().csrfToken,'new-login');
 globalThis.fetch=async path=>path==='/api/auth/session'?new Promise(resolve=>{finish=()=>resolve(Response.json(session));}):Response.json({ok:true});
 const obsolete=refreshSession();
 await logout();finish();await obsolete;
 assert.equal(getSessionState().authenticated,false);
});

test('a profile read racing a save cannot replace the saved profile', async t => {
  const original = globalThis.fetch;
  t.after(() => { globalThis.fetch = original; });
  const response = body => new Response(JSON.stringify(body), {headers:{'Content-Type':'application/json'}});
  let finishRead;
  globalThis.fetch = async (path, init) => {
    if(path === '/api/auth/session') return response({ok:true,authenticated:true,csrfToken:'race',user:{username:'synthetic-race'}});
    if(init.method === 'PATCH') return response({ok:true,account:{realName:'Saved synthetic'}});
    return new Promise(resolve => { finishRead = () => resolve(response({ok:true,account:{realName:'Old synthetic'}})); });
  };
  await refreshSession();
  const obsolete = assert.rejects(getAccountProfile(),error => error.code === 'profile_obsolete');
  await updateAccountProfile({realName:'Saved synthetic'});
  finishRead(); await obsolete;
  assert.equal((await getAccountProfile()).account.realName,'Saved synthetic');
});
