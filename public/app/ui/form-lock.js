/** Lock form controls without disabling scrolling, text selection or disclosure panels.
 * Keep each control's previous disabled state so permission and phase restrictions
 * survive a failed request. Overlay background isolation still uses inert.
 */
const locks=new WeakMap();
const selector='button,input,select,textarea,fieldset';
export function setFormControlsLocked(root,locked){
 if(locked){
  if(locks.has(root))return;
  const previous=new Map();
  const capture=()=>{
   const controls=[...(root.matches(selector)?[root]:[]),...root.querySelectorAll(selector)];
   for(const control of controls)if(!previous.has(control)){previous.set(control,control.disabled);control.disabled=true;}
  };
  capture();const observer=new MutationObserver(capture);observer.observe(root,{childList:true,subtree:true});locks.set(root,{previous,observer});
 }else{
  const state=locks.get(root);if(!state)return;
  state.observer.disconnect();for(const [control,disabled]of state.previous)control.disabled=disabled;locks.delete(root);
 }
}
