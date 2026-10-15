# 签到核验与时长导出移动端适配

基线：main `61a3332`；开发账号：xinyue-L01。沿用活动中心现有原生 JavaScript、共享表单与主题颜色，适配范围为 720px 及以下。

## 页面变化

- 签到、时长审核使用圆角卡片，保留院系、红会身份、签到依据、工作内容、日期、地点和备注，避免手机核对时缺少上下文。
- 三项时长并排；输入与操作按钮适合触控。搜索独占一行，批量操作自动换行，保留前往时长审核入口。
- 逐人核验与明细表单改为单列，日期行可换行；在线预览逐人展示全部导出字段。
- 桌面保留表格。业务请求、权限、审核条件、月度汇总与 Excel 文件结构沿用现有实现。

## 验证

Windows、Node 24.13.1；全部使用内存合成服务器及拦截的合成响应。

- `npm ci --ignore-scripts`：同步最新 main 的锁定依赖，审计 0 漏洞。
- `npm run verify`：通过，Node 测试 1900/1900；含项目检查、ESLint、权限、身份、志愿资料回归。
- `npm run check:links`：通过。
- `npx playwright test tests/browser/field-workspace.spec.mjs tests/browser/activity-explorer.spec.mjs tests/browser/activity-projects.spec.mjs`：35 通过，7 按桌面/手机适用范围跳过。
- 签到检查 360/390/600/720px 卡片边界与选择、核验入口；原回归覆盖 0/1/20/200 人、失败重试、未保存输入、照片失败、五主题及桌面宽度。
- 时长检查手机端日期、地点、工作内容、备注可见，实际导出范围预览与下载触发。下载使用合成响应；文件结构由现有 XLSX/时长导出单元测试验证。

## 合成数据截图

![签到核验](assets/attendance-mobile/attendance.png)

![时长审核](assets/attendance-mobile/hours.png)

![导出预览](assets/attendance-mobile/export.png)

## 发布

协作者主题分支通过 PR 合并，合并后的生产部署由 main 的 Quality gate 触发。开发基线的 Actions 部署已成功，回执提交为 `61a3332be549e1f5a372ca4fbd5d0b52a97114e5`，核验运行文件 417 个。本次适配的生产验收在 PR 合并部署后执行。

恢复时回退本次前端样式、预览单元格标签与文档即可；数据结构保持现有版本。
