/* ==========================================================================
   console/pages/showcase.js — 宣传展示维护（v3 S7 / N2 / D12）

   把原来「本地 .exe 脚本抓公众号」的流程搬到网页端：
     1. 粘贴若干条公众号文章链接（每行一条）
     2. 选展示分类（活动总结 / 暑期专项 / 新闻）
     3. 一键「提取并导入」→ 抓标题 + 封面（可选正文图）→ 上传 Box → 落展示表
        · 逐条回显：成功 / 失败 / 已存在跳过，失败绝不静默
     4. 下方列表管理：改栏目 / 排序 / 上下架 / 删除条目（不删 Box 文件）
   ========================================================================== */

import { h, icon, clear } from '../../core/dom.js';
import { consoleApi, ApiError } from '../../core/api.js';
import { shake } from '../../core/motion.js';
import { openDrawer } from '../../ui/overlay.js';
import { dataTable } from '../../ui/table.js';
import { asyncRegion, region, reloadAction } from '../lib.js';
import {
  pageHead, metric, metricRow, badge, button, field, checkbox, notice,
  emptyState, chip, skeletonMetrics, skeletonRows, skeletonLine, definitionList,
  copyableCode, runWithLoading,
} from '../../ui/primitives.js';
import { notify, reportError } from '../../core/toast.js';
import * as fmt from '../../core/format.js';

// 与后端 SHOWCASE_GROUPS 一致：直接用公众号 11 栏目（与投稿「推文栏目」同一份字典）。
const CATEGORY_FALLBACK = ['小红帮推', '活动预热', '活动总结', '健康小蓝鲸', '今日节日', '心灵慢车',
  '南男女侣', '红会新闻', '南小红月报', '人道法言', '红会招新'];

/* --------------------------------------------------------------------------
   导入面板：链接 textarea + 栏目选择 + 正文图开关 + 逐条结果
   -------------------------------------------------------------------------- */
