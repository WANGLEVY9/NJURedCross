---
name: NJU Red Cross Platform
description: 既有主题体系下的品牌光场、首页与活动广场、预约日历及连续交互
colors:
  dawn-accent: "#b91c37"
  sail-accent: "#175f9d"
  garden-accent: "#17684f"
  iris-accent: "#6744a5"
  amber-accent: "#82570b"
  dawn-background: "#fbf6f2"
  surface-raised: "#ffffff"
  brand-navy: "#21386b"
  discovery-motto: "#922038"
  discovery-filter-track: "#f0eef3"
  discovery-ink: "#30313d"
  discovery-muted: "#646574"
  calendar-ink: "#30313d"
  calendar-muted: "#646574"
  slot-open-background: "#f0f6f4"
  slot-open-ink: "#28564a"
  slot-full-background: "#404650"
  slot-full-ink: "#fff"
  slot-pending-background: "#fff0ad"
  slot-pending-ink: "#624509"
  slot-own-background: "#b9e4ff"
  slot-own-ink: "#103756"
typography:
  home-display:
    fontSize: "clamp(42px,4.6vw,68px)"
    fontWeight: 650
    lineHeight: 1.2
    letterSpacing: "-0.035em"
  home-display-mobile:
    fontSize: "clamp(34px,8.6vw,48px)"
  plaza-title:
    fontSize: "clamp(30px,3.2vw,44px)"
  body:
    fontFamily: '-apple-system, BlinkMacSystemFont, "SF Pro Text", "Segoe UI Variable Text", "Segoe UI", "PingFang SC", "Hiragino Sans GB", "Microsoft YaHei", system-ui, sans-serif'
    fontSize: "0.875rem"
    lineHeight: 1.55
  calendar-month:
    fontSize: "28px"
    fontWeight: 650
    lineHeight: 1.2
    letterSpacing: "-0.025em"
  calendar-month-desktop:
    fontSize: "30px"
    fontWeight: 650
    lineHeight: 1.2
    letterSpacing: "-0.025em"
  calendar-date-desktop:
    fontSize: "32px"
    fontWeight: 550
    lineHeight: 1.15
rounded:
  discovery-surface: "16px"
  discovery-filter: "8px"
  calendar-shell: "16px"
  calendar-slot: "12px"
spacing:
  s1: "4px"
  s2: "8px"
  s3: "12px"
  s4: "16px"
  s5: "20px"
  s6: "24px"
components:
  calendar-shell:
    backgroundColor: "{colors.surface-raised}"
    textColor: "{colors.calendar-ink}"
    rounded: "{rounded.calendar-shell}"
  calendar-slot-open:
    backgroundColor: "{colors.slot-open-background}"
    textColor: "{colors.slot-open-ink}"
    rounded: "{rounded.calendar-slot}"
    padding: "14px 12px 10px"
  calendar-slot-open-desktop:
    backgroundColor: "{colors.slot-open-background}"
    textColor: "{colors.slot-open-ink}"
    rounded: "{rounded.calendar-slot}"
    padding: "16px 14px 12px"
  calendar-slot-open-compact:
    backgroundColor: "{colors.slot-open-background}"
    textColor: "{colors.slot-open-ink}"
    rounded: "{rounded.calendar-slot}"
    padding: "12px"
---

# Design System: NJU Red Cross Platform

## Overview

本文是已实现界面的设计摘录，范围为全平台共享背景、首页、活动广场、献血车预约日历及其沿用的共享组件。用户要求更明显的艺术表达、光感与动效；这里记录这一方向在既有主题中的实现，不新增品牌定位或产品承诺。

背景由页面任务决定：主页深海军蓝首屏连接暖纸色内容、白色服务区和砂色页脚；活动检索采用低噪浅底；日历与个人工作区采用中性灰；内建使用暖纸色，宣传使用编辑性象牙底色。正式徽标不变，装饰十字仅保留在主页局部主视觉。原生 JavaScript/CSS、共享组件及主题偏好继续约束实现。

## Colors

晨曦红、海风蓝、青竹绿、鸢尾紫与秋日金继续控制 `--accent`、按钮和选中态。品牌海军蓝 `#243e67` 仅用于首页主视觉，暖纸 `#f7f4f0`、编辑性象牙 `#f2ede5`、工作区 `#f1f3f5`、页脚砂色 `#ebe5dc` 作为场景底色，不重定义主题主色或报名状态色。

背景分配统一归 `atmosphere.css`，通过实际挂载的页面根类选择，路由切换后自动恢复；首页章节表面归 `discovery-art.css`。业务状态保留文字、图标和可读名额。

## Typography

沿用系统无衬线字体栈，无新增字体依赖。月份使用 frontmatter 中的基础与桌面角色；700px 及以下月份缩至 24px。页面标题基础为 `clamp(28px,3vw,40px)`，1101px 起为 42px、字重 650。日期数字基础为 27px，桌面使用 frontmatter 的桌面日期角色，手机为 22px。剩余名额基础为 18px，桌面舒展为 24px、紧凑为 18px，手机为 27px。时间及周范围沿用等宽数字设置。其他页面继续使用共享字号与既有主题字体规则。

