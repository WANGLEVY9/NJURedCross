# 页面截图与复现

README 使用两类截图：线上实况视图与本地合成演示视图。两者来源不同，复现边界也不同，不能互相替代。

## 线上实况视图

| 文件 | 页面 | 来源与处理 |
| --- | --- | --- |
| [活动广场](assets/events-live-preview.png) | `/events` | 2026-11-22 已登录线上页面；保留真实活动列表与筛选状态，统一压缩到 1280px 宽 |
| [运营总览](assets/console-overview-live-preview.png) | `/console/overview` | 2026-11-22 已登录线上管理端；裁掉顶栏中的登录邮箱，保留运营看板布局与真实统计 |

线上截图由维护者在当前生产页面采集，用于说明项目已实际部署的形态。管理端截图不含登录邮箱，但可能包含运营统计和待办摘要；不在仓库中保存账号、个人资料、照片或明细导出。贡献者不应以线上业务数据调试或生成测试基线。

## 本地合成演示视图

以下截图由脚本从本地合成演示服务器自动捕获，日期 **2026-10-25**，源码基线 `7de12c8`，可用 `npm run screenshots` 重新生成。

| 文件 | 页面 | 场景 |
| --- | --- | --- |
| [首页](assets/home-preview.png) | `/` | 桌面首页：轮播、统计与千纸鹤寄语 |
| [手机首页](assets/mobile-home-preview.png) | `/`（390×844） | 手机底部标签栏与卡片布局 |
| [活动广场](assets/events-preview.png) | `/events` | 专题分类、组合筛选与近期活动 |
| [手机活动广场](assets/mobile-events-preview.png) | `/events`（390×844） | 分类入口与活动列表 |
| [献血车日历](assets/calendar-preview.png) | `/workflow-events?type=blood` | 周视图、点位与名额筛选 |
| [宣传广场](assets/outreach-preview.png) | `/outreach` | 投稿、影像、任务与展示四个板块 |
| [内建广场](assets/community-preview.png) | `/community` | 生日祝福与早安晚安·同行计划 |
| [物资广场](assets/materials-preview.png) | `/materials` | 物资借用三步流程 |
| [会员中心](assets/member-preview.png) | `/me` | 志愿时长与报名进度 |
| [运营总览](assets/console-overview-preview.png) | `/console/overview` | 待办队列与活动运营 |
| [活动管理](assets/console-events-preview.png) | `/console/events` | 名单确认与录取通知工作区 |
| [物资管理](assets/console-materials-preview.png) | `/console/materials` | 任务队列与库存台账 |
| [内建管理](assets/console-community-preview.png) | `/console/community` | 参加登记与人工确认 |
| [留言墙](assets/console-messages-preview.png) | `/console/messages` | 留言发布与下架 |
| [管理员中心](assets/console-admin-preview.png) | `/console/admin` | 账号与模块权限 |

## 复现步骤

```bash
npm ci --ignore-scripts
npx playwright install chromium
npm run preview:workflow        # 终端 1：启动合成演示服务器（默认 3121 端口，自动进入合成管理员会话）
npm run screenshots             # 终端 2：重新生成 docs/assets 下的全部截图
```

可用环境变量调整行为：`SCREENSHOT_BASE_URL`（目标服务器，默认 `http://127.0.0.1:3121`）、`SCREENSHOT_WIDTH` / `SCREENSHOT_HEIGHT`（桌面视口，默认 1440×900）、`SCREENSHOT_SETTLE_MS`（渲染等待，默认 1500）。

## 约定

- 本地合成截图中的统计、人物与业务记录均来自内存演示服务器（`scripts/preview-workflow.mjs`），不含真实学生、报名名单、邮箱、照片或管理员凭据；操作仅作用于内存。
- 截图统一使用桌面 1440×900 与手机 390×844 视口，捕获时启用 `prefers-reduced-motion` 暂停轮播与动效，并压缩到 1280px 宽以控制仓库体积。
- 以合成数据更新截图时，核对姓名、联系信息、浏览器提示和加载状态，保持页面功能及信息真实可读；出现加载失败或错误提示的页面不进入 README。
- 涉及界面结构变化的 PR 建议顺带运行 `npm run screenshots`，让本地复现基线与最新代码保持一致。
- 更新线上实况截图时，必须使用脱敏视图，并同时记录日期与页面来源；不要把含账号邮箱、真实照片、个人报名或业务明细的截图提交到开源仓库。
