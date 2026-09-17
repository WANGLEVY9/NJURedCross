/* ==========================================================================
   console/pages/events.js — activity lifecycle workspace.
   Master list on the left, full lifecycle detail on the right.
   Admin path: create → configure sessions → publish → roster → check-in → close
   ========================================================================== */

import { h, icon, clear, qsa } from '../../core/dom.js';
import { consoleApi, ApiError } from '../../core/api.js';
import { shake, stagger } from '../../core/motion.js';
import { openDrawer, confirmAction } from '../../ui/overlay.js';
import { asyncRegion, region, reloadAction, WRITE_NOTICE } from '../lib.js';
import {
  pageHead, metric, metricRow, badge, button, field, checkbox, notice, receipt,
  emptyState, segmented, skeletonMetrics, skeletonRows, statusFor,
  definitionList, copyableCode, runWithLoading, barTrack, timeline,
} from '../../ui/primitives.js';
import { notify, reportError } from '../../core/toast.js';
import * as fmt from '../../core/format.js';

const LIFECYCLE = ['草稿', '报名中', '进行中', '已结束'];

function lifecycleTimeline(event) {
  const index = LIFECYCLE.indexOf(event.status);
  return timeline(
    LIFECYCLE.map((stage, position) => ({
      title: stage,
      description:
        stage === '草稿'
          ? '配置基本信息与场次，尚不可报名。'
          : stage === '报名中'
            ? `容量 ${event.capacity || '不限'} · 已确认 ${event.confirmed} · 候补 ${event.waitlisted}`
            : stage === '进行中'
              ? `已签到 ${event.checkedIn} 人`
              : '关闭报名并进入志愿时长核对。',
      state: index < 0 ? 'pending' : position < index ? 'done' : position === index ? 'active' : 'pending',
      iconName: stage === '草稿' ? 'edit' : stage === '报名中' ? 'users' : stage === '进行中' ? 'qr' : 'archive',
    })),
  );
}

/* --------------------------------------------------------------------------
   Create event
   -------------------------------------------------------------------------- */
function openCreateEventDrawer({ onDone }) {
  const titleField = field({ label: '活动名称', name: 'title', required: true, placeholder: '例如：秋季急救员复训（仙林）' });
  const typeField = field({ label: '活动类型', name: 'type', value: '公益活动', options: ['公益活动', '急救培训', '无偿献血', '生命教育', '志愿服务', '内部会议'] });
  const campusField = field({ label: '校区', name: 'campus', placeholder: '鼓楼 / 仙林 / 苏州' });
  const locationField = field({ label: '地点', name: 'location', placeholder: '具体场地' });
  const capacityField = field({ label: '总容量', name: 'capacity', type: 'number', min: 1, step: 1, value: '30', required: true });
  const visibilityField = field({ label: '公开范围', name: 'visibility', value: '内部成员', options: ['内部成员', '全校公开', '不公开'], hint: '「不公开」的活动不会出现在公众端门户。' });
  const registrationStart = field({ label: '报名开始', name: 'registrationStart', type: 'datetime-local' });
  const registrationEnd = field({ label: '报名截止', name: 'registrationEnd', type: 'datetime-local' });
  const startAt = field({ label: '活动开始', name: 'startAt', type: 'datetime-local' });
  const endAt = field({ label: '活动结束', name: 'endAt', type: 'datetime-local' });
  const descriptionField = field({ label: '活动简介', name: 'description', multiline: true, rows: 3, placeholder: '公众端会展示这段介绍' });

  const submitButton = button({ label: '创建为草稿', variant: 'primary', iconName: 'plus', onClick: () => submit() });

  const drawer = openDrawer({
    eyebrow: '活动中心',
    title: '新建活动',
    description: '创建后进入草稿状态，确认场次与容量后再发布报名。',
    width: 560,
    body: [
      titleField,
      h('div', { class: 'formgrid' }, typeField, visibilityField),
      h('div', { class: 'formgrid' }, campusField, locationField),
      capacityField,
      h('div', { class: 'formgrid' }, registrationStart, registrationEnd),
      h('div', { class: 'formgrid' }, startAt, endAt),
      descriptionField,
      notice('创建后状态为「草稿」，公众端不会显示。需要在详情中添加场次并执行「发布报名」。', { tone: 'info' }),
      notice(WRITE_NOTICE, { tone: 'neutral', iconName: 'shield' }),
    ],
    footer: [h('span', { class: 'spacer' }), button({ label: '取消', variant: 'ghost', onClick: () => drawer.close() }), submitButton],
  });

  async function submit() {
    titleField.setError(null);
    capacityField.setError(null);
    if (!titleField.control.value.trim()) {
      titleField.setError('请填写活动名称');
      shake(titleField);
      return;
    }
    const capacity = Math.round(Number(capacityField.control.value) || 0);
    if (!Number.isInteger(capacity) || capacity <= 0) {
      capacityField.setError('容量必须是正整数');
      shake(capacityField);
      return;
    }
    try {
      const payload = await runWithLoading(submitButton, () =>
        consoleApi.events.create({
          title: titleField.control.value.trim(),
          type: typeField.control.value,
          campus: campusField.control.value.trim(),
          location: locationField.control.value.trim(),
          capacity,
          visibility: visibilityField.control.value,
          registrationStart: registrationStart.control.value,
          registrationEnd: registrationEnd.control.value,
          startAt: startAt.control.value,
          endAt: endAt.control.value,
          description: descriptionField.control.value.trim(),
        }),
      );
      notify.success('活动已创建', payload.message);
      drawer.setBody(
        receipt({
          title: '活动草稿已创建',
          rows: [
            ['活动编号', payload.event['活动ID']],
            ['活动名称', payload.event['活动名称']],
            ['当前状态', payload.event['状态']],
            ['容量', `${payload.event['容量']} 人`],
          ],
        }),
        notice('下一步：在活动详情中添加场次，确认时间与容量后执行「发布报名」。', { tone: 'info' }),
      );
      drawer.setFooter(h('span', { class: 'spacer' }), button({ label: '完成', variant: 'primary', onClick: () => drawer.close() }));
      onDone?.(payload.event['活动ID']);
    } catch (error) {
      if (error instanceof ApiError && error.status === 400) {
        titleField.setError(error.message);
        shake(titleField);
        return;
      }
      reportError(error, '活动未创建');
    }
  }
}

