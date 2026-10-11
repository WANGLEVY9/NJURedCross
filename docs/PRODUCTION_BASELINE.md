# 线上部署现状

生产环境是一个 systemd 管理的单 Node 实例。`main` 推送经 `Quality gate` 后由 GitHub Actions 部署，运行目录与 Git 仓库相互独立。

## 运行拓扑

| 项目 | 值 |
| --- | --- |
| 服务 | `njuredcross.service`（systemd） |
| 运行目录 | `/opt/njuredcross` |
| 进程 | `node --env-file=.env server.js`，单实例 |
| Node / npm | 22.23.2 / 10.9.8 |
| 发布记录 | `/var/lib/njuredcross-deploy/release.json` |
| 备份 | `/opt/njuredcross-backups/main-*` |
| 照片目录 | `/var/lib/njuredcross-evidence` |

`release.json` 记录每次部署的提交号、文件清单与运行文件哈希，是判断当前运行版本的依据 —— 服务器上的 Git HEAD 只反映历史增量部署，不参与版本判定。发布包、接收器与回滚流程见 [部署与回滚](OPERATIONS.md)。

## 核对线上状态

```bash
sudo systemctl status njuredcross
sudo cat /var/lib/njuredcross-deploy/release.json
```

核对只读取服务状态与发布清单：不下载 `.env`、账号文件、业务表行、照片或凭据，不修改生产配置，不重启服务。

## 最近一次核对

2026-10-10 部署后，146 个运行文件与发布清单哈希一致，生产 `.env` 哈希保持不变；公开页面与资源冒烟通过，缺失活动返回 404，匿名健康接口返回 401。测量细节见 [页面加载线上验证](../reports/PAGE_LOADING_VERIFICATION_2026-10-10.md)。

按日期的核对记录都保存在 [`reports/`](../reports/README.md)。

## 配置与数据边界

生产配置、私有身份 Base、资料 Base、SMTP 凭据、签到照片与业务数据独立于源码管理：不进入仓库，不进发布包，部署时保持哈希不变。

## 已上线能力

白天主题控制台、校园邮箱登录补全、验证码同时间排序修复、上游失败与会话错误区分、活动写入队列、页面加载优化，以及报名 — 请假 — 照片签到 — 时长核对/批准 — 入账试点。

试点数据位于代码指定的测试副本六张独立表，与正式历史累计分列展示；迁移条件见 [试点说明](WORKFLOW.md)。
