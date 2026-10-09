import { h, icon } from '../../core/dom.js';
import { button } from '../../ui/primitives.js';
import { plazaHeader, serviceFlow } from '../plaza-layout.js';

const CHANNELS = [
  ['宣传稿件', 'file', '文字稿件', '记录一场活动，也分享一个值得被看见的故事。', '活动通讯、人物专访、科普短文'],
  ['影像作品', 'eye', '影像作品', '用照片与视频，留住服务现场的温度。', '现场摄影、短视频、纪实记录'],
  ['文创设计', 'sparkle', '文创设计', '让创意成为红会活动里独特的记忆。', '活动海报、周边设计、视觉方案'],
  ['课程反馈', 'heart', '课程反馈', '分享学习感受，让下一次课程更好。', '急救培训、生命教育、改进建议'],
];
export default async function outreachPage() {
  return { title: '宣传广场', node: h('div', { class: 'view plaza-page outreach-page' },
    h('div', { class: 'plaza-frame' },
      plazaHeader({ label: '宣传广场', title: '让热心被看见，让故事被记住', description: '分享活动记录、影像与创意，一起记录红会的校园日常。', iconName: 'megaphone',
        actions: [button({ label: '开始投稿', href: '/submit', variant: 'primary', iconName: 'plus' }), button({ label: '我的投稿', href: '/me?view=records', variant: 'secondary', iconName: 'file' })] }),
      h('section', { class: 'plaza-section', aria: { label: '选择投稿类型' } },
        h('div', { class: 'plaza-section__head' }, h('h2', { class: 't-h2', text: '你想分享什么？' }), h('p', { class: 't-caption', text: '选择类型，直接开始创作。' })),
        h('div', { class: 'outreach-channels' }, ...CHANNELS.map(([category, iconName, title, description, detail]) =>
          h('a', { class: 'outreach-channel', href: `/submit?category=${encodeURIComponent(category)}` },
            h('span', { class: 'outreach-channel__icon' }, icon(iconName, 'ico ico--lg')),
            h('div', { class: 'outreach-channel__body' }, h('h3', { class: 't-h2', text: title }), h('p', { class: 't-secondary', text: description }), h('p', { class: 't-caption', text: detail })),
            h('span', { class: 'outreach-channel__action' }, h('span', { text: '开始创作' }), icon('arrowRight', 'ico ico--sm')))))),
      serviceFlow([
        { title: '选择类型', description: '准备稿件、作品或反馈。', iconName: 'file' },
        { title: '提交审核', description: '由负责同学确认内容。', iconName: 'check' },
        { title: '查看进度', description: '在会员中心查看审核结果。', iconName: 'inbox' },
      ], '投稿流程')),
  ) };
}
