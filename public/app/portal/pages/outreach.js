import { h, icon } from '../../core/dom.js';
import { button } from '../../ui/primitives.js';
import { plazaHeader, serviceFlow } from '../plaza-layout.js';

/* 宣传域四板块（v3 第 13 项）：投稿专栏 · 影像作品 · 任务申领 · 宣传展示
   四个板块以同等层级并列呈现，各自直达独立页面：
     · 投稿专栏  → /submit   （页内顶部标签切换「文字投稿 / 文创设计」两入口，方案 A）
     · 影像作品  → /photos
     · 任务申领  → /tasks    （替代原「文创设计」大板块，文创设计已并入投稿专栏）
     · 宣传展示  → /showcase
   本页只做四通道入口，不再内嵌展示墙内容流。
   注：v2 起「课程反馈」投稿模块已彻底移除，此处不再列出。 */

const CHANNELS = [
  { title: '投稿专栏', iconName: 'edit', description: '文字投稿与文创设计两个入口，同一页切换提交。', detail: '文字稿件 · 文创设计 · 笔名或实名', link: '/submit' },
  { title: '影像作品', iconName: 'camera', description: '按中心与活动归档上传现场照片，支持批量整理与精选。', detail: '中心归档 · 留用标记 · 精选送审', link: '/photos' },
  { title: '任务申领', iconName: 'sparkle', description: '认领宣传任务，按技能星级匹配心愿清单。', detail: '任务发布 · 心愿清单 · 星级匹配', link: '/tasks' },
  { title: '宣传展示', iconName: 'megaphone', description: '公众号推文与文创作品汇成一块公开展示墙。', detail: '公开可见 · 分组卡片 · 点击直达原文', link: '/showcase' },
];

export default async function outreachPage() {
  return { title: '宣传广场', node: h('div', { class: 'view plaza-page outreach-page' },
    h('div', { class: 'plaza-frame' },
      plazaHeader({ label: '宣传广场', title: '让热心被看见，让故事被记住', description: '分享活动记录、影像与创意，一起记录红会的校园日常。', iconName: 'megaphone',
        actions: [button({ label: '开始投稿', href: '/submit', variant: 'primary', iconName: 'plus' }), button({ label: '我的投稿', href: '/me?view=records', variant: 'secondary', iconName: 'file' })] }),
      h('section', { class: 'plaza-section', aria: { label: '选择板块' } },
        h('div', { class: 'plaza-section__head' }, h('h2', { class: 't-h2', text: '你想做什么？' }), h('p', { class: 't-caption', text: '四个板块各自独立，点击直达。' })),
        h('div', { class: 'outreach-channels' }, ...CHANNELS.map((channel) =>
          h('a', { class: 'outreach-channel', href: channel.link },
            h('span', { class: 'outreach-channel__icon' }, icon(channel.iconName, 'ico ico--lg')),
            h('div', { class: 'outreach-channel__body' }, h('h3', { class: 't-h2', text: channel.title }), h('p', { class: 't-secondary', text: channel.description }), h('p', { class: 't-caption', text: channel.detail })),
            h('span', { class: 'outreach-channel__action' }, h('span', { text: '前往' }), icon('arrowRight', 'ico ico--sm')))))),
      serviceFlow([
        { title: '选择板块', description: '准备稿件、照片或认领任务。', iconName: 'file' },
        { title: '提交审核', description: '由负责同学确认内容。', iconName: 'check' },
        { title: '查看进度', description: '在会员中心查看审核结果。', iconName: 'inbox' },
      ], '流程')),
  ) };
}
