import { h } from '../core/dom.js';
import { button, notice } from '../ui/primitives.js';
import { openDrawer } from '../ui/overlay.js';
import { initialReviewEditor } from './reimbursement-initial-editor.js';
import { reimbursementsApi as api } from '../shared/reimbursements-api.js';

export function editFinanceRequest(request, { onDone = async () => {} } = {}) {
  const editor = initialReviewEditor(request, { mode: 'final' });
  const feedback = h('div', { role: 'alert' });
  let busy = false;
  const save = button({ label: '保存申请修改', variant: 'primary', onClick: async () => {
    if (busy) return;
    const changes = editor.read(); if (!changes) return;
    busy = true; save.disabled = true; editor.setDisabled(true); feedback.replaceChildren();
    try {
      await api.editRequest(request.id, { revision: request.revision, stateVersion: request.stateVersion, changes });
      await drawer.close(); await onDone();
    } catch (error) { feedback.replaceChildren(notice(error.message, { tone: 'error' })); }
    finally { busy = false; save.disabled = false; editor.setDisabled(false); }
  } });
  const drawer = openDrawer({ title: '终审修改申请信息', width: 780, body: [editor.node, feedback], footer: [save], onClose: () => editor.dispose() });
  return drawer;
}
