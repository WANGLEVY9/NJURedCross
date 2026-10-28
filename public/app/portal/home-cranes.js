import { h } from '../core/dom.js';
import { getSessionState, publicApi } from '../core/api.js';
import { openDrawer } from '../ui/overlay.js';
import { button } from '../ui/primitives.js';
import { navigate } from '../core/router.js';

// Folded polygons share an outline, with separate facets rather than an icon font.
export function craneArt() {
  return h('svg', { viewBox: '0 0 160 120', aria: { hidden: 'true' } },
    h('polygon', { class: 'crane__wing-back', points: '77,72 49,8 57,78 82,98' }),
    h('polygon', { class: 'crane__wing', points: '80,88 9,33 58,99 83,108' }),
    h('polygon', { class: 'crane__wing-light', points: '80,88 142,15 106,96 83,108' }),
    h('polygon', { class: 'crane__body', points: '58,99 80,66 106,96 83,108' }),
    h('polygon', { class: 'crane__neck', points: '96,93 127,64 145,65 132,70 107,100 83,108' }),
    h('path', { class: 'crane__fold', d: 'M80 66 83 108 58 99M83 108 142 15M9 33 80 88' }));
}

export function homeCranes() {
  let disposed = false, drawer = null;
  const hint = h('p', { class: 'home-cranes__hint', text: '轻触纸鹤，读一份温暖；写下寄语，让善意继续飞。', role: 'status' });
  const field = h('div', { class: 'home-cranes__sky', aria: { label: '纸鹤寄语，悬停、聚焦或轻触纸鹤阅读' } });
  const write = button({ label: '写下寄语', variant: 'secondary', onClick: openComposer });
  const node = h('section', { class: 'home-cranes', aria: { labelledby: 'home-cranes-title' } },
    h('div', { class: 'home-cranes__head' }, h('div', null, h('h1', { id: 'home-cranes-title', text: '让善意，乘风而行' }), h('p', { text: '把想说的话，折进一只纸鹤。' })), write), field, hint);
  function openComposer() {
    if (!getSessionState().authenticated) { navigate('/login?next=%2F'); return; }
    const content = h('textarea', { id: 'crane-content', name: 'content', maxlength: '200', required: true, rows: '5', placeholder: '写下你对红会的寄语，或一次志愿行动中的感想……' });
    const author = h('input', { id: 'crane-author', name: 'author', maxlength: '20', placeholder: '可留空，匿名展示', autocomplete: 'off' });
    const consent = h('input', { type: 'checkbox', required: true });
    const status = h('p', { role: 'status', class: 't-secondary' });
    const count = h('span', { class: 't-caption', text: '0 / 200' });
    content.addEventListener('input', () => { count.textContent = `${content.value.length} / 200`; });
    const submit = h('button', { type: 'submit', class: 'btn btn--primary', text: '折成纸鹤，送出善意' });
    const form = h('form', { class: 'home-crane-form', on: { submit: async event => {
      event.preventDefault();
      if (!form.reportValidity() || submit.disabled) return;
      submit.disabled = true;
      status.textContent = '正在提交寄语……';
      try {
        const result = await publicApi.submitCraneMessage({ content: content.value.trim(), author: author.value.trim(), consent: consent.checked });
        if (disposed) return;
        // 寄语需先经审核，提交后不立即进入首页纸鹤列表。
        form.replaceChildren(h('h3', { text: '寄语已提交' }), h('p', { role: 'status', text: result.message || '您的寄言已提交，正在审核中，审核通过后将在主页进行展示。' }), button({ label: '完成', variant: 'primary', onClick: () => drawer?.close() }));
      } catch (error) { status.textContent = error.message || '寄语暂未送出，请稍后再试。'; submit.disabled = false; }
    } } },
    h('label', { for: 'crane-content', text: '你的寄语' }), content, count,
    h('label', { for: 'crane-author', text: '署名（选填）' }), author,
    h('label', { class: 'home-crane-form__consent' }, consent, h('span', { text: '我同意寄语与署名在审核通过后于首页公开展示，请勿填写手机号等个人资料。' })), status, submit);
    drawer = openDrawer({ title: '把善意折进纸鹤', description: '每一份真诚的心意，都值得被看见。寄语经审核后，会化作首页的一只纸鹤。', body: form, width: 480 });
  }
  function update(items) {
    if (disposed) return;
    const messages = items.slice(0, 12);
    const cranes = Array.from({ length: 12 }, (_, i) => {
      const message = messages[i];
      if (!message) return h('div', { class: `home-crane home-crane--${i} home-crane--decoration`, aria: { hidden: 'true' } }, craneArt());
      const noteId = `crane-note-${i}`;
      const note = h('span', { id: noteId, class: 'home-crane__note' }, h('span', { text: message.content }), h('small', { text: `—— ${message.author || '一位南大志愿者'}` }));
      const trigger = h('button', { type: 'button', class: 'home-crane__trigger', aria: { label: `展开${message.author || '志愿者'}的寄语`, expanded: 'false', controls: noteId, describedby: noteId }, on: {
        click: () => { trigger.setAttribute('aria-expanded', 'true'); wrapper.classList.add('is-open'); },
        focus: () => trigger.setAttribute('aria-expanded', 'true'),
        keydown: event => { if (event.key === 'Escape') { wrapper.classList.remove('is-open'); trigger.setAttribute('aria-expanded', 'false'); trigger.blur(); } },
        blur: () => { wrapper.classList.remove('is-open'); trigger.setAttribute('aria-expanded', 'false'); },
      } }, craneArt());
      const wrapper = h('div', { class: `home-crane home-crane--${i}`, on: {
        mouseenter: () => trigger.setAttribute('aria-expanded', 'true'),
        mouseleave: () => { if (!wrapper.contains(document.activeElement) && !wrapper.classList.contains('is-open')) trigger.setAttribute('aria-expanded', 'false'); },
      } }, trigger, note);
      return wrapper;
    });
    field.replaceChildren(...cranes);
    hint.textContent = messages.length ? '轻触纸鹤，读一份温暖；写下寄语，让善意继续飞。' : '第一份善意，等你写下。寄语经审核通过后，就会化作这里的一只纸鹤。';
  }
  update([]);
  publicApi.craneMessages().then(payload => update(payload.items || [])).catch(() => { if (!disposed) hint.textContent = '寄语暂未加载，你仍可以写下自己的心意。'; });
  return { node, dispose() { disposed = true; drawer?.close(); } };
}
