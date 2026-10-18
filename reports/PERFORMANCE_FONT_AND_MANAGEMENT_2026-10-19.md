# 活动广场与管理端加载性能修复

日期：2026-10-19  
基线版本：`4a062ea6fa95f500033dfee743d71d79176fc1ac`（PR #23 合并后）

## 结论

这次变慢不是单一缓存失效，而是多个成本叠加：

1. 中文 WebFont 被放进了应用启动链。生产 `/events` 冷启动请求了 12 个
   WOFF2，合计约 2.54MB，单个请求耗时 7–17 秒，把 `loadEventEnd` 拖到
   约 22–25 秒。
2. 新版活动工作区关闭时，管理端仍先请求一次能力探测；生产上该请求在读取
   活动权限后才返回“未启用”，实测约 888ms。
3. 活动审批投影对每个活动单独调用一次旧版路由，14 个活动就是 14 次串行
   投影读取。
4. 通知总览为了生成待办，读取了物料流水等该视图不使用的表，生产首次读取
   约 3.5–4.2 秒；管理端外壳在每个页面启动时都会请求它。

## 已完成的修复

- 应用改用设备本地字体栈：macOS 的 PingFang / Songti / Kaiti，Windows 的
  Microsoft YaHei / SimSun / KaiTi，Linux 回退到 Noto；英文仍优先 Times
  New Roman。`public/index.html` 不再加载 `font-faces.css`，应用冷启动不会
  再请求字体文件。字体资产保留为可选离线/排版样本，不进入启动链。
- 会话载荷直接暴露 `activityWorkspaceV2` 开关。开关关闭时活动管理入口直接
  加载旧工作台，不再先发能力探测请求。
- 即使收到能力探测，服务端在功能关闭时会在读取活动权限前立即返回
  `{enabled:false}`。
- `createActivityApprovalRouter.describe()` 按旧版/地区活动分组，每组只调用
  一次投影路由，并保持原目录顺序。
- 通知总览的物料投影增加 `notificationsOnly`，跳过不被通知使用的物资流水表。
- 浏览器管理端读缓存覆盖通知总览：30 秒内切换页面复用同一份展示数据，写入、
  会话或 CSRF 变化立即清空，显式刷新回源。

## 证据

### 生产基线（修复前）

使用干净的 Playwright 浏览器上下文访问 `https://njuredcross.cn/events`：

| 指标 | 结果 |
| --- | --- |
| `loadEventEnd` | 22.5 秒（重复测量约 23–25 秒） |
| `domContentLoadedEventEnd` | 约 1.9 秒 |
| First Contentful Paint | 约 0.8–1.8 秒 |
| WOFF2 文件数 | 12 |
| WOFF2 传输量 | 约 2.54MB |
| 最慢字体请求 | 约 17 秒 |

### 本地修复后（合成预览服务）

同一台机器的合成预览、干净浏览器上下文：

| 页面 | 首屏可见 | `loadEventEnd` | WOFF2 请求 |
| --- | --- | --- | --- |
| `/events` | 约 0.1 秒 | 58ms | 0 |
| `/console/overview` | 79ms | 31ms | 0 |
| `/console/events` | 116ms | 30ms | 0 |

本地数值用于确认启动链和请求数，不代表生产公网时延；生产仍需在部署后
重新测量。

### 回归结果

- `npm run check`：954 个 JavaScript 模块、158 个 Markdown 文档，0 错误。
- ESLint：0 warning。
- `npm test`：2304 通过，2 跳过，0 失败。
- 定向浏览器回归：154 通过，2 跳过，0 失败；覆盖启动、字体栈、活动管理入口、
  六阶段工作区和审批。
- 全量浏览器套件：931 通过，53 跳过。4 项本地失败来自并发运行 Playwright
  时共享 `test-results` 的 trace 文件冲突；其中活动页头几何断言在两个项目
  单独重跑均通过，受 trace 影响的候选带入用例在 `--trace=off` 下通过。
- `npm run check:links`：通过。

## 边界

- NJUTable 仍是业务权威源。通知总览首次打开仍要等待上游读取，只是不再读取
  无关流水表；浏览器缓存只影响展示，不参与鉴权、写入或容量判定。
- 生产实际效果取决于公网链路和 NJUTable 响应。部署完成前不把本地数值当作
  线上验收。
