import { h, icon } from '../core/dom.js';
import { button, definitionList } from '../ui/primitives.js';
import { workflowEventPath } from './workflow-links.js';

export function participantIdentity(person) {
  return h('div', { class: 'booking-identity' },
    h('div', { class: 'booking-identity__heading' },
      h('span', { class: 'booking-identity__seal', 'aria-hidden': 'true' }, icon('user')),
      h('div', {}, h('span', { class: 'booking-identity__caption', text: '参与者' }),
        h('strong', { text: person.realName || '暂未获取' }))),
    definitionList([
      ['学号', person.studentId || '—'], ['邮箱', person.email || '暂未获取'],
      ['所属校区', person.campus || '待完善'], ['院系', person.department || '—'], ['年级', person.grade || '—'],
    ]));
}

export function wishCollection(events, items, cancelControl) {
  return h('section', { class: 'booking-wishes', 'aria-label': '我的心愿清单' },
    h('header', { class: 'booking-wishes__heading' },
      h('span', { class: 'booking-wishes__stamp', 'aria-hidden': 'true' }, icon('heart')),
      h('div', {}, h('h2', { text: '我的心愿清单' }),
        h('p', { text: '把想参与的班次留在这里，空位出现时，让邮件捎来消息。' })),
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
        h('p', { text: '遇到已满的班次，点击“加入心愿清单”，有空位时我们会通过邮件提醒你。' }))));
}
