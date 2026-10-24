import { h } from '../core/dom.js';
import { confirmAction } from '../ui/overlay.js';
import { button } from '../ui/primitives.js';
import { notify, reportError } from '../core/toast.js';

export function batchApprovalControls({
  rows,
  selectedIds,
  label,
  unit = '条',
  confirmationDescription = '审核通过后会按当前流程生效。',
  onApprove,
  onDone,
}) {
  const eligible = rows.filter(row => row.status === '待审核');
  const eligibleIds = new Set(eligible.map(row => row.id));
  for (const id of selectedIds) if (!eligibleIds.has(id)) selectedIds.delete(id);
  const inputs = [];
  const selectedLabel = h('span', { class: 't-caption', aria: { live: 'polite' } });
  let busy = false;
  const selectAllButton = button({
    label: '全选待审核',
    variant: 'secondary',
    onClick: () => {
      if (selectedIds.size > 0) selectedIds.clear();
      else for (const row of eligible) selectedIds.add(row.id);
      for (const item of inputs) item.input.checked = selectedIds.has(item.id);
      sync();
    },
  });
  const approveButton = button({
    label: '通过所选（0）',
    variant: 'primary',
    iconName: 'check',
    onClick: approveSelected,
  });
  const sync = () => {
    selectedLabel.textContent = `已选择 ${selectedIds.size} ${unit}`;
    const approveLabel = approveButton.querySelector('span');
    if (approveLabel) approveLabel.textContent = `通过所选（${selectedIds.size}）`;
    const selectionLabel = selectAllButton.querySelector('span');
    if (selectionLabel) selectionLabel.textContent = selectedIds.size > 0 ? '取消已选' : '全选待审核';
    approveButton.disabled = busy || selectedIds.size === 0;
    selectAllButton.disabled = busy || eligible.length === 0;
  };
  sync();

  async function approveSelected() {
    const selected = eligible.filter(row => selectedIds.has(row.id));
    if (!selected.length || busy) return;
    const confirmed = await confirmAction({
      title: `批量通过选中的${label}？`,
      description: confirmationDescription,
      confirmLabel: '全部通过',
      details: selected.map(row => `${row.nickname || row.realName || row.id} · ${row.id}`),
    });
    if (!confirmed) return;
    busy = true;
    sync();
    const succeeded = [];
    const failed = [];
    for (const row of selected) {
      try {
        await onApprove(row);
        succeeded.push(row.id);
      } catch {
        failed.push(row.id);
      }
    }
    for (const id of succeeded) selectedIds.delete(id);
    busy = false;
    sync();
    if (failed.length) notify.warning('批量审核部分完成', `${succeeded.length} 条通过，${failed.length} 条失败并保留选择。`);
    else notify.success('批量审核完成', `${succeeded.length} 条已通过。`);
    try {
      await onDone();
    } catch (error) {
      reportError(error, '审核已处理，列表刷新失败');
    }
  }

  return {
    toolbar: h('div', { class: 'row-3 row-wrap community-review-toolbar' }, selectedLabel, selectAllButton, approveButton),
    selectionCell(row) {
      const input = h('input', {
        type: 'checkbox',
        checked: selectedIds.has(row.id),
        disabled: row.status !== '待审核' || busy,
        aria: { label: `选择${label} ${row.nickname || row.realName || row.id}` },
      });
      input.addEventListener('click', event => event.stopPropagation());
      input.addEventListener('keydown', event => {
        if (event.key === 'Enter') event.stopPropagation();
      });
      input.addEventListener('change', () => {
        if (input.checked) selectedIds.add(row.id);
        else selectedIds.delete(row.id);
        sync();
      });
      inputs.push({ id: row.id, input });
      const cell = h('label', { class: 'community-review-select-cell' }, input);
      cell.addEventListener('click', event => event.stopPropagation());
      return cell;
    },
  };
}