/* --------------------------------------------------------------------------
   Add session
   -------------------------------------------------------------------------- */
function openSessionDrawer(event, { onDone }) {
  const startField = field({ label: '开始时间', name: 'startAt', type: 'datetime-local', required: true });
  const endField = field({ label: '结束时间', name: 'endAt', type: 'datetime-local' });
  const locationField = field({ label: '地点', name: 'location', value: event.location || '' });
  const capacityField = field({ label: '场次容量', name: 'capacity', type: 'number', min: 1, step: 1, value: String(event.capacity || 30), required: true });
  const checkinField = field({ label: '签到开放时间', name: 'checkinOpen', type: 'datetime-local', hint: '留空时默认与开始时间相同。' });

  const submitButton = button({ label: '创建场次', variant: 'primary', iconName: 'plus', onClick: () => submit() });

  const drawer = openDrawer({
    eyebrow: event.name,
    title: '添加活动场次',
    description: '同一活动可以拆分多个场次，名额分别计算。',
    width: 480,
    body: [
      h('div', { class: 'formgrid' }, startField, endField),
      h('div', { class: 'formgrid' }, locationField, capacityField),
      checkinField,
      notice('相同开始时间的场次会被服务端拒绝，避免重复创建。签到方式固定为「二维码 + 人工核验」。', { tone: 'info' }),
    ],
    footer: [h('span', { class: 'spacer' }), button({ label: '取消', variant: 'ghost', onClick: () => drawer.close() }), submitButton],
  });

  async function submit() {
    startField.setError(null);
    if (!startField.control.value) {
      startField.setError('请选择场次开始时间');
      shake(startField);
      return;
    }
    try {
      const payload = await runWithLoading(submitButton, () =>
        consoleApi.events.addSession(event.eventId, {
          startAt: startField.control.value,
          endAt: endField.control.value,
          location: locationField.control.value.trim(),
          capacity: Math.round(Number(capacityField.control.value) || 0),
          checkinOpen: checkinField.control.value,
        }),
      );
      notify.success('场次已创建', payload.message);
      drawer.close();
      onDone?.();
    } catch (error) {
      if (error instanceof ApiError && (error.isConflict || error.status === 400)) {
        startField.setError(error.message);
        shake(startField);
        return;
      }
      reportError(error, '场次未创建');
    }
  }
}

/* --------------------------------------------------------------------------
   Proxy registration (front desk)
   -------------------------------------------------------------------------- */
function openProxyRegistrationDrawer(event, { onDone }) {
  const nameField = field({ label: '姓名', name: 'name', required: true, iconName: 'user' });
  const emailField = field({ label: '邮箱', name: 'email', type: 'email', required: true, iconName: 'mail' });
  const campusField = field({ label: '校区', name: 'campus', value: event.campus || '' });
  const sessionField = field({
    label: '场次',
    name: 'sessionId',
    options: [{ value: '', label: '不指定场次（按活动整体计算）' }, ...event.sessions.map((session) => ({ value: session.sessionId || session.id, label: `${fmt.dateRange(session.startAt, session.endAt)} · 容量 ${session.capacity}` }))],
  });
  const noteField = field({ label: '备注', name: 'note', multiline: true, rows: 2 });
  const consent = checkbox({
    name: 'consent',
    label: '已获得参与者本人的报名授权',
    description: '代报名仅用于现场或线下收集的名单。参与者的信息使用范围与自助报名一致。',
  });

  const submitButton = button({ label: '提交报名', variant: 'primary', iconName: 'check', onClick: () => submit() });

  const drawer = openDrawer({
    eyebrow: '代为报名',
    title: event.name,
    description: '服务端会校验重复邮箱、场次容量并自动决定确认或候补。',
    width: 500,
    body: [h('div', { class: 'formgrid' }, nameField, emailField), h('div', { class: 'formgrid' }, campusField, sessionField), noteField, consent],
    footer: [h('span', { class: 'spacer' }), button({ label: '取消', variant: 'ghost', onClick: () => drawer.close() }), submitButton],
  });

  async function submit() {
    nameField.setError(null);
    emailField.setError(null);
    let invalid = null;
    if (!nameField.control.value.trim()) {
      nameField.setError('请填写姓名');
      invalid = nameField;
    }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(emailField.control.value.trim())) {
      emailField.setError('请填写有效邮箱');
      invalid = invalid || emailField;
    }
    if (invalid) {
      shake(invalid);
      invalid.control.focus();
      return;
    }
    if (!consent.control.checked) {
      shake(consent);
      notify.warning('需要确认授权', '代报名必须确认已获得参与者授权。');
      return;
    }
    try {
      const payload = await runWithLoading(submitButton, () =>
        consoleApi.events.register(event.eventId, {
          name: nameField.control.value.trim(),
          email: emailField.control.value.trim(),
          campus: campusField.control.value.trim(),
          sessionId: sessionField.control.value,
          note: noteField.control.value.trim(),
          consent: true,
        }),
      );
      const registration = payload.registration;
      const qr = h('img', { class: 'qr', alt: '报名签到二维码' });
      qr.src = registration.qrDataUrl;
      drawer.setBody(
        receipt({
          title: registration.status === '已确认' ? '报名已确认' : `已进入候补第 ${registration.waitlist} 位`,
          rows: [
            ['报名编号', registration.code],
            ['状态', registration.status],
            ['签到凭证', '仅本次显示'],
          ],
        }),
        h('div', { class: 'qr-block' }, qr, h('div', { class: 'stack-3' }, h('p', { class: 't-caption', text: '请把二维码或报名编号交给参与者。平台只保存签到码摘要，无法二次展示明文。' }), copyableCode(registration.code))),
      );
      drawer.setFooter(h('span', { class: 'spacer' }), button({ label: '完成', variant: 'primary', onClick: () => drawer.close() }));
      notify.success(payload.message, `报名编号 ${registration.code}`);
      onDone?.();
    } catch (error) {
      if (error instanceof ApiError && (error.isConflict || error.status === 400)) {
        emailField.setError(error.message);
        shake(emailField);
        return;
      }
      reportError(error, '报名未提交');
    }
  }
}

