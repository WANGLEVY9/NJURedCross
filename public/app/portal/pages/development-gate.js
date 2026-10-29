import { h, icon } from '../../core/dom.js';
import { getSessionState } from '../../core/api.js';
import { developingPlaza } from '../development-access.js';
import { managedImage } from '../image-source.js';

// Deliberately tab-local presentation state: no request, approval record or
// permission grant is created. Actual opening is controlled by the rollout map.
const submitted = new Set();

export default function page(context) {
  const plaza = developingPlaza(context.path);
  const session = getSessionState();
  const key = `${session.user?.username || session.user?.id || ''}:${plaza.section}`;
  const status = h('div', { class: 'development-gate__status', role: 'status', tabindex: '-1', aria: { live: 'polite', atomic: 'true' } });
  const apply = h('button', { class: 'btn btn--primary', type: 'button', on: { click: () => {
    submitted.add(key);
    renderStatus();
    status.focus({ preventScroll: true });
  } } });
  function renderStatus() {
    const done = session.authenticated && submitted.has(key);
    status.replaceChildren(icon(done ? 'check' : 'lock', 'ico'), h('div', {},
      h('strong', { text: done ? '申请已提交，请等待管理员审批' : session.authenticated ? '此广场需申请权限后查看' : '请先登录后，再申请查看权限' }),
      h('p', { text: done ? '感谢你的耐心等待，我们正在用心准备更多服务。' : '该广场正在开发完善中，暂未向普通用户开放。' })));
    status.dataset.submitted = String(done);
    apply.disabled = done;
    apply.textContent = done ? '已提交申请' : '申请查看权限';
  }
  renderStatus();
  const next = context.path + location.search;
  const node = h('section', { class: 'development-gate', aria: { labelledby: 'development-gate-title' } },
    h('div', { class: 'development-gate__copy' },
      h('div', { class: 'development-gate__brand' }, h('img', { src: '/assets/nju-red-cross-emblem-128.webp', alt: '南京大学红十字会会徽', width: 48, height: 48, decoding: 'async' }), h('span', { text: '南京大学红十字会 · 校园公益服务平台' })),
      h('p', { class: 'development-gate__eyebrow', text: 'NJU RED CROSS · 服务准备中' }),
      h('h1', { id: 'development-gate-title', text: plaza.name }),
      h('p', { class: 'development-gate__motto', text: '把善意，化作行动' }),
      h('p', { class: 'development-gate__description', text: '新的相遇，值得用心准备。\n我们正在完善这里的内容与服务，期待与你见面。' }),
      status,
      h('div', { class: 'development-gate__actions' },
        session.authenticated ? apply : h('a', { class: 'btn btn--primary', href: `/login?next=${encodeURIComponent(next)}`, text: '登录后申请查看权限' }),
        h('a', { class: 'btn btn--ghost', href: '/events', text: '先去活动广场' }))),
    h('figure', { class: 'development-gate__media' },
      managedImage('/assets/events-carousel/activity-02.webp', { alt: '南京大学红十字会成员手持会旗与项目奖牌合影', priority: true, sizes: '(max-width: 760px) 90vw, 50vw' }),
      h('figcaption', {}, h('strong', { text: '让每一份热心，都有去处' }), h('span', { text: '人道 · 博爱 · 奉献' }))));
  return { title: `${plaza.name} · 服务准备中`, node };
}
