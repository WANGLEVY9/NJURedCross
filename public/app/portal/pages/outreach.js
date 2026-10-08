import { h, icon } from '../../core/dom.js';
import { button } from '../../ui/primitives.js';

/* 宣传域四板块（要求1）：文字稿件 · 影像作品 · 文创设计 · 宣传展示
   四个板块以同等层级并列呈现（2×2 卡片网格），各自直达独立页面：
     · 文字稿件  → /submit?kind=article
     · 影像作品  → /photos
     · 文创设计  → /submit?kind=design
     · 宣传展示  → /showcase（展示墙独立成页，与其余三者同级）
   本页只做四通道入口，不再内嵌展示墙内容流。 */

const CHANNELS = [
  { title: '文字稿件', iconName: 'file', description: '实名投稿、绑定劳务费的稿件通道。', detail: '活动通讯 · 人物专访 · 科普短文', link: '/submit?kind=article', action: '创作与投稿' },
  { title: '影像作品', iconName: 'camera', description: '按中心与活动归档上传现场照片，支持批量整理。', detail: '中心归档 · 留用标记 · 批量更名', link: '/photos', action: '进入影像库' },
  { title: '文创设计', iconName: 'sparkle', description: '以笔名投稿的周边与视觉设计。', detail: '活动海报 · 周边设计 · 视觉方案', link: '/submit?kind=design', action: '创作与投稿' },
  { title: '宣传展示', iconName: 'megaphone', description: '公众号文章与精选链接汇成一块公开展示墙。', detail: '公开可见 · 分组卡片 · 点击直达原文', link: '/showcase', action: '浏览展示墙' },
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
          h('h2', { class: 't-h2', text: '投稿、影像、设计、展示' }))),
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
