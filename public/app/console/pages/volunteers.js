/* ==========================================================================
   console/pages/volunteers.js — volunteer service pipeline.
   The second SeaTable base stays read-only, so this page exists to LOCATE
   gaps in the chain rather than to write across bases.
   ========================================================================== */

import { h, icon } from '../../core/dom.js';
import { consoleApi, ApiError } from '../../core/api.js';
import { asyncRegion, region, reloadAction } from '../lib.js';
import { dataTable } from '../../ui/table.js';
import {
  pageHead, metric, metricRow, badge, button, notice, emptyState, skeletonMetrics,
  skeletonRows, statusFor, statusIndicator, definitionList, queueRow,
} from '../../ui/primitives.js';
import { rankedBars, donutChart } from '../../ui/chart.js';
import * as fmt from '../../core/format.js';

const CHAIN = [
  { key: 'approvals', label: '登记审批', iconName: 'shield', description: '活动立项与场地审批' },
  { key: 'registrations', label: '活动报名', iconName: 'users', description: '志愿者报名与岗位分配' },
  { key: 'checkins', label: '活动签到', iconName: 'qr', description: '现场签到与人工核对' },
  { key: 'hoursQueue', label: '时长待核对', iconName: 'clock', description: '服务时长录入前的人工复核' },
  { key: 'memberProfiles', label: '志愿者档案', iconName: 'file', description: '个人主页累计时长' },
];

function eventGaps(event) {
  const gaps = [];
  if (event.registrations > 0 && event.checkedIn === 0) gaps.push('有报名但没有任何签到');
  if (event.confirmed > event.checkedIn && event.checkedIn > 0) gaps.push(`${event.confirmed - event.checkedIn} 人已确认未签到`);
  if (event.checkedIn > event.registrations) gaps.push('签到人数多于报名人数，需核对名单');
  return gaps;
}

