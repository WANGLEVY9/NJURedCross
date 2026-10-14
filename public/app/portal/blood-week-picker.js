/* ==========================================================================
   blood-week-picker.js — jump-to-week dialog for the blood booking calendar.
   The dialog uses mountOverlay directly so we can shape the surface around
   a month grid; it follows the same accessibility rules as the calendar
   itself (roving tabindex inside a 7-column grid, Esc to dismiss, focus is
   trapped while open).
   ========================================================================== */

import { h, setVars, clear } from '../core/dom.js';
import { button, iconButton } from '../ui/primitives.js';
import { mountOverlay } from '../ui/overlay.js';
import { weekStart, shiftDay } from './blood-calendar.js';

const WEEKDAY_LABELS = ['周一', '周二', '周三', '周四', '周五', '周六', '周日'];

function startOfMonth(anchor) {
  return anchor.slice(0, 7) + '-01';
}

function partsOf(date) {
  return { y: Number(date.slice(0, 4)), m: Number(date.slice(5, 7)), d: Number(date.slice(8)) };
}

function isInMonth(date, monthAnchor) {
  return date.slice(0, 7) === monthAnchor.slice(0, 7);
}

function monthOffset(monthKeyValue, offset) {
  const [y, m] = monthKeyValue.split('-').map(Number);
  const total = (y * 12) + (m - 1) + offset;
  const ny = Math.floor(total / 12);
  const nm = (total % 12) + 1;
  return `${ny}-${String(nm).padStart(2, '0')}`;
}

function formatRange(week) {
  return `${week.replaceAll('-', '/')} — ${shiftDay(week, 6).slice(5).replace('-', '/')}`;
}

function buildMonthGrid(monthAnchor) {
  // 6 rows × 7 days, anchored on the Monday of the week containing day 1.
  const start = weekStart(startOfMonth(monthAnchor));
  const cells = [];
  for (let i = 0; i < 42; i += 1) cells.push(shiftDay(start, i));
  return cells;
}

/**
 * Open a centered dialog that lets the user choose any week to jump to.
 *
 * @param {object} config
 * @param {string} config.currentWeek    YYYY-MM-DD — the week shown right now.
 * @param {Set<string>|string[]} [config.eventDates]
 *        Dates that have at least one blood shift; shown with a soft dot.
 * @param {string} [config.today]        YYYY-MM-DD — defaults to today in UTC+8.
 * @param {(week: string) => void} config.onSelect
 *        Invoked with the new week start when the user confirms.
 */
