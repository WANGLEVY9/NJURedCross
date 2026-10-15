import {test,expect} from '@playwright/test';

test('person selection supports search, keyboard addition, removal and compact layout', async ({page}) => {
  await page.goto('/login');
  await page.evaluate(async () => {
    const {peoplePicker}=await import('/app/ui/people-picker.js');
    const target=document.createElement('section');target.className='console';target.id='people-test';
    const picker=peoplePicker({label:'负责人',people:[
      {id:'synthetic-one',name:'合成甲',studentId:'999990001'},
      {id:'synthetic-two',name:'合成乙',studentId:'999990002'},
    ],onChange:ids=>{target.dataset.selected=JSON.stringify(ids);}});
    target.append(picker.node);document.body.replaceChildren(target);
  });
  const root=page.locator('#people-test');
  await root.locator('summary').click();
  const search=root.getByRole('searchbox',{name:'搜索负责人'});
  await search.fill('999990002');
  await search.press('Enter');
  await expect(root).toHaveAttribute('data-selected','["synthetic-two"]');
  await expect(root.locator('.people-picker__token')).toContainText('合成乙');
  await expect(root.locator('.people-picker__id').first()).toHaveText('999990002');
  await search.press('Escape');
  await expect(root.locator('details')).not.toHaveAttribute('open','');
  await root.getByRole('button',{name:'移除合成乙'}).click();
  await expect(root).toHaveAttribute('data-selected','[]');
  expect(await root.evaluate(node=>node.scrollWidth<=window.innerWidth)).toBe(true);
});

test('fixed owner stays first, survives directory refresh and cannot be removed',async({page})=>{
 await page.goto('/login');
 await page.evaluate(async()=>{
  const {peoplePicker}=await import('/app/ui/people-picker.js');
  const root=document.createElement('section');root.id='fixed-people-test';root.className='console';
  const people=[{id:'creator',name:'合成创建者',studentId:'999990001'},{id:'other',name:'合成协作人',studentId:'999990002'}];
  const picker=peoplePicker({label:'负责人',people,selected:['other','creator'],locked:['creator'],onChange:ids=>root.dataset.selected=JSON.stringify(ids)});
  picker.setSelected(['other']);picker.setPeople(people);root.append(picker.node);document.body.replaceChildren(root);
 });
 const root=page.locator('#fixed-people-test');
 await expect(root.locator('.people-picker__token').first()).toHaveText('合成创建者999990001');
 await expect(root.getByRole('button',{name:'移除合成创建者'})).toHaveCount(0);
 await root.getByRole('button',{name:'移除合成协作人'}).click();
 await expect(root).toHaveAttribute('data-selected','["creator"]');
 await expect(root.locator('.people-picker__token')).toHaveCount(1);
});
