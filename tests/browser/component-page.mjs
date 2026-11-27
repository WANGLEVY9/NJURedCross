/** Real same-origin styles and modules, without application routing or login UI.
 * The preview session is shared by the worker, so /login may otherwise redirect
 * while a component fixture is being mounted, especially on slower CI devices.
 * Only callers of this helper suppress bootstrap; end-to-end tests stay intact.
 */
export async function openComponentPage(page){
 await page.route('**/app/main.js*',route=>route.fulfill({contentType:'text/javascript',body:'// Component fixture: application bootstrap intentionally disabled.'}));
 await page.goto('/login');
 await page.evaluate(async()=>{
  await window.njurcBoot?.stylesReady('portal');
  const main=document.createElement('main');main.id='main';
  document.getElementById('root').replaceChildren(main);
  window.njurcBoot?.complete();
 });
}