export function openBloodWeekPicker({ currentWeek, eventDates = [], today = '', onSelect } = {}) {
  const dates = eventDates instanceof Set ? eventDates : new Set(eventDates);
  if (!today) today = new Date(Date.now() + 8 * 3600000).toISOString().slice(0, 10);

  const initialWeek = weekStart(currentWeek || today);
  let viewingMonth = initialWeek.slice(0, 7);
  let pendingWeek = initialWeek;
  let focusedDate = initialWeek;

  /* -------------------- DOM scaffolding --------------------------------- */
  const monthLabel = h('strong', { class: 'blood-week-picker__month' });
  const grid = h('div', { class: 'blood-week-picker__grid', attrs: { role: 'grid', 'aria-label': '日历日期' } });
  const preview = h('p', { class: 'blood-week-picker__preview', attrs: { role: 'status', 'aria-live': 'polite' } });

  const confirmButton = button({
    label: '前往这一周',
    variant: 'primary',
    onClick: () => {
      const chosen = pendingWeek;
      controller.close();
      onSelect?.(chosen);
    },
  });

  const cancelButton = button({
    label: '取消',
    variant: 'ghost',
    onClick: () => controller.close(),
  });

  const todayButton = button({
    label: '今天',
    size: 'sm',
    variant: 'quiet',
    onClick: () => {
      viewingMonth = today.slice(0, 7);
      pendingWeek = weekStart(today);
      focusedDate = today;
      render();
      focusCell(today);
    },
  });

  const prevMonth = iconButton({
    iconName: 'chevronLeft',
    label: '上个月',
    onClick: () => { viewingMonth = monthOffset(viewingMonth, -1); render(); focusCell(focusedDate); },
  });

  const nextMonth = iconButton({
    iconName: 'chevronRight',
    label: '下个月',
    onClick: () => { viewingMonth = monthOffset(viewingMonth, 1); render(); focusCell(focusedDate); },
  });

  const closeButton = iconButton({ iconName: 'close', label: '关闭', onClick: () => controller.close() });

  /* -------------------- Rendering -------------------------------------- */
  function focusCell(date) {
    const target = grid.querySelector(`[data-date="${date}"]`);
    target?.focus({ preventScroll: true });
  }

  function render() {
    const [year, month] = viewingMonth.split('-').map(Number);
    monthLabel.textContent = `${year} 年 ${month} 月`;
    const cells = buildMonthGrid(viewingMonth);
    clear(grid);

    for (let row = 0; row < 6; row += 1) {
      const rowStart = cells[row * 7];
      const rowIsPending = rowStart === pendingWeek;
      for (let i = 0; i < 7; i += 1) {
        const date = cells[row * 7 + i];
        const inMonth = isInMonth(date, viewingMonth);
        const isToday = date === today;
        const isFocused = date === focusedDate;
        const hasEvent = dates.has(date);
        const dayNumber = String(partsOf(date).d);
        const cell = h(
          'button',
          {
            type: 'button',
            class: 'blood-week-picker__cell',
            data: {
              date,
              today: String(isToday),
              other: String(!inMonth),
              row: String(row),
              col: String(i),
              event: String(hasEvent),
            },
            attrs: { role: 'gridcell' },
            tabindex: isFocused ? '0' : '-1',
            aria: {
              label: [
                date.replaceAll('-', '/'),
                inMonth ? '' : '（非本月）',
                hasEvent ? '，当天有献血车班次' : '',
                rowIsPending ? '，当前所选周次' : '',
              ].filter(Boolean).join(''),
              selected: String(date === pendingWeek),
            },
            on: {
              click: () => {
                focusedDate = date;
                pendingWeek = rowStart;
                render();
                focusCell(date);
              },
            },
          },
          h('span', { class: 'blood-week-picker__cell-num', text: dayNumber }),
          hasEvent ? h('span', { class: 'blood-week-picker__cell-dot', attrs: { 'aria-hidden': 'true' } }) : null,
        );
        grid.append(cell);
      }
    }
    preview.textContent = `将跳转至：${formatRange(pendingWeek)}`;
  }

  /* -------------------- Roving focus inside the grid -------------------- */
  function cellAt(row, col) {
    if (row < 0 || row > 5 || col < 0 || col > 6) return null;
    return grid.querySelector(`.blood-week-picker__cell[data-row="${row}"][data-col="${col}"]`);
  }

  function moveFocus(dr, dc) {
    const current = grid.querySelector('.blood-week-picker__cell:focus')
      || grid.querySelector('.blood-week-picker__cell[data-col="0"][data-row="0"]');
    if (!current) return;
    const row = Number(current.dataset.row);
    const col = Number(current.dataset.col);
    let next = cellAt(row + dr, col + dc);
    if (!next) {
      // Move into the next/previous month: shift the focus by ±7 days and reload.
      const weeks = dc === 0 ? dr : 0;
      const days = dc === 0 ? 0 : dc;
      const offset = weeks * 7 + days;
      const candidate = shiftDay(current.dataset.date, offset);
      viewingMonth = candidate.slice(0, 7);
      focusedDate = candidate;
      pendingWeek = weekStart(candidate);
      render();
      focusCell(candidate);
      return;
    }
    focusedDate = next.dataset.date;
    pendingWeek = weekStart(focusedDate);
    render();
    focusCell(focusedDate);
  }

  function onGridKey(event) {
    if (event.key === 'ArrowLeft') { event.preventDefault(); moveFocus(0, -1); return; }
    if (event.key === 'ArrowRight') { event.preventDefault(); moveFocus(0, 1); return; }
    if (event.key === 'ArrowUp') { event.preventDefault(); moveFocus(-1, 0); return; }
    if (event.key === 'ArrowDown') { event.preventDefault(); moveFocus(1, 0); return; }
    if (event.key === 'Home') { event.preventDefault(); const head = cellAt(0, 0); head && (focusedDate = head.dataset.date, pendingWeek = weekStart(focusedDate), render(), focusCell(focusedDate)); return; }
    if (event.key === 'End') { event.preventDefault(); const tail = cellAt(5, 6); tail && (focusedDate = tail.dataset.date, pendingWeek = weekStart(focusedDate), render(), focusCell(focusedDate)); return; }
    if (event.key === 'PageUp') { event.preventDefault(); viewingMonth = monthOffset(viewingMonth, -1); render(); focusCell(focusedDate); return; }
    if (event.key === 'PageDown') { event.preventDefault(); viewingMonth = monthOffset(viewingMonth, 1); render(); focusCell(focusedDate); return; }
    if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); confirmButton.click(); }
  }

  /* -------------------- Build the surface ------------------------------ */
  const titleId = `bwp-${Math.random().toString(36).slice(2, 8)}`;
  const surface = h(
    'div',
    { class: 'blood-week-picker', attrs: { role: 'dialog' } },
    h(
      'header',
      { class: 'blood-week-picker__head' },
      h(
        'div',
        { class: 'blood-week-picker__title-wrap' },
        h('p', { class: 't-label blood-week-picker__eyebrow', text: '跳转周次' }),
        h('h2', { class: 'blood-week-picker__title', id: titleId, text: '选择目标周' }),
        h('p', { class: 't-caption blood-week-picker__hint', text: '点击任意日期，将跳转到该日期所在周（周一至周日）。' }),
      ),
      closeButton,
    ),
    h(
      'div',
      { class: 'blood-week-picker__nav' },
      h(
        'div',
        { class: 'blood-week-picker__month-wrap' },
        prevMonth,
        monthLabel,
        nextMonth,
      ),
      todayButton,
    ),
    h(
      'div',
      { class: 'blood-week-picker__weekdays', attrs: { 'aria-hidden': 'true' } },
      ...WEEKDAY_LABELS.map((label) => h('span', { class: 'blood-week-picker__weekday', text: label })),
    ),
    grid,
    h(
      'footer',
      { class: 'blood-week-picker__foot' },
      h(
        'div',
        { class: 'blood-week-picker__legend' },
        h('span', { class: 'blood-week-picker__legend-dot' }),
        h('span', { text: '当天有献血车班次' }),
      ),
      preview,
      h('div', { class: 'blood-week-picker__actions' }, cancelButton, confirmButton),
    ),
  );

  grid.addEventListener('keydown', onGridKey);

  setVars(surface, { '--picker-w': '540px' });
  const controller = mountOverlay({ surface, dismissible: true, labelledBy: titleId });

  render();
  // Focus the first cell after the picker has been mounted.
  requestAnimationFrame(() => focusCell(focusedDate));

  return controller;
}
