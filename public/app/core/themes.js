import { prefs } from './store.js';

export const THEMES = {
  portal: [
    { id: 'dawn', name: '晨曦红', description: '温暖纸感 · 轻盈浮起', color: '#b91c37', background: '#fbf6f2', motion: 'lift' },
    { id: 'sail', name: '海风蓝', description: '清透留白 · 方向引导', color: '#175f9d', background: '#f1f7fc', motion: 'slide' },
    { id: 'garden', name: '青竹绿', description: '自然柔和 · 细腻舒展', color: '#17684f', background: '#f2f8f3', motion: 'soft' },
    { id: 'iris', name: '鸢尾紫', description: '柔光层次 · 焦点反馈', color: '#6744a5', background: '#f7f4fc', motion: 'glow' },
    { id: 'amber', name: '秋日金', description: '书页质感 · 安静线条', color: '#82570b', background: '#fcf8ee', motion: 'quiet' },
  ],
  console: [
    { id: 'porcelain', name: '瓷白朱红', description: '清晰分区 · 精准反馈', color: '#b91c37', background: '#f5f6f8', motion: 'quiet' },
    { id: 'blueprint', name: '蓝图工坊', description: '冷静网格 · 方向引导', color: '#175f9d', background: '#f0f5fa', motion: 'slide' },
    { id: 'botanic', name: '竹影工作室', description: '柔和圆角 · 轻盈层次', color: '#17684f', background: '#f2f7f4', motion: 'soft' },
    { id: 'atelier', name: '紫雾画室', description: '细腻光影 · 焦点反馈', color: '#6744a5', background: '#f5f3fa', motion: 'glow' },
    { id: 'archive', name: '暖金书房', description: '温暖秩序 · 克制线条', color: '#82570b', background: '#faf6ed', motion: 'quiet' },
  ],
};
export function resolveTheme(surface, id) {
  const list = THEMES[surface] || THEMES.portal;
  return list.find(theme => theme.id === id) || list[0];
}
const sessionThemes = new Map(), sessionMotion = new Map();
export function currentTheme(surface) { return resolveTheme(surface, sessionThemes.get(surface) ?? prefs.get(`theme.${surface}`)); }
export function themeMotionEnabled(surface) { return sessionMotion.get(surface) ?? (prefs.get(`motion.${surface}`, true) !== false); }
export function applyTheme(surface, documentRoot = document.documentElement) {
  const theme = currentTheme(surface);
  documentRoot.dataset.theme = theme.id;
  documentRoot.dataset.themeMotion = theme.motion;
  documentRoot.dataset.motion = themeMotionEnabled(surface) ? 'full' : 'reduced';
  document.querySelector('meta[name="theme-color"]')?.setAttribute('content', theme.background);
  return theme;
}
export function selectTheme(surface, id) {
  const theme = resolveTheme(surface, id);
  sessionThemes.set(surface, theme.id);
  prefs.set(`theme.${surface}`, theme.id);
  applyTheme(surface);
  return theme;
}
export function setThemeMotion(surface, enabled) {
  sessionMotion.set(surface, enabled);
  prefs.set(`motion.${surface}`, enabled);
  applyTheme(surface);
  if (!enabled) for (const animation of document.getAnimations?.() || []) {
    try { animation.finish(); } catch { animation.cancel(); }
  }
}
