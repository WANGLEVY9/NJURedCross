/* ==========================================================================
   portal/pages/materials-rooms.js
   Task: activity-room borrowing (D3 场地借用 v1). Room list + borrowable
   windows + application form + my applications with cancel. Member-only.
   Times use `YYYY-MM-DD HH:mm`; `datetime-local` inputs are converted at the
   boundary so the service keeps its lexicographic conflict check.
   ========================================================================== */

import { materialServices } from '../../shared/material-services.js';
import { h, icon, clear } from '../../core/dom.js';
import { publicApi, ApiError } from '../../core/api.js';
import { openDrawer, confirmAction } from '../../ui/overlay.js';
import { button, field, badge, notice, emptyState, runWithLoading, definitionList } from '../../ui/primitives.js';
import { notify, reportError } from '../../core/toast.js';
import { isSignedIn, loginRequiredPanel, redirectIfAuthError } from '../auth-gate.js';
import { shake } from '../../core/motion.js';

const localToStamp = value => String(value ?? '').replace('T', ' ');
const stampToLocal = value => String(value ?? '').replace(' ', 'T');

function applicationTone(status) {
  if (status === '审批通过') return 'success';
  if (status === '审批不通过' || status === '已取消') return 'error';
  if (status === '待审批') return 'warning';
  return 'neutral';
}

