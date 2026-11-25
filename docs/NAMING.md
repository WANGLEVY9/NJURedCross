# 文件与命名约定

仓库由多人协作维护，命名优先保证路径稳定、语义清楚与工具可预测。新增文件按下表执行；历史文件名保持不变，避免打断发布清单、文档链接、服务器安装路径和静态资源指纹。重命名已有文件时需要同步更新所有引用，并确认它不在发布白名单或外部安装路径中。

## 路径与文件名

| 内容 | 约定 | 示例 |
| --- | --- | --- |
| 运行时与前端模块 | `kebab-case.js` / `kebab-case.mjs`，模块路径显式带扩展名 | `lib/attachment/api.js`、`public/app/core/api.js` |
| 域代码目录 | `lib/<domain>/`，域名用小写单数名词 | `lib/reimbursements/`、`lib/http/` |
| 前端目录 | `public/app/<surface>/`，页面放 `pages/` | `public/app/portal/pages/photos.js` |
| Node 工具与集成测试 | `scripts/*.mjs`、`tests/*.test.mjs`，kebab-case | `scripts/check-project.mjs`、`tests/asset-version.test.mjs` |
| Playwright 用例 | `tests/browser/*.spec.mjs`，kebab-case | `tests/browser/uno-v13.spec.mjs` |
| Python 运维工具 | 仓库内文件名用 `kebab-case.py` | `scripts/package-release.py` |
| Python 集成模块 | `tests/*_test.py`，模块名用 `snake_case.py` | `tests/release_test.py`、`ops/njutable/volunteer_hours_sync.py` |
| 持续文档 | `docs/kebab-case.md` | `docs/njutable-hygiene.md` |
| 日期性报告 | `reports/UPPER-KEBAB-YYYY-MM-DD.md` | `reports/CONSISTENCY_READ_WRITE_AUDIT_2026-11-23.md` |
| 配置与单元 | 小写 kebab-case | `ops/systemd/njuredcross-njutable-hygiene.timer` |

根目录仅放项目级约定、许可证和入口文件。版本化历史名称（如 `v3`、`v31`、`legacy`）保留原样，新增代码用业务语义命名，不继续扩散版本号或临时名。

## 标识符

- 导出的函数、组件和类使用 `PascalCase` 或明确的动词短语；变量与函数使用 `camelCase`，常量使用 `SCREAMING_SNAKE_CASE`。
- 领域状态值沿用 NJUTable 中已有的中文文本，不在同一模块内混用英文别名。
- 浏览器上报的服务、操作和阶段使用固定小写 kebab-case 字面量；新增值同步到观测白名单。
- 审计动作使用 `<domain>.<entity>.<action>`，例如 `submission.attachment.upload`。
- 中文正文按现有文档语言写，代码标识符、路径、命令与配置键使用 ASCII。

## 检查

运行 `npm run check:names` 检查新增 JavaScript、Python、Markdown 和 shell 文件名。该检查以当前 `HEAD` 为基线，只校验新增路径，因此历史文档、既有 Python 模块和服务器安装路径保持可用；重命名文件按新增路径校验。检查覆盖 `lib/`、`public/`、`scripts/`、`tests/`、`docs/`、`ops/`、`reports/`，不检查 `node_modules`、生成证据和发布产物。

域名语义、接口路径、数据库列名和第三方协议字段不由此检查推断；跨边界名称保持既有契约。
