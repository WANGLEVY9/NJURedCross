import { MORNING_BLACKLIST_TABLE, MORNING_CARD_TABLE, MORNING_COMMENT_TABLE } from './shared.js';
import { MORNING_TAG_TABLE } from './tags.js';

export const MORNING_SCHEMA = Object.freeze([
  {
    name: MORNING_CARD_TABLE,
    purpose: '注册成员提交公开名片，管理员审核通过后再进入广场；真实身份字段仅用于审核与归属，不在广场公开',
    columns: [
      '名片ID', '账号ID', '真实姓名快照', '学号快照', '性别快照', '校区', '昵称', '兴趣标签',
      '备注', '允许评论邮件', '审核状态', '审核意见', '审核人', '审核时间', '提交时间', '发布时间', '更新时间',
    ],
  },
  {
    name: MORNING_COMMENT_TABLE,
    purpose: '成员对已通过名片发表评论，并记录发信、联系方式公开选择与名片本人举报结果',
    columns: [
      '评论ID', '名片ID', '评论人账号ID', '内容', '状态',
      '是否发邮件', '公开学号', '公开邮箱', '公开QQ', '公开微信',
      '举报状态', '举报人账号ID', '举报原因', '举报时间', '处理人', '处理时间', '处理意见',
      '创建时间', '更新时间',
    ],
  },
  {
    name: MORNING_TAG_TABLE,
    purpose: '早安晚安兴趣标签词条库，保存预设之外的成员新建标签',
    columns: ['标签ID', '标签', '来源账号ID', '状态', '创建时间', '更新时间'],
  },
  {
    name: MORNING_BLACKLIST_TABLE,
    purpose: '管理员拉黑的早安晚安成员；拉黑时撤下现有名片，解除后需重新报名',
    columns: [
      '黑名单ID', '账号ID', '昵称快照', '真实姓名快照', '学号快照', '原因', '来源',
      '状态', '操作人', '拉黑时间', '解除时间', '更新时间',
    ],
  },
]);
