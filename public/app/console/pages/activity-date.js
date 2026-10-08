import {h} from '../../core/dom.js';

// Keep the native calendar and date value, but give both activity forms the same
// Chinese display instead of the browser's mixed-language date segments.
export function localizeActivityDate(node) {
  const display=h('span',{class:'activity-date-display','aria-hidden':'true'});
  const wrapper=h('div',{class:'activity-date-picker'},display);
  node.control.before(wrapper);wrapper.prepend(node.control);
  node.refreshDate=()=>{
    const value=node.control.value;
    display.textContent=value?value.replace(/^(\d{4})-(\d{2})-(\d{2})$/,'$1年$2月$3日'):'选择日期';
    wrapper.classList.toggle('is-empty',!value);
  };
  node.control.addEventListener('input',node.refreshDate);
  node.control.addEventListener('change',node.refreshDate);
  node.control.addEventListener('click',()=>{
    if(!node.control.disabled&&node.control.showPicker)try{node.control.showPicker();}catch{/* Native keyboard input remains available. */}
  });
  node.refreshDate();
  return node;
}
