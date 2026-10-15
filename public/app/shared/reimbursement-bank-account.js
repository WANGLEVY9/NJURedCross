export const BANK_ACCOUNT_POLICY = Object.freeze({ minLength: 16, maxLength: 19 });

export function bankAccountError(value) {
  if (typeof value !== 'string' || !value) return '请填写本人的银行卡号';
  if (/\s/.test(value)) return '银行卡号不能含空格';
  if (!/^[0-9]+$/.test(value)) return '银行卡号只能填写数字';
  if (value.length < BANK_ACCOUNT_POLICY.minLength || value.length > BANK_ACCOUNT_POLICY.maxLength) return '银行卡号须为 16–19 位数字';
  return '';
}