export default async function materialsRoomsPage() {
  let disposed = false;
  const roomSlot = h('div', { class: 'stack-5' });
  const mineSlot = h('div', { class: 'stack-4' });

  function roomCard(room) {
    const hours = room.openTime && room.closeTime ? `${room.openTime} – ${room.closeTime}` : '全天可约';
    const header = h('div', { class: 'row-between row-wrap' },
      h('div', { class: 'stack-1' },
        h('h3', { class: 't-h3', text: room.name }),
        h('p', { class: 't-caption t-muted row-2' }, icon('pin', 'ico ico--sm'), h('span', { text: room.location }))),
      room.enabled ? badge('可借用', { tone: 'success', iconName: 'check' }) : badge('停用', { tone: 'warning', iconName: 'close' }));
    const facts = definitionList([
      ['容量', `${room.capacity} 人`],
      ['可借时段', hours],
      ['占用中', `${room.activeBookings} 场`],
      room.note ? ['备注', room.note] : null,
    ]);
    const action = h('div', { class: 'row-3 row-wrap' },
      button({ label: '申请借用', variant: 'primary', iconName: 'plus', disabled: !room.enabled, onClick: () => openBooking(room) }));
    return h('article', { class: 'panel panel--raised' },
      h('div', { class: 'panel__body stack-3' }, header, facts, action));
  }

  function applicationRow(app) {
    const cancellable = app.status === '待审批' || app.status === '审批通过';
    return h('div', { class: 'panel' },
      h('div', { class: 'panel__body row-between row-wrap stack-3' },
        h('div', { class: 'stack-1' },
          h('div', { class: 'row-2 row-wrap' }, h('b', { class: 't-secondary t-strong', text: app.roomName }), badge(app.status, { tone: applicationTone(app.status) })),
          h('p', { class: 't-caption', text: `${app.start} → ${app.end}` }),
          h('p', { class: 't-caption t-muted', text: app.purpose }),
          app.rejectReason ? h('p', { class: 't-caption', text: `不通过理由：${app.rejectReason}` }) : null),
        cancellable ? button({ label: '取消申请', variant: 'ghost', size: 'sm', onClick: () => cancelApplication(app) }) : null));
  }

  async function openBooking(room) {
    if (!isSignedIn()) { notify.warning('需要登录', '借用申请需要先登录活动平台。'); return; }
    const startField = field({ label: '开始时间', name: 'start', type: 'datetime-local', required: true, min: stampToLocal(nowLocal()), hint: '精确到分钟，格式为日期 + 时间。' });
    const endField = field({ label: '结束时间', name: 'end', type: 'datetime-local', required: true, min: stampToLocal(nowLocal()) });
    const purposeField = field({ label: '用途', name: 'purpose', required: true, placeholder: '例如：新生急救培训' });
    const noteField = field({ label: '备注（选填）', name: 'note', multiline: true, rows: 3, hint: '可补充活动规模、需要协调的设备等。' });
    const errorSlot = h('div', { role: 'alert' });
    const submitButton = button({ label: '提交申请', variant: 'primary', iconName: 'check', onClick: () => submit() });

    const drawer = openDrawer({
      eyebrow: '场地借用申请', title: room.name, description: `${room.location} · 容量 ${room.capacity} 人`,
      body: [
        notice('提交后由管理员审批；同一场地同一时段只能有一场有效申请。', { tone: 'info' }),
        h('div', { class: 'formgrid' }, startField, endField),
        purposeField,
        noteField,
        errorSlot,
      ],
      footer: [h('span', { class: 'spacer' }), button({ label: '取消', variant: 'ghost', onClick: () => drawer.close() }), submitButton],
    });

    async function submit() {
      clear(errorSlot);
      for (const f of [startField, endField, purposeField]) f.setError(null);
      const start = localToStamp(startField.control.value);
      const end = localToStamp(endField.control.value);
      let invalid = null;
      if (!startField.control.value) { startField.setError('请选择开始时间'); invalid = invalid || startField; }
      if (!endField.control.value) { endField.setError('请选择结束时间'); invalid = invalid || endField; }
      else if (start && end && end <= start) { endField.setError('结束时间必须晚于开始时间'); invalid = invalid || endField; }
      if (!purposeField.control.value.trim()) { purposeField.setError('请填写用途'); invalid = invalid || purposeField; }
      if (invalid) { shake(invalid); invalid.control.focus(); return; }
      try {
        const payload = await runWithLoading(submitButton, () => publicApi.venueApply(room.id, { start, end, purpose: purposeField.control.value.trim(), note: noteField.control.value.trim() }));
        notify.success('申请已提交', payload.message);
        drawer.close();
        await Promise.all([loadRooms(), loadMine()]);
      } catch (error) {
        if (redirectIfAuthError(error)) return;
        errorSlot.replaceChildren(notice(error.message || '申请未提交，请重试。', { tone: 'error' }));
        if (!(error instanceof ApiError && (error.status === 400 || error.status === 409))) reportError(error, '申请未提交');
      }
    }
  }

  async function cancelApplication(app) {
    const ok = await confirmAction({
      title: '取消借用申请', tone: 'warning', confirmLabel: '确认取消',
      description: `确定取消 ${app.roomName} 在 ${app.start} 至 ${app.end} 的借用申请吗？`,
    });
    if (!ok) return;
    try {
      const payload = await publicApi.venueCancel(app.id);
      notify.success('已取消', payload.message);
      await Promise.all([loadRooms(), loadMine()]);
    } catch (error) {
      if (redirectIfAuthError(error)) return;
      reportError(error, '取消失败');
    }
  }

  async function loadRooms() {
    try {
      const payload = await publicApi.venueRooms();
      const list = payload.rooms || [];
      if (disposed) return;
      clear(roomSlot);
      if (!list.length) { roomSlot.append(emptyState({ iconName: 'door', title: '暂无可借用场地', description: '场地清单尚未录入，请联系物资管理员。' })); return; }
      roomSlot.append(...list.map(roomCard));
    } catch (error) {
      if (disposed) return;
      clear(roomSlot);
      roomSlot.append(notice(`场地清单加载失败：${error.message}`, { tone: 'error' }), button({ label: '重试', variant: 'secondary', onClick: loadRooms }));
    }
  }

  async function loadMine() {
    if (!isSignedIn()) {
      clear(mineSlot);
      mineSlot.append(loginRequiredPanel({ what: '场地借用申请', hint: '登录后可查看自己的借用申请与审批进度。' }));
      return;
    }
    try {
      const payload = await publicApi.venueMyApplications();
      const list = payload.applications || [];
      if (disposed) return;
      clear(mineSlot);
      if (!list.length) { mineSlot.append(emptyState({ iconName: 'clock', title: '还没有借用申请', description: '选择上方场地并提交申请后，会显示在这里。' })); return; }
      mineSlot.append(...list.map(applicationRow));
    } catch (error) {
      if (disposed) return;
      clear(mineSlot);
      mineSlot.append(notice(`申请记录加载失败：${error.message}`, { tone: 'error' }), button({ label: '重试', variant: 'secondary', onClick: loadMine }));
    }
  }

  function nowLocal() {
    const d = new Date();
    const pad = n => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
  }

  const node = h('div', { class: 'view' },
    h('div', { class: 'formpage' }, materialServices('venue'),
      h('header', { class: 'stack-3' },
        h('a', { class: 't-caption t-muted row-2', href: '/materials' }, icon('chevronLeft', 'ico ico--sm'), h('span', { text: '返回物资广场' })),
        h('div', { class: 'row-3 row-wrap' }, h('p', { class: 't-label', text: '物资广场 · 场地' }), badge('预约登记', { tone: 'accent', iconName: 'pin' })),
        h('h1', { class: 't-h1', text: '场地借用' }),
        h('p', { class: 't-prose', text: '借用校内活动室用于培训、会议与小型活动。同一时段同一场地仅接受一场有效申请，提交后由管理员审批。' }),
      ),
      h('section', { class: 'stack-3' }, h('h2', { class: 't-h2', text: '可选场地' }), roomSlot),
      h('section', { class: 'stack-3' }, h('h2', { class: 't-h2', text: '我的借用申请' }), mineSlot),
    ),
  );

  await Promise.all([loadRooms(), loadMine()]);
  return { title: '场地借用', node, dispose: () => { disposed = true; } };
}
