/** Plain-text success mail. Preview and delivery use the same token expansion. */
export const successMailDefaults = {
  subject: '南大红会｜{活动名称}报名成功',
  text: '{姓名}同学：\n你报名的{活动名称}：报名成功。\n活动时间：{日期} {时段}\n服务地点：{地点}\n请按时参加活动，并登录平台查看详情。',
};
const tokens = ['姓名','活动名称','日期','时段','地点'];
export function validateSuccessMail(value) {
  if (value === null) return null;
  if (!value || typeof value !== 'object' || Array.isArray(value) || Object.keys(value).some(k => !['subject','text'].includes(k))) throw new Error('邮件内容格式无效');
  const {subject,text} = value;
  if (typeof subject !== 'string' || !subject.trim() || subject.length > 120 || /[\r\n]/.test(subject)) throw new Error('邮件主题须为1至120字的单行文本');
  if (typeof text !== 'string' || !text.trim() || text.length > 5000) throw new Error('邮件正文须为1至5000字');
  for (const match of (subject + text).matchAll(/\{([^{}]+)\}/g)) if (!tokens.includes(match[1])) throw new Error('不支持的邮件变量：' + match[1]);
  return {subject:subject.trim(),text:text.trim()};
}
export function renderSuccessMail(template,event,row={}) {
  if(!template)return {subject:`南大红会｜${event['活动名称']}报名结果`,text:`${row['姓名']||'志愿者'}同学：\n你报名的${event['活动名称']}：报名成功。\n${row['处理说明']||'请按时参加活动。'}\n请登录平台查看详情。`};
  const values = {'姓名':row['姓名'] || '志愿者','活动名称':event['活动名称'] || '', '日期':event['报名日期'] || '', '时段':event['报名时段'] || '', '地点':event['地点'] || ''};
  const expand = text => text.replace(/\{(姓名|活动名称|日期|时段|地点)\}/g, (_,key) => values[key]);
  return {subject:expand(template.subject).replace(/[\r\n]+/g,' '),text:expand(template.text)};
}