## Layout

首页主视觉与内容区最大宽度为 1480px，桌面主视觉为标题与服务面板双列；760px 及以下改为单列，标题使用 frontmatter 的手机角色。首页五个广场入口从五列在 1100px 及以下变为三列、760px 及以下两列、480px 及以下单列。正式标识使用现有图片资源，以 contain 保持比例，服务面板内尺寸为 72px，480px 及以下为 56px。活动广场同样使用 1480px 内容宽度；标题、搜索与组合筛选、当前条件及结果、活动列表依次排列。活动标题在 480px 及以下为 28px。

预约工作区基础最大宽度为 1320px，1101px 起扩大至 1800px。桌面保持七列周视图，头部将 260px 的月份/周导航列与弹性筛选列并排，列间距为 32px；筛选内部上下排列，每行标签列为 76px。701–1100px 时压缩日历列间留白，筛选上下排列。700px 及以下显示七日日期条，只展示选中日的班次；班次内位置和时间居左，名额居右。周结果摘要始终统计整周筛选结果，不是手机当前单日结果。

日历头部基础内边距为 28px 28px 24px，桌面为 30px 32px，手机为 18px 16px；结果栏允许手机换行。桌面日期最小高度为 84px，星期和班次数居左、日期数字居右；舒展班次最小高度为 164px，紧凑为 125px，紧凑班次间距为 8px。密度只在 1101px 起显示并影响布局。共享间距仍以 4px 为基础，局部排版值以日历样式为准。

## Elevation & Depth

全局 ambient 主机保留为兼容结构，但不绘制内容，也不注册指针视差。页面底色为静态实色，不使用全屏模糊或循环动画。首页服务面板及统计采用实色白底，取消服务面板背景模糊；章节通过深蓝→暖纸、暖纸→白底分隔、砂色页脚建立节奏。强制颜色模式沿用 Canvas，局部装饰隐藏。

组件 hover、筛选 FLIP、抽屉和日历交互仍由现有组件管理，遵守系统及站内减少动态设置。此轮只调整 P02 背景与章节节奏，首页主视觉构图、稀疏数据排版、字体系统与其余 CSS ownership 留待各自专项。

## Shapes

首页服务面板、广场标题、筛选区及活动卡片使用 discovery-surface 圆角；当前筛选按钮使用 discovery-filter 圆角，日期块为 12px。日历外壳、班次与日期使用 frontmatter 中的局部圆角，手机日期圆角为 10px。共享按钮、输入框和导航继续跟随既有主题圆角；这些局部日历值不构成全站圆角替换。

## Components

首页保留现有标题、内容、真实统计加载与服务路由，正式标识不重绘或变形。近期活动与广场入口采用同源浅色表面、主题图标和焦点反馈。首页与广场卡片在精细指针悬停时以 220ms 过渡上移 3px；系统或应用减少动态效果时停用。

活动广场的搜索、状态、分类和校区可组合，当前条件逐项显示为可删除按钮；删除状态或分类后聚焦该组当前选项，删除搜索或校区后聚焦搜索框。“重置全部”清除四项条件并聚焦搜索框；校区切换重绘后恢复对应校区按钮焦点。条件写回 URL，结果数量通过 polite、atomic 状态区域宣告；献血班次仍聚合为一个活动入口并单独报告班次数。键盘输入后跳过列表 FLIP，指针输入恢复其使用；减少动态效果由共享 motion 工具处理。加载、更新失败、普通活动、献血聚合与无结果状态继续沿用既有逻辑。

共享按钮、输入框、导航和筛选分段沿用现有组件。按钮保留 hover、focus、disabled 与 loading 行为；日历周导航最小高度 44px。输入框沿用边框、焦点环与错误状态。侧车中的组件片段仅供设计面板预览，不包含实际路由、筛选和提交逻辑。

日历班次以状态、地点、时间、剩余/总名额依次呈现。满额班次在“全部班次”下仍可查看；“仅看有名额”按剩余名额大于零筛选。已有报名状态由 `bloodSlotState` 判定；本次视觉修改不重定义报名资格。

点位与名额筛选可以组合，结果摘要通过 polite live region 宣告整周显示班次数和剩余名额总和。筛选后若当前日无匹配结果而其他日有，自动选择最早匹配日；无结果时分别解释无排班或符合条件班次已满，并提供重置入口。重置清除两项筛选，不重置周次。周次、日期、点位和名额筛选写回传入的状态对象。日期按钮使用 `aria-pressed`，班次选中态保留轮廓和 `aria-pressed`。日期支持左右方向键选择相邻日期、Home/End 选择当前周首日/末日；到周边界停止，不自动换周，重绘后保留日期焦点。

筛选和换周重绘可使用 220ms 淡入与 5px 位移；键盘分段筛选以及减少动态效果时跳过。日期键盘焦点在重绘后恢复。

