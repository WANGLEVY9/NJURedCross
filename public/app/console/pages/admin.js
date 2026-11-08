import {openHoursSync} from './hours-sync.js';
import {openDuplicatePeople} from './duplicate-people.js';
import {configureActivityApprovers} from './activity-approval.js';
import {configureWorkspaceRoles} from './activity-role-settings.js';
import {openMailSettings} from './mail-settings.js';
import {reportError} from '../../core/toast.js';
import { h, icon, clear } from '../../core/dom.js';
import { getSessionState, hasPermission } from '../../core/api.js';
import { patchQuery } from '../../core/router.js';
import { pageHead, button, segmented, definitionList, badge } from '../../ui/primitives.js';
import { CONSOLE_SECTIONS } from '../navigation.js';
import settingsPage from './settings.js';

/* 一行动作：图标 + 标题 + 说明 + 箭头。href 走原生链接，其余走按钮。 */
function actionRow({ iconName, title, description, action = null, href = null }) {
  const body = [
    h('span', { class: 'admin-action__icon', attrs: { 'aria-hidden': 'true' } }, icon(iconName, 'ico ico--sm')),
    h('span', { class: 'admin-action__body' },
      h('span', { class: 'admin-action__title', text: title }),
      description ? h('span', { class: 'admin-action__desc', text: description }) : null),
    icon('arrowRight', 'ico ico--sm admin-action__go'),
  ];
  // 描述是辅助信息，可访问名称只取标题，避免读屏把整段说明念成按钮名。
  const attrs = { class: 'admin-action', aria: { label: title } };
  return href
    ? h('a', { ...attrs, href }, ...body)
    : h('button', { ...attrs, type: 'button', on: { click: () => action?.() } }, ...body);
}

/* 分组卡片：一张卡放同一类操作，内部两列，避免全宽巨块。 */
function actionGroup({ title, description, items }) {
  return h('section', { class: 'admin-card' },
    h('div', { class: 'admin-card__head' },
      h('div', null,
        h('h2', { class: 'admin-card__title', text: title }),
        description ? h('p', { class: 'admin-card__desc', text: description }) : null)),
    h('div', { class: `admin-actions${items.length === 1 ? ' admin-actions--single' : ''}` }, ...items));
}