/* --------------------------------------------------------------------------
   On-site check-in
   -------------------------------------------------------------------------- */
function openCheckinDrawer(event, { onDone }) {
  const codeField = field({ label: '报名编号', name: 'code', required: true, placeholder: 'REG-XXXXXXXX-XXXXXX', iconName: 'target' });
  const tokenField = field({ label: '签到凭证', name: 'token', required: true, placeholder: '扫描二维码后自动填充，或让参与者出示凭证', iconName: 'qr' });
  const scanSlot = h('div', { class: 'stack-3' });
  const resultSlot = h('div', { class: 'stack-3' });

  const submitButton = button({ label: '核验并签到', variant: 'primary', iconName: 'check', onClick: () => submit() });

  const drawer = openDrawer({
    eyebrow: '现场签到',
    title: event.name,
    description: '凭证摘要由服务端校验；无效凭证会被拒绝并记录为可疑签到。',
    width: 500,
    body: [
      notice('支持三种输入方式：浏览器摄像头扫码、扫码枪直接输入，或由参与者口述报名编号并出示凭证。', { tone: 'info' }),
      scanSlot,
      codeField,
      tokenField,
      resultSlot,
    ],
    footer: [h('span', { class: 'spacer' }), button({ label: '关闭', variant: 'ghost', onClick: () => drawer.close() }), submitButton],
  });

  // Native barcode detection where available; graceful fallback otherwise.
  if ('BarcodeDetector' in window) {
    const startButton = button({
      label: '启用摄像头扫码',
      variant: 'secondary',
      iconName: 'scan',
      onClick: async () => {
        try {
          const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' } });
          const video = h('video', { class: 'scanner', attrs: { playsinline: 'true', muted: 'true' } });
          video.srcObject = stream;
          await video.play();
          clear(scanSlot);
          scanSlot.append(
            video,
            h('p', { class: 't-caption', text: '将报名二维码对准画面中央；识别成功后会自动填充编号与凭证。视频帧不会上传到服务器。' }),
            button({
              label: '停止扫码',
              variant: 'ghost',
              size: 'sm',
              iconName: 'close',
              onClick: () => {
                stream.getTracks().forEach((track) => track.stop());
                clear(scanSlot);
                scanSlot.append(startButton);
              },
            }),
          );
          // eslint-disable-next-line no-undef
          const detector = new BarcodeDetector({ formats: ['qr_code'] });
          const tick = async () => {
            if (!video.isConnected || !stream.active) return;
            try {
              const codes = await detector.detect(video);
              const hit = codes.find((code) => String(code.rawValue || '').startsWith('NJU-RC-CHECKIN:'));
              if (hit) {
                const token = String(hit.rawValue).replace('NJU-RC-CHECKIN:', '');
                const [code] = token.split('.');
                codeField.control.value = code;
                tokenField.control.value = token;
                notify.success('已识别签到凭证', code);
                stream.getTracks().forEach((track) => track.stop());
                clear(scanSlot);
                scanSlot.append(startButton);
                return;
              }
            } catch {
              /* frame decode failures are expected; keep polling */
            }
            requestAnimationFrame(tick);
          };
          requestAnimationFrame(tick);
        } catch {
          notify.warning('无法打开摄像头', '请检查浏览器权限，或使用扫码枪 / 手动输入。');
        }
      },
    });
    scanSlot.append(startButton);
  } else {
    scanSlot.append(notice('当前浏览器不支持原生二维码识别。请使用扫码枪直接输入，或手动录入报名编号与凭证。', { tone: 'warning' }));
  }

  async function submit() {
    codeField.setError(null);
    tokenField.setError(null);
    const code = codeField.control.value.trim();
    const token = tokenField.control.value.trim();
    if (!code) {
      codeField.setError('请输入报名编号');
      shake(codeField);
      return;
    }
    if (!token) {
      tokenField.setError('请输入或扫描签到凭证');
      shake(tokenField);
      return;
    }
    clear(resultSlot);
    try {
      const payload = await runWithLoading(submitButton, () => consoleApi.events.checkIn(code, token));
      resultSlot.append(receipt({ title: '签到成功', rows: [['报名编号', code], ['结果', payload.message]] }));
      notify.success('签到成功', code);
      codeField.control.value = '';
      tokenField.control.value = '';
      onDone?.();
    } catch (error) {
      if (error instanceof ApiError && (error.isConflict || error.isForbidden || error.status === 404)) {
        resultSlot.append(notice(error.message, { tone: 'error', title: '签到被拒绝' }));
        return;
      }
      reportError(error, '签到未完成');
    }
  }
}

