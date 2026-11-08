import { h, icon } from '../../core/dom.js';
import { taskRoute } from '../task-route.js';
import { consoleApi, hasPermission } from '../../core/api.js';
import { navigate } from '../../core/router.js';
import { asyncRegion, region, summaryMetric as metric } from '../lib.js';
import {
  pageHead, metricRow, badge, button, notice, emptyState,
  skeletonMetrics, skeletonRows, timeline,
} from '../../ui/primitives.js';

/* ==========================================================================
   console/pages/overview.js — 运营总览。

   回答两个问题：
     1. 现在有哪几件事等我处理？（按板块聚合，不再是几十条平铺）
     2. 业务是否健康？（真实工作流数据，不再读已清空的旧活动表）
   ========================================================================== */

const VIEW_LABEL = { materials: '物资', activities: '活动', services: '活动', outreach: '宣传', community: '内建' };

export default async function overviewPage(context, shell) {
  let notificationsInFlight;
  const readNotifications = ({ fresh = false } = {}) => {
    if (fresh) return consoleApi.notifications({ fresh: true });
    if (!notificationsInFlight) notificationsInFlight = consoleApi.notifications().finally(() => { notificationsInFlight = null; });
    return notificationsInFlight;
  };
  let activityInFlight;
  const readActivity = ({ fresh = false } = {}) => {
    if (!hasPermission('events')) return Promise.resolve(null);
    if (fresh) return consoleApi.volunteer.activityOverview({ fresh: true });
    if (!activityInFlight) activityInFlight = consoleApi.volunteer.activityOverview().finally(() => { activityInFlight = null; });
    return activityInFlight;
  };
  const refreshAll = () => Promise.all([metricsRegion, queueRegion, activityRegion].map(slot => slot.reload()));

  const boardCount = (groups, keys) => keys.reduce((sum, key) => sum + (groups.find(group => group.key === key)?.count || 0), 0);

  /* ---- 指标带：只留能指向动作的四个数字 -------------------------------- */
  const metricsRegion = asyncRegion({
    skeleton: skeletonMetrics(4),
    errorTitle: '待办无法加载',
    load: readNotifications,
    render: (payload) => {
      const groups = payload.groups || [];
      const activity = boardCount(groups, ['events']);
      const materials = boardCount(groups, ['materials']);
      const content = boardCount(groups, ['outreach', 'community']);
      return metricRow([
        metric({ label: '待办总数', value: payload.stats.total, unit: '项', tone: payload.stats.total ? 'warn' : '', hint: h('span', { class: 't-caption', text: payload.stats.hiddenTests ? `已隐藏 ${payload.stats.hiddenTests} 条测试记录` : '按板块聚合在下方' }) }),
        metric({ label: '活动待处理', value: activity, unit: '项', tone: activity ? 'warn' : '', hint: h('span', { class: 't-caption', text: '审批、草稿与时长核对' }) }),
        metric({ label: '物资待处理', value: materials, unit: '项', tone: materials ? 'alert' : '', hint: h('span', { class: 't-caption', text: '逾期、审批与库存预警' }) }),
        metric({ label: '内容待处理', value: content, unit: '项', hint: h('span', { class: 't-caption', text: '投稿、任务与内建审核' }) }),
      ]);
    },
  });

  /* ---- 待处理：按板块聚合，一行一件事 -------------------------------- */
  const queueRegion = asyncRegion({
    skeleton: skeletonRows(5),
    errorTitle: '待办队列无法加载',
    load: readNotifications,
    render: (payload) => {
      const groups = payload.groups || [];
      if (!groups.length) {
        return emptyState({
          iconName: 'check',
          title: '没有待处理的任务',
          description: '活动审批、名单确认、时长核对、物资与内容审核都已处理完毕。',
        });
      }
      const rows = groups.map((group) => {
        const top = group.top || {};
        return h('button', {
          class: 'overview-task', type: 'button', data: { board: group.key },
          on: { click: () => { const route = taskRoute({ view: group.view, target: top.target }); if (route) navigate(route); } },
        },
          h('span', { class: 'overview-task__rail' }),
          h('span', { class: 'overview-task__body' },
            h('span', { class: 'overview-task__head' },
              h('strong', { text: group.label }),
              h('span', { class: 't-caption', text: group.types.join(' · ') }),
              group.high ? badge(`${group.high} 项紧急`, { tone: 'error' }) : null),
            h('span', { class: 't-caption t-clamp-1', text: `最紧急：${top.title || ''}${top.detail ? ` · ${top.detail}` : ''}` })),
          h('span', { class: 'overview-task__count' },
            h('strong', { text: String(group.count) }),
            h('span', { class: 't-caption', text: '项' })),
          h('span', { class: 'overview-task__go', text: '前往处理' }),
          icon('arrowRight', 'ico ico--sm'));
      });
      const distribution = groups.map((group) => {
        const max = Math.max(...groups.map(item => item.count), 1);
        return h('div', { class: 'overview-bar' },
          h('span', { class: 'overview-bar__label', text: group.label }),
          h('span', { class: 'overview-bar__track' },
            h('span', { class: 'overview-bar__fill', attrs: { style: `width:${Math.round((group.count / max) * 100)}%` } })),
          h('span', { class: 'overview-bar__value', text: String(group.count) }));
      });
      return [
        h('div', { class: 'overview-board' },
          h('div', { class: 'overview-board__main' }, ...rows),
          h('div', { class: 'overview-board__side' },
            h('h3', { class: 'overview-board__title', text: '待办分布' }),
            ...distribution)),
        payload.stats.hiddenTests
          ? h('p', { class: 't-caption overview-note', text: `已隐藏 ${payload.stats.hiddenTests} 条测试/演示记录，避免占满待办队列。` })
          : null,
      ];
    },
  });

  /* ---- 活动健康：真实工作流数据 ---------------------------------------- */
  const activityRegion = asyncRegion({
    lazy: !hasPermission('events'),
    skeleton: skeletonRows(6),
    errorTitle: '活动数据无法加载',
    load: readActivity,
    render: (payload) => {
      if (!payload) return notice('当前账号没有活动模块权限。', { tone: 'neutral' });
      const result = payload.result || payload;
      const rows = [
        ['活动总数', result.events, '个'],
        ['报名中', result.open, '个'],
        ['进行中', result.running, '个'],
        ['待审批活动', result.pendingApproval, '个'],
        ['报名总数', result.registrations, '人次'],
        ['近 14 天报名', result.recentRegistrations, '人次'],
        ['已确认 / 已签到', `${result.confirmed} / ${result.checkins}`, '人次'],
        ['待确认名单', result.pendingRoster, '人'],
        ['待核时长', result.pendingHours, '条'],
      ];
      return [
        metricRow(rows.slice(0, 4).map(([label, value, unit]) => metric({ label, value: value ?? 0, unit })), { columns: 4 }),
        h('dl', { class: 'overview-facts' },
          ...rows.slice(4).map(([label, value, unit]) => h('div', null,
            h('dt', { text: label }), h('dd', { text: `${value ?? 0} ${unit}` })))),
      ];
    },
  });

  /* ---- 物资：库存与在办清单（流水表为空，不再画空趋势） ---------------- */
  const materialsRegion = asyncRegion({
    lazy: !hasPermission('materials'),
    skeleton: skeletonRows(5),
    errorTitle: '物资数据无法加载',
    load: (options) => consoleApi.materials.overview(options),
    render: (payload) => {
      const stats = payload.stats || {};
      const overdue = (payload.overdue || []).slice(0, 3);
      const lowStock = (payload.lowStock || []).slice(0, 3);
      return [
        metricRow([
          metric({ label: '库存品类', value: stats.categoryCount ?? 0, unit: '种' }),
          metric({ label: '当前可用', value: stats.totalCurrentQuantity ?? 0, unit: '件' }),
          metric({ label: '逾期未还', value: stats.overdueCount ?? 0, unit: '单', tone: stats.overdueCount ? 'alert' : '' }),
          metric({ label: '低库存', value: stats.lowStockCount ?? 0, unit: '项', tone: stats.lowStockCount ? 'warn' : '' }),
        ], { columns: 4 }),
        h('div', { class: 'overview-lists' },
          h('div', null,
            h('h3', { class: 'overview-board__title', text: '逾期未还' }),
            overdue.length
              ? h('ul', { class: 'overview-list' }, ...overdue.map(item => h('li', null,
                h('span', { class: 't-clamp-1', text: item.purpose || '未填写用途' }),
                h('span', { class: 't-caption', text: `${item.overdueDays} 天` }))))
              : h('p', { class: 't-caption', text: '暂无逾期。' })),
          h('div', null,
            h('h3', { class: 'overview-board__title', text: '低库存' }),
            lowStock.length
              ? h('ul', { class: 'overview-list' }, ...lowStock.map(item => h('li', null,
                h('span', { class: 't-clamp-1', text: item.name || item.code || '未命名' }),
                h('span', { class: 't-caption', text: `${item.currentQuantity ?? 0} / ${item.initialQuantity ?? 0}` }))))
              : h('p', { class: 't-caption', text: '库存充足。' }))),
      ];
    },
  });

  /* ---- 最近操作 -------------------------------------------------------- */
  const auditRegion = asyncRegion({
    lazy: !hasPermission('settings'),
    skeleton: skeletonRows(5),
    errorTitle: '操作记录无法加载',
    load: () => consoleApi.audit(8),
    render: (payload) => {
      if (!payload.entries.length) {
        return notice('还没有操作记录。登录、审批和内容审核后可在这里查看。', { tone: 'neutral', iconName: 'activity' });
      }
      return timeline(payload.entries.map((entry) => ({
        title: entry.action,
        description: `${entry.actorName || entry.actor} · ${entry.target}`,
        at: entry.at,
        state: entry.result === 'success' ? 'done' : 'blocked',
        badge: entry.result === 'success' ? null : badge(entry.result, { tone: 'error' }),
      })));
    },
  });

  const node = h('div', { class: 'view wspad operations-module operations-overview' },
    pageHead({
      title: '运营总览',
      description: '先看现在要处理什么，再看业务是否健康。',
      actions: [
        button({ label: '刷新', variant: 'secondary', iconName: 'refresh', onClick: refreshAll }),
        button({ label: '通知中心', variant: 'secondary', iconName: 'bell', onClick: () => shell.openNotifications() }),
      ],
    }),
    h('div', { class: 'stack-8' },
      metricsRegion,
      region({ label: '待办', title: '待处理事项', body: queueRegion }),
      h('div', { class: 'operations-dashboard' },
        hasPermission('events') ? region({
          label: '活动', title: '活动健康',
          actions: [button({ label: '活动管理', variant: 'ghost', size: 'sm', iconAfter: 'arrowRight', iconMotion: 'nudge', href: '/console/events' })],
          body: activityRegion,
        }) : null,
        hasPermission('materials') ? region({
          label: '物资', title: '库存与在办',
          actions: [button({ label: '物资管理', variant: 'ghost', size: 'sm', iconAfter: 'arrowRight', iconMotion: 'nudge', href: '/console/materials' })],
          body: materialsRegion,
        }) : null,
        hasPermission('settings') ? region({
          label: '审计', title: '最近操作记录',
          actions: [button({ label: '全部记录', variant: 'ghost', size: 'sm', iconAfter: 'arrowRight', iconMotion: 'nudge', href: '/console/audit' })],
          body: auditRegion,
        }) : null,
      ),
    ),
  );

  return { title: '总览', crumb: '总览', node };
}
