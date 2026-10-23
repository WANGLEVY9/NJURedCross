import { h, icon } from '../core/dom.js';
import { button, definitionList } from '../ui/primitives.js';
import { workflowEventPath } from './workflow-links.js';
import { timeSlot } from '../core/format.js';

/** Time and place lead; role and server-provided capacity remain secondary. */
export function selectedSession(event) {
  return h('section', { class: 'workflow-slot-summary', 'aria-label': '确认所选班次' },
    h('div', { class: 'booking-appointment' },
      h('span', { class: 'booking-appointment__date', 'aria-hidden': 'true' },
        h('strong', { text: event.date?.slice(8) || '—' }), h('span', { text: `${event.date?.slice(5,7) || '—'}月` })),
      h('div', { class: 'booking-appointment__copy' },
        h('p', { class: 'booking-appointment__label', text: '当前班次' }),
        h('h3', { text: `${event.date} ${timeSlot(event.slot)}` }),
        h('p', { class: 'booking-appointment__place' }, icon('pin'), h('span', { text: event.location })))),
    h('dl', { class: 'booking-appointment__meta' },
      h('div', {}, h('dt', { text: '服务岗位' }), h('dd', { text: event.position || '待公布' })),
      h('div', {}, h('dt', { text: '报名名额' }), h('dd', { text: event.quotaMode === 'review' ? `推荐录取 ${event.capacity} 人` : `剩余 ${event.remaining ?? event.capacity} / ${event.capacity} 人` }))));
}

export function focusSessionChoices() {
  const target = document.querySelector('.ordinary-sessions [role="radio"][aria-checked="true"], .blood-calendar__date[aria-pressed="true"], .blood-signup-controls input, .blood-detail-submit a');
  target?.focus({ preventScroll: true });
  target?.scrollIntoView({ block: 'center', behavior: 'instant' });
}

/** Only carry local edits into controls still permitted by the new server state. */
export function preserveParticipation(previous, next) {
  if (!previous) return next;
  const active = document.activeElement;
  for (const oldCard of previous.querySelectorAll('[data-registration-code]')) {
    const card = [...next.querySelectorAll('[data-registration-code]')].find(node => node.dataset.registrationCode === oldCard.dataset.registrationCode);
    if (!card) continue;
    for (const oldAction of oldCard.querySelectorAll('details')) {
      const action = [...card.querySelectorAll('details')].find(node => node.dataset.action === oldAction.dataset.action);
      if (!action) continue;
      action.open = oldAction.open;
      for (const oldInput of oldAction.querySelectorAll('textarea,input')) {
        const input = action.querySelector(oldInput.tagName.toLowerCase());
        if (!input) continue;
        if (oldInput.type === 'file') input.files = oldInput.files;
        else input.value = oldInput.value;
        if (oldInput === active) requestAnimationFrame(() => { if (input.isConnected) { input.focus({preventScroll:true}); if(input.type !== 'file') input.setSelectionRange(oldInput.selectionStart,oldInput.selectionEnd); } });
      }
      if (oldAction.querySelector('summary') === active) requestAnimationFrame(() => { if(action.isConnected) action.querySelector('summary').focus({preventScroll:true}); });
    }
  }
  return next;
}

export function participantIdentity(person) {
  return h('div', { class: 'booking-identity' },
    h('div', { class: 'booking-identity__heading' },
      h('span', { class: 'booking-identity__seal', 'aria-hidden': 'true' }, icon('user')),
      h('div', {}, h('span', { class: 'booking-identity__caption', text: '参与者' }),
        h('strong', { text: person.realName || '暂未获取' }))),
    definitionList([
      ['学号', person.studentId || '—'], ['邮箱', person.email || '暂未获取'],
      ['所属校区', person.campus || '待完善'], ['院系', person.department || '—'], ['年级', person.grade || '—'],
    ]), h('a', { class: 'booking-identity__edit', href: '/me', text: '在会员中心修改资料' }));
}

export function wishCollection(events, items, cancelControl) {
  return h('section', { class: 'booking-wishes', 'aria-label': '我的心愿清单' },
    h('header', { class: 'booking-wishes__heading' },
      h('span', { class: 'booking-wishes__stamp', 'aria-hidden': 'true' }, icon('heart')),
      h('div', {}, h('h2', { text: '我的心愿清单' }),
        h('p', { text: '空位出现时，让邮件捎来消息。提醒不预留名额。' })),
      items.length ? h('span', { class: 'booking-wishes__count', text: `${items.length} 个心愿` }) : null),
    items.length ? h('div', { class: 'booking-wishes__list' }, ...items.map(item => {
      const event = events.find(e => e.id === item.eventId);
      return h('article', { class: 'blood-wish-row' },
        h('span', { class: 'booking-wishes__bookmark', 'aria-hidden': 'true' }, icon('heart', 'ico ico--sm')),
        h('div', { class: 'booking-wishes__copy' },
          h('span', { class: 'booking-wishes__caption' }, icon('mail', 'ico ico--sm'), '空位邮件提醒'),
          h('h3', { text: event?.name || '已关注班次' }),
          event ? definitionList([['日期', `${event.date} ${event.slot}`], ['地点', event.location || '待公布']])
            : h('p', { text: '班次暂未开放，可取消提醒。' })),
        h('div', { class: 'booking-wishes__actions' },
          event ? button({ label: '查看班次', size: 'sm', variant: 'secondary', href: workflowEventPath(event) }) : null,
          cancelControl(item)));
    })) : h('div', { class: 'booking-wishes__empty' },
      h('span', { class: 'booking-wishes__letter', 'aria-hidden': 'true' }, icon('mail')),
      h('div', {}, h('h3', { text: '留一个心愿，等一次相遇' }),
        h('p', { text: '遇到已满的班次，点击“加入心愿清单”，有空位时我们会通过邮件提醒你。' }),
        button({label:'返回班次选择',variant:'ghost',iconName:'calendar',onClick:focusSessionChoices}))));
}
