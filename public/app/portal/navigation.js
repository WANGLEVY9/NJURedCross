export const PORTAL_NAV = [
  { path: '/events', label: '活动广场', shortLabel: '活动', iconName: 'calendar', description: '发现活动、报名参与与现场签到' },
  { path: '/outreach', label: '宣传广场', shortLabel: '投稿', iconName: 'megaphone', description: '投稿专栏、影像作品、任务申领与宣传展示四大板块' },
  { path: '/community', label: '内建广场', shortLabel: '同伴', iconName: 'heart', description: '生日祝福与早安晚安，让同伴更亲近' },
  { path: '/materials', label: '财务物资广场', shortLabel: '财务物资', iconName: 'box', description: '了解借用流程，申请活动所需物资' },
  { path: '/me', label: '会员中心', shortLabel: '我的', iconName: 'user', description: '个人资料、参与记录与账号设置' },
];
export function portalSection(path) {
  if (path === '/workflow-events' || path === '/events' || path.startsWith('/events/')) return '/events';
  // 宣传展示（/showcase）与影像库（/photos）均归入公开宣传域，与投稿台并列。
  if (path === '/submit' || path === '/photos' || path === '/outreach' || path === '/showcase' || path === '/tasks') return '/outreach';
  if (path === '/warmth' || path === '/community' || path === '/morning' || path.startsWith('/morning/')) return '/community';
  if (path === '/materials') return '/materials';
  if (['/me', '/status', '/change-password', '/login', '/register', '/verify-email', '/reset-password'].includes(path)) return '/me';
  return null;
}
