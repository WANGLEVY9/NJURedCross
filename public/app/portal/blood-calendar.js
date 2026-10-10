import { bloodSlotState } from './blood-status.js';
import { h, clear, icon } from '../core/dom.js';
import { button, field, checkbox } from '../ui/primitives.js';

export function weekStart(date) {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() - (d.getUTCDay() + 6) % 7);   // UTC 周一作为一周开始
  return d.toISOString().slice(0, 10);
}

export const shiftDay = (date, days) =>
  new Date(Date.parse(`${date}T00:00:00Z`) + days * 86400000).toISOString().slice(0, 10);

export function bloodCalendar(events, registrations, onSelect, initialId = '', state = {}) {
  const today = new Date(Date.now() + 8 * 3600000).toISOString().slice(0, 10);
  const thisWeek = weekStart(today);
  const first = events.find((e) => e.id === initialId)
    || events.find((e) => e.date >= today && e.remaining > 0)
    || events.find((e) => e.date >= today)
    || events[0];
  let week = state.week || weekStart(first?.date || today);
  let day = state.day || first?.date || week;
  let point = state.point || '';
  let selected = initialId;
  let available = Boolean(state.available);

  const grid = h('div', { class: 'blood-calendar__grid' });
  // 中间的「周次范围」按钮：点击触发原生日期选择器，跳转到指定日期所在的那一周。
  // 隐藏的 <input type="date"> 叠加在按钮上，由 showPicker() / focus() 唤起。
  const title = h('strong', { class: 'blood-calendar__title-text' });
  const jumpInput = h('input', {
    type: 'date',
    class: 'blood-calendar__jump-input',
    'aria-label': '跳转到指定日期',
    tabindex: -1,
    value: day,
    on: {
      input: () => {
        const v = jumpInput.value;
        if (!/^\d{4}-\d{2}-\d{2}$/.test(v)) return;
        week = weekStart(v);
        day = v;
        draw();
      },
    },
  });
  const titleBtn = h('button', {
    type: 'button',
    class: 'blood-calendar__title-btn',
    title: '点击跳转到指定日期',
    ariaLabel: '点击跳转到指定日期',
    on: {
      click: (event) => {
        // 点击来自隐藏 input 时，浏览器已自行处理选择器，直接返回避免重复唤起。
        if (event.target === jumpInput) return;
        if (typeof jumpInput.showPicker === 'function') {
          try {
            jumpInput.showPicker();
            return;
          } catch {
            /* showPicker 在某些浏览器需要先 focus，否则降级 */
          }
        }
        jumpInput.focus();
      },
    },
  }, title, icon('chevronDown', 'ico ico--sm blood-calendar__title-icon'), jumpInput);
  const wrapper = h('section', {
    class: 'blood-calendar stack-4',
    'aria-label': '献血车周日历',
  });
  const summary = h('p', {
    class: 'blood-calendar__summary',
    aria: { live: 'polite' },
  });

  const availability = checkbox({
    label: '仅看有名额',
    name: 'available-slots',
    checked: available,
    onChange: (value) => {
      available = value;
      draw();
    },
  });
  const points = [...new Set(events.map((e) => e.location))].sort();
  const filter = field({
    label: '点位',
    value: point,
    options: [{ value: '', label: '全部点位' }, ...points.map((value) => ({ value, label: value }))],
    onInput: () => {
      point = filter.control.value;
      draw();
    },
  });

  const prevBtn = button({
    label: '上周',
    variant: 'secondary',
    title: '上一周',
    ariaLabel: '上一周',
    onClick: () => {
      week = shiftDay(week, -7);
      day = week;
      draw();
    },
  });
  const nextBtn = button({
    label: '下周',
    variant: 'secondary',
    title: '下一周',
    ariaLabel: '下一周',
    onClick: () => {
      week = shiftDay(week, 7);
      day = week;
      draw();
    },
  });
  const todayBtn = button({
    label: '回到本周',
    variant: 'ghost',
    iconAfter: 'pin',
    title: '回到本周',
    ariaLabel: '回到本周',
    onClick: () => {
      if (week === thisWeek && day === today) return;
      week = thisWeek;
      day = today;
      draw();
    },
  });

  function draw() {
    Object.assign(state, { week, day, point, available });
    jumpInput.value = day;
    const onCurrentWeek = week === thisWeek;
    todayBtn.disabled = onCurrentWeek && day === today;
    todayBtn.setAttribute('aria-disabled', String(todayBtn.disabled));
    const weekEvents = events.filter((e) =>
      e.date >= week && e.date <= shiftDay(week, 6) && (!point || e.location === point));
    summary.textContent = `本周 ${weekEvents.length} 个班次 · 剩余 ${
      weekEvents.reduce((sum, e) => sum + Number(e.remaining ?? e.capacity ?? 0), 0)
    } 个名额`;
    title.textContent = `${week.replaceAll('-', '/')} — ${shiftDay(week, 6).slice(5).replace('-', '/')}`;
    clear(grid);
    for (let i = 0; i < 7; i++) {
      const date = shiftDay(week, i);
      const items = events
        .filter((e) =>
          e.date === date && (!point || e.location === point) && (!available || e.remaining > 0))
        .sort((a, b) => a.slot.localeCompare(b.slot) || a.location.localeCompare(b.location));
      const column = h('div', {
        class: 'blood-calendar__day',
        data: { selected: date === day ? 'true' : 'false', today: date === today ? 'true' : 'false' },
      });
      column.append(
        h(
          'button',
          {
            type: 'button',
            class: 'blood-calendar__date',
            aria: { pressed: String(date === day) },
            on: {
              click: () => {
                day = date;
                draw();
              },
            },
          },
          h('span', { text: ['周一', '周二', '周三', '周四', '周五', '周六', '周日'][i] }),
          h('b', { text: date.slice(5).replace('-', '/') }),
        ),
      );
      const slots = h('div', { class: 'blood-calendar__slots' });
      for (const e of items) {
        const status = bloodSlotState(e, registrations);
        const remaining = Number(e.remaining ?? e.capacity);
        slots.append(
          h(
            'button',
            {
              type: 'button',
              class: 'blood-calendar__slot',
              data: {
                state: status.key,
                own: String(Boolean(status.own)),
                active: String(selected === e.id),
                full: String(remaining <= 0),
              },
              aria: {
                pressed: String(selected === e.id),
                label: `${date} ${e.location} ${e.slot}，${status.label}，剩余${remaining}个名额`,
              },
              on: {
                click: () => {
                  selected = e.id;
                  day = date;
                  draw();
                  onSelect(e);
                },
              },
            },
            h(
              'span',
              { class: 'blood-slot-top' },
              h(
                'span',
                { class: 'blood-slot-status' },
                icon(status.icon, 'ico ico--sm'),
                h('span', { text: status.label.replace('我的 · ', '') }),
              ),
              h('span', {
                class: 'blood-slot-capacity',
                text: `${remaining}/${e.capacity}`,
                title: '剩余 / 总名额',
              }),
            ),
            h('strong', { text: e.location }),
            h('strong', { class: 'blood-calendar__time', text: e.slot }),
          ),
        );
      }
      if (!items.length) {
        slots.append(h('p', {
          class: 'blood-calendar__empty',
          text: available ? '暂无可报名班次' : '暂无班次',
        }));
      }
      column.append(slots);
      grid.append(column);
    }
  }

  wrapper.append(
    h(
      'div',
      { class: 'blood-calendar__header' },
      h(
        'div',
        { class: 'row-2 blood-calendar__toolbar' },
        prevBtn,
        titleBtn,
        nextBtn,
        todayBtn,
      ),
      h(
        'div',
        { class: 'row-3 row-wrap blood-calendar__filters' },
        filter,
        availability,
      ),
    ),
    summary,
    h(
      'div',
      { class: 'blood-calendar__legend', 'aria-label': '班次状态说明' },
      ...['available', 'full', 'pending', 'confirmed'].map((key, i) =>
        h(
          'span',
          { data: { state: key } },
          h('i'),
          h('span', { text: ['可报名', '已报满', '我的待审核', '我的报名成功'][i] }),
        ),
      ),
    ),
    grid,
  );

  // 绑定键盘快捷键：← 上一周、→ 下一周、T 回到本周。
  // 仅在焦点不在可编辑控件内时生效，避免影响输入。
  const onKey = (event) => {
    if (event.altKey || event.ctrlKey || event.metaKey) return;
    const target = event.target;
    if (target instanceof Element) {
      const tag = target.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || target.isContentEditable) return;
    }
    if (event.key === 'ArrowLeft') {
      event.preventDefault();
      week = shiftDay(week, -7);
      day = week;
      draw();
    } else if (event.key === 'ArrowRight') {
      event.preventDefault();
      week = shiftDay(week, 7);
      day = week;
      draw();
    } else if (event.key === 't' || event.key === 'T') {
      if (week === thisWeek && day === today) return;
      event.preventDefault();
      week = thisWeek;
      day = today;
      draw();
    }
  };
  wrapper.addEventListener('keydown', onKey);

  draw();
  return wrapper;
}