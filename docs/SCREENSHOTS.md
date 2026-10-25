# 页面截图与复现

README 使用从真实浏览器捕获的界面截图，日期 **2026-10-25**，源码基线 `7de12c8`。所有截图由脚本从本地合成演示服务器自动捕获，可用 `npm run screenshots` 重新生成。

| 文件 | 页面 | 场景 |
| --- | --- | --- |
| [首页](assets/home-preview.png) | `/` | 桌面首页：轮播、统计与千纸鹤寄语 |
| [手机首页](assets/mobile-home-preview.png) | `/`（390×844） | 手机底部标签栏与卡片布局 |
| [活动广场](assets/events-preview.png) | `/events` | 专题分类、组合筛选与近期活动 |
| [手机活动广场](assets/mobile-events-preview.png) | `/events`（390×844） | 分类入口与活动列表 |
| [献血车日历](assets/calendar-preview.png) | `/workflow-events?type=blood` | 周视图、点位与名额筛选 |
| [宣传广场](assets/outreach-preview.png) | `/outreach` | 投稿、影像、任务与展示四个板块 |
| [内建广场](assets/community-preview.png) | `/community` | 生日祝福与早安晚安·同行计划 |
| [财务物资广场](assets/materials-preview.png) | `/materials` | 物资借用三步流程 |
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

- 所有图中统计、人物与业务记录均来自内存演示服务器（`scripts/preview-workflow.mjs`），不含真实学生、报名名单、邮箱、照片或管理员凭据；操作仅作用于内存。
- 截图统一使用桌面 1440×900 与手机 390×844 视口，捕获时启用 `prefers-reduced-motion` 暂停轮播与动效，并压缩到 1280px 宽以控制仓库体积。
- 以合成数据更新截图时，核对姓名、联系信息、浏览器提示和加载状态，保持页面功能及信息真实可读；出现加载失败或错误提示的页面不进入 README。
- 涉及界面结构变化的 PR 建议顺带运行 `npm run screenshots`，让 README 与最新界面保持一致。
