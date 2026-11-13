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

本次联调版使用现有活动配置和项目表，接口投影无需先迁移 NJUTable。流程表关联列、历史回填、岗位 ID 持久化与迁移回滚属于 E6+A7 的后续交付。