export default async function volunteersPage() {
  const load = async () => {
    try {
      return await consoleApi.volunteer.overview();
    } catch (error) {
      if (error instanceof ApiError && error.status === 503) return { unconfigured: true };
      throw error;
    }
  };

  const chainRegion = asyncRegion({
    skeleton: h('div', { class: 'stack-6' }, skeletonMetrics(5), skeletonRows(6)),
    errorTitle: '志愿服务数据无法加载',
    load,
    render: (payload, { reload }) => {
      if (payload.unconfigured) {
        return emptyState({
          iconName: 'link',
          title: '尚未配置志愿服务数据源',
          description: '志愿服务看板依赖第二个 SeaTable Base。请在服务端 .env 中配置 SEATABLE_VOLUNTEER_API_TOKEN 与 SEATABLE_VOLUNTEER_BASE_UUID 后重启服务。凭据只保存在服务端。',
          actions: [button({ label: '查看系统设置', variant: 'primary', iconAfter: 'arrowRight', iconMotion: 'nudge', href: '/console/settings' })],
        });
      }

      const gapEvents = payload.events.map((event) => ({ ...event, gaps: eventGaps(event) })).filter((event) => event.gaps.length);

      return [
        metricRow(
          CHAIN.map((stage) =>
            metric({
              label: stage.label,
              value: payload.stats[stage.key] || 0,
              unit: stage.key === 'hoursQueue' ? '条' : stage.key === 'memberProfiles' ? '人' : '条',
              tone: stage.key === 'hoursQueue' && payload.stats.hoursQueue ? 'warn' : '',
              hint: h('span', { class: 't-caption', text: stage.description }),
            }),
          ),
          { columns: 5 },
        ),
        h(
          'div',
          { class: 'chain' },
          ...CHAIN.map((stage, index) =>
            h(
              'div',
              { class: 'chain__node', data: { gap: stage.key === 'hoursQueue' && payload.stats.hoursQueue ? 'true' : null } },
              h('div', { class: 'row-2' }, icon(stage.iconName, 'ico ico--sm'), h('span', { class: 't-label', text: stage.label })),
              h('b', { class: 't-h2 t-num', text: fmt.int(payload.stats[stage.key] || 0) }),
              h('p', { class: 't-caption', text: stage.description }),
              index < CHAIN.length - 1 ? h('span', { class: 'chain__arrow' }, icon('chevronRight', 'ico ico--sm')) : null,
            ),
          ),
        ),
        notice(
          `第二数据源当前为只读：${payload.source.tables.join('、')}。跨 Base 写入需要先确认字段映射、重复判定与失败补偿，因此这个页面只做关联展示与缺口定位。`,
          { tone: 'neutral', iconName: 'lock', title: '数据边界' },
        ),
        h(
          'div',
          { class: 'wscols' },
          h(
            'div',
            { class: 'stack-8' },
            region({
              label: '链路缺口',
              title: gapEvents.length ? `${gapEvents.length} 个活动存在缺口` : '链路没有发现缺口',
              description: '报名、签到与时长之间的不一致会在这里被定位，需要人工核对。',
              actions: [reloadAction(chainRegion)],
              body: gapEvents.length
                ? h(
                    'div',
                    { class: 'queue' },
                    ...gapEvents.map((event) =>
                      queueRow({
                        type: '链路缺口',
                        title: event.name,
                        detail: event.gaps.join('；'),
                        priority: event.checkedIn === 0 ? 'high' : 'medium',
                        meta: [
                          badge(`报名 ${event.registrations}`, { tone: 'info' }),
                          badge(`确认 ${event.confirmed}`, { tone: 'neutral' }),
                          badge(`签到 ${event.checkedIn}`, { tone: event.checkedIn ? 'success' : 'error' }),
                        ],
                      }),
                    ),
                  )
                : emptyState({
                    iconName: 'check',
                    title: '报名与签到数据一致',
                    description: '当前没有发现「有报名无签到」或「签到多于报名」的活动。',
                  }),
            }),
            region({
              label: '待核对时长',
              title: payload.hoursQueue.length ? `${payload.hoursQueue.length} 条服务时长待复核` : '没有待核对的服务时长',
              description: '来自「活动及时长汇总表」的只读队列。核对结果需要在 SeaTable 中登记，平台不做跨 Base 写入。',
              body: payload.hoursQueue.length
                ? dataTable({
                    columns: [
                      { key: 'activity', label: '活动', strong: true },
                      { key: 'name', label: '参与者' },
                      { key: 'hours', label: '时长', align: 'right', mono: true },
                      { key: 'status', label: '状态', sortable: false, render: (row) => statusFor(row.status) },
                    ],
                    rows: payload.hoursQueue.map((row, index) => ({ ...row, id: `${row.activity}-${index}` })),
                    getKey: (row) => row.id,
                    searchPlaceholder: '搜索活动或参与者',
                    countLabel: (n) => `${n} 条待核对`,
                  })
                : emptyState({ iconName: 'check', title: '时长已全部核对', description: '新的待核对记录出现时会自动进入这个队列。' }),
            }),
          ),
          h(
            'div',
            { class: 'stack-8' },
            region({
              label: '构成',
              title: '链路完成度',
              dense: true,
              body: donutChart({
                segments: [
                  { label: '已签到', value: payload.stats.checkins, color: 'var(--success)' },
                  { label: '仅报名', value: Math.max(0, payload.stats.registrations - payload.stats.checkins), color: 'var(--warning)' },
                ],
                centerValue: fmt.percent(payload.stats.checkins, payload.stats.registrations, '—'),
                centerLabel: '签到率',
              }),
            }),
            region({
              label: '活动排名',
              title: '报名人数前列的活动',
              dense: true,
              body: rankedBars({
                data: payload.events.slice(0, 8).map((event) => ({
                  label: event.name,
                  value: event.registrations,
                  extra: `签到 ${event.checkedIn}`,
                  color: event.checkedIn ? 'var(--accent)' : 'var(--warning)',
                })),
                formatValue: (value) => `${fmt.int(value)} 人`,
                emptyLabel: '暂无活动报名数据',
              }),
            }),
            region({
              label: '审批队列',
              title: '最近的登记审批',
              dense: true,
              body: payload.approvalQueue.length
                ? h(
                    'div',
                    { class: 'stack-3' },
                    ...payload.approvalQueue.map((item) =>
                      h(
                        'div',
                        { class: 'stack-2 approval-row' },
                        h('div', { class: 'row-2 row-wrap' }, badge(item.type, { tone: 'neutral' }), statusFor(item.status)),
                        h('p', { class: 't-secondary t-strong t-clamp-1', text: item.activity }),
                        h('p', { class: 't-caption', text: `${item.owner} · ${fmt.date(item.date)}` }),
                      ),
                    ),
                  )
                : emptyState({ iconName: 'inbox', title: '没有审批记录', description: '登记审批表暂时没有可展示的记录。' }),
            }),
            region({
              label: '签到',
              title: '最近签到记录',
              dense: true,
              body: payload.recentCheckins.length
                ? h(
                    'div',
                    { class: 'stack-3' },
                    ...payload.recentCheckins.map((item) =>
                      h(
                        'div',
                        { class: 'row-3' },
                        icon('check', 'ico ico--sm'),
                        h('div', { class: 'stack-1 spacer' }, h('span', { class: 't-secondary t-clamp-1', text: item.activity }), h('span', { class: 't-caption', text: `${item.name} · ${fmt.dateTime(item.time)}` })),
                        item.verified ? badge('已核对', { tone: 'success' }) : badge('待核对', { tone: 'warning' }),
                      ),
                    ),
                  )
                : emptyState({ iconName: 'qr', title: '还没有签到记录', description: '活动开始并完成现场签到后会出现在这里。' }),
            }),
            region({
              label: '数据源',
              title: '连接信息',
              dense: true,
              body: definitionList([
                ['Base UUID', payload.source.baseUuid || '未返回'],
                ['访问模式', payload.source.readOnly ? '只读' : '可写'],
                ['已接入表', payload.source.tables.join('、')],
                ['志愿者档案', `${fmt.int(payload.stats.memberProfiles)} 人`],
              ]),
            }),
          ),
        ),
      ];
    },
  });

  const node = h(
    'div',
    { class: 'view wspad wspad--wide' },
    pageHead({
      label: '志愿服务',
      title: '服务记录中台',
      description: '把「登记审批 → 活动报名 → 活动签到 → 时长录入 → 个人档案」这条链路的完成情况放在一个页面里，并定位其中的缺口。',
      meta: [statusIndicator('第二数据源 · 只读', { tone: 'info' })],
      actions: [reloadAction(chainRegion, '刷新数据')],
    }),
    chainRegion,
  );

  return { title: '志愿服务', crumb: '志愿服务', node };
}
