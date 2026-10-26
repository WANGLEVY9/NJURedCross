/** One section map for rail, mobile navigation, shortcuts and legacy routes. */
export const CONSOLE_SECTIONS = Object.freeze([
  { path:'/console/overview', label:'总览', iconName:'gauge', description:'待办队列、运营概况与最近操作' },
  { path:'/console/admin', label:'管理员中心', iconName:'user', description:'我的账号、工作区偏好、系统状态与数据维护' },
  { path:'/console/events', label:'活动管理', iconName:'calendar', scope:'events', sharedEntry:true, description:'审批发布、名单结果、签到核验与志愿时长' },
  { path:'/console/outreach', label:'宣传管理', iconName:'megaphone', scope:'outreach', description:'投稿审核、排期与发布登记' },
  { path:'/console/community', label:'内建管理', iconName:'handshake', scope:'community', description:'生日祝福、早安晚安、审核与举报处理' },
  { path:'/console/materials', label:'物资管理', iconName:'box', scope:'materials', description:'借用审批、库存、出库归还与流水' },
  { path:'/console/messages', label:'红会留言墙', iconName:'quote', scope:'community', description:'留言整理、发布与下架' },
  { path:'/console/agent', label:'工作助手', iconName:'clipboard', description:'活动筹备、推文创作与美编建议' },
]);
export function consoleSection(pathname) {
  if (pathname === '/console/reimbursements' || pathname.startsWith('/console/reimbursements/')) return CONSOLE_SECTIONS.find(s => s.scope === 'materials');
  if (['/console/settings','/console/data'].some(path => pathname === path || pathname.startsWith(path+'/'))) return CONSOLE_SECTIONS[1];
  if (['/console/volunteers','/console/workflow'].some(path => pathname === path || pathname.startsWith(path+'/'))) return CONSOLE_SECTIONS[2];
  // v3 S7：宣传展示维护页是「宣传管理」下的子页，导航栏高亮归到宣传管理。
  if (pathname === '/console/showcase' || pathname.startsWith('/console/showcase/')) return CONSOLE_SECTIONS[3];
  return CONSOLE_SECTIONS.find(s => pathname === s.path || pathname.startsWith(s.path+'/')) || null;
}
export function visibleConsoleSections(canAccess) {
  return CONSOLE_SECTIONS.filter(s => s.sharedEntry || !s.scope || canAccess(s.scope));
}
