/**
 * 活动报名通知：固定框架 → 报名通知。
 *
 * 设计目标：
 *   · `renderRegistrationNotice` 是纯函数，无 I/O，便于单测。
 *   · 缺失字段不阻断生成，只在 `missing` 里标出，交给前端提示。
 *   · `buildNoticeRow` 把渲染结果 + 元数据组装成「活动通知表」的 SeaTable 行，
 *     同样无 I/O（编号由调用方传入，避免在纯函数里引入随机性）。
 *
 * 契约见 .workbuddy/parallel-contract.md §3。
 */

export const NOTICE_TABLE = '活动通知表';
export const NOTICE_COLUMNS = [
  '通知ID', '活动ID', '活动名称', '活动类别', '活动时间', '活动地点',
  '报名窗口', '正文', '状态', '生成人', '生成时间', '发布时间', '备注',
];

const STATUS_DRAFT = '草稿';

function trim(value) {
  return typeof value === 'string' ? value.trim() : '';
}

function joinNonEmpty(values, separator = ' ') {
  return values.map((value) => trim(value)).filter(Boolean).join(separator).trim();
}

/**
 * 纯函数：固定框架 → 报名通知。
 * @param {object} input { name, category, campus, location, startAt, endAt,
 *   registrationStart, registrationEnd, capacity, content, contact, qqGroup }
 * @returns {{ title:string, body:string, sections:Array, missing:string[] }}
 */
export function renderRegistrationNotice(input = {}) {
  const data = input || {};
  const name = trim(data.name);
  const category = trim(data.category);
  const campus = trim(data.campus);
  const location = trim(data.location);
  const startAt = trim(data.startAt);
  const endAt = trim(data.endAt);
  const registrationStart = trim(data.registrationStart);
  const registrationEnd = trim(data.registrationEnd);
  const capacity = Number(data.capacity || 0);
  const content = trim(data.content);
  const contact = trim(data.contact);
  const qqGroup = trim(data.qqGroup);

  // 缺失的必填项（供前端提示）。位置/时间需要校区+地点两个字段共同决定。
  const missing = [];
  if (!name) missing.push('活动名称');
  if (!joinNonEmpty([campus, location])) missing.push('活动地点');
  if (!startAt || !endAt) missing.push('活动时间');
  if (!registrationStart || !registrationEnd) missing.push('报名时间');
  if (!Number.isFinite(capacity) || capacity <= 0) missing.push('报名名额');
  if (!contact) missing.push('联系人');
  if (!qqGroup) missing.push('答疑群');

  const timeText = joinNonEmpty([startAt, endAt], ' 至 ');
  const placeText = joinNonEmpty([campus, location]);
  const windowText = joinNonEmpty([registrationStart, registrationEnd], ' 至 ');
  const capacityText = Number.isFinite(capacity) && capacity > 0 ? `${capacity} 人` : '（未填写）';
  const contactText = joinNonEmpty([`联系人：${contact}`, `答疑 QQ 群：${qqGroup}`]);
  const bodyContent = content || '（详见活动详情，请关注后续通知）';

  const title = `【活动报名】${name || '未命名活动'}`;

  const body = [
    `${title}`,
    '',
    '各位同学：',
    '',
    `南京大学红十字会将举办「${name || '本次活动'}」，欢迎大家报名参与。活动具体安排如下：`,
    '',
    '一、活动时间',
    timeText || '（未填写）',
    '',
    '二、活动地点',
    placeText || '（未填写）',
    '',
    '三、报名时间',
    windowText || '（未填写）',
    '',
    '四、报名名额',
    `本次开放 ${capacityText}名额，报满即止。`,
    '',
    '五、联系人与答疑群',
    contactText || '（未填写）',
    '',
    '六、活动内容',
    bodyContent,
    '',
    '七、报名方式',
    '请登录南京大学红十字会平台，在「活动中心」找到本活动完成线上报名；报名成功后将自动生成个人签到二维码，活动现场凭二维码签到。',
    '',
    '南京大学红十字会',
  ].join('\n');

  const sections = [
    { label: '活动时间', value: timeText || '（未填写）' },
    { label: '活动地点', value: placeText || '（未填写）' },
    { label: '报名时间', value: windowText || '（未填写）' },
    { label: '报名名额', value: capacityText },
    { label: '联系人与答疑群', value: contactText || '（未填写）' },
    { label: '活动内容', value: bodyContent },
    { label: '报名方式', value: '登录平台「活动中心」线上报名，报名成功后生成个人签到二维码，现场凭码签到。' },
  ];

  return { title, body, sections, missing };
}

/**
 * 把渲染结果组装为「活动通知表」的一行。纯函数，无 I/O。
 * @returns {object} SeaTable 行（含业务字段，不含 _id）
 */
export function buildNoticeRow({ rendered, input, eventId, generator, noticeId, status = STATUS_DRAFT }) {
  const data = input || {};
  const timeRange = joinNonEmpty([trim(data.startAt), trim(data.endAt)], ' ~ ');
  const place = joinNonEmpty([trim(data.campus), trim(data.location)]);
  const windowRange = joinNonEmpty([trim(data.registrationStart), trim(data.registrationEnd)], ' ~ ');
  const nowIso = new Date().toISOString();
  return {
    通知ID: trim(noticeId),
    活动ID: trim(eventId),
    活动名称: trim(data.name),
    活动类别: trim(data.category),
    活动时间: timeRange,
    活动地点: place,
    报名窗口: windowRange,
    正文: rendered?.body || '',
    状态: status,
    生成人: trim(generator),
    生成时间: nowIso,
    发布时间: status === '已发布' ? nowIso : '',
    备注: '',
  };
}
