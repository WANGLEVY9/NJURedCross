/* ==========================================================================
   console/pages/overview.js — the operations workbench.
   Question it answers: "what needs me right now, and is anything trending
   in the wrong direction?" Task queue first, aggregates second.
   ========================================================================== */

import { h } from '../../core/dom.js';
import { consoleApi } from '../../core/api.js';
import { navigate } from '../../core/router.js';
import { asyncRegion, region, columns, reloadAction } from '../lib.js';
import {
  pageHead, metric, metricRow, badge, button, queueRow, emptyState, segmented,
  skeletonMetrics, skeletonRows, statusIndicator, notice, timeline,
} from '../../ui/primitives.js';
import { trendChart, donutChart, rankedBars } from '../../ui/chart.js';
import * as fmt from '../../core/format.js';

const VIEW_ROUTES = {
  materials: '/console/materials',
  activities: '/console/events',
  events: '/console/events',
  services: '/console/volunteers',
  volunteers: '/console/volunteers',
  outreach: '/console/outreach',
  community: '/console/community',
};

export default async function overviewPage(context, shell) {
  /* ---- Metrics ---------------------------------------------------------- */
  const metricsRegion = asyncRegion({
    skeleton: skeletonMetrics(4),
    errorTitle: '待办指标无法加载',
    load: () => consoleApi.notifications(),
    render: (payload) =>
      metricRow([
        metric({
          label: '待处理事项',
          value: payload.stats.total,
          unit: '项',
          hint: statusIndicator(payload.stats.total ? '需要人工处理' : '队列已清空', { tone: payload.stats.total ? 'warning' : 'success', live: Boolean(payload.stats.total) }),
          onClick: () => shell.openNotifications(),
        }),
        metric({
          label: '高优先级',
          value: payload.stats.high,
          unit: '项',
          tone: payload.stats.high ? 'alert' : '',
          hint: h('span', { class: 't-caption', text: '物资逾期与库存告警优先' }),
          onClick: () => shell.openNotifications(),
        }),
        metric({
          label: '需处理',
          value: payload.stats.medium,
          unit: '项',
          tone: payload.stats.medium ? 'warn' : '',
          hint: h('span', { class: 't-caption', text: '审批、待发布与待核对' }),
        }),
        metric({
          label: '可稍后',
          value: payload.stats.low,
          unit: '项',
          hint: h('span', { class: 't-caption', text: '内容征集与信息补全' }),
        }),
      ]),
  });

  /* ---- Task queue ------------------------------------------------------- */
  const queueRegion = asyncRegion({
    skeleton: skeletonRows(6),
    errorTitle: '待办队列无法加载',
    load: () => consoleApi.notifications(),
    render: (payload, { reload }) => {
      if (!payload.items.length) {
        return emptyState({
          iconName: 'check',
          title: '没有待处理的任务',
          description: '物资审批、库存预警、活动发布、志愿时长核对与内容审核都已处理完毕。新任务出现时会自动进入这个队列。',
          actions: [
            button({ label: '重新统计', variant: 'secondary', iconName: 'refresh', iconMotion: 'spin', onClick: reload }),
            button({ label: '查看物资中心', variant: 'ghost', iconAfter: 'arrowRight', iconMotion: 'nudge', href: '/console/materials' }),
          ],
        });
      }

      let filter = 'all';
      const list = h('div', { class: 'queue' });

      const draw = () => {
        const items = filter === 'all' ? payload.items : payload.items.filter((item) => item.priority === filter);
        list.replaceChildren(
          ...(items.length
            ? items.map((item) =>
                queueRow({
                  type: item.type,
                  title: item.title,
                  detail: item.detail,
                  priority: item.priority,
                  meta: [badge(fmt.priorityLabel(item.priority), { tone: item.priority === 'high' ? 'error' : item.priority === 'medium' ? 'warning' : 'info' })],
                  action: button({ label: '前往处理', variant: 'secondary', size: 'sm', iconAfter: 'arrowRight', iconMotion: 'nudge' }),
                  onClick: () => {
                    const route = VIEW_ROUTES[item.view];
                    if (route) navigate(route);
                  },
                }),
              )
            : [
                emptyState({
                  iconName: 'filter',
                  title: '这一优先级下没有任务',
                  description: '切换到其他优先级查看剩余待办。',
                }),
              ]),
        );
      };

      const control = segmented({
        items: [
          { value: 'all', label: `全部 ${payload.stats.total}` },
          { value: 'high', label: `高 ${payload.stats.high}` },
          { value: 'medium', label: `中 ${payload.stats.medium}` },
          { value: 'low', label: `低 ${payload.stats.low}` },
        ],
        value: filter,
        ariaLabel: '按优先级筛选待办',
        onChange: (value) => {
          filter = value;
          control.setValue(value);
          draw();
        },
      });

      draw();
      return [h('div', { class: 'row-3 row-wrap queue__filters' }, control), list];
    },
  });

  /* ---- Composition ------------------------------------------------------ */
  const compositionRegion = asyncRegion({
    skeleton: h('div', { class: 'sk sk--block' }),
    errorTitle: '待办构成无法加载',
    load: () => consoleApi.notifications(),
    render: (payload) => {
      const byType = new Map();
      for (const item of payload.items) byType.set(item.type, (byType.get(item.type) || 0) + 1);
      const segments = [
        { label: '高优先级', value: payload.stats.high, color: 'var(--error)' },
        { label: '需处理', value: payload.stats.medium, color: 'var(--warning)' },
        { label: '可稍后', value: payload.stats.low, color: 'var(--info)' },
      ];
      return [
        donutChart({ segments, centerValue: payload.stats.total, centerLabel: '待办总数' }),
        h('hr', { class: 'divider' }),
        h('p', { class: 't-label', text: '按任务类型' }),
        rankedBars({
          data: [...byType.entries()]
            .sort((a, b) => b[1] - a[1])
            .slice(0, 6)
            .map(([label, value]) => ({ label, value })),
          emptyLabel: '暂无待办类型',
        }),
      ];
    },
  });

  /* ---- Event trend ------------------------------------------------------ */
  const eventTrendRegion = asyncRegion({
    skeleton: h('div', { class: 'sk sk--block sk--chart' }),
    errorTitle: '活动趋势无法加载',
    load: () => consoleApi.events.overview(),
    render: (payload) => {
      const series = payload.series;
      const hasData = series && [series.registrations, series.checkins, series.cancellations].some((values) => values?.some((value) => value > 0));
      if (!hasData) {
        return emptyState({
          iconName: 'activity',
          title: '最近 14 天还没有报名或签到事件',
          description: '发布活动并产生真实报名后，这里会显示逐日的报名、签到与取消曲线。当前不展示任何模拟数据。',
          actions: [button({ label: '前往活动中心', variant: 'primary', iconAfter: 'arrowRight', iconMotion: 'nudge', href: '/console/events' })],
        });
      }
      return [
        trendChart({
          labels: series.labels.map((label) => label.slice(5)),
          series: [
            { name: '报名', values: series.registrations, color: 'var(--accent)' },
            { name: '签到', values: series.checkins, color: 'var(--success)', area: false },
            { name: '取消', values: series.cancellations, color: 'var(--text-muted)', area: false },
          ],
          height: 208,
          ariaLabel: '最近 14 天活动报名、签到与取消趋势',
        }),
        h('p', { class: 't-caption t-faint', text: '数据来源：活动报名表的提交时间、签到时间与取消时间（Asia/Shanghai）。' }),
      ];
    },
  });

  /* ---- Materials flow trend --------------------------------------------- */
  const flowTrendRegion = asyncRegion({
    skeleton: h('div', { class: 'sk sk--block sk--chart' }),
    errorTitle: '物资流水趋势无法加载',
    load: () => consoleApi.materials.overview(),
    render: (payload) => {
      const series = payload.series;
      const hasData = series && [series.inbound, series.outbound].some((values) => values?.some((value) => value > 0));
      return [
        metricRow(
          [
            metric({ label: '库存品类', value: payload.stats.categoryCount, unit: '种' }),
            metric({ label: '当前可用', value: payload.stats.totalCurrentQuantity, unit: '件' }),
            metric({ label: '低库存预警', value: payload.stats.lowStockCount, unit: '项', tone: payload.stats.lowStockCount ? 'warn' : '' }),
            metric({ label: '逾期未归还', value: payload.stats.overdueCount, unit: '单', tone: payload.stats.overdueCount ? 'alert' : '' }),
          ],
          { columns: 4 },
        ),
        hasData
          ? trendChart({
              labels: series.labels.map((label) => label.slice(5)),
              series: [
                { name: '入库/归还', values: series.inbound, color: 'var(--success)' },
                { name: '出库/报损', values: series.outbound, color: 'var(--accent)' },
              ],
              height: 176,
              ariaLabel: '最近 14 天物资出入库数量趋势',
            })
          : notice('最近 14 天没有新的出入库流水。历史汇总数量没有逐笔来源，平台不会把它伪造成流水事件。', { tone: 'neutral', title: '暂无流水事件' }),
      ];
    },
  });

  /* ---- Recent audit ----------------------------------------------------- */
  const auditRegion = asyncRegion({
    skeleton: skeletonRows(5),
    errorTitle: '审计记录无法加载',
    load: () => consoleApi.audit(8),
    render: (payload) => {
      if (!payload.entries.length) {
        return emptyState({ iconName: 'activity', title: '还没有审计记录', description: '登录、审批、出入库、签到与内容审核都会在这里留下记录。' });
      }
      return timeline(
        payload.entries.map((entry) => ({
          title: entry.action,
          description: `${entry.actor} · ${entry.target}`,
          at: entry.at,
          state: entry.result === 'success' ? 'done' : 'blocked',
          badge: entry.result === 'success' ? null : badge(entry.result, { tone: 'error' }),
        })),
      );
    },
  });

  const node = h(
    'div',
    { class: 'view wspad' },
    pageHead({
      label: '工作台',
      title: '今天需要处理什么',
      description: '任务队列汇总物资、活动、志愿服务与内容四条业务线；每一项都可以直接跳转到对应的操作界面。',
      actions: [
        button({ label: '通知中心', variant: 'secondary', iconName: 'bell', keys: 'mod+i', onClick: () => shell.openNotifications() }),
        button({ label: '打开命令面板', variant: 'primary', iconName: 'search', keys: 'mod+k', onClick: () => import('../../ui/palette.js').then((m) => m.openPalette()) }),
      ],
    }),
    h(
      'div',
      { class: 'stack-8' },
      metricsRegion,
      columns(
        [
          region({
            label: '任务队列',
            title: '待处理事项',
            description: '按优先级排序；点击任意一项直接进入对应模块。',
            actions: [reloadAction(queueRegion)],
            body: queueRegion,
          }),
          region({
            label: '活动运营',
            title: '最近 14 天报名与签到',
            description: '真实事件驱动，没有事件时不显示曲线。',
            actions: [reloadAction(eventTrendRegion), button({ label: '活动中心', variant: 'ghost', size: 'sm', iconAfter: 'arrowRight', iconMotion: 'nudge', href: '/console/events' })],
            body: eventTrendRegion,
          }),
        ],
        [
          region({ label: '构成', title: '待办分布', actions: [reloadAction(compositionRegion)], body: compositionRegion, dense: true }),
          region({
            label: '物资',
            title: '库存与流水',
            actions: [button({ label: '物资中心', variant: 'ghost', size: 'sm', iconAfter: 'arrowRight', iconMotion: 'nudge', href: '/console/materials' })],
            body: flowTrendRegion,
            dense: true,
          }),
          region({
            label: '审计',
            title: '最近操作记录',
            actions: [button({ label: '全部记录', variant: 'ghost', size: 'sm', iconAfter: 'arrowRight', iconMotion: 'nudge', href: '/console/settings' })],
            body: auditRegion,
            dense: true,
          }),
        ],
      ),
    ),
  );

  return { title: '工作台', crumb: '工作台', node };
}
