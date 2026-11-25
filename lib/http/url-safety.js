/**
 * 运营配置中的外链必须先过这一层再进入页面。
 *
 * 前端只负责渲染，不能把 SeaTable / 抓取结果里的字符串直接当作可信链接：
 * javascript:、data:、file: 以及带账号密码的地址都可能在运营误填或数据被篡改时
 * 变成点击即执行的入口。这里统一限定为普通的 http(s) URL。
 */
export function isSafeExternalUrl(value) {
  if (typeof value !== 'string') return false;
  const text = value.trim();
  if (!text || /[\u0000-\u001f\u007f]/.test(text)) return false;
  let url;
  try {
    url = new URL(text);
  } catch {
    return false;
  }
  return ['http:', 'https:'].includes(url.protocol)
    && !url.username
    && !url.password;
}

export function safeExternalUrl(value) {
  return isSafeExternalUrl(value) ? value.trim() : null;
}
