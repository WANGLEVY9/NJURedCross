# PR #26：WebKit 任务超时修复

## 诊断证据

检查提交 `08dc91551dc10ac86ad55f895cd742665d75cd6f` 对应的 [CI 运行 39750978965](https://github.com/WANGLEVY9/NJURedCross/actions/runs/39750978965)：六组 Node 22／24／26 × Ubuntu／Windows、全部 Chromium 分片、Firefox、三时区、HTTP 覆盖率和发布安全检查均通过；WebKit 被取消，随后 Quality gate 因必需任务未成功而失败。

[WebKit 任务日志](https://github.com/WANGLEVY9/NJURedCross/actions/runs/39750978965/job/119731177915)及步骤元数据表明：

- 浏览器与系统依赖安装耗时 6 分 20 秒。
- 测试总计 78 项，启动时整体 10 分钟预算只剩不到 4 分钟。
- 用例继续正常完成，日志已推进到第 62 项；任务达到整体时间上限后被取消，未完成其余测试。

这是任务预算不足，不能把该次运行当作测试全部通过，也不是可以忽略的门禁失败。

## 修改与边界

将 `.github/workflows/ci.yml` 中 Firefox／WebKit 的 `cross-browser` 整体时间上限从 10 分钟改为 15 分钟，与 Chromium 任务保持一致，给冷安装和完整测试预留时间。

不修改跨引擎用例列表、单用例 30 秒上限、重试次数、失败判定、证据上传、Quality gate 或部署条件。不修改产品代码、权限、接口或数据，不写入远程业务表。

本机验证与更新后 CI 的运行结果在 PR #26 中记录；远程完整矩阵必须成功后才能认定修复验证完成。本机无法代替 GitHub Ubuntu runner 重现该次依赖下载耗时。

本机执行 `npm run verify` 退出码 0，Node 套件 2411 项通过、0 项失败、0 项跳过；`npm run check:links`（1019 个模块）与 `git diff --check` 通过。远程验证状态以 PR #26 的最新检查为准。

## 恢复

若需撤销，可还原 `cross-browser` 的整体时间上限及对应说明，无数据恢复或业务发布步骤。本 PR 尚未合并，生产部署不在本次操作范围内。
