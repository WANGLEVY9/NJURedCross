import test from 'node:test';
import assert from 'node:assert/strict';
import {bindActivityWorkspaceScroll} from '../public/app/console/activity-workspace-scroll.js';

function fixture({scrollTop=0,scrollHeight=2000,clientHeight=500}={}){
 const listeners=new Map();
 const form={
  isConnected:true,scrollTop,scrollHeight,clientHeight,
  addEventListener:(type,handler)=>listeners.set(type,handler),
  removeEventListener:type=>listeners.delete(type),
 };
 const frame=globalThis.requestAnimationFrame;
 const cancel=globalThis.cancelAnimationFrame;
 const computed=globalThis.getComputedStyle;
 const host=globalThis.window;
 globalThis.window=undefined;
 globalThis.getComputedStyle=()=>({overflowY:'auto'});
 globalThis.requestAnimationFrame=callback=>{callback();return 1;};
 globalThis.cancelAnimationFrame=()=>{};
 const wheel=event=>{
  const current=listeners.get('wheel');
  const clean={...event};
  current({deltaY:0,...clean,preventDefault(){clean.defaultPrevented=true;}});
  Object.assign(event,clean);
 };
 return {form,wheel,restore:()=>{
  if(frame===undefined)delete globalThis.requestAnimationFrame;else globalThis.requestAnimationFrame=frame;
  if(cancel===undefined)delete globalThis.cancelAnimationFrame;else globalThis.cancelAnimationFrame=cancel;
  if(computed===undefined)delete globalThis.getComputedStyle;else globalThis.getComputedStyle=computed;
  if(host===undefined)delete globalThis.window;else globalThis.window=host;
 }};
}

test('wheel deltas accumulate inside the form and stop at its bottom',()=>{
 const {form,wheel,restore}=fixture();
 const release=bindActivityWorkspaceScroll(form);
 wheel({deltaY:400});assert.equal(form.scrollTop,400);
 wheel({deltaY:400});assert.equal(form.scrollTop,800);
 for(let index=0;index<5;index++)wheel({deltaY:400});
 assert.equal(form.scrollTop,1500);
 wheel({deltaY:-200});assert.equal(form.scrollTop,1300);
 release();restore();assert.equal(form.scrollTop,1300);
});

test('wheel at either edge chains to the surrounding console scroller',()=>{
 const {form,wheel,restore}=fixture({scrollTop:1500});
 const release=bindActivityWorkspaceScroll(form);
 const event={deltaY:400,preventDefault(){this.defaultPrevented=true;}};
 wheel(event);assert.equal(event.defaultPrevented,undefined);
 form.scrollTop=0;
 const upward={deltaY:-400,preventDefault(){this.defaultPrevented=true;}};
 wheel(upward);assert.equal(upward.defaultPrevented,undefined);
 release();restore();
});

test('disabled outside the activity workspace leaves wheel events unchanged',()=>{
 const {form,wheel,restore}=fixture();
 const release=bindActivityWorkspaceScroll(form,{enabled:()=>false});
 const event={deltaY:400,preventDefault(){this.defaultPrevented=true;}};
 wheel(event);assert.equal(form.scrollTop,0);assert.equal(event.defaultPrevented,undefined);
 release();restore();
});
