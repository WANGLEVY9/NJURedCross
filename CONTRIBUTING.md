# 贡献指南 · Contributing

欢迎一起建设 NJURedCross。代码、产品建议、视觉与交互设计、测试、文档和可访问性改进都值得贡献。请遵循 [行为准则](CODE_OF_CONDUCT.md)，项目决策和维护职责见 [GOVERNANCE](GOVERNANCE.md)。

## 第一次贡献

1. 阅读 [README](README.md)、[运行指南](docs/GETTING_STARTED.md) 和相关模块文档。
2. 检索 [Issues](https://github.com/WANGLEVY9/NJURedCross/issues) 与 [PR](https://github.com/WANGLEVY9/NJURedCross/pulls)，确认没有重复工作。较大变更先用功能建议说明用户、问题和验收条件。
3. 选择范围明确的改进：修正文档、复现预览问题、检查键盘/手机交互，或修复一个缺陷。可以在 Issue 中说明愿意承担的内容，等待维护者确认范围。
4. 使用无凭据预览或内存合成流程开发；需要真实服务联调时，由维护者安排独立测试环境。

## 建立开发环境

先在 GitHub Fork 本仓库，再将下方 `<your-account>` 替换为你的 GitHub 用户名。

```bash
git clone https://github.com/<your-account>/NJURedCross.git
cd NJURedCross
git remote add upstream https://github.com/WANGLEVY9/NJURedCross.git
git fetch upstream
git switch -c fix/your-topic upstream/main
npm ci --ignore-scripts
npm run preview:workflow
```

已有写权限的协作者可从最新 main 建立自己的主题分支。建议 Node.js 24，端口与完整业务配置见 [运行指南](docs/GETTING_STARTED.md)。

## 提交前验证

| 变更类型 | 验证要求 |
| --- | --- |
| 所有变更 | `npm run check`、`npm run lint`；核对实际改动范围 |
| 代码变更 | `npm run verify`、`npm run check:links`，增加或更新有价值的行为回归 |
| 页面与交互 | 相关 Playwright 测试；桌面/手机、键盘焦点、加载/错误状态；附合成数据截图 |
| 依赖变更 | `npm run audit:dependencies`，核对许可与运行兼容性 |
| 权限、Schema、迁移 | 说明目标测试环境、字段与授权、兼容性、备份和恢复步骤 |

首次跑浏览器测试，执行 `npx playwright install chromium`。具体套件见 [测试指南](docs/TESTING.md)。在 PR 中记录执行过的命令和结果，明确需要维护者协助验证的部分。

提交使用一个清楚的目的，例如 `fix(events): preserve filter focus` 或 `docs: clarify preview setup`。代码风格、注释与文档规范见 [开发约定](docs/DEVELOPMENT.md)。保持原生 JavaScript/CSS 与现有共享组件组织。

## 提交 Pull Request

1. 推送主题分支并创建 PR，关联对应 Issue；尚未完成时使用 Draft。
2. 按模板写出触发场景、行为变化、验证和恢复方法。界面截图使用合成身份和数据。
3. 等待 CI 与维护者审查，讨论后逐项修改。需要等待背景资料或业务确认时，写清楚阻塞条件。
4. 合并后查看更新记录；界面、运行、配置和业务契约变化同步到对应指南。

其他开发者通过 PR 合并。Owner（WANGLEVY9）及明确授权的维护操作可验证后直接推送 main；已获 Owner 授权的维护账号包括 zhoumiaoooooo（251880164@smail.nju.edu.cn），可完成检查后直接提交并推送 main，不为每次修改建立 PR。生产发布由 Quality gate 和自动部署执行，版本核对与回滚见 [运维指南](docs/OPERATIONS.md)。

## 数据、许可与署名

使用合成身份、`example.test` 邮箱和独立测试 Base。将 `.env`、账号文件、Base 导出、Token、验证码、Cookie、生产日志、照片和个人资料保存在受保护的本地或业务存储中；源码提交中只放配置示例与脱敏证据。安全问题走 [SECURITY](SECURITY.md) 的私密渠道。

贡献沿用 [MPL-2.0](LICENSE)，只提交有权贡献的内容，保留第三方通知。仓库不要求额外 CLA；许可解释见 [许可与资源](docs/LICENSING.md)。提交邮箱应关联 GitHub 账号或使用其 noreply 地址。共同完成的工作保留真实作者与共同作者署名，非代码贡献也可在关联 Issue/PR 中记录，见 [CONTRIBUTORS](CONTRIBUTORS.md)。
