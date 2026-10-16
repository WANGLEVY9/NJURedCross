import {test} from 'node:test';
import assert from 'node:assert/strict';
import {workflowEventPath,workflowGroupFor} from '../public/app/portal/workflow-links.js';
test('blood return paths keep calendar context and encode IDs',()=>{
  const query = new URL(workflowEventPath({id:'slot & 1',blood:true},'2026-10-12'),'https://example.invalid').searchParams;
  assert.equal(query.get('slot'),'slot & 1'); assert.equal(query.get('week'),'2026-10-12'); assert.equal(query.get('type'),'blood'); assert.equal(query.has('event'),false);
});
test('ordinary event paths keep their detail route',()=>assert.equal(workflowEventPath({id:'event/1'}),'/workflow-events?event=event%2F1'));
test('published child sessions resolve parent links without matching absent parents',()=>{
 const events=[{id:'child',parentEventId:'parent',ordinary:{groupId:'group'}},{id:'legacy',parentEventId:null,ordinary:{groupId:'legacy-group'}}];
 assert.equal(workflowGroupFor(events,'parent','parent'),'group');
 assert.equal(workflowGroupFor(events,'child','child'),'group');
 assert.equal(workflowGroupFor(events,null,null),undefined);
 assert.equal(workflowGroupFor(events,'unpublished','unpublished'),undefined);
});
