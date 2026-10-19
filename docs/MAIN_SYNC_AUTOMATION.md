# main 分支十分钟同步

`scripts/main_sync.py` 是 GitHub Actions 部署之外的兜底同步器。它只部署已经
通过 `Quality gate` 的运行时源码，不直接运行 main 上尚未验证的代码。

## 工作方式

1. 用 `git ls-remote` 读取 `refs/heads/main` 的最新 SHA。
2. 与 `/var/lib/njuredcross-deploy/release.json` 的 `commit` 比较；相同则退出。
3. 新提交先读取 GitHub check runs，只有名为 `Quality gate` 的检查
   `completed/success` 时才继续；检查尚未完成时本轮跳过，十分钟后再试。
4. 从 GitHub 下载该 SHA 的公开源码包，按接收器白名单提取 `server.js`、
   `package.json`、`package-lock.json`、`lib/*.js` 和 `public/**`，不包含
   `.env`、数据库、文档或隐藏文件。
5. 生成带 `manifest.json` 的发布包，交给现有
   `/usr/local/sbin/njuredcross-ci-deploy.py`。接收器仍负责并发锁、备份、
   文件哈希校验、服务重启、健康检查和失败回滚。
6. 在 `/var/lib/njuredcross-deploy/sync-state.json` 记录最近检查、等待门禁、
   成功或失败原因；日志写入 journald。

GitHub Actions 正常部署后，本任务通常只会报告 `up_to_date`。它主要用于
Actions 部署失败、延迟或中断后的补偿，不会绕过质量门禁。

## 安装

在项目根目录以 root 安装：

```sh
sudo install -m 0755 scripts/main_sync.py /usr/local/sbin/njuredcross-main-sync.py
sudo install -m 0644 ops/systemd/njuredcross-main-sync.service /etc/systemd/system/
sudo install -m 0644 ops/systemd/njuredcross-main-sync.timer /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable --now njuredcross-main-sync.timer
```

服务以 root 运行，因为现有发布接收器需要更新 `/opt/njuredcross` 并重启
`njuredcross.service`；脚本本身不读取或保存 GitHub Token、SSH 私钥或生产
`.env`。

## 手动检查

```sh
sudo systemctl start njuredcross-main-sync.service
sudo systemctl list-timers njuredcross-main-sync.timer
sudo journalctl -u njuredcross-main-sync.service -n 100 --no-pager
sudo cat /var/lib/njuredcross-deploy/sync-state.json
```

只检查、不部署：

```sh
sudo /usr/bin/python3 /usr/local/sbin/njuredcross-main-sync.py --dry-run
```

`--skip-ci-check` 仅用于明确的紧急人工操作，systemd timer 不使用它。

## 边界

- 公开仓库无需额外凭据；GitHub API 或网络失败时失败闭合，不会猜测部署。
- `Quality gate` 失败、被取消或尚未完成时不会部署。
- 现有接收器的 `deploy.lock` 仍会串行化与 GitHub Actions 的并发发布。
- 前端文件可热更新；后端或依赖变化由接收器重启服务。数据库迁移不在本任务
  自动执行，仍按 `docs/OPERATIONS.md` 单独处理。
- 停止或移除：`sudo systemctl disable --now njuredcross-main-sync.timer`。
