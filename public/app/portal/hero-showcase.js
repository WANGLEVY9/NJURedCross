import { h, icon } from '../core/dom.js';
import { PORTAL_NAV } from './navigation.js';

// Illustration copy is shared by the showcase and the service index; routes stay in PORTAL_NAV.
const EDITIONS = {
  events: { motif:'参与 · 行动', line:'把善意，付诸行动。', cta:'发现近期活动' },
  outreach: { motif:'记录 · 表达', line:'让校园故事被看见。', cta:'分享校园故事' },
  community: { motif:'连接 · 关怀', line:'让日常，多一份牵挂。', cta:'发现温暖连接' },
  materials: { motif:'准备 · 支持', line:'为每次行动做好准备。', cta:'了解物资借用' },
  me: { motif:'积累 · 成长', line:'每一步参与，都有迹可循。', cta:'查看参与记录' },
};
export const SHOWCASE_TOPICS = PORTAL_NAV.map(item=>({ ...item, key:item.path.slice(1), ...EDITIONS[item.path.slice(1)] }));
export function topicArt(key, className='showcase__art') {
  return h('svg',{class:className,viewBox:'0 0 640 480',aria:{hidden:'true'},attrs:{focusable:'false'}},
    h('use',{href:`/assets/showcase/${key}.svg#art`}));
}

export function heroShowcase() {
  let current=0, timer=null, disposed=false, paused=false, hovering=false, focused=false;
  const reduced=matchMedia('(prefers-reduced-motion: reduce)');
  const abort=new AbortController();
  const isReduced=()=>reduced.matches || document.documentElement.dataset.motion==='reduced';
  const count=h('span',{class:'showcase__count',text:'01 / 05',aria:{hidden:'true'}});
  const announcement=h('span',{class:'sr-only',attrs:{role:'status','aria-live':'polite'}});
  const slides=SHOWCASE_TOPICS.map((item,i)=>h('div',{
    class:'showcase__slide',id:`showcase-${item.key}`,hidden:i!==0,
    attrs:{role:'group','aria-roledescription':'幻灯片','aria-label':`${i+1} / 5 · ${item.label}`},
  },h('div',{class:'showcase__caption'},h('span',{text:item.label}),h('span',{text:item.motif})),
  topicArt(item.key),h('div',{class:'showcase__foot'},
    h('p',{text:item.line}),h('a',{href:item.path,class:'showcase__link'},h('span',{text:item.cta}),icon('arrowRight','ico ico--sm')))));
  const dots=SHOWCASE_TOPICS.map((item,i)=>h('button',{type:'button',class:'showcase__dot',
    aria:{label:`显示${item.label}`,pressed:i===0?'true':'false',controls:`showcase-${item.key}`},
    on:{click:()=>select(i,true)}},h('span',{text:item.shortLabel})));
  const play=h('button',{type:'button',class:'showcase__play',on:{click:()=>{paused=!paused;sync();}}});
  const controls=h('div',{class:'showcase__controls',aria:{label:'专题切换'}},
    h('div',{class:'showcase__track'},...dots),
    h('div',{class:'showcase__transport'},count,
      h('button',{type:'button',class:'icon-btn',aria:{label:'上一专题'},on:{click:()=>select(current-1,true)}},icon('chevronLeft','ico ico--sm')),
      h('button',{type:'button',class:'icon-btn',aria:{label:'下一专题'},on:{click:()=>select(current+1,true)}},icon('chevronRight','ico ico--sm')),play));
  const node=h('section',{class:'hero-showcase',attrs:{role:'region','aria-roledescription':'轮播','aria-label':'探索五大广场'}},
    h('div',{class:'showcase__stage'},...slides),controls,announcement);
  function sync(){
    clearTimeout(timer);timer=null;
    play.disabled=isReduced();play.textContent=isReduced()?'手动切换':paused?'播放':'暂停';
    play.setAttribute('aria-label',isReduced()?'减少动态已开启，手动切换专题':paused?'播放专题轮播':'暂停专题轮播');
    if(!disposed && !paused && !hovering && !focused && !document.hidden && !isReduced())timer=setTimeout(()=>select(current+1,false),7000);
  }
  function select(index,manual){
    if(disposed)return;
    if(manual)paused=true;
    current=(index+slides.length)%slides.length;
    slides.forEach((slide,i)=>{slide.hidden=i!==current;dots[i].setAttribute('aria-pressed',String(i===current));});
    count.textContent=`0${current+1} / 05`;
    if(manual)announcement.textContent=`${SHOWCASE_TOPICS[current].label}，第 ${current+1} 项，共 5 项`;
    sync();
  }
  const listen=(target,event,handler)=>target.addEventListener(event,handler,{signal:abort.signal});
  listen(node,'pointerenter',()=>{hovering=true;sync();});listen(node,'pointerleave',()=>{hovering=false;sync();});
  listen(node,'focusin',()=>{focused=true;sync();});
  listen(node,'focusout',e=>{if(!node.contains(e.relatedTarget)){focused=false;sync();}});
  listen(controls,'keydown',e=>{if(['ArrowLeft','ArrowRight'].includes(e.key)){e.preventDefault();select(current+(e.key==='ArrowLeft'?-1:1),true);}});
  listen(document,'visibilitychange',sync);listen(reduced,'change',sync);
  const observer=new MutationObserver(sync);observer.observe(document.documentElement,{attributes:true,attributeFilter:['data-motion']});
  sync();
  return {node,dispose(){disposed=true;clearTimeout(timer);abort.abort();observer.disconnect();}};
}
