/* ==========================================================================
   console/pages/materials-rooms.js
   Task: activity-room borrowing (D3 场地借用 v1) — management cockpit.
   Room list + create/edit, application review (approve / reject / cancel),
   and an occupancy calendar. 指间管理 integration is flagged `pending`.
   ========================================================================== */

import { h, clear } from '../../core/dom.js';
import { consoleApi, ApiError } from '../../core/api.js';
import { openDrawer, requestText, confirmAction } from '../../ui/overlay.js';
import { dataTable } from '../../ui/table.js';
import { asyncRegion, region, reloadAction } from '../lib.js';
import { pageHead, badge, button, field, notice, emptyState, runWithLoading, definitionList, segmented } from '../../ui/primitives.js';
import { notify, reportError } from '../../core/toast.js';
import { materialServices } from '../../shared/material-services.js';

function applicationTone(status) {
  if (status === '审批通过') return 'success';
  if (status === '审批不通过' || status === '已取消') return 'error';
  if (status === '待审批') return 'warning';
  return 'neutral';
}

export default async function materialsRoomsPage() {
  let appStatusFilter = '';

  const roomsRegion = asyncRegion({
    errorTitle: '场地清单加载失败',
    load: () => consoleApi.venues.rooms(),
    render: data => renderRooms(data.rooms || []),
  });
  const appsRegion = asyncRegion({
    errorTitle: '借用申请加载失败',
    load: () => consoleApi.venues.applications({ status: appStatusFilter }),
    render: data => renderApplications(data.applications || []),
  });
  const calRegion = asyncRegion({
    errorTitle: '占用日历加载失败',
    load: () => consoleApi.venues.calendar(),
    render: data => renderCalendar(data),
  });

  const reloadAll = () => { roomsRegion.reload(); appsRegion.reload(); calRegion.reload(); };

  function renderRooms(rooms) {
    const table = dataTable({
      searchPlaceholder: '搜索场地名称或地点',
      searchKeys: ['name', 'location'],
      columns: [
        { key: 'name', label: '场地名称', strong: true },
        { key: 'location', label: '地点' },
        { key: 'capacity', label: '容量', align: 'right', render: row => h('span', { text: `${row.capacity} 人` }) },
        { key: 'openTime', label: '可借时段', render: row => h('span', { text: row.openTime && row.closeTime ? `${row.openTime}–${row.closeTime}` : '全天' }) },
        { key: 'status', label: '状态', sortable: false, render: row => row.enabled ? badge('启用', { tone: 'success' }) : badge('停用', { tone: 'warning' }) },
        { key: 'activeBookings', label: '占用中', align: 'right', render: row => h('span', { text: `${row.activeBookings} 场` }) },
      ],
      rows: rooms,
      getKey: row => row.id,
      empty: emptyState({ iconName: 'door', title: '还没有场地', description: '点击「新增场地」录入第一个可借用的活动室。' }),
      onRowClick: row => openRoomDrawer(row),
    });
    return table;
  }

  function renderApplications(applications) {
    const table = dataTable({
      searchPlaceholder: '搜索申请人、场地或用途',
      searchKeys: ['applicant', 'roomName', 'purpose'],
      columns: [
        { key: 'roomName', label: '场地', strong: true },
        { key: 'applicant', label: '申请人' },
        { key: 'start', label: '时段', render: row => h('span', { text: `${row.start} → ${row.end}` }) },
        { key: 'purpose', label: '用途' },
        { key: 'status', label: '状态', sortable: false, render: row => badge(row.status, { tone: applicationTone(row.status) }) },
        { key: 'submittedAt', label: '提交时间' },
      ],
      rows: applications,
      getKey: row => row.id,
      empty: emptyState({ iconName: 'calendar', title: '还没有借用申请', description: '公众端提交的场地借用申请会出现在这里。' }),
      onRowClick: row => openReviewDrawer(row),
    });
    return table;
  }

  function renderCalendar(data) {
    const bookings = data.bookings || [];
    const byRoom = new Map();
    for (const booking of bookings) {
      const key = booking.roomName || '未标注';
      if (!byRoom.has(key)) byRoom.set(key, []);
      byRoom.get(key).push(booking);
    }
    return h('div', { class: 'stack-4' },
      notice(`${data.integration?.note || ''} 占用日历仅在本平台内维护。`, { tone: 'info', title: '第三方对接待接入' }),
      ...(bookings.length
        ? [...byRoom.entries()].map(([roomName, items]) => h('div', { class: 'panel' },
            h('div', { class: 'panel__body stack-2' },
              h('div', { class: 'row-2 row-wrap' }, h('b', { class: 't-secondary t-strong', text: roomName }), badge(`${items.length} 场`, { tone: 'neutral' })),
              ...items.map(booking => h('div', { class: 'queue__row' },
                h('span', { class: 'queue__rail' }),
                h('div', { class: 'queue__body stack-1' },
                  h('p', { class: 't-caption', text: `${booking.start} → ${booking.end}` }),
                  h('p', { class: 't-caption t-muted t-clamp-1', text: `${booking.applicant} · ${booking.purpose}` })),
                badge(booking.status, { tone: applicationTone(booking.status) }))),
            )))
        : [emptyState({ iconName: 'calendar', title: '暂无占用', description: '审批通过或待审批的申请会显示在这里。' })]),
    );
  }

  function roomFormFields(room) {
    const nameField = field({ label: '场地名称', name: 'name', required: true, value: room?.name || '', placeholder: '例如：校红会会议室' });
    const locationField = field({ label: '地点', name: 'location', value: room?.location || '', placeholder: '例如：大学生活动中心 305' });
    const openField = field({ label: '可借开始时间', name: 'openTime', value: room?.openTime || '', placeholder: '例如 08:00', hint: '留空表示不限开始时间。' });
    const closeField = field({ label: '可借结束时间', name: 'closeTime', value: room?.closeTime || '', placeholder: '例如 22:00', hint: '与开始时间同时填写或同时留空。' });
    const capacityField = field({ label: '容量', name: 'capacity', type: 'number', min: 0, step: 1, value: room ? String(room.capacity ?? 0) : '0' });
    const noteField = field({ label: '备注（选填）', name: 'note', multiline: true, rows: 3, value: room?.note || '' });
    const statusField = room ? field({ label: '状态', name: 'status', options: [{ value: '启用', label: '启用' }, { value: '停用', label: '停用' }], value: room.enabled ? '启用' : '停用' }) : null;
    return { nameField, locationField, openField, closeField, capacityField, noteField, statusField };
  }

  async function openRoomDrawer(room) {
    const errorSlot = h('div', { role: 'alert' });
    const submitButton = button({ label: room ? '保存场地' : '创建场地', variant: 'primary', iconName: 'check', onClick: () => submit() });
    const fields = roomFormFields(room);
    const body = [
      notice(room ? '可借时段用于约束借用时间；容量与备注会展示给申请人。' : '创建后即可被公众端申请借用。', { tone: 'info' }),
      h('div', { class: 'formgrid' }, fields.nameField, fields.locationField),
      h('div', { class: 'formgrid' }, fields.openField, fields.closeField),
      h('div', { class: 'formgrid' }, fields.capacityField, fields.statusField),
      fields.noteField,
      errorSlot,
    ].filter(Boolean);
    const drawer = openDrawer({
      eyebrow: '场地管理', title: room ? room.name : '新增场地', width: 520,
      body,
      footer: [h('span', { class: 'spacer' }), button({ label: '取消', variant: 'ghost', onClick: () => drawer.close() }), submitButton],
    });

    async function submit() {
      clear(errorSlot);
      for (const f of Object.values(fields)) if (f) f.setError?.(null);
      const name = fields.nameField.control.value.trim();
      const openTime = fields.openField.control.value.trim();
      const closeTime = fields.closeField.control.value.trim();
      const capacity = Number(fields.capacityField.control.value);
      if (!name) { fields.nameField.setError('请填写场地名称'); fields.nameField.control.focus(); return; }
      if ((openTime || closeTime) && !(openTime && closeTime && openTime < closeTime)) {
        fields.openField.setError('可借时段需同时填写开始与结束，且开始早于结束'); fields.openField.control.focus(); return;
      }
      if (!Number.isSafeInteger(capacity) || capacity < 0) { fields.capacityField.setError('容量应为非负整数'); fields.capacityField.control.focus(); return; }
      const payload = {
        name, location: fields.locationField.control.value.trim(),
        openTime, closeTime, capacity,
        note: fields.noteField.control.value.trim(),
      };
      if (room && fields.statusField) payload.status = fields.statusField.control.value;
      try {
        const result = room
          ? await runWithLoading(submitButton, () => consoleApi.venues.updateRoom(room.id, payload))
          : await runWithLoading(submitButton, () => consoleApi.venues.createRoom(payload));
        notify.success(room ? '场地已更新' : '场地已创建', result.message);
        drawer.close();
        reloadAll();
      } catch (error) {
        errorSlot.replaceChildren(notice(error.message || '保存失败，请重试。', { tone: 'error' }));
        if (!(error instanceof ApiError && error.status === 400)) reportError(error, '保存失败');
      }
    }
  }

  async function openReviewDrawer(app) {
    const body = () => h('div', { class: 'stack-4' },
      definitionList([
        ['申请人', app.applicant],
        ['账号', app.applicantAccount || '未填写'],
        ['场地', app.roomName],
        ['时段', `${app.start} → ${app.end}`],
        ['用途', app.purpose],
        ['状态', app.status],
        ['提交时间', app.submittedAt],
        app.reviewer ? ['审批人', app.reviewer] : null,
        app.reviewedAt ? ['审批时间', app.reviewedAt] : null,
        app.rejectReason ? ['不通过理由', app.rejectReason] : null,
        app.note ? ['备注', app.note] : null,
      ]),
      actions(app),
    );
    const drawer = openDrawer({
      eyebrow: '借用申请审批', title: `${app.roomName} · ${app.applicant}`, width: 500,
      body: body(),
      footer: [h('span', { class: 'spacer' }), button({ label: '关闭', variant: 'ghost', onClick: () => drawer.close() })],
    });

    function actions(current) {
      const buttons = [];
      if (current.status === '待审批') {
        buttons.push(button({ label: '通过', variant: 'primary', iconName: 'check', onClick: () => approve(current) }));
        buttons.push(button({ label: '不通过', variant: 'danger', iconName: 'close', onClick: () => reject(current) }));
      }
      if (current.status === '审批通过') {
        buttons.push(button({ label: '取消申请', variant: 'ghost', iconName: 'close', onClick: () => cancel(current) }));
      }
      if (!buttons.length) return notice(current.status === '待审批' ? '' : '该申请已处理完成。', { tone: 'neutral' });
      return h('div', { class: 'row-3 row-wrap' }, ...buttons);
    }

    async function approve(current) {
      const ok = await confirmAction({
        title: '通过借用申请', confirmLabel: '确认通过',
        description: `确认通过 ${current.roomName} 在 ${current.start} 至 ${current.end} 的申请？通过后该时段进入占用日历。`,
      });
      if (!ok) return;
      await doReview(current, { approve: true });
    }

    async function reject(current) {
      const reason = await requestText({ title: '填写不通过理由', label: '不通过理由', required: true });
      if (!reason) return;
      await doReview(current, { approve: false, reason });
    }

    async function cancel(current) {
      const ok = await confirmAction({ title: '取消借用申请', tone: 'warning', confirmLabel: '确认取消', description: '取消后该时段释放，可重新申请。' });
      if (!ok) return;
      try {
        const payload = await consoleApi.venues.cancel(current.id);
        notify.success('已取消', payload.message);
        drawer.close();
        reloadAll();
      } catch (error) { reportError(error, '取消失败'); }
    }

    async function doReview(current, body) {
      try {
        const payload = await consoleApi.venues.review(current.id, body);
        notify.success(body.approve ? '已通过' : '已拒绝', payload.message);
        drawer.close();
        reloadAll();
      } catch (error) { reportError(error, '审批未完成'); }
    }
  }

  const node = h('div', { class: 'view wspad wspad--wide' },
    materialServices('venue', { console: true }),
    pageHead({ label: '物资服务', title: '场地借用', description: '管理校内活动室借用与预约安排；第三方「指间管理」尚未对接，占用日历在本平台内维护。' }),
    region({
      label: '场地管理', title: '场地清单', description: '维护可借用的活动室、可借时段与容量。',
      actions: [reloadAction(roomsRegion), button({ label: '新增场地', variant: 'primary', size: 'sm', iconName: 'plus', onClick: () => openRoomDrawer(null) })],
      body: roomsRegion,
    }),
    region({
      label: '借用申请', title: '申请审批', description: '审批公众端提交的场地借用申请，冲突会在审批时再次校验。',
      actions: [
        segmented({
          items: [{ value: '', label: '全部' }, { value: '待审批', label: '待审批' }, { value: '审批通过', label: '已通过' }, { value: '审批不通过', label: '已拒绝' }, { value: '已取消', label: '已取消' }],
          value: appStatusFilter, role: 'radiogroup',
          onChange: value => { appStatusFilter = value; appsRegion.reload(); },
        }),
        reloadAction(appsRegion),
      ],
      body: appsRegion,
    }),
    region({ label: '占用日历', title: '占用安排', description: '有效申请（待审批 / 已通过）按场地与时段展示。', actions: [reloadAction(calRegion)], body: calRegion }),
  );

  return { title: '场地借用', crumb: '场地借用', node };
}
