# 内容投稿附件 · 表契约与应用

内容投稿模块（文字稿件 / 影像作品 / 文创设计 / 课程反馈）的文件直传能力由两部分承载：**「投稿附件表」保存元数据与状态，文件本体存放于阿里云 OSS 私有 Bucket**。本页是表结构、生命周期与应用流程的唯一说明；行映射代码见 `lib/attachment/store.js`，Schema 脚本见 `scripts/apply-submission-attachment-schema.mjs`。

## 表结构（投稿附件表，13 列全 text）

| 列 | 语义 | 示例 |
| --- | --- | --- |
| 附件ID | `ATT-{时间36}-{随机}`，主键，服务端生成，不可猜测 | `ATT-M2XQZG-A1B2C3` |
| 投稿ID | 关联「宣传投稿表·投稿ID」；申请槽位时为空，投稿提交时回填 | `SUB-M2XQZH-9F8E7D` |
| 文件名 | 净化后的原始文件名（展示用） | `献血车现场-03.jpg` |
| MIME类型 | 服务端探测结果，非浏览器声明 | `image/jpeg` |
| 大小 | 字节数（字符串落表，仓库惯例） | `2048000` |
| 校验和 | SHA-256 hex（小写）；上传后复核 | `e3b0c442…` |
| 存储提供商 | `aliyun-oss`（预留多供应商扩展） | `aliyun-oss` |
| Bucket | 存储桶名 | `nju-rc-submissions` |
| 对象Key | `submissions/{yyyy}/{附件ID}/{随机名}.{ext}` | `submissions/2026/ATT-…/f3c9.jpg` |
| 上传状态 | 待上传 / 已上传 / 校验失败 / 已删除 | `已上传` |
| 上传人 | 账号引用（businessAccountRef），仅本人可删/可绑定 | `251880207@smail.nju.edu.cn` |
| 上传时间 | ISO 时间 | `2026-10-05T12:00:00.000Z` |
| 绑定时间 | 投稿提交时写入 | `2026-10-05T12:05:00.000Z` |

## 生命周期与状态机

```
申请槽位 → 待上传 → (中转上传+校验) → 已上传 → (投稿提交) → 回填投稿ID+绑定时间
                └──────────────→ 校验失败（可重试）
任意未绑定状态 ──→ 已删除（本人删除，同步删 OSS 对象）
未绑定且 7 天未提交 ──→ 运维脚本清理（先 dry-run）
```

- 「宣传投稿表」既有的「附件引用」列（历史恒空）自此启用：值为 JSON 数组文本，如 `["ATT-…","ATT-…"]`；历史行空值语义为"无附件"，读侧统一按空数组兜底（`parseAttachmentRefs`）
- 跨表一致性采用"先附件后投稿"顺序写入，不引入事务假设（与 [架构](ARCHITECTURE.md) 已知限制一致）

## 应用流程

```bash
cp .env.example .env       # 填入 SEATABLE_API_TOKEN（先在测试 Base 验证）
npm run attachments:dry-run   # 预览：打印计划，不写入
npm run attachments:apply     # 写入需确认短语 APPLY-NJU-RC-SUBMISSION-ATTACHMENT-TABLE
```

安全模型与其他 Schema 脚本一致：目标表已存在则拒绝写入；apply 后回读元数据验证。**先测试 Base 验证，再业务 Base 应用**；本脚本不改既有表结构。

## 降级与边界

- 阿里云 OSS 未配置（`.env` 凭证为空）时，投稿模块自动退回"贴链接"模式，文字投稿不受影响（对齐 `lib/events/njubox.js` 的未配置降级先例）
- 附件元数据查询在 Node 层做两表关联（附件表按 `投稿ID` 过滤后与投稿合并），不依赖 SeaTable 链接列
- 归属校验：附件仅上传人本人可删除/绑定；绑定后随投稿锁定，删除走投稿撤回流程

## 合成回归

`tests/submission-attachments.test.mjs` 覆盖：表契约稳定性、编号唯一性、行映射往返与旧列兜底、「附件引用」编解码的脏值容错。运行：`node --test tests/submission-attachments.test.mjs`（含于 `npm test`）。
