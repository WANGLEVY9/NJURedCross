import { MORNING_BLACKLIST_TABLE, MORNING_CARD_TABLE, MORNING_COMMENT_TABLE, MORNING_INVITE_TABLE, MORNING_REVISION_TABLE } from './shared.js';
import { MORNING_TAG_TABLE } from './tags.js';

export const MORNING_SCHEMA = Object.freeze([
  {
    name: MORNING_CARD_TABLE,
    purpose: '注册成员提交公开名片，管理员审核通过后再进入广场；真实身份字段仅用于审核与归属，不在广场公开',
    columns: [
      '名片ID', '账号ID', '真实姓名快照', '学号快照', '性别快照', '院系快照', '年级快照',
      '展示院系', '展示年级', '校区', '昵称', '兴趣标签',
      '备注', '允许评论邮件', '审核状态', '审核意见', '审核人', '审核时间', '提交时间', '发布时间', '更新时间',
    ],
  },
  {
    name: MORNING_INVITE_TABLE,
    purpose: '记录好友邀约、三天反馈令牌摘要、邮件结果与成功结识回执；不保存公开评论',
    columns: [
      '邀约ID', '名片ID', '发起人校区', '发起人账号ID', '发起人昵称', '发起人邮箱',
      '收件人账号ID', '收件人昵称', '收件人邮箱', '邀约附言', '状态', '邮件状态',
      '反馈令牌哈希', '过期时间', '反馈时间', '反馈人账号ID', '协调人通知状态', '创建时间', '更新时间',
    ],
  },
  {
    name: MORNING_REVISION_TABLE,
    purpose: '已发布名片的待审核资料修订；审核通过前保留原广场名片，通过后覆盖公开字段',
    columns: [
      '修订ID', '名片ID', '账号ID', '真实姓名快照', '学号快照', '性别快照',
      '院系快照', '年级快照', '展示院系', '展示年级', '校区', '昵称', '兴趣标签', '备注',
      '审核状态', '审核意见', '审核人', '审核时间', '提交时间', '更新时间',
    ],
  },
  {
    name: MORNING_COMMENT_TABLE,
    purpose: '历史评论与举报记录保留，不再提供公众评论入口',
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
