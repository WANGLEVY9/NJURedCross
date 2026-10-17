import { h, icon } from '../core/dom.js';
import { filterSegments } from '../ui/filter-segments.js';
import { field } from '../ui/primitives.js';
import { eventsHero, eventsCategories, eventsGuide, eventsFooter } from './events-showcase.js';
import { eventRow } from './activity-row.js';

const data = [
  ['博爱中心', '人道法主题分享', '仙林校区', '东区教学楼 A201', '邀请专家分享国际人道法知识，提升同学们的人道理念与全球视野。', 19, 14, 2, 3],
  ['生命中心', '秋季急救技能培训', '鼓楼校区', '医学院 B102', '红十字急救技能培训，涵盖心肺复苏、AED 使用等实用技能，提升应急自救互救能力。', 20, 9, 3, 0],
  ['综事中心', '校园工位值班', '仙林校区', '大学生活动中心', '协助处理日常事务、活动物资整理与档案管理等工作，共同维护红十字会的有序运转。', 21, 13, 4, 12],
  ['主席团专项', '志愿者骨干交流会', '浦口校区', '教学楼 D301', '面向核心志愿者的经验分享与交流，提升团队协作能力，共同规划后续活动。', 22, 18, 2, 5],
  ['一加助残专项', '一加助残 · 温暖同行', '仙林校区', '第三食堂附近', '与特殊需要同学结对陪伴，开展校园融合活动，用实际行动传递温暖与关爱。', 23, 14, 3, 2],
  ['献血车专项', '献血车志愿服务', '苏州校区', '图书馆南侧广场', '协助献血车现场组织、秩序维护、咨询引导等工作，共同汇聚青春热血，传递生命希望。', 24, 9, 6, 0],
].map(([center,name,campus,location,description,day,hour,duration,remaining],index) => ({
  center,name,campus,location,description,remaining,capacity:index===5?25:20,confirmed:(index===5?25:20)-remaining,serviceHours:duration,eventId:`example-${index}`,status:'报名中',full:remaining===0,
  startAt:`2026-10-${day}T${String(hour).padStart(2,'0')}:00:00+08:00`,endAt:`2026-10-${day}T${String(hour+duration).padStart(2,'0')}:00:00+08:00`,duration,
}));
let kind = '';
let campus = '';
const list = h('div', { class: 'event-list' });
const count = h('p', { class: 'sr-only', role: 'status', aria: { live: 'polite' } });
const query = h('input', { type: 'search', placeholder: '搜索活动名称、地点或关键词', on: { input: render } });
const categoryField=field({label:'活动类别',name:'example-category',searchable:false,options:[{value:'',label:'全部类别'},...data.map(event=>({value:event.center,label:event.center}))],onInput:event=>{kind=event.target.value;render();}});
const category=categoryField.control;
const statusField=field({label:'活动状态',name:'example-status',searchable:false,options:[{value:'',label:'全部状态'},{value:'open',label:'有剩余名额'},{value:'full',label:'名额已满'}],onInput:render});
const status=statusField.control;
const region = h('select', { on: { change: render } }, h('option', { value:'', text:'全部地区' }), h('option', { value:'南京', text:'南京地区' }), h('option', { value:'苏州', text:'苏州地区' }));
const regionTabs = filterSegments({items:[{value:'',label:'全部'},{value:'南京',label:'南京地区'},{value:'苏州',label:'苏州地区'}],ariaLabel:'按地区筛选',onChange:value=>{region.value=value;render();}});
const sortField=field({label:'排序方式',name:'example-sort',value:'asc',searchable:false,options:[{value:'asc',label:'按活动时间'},{value:'desc',label:'时间由远到近'}],onInput:render});
const sort=sortField.control;
sortField.classList.add('events-toolbar-field');
const campusControl=field({label:'按校区筛选',name:'example-campus',searchable:false,options:[{value:'',label:'按校区筛选'},...[...new Set(data.map(event=>event.campus))].map(value=>({value,label:value}))],onInput:event=>{campus=event.target.value;render();}});
campusControl.classList.add('events-toolbar-field');
const categories = eventsCategories(value => {kind = kind === value ? '' : value;category.value = kind;render();});
function render() {
  categories.setValue(kind);
  const filtered = data.filter(event => (!kind || event.center === kind) && (!campus || event.campus===campus) && (!query.value || `${event.name}${event.location}${event.description}`.includes(query.value.trim())) && (!status.value || (status.value==='full' ? event.full : !event.full)) && (!region.value || (region.value==='苏州' ? event.campus.includes('苏州') : !event.campus.includes('苏州')))).sort((a,b)=>(new Date(a.startAt)-new Date(b.startAt))*(sort.value==='desc'?-1:1));
  count.textContent = `当前展示 ${filtered.length} 项演示活动`;
  list.replaceChildren(...filtered.map(event => {
    const row = eventRow(event, { href: '#example-notice', plaza:true,actionLabel:'查看并报名' });
    row.querySelector('a').addEventListener('click', () => { notice.hidden = false;notice.focus(); });
    return row;
  }));
  if (!filtered.length) list.append(h('p', {text:'没有符合条件的演示活动，请调整筛选条件。'}));
}
const notice = h('p', { id:'example-notice', role:'status', tabindex:'-1', hidden:true, text:'这是独立效果案例，演示活动不开放报名。实际报名请前往活动广场。' });
const hero = eventsHero();
document.querySelector('#example-root').append(hero.node, categories.node,
  h('div', { class:'example-layout' },
    h('div', { class:'discovery-filters' }, h('label', {class:'example-search'},h('span',{class:'sr-only',text:'搜索活动'}),icon('search','ico'), query), categoryField,statusField,regionTabs),
    h('div', {class:'events-results-heading'},h('h2',{text:'近期活动'}),h('div',{class:'events-results-controls'},campusControl,sortField)),count,list,notice,eventsGuide()));
document.querySelector('.plaza-example-footer').replaceChildren(eventsFooter());
render();
addEventListener('pagehide', hero.dispose, {once:true});
