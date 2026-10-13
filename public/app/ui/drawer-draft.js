import { confirmAction } from './overlay.js';

function fieldSnapshot(body) {
  return [...body.querySelectorAll('input, textarea, select')].map(control => {
    if (control.type === 'file') {
      return {
        type: 'file',
        files: [...control.files].map(file => ({
          name: file.name,
          size: file.size,
          lastModified: file.lastModified,
        })),
      };
    }

    if (control.tagName === 'SELECT' && control.multiple) {
      return {
        type: 'multiple',
        values: [...control.selectedOptions].map(option => option.value),
      };
    }

    return {
      type: control.type || control.tagName,
      value: control.value,
      checked: ['checkbox', 'radio'].includes(control.type)
        ? control.checked
        : null,
    };
  });
}

export function protectDrawerDraft(
  drawer,
  { readExtraState = () => null, isBusy = () => false } = {},
) {
  const capture = () => JSON.stringify({
    fields: fieldSnapshot(drawer.body),
    extra: readExtraState(),
  });

  let saved = capture();

  drawer.setCloseGuard(async () => {
    if (isBusy()) return false;
    if (capture() === saved) return true;

    const discard = await confirmAction({
      title: '放弃未保存的修改？',
      description: '关闭后，本次填写的内容不会保留。',
      confirmLabel: '放弃修改',
    });

    // Submission may have started while confirmation was open.
    return discard === true && !isBusy();
  });

  return {
    markSaved() {
      saved = capture();
    },
    release() {
      drawer.setCloseGuard(null);
    },
  };
}