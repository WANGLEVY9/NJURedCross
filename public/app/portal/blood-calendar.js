import { bloodSlotState } from './blood-status.js';
import { h, clear, icon } from '../core/dom.js';
import { button, field, checkbox, iconButton } from '../ui/primitives.js';
import { openModal } from '../ui/overlay.js';

const WEEKDAYS_CN = ['一', '二', '三', '四', '五', '六', '日'];

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
  // 中间的「周次范围」按钮：点击唤起自定义月历面板，跳转到指定日期所在的那一周。
  const title = h('strong', { class: 'blood-calendar__title-text' });
  const titleBtn = h('button', {
    type: 'button',
    class: 'blood-calendar__title-btn',
    title: '点击跳转到指定日期',
    ariaLabel: '点击跳转到指定日期',
    on: {
      click: () => openJumpPanel(),
    },
  }, title, icon('chevronDown', 'ico ico--sm blood-calendar__title-icon'));
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

  /* --------------------------------------------------------------------------
     周次选择面板：点击中间的日期按钮后唤出，6 周 × 7 列的月历。
     每天都是独立的小方格；选中某天后自动跳转并关闭面板。
     -------------------------------------------------------------------------- */
  function openJumpPanel() {
    let viewYear = Number(day.slice(0, 4));
    let viewMonth = Number(day.slice(5, 7)) - 1;     // 0-based

    const panelBody = h('div', { class: 'blood-jump-panel' });
    const monthLabel = h('h3', { class: 'blood-jump-panel__title', aria: { live: 'polite' } });
    const prevBtn = iconButton({
      iconName: 'chevronLeft',
      label: '上个月',
      onClick: () => {
        viewMonth -= 1;
        if (viewMonth < 0) { viewMonth = 11; viewYear -= 1; }
        render();
      },
    });
    const nextBtn = iconButton({
      iconName: 'chevronRight',
      label: '下个月',
      onClick: () => {
        viewMonth += 1;
        if (viewMonth > 11) { viewMonth = 0; viewYear += 1; }
        render();
      },
    });
    const controls = h('div', { class: 'blood-jump-panel__controls' }, prevBtn, monthLabel, nextBtn);
    const weekdays = h('div', { class: 'blood-jump-panel__weekdays' });
    const grid = h('div', { class: 'blood-jump-panel__grid' });
    panelBody.append(controls, weekdays, grid);

    function render() {
      monthLabel.textContent = `${viewYear} 年 ${viewMonth + 1} 月`;
      clear(weekdays);
      for (const w of WEEKDAYS_CN) weekdays.append(h('span', { text: w }));
      clear(grid);

      const firstOfMonth = new Date(Date.UTC(viewYear, viewMonth, 1));
      const firstDayOfWeek = (firstOfMonth.getUTCDay() + 6) % 7;   // 周一 = 0
      const gridStart = new Date(Date.UTC(viewYear, viewMonth, 1 - firstDayOfWeek));

      for (let i = 0; i < 42; i += 1) {
        const cellDate = new Date(gridStart);
        cellDate.setUTCDate(gridStart.getUTCDate() + i);
        const cellDateStr = cellDate.toISOString().slice(0, 10);
        const isCurrentMonth = cellDate.getUTCMonth() === viewMonth;
        const isToday = cellDateStr === today;
        const isSelected = cellDateStr === day;
        const isInWeek = weekStart(cellDateStr) === weekStart(day);

        grid.append(
          h(
            'button',
            {
              type: 'button',
              class: 'blood-jump-panel__cell',
              aria: { pressed: String(isSelected), label: cellDateStr },
              tabindex: isSelected ? 0 : -1,
              data: {
                outOfMonth: String(!isCurrentMonth),
                today: String(isToday),
                selected: String(isSelected),
                inWeek: String(isInWeek),
              },
              on: {
                click: () => {
                  week = weekStart(cellDateStr);
                  day = cellDateStr;
                  draw();
                  controller.close();
                },
              },
              text: String(cellDate.getUTCDate()),
            },
          ),
        );
      }
    }

    const backThisWeek = button({
      label: '回到本周',
      variant: 'primary',
      onClick: () => {
        week = thisWeek;
        day = today;
        draw();
        controller.close();
      },
    });
    const closeBtn = button({
      label: '关闭',
      variant: 'ghost',
      onClick: () => controller.close(),
    });

    const controller = openModal({
      title: '选择周次',
      body: panelBody,
      footer: [backThisWeek, h('span', { class: 'spacer' }), closeBtn],
      width: 460,
      dismissible: true,
    });
    render();
  }

  function draw() {
    Object.assign(state, { week, day, point, available });
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