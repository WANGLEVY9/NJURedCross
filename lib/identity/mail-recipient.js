/**
 * 会员「收信邮箱」的读取与校验。
 *
 * 校园邮箱（account.email）是身份锚点：注册、验证码、找回密码、管理员审核
 * 都必须继续用它。收信邮箱只用于「平台发给会员本人」的各类通知邮件，
 * 未配置或内容非法时静默回退到校园邮箱，绝不让一封邮件因为配置错误消失。
 */

export const NOTIFICATION_EMAIL_MAX = 160;
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function isValidDeliveryEmail(value) {
  const text = String(value ?? '').trim();
  return text.length > 0 && text.length <= NOTIFICATION_EMAIL_MAX
    && !/[\r\n,;]/.test(text) && EMAIL.test(text);
}

/** 账号对象（accountFromRow / sessionPayload 的形状）→ 实际投递地址。 */
export function mailRecipient(account) {
  const preferred = String(account?.notificationEmail ?? '').trim();
  return isValidDeliveryEmail(preferred) ? preferred : String(account?.email ?? '').trim();
}

/** SeaTable 原始行（列名为中文）→ 实际投递地址，供只读 SQL 路径复用。 */
export function mailRecipientFromRow(row) {
  return mailRecipient({ notificationEmail: row?.['收信邮箱'], email: row?.['邮箱'] });
}

/** 表单/接口校验：空串合法（表示使用注册邮箱），非空必须格式正确。 */
export function notificationEmailError(value) {
  if (value === undefined || value === null) return '';
  if (typeof value !== 'string') return '收信邮箱格式不正确。';
  const text = value.trim();
  if (!text) return '';
  if (text.length > NOTIFICATION_EMAIL_MAX) return '收信邮箱不能超过 160 个字符。';
  if (!isValidDeliveryEmail(text)) return '请填写有效的收信邮箱，或留空使用校园邮箱。';
  return '';
}
