import { h, icon } from '../../core/dom.js';
import { button } from '../../ui/primitives.js';

const CHANNELS = [
  ['宣传稿件', 'file', '文字稿件', '记录一场活动，也分享一个值得被看见的故事。', '活动通讯 · 人物专访 · 科普短文'],
  ['影像作品', 'eye', '影像作品', '用照片与视频，留住服务现场的温度。', '现场摄影 · 短视频 · 纪实记录'],
  ['文创设计', 'sparkle', '文创设计', '让创意成为红会活动里独特的记忆。', '活动海报 · 周边设计 · 视觉方案'],
  ['课程反馈', 'heart', '课程反馈', '分享学习感受，让下一次课程更好。', '急救培训 · 生命教育 · 改进建议'],
];
export default async function outreachPage() {
  return { title: '宣传广场', node: h('div', {class:'view'},
    h('section',{class:'psection square-intro'},
      h('p',{class:'t-label',text:'宣传广场'}),
      h('h1',{class:'t-h1',text:'让热心被看见，让故事被记住'}),
      h('p',{class:'t-prose',text:'分享活动记录、影像与创意，一起记录南京大学红十字会的校园日常。'}),
      h('div',{class:'row-3 row-wrap'},button({label:'开始投稿',href:'/submit',variant:'primary',iconName:'plus'}),button({label:'我的投稿记录',href:'/me',variant:'secondary',iconName:'file'}))),
    h('section',{class:'psection psection--tight'},
      h('div',{class:'square-grid'},...CHANNELS.map(([category,iconName,title,description,detail])=>
        h('a',{class:'square-card',href:`/submit?category=${encodeURIComponent(category)}`},
          h('span',{class:'square-card__icon'},icon(iconName,'ico ico--lg')),
          h('h2',{class:'t-h2',text:title}),h('p',{class:'t-secondary',text:description}),
          h('p',{class:'t-caption',text:detail}),h('span',{class:'square-card__action'},h('span',{text:'创作与投稿'}),icon('arrowRight','ico ico--sm')))))),
  ) };
}
