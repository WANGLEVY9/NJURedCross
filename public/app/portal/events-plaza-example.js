import { h } from '../core/dom.js';
import { eventsHero, eventsCategories, eventsGuide } from './events-showcase.js';
import { eventRow } from './activity-row.js';

const data = [
  ['博爱中心', '人道法主题分享', '仙林校区', '东区教学楼 A201', '邀请专家分享国际人道法知识，提升同学们的人道理念与全球视野。', 19, 14, 2, 3],
  ['生命中心', '秋季急救技能培训', '鼓楼校区', '医学院 B102', '红十字急救技能培训，涵盖心肺复苏、AED 使用等实用技能，提升应急自救互救能力。', 20, 9, 3, 0],
  ['排班类', '校园服务早班值守', '仙林校区', '大学生活动中心', '按班次参与校园服务，协助来访接待、信息登记与现场秩序维护。', 21, 9, 3, 8],
  ['综事中心', '校园工位值班', '仙林校区', '大学生活动中心', '协助处理日常事务、活动物资整理与档案管理等工作，共同维护红十字会的有序运转。', 21, 13, 4, 12],
  ['主席团专项', '志愿者骨干交流会', '浦口校区', '教学楼 D301', '面向核心志愿者的经验分享与交流，提升团队协作能力，共同规划后续活动。', 22, 18, 2, 5],
  ['一加助残专项', '一加助残 · 温暖同行', '仙林校区', '第三食堂附近', '与特殊需要同学结对陪伴，开展校园融合活动，用实际行动传递温暖与关爱。', 23, 14, 3, 2],
  ['献血车专项', '献血车志愿服务', '苏州校区', '图书馆南侧广场', '协助献血车现场组织、秩序维护、咨询引导等工作，共同汇聚青春热血，传递生命希望。', 24, 9, 6, 0],
  ['排班类', '公益物资整理午班', '鼓楼校区', '志愿服务站', '分时段整理公益物资、核对借还记录，协力做好服务站的日常保障。', 25, 13, 3, 4],
  ['排班类', '苏州校园服务晚班', '苏州校区', '学生活动中心', '参与晚间服务点值守，协助场地巡查、活动收尾和下一班次交接。', 26, 18, 2, 0],
].map(([center,name,campus,location,description,day,hour,duration,remaining],index) => ({
  center,name,campus,location,description,remaining,eventId:`example-${index}`,status:'报名中',full:remaining===0,
  startAt:`2026-10-${day}T${String(hour).padStart(2,'0')}:00:00+08:00`,endAt:`2026-10-${day}T${String(hour+duration).padStart(2,'0')}:00:00+08:00`,duration,
}));
let kind = '';
const list = h('div', { class: 'event-list' });
const count = h('p', { class: 't-caption', role: 'status', aria: { live: 'polite' } });
const query = h('input', { type: 'search', placeholder: '搜索活动名称、地点或关键词', on: { input: render } });
const category = h('select', { on: { change: () => {kind = category.value;render();} } }, h('option', { value: '', text: '全部类别' }), ...[...new Set(data.map(event => event.center))].map(center => h('option', { value: center, text: center })));
const status = h('select', { on: { change: render } }, h('option', { value:'', text:'全部状态' }), h('option', { value:'open', text:'有剩余名额' }), h('option', { value:'full', text:'名额已满' }));
const region = h('select', { on: { change: render } }, h('option', { value:'', text:'全部地区' }), h('option', { value:'南京', text:'南京地区' }), h('option', { value:'苏州', text:'苏州地区' }));
const categories = eventsCategories(value => {kind = kind === value ? '' : value;category.value = kind;render();});
function render() {
  categories.setValue(kind);
  const filtered = data.filter(event => (!kind || event.center === kind) && (!query.value || `${event.name}${event.location}${event.description}`.includes(query.value.trim())) && (!status.value || (status.value==='full' ? event.full : !event.full)) && (!region.value || (region.value==='苏州' ? event.campus.includes('苏州') : !event.campus.includes('苏州'))));
  count.textContent = `当前展示 ${filtered.length} 项演示活动`;
  list.replaceChildren(...filtered.map(event => {
    const row = eventRow(event, { href: '#example-notice', sessionLabel: `服务时长 ${event.duration} 小时`, actionLabel:'查看演示' });
    row.querySelector('a').addEventListener('click', () => { notice.hidden = false;notice.focus(); });
    return row;
  }));
  if (!filtered.length) list.append(h('p', {text:'没有符合条件的演示活动，请调整筛选条件。'}));
}
const notice = h('p', { id:'example-notice', role:'status', tabindex:'-1', hidden:true, text:'这是独立效果案例，演示活动不开放报名。实际报名请前往活动广场。' });
const hero = eventsHero();
document.querySelector('#example-root').append(hero.node, categories.node,
  h('div', { class:'example-layout' },
    h('div', { class:'discovery-filters' }, h('label', {class:'example-search'}, '搜索活动', query), h('label', {}, '活动类别', category), h('label', {}, '活动状态', status), h('label', {}, '地区', region)),
    h('div', {class:'events-results-heading'},h('h2',{text:'近期活动'}),h('span',{class:'t-caption',text:'按活动时间排序'})),count,list,notice,eventsGuide()));
render();
addEventListener('pagehide', hero.dispose, {once:true});
