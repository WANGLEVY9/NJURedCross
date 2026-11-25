import {h} from '../core/dom.js';

/** One official brand lockup shared by portal, console and loading surfaces. */
export function brandLockup({tag='div',className='',href=null,compact=false,english=null}={}){
 const emblem=h('img',{class:'brand-lockup__emblem',src:'/assets/nju-red-cross-emblem-128.webp',alt:'',width:44,height:44,decoding:'async'});
 const copy=h('span',{class:'brand-lockup__text'},
  h('b',{class:'brand-lockup__cn',text:'南京大学红十字会'}),
  h('span',{class:'brand-lockup__en',text:english||'NJU Red Cross'}));
 const classes=['brand-lockup',compact?'brand-lockup--compact':null,className].filter(Boolean).join(' ');
 const children=[emblem,copy];
 return href?h('a',{class:classes,href,attrs:{'aria-label':'南京大学红十字会首页'}},...children):h(tag,{class:classes},...children);
}
