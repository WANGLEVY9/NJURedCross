import { h, icon } from '../../core/dom.js';
import { button } from '../../ui/primitives.js';

/* 课程反馈投稿已在 v2 下线；影像作品迁移到独立影像库（/photos），
   文字稿件与文创设计共用 /submit 的双轨工作台。 */
const CHANNELS = [
  ['宣传稿件', 'file', '文字稿件', '实名投稿、绑定劳务费的稿件通道。', '活动通讯 · 人物专访 · 科普短文', '/submit?kind=article'],
  ['影像作品', 'eye', '影像作品', '按活动归档上传现场照片，支持批量整理。', '活动归档 · 留用标记 · 批量更名', '/photos'],
  ['文创设计', 'sparkle', '文创设计', '以笔名投稿的周边与视觉设计。', '活动海报 · 周边设计 · 视觉方案', '/submit?kind=design'],
];
export default async function outreachPage() {
  return { title: '宣传广场', node: h('div', {class:'view'},
    h('section',{class:'psection square-intro'},
      h('p',{class:'t-label',text:'宣传广场'}),
      h('h1',{class:'t-h1',text:'让热心被看见，让故事被记住'}),
      h('p',{class:'t-prose',text:'分享活动记录、影像与创意，一起记录南京大学红十字会的校园日常。'}),
      h('div',{class:'row-3 row-wrap'},button({label:'开始投稿',href:'/submit',variant:'primary',iconName:'plus'}),button({label:'上传活动照片',href:'/photos',variant:'secondary',iconName:'camera'}),button({label:'看看展示墙',href:'/showcase',variant:'ghost',iconName:'star'}))),
    h('section',{class:'psection psection--tight'},
      h('div',{class:'square-grid'},...CHANNELS.map(([category,iconName,title,description,detail,link])=>
        h('a',{class:'square-card',href:link},
          h('span',{class:'square-card__icon'},icon(iconName,'ico ico--lg')),
          h('h2',{class:'t-h2',text:title}),h('p',{class:'t-secondary',text:description}),
          h('p',{class:'t-caption',text:detail}),h('span',{class:'square-card__action'},h('span',{text:category==='影像作品'?'进入影像库':'创作与投稿'}),icon('arrowRight','ico ico--sm')))))),
  ) };
}
