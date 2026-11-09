# A1 活动权限链路对照表

权限分两层。账号的「权限范围」决定管理端板块。活动服务再按可信的地区、组织类别、负责人和终审名单裁决具体操作。页面用会话返回的权限显示入口；接口仍单独校验，写入时重新读取账号和活动证据。

| 角色 | 页面和目录 | 创建、修改与报名处理 | 终审、发布与时长 |
| --- | --- | --- | --- |
| 超级管理员 | 全部管理模块和活动目录 | 可跨地区管理；草稿阶段、活动状态和时长锁仍适用 | 可跨地区处理；设置了本次审批名单时仍须遵守名单，其他状态与版本校验照常 |
| 普通管理员（只有模块授权） | 共用入口与已配置模块；活动目录与基本信息可只读查看 | 单独配置 `events` 只开放模块权限；还需地区／类别角色或该活动的负责人授权 | 不因拥有 `events` 自动取得初审、终审或发布权 |
| 活动负责人／主任 | 普通管理员须有 `events`；地区与类别来自可信名单 | 主任在分管地区、类别发起；草稿和新版活动写操作再核对负责人、共同负责人和当前阶段 | 可对本人负责的项目做时长初审；终审和发布另需相应资格 |
| 主席团／地区终审人 | 普通管理员须有 `events`；南京按分管类别，苏州按对应地区授权 | 在分管范围内按既有活动规则操作；对具体项目仍核对状态和操作资格 | 按地区、类别和本次审批名单终审，在授权范围发布；仅有终审资格不等于能代做负责人初审 |

普通成员默认使用公众端。已经存在的可信组织或负责人委派仍可打开限定活动入口，该委派不赋予宣传、物资等模块权限。账号档案里的院系、姓名和客户端传入角色不能授予权限。已授权的物资财务委派仍独立生效。上表的主任、主席团取值来自现行活动权限规则；全站通知、历史编辑及反馈所需的「部门管理层」统一定义待团队确认。

| 403 返回 | 排查方式 |
| --- | --- |
| `permission_denied` + `requiredScope` | 核对「平台账号表」的模块列。例如缺 `events` 时，补权限范围后再检查活动角色。 |
| `console_forbidden` + `requiredRole: console_admin` | 此接口需要管理员身份。公众端的正常使用不受影响。 |
| `event_scope_forbidden` 或地区审批错误 + `requiredRole` | 核对该操作的活动角色、地区、类别、负责人或指定审批名单。可读目录不代表能查看参与人资料或修改活动。 |

邹偲慧的 N5.1 标签保存和 N5.2 历史编辑先走上述服务端授权。历史编辑范围由 N5.2 确认；现有只读权限不变成写权限。老活动缺标签仍可读，标签也不能改变旧批准摘要。现有摘要包含「报名页配置」内容，新增配置字段时要校验历史批准值仍能比对。

龚心懿的 C1 先校验 `outreach`，再区分素材归属。本人的依据是账号 ID，本中心的依据是可信中心归属，全部的依据是独立确认的全范围权限。A1 不新增素材权限字段，也不把活动终审角色自动映射成素材全范围权限。

## 空权限切换与存量迁移

默认值是超级管理员全部模块、普通管理员无额外模块、成员无账号模块。普通管理员仍可使用共用入口。迁移期间可临时配置 `PLATFORM_LEGACY_EMPTY_ADMIN_PERMISSIONS=true`，仅空白值继续采用旧默认值。明确配置了权限的账号照常，`none` 表示显式无额外模块。

维护人先在独立身份测试 Base 演练。检查空权限账号原来承担的职责，同时核对已有活动角色的普通管理员是否明确具有 `events`。依据授权补齐，不能按姓名、部门猜测模块权限。脚本只修改审阅过的空权限普通管理员，角色、身份、已配置权限和其它表不变。

以下示例使用独立测试环境的 `.env.identity-test`。设置 `SEATABLE_IDENTITY_API_TOKEN`、`SEATABLE_IDENTITY_BASE_UUID` 和私有 `PLATFORM_WRITE_STATE_DIR`，从仓库根目录执行。

```powershell
node --env-file=.env.identity-test scripts/run-coordinated-script.mjs migrate-admin-permissions.mjs
node --env-file=.env.identity-test scripts/run-coordinated-script.mjs migrate-admin-permissions.mjs --prepare=a1-test
```

第一条只读计数。第二条在私有状态目录的 `admin-permission-migrations` 下生成计划。逐条把 `scopes: null` 改成确认过的数组，例如 `["events"]`。确认无需额外模块才填 `[]`。保留账号 ID、行 ID 和原值，计划与写前快照都不进入 Git。

```powershell
node --env-file=.env.identity-test scripts/run-coordinated-script.mjs migrate-admin-permissions.mjs --plan=a1-test
node --env-file=.env.identity-test scripts/run-coordinated-script.mjs migrate-admin-permissions.mjs --plan=a1-test --apply --confirm=MIGRATE-ADMIN-PERMISSIONS
node --env-file=.env.identity-test scripts/run-coordinated-script.mjs migrate-admin-permissions.mjs --plan=a1-test --rollback --confirm=ROLLBACK-ADMIN-PERMISSIONS
```

试跑先核对账号与权限原值。执行在共享维护锁内落写前快照，再逐行回读核验。迁移期间暂停直接在 NJUTable 修改该列。中断后保留原计划和快照，重复原命令可跳过已验证的目标值；遇到不同的权限、账号或角色会停下。回滚读取写前快照，仅把仍符合该计划的行恢复为空值。演练通过并核对授权后，再安排正式切换。回滚时如需恢复旧默认值，由维护人单独启用兼容开关。
