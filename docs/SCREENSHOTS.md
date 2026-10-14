# 页面截图与复现

README 使用本轮从真实浏览器捕获的最新界面截图，日期 **2026-10-14**。源码基线为 `ce80b2b7f7f9d1a2f90c5877d0b638102393a517`，本轮修改集中于仓库文档与呈现。

| 文件 | 页面 | 场景 |
| --- | --- | --- |
| [首页](assets/home-preview.png) | `/` | 匿名首页、活动专题与正式导航 |
| [活动广场](assets/events-preview.png) | `/events` | 合成活动目录与组合筛选 |
| [献血车日历](assets/calendar-preview.png) | `/workflow-events?type=blood&week=2026-10-12` | 合成班次与状态 |
| [运营后台](assets/admin-preview.png) | `/console/workflow` | 合成管理员活动工作区 |

所有图中统计、人物与业务记录均来自内存演示服务器，不含真实学生、报名名单、邮箱、照片或管理员凭据。图像为浏览器原始 PNG，捕获时页面完成加载；首页暂停轮播并固定活动专题。

复现：安装依赖后运行 `npm run preview:workflow`，访问终端提示的本地地址。默认自动进入合成管理员会话，无需提供真实账号或密码；设置 PREVIEW_START_SIGNED_OUT=1 可查看匿名状态。操作仅作用于内存。截图对应的界面源文件见 public，演示数据见 scripts/preview-workflow.mjs。以合成数据更新截图时，核对姓名、联系信息、浏览器提示和加载状态，保持页面功能及信息真实可读。
