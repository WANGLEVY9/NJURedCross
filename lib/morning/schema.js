import { MORNING_CARD_TABLE, MORNING_COMMENT_TABLE } from './shared.js';
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
    purpose: '成员对已通过名片发表评论，并记录发信与联系方式公开选择',
    columns: [
      '评论ID', '名片ID', '评论人账号ID', '内容', '状态',
      '是否发邮件', '公开学号', '公开邮箱', '公开QQ', '公开微信',
      '创建时间', '更新时间',
    ],
  },
  {
    name: MORNING_TAG_TABLE,
    purpose: '早安晚安兴趣标签词条库，保存预设之外的成员新建标签',
    columns: ['标签ID', '标签', '来源账号ID', '状态', '创建时间', '更新时间'],
  },
]);
