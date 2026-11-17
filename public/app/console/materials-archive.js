/* ==========================================================================
   console/materials-archive.js — safe cleanup of old material flows (E9).
   Backup-first, double-confirmed, soft-archive (never deletes rows). Stock
   quantity and borrow settlement are unaffected; only the ledger list hides
   the archived rows until restored.
   ========================================================================== */

import { h } from '../core/dom.js';
import { openDrawer } from '../ui/overlay.js';
import { button, field, notice, runWithLoading } from '../ui/primitives.js';
import { consoleApi } from '../core/api.js';
import { notify } from '../core/toast.js';

const CONFIRM_PHRASE = 'ARCHIVE-MATERIAL-FLOWS';

export function openArchiveDrawer({ onDone } = {}) {
  const beforeField = field({ label: '归档早于', name: 'before', type: 'date', hint: '仅归档「操作时间」早于该日期的未归档流水。' });
  const confirmField = field({ label: '确认口令', name: 'confirm', placeholder: CONFIRM_PHRASE, hint: '输入确认口令以证明操作已二次确认。' });
  const resultSlot = h('div', { aria: { live: 'polite' } });
  const statusSlot = h('div', { aria: { live: 'polite' } });
  const previewButton = button({ label: '预览归档范围', variant: 'secondary', iconName: 'search', onClick: () => preview() });
  const archiveButton = button({ label: '确认归档', variant: 'danger', iconName: 'archive', onClick: () => apply() });
  archiveButton.disabled = true;

  const drawer = openDrawer({
    eyebrow: '安全清理',
    title: '归档旧流水',
    description: '备份先行、二次确认、软归档（不物理删除，可恢复）。',
    width: 540,
    body: [
      notice('归档只隐藏流水列表中的旧记录，库存数量与借用结清状态不受影响。整行快照会先写入「物资流水归档备份表」，任一条失败即中止。', { tone: 'warning', title: '软归档说明' }),
      beforeField,
      previewButton,
      resultSlot,
      confirmField,
      statusSlot,
    ],
    footer: [h('span', { class: 'spacer' }), button({ label: '关闭', variant: 'ghost', onClick: () => drawer.close() }), archiveButton],
  });

  let previewCount = 0;

  async function preview() {
    const before = beforeField.control.value.trim();
    beforeField.setError(null);
    if (!before) { beforeField.setError('请选择归档日期'); return; }
    archiveButton.disabled = true;
    resultSlot.replaceChildren(h('div', { class: 'sk sk--block' }));
    try {
      const payload = await runWithLoading(previewButton, () => consoleApi.materials.archivePreview(before));
      previewCount = payload.count;
      const samples = (payload.samples || []).map((row) => h('div', { class: 'row-3 row-wrap' },
        h('code', { class: 't-caption', text: row.operation }),
        h('span', { class: 't-secondary', text: row.material }),
        h('span', { class: 't-caption t-faint', text: row.date ? String(row.date).slice(0, 10) : '' })));
      resultSlot.replaceChildren(
        h('p', { class: 't-caption', text: previewCount ? `将归档 ${previewCount} 条流水。` : '没有符合条件的流水。' }),
        samples.length ? h('div', { class: 'stack-2' }, h('p', { class: 't-caption t-faint', text: '样例（前 5 条）：' }), ...samples) : null,
      );
      archiveButton.disabled = !previewCount;
    } catch (error) {
      resultSlot.replaceChildren(notice(error.message || '预览失败，请重试。', { tone: 'error' }));
    }
  }

  async function apply() {
    const before = beforeField.control.value.trim();
    const confirm = confirmField.control.value.trim();
    confirmField.setError(null);
    if (confirm !== CONFIRM_PHRASE) { confirmField.setError('确认口令不正确，请核对后输入。'); return; }
    statusSlot.replaceChildren();
    try {
      const payload = await runWithLoading(archiveButton, () => consoleApi.materials.archive(before, confirm));
      notify.success('归档完成', payload.message || `已归档 ${payload.archived} 条流水。`);
      drawer.close();
      onDone?.();
    } catch (error) {
      statusSlot.replaceChildren(notice(error.message || '归档失败，未改动流水状态。', { tone: 'error' }));
    }
  }
}