export default async function adminPage(context) {
  const user = getSessionState().user || {};
  const views = [{value:'profile',label:'我的账号'},{value:'workspace',label:'工作区偏好'},
    ...(hasPermission('settings') ? [{value:'status',label:'系统状态'},{value:'audit',label:'操作记录'}] : [])];
  let active = views.some(v => v.value === context.query.get('view')) ? context.query.get('view') : 'profile';
  const body = h('div',{class:'stack-6'});
  let generation=0;
  const tabs=segmented({items:views,value:active,ariaLabel:'管理员中心视图',onChange:value=>{active=value;tabs.setValue(value);patchQuery({view:value},{navigate:false});draw();}});

  function accountCard() {
    const permissions = CONSOLE_SECTIONS.filter(section => section.scope && hasPermission(section.scope));
    return h('section', { class: 'admin-card admin-card--profile' },
      h('div', { class: 'admin-card__head' },
        h('div', null,
          h('h2', { class: 'admin-card__title', text: '当前账号' }),
          h('p', { class: 'admin-card__desc', text: '账号资料与本次会话的管理权限。' }))),
      h('div', { class: 'admin-profile' },
        h('div', { class: 'admin-profile__identity' },
          h('span', { class: 'admin-profile__avatar', attrs: { 'aria-hidden': 'true' } }, icon('user', 'ico')),
          h('div', { class: 'admin-profile__meta' },
            h('h3', { class: 'admin-profile__name', text: user.label || user.username || '管理员' }),
            h('div', { class: 'admin-profile__subs' },
              badge(user.roleLabel || '运营管理员', { tone: 'accent' }),
              h('span', { class: 't-caption', text: user.username || '—' })))),
        h('div', { class: 'admin-profile__actions' },
          button({ label: '维护个人资料', href: '/me', variant: 'secondary', iconName: 'user' }),
          button({ label: '修改登录密码', href: '/change-password', variant: 'secondary', iconName: 'lock' }))));
  }

  function sessionCard({ goTab }) {
    const permissions = CONSOLE_SECTIONS.filter(section => section.scope && hasPermission(section.scope));
    return h('section', { class: 'admin-card admin-card--aside' },
      h('div', { class: 'admin-card__head' },
        h('div', null, h('h2', { class: 'admin-card__title', text: '会话与权限' }))),
      h('div', { class: 'admin-aside' },
        definitionList([
          ['登录账号', user.username || '—'],
          ['账号角色', user.roleLabel || user.role || '—'],
          ['可管理板块', `${permissions.length} 个`],
        ]),
        h('div', { class: 'admin-aside__perms' },
          h('p', { class: 'admin-aside__label', text: '权限范围' }),
          h('div', { class: 'admin-profile__permissions' },
            ...(permissions.length
              ? permissions.map(section => badge(section.label, { tone: 'neutral' }))
              : [h('span', { class: 't-caption', text: '当前仅有基础访问权限。' })])))));
  }

  function shortcutCard({ goTab }) {
    const items = [];
    if (hasPermission('settings')) {
      items.push(actionRow({ iconName: 'activity', title: '系统状态', description: '数据源、连接与运行状态。', action: () => goTab('status') }));
      items.push(actionRow({ iconName: 'clipboard', title: '操作日志', description: '按角色、板块与类型检索全平台操作。', href: '/console/audit' }));
    }
    if (!items.length) return null;
    return h('section', { class: 'admin-card' },
      h('div', { class: 'admin-card__head' }, h('div', null, h('h2', { class: 'admin-card__title', text: '快捷入口' }))),
      h('div', { class: 'admin-actions admin-actions--single' }, ...items));
  }

  async function draw() {
    const current=++generation;clear(body);
    if(active==='profile') {
      const groups = [];
      if (user.role === 'super_admin') {
        groups.push(actionGroup({
          title: '通知与内容',
          description: '邮件模板、班次提醒与献血车参与说明。',
          items: [actionRow({
            iconName: 'mail', title: '邮件模板与参与说明',
            description: '统一维护各类邮件正文、提醒与参与须知。',
            action: () => openMailSettings().catch(error => reportError(error, '设置暂时无法加载')),
          })],
        }));
        groups.push(actionGroup({
          title: '权限与人员',
          description: '活动审核人、地区负责人与人员资料核对。',
          items: [
            actionRow({ iconName: 'shield', title: '活动权限与负责人配置', description: '按地区与类别配置审核人与负责人。', action: () => configureWorkspaceRoles(async () => {}) }),
            actionRow({ iconName: 'user', title: '历史活动审核人配置', description: '为往期活动补配审核人。', action: () => configureActivityApprovers() }),
            actionRow({ iconName: 'users', title: '人员资料核对', description: '按学号检查重复人员与姓名冲突。', action: () => openDuplicatePeople() }),
            actionRow({ iconName: 'clock', title: '时长入账与同步', description: '查看两张汇总表入账结果并核对失败记录。', action: () => openHoursSync() }),
          ],
        }));
      }
      const tail = [];
      if (hasPermission('events')) tail.push(actionRow({ iconName: 'calendar', title: '历史活动', description: '查看权限范围内已结束的活动。', href: '/console/events?history=1' }));
      if (hasPermission('data')) tail.push(actionRow({ iconName: 'table', title: '数据维护', description: '查看业务表与字段；业务操作请优先在对应板块完成。', href: '/console/data' }));
      if (tail.length) groups.push(actionGroup({ title: '数据与历史', items: tail }));

      const goTab = (value) => { active = value; tabs.setValue(value); patchQuery({ view: value }, { navigate: false }); draw(); };
      body.append(h('div', { class: 'admin-center' },
        h('div', { class: 'admin-center__main' }, accountCard(), ...groups),
        h('div', { class: 'admin-center__side' }, sessionCard({ goTab }), shortcutCard({ goTab }))));
    } else {
      const result=await settingsPage({embedded:true,initialTab:active});
      if(current===generation)body.append(result.node);
    }
  }
  draw();
  return {title:'管理员中心',crumb:'管理员中心',node:h('div',{class:'view wspad wspad--wide stack-6'},
    pageHead({title:'管理员中心',description:'管理自己的账号与工作区，查看系统状态和操作记录。'}),
    h('div',{class:'console-section-tabs'},tabs),body),dispose:()=>{generation++;}};
}
