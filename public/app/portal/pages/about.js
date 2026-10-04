import {h} from '../../core/dom.js';
import {pageHead,panel,button,definitionList} from '../../ui/primitives.js';
export default async function aboutPage(){
 return {title:'关于平台',node:h('div',{class:'view portal-page container section stack-6'},
  pageHead({title:'南京大学红十字会',description:'参与校园公益活动，让关怀成为日常。'}),
  panel({title:'在这里可以做什么',body:definitionList([
   ['活动报名','浏览活动、选择场次，并在个人中心查看报名进度。'],
   ['志愿服务','提交签到、查看志愿时长和参与记录。'],
   ['物资借用','选择所需物资、提交借用申请，按约定归还。'],
   ['内容投稿','分享稿件、摄影和设计作品。'],
   ['温暖连接','参加祝福与同行计划，随时调整参与方式。'],
  ])}),
  panel({title:'联系与反馈',body:h('p',{class:'t-prose',text:'活动安排、报名调整或资料更正，请联系对应活动负责人；其他问题可联系红十字会负责同学。'})}),
  h('div',{class:'row-3 row-wrap'},button({label:'浏览活动',variant:'primary',href:'/events'}),button({label:'返回首页',href:'/'})))};
}