function importPanel({ categories, onDone }) {
  let category = categories[0] || '活动总结';

  const linksField = field({
    label: '公众号文章链接',
    name: 'links',
    multiline: true,
    rows: 6,
    placeholder: '每行一条，例如：\nhttps://mp.weixin.qq.com/s/xxxxxxxx\nhttps://mp.weixin.qq.com/s/yyyyyyyy',
    hint: '单次最多 30 条。支持任意 http(s) 文章页，会自动抓取标题与封面图。',
  });

  const categoryChips = h('div', { class: 'chip-row' });
  function renderChips() {
    clear(categoryChips);
    for (const option of categories) {
      categoryChips.append(chip(option, {
        selected: option === category,
        onClick: () => { category = option; renderChips(); },
      }));
    }
  }
  renderChips();

  const bodyImages = checkbox({
    name: 'withBodyImages',
    label: '同时抓取正文全文图',
    description: '打开后会把正文里的图片一并下载到「宣传展示 / 栏目 / 标题」子目录。图片多时耗时更长，失败不影响条目本身。',
  });

  const resultSlot = h('div', { class: 'stack-3' });

  function countLinks() {
    return String(linksField.control.value || '')
      .split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  }

  const submitButton = button({
    label: '提取并导入', variant: 'primary', iconName: 'download', onClick: () => submit(),
  });

  const node = region({
    label: '半自动导入',
    title: '粘贴链接 → 一键提取入库',
    description: '封面与标题自动抓取并上传到 NJU Box；重复内容按「标题 + 链接」自动跳过，不会产生重复行。',
    body: h('div', { class: 'stack-4' },
      linksField,
      h('div', { class: 'field' },
        h('p', { class: 'field__label', text: '展示分类（决定展示墙分节）' }),
        categoryChips),
      bodyImages,
      h('div', { class: 'row-3 row-wrap' }, submitButton, h('span', { class: 'spacer' })),
      resultSlot,
      manualPanel()),
  });

  /* 手动补全：生产服务器在境外，微信对机房 IP 只回「环境异常」占位页，
     抓取必然失败；但图床可从境外下载，所以允许手填标题 + 封面图地址。 */
  function manualPanel() {
    let open = false;
    const linkField = field({ label: '文章链接', name: 'manual-link', placeholder: 'https://mp.weixin.qq.com/s/...', required: true });
    const titleField = field({ label: '文章标题', name: 'manual-title', placeholder: '从公众号页面直接复制标题', maxlength: 120, required: true });
    const coverField = field({
      label: '封面图地址（可留空）', name: 'manual-cover',
      placeholder: 'https://mmbiz.qpic.cn/...',
      hint: '在微信里长按封面图 → 复制图片地址；服务器能把这张图下载并存到云盘。',
    });
    const body = h('div', { class: 'stack-4' }, linkField, titleField, coverField);
    body.hidden = true;
    const toggle = button({
      label: '抓不到？手动补一条', variant: 'ghost', iconName: 'edit',
      onClick: () => {
        open = !open;
        body.hidden = !open;
        actionRow.hidden = !open;
        toggle.setAttribute('aria-expanded', String(open));
      },
    });
    const saveButton = button({ label: '手动入库', variant: 'secondary', iconName: 'check', onClick: () => save() });
    const actionRow = h('div', { class: 'row-3 row-wrap' }, saveButton, h('span', { class: 'spacer' }));
    actionRow.hidden = true;

    async function save() {
      linkField.setError(null); titleField.setError(null); coverField.setError(null);
      if (!String(linkField.control.value || '').trim()) { linkField.setError('请填写文章链接'); shake(linkField); return; }
      if (!String(titleField.control.value || '').trim()) { titleField.setError('请填写文章标题'); shake(titleField); return; }
      try {
        const payload = await runWithLoading(saveButton, () => consoleApi.showcase.manual({
          link: linkField.control.value.trim(),
          title: titleField.control.value.trim(),
          coverUrl: coverField.control.value.trim(),
          category,
        }));
        if (payload?.ok === false) {
          notify.warning('没有入库', payload.message || '请检查链接与标题。');
          return;
        }
        notify.success('已入库', payload.message || titleField.control.value.trim());
        linkField.control.value = '';
        titleField.control.value = '';
        coverField.control.value = '';
        onDone?.();
      } catch (error) {
        if (error instanceof ApiError) { notify.warning('没有入库', error.message); return; }
        reportError(error, '手动入库失败');
      }
    }

    return h('div', { class: 'stack-3 manual-fallback' },
      notice('线上抓取公众号常被反爬拦下（服务器在境外，微信只回「环境异常」页）。抓不到时用下面的手动通道：标题 + 封面图地址照样能入库并落到云盘。', { tone: 'info', iconName: 'info' }),
      h('div', { class: 'row-3 row-wrap' }, toggle),
      body,
      actionRow);
  }

  function renderResults(payload) {
    clear(resultSlot);
    const imported = payload.imported || [];
    const failed = payload.failed || [];
    resultSlot.append(
      notice(payload.message || '导入完成。', {
        tone: failed.length ? 'warning' : imported.length ? 'success' : 'neutral',
        iconName: failed.length ? 'alert' : imported.length ? 'check' : 'info',
      }),
      imported.length
        ? h('div', { class: 'stack-2' },
          h('p', { class: 't-label', text: `成功导入（${imported.length}）` }),
          ...imported.map((item) => h('div', { class: 'row-3 row-wrap' },
            badge('成功', { tone: 'success', iconName: 'check' }),
            h('span', { class: 't-body t-strong', text: item.title }),
            h('span', { class: 't-caption t-faint', text: `${item.group || '未分类'}${item.hasCover ? ' · 含封面' : ''}${item.bodyCount ? ` · 正文图 ${item.bodyCount} 张` : ''}` }))))
        : null,
      failed.length
        ? h('div', { class: 'stack-2' },
          h('p', { class: 't-label', text: `失败（${failed.length}）` }),
          ...failed.map((item) => h('div', { class: 'row-3 row-wrap' },
            badge('失败', { tone: 'danger', iconName: 'alert' }),
            h('span', { class: 't-body', text: item.title || item.url || '(未知)' }),
            h('span', { class: 't-caption t-faint', text: item.error || '' }))))
        : null,
      payload.skipped
        ? h('p', { class: 't-caption t-faint', text: `${payload.skipped} 条因重复或缺少标题/链接被跳过。` })
        : null,
    );
  }

  async function submit() {
    linksField.setError(null);
    const links = countLinks();
    if (!links.length) {
      linksField.setError('请至少粘贴一条链接');
      shake(linksField);
      return;
    }
    if (links.length > 30) {
      linksField.setError(`单次最多 30 条（当前 ${links.length} 条）`);
      shake(linksField);
      return;
    }
    try {
      const payload = await runWithLoading(submitButton, () =>
        consoleApi.showcase.extract({ links, category, withBodyImages: bodyImages.control.checked }),
      );
      renderResults(payload);
      if ((payload.imported || []).length) {
        notify.success('导入完成', payload.message);
        linksField.control.value = '';
        onDone?.();
      } else {
        notify.warning('没有新条目被导入', payload.message);
      }
    } catch (error) {
      if (error instanceof ApiError && error.status === 400) {
        linksField.setError(error.message);
        shake(linksField);
        return;
      }
      reportError(error, '导入未完成');
    }
  }

  return node;
}