桌面“舒展/紧凑”使用共享分段筛选组件，默认舒展，选择写入传入状态的 `density`，不声明跨会话持久化。选择班次后焦点移至详情容器并立即滚动到详情；“返回日历”优先聚焦当前选中且可见的班次；班次不存在或不可见时聚焦选中日期，并立即滚动至可见区域。详情面板与返回操作不改变报名资格、名额计算或提交接口。

公众端页头统一由 `portal.css` 管理；1181px 起高 76px，导航项高 44px。当前页面使用主题浅底、主题色文字和短下划线。滚动后切换为实色表面与柔阴影，过渡 160ms；会员与管理工具以细分隔建立层级。

## Do's and Don'ts

- Do 保留主题偏好、业务状态与筛选摘要语义。
- Do 使用共享组件与原生 JavaScript/CSS。
- Do 保持正式标识完整，并让装饰背景位于内容下方。
- Do 在桌面、手机及减少动态效果下检查布局和焦点。
- Don't 将手机单日显示误写为周汇总统计范围。
- Don't 用截图、合成测试或本地构建替代真实业务验收与部署验证。

源码依据：`public/styles/{tokens,themes,components,portal,portal-discovery,refinement,calendar,atmosphere,discovery-art}.css`、`public/app/portal/blood-calendar.js`、`public/app/portal/pages/workflow-events.js`、`public/app/core/{themes,motion}.js` 与 `public/app/main.js`、`public/app/portal/pages/{home,events}.js` 与 `public/index.html`。设计摘录不证明生产环境已部署；验证范围与发布检查见 [前端设计约定](docs/FRONTEND_DESIGN.md)及 [运维说明](docs/OPERATIONS.md)。

### 内建广场：信笺与陪伴

内建广场首页采用编辑式标题与两个具有独立主题的计划区域：生日祝福使用暖纸色与信封意象，早安晚安使用深蓝、晨光与月相。装饰不承载真实用户内容，不展示虚构投稿。页面保留共享按钮、主题强调色和会员入口；本页停用全站几何背景，避免装饰重复。

布局及状态样式归 `public/styles/warmth.css` 的 `.community-*` 所有，入口逻辑归 `warmth-birthday.js`。个人状态来自现有接口；读取失败明确显示重试，不能解释为未加入或空收件箱。未加入用户以计划介绍为主，已确认成员直接进入写祝福和私人信箱。隐私说明按需展开，举报仍沿用已有信件详情与处理反馈。

桌面最大内容宽度 1440px，1280–2048px 保留双栏与页边距，720px 以下自然单列。装饰仅在精确指针悬停时轻微位移，并遵守系统和站内减少动态设置。早安晚安名片页、管理端及其他广场不属于本轮重设计范围。

## P05 首页主视觉

`home.js` 与 `discovery-art.css` 管理首页 6:6 构图：深蓝底、白色标题、暖胭脂重点文字与暖纸海报。原创 `/assets/campus-connection.svg` 用朱红和暖橙交织纽带表达参与和回应，没有使用纪实照片或新增业务数字。主行动为“浏览开放活动”，次行动为“查看参与记录”，海报入口为“发现温暖连接”。图片固定比例避免加载位移；一次性 600ms 入场遵循减少动态设置。统计与服务索引见下方 P06–P08。

## P06–P08 内容发现体系

首页指标按行动相关性分级，近期活动一重点与紧凑列表；服务索引使用同一圆角和排版下的 5/4/3 + 6/6 非对称网格；隐私说明以水平说明带呈现。活动发现采用无容器标题、统一筛选工具面、暖纸献血车重点入口与分隔式普通列表。详情数字和点位来自现有接口，不新增业务口径；无活动与筛选无结果分别提供合适入口。视觉 owner 为 `discovery-art.css`，`activity-row.js` 为两页共享普通活动行。


## P09–P10 献血车报名工作台

日历样式由 `calendar.css` 管理，满额/个人状态色不再由 refinement 重复覆盖。桌面最大宽度由 1480px 扩至 1800px；截图必须按浏览器 CSS 视口评估，不能以缩略图推断字号。七列、日期键盘导航、筛选组合、整周摘要与舒展/紧凑密度保留。班次按点位、时间、名额、状态呈现，满额为中性浅灰虚线，可报名为浅绿，个人待审核/确认分别为暖黄与浅蓝；今日下划线、选中日期灰蓝底、周末文字独立表达。

详情顶部四项事实摘要，下面为参与安排与只读身份核对；须知未确认时按钮具有实色禁用外观。提交期间阻止周期刷新干扰，成功、业务拒绝和网络不确定结果在原位宣告。提交成功但后续刷新失败不宣称报名失败。记录面板保留请假和签到操作，并显示由真实状态导出的审核/确认/签到进度。未报名提供返回日历的下一步。

`booking-flow.spec.mjs` 使用隔离合成账号验证成功、满额竞争、身份验证失败、断网与焦点返回；密集周历覆盖每天 7 班和 1280/1440/1920/2048 视口。合成截图不包含真实个人资料；生产只读检查不提交报名。
