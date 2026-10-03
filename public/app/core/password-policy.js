/** Shared by browser and server; existing passwords remain valid for sign-in. */
export const MIN_PASSWORD_LENGTH = 8;
export const MAX_PASSWORD_LENGTH = 72;
export const PASSWORD_HINT = '密码须为 8～72 位，同时包含大写字母、小写字母、数字和特殊符号（如 ! @ #）。';
export function passwordPolicyError(password) {
  if (typeof password !== 'string' || password.length < MIN_PASSWORD_LENGTH || password.length > MAX_PASSWORD_LENGTH) return PASSWORD_HINT;
  if (!/[A-Z]/.test(password) || !/[a-z]/.test(password) || !/[0-9]/.test(password) || !/[^\p{L}\p{N}\s]/u.test(password) || /[\u0000-\u001f\u007f]/.test(password)) return PASSWORD_HINT;
  return '';
}
export function realNameError(realName) {
  if (typeof realName !== 'string' || !/^[\p{L}\p{M}][\p{L}\p{M} .·’'-]{0,39}$/u.test(realName.trim())) return '请填写真实姓名（最多 40 个字符）。';
  return '';
}

export function registrationProfileError(realName, studentId) {
  const nameError = realNameError(realName);
  if (nameError) return nameError;
  if (typeof studentId !== 'string' || !/^[0-9]{6,20}$/.test(studentId.trim())) return '请填写真实学号（6～20 位数字）。';
  return '';
}
