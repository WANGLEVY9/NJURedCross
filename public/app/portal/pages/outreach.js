import { h, icon } from '../../core/dom.js';
import { button } from '../../ui/primitives.js';

/* 宣传域四板块（v3 第 13 项）：投稿专栏 · 影像作品 · 任务申领 · 宣传展示
   四个板块以同等层级并列呈现（2×2 卡片网格），各自直达独立页面：
     · 投稿专栏  → /submit   （页内顶部标签切换「文字投稿 / 文创设计」两入口，方案 A）
     · 影像作品  → /photos
     · 任务申领  → /tasks    （替代原「文创设计」大板块，文创设计已并入投稿专栏）
     · 宣传展示  → /showcase
   本页只做四通道入口，不再内嵌展示墙内容流。 */

const CHANNELS = [
  { title: '投稿专栏', iconName: 'edit', description: '文字投稿与文创设计两个入口，同一页切换提交。', detail: '文字稿件 · 文创设计 · 笔名或实名', link: '/submit', action: '进入投稿' },
  { title: '影像作品', iconName: 'camera', description: '按中心与活动归档上传现场照片，支持批量整理与精选。', detail: '中心归档 · 留用标记 · 精选送审', link: '/photos', action: '进入影像库' },
  { title: '任务申领', iconName: 'sparkle', description: '认领宣传任务，按技能星级匹配心愿清单。', detail: '任务发布 · 心愿清单 · 星级匹配', link: '/tasks', action: '查看任务' },
  { title: '宣传展示', iconName: 'megaphone', description: '公众号推文与文创作品汇成一块公开展示墙。', detail: '公开可见 · 分组卡片 · 点击直达原文', link: '/showcase', action: '浏览展示墙' },
];

export default async function outreachPage() {
  const node = h('div', { class: 'view' },
    h('section', { class: 'psection square-intro' },
      h('p', { class: 't-label', text: '宣传广场' }),
      h('h1', { class: 't-h1', text: '让热心被看见，让故事被记住' }),
      h('p', { class: 't-prose', text: '分享活动记录、影像与创意，一起记录南京大学红十字会的校园日常。' }),
      h('div', { class: 'row-3 row-wrap' },
        button({ label: '开始投稿', href: '/submit', variant: 'primary', iconName: 'plus' }),
        button({ label: '上传活动照片', href: '/photos', variant: 'secondary', iconName: 'camera' }))),
    h('section', { class: 'psection psection--tight' },
      h('div', { class: 'psection__head' },
        h('div', { class: 'psection__head-text' },
          h('p', { class: 't-label', text: '四大板块' }),
          h('h2', { class: 't-h2', text: '投稿、影像、任务、展示' }))),
      h('div', { class: 'square-grid' }, ...CHANNELS.map((channel) =>
        h('a', { class: 'square-card', href: channel.link },
          h('span', { class: 'square-card__icon' }, icon(channel.iconName, 'ico ico--lg')),
          h('h2', { class: 't-h2', text: channel.title }),
          h('p', { class: 't-secondary', text: channel.description }),
          h('p', { class: 't-caption', text: channel.detail }),
          h('span', { class: 'square-card__action' }, h('span', { text: channel.action }), icon('arrowRight', 'ico ico--sm')))))) ,
  );

  return { title: '宣传广场', node };
}
