/* ==========================================================================
   console/pages/messages.js — 红会留言墙。
   Question it answers: "which words are on the wall right now, and is each
   one attributed?" A masonry wall of attributed messages, edited in a drawer.
   ========================================================================== */

import { h, icon } from '../../core/dom.js';
import { request } from '../../core/api.js';
import { pageHead, button, field, segmented, badge, emptyState, notice, runWithLoading } from '../../ui/primitives.js';
import { openDrawer, confirmAction } from '../../ui/overlay.js';
import { reportError, notify } from '../../core/toast.js';
import { asyncRegion } from '../lib.js';

const root = '/api/community/messages';
const STATUS_ICON = { 已发布: 'check', 草稿: 'edit', 已下架: 'arrowDown' };
const STATUS_TONE = { 已发布: 'success', 草稿: 'warning', 已下架: 'neutral' };

export default async function messagesPage() {
  let filter = '已发布';
  let items = [];
  let ready = false;

  const wall = h('div', { class: 'message-wall' });
  const empty = h('div', { class: 'message-wall__empty' });
  const create = button({ label: '新增留言', iconName: 'plus', onClick: () => edit() });
  create.disabled = true;

  const tabs = segmented({
    items: ['已发布', '草稿', '已下架', '全部'].map(value => ({ value, label: value })),
    value: filter,
    ariaLabel: '留言状态',
    onChange: value => { filter = value; tabs.setValue(value); draw(); },
  });

  const summary = h('span', { class: 't-caption', attrs: { role: 'status', 'aria-live': 'polite', 'aria-atomic': 'true' } });

  const view = asyncRegion({
    errorTitle: '留言墙暂时无法加载',
    load: () => request(root),
    render: data => {
      items = data.items;
      ready = data.ready;
      create.disabled = !ready;
      draw();
      return h('div', { class: 'stack-6' },
        !ready ? notice('留言墙数据表尚未配置，暂时无法保存内容。', { tone: 'warning' }) : null,
        h('div', { class: 'console-section-tabs row-3 row-wrap' },
          tabs, h('span', { class: 'spacer' }), summary,
          button({ label: '刷新', variant: 'secondary', iconName: 'refresh', onClick: () => view.reload() })),
        wall, empty);
    },
  });

  function draw() {
    const shown = items.filter(item => filter === '全部' || item.status === filter);
    summary.textContent = `${items.filter(item => item.status === '已发布').length} 条已发布 · 共 ${items.length} 条留言 · 当前显示 ${shown.length} 条`;
    wall.hidden = shown.length === 0;
    empty.hidden = shown.length > 0;
    if (!shown.length) {
      empty.replaceChildren(emptyState({
        iconName: 'quote',
        title: filter === '全部' ? '还没有留言' : `暂无${filter}留言`,
        description: '整理真实的红会故事与寄语，注明署名和来源后发布到留言墙。',
      }));
      return;
    }
    // DOM order stays the source order so keyboard and screen-reader order
    // match the reading order; only the visual flow fills columns.
    wall.replaceChildren(...shown.map(card));
  }

  function card(item) {
    return h('article', { class: 'message-wall__item', data: { status: item.status } },
      h('header', { class: 'message-wall__head' },
        badge(item.status, { tone: STATUS_TONE[item.status] || 'neutral', iconName: STATUS_ICON[item.status] }),
        icon('quote', 'message-wall__mark')),
      h('blockquote', { class: 'message-wall__content', text: item.content }),
      h('footer', { class: 'message-wall__footer' },
        h('div', { class: 'stack-1' },
          h('b', { class: 'message-wall__author', text: item.author }),
          h('p', { class: 't-caption', text: item.source || '未填写来源' })),
        h('div', { class: 'row-2' },
          button({ label: '编辑', variant: 'secondary', size: 'sm', onClick: () => edit(item) }),
          button({ label: item.status === '已发布' ? '下架' : '发布', variant: 'secondary', size: 'sm', onClick: () => setStatus(item) }))));
  }

  function edit(item = {}) {
    const content = field({ label: '留言内容', multiline: true, rows: 5, maxlength: 1000, value: item.content || '', required: true, placeholder: '填写真实留言，最多 1000 字' });
    const author = field({ label: '署名', value: item.author || '', required: true });
    const source = field({ label: '来源', value: item.source || '', placeholder: '活动、日期或出处（选填）' });
    let drawer;
    const save = button({
      label: item.id ? '保存修改为草稿' : '保存草稿',
      onClick: async () => {
        try {
          await runWithLoading(save, () => request(item.id ? `${root}/${item.id}` : root, {
            method: item.id ? 'PATCH' : 'POST',
            body: { content: content.control.value, author: author.control.value, source: source.control.value, status: '草稿' },
          }));
          drawer.close();
          notify.success('留言已保存');
          filter = '草稿';
          tabs.setValue(filter);
          await view.reload();
        } catch (error) {
          reportError(error, '留言未保存');
        }
      },
    });
    drawer = openDrawer({
      eyebrow: '红会留言墙',
      title: item.id ? '编辑留言' : '新增留言',
      body: [notice('修改后保存为草稿，确认内容后再发布。', { tone: 'neutral' }), content, author, source],
      footer: [save],
    });
  }

  async function setStatus(item) {
    const status = item.status === '已发布' ? '已下架' : '已发布';
    const publishing = status === '已发布';
    if (!await confirmAction({
      title: `${publishing ? '发布' : '下架'}这条留言？`,
      description: publishing ? '发布后显示在管理端留言墙。' : '下架后移出已发布视图，内容仍会保留。',
      confirmLabel: publishing ? '发布' : '下架',
    })) return;
    try {
      await request(`${root}/${item.id}`, { method: 'PATCH', body: { ...item, status } });
      notify.success(publishing ? '留言已发布' : '留言已下架');
      await view.reload();
    } catch (error) {
      reportError(error, '状态未更新');
    }
  }

  return {
    title: '红会留言墙',
    crumb: '红会留言墙',
    node: h('div', { class: 'view wspad wspad--wide stack-6' },
      pageHead({
        title: '红会留言墙',
        description: '留住值得记住的话，让每一段寄语有署名、有出处。',
        actions: [create],
      }),
      view),
  };
}