/* --------------------------------------------------------------------------
   Generate registration notice (固定框架 → 报名通知)
   -------------------------------------------------------------------------- */
function toLocalInput(value) {
  const date = fmt.toDate(value);
  if (!date) return '';
  const pad = (n) => String(n).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

function openNoticeDrawer(event, { onDone }) {
  const nameField = field({ label: '活动名称', name: 'name', required: true, value: event.name || '' });
  const categoryField = field({ label: '活动类别', name: 'category', value: event.type || '公益活动', options: ['公益活动', '急救培训', '无偿献血', '生命教育', '志愿服务', '内部会议'] });
  const campusField = field({ label: '校区', name: 'campus', value: event.campus || '', placeholder: '鼓楼 / 仙林 / 苏州' });
  const locationField = field({ label: '地点', name: 'location', value: event.location || '', placeholder: '具体场地' });
  const startAt = field({ label: '活动开始', name: 'startAt', type: 'datetime-local', value: toLocalInput(event.startAt) });
  const endAt = field({ label: '活动结束', name: 'endAt', type: 'datetime-local', value: toLocalInput(event.endAt) });
  const registrationStart = field({ label: '报名开始', name: 'registrationStart', type: 'datetime-local', value: toLocalInput(event.registrationStart) });
  const registrationEnd = field({ label: '报名截止', name: 'registrationEnd', type: 'datetime-local', value: toLocalInput(event.registrationEnd) });
  const capacityField = field({ label: '报名名额', name: 'capacity', type: 'number', min: 1, step: 1, value: String(event.capacity || '') });
  const contactField = field({ label: '联系人', name: 'contact', placeholder: '姓名 + 联系方式' });
  const qqGroupField = field({ label: '答疑 QQ 群', name: 'qqGroup', placeholder: '群号' });
  const contentField = field({ label: '活动内容', name: 'content', multiline: true, rows: 3, value: event.description || '', placeholder: '不写时正文会标注「详见后续通知」' });
  const fillDescription = checkbox({ label: '同时回填活动简介（覆盖活动项目表的「活动简介」列）', name: 'fillDescription', checked: false });

  const fields = [nameField, categoryField, campusField, locationField, startAt, endAt, registrationStart, registrationEnd, capacityField, contactField, qqGroupField, contentField];

  const previewSlot = h('div', { class: 'stack-3' });
  const missingSlot = h('div');

  function collect() {
    return {
      eventId: event.eventId,
      name: nameField.control.value.trim(),
      category: categoryField.control.value,
      campus: campusField.control.value.trim(),
      location: locationField.control.value.trim(),
      startAt: startAt.control.value,
      endAt: endAt.control.value,
      registrationStart: registrationStart.control.value,
      registrationEnd: registrationEnd.control.value,
      capacity: Math.round(Number(capacityField.control.value) || 0),
      contact: contactField.control.value.trim(),
      qqGroup: qqGroupField.control.value.trim(),
      content: contentField.control.value.trim(),
    };
  }

  let previewTimer = null;
  function schedulePreview() {
    clearTimeout(previewTimer);
    previewTimer = setTimeout(refreshPreview, 350);
  }

  async function refreshPreview() {
    try {
      const payload = await consoleApi.notices.preview(collect());
      clear(previewSlot);
      previewSlot.append(
        h('pre', { class: 'notice-preview', text: payload.notice.body }),
      );
      clear(missingSlot);
      if (payload.notice.missing.length) {
        missingSlot.append(notice(`还缺：${payload.notice.missing.join('、')}。缺失项不会阻断生成，但正文会标注「未填写」。`, { tone: 'warning' }));
      }
    } catch {
      // 预览失败（如会话过期）不打断填写；正式生成时会报错
    }
  }

  fields.forEach((f) => f.control.addEventListener('input', schedulePreview));

  const submitButton = button({ label: '生成并存为草稿', variant: 'primary', iconName: 'send', onClick: () => submit() });

  const drawer = openDrawer({
    eyebrow: '活动中心',
    title: '生成报名通知',
    description: `基于「${event.name}」的固定框架渲染报名通知，右侧实时预览。`,
    width: 720,
    body: [
      nameField,
      h('div', { class: 'formgrid' }, categoryField, capacityField),
      h('div', { class: 'formgrid' }, campusField, locationField),
      h('div', { class: 'formgrid' }, startAt, endAt),
      h('div', { class: 'formgrid' }, registrationStart, registrationEnd),
      h('div', { class: 'formgrid' }, contactField, qqGroupField),
      contentField,
      fillDescription,
      missingSlot,
      region({ label: '预览', title: '正文实时预览', dense: true, body: previewSlot }),
      notice(WRITE_NOTICE, { tone: 'neutral', iconName: 'shield' }),
    ],
    footer: [h('span', { class: 'spacer' }), button({ label: '取消', variant: 'ghost', onClick: () => drawer.close() }), submitButton],
  });

  refreshPreview();

  async function submit() {
    if (!nameField.control.value.trim()) {
      nameField.setError('请填写活动名称');
      shake(nameField);
      return;
    }
    try {
      const payload = await runWithLoading(submitButton, () =>
        consoleApi.notices.create({ ...collect(), fillDescription: Boolean(fillDescription.control.checked) }),
      );
      notify.success('通知草稿已生成', `${payload.notice.noticeId} · 可在详情中发布`);
      drawer.close();
      onDone?.();
    } catch (error) {
      reportError(error, '通知生成失败');
    }
  }
}

/* --------------------------------------------------------------------------
   Attachments (上传 / 引用 njubox)
   -------------------------------------------------------------------------- */
function openUploadDrawer(event, { onDone }) {
  const purposeField = field({ label: '用途', name: 'purpose', value: '策划案', options: ['策划案', '宣传物料', '签到表', '总结材料', '其他'] });
  const fileInput = h('input', { class: 'input', type: 'file', attrs: { 'aria-label': '选择文件' } });
  const fileField = h('label', { class: 'field' }, h('span', { class: 'field__label', text: '文件' }), fileInput);
  const submitButton = button({ label: '上传到 njubox', variant: 'primary', iconName: 'upload', onClick: () => submit() });

  const drawer = openDrawer({
    eyebrow: '活动中心',
    title: '上传附件',
    description: `文件会进入 njubox 资料库，平台只在活动附件表登记引用。`,
    width: 520,
    body: [purposeField, fileField, notice('njubox 需要配置 API Token；未配置时上传会被拒绝，可以改用「登记引用」。', { tone: 'info' })],
    footer: [h('span', { class: 'spacer' }), button({ label: '取消', variant: 'ghost', onClick: () => drawer.close() }), submitButton],
  });

  async function submit() {
    const file = fileInput.files?.[0];
    if (!file) {
      notify.warning('请先选择文件');
      shake(fileField);
      return;
    }
    const form = new FormData();
    form.append('eventId', event.eventId);
    form.append('purpose', purposeField.control.value);
    form.append('file', file, file.name);
    try {
      const payload = await runWithLoading(submitButton, () => consoleApi.attachments.upload(form));
      notify.success('附件已上传', payload.attachment.filename);
      drawer.close();
      onDone?.();
    } catch (error) {
      reportError(error, '上传失败');
    }
  }
}

function openReferenceDrawer(event, { onDone }) {
  const purposeField = field({ label: '用途', name: 'purpose', value: '策划案', options: ['策划案', '宣传物料', '签到表', '总结材料', '其他'] });
  const nameField = field({ label: '文件名', name: 'name', required: true, placeholder: '例如：秋季复训策划案.pdf' });
  const pathField = field({ label: 'njubox 路径', name: 'path', required: true, placeholder: '/红十字会/2026秋/策划案.pdf', hint: '文件在 njubox 资料库中的完整路径。' });
  const submitButton = button({ label: '登记引用', variant: 'primary', iconName: 'link', onClick: () => submit() });

  const drawer = openDrawer({
    eyebrow: '活动中心',
    title: '登记已有文件引用',
    description: '文件已经存在于 njubox 时，直接登记路径，不重复上传。',
    width: 520,
    body: [purposeField, nameField, pathField],
    footer: [h('span', { class: 'spacer' }), button({ label: '取消', variant: 'ghost', onClick: () => drawer.close() }), submitButton],
  });

  async function submit() {
    let valid = true;
    for (const f of [nameField, pathField]) {
      f.setError(null);
      if (!f.control.value.trim()) {
        f.setError('必填');
        shake(f);
        valid = false;
      }
    }
    if (!valid) return;
    try {
      const payload = await runWithLoading(submitButton, () =>
        consoleApi.attachments.reference({
          eventId: event.eventId,
          purpose: purposeField.control.value,
          name: nameField.control.value.trim(),
          path: pathField.control.value.trim(),
        }),
      );
      notify.success('引用已登记', payload.attachment.filename);
      drawer.close();
      onDone?.();
    } catch (error) {
      reportError(error, '登记失败');
    }
  }
}

/* --------------------------------------------------------------------------
   Per-event async regions: notices & attachments (module-level helpers)
   -------------------------------------------------------------------------- */
function noticeRegion(event, { onChanged }) {
  const slot = h('div', { class: 'stack-3' }, skeletonRows(3));

  async function load() {
    try {
      const payload = await consoleApi.notices.list(event.eventId);
      render(payload.notices || []);
    } catch (error) {
      clear(slot);
      slot.append(notice(error.message || '通知列表加载失败', { tone: 'error' }));
    }
  }

  function render(notices) {
    clear(slot);
    if (!notices.length) {
      slot.append(
        emptyState({
          iconName: 'send',
          title: '还没有生成报名通知',
          description: '使用固定框架一键生成报名通知草稿，预览确认后发布。',
          actions: [button({ label: '生成报名通知', variant: 'primary', size: 'sm', iconName: 'plus', onClick: () => openNoticeDrawer(event, { onDone: load }) })],
        }),
      );
      return;
    }
    for (const item of notices) {
      const tone = item.status === '已发布' ? 'success' : item.status === '已归档' ? 'neutral' : 'warning';
      const actions = h('div', { class: 'row-2' });
      if (item.status === '草稿') {
        actions.append(
          button({
            label: '发布',
            variant: 'secondary',
            size: 'sm',
            iconName: 'send',
            onClick: async () => {
              const confirmed = await confirmAction({
                title: '发布这份报名通知？',
                description: `「${item.name}」的通知将标记为已发布并记录发布时间。`,
                confirmLabel: '发布',
              });
              if (!confirmed) return;
              try {
                await consoleApi.notices.publish(item.noticeId || item.id);
                notify.success('通知已发布', item.name);
                load();
                onChanged?.();
              } catch (error) {
                reportError(error, '发布失败');
              }
            },
          }),
        );
      }
      if (item.status !== '已归档') {
        actions.append(
          button({
            label: '归档',
            variant: 'ghost',
            size: 'sm',
            iconName: 'archive',
            onClick: async () => {
              try {
                await consoleApi.notices.archive(item.noticeId || item.id);
                notify.success('通知已归档', item.name);
                load();
              } catch (error) {
                reportError(error, '归档失败');
              }
            },
          }),
        );
      }
      slot.append(
        h(
          'details',
          { class: 'notice-item' },
          h(
            'summary',
            { class: 'row-2 row-wrap' },
            badge(item.status, { tone }),
            h('span', { class: 't-secondary t-strong', text: item.name || item.noticeId }),
            h('span', { class: 't-caption t-faint', text: `${item.noticeId} · ${item.generator} · ${fmt.dateTime(item.generatedAt)}` }),
            actions,
          ),
          h('pre', { class: 'notice-preview', text: item.body || '（无正文）' }),
        ),
      );
    }
  }

  load();

  return region({
    label: '报名通知',
    title: '固定框架生成 · 预览确认后发布',
    actions: [button({ label: '生成报名通知', variant: 'ghost', size: 'sm', iconName: 'plus', onClick: () => openNoticeDrawer(event, { onDone: load }) })],
    dense: true,
    body: slot,
  });
}

function attachmentRegion(event) {
  const slot = h('div', { class: 'stack-3' }, skeletonRows(3));

  async function load() {
    try {
      const payload = await consoleApi.attachments.list(event.eventId);
      render(payload.attachments || []);
    } catch (error) {
      clear(slot);
      slot.append(notice(error.message || '附件列表加载失败', { tone: 'error' }));
    }
  }

  function render(attachments) {
    clear(slot);
    if (!attachments.length) {
      slot.append(
        emptyState({
          iconName: 'box',
          title: '还没有登记附件',
          description: '策划案、宣传物料等文件存放在 njubox，这里登记引用或直接上传。',
        }),
      );
      return;
    }
    slot.append(
      h(
        'div',
        { class: 'stack-2' },
        ...attachments.map((item) =>
          h(
            'div',
            { class: 'row-2 row-wrap' },
            badge(item.purpose || '其他', { tone: 'accent' }),
            h('span', { class: 't-secondary t-strong t-clamp-1', text: item.filename }),
            h('span', { class: 't-caption t-faint', text: `${item.uploader} · ${fmt.dateTime(item.uploadedAt)}${item.size ? ` · ${item.size}` : ''}` }),
            h('span', { class: 'spacer' }),
            item.downloadUrl
              ? button({ label: '下载', variant: 'ghost', size: 'sm', iconAfter: 'external', href: item.downloadUrl, data: { native: 'true' } })
              : h('span', { class: 't-caption t-faint', text: item.path || '' }),
          ),
        ),
      ),
    );
  }

  load();

  return region({
    label: '活动附件',
    title: 'njubox 文件引用',
    actions: [
      button({ label: '上传', variant: 'ghost', size: 'sm', iconName: 'upload', onClick: () => openUploadDrawer(event, { onDone: load }) }),
      button({ label: '登记引用', variant: 'ghost', size: 'sm', iconName: 'link', onClick: () => openReferenceDrawer(event, { onDone: load }) }),
    ],
    dense: true,
    body: slot,
  });
}

/* --------------------------------------------------------------------------
   Page
   -------------------------------------------------------------------------- */
export default async function eventsPage(context, shell) {
  let snapshot = null;
  let selectedId = context.query.get('event') || null;
  let filter = 'all';

  const listSlot = h('div', { class: 'split__list' });
  const detailSlot = h('div', { class: 'split__detail' });

  const dataRegion = asyncRegion({
    skeleton: h('div', { class: 'stack-6' }, skeletonMetrics(4), skeletonRows(8)),
    errorTitle: '活动数据无法加载',
    load: () => consoleApi.events.overview(),
    render: (payload, { reload }) => {
      snapshot = payload;
      if (!selectedId || !payload.events.some((event) => event.eventId === selectedId)) {
        selectedId = payload.events[0]?.eventId || null;
      }
      renderList(reload);
      renderDetail(reload);
      return [
        metricRow(
          [
            metric({ label: '活动项目', value: payload.stats.projects, unit: '个' }),
            metric({ label: '活动场次', value: payload.stats.sessions, unit: '场' }),
            metric({ label: '已确认报名', value: payload.stats.confirmed, unit: '人', hint: h('span', { class: 't-caption', text: `候补 ${payload.stats.waitlisted} 人` }) }),
            metric({ label: '已签到', value: payload.stats.checkedIn, unit: '人', hint: h('span', { class: 't-caption', text: `报名总计 ${payload.stats.registrations} 人次` }) }),
          ],
          { columns: 4 },
        ),
        h('div', { class: 'panel panel--raised split-wrap' }, h('div', { class: 'split' }, h('div', { class: 'split__master' }, masterHead, listSlot), detailSlot)),
      ];
    },
  });

  const filterControl = segmented({
    items: [
      { value: 'all', label: '全部' },
      { value: '草稿', label: '草稿' },
      { value: '报名中', label: '报名中' },
      { value: '已结束', label: '已结束' },
    ],
    value: filter,
    ariaLabel: '按状态筛选活动',
    onChange: (value) => {
      filter = value;
      filterControl.setValue(value);
      renderList(() => dataRegion.reload());
    },
  });

  const searchInput = h('input', { class: 'input', type: 'search', placeholder: '搜索活动名称或编号', attrs: { 'aria-label': '搜索活动' } });
  searchInput.addEventListener('input', () => renderList(() => dataRegion.reload()));

  const masterHead = h(
    'div',
    { class: 'toolbar' },
    h('div', { class: 'input-group table__search' }, icon('search', 'ico ico--sm'), searchInput),
    filterControl,
  );

  function renderList(reload) {
    const needle = searchInput.value.trim().toLowerCase();
    const events = snapshot.events.filter((event) => {
      if (filter !== 'all' && event.status !== filter) return false;
      if (needle && !`${event.name} ${event.eventId} ${event.type}`.toLowerCase().includes(needle)) return false;
      return true;
    });

    clear(listSlot);
    if (!events.length) {
      listSlot.append(
        emptyState({
          iconName: 'calendar',
          title: snapshot.events.length ? '没有符合条件的活动' : '还没有创建任何活动',
          description: snapshot.events.length
            ? '调整状态筛选或清空搜索关键词再试一次。'
            : '活动项目表、场次表与报名表已经就绪。创建第一个活动后即可配置场次并发布报名。',
          actions: [
            snapshot.events.length
              ? button({ label: '清除筛选', variant: 'secondary', iconName: 'close', onClick: () => { searchInput.value = ''; filter = 'all'; filterControl.setValue('all'); renderList(reload); } })
              : button({ label: '新建活动', variant: 'primary', iconName: 'plus', onClick: () => openCreateEventDrawer({ onDone: reload }) }),
          ],
        }),
      );
      return;
    }

    for (const event of events) {
      const row = h(
        'button',
        {
          class: 'listrow',
          type: 'button',
          aria: { selected: String(event.eventId === selectedId) },
          on: {
            click: () => {
              selectedId = event.eventId;
              qsa('.listrow', listSlot).forEach((node) => node.setAttribute('aria-selected', 'false'));
              row.setAttribute('aria-selected', 'true');
              renderDetail(reload);
            },
          },
        },
        h(
          'div',
          { class: 'listrow__text' },
          h('div', { class: 'row-2' }, statusFor(event.status), event.waitlisted ? badge(`候补 ${event.waitlisted}`, { tone: 'warning' }) : null),
          h('span', { class: 't-secondary t-strong t-clamp-1', text: event.name }),
          h('span', { class: 't-caption', text: `${fmt.dateShort(event.startAt)} · ${event.sessions.length} 场次 · ${event.confirmed}/${event.capacity || '—'}` }),
        ),
        icon('chevronRight', 'ico ico--sm t-faint'),
      );
      listSlot.append(row);
    }
    stagger(listSlot, ':scope > .listrow');
  }

  function renderDetail(reload) {
    const event = snapshot.events.find((item) => item.eventId === selectedId);
    clear(detailSlot);
    if (!event) {
      detailSlot.append(
        emptyState({
          iconName: 'calendar',
          title: '选择左侧的活动查看生命周期',
          description: '详情会展示场次、报名与签到统计，以及当前状态下可以执行的操作。',
        }),
      );
      return;
    }

    const isDraft = event.status === '草稿';
    const isOpen = event.status === '报名中';

    detailSlot.append(
      h(
        'div',
        { class: 'detailpad stack-6' },
        h(
          'header',
          { class: 'stack-3' },
          h('div', { class: 'row-3 row-wrap' }, statusFor(event.status), badge(event.type || '公益活动', { tone: 'accent' }), badge(event.visibility || '内部成员', { tone: 'neutral', iconName: 'eye' })),
          h('h2', { class: 't-h1', text: event.name }),
          event.description ? h('p', { class: 't-prose', text: event.description }) : null,
          h(
            'div',
            { class: 'row-2 row-wrap' },
            copyableCode(event.eventId, { label: '复制活动编号' }),
            h('span', { class: 't-caption t-faint', text: `负责人 ${event.owner}` }),
          ),
        ),
        metricRow(
          [
            metric({ label: '已确认', value: event.registrations - event.waitlisted, unit: '人', animate: false }),
            metric({ label: '候补', value: event.waitlisted, unit: '人', animate: false, tone: event.waitlisted ? 'warn' : '' }),
            metric({ label: '已签到', value: event.checkedIn, unit: '人', animate: false }),
            metric({ label: '容量', value: event.capacity || 0, unit: '人', animate: false }),
          ],
          { columns: 4 },
        ),
        event.capacity
          ? h(
              'div',
              { class: 'stack-2' },
              h('div', { class: 'row-between' }, h('span', { class: 't-label', text: '名额使用' }), h('span', { class: 't-caption', text: `${fmt.percent(event.confirmed, event.capacity)} 已确认` })),
              barTrack([
                { label: '已确认', value: event.confirmed, color: 'var(--accent)' },
                { label: '候补', value: event.waitlisted, color: 'var(--warning)' },
                { label: '剩余', value: Math.max(0, event.capacity - event.confirmed), color: 'transparent' },
              ]),
            )
          : null,
        h(
          'div',
          { class: 'row-2 row-wrap detail-actions' },
          isDraft
            ? button({
                label: '发布报名',
                variant: 'primary',
                iconName: 'send',
                onClick: async () => {
                  const confirmed = await confirmAction({
                    title: '发布这个活动的报名？',
                    description: `发布后「${event.name}」会出现在公众端门户，并开始接受报名与候补。`,
                    details: [
                      event.sessions.length ? `已配置 ${event.sessions.length} 个场次` : '尚未配置场次：报名将按活动整体容量计算',
                      `容量 ${event.capacity || '未设置'} 人`,
                      event.visibility === '不公开' ? '公开范围为「不公开」，公众端仍不会展示' : `公开范围：${event.visibility || '内部成员'}`,
                    ],
                    confirmLabel: '发布报名',
                  });
                  if (!confirmed) return;
                  try {
                    await consoleApi.events.publish(event.eventId);
                    notify.success('活动已发布', '公众端现在可以看到并报名这个活动。');
                    reload();
                    shell.refreshTodos();
                  } catch (error) {
                    reportError(error, '发布失败');
                  }
                },
              })
            : null,
          isOpen
            ? button({
                label: '关闭报名',
                variant: 'secondary',
                iconName: 'archive',
                onClick: async () => {
                  const confirmed = await confirmAction({
                    title: '关闭这个活动的报名？',
                    description: '关闭后状态变为「已结束」，公众端不再接受新的报名，候补也不会继续递补。',
                    details: [`当前已确认 ${event.confirmed} 人，候补 ${event.waitlisted} 人`, '已签到记录不会受影响'],
                    confirmLabel: '关闭报名',
                    tone: 'danger',
                  });
                  if (!confirmed) return;
                  try {
                    await consoleApi.events.close(event.eventId);
                    notify.success('报名已关闭', event.name);
                    reload();
                    shell.refreshTodos();
                  } catch (error) {
                    reportError(error, '关闭失败');
                  }
                },
              })
            : null,
          button({ label: '添加场次', variant: 'secondary', iconName: 'plus', onClick: () => openSessionDrawer(event, { onDone: reload }) }),
          button({ label: '生成报名通知', variant: 'secondary', iconName: 'send', onClick: () => openNoticeDrawer(event, { onDone: reload }) }),
          isOpen ? button({ label: '代为报名', variant: 'secondary', iconName: 'user', onClick: () => openProxyRegistrationDrawer(event, { onDone: reload }) }) : null,
          button({ label: '现场签到核验', variant: 'ghost', iconName: 'qr', onClick: () => openCheckinDrawer(event, { onDone: reload }) }),
          h('span', { class: 'spacer' }),
          button({ label: '公众端预览', variant: 'ghost', size: 'sm', iconAfter: 'external', href: `/events/${encodeURIComponent(event.eventId)}`, data: { native: 'true' } }),
        ),
        h('hr', { class: 'divider' }),
        region({
          label: '生命周期',
          title: '当前处于哪个阶段',
          dense: true,
          body: lifecycleTimeline(event),
        }),
        region({
          label: '场次',
          title: event.sessions.length ? `${event.sessions.length} 个场次` : '尚未配置场次',
          actions: [button({ label: '添加场次', variant: 'ghost', size: 'sm', iconName: 'plus', onClick: () => openSessionDrawer(event, { onDone: reload }) })],
          dense: true,
          body: event.sessions.length
            ? h(
                'div',
                { class: 'sessions' },
                ...event.sessions.map((session) =>
                  h(
                    'div',
                    { class: 'session' },
                    h('span', { class: 'session__radio' }),
                    h(
                      'span',
                      { class: 'stack-1' },
                      h('b', { class: 't-secondary t-strong', text: fmt.dateRange(session.startAt, session.endAt) }),
                      h('span', { class: 't-caption', text: [session.location, session.checkinMethod, session.status].filter(Boolean).join(' · ') }),
                    ),
                    badge(`容量 ${session.capacity}`, { tone: 'neutral' }),
                  ),
                ),
              )
            : emptyState({
                iconName: 'clock',
                title: '这个活动还没有场次',
                description: '不配置场次时，报名会按活动整体容量计算。需要分批参加时请添加场次，名额会分别计算。',
                actions: [button({ label: '添加第一个场次', variant: 'primary', iconName: 'plus', onClick: () => openSessionDrawer(event, { onDone: reload }) })],
              }),
        }),
        noticeRegion(event, { onChanged: reload }),
        attachmentRegion(event),
        region({
          label: '关键信息',
          title: '时间与范围',
          dense: true,
          body: definitionList([
            ['报名窗口', `${fmt.fullDateTime(event.registrationStart)} → ${fmt.fullDateTime(event.registrationEnd)}`],
            ['活动时间', fmt.dateRange(event.startAt, event.endAt)],
            ['地点', [event.campus, event.location].filter(Boolean).join(' · ') || '未填写'],
            ['公开范围', event.visibility || '内部成员'],
          ]),
        }),
        notice('报名凭证明文只在创建响应中返回一次，SeaTable 只保存 SHA-256 摘要。核验时需要参与者出示二维码或凭证。', { tone: 'neutral', iconName: 'lock' }),
      ),
    );
  }

  const node = h(
    'div',
    { class: 'view wspad wspad--wide' },
    pageHead({
      label: '活动中心',
      title: '活动生命周期工作台',
      description: '创建 → 配置场次 → 发布 → 查看报名 → 候补递补 → 现场签到 → 结束核对，每一步都有明确的可执行动作。',
      actions: [button({ label: '新建活动', variant: 'primary', iconName: 'plus', onClick: () => openCreateEventDrawer({ onDone: () => dataRegion.reload() }) }), reloadAction(dataRegion, '刷新数据')],
    }),
    dataRegion,
  );

  return { title: '活动中心', crumb: '活动中心', node };
}