/* --------------------------------------------------------------------------
   单条编辑抽屉：改栏目 / 排序 / 上下架
   -------------------------------------------------------------------------- */
function openEditDrawer(item, { categories, onDone }) {
  const categoryField = field({
    label: '展示分类', name: 'showGroup', options: categories,
    value: item.showGroup || categories[0] || '活动总结',
  });
  const orderField = field({ label: '排序（越小越靠前）', name: 'order', type: 'number', value: String(item.order ?? 0) });
  const visibleToggle = checkbox({ name: 'visible', label: '在展示墙上显示', checked: !item.hidden });

  const submitButton = button({ label: '保存', variant: 'primary', iconName: 'check', onClick: () => submit() });
  const drawer = openDrawer({
    eyebrow: '展示条目',
    title: item.title,
    description: item.group || '未分类',
    width: 460,
    body: [
      definitionList([
        ['条目编号', copyableCode(item.id)],
        ['来源', item.source || '手动导入'],
        ['链接', item.link ? copyableCode(item.link) : '（无）'],
        ['封面', item.coverPath ? '已上传' : '无封面'],
        ['创建时间', item.createdAt ? fmt.fullDateTime(item.createdAt) : '—'],
      ]),
      h('hr', { class: 'divider' }),
      categoryField,
      orderField,
      visibleToggle,
    ],
    footer: [h('span', { class: 'spacer' }), button({ label: '取消', variant: 'ghost', onClick: () => drawer.close() }), submitButton],
  });

  async function submit() {
    orderField.setError(null);
    const order = Number(orderField.control.value);
    if (!Number.isFinite(order)) {
      orderField.setError('排序必须是数字');
      shake(orderField);
      return;
    }
    try {
      await runWithLoading(submitButton, () =>
        consoleApi.showcase.update(item.id, {
          showGroup: categoryField.control.value,
          order,
          visible: visibleToggle.control.checked,
        }),
      );
      notify.success('已保存', item.title);
      drawer.close();
      onDone?.();
    } catch (error) {
      if (error instanceof ApiError && error.status === 400) {
        orderField.setError(error.message);
        shake(orderField);
        return;
      }
      reportError(error, '保存失败');
    }
  }
}

/* --------------------------------------------------------------------------
   Page
   -------------------------------------------------------------------------- */
