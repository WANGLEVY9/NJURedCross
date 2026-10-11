# CI/CD 审查与升级（2026-10-09）

## 实际失败范围

审查最近 60 次 Project verification 运行：30 成功、30 失败，对应 49 个提交。
对全部 30 个失败运行读取 jobs，并检查其中一个失败 job 的日志；分类以该首个失败 job 为依据，不意味着该运行其余 jobs 没有其他错误。
最新 main `2bc8eae` 的检查与自动部署均已成功。历史失败记录属于旧提交，不会随修复消失。

| 首个失败原因 | 运行数 | 修复方向与现状 |
| --- | ---: | --- |
| `configureMailer is not defined` | 26 | 服务器上下文测试提取代码依赖未注入；材料与生日集成分支继承旧代码。当前 main 对应回归已通过，旧分支应同步 main 后复验。 |
| 后台任务测试 Promise 未完成，事件循环退出 | 2 | 测试等待 unref 定时器导致 cancelledByParent；不是业务断言失败。该分支后续提交已成功，禁止以跳过测试替代修复。 |
| 文档截图本地链接损坏 | 1 | `assets/task6-members-filter.jpg` 没有随文档提交；后续提交已成功。文档链接检查继续保留。 |
| 撤销会话测试 `ENOTDIR` | 1 | 合成文件系统 fixture 中把文件当作父目录；后续提交已成功，需区分预期拒绝与未捕获异常。 |

`url.parse` 的弃用提示不是这些运行失败原因。此次不删除失败历史，也不通过降低断言或掩盖错误使流水线变绿。
原 push 对全部分支生效，同时 PR 也检查，同一提交重复运行，放大失败数量与通知量。改为 main push + PR + 手动 + 每日检查，开发分支应打开 draft PR。

## 此次变更

拆分源码检查、lint、业务测试；保留四种 Node/OS 组合及生产依赖漏洞门槛。
增加桌面与手机浏览器检查、发布安全测试与统一 Quality gate，只有完整成功才能部署。
发布失败保留回滚，增加重启启动等待与更多公开路由/资源检查；将浏览器证据及部署回执保留为 artifacts。
通知工作流使用默认分支可信代码，逐次分发到集中议题并提及 10 位协作者，结果分发测试覆盖去重、失败状态与元数据转义。
GitHub Actions 固定到具体提交，减少浮动第三方 action 变化。

## 证据与范围

业务回归与浏览器检查使用合成数据，不验证生产 SMTP 送达、真实 NJUTable 写入和用户数据迁移。
生产自动部署仍独立保留 `.env`；Git push 或本地测试成功均不替代线上发布清单及服务检查。
浏览器端到端测试会暴露当前页面的真实加载/导航/宽度问题，失败时阻止部署；它不替代完整人工视觉审查。

## 失败运行明细

