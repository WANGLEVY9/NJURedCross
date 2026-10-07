/* ==========================================================================
   portal/blessing-actions.js
   「我写的生日祝福」的删除动作：编辑抽屉与已通过的行内删除共用。
   ========================================================================== */

import { confirmAction } from '../ui/overlay.js';
import { publicApi } from '../core/api.js';
import { notify, reportError } from '../core/toast.js';

/** 二次确认后删除自己的祝福；返回是否删除成功。 */
export async function deleteWrittenBlessing(item, { onChanged } = {}) {
  const ok = await confirmAction({
    title: '删除这条生日祝福？',
    description: item.status === '已通过'
      ? '删除后它会从祝福库撤下，不再参与匹配与投递；已经收到它的同学仍能看到内容。此操作不可撤销。'
      : '删除后不可恢复。',
    confirmLabel: '确认删除',
    tone: 'danger',
  });
  if (!ok) return false;
  try {
    await publicApi.deleteWarmthBlessing(item.id);
    notify.success('已删除', '这条生日祝福已删除。');
    onChanged?.();
    return true;
  } catch (error) {
    reportError(error, '删除失败');
    return false;
  }
}
