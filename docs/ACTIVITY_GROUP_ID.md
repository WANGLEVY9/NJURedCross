# 活动组 ID 联调说明

邹偲慧的 A2「三套名单合一」可以从管理端活动接口读取 `events[].groupId`，用它识别同一个活动下的多个岗位或场次。这个字段是服务端返回的字符串，同组场次的值相同。关系异常、配置损坏或已被源表替代的活动行返回 `null`，这类行应单独显示并等待核对。

| 读取入口 | 组 ID 的位置 |
| --- | --- |
| `GET /api/volunteer/workflow/catalog` | `events[].groupId`，含有权限查看的只读条目 |
| `GET /api/volunteer/workflow/workspace?event=<id>` | `events[].groupId` 与 `detail.events[].groupId` |
| `GET /api/volunteer/workflow/events/<id>/detail` | `events[].groupId` |
| `GET /api/volunteer/workflow/events/<id>/information` | `events[].groupId`，仅基本信息 |
| `GET /api/volunteer/workflow` | `events[].groupId`，适用于仍用原工作流接口的名单入口 |

请求中的 `<id>` 继续使用目录活动行的 `_id`。关联报名时，用报名行的 `活动ID` 匹配场次行的 `活动ID`；批量处理仍使用报名行的 `_id`。名单范围和按钮权限沿用现有接口判断。即使两条记录组 ID 相同，也应从已授权的详情读取名单。

```json
{
  "events": [
    { "_id": "event-parent", "活动ID": "WF-DEMO", "groupId": "ordinary:PROJECT-WF-DEMO" },
    { "_id": "event-shift", "活动ID": "PS-DEMO", "groupId": "ordinary:PROJECT-WF-DEMO" }
  ],
  "registrations": [
    { "_id": "registration-row", "活动ID": "PS-DEMO" }
  ]
}
```

- 普通多岗位活动用现有项目表 ID。新建多岗位活动在生成首批岗位前就返回与生成后相同的组 ID。普通单场独立成组。
- 专项排班按保存的排班根 ID 和周次分组。献血车优先使用服务端已确定的周起始标识。缺少周标识的历史献血车数据继续按原周次规则兼容。
- 客户端按完整字符串比较即可。字段中的前缀用于区分项目类型，同组的岗位和报名记录仍各有自己的 ID。

流程表的「活动组ID」是普通活动到项目表的关联键。周排班在该列保存自己的周分组标识；实时生成的献血车班次在源数据投影时携带该标识。旧表还没有此列或尚未回填的行，继续用已有配置兼容读取。单场活动不造项目表记录。

岗位身份沿用已保存的子活动「活动ID」，旧 ID 原样保留。新增岗位分配一次 ID，先记录到岗位安排或编辑回执，保存失败后沿用同一 ID 重试。复制岗位会取得新 ID。保存只更新发生变化的岗位和报名显示字段；只有本次明确移出原安排的活动岗位才会退出，原有报名与时长保护仍有效。

## 独立测试库演练

用隔离的志愿测试库及其环境文件，通过「会员大会」真实副本的活动 ID 选中项目；不要用名称猜组。下列命令中的大写占位符应替换成实际值。脚本自动校验认证返回的库 UUID，写入命令只接受代码指定的测试库。

~~~text
node --env-file=TEST_ENV scripts/migrate-activity-groups.mjs --activity-id=ACTIVITY_ID
node --env-file=TEST_ENV scripts/run-coordinated-script.mjs migrate-activity-groups.mjs --apply --activity-id=ACTIVITY_ID --expect-digest=PREVIEW_DIGEST --snapshot=PRIVATE_ABSOLUTE_PATH --confirm=ACTIVITY-GROUP-TEST
node --env-file=TEST_ENV scripts/run-coordinated-script.mjs migrate-activity-groups.mjs --rollback --snapshot=PRIVATE_ABSOLUTE_PATH --confirm=ACTIVITY-GROUP-TEST
~~~

1. 首次只读检查时确认没有关系冲突、报名和时长业务行不会被改动。同时记录活动原有的岗位、活动 ID、报名关联和审批状态。
2. 核对预览摘要再执行回填。快照保存在仓库外，先写快照再加列或更新单元格。运行中断时，用同一个快照和「--resume」重试。
3. 用管理端打开该历史活动，核对岗位分组、人数、报名关联和审批状态。回滚后再打开核对一次。回滚仅恢复本次填过的空值，保留新增的空列；已有组值、报名、签到和时长不会被覆盖。演练期间暂停对所选项目手工写表。