export default async function showcasePage(context, shell) {
  const bodySlot = h('div', { class: 'stack-7' });

  const listRegion = asyncRegion({
    lazy: true,
    skeleton: h('div', { class: 'stack-6' }, skeletonMetrics(3), skeletonRows(6)),
    errorTitle: '展示条目无法加载',
    load: () => consoleApi.showcase.items(),
    render: (payload, { reload }) => {
      const items = payload.items || [];
      const categories = payload.categories?.length ? payload.categories : CATEGORY_FALLBACK;
      const libraries = payload.libraries || {};
      const main = libraries.main || libraries.primary || null;
      const ungrouped = items.filter((item) => !item.showGroup).length;

      const removeItem = async (item) => {
        if (!window.confirm(`确定删除展示条目「${item.title}」？\n\n只删除列表记录，Box 里的封面文件仍会保留。`)) return;
        try {
          await consoleApi.showcase.remove(item.id);
          notify.success('已删除', item.title);
          reload();
        } catch (error) {
          if (error instanceof ApiError) notify.warning('删除未生效', error.message);
          else reportError(error, '删除失败');
        }
      };

      const editItem = (item) => openEditDrawer(item, { categories, onDone: reload });

      const rows = items.map((item) => ({
        id: item.id,
        item,
        title: item.title,
        showGroup: item.showGroup || '',
        group: item.group || '',
        source: item.source || '',
        cover: item.coverPath ? '已上传' : '无',
        order: item.order ?? 0,
        createdAt: item.createdAt,
      }));

      const importNode = importPanel({ categories, onDone: reload });

      const listNode = region({
        label: '列表管理',
        title: `展示条目（${items.length}）`,
        description: '改栏目决定展示墙分节；排序越小越靠前；删除条目不会删除 Box 封面文件。',
        actions: [reloadAction(listRegion, '刷新')],
        body: rows.length
          ? dataTable({
            columns: [
              {
                key: 'title', label: '标题', strong: true,
                render: (row) => h('div', { class: 'stack-1' },
                  h('span', { class: 't-secondary t-strong t-clamp-1', text: row.title }),
                  h('span', { class: 't-caption t-faint t-clamp-1', text: row.item.link || '（无链接）' })),
              },
              { key: 'showGroup', label: '展示分类', sortable: false, render: (row) => row.showGroup ? badge(row.showGroup, { tone: 'accent' }) : badge('未分类', { tone: 'warning' }) },
              { key: 'group', label: '原分组' },
              { key: 'source', label: '来源' },
              { key: 'cover', label: '封面', sortable: false, render: (row) => badge(row.cover, { tone: row.cover === '已上传' ? 'success' : 'neutral' }) },
              { key: 'order', label: '排序', align: 'right', value: (row) => row.order },
              { key: 'createdAt', label: '创建时间', sortable: false, render: (row) => h('span', { class: 't-caption', text: row.createdAt ? fmt.date(row.createdAt) : '—' }) },
              {
                key: 'actions', label: '操作', sortable: false, tight: true,
                render: (row) => h('div', { class: 'cell--actions row-2' },
                  button({ label: '编辑', variant: 'secondary', size: 'sm', iconName: 'edit', onClick: () => editItem(row.item) }),
                  button({ label: '删除', variant: 'ghost', size: 'sm', iconName: 'trash', onClick: () => removeItem(row.item) })),
              },
            ],
            rows,
            getKey: (row) => row.id,
            searchPlaceholder: '搜索标题、分类或来源',
            searchKeys: ['title', 'showGroup', 'group'],
            countLabel: (n) => `${n} 条展示条目`,
            onRowClick: (row) => shell.openInspector({
              eyebrow: '展示条目',
              title: row.title,
              subtitle: row.showGroup || '未分类',
              body: [definitionList([
                ['条目编号', copyableCode(row.item.id)],
                ['链接', row.item.link ? copyableCode(row.item.link) : '（无）'],
                ['来源', row.source || '—'],
                ['封面', row.cover],
                ['排序', String(row.order)],
                ['创建时间', row.createdAt ? fmt.fullDateTime(row.createdAt) : '—'],
              ])],
              footer: [button({ label: '编辑', variant: 'primary', size: 'sm', iconName: 'edit', onClick: () => editItem(row.item) })],
            }),
          })
          : emptyState({
            iconName: 'image',
            title: '还没有展示条目',
            description: '在上方粘贴公众号链接，一键提取后条目会出现在这里。',
          }),
      });

      return [
        metricRow([
          metric({ label: '展示条目', value: items.length, unit: '条' }),
          metric({ label: '未分类', value: ungrouped, unit: '条', tone: ungrouped ? 'warn' : '' }),
          metric({ label: 'Box 主库', value: main?.configured ? '已配置' : '未配置', tone: main?.configured ? '' : 'warn', animate: false }),
        ], { columns: 3 }),
        main?.configured === false
          ? notice('NJU Box 主库未配置，导入时无法上传封面（条目仍会写入，但不含封面）。请在服务器 .env 补齐 NJUBOX_MAIN_TOKEN。', { tone: 'warning', iconName: 'alert' })
          : null,
        importNode,
        h('hr', { class: 'divider' }),
        listNode,
      ].filter(Boolean);
    },
  });

  clear(bodySlot);
  bodySlot.append(listRegion);
  listRegion.ensureLoaded();

  return {
    title: '宣传展示',
    crumb: '宣传中心 · 宣传展示',
    node: h(
      'div',
      { class: 'view wspad wspad--wide' },
      pageHead({
        label: '宣传中心',
        title: '宣传展示维护',
        description: '把公众号文章半自动收进展示墙：粘链接 → 抓封面与正文图 → 落库；再对条目做分类、排序与上下架。',
        actions: [button({ label: '公众端展示墙', variant: 'ghost', iconAfter: 'external', href: '/showcase', data: { native: 'true' } })],
      }),
      bodySlot,
    ),
  };
}
