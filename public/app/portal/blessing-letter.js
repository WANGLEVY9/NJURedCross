/* ==========================================================================
   portal/blessing-letter.js
   共享「祝福信件」渲染与详情弹窗：
     · 会员中心「我写的生日祝福」预览 /「我收到的生日祝福」详情
     · 生日当天打开的祝福弹窗
   ========================================================================== */

import { h } from '../core/dom.js';
import { openModal } from '../ui/overlay.js';
import { button, definitionList } from '../ui/primitives.js';
import * as fmt from '../core/format.js';

export function renderBlessingLetter({ content = '', nickname = '', submittedAt = null, seal = '' } = {}) {
  return h(
    'div',
    { class: 'warmth-letter' },
    seal ? h('span', { class: 'warmth-letter__seal', text: seal }) : null,
    h('p', { class: 'blessing-preview__content', text: content }),
    h(
      'p',
      { class: 'warmth-letter__signature' },
      h('b', { text: nickname || '匿名' }),
      h('span', { text: submittedAt ? fmt.fullDateTime(submittedAt) : '' }),
    ),
  );
}

export function openBlessingLetterModal({ title = '生日祝福', content, nickname, submittedAt, seal = '', rows = [] } = {}) {
  let modal;
  modal = openModal({
    title,
    width: 680,
    body: [
      renderBlessingLetter({ content, nickname, submittedAt, seal }),
      rows.length ? definitionList(rows) : null,
    ].filter(Boolean),
    footer: [h('span', { class: 'spacer' }), button({ label: '关闭', variant: 'ghost', onClick: () => modal.close() })],
  });
  return modal;
}
