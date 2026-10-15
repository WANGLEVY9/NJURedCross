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