| 运行 | 分支 | 提交 | 首个失败原因 |
| --- | --- | --- | --- |
| [运行 37875231227](https://github.com/WANGLEVY9/NJURedCross/actions/runs/37875231227) | `codex/birthday-production-integration` | `c51d899` | configureMailer undefined |
| [运行 37875226359](https://github.com/WANGLEVY9/NJURedCross/actions/runs/37875226359) | `codex/birthday-production-integration` | `c51d899` | configureMailer undefined |
| [运行 37873755784](https://github.com/WANGLEVY9/NJURedCross/actions/runs/37873755784) | `codex/birthday-production-integration` | `0b5fa2a` | configureMailer undefined |
| [运行 37873705413](https://github.com/WANGLEVY9/NJURedCross/actions/runs/37873705413) | `codex/birthday-production-integration` | `0b5fa2a` | configureMailer undefined |
| [运行 37797193075](https://github.com/WANGLEVY9/NJURedCross/actions/runs/37797193075) | `fix/backend-reliability` | `7a4d437` | background test pending promise |
| [运行 37797185705](https://github.com/WANGLEVY9/NJURedCross/actions/runs/37797185705) | `fix/backend-reliability` | `7a4d437` | background test pending promise |
| [运行 37757127532](https://github.com/WANGLEVY9/NJURedCross/actions/runs/37757127532) | `codex/attendance-hours-review` | `a9e91da` | broken document asset link |
| [运行 37729235150](https://github.com/WANGLEVY9/NJURedCross/actions/runs/37729235150) | `feature/materials-center` | `6ef043c` | configureMailer undefined |
| [运行 37727191947](https://github.com/WANGLEVY9/NJURedCross/actions/runs/37727191947) | `feature/materials-center` | `b90bd92` | configureMailer undefined |
| [运行 37651508136](https://github.com/WANGLEVY9/NJURedCross/actions/runs/37651508136) | `fix/backend-reliability` | `a838229` | revocation test file path |
| [运行 37484466096](https://github.com/WANGLEVY9/NJURedCross/actions/runs/37484466096) | `main` | `7c88f85` | configureMailer undefined |
| [运行 37484342896](https://github.com/WANGLEVY9/NJURedCross/actions/runs/37484342896) | `main` | `5bbd60a` | configureMailer undefined |
| [运行 37484013690](https://github.com/WANGLEVY9/NJURedCross/actions/runs/37484013690) | `main` | `209d6f2` | configureMailer undefined |
| [运行 37480427904](https://github.com/WANGLEVY9/NJURedCross/actions/runs/37480427904) | `main` | `e3237dc` | configureMailer undefined |
| [运行 37480258799](https://github.com/WANGLEVY9/NJURedCross/actions/runs/37480258799) | `main` | `dd8d435` | configureMailer undefined |
| [运行 37479964173](https://github.com/WANGLEVY9/NJURedCross/actions/runs/37479964173) | `main` | `d0cc776` | configureMailer undefined |
| [运行 37479589104](https://github.com/WANGLEVY9/NJURedCross/actions/runs/37479589104) | `main` | `a330974` | configureMailer undefined |
| [运行 37478010181](https://github.com/WANGLEVY9/NJURedCross/actions/runs/37478010181) | `main` | `2c4a1fa` | configureMailer undefined |
| [运行 37452565947](https://github.com/WANGLEVY9/NJURedCross/actions/runs/37452565947) | `main` | `aae7b50` | configureMailer undefined |
| [运行 37448465563](https://github.com/WANGLEVY9/NJURedCross/actions/runs/37448465563) | `main` | `b2fc40f` | configureMailer undefined |
| [运行 37439421547](https://github.com/WANGLEVY9/NJURedCross/actions/runs/37439421547) | `main` | `9007d1d` | configureMailer undefined |
| [运行 37436153547](https://github.com/WANGLEVY9/NJURedCross/actions/runs/37436153547) | `main` | `78d01ed` | configureMailer undefined |
| [运行 37435934200](https://github.com/WANGLEVY9/NJURedCross/actions/runs/37435934200) | `main` | `24383c2` | configureMailer undefined |
| [运行 37347980858](https://github.com/WANGLEVY9/NJURedCross/actions/runs/37347980858) | `main` | `bb00094` | configureMailer undefined |
| [运行 37341367148](https://github.com/WANGLEVY9/NJURedCross/actions/runs/37341367148) | `main` | `13d2fe1` | configureMailer undefined |
| [运行 37334719999](https://github.com/WANGLEVY9/NJURedCross/actions/runs/37334719999) | `main` | `56ce15d` | configureMailer undefined |
| [运行 37334064643](https://github.com/WANGLEVY9/NJURedCross/actions/runs/37334064643) | `main` | `faecc9f` | configureMailer undefined |
| [运行 37327561762](https://github.com/WANGLEVY9/NJURedCross/actions/runs/37327561762) | `main` | `b606fc7` | configureMailer undefined |
| [运行 37272886990](https://github.com/WANGLEVY9/NJURedCross/actions/runs/37272886990) | `main` | `c3fb8f4` | configureMailer undefined |
| [运行 37272639545](https://github.com/WANGLEVY9/NJURedCross/actions/runs/37272639545) | `main` | `dfe5b46` | configureMailer undefined |
