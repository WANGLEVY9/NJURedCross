---
name: NJU Red Cross Platform
description: 既有主题体系下的柔光背景、桌面预约日历与详情交互
colors:
  dawn-accent: "#b91c37"
  sail-accent: "#175f9d"
  garden-accent: "#17684f"
  iris-accent: "#6744a5"
  amber-accent: "#82570b"
  dawn-background: "#f5f4f8"
  surface-raised: "#ffffff"
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

本文是已实现界面的设计摘录，范围为共享背景、献血车预约日历及其沿用的共享组件。用户要求更明显的艺术表达、光感与动效；这里记录这一方向在既有主题中的实现，不新增品牌定位或产品承诺。

柔光背景提供空间层次，日历以月份、服务点位、日期、班次与名额逐级组织信息，桌面密度控制与详情返回焦点维持连续的预约上下文。原生 JavaScript/CSS、共享组件和主题偏好继续约束实现。本文 frontmatter 记录当前实现值；运行时以 CSS 为准，不从文档生成另一套独立主题。

**Key Characteristics:**

- 随主题变化的方向性光场与白色日历表面。
- 清晰的状态文字、图标和名额数字。
- 桌面七列周视图与两种密度，手机日期条与单日班次。

## Colors

主色沿用晨曦红、海风蓝、青竹绿、鸢尾紫与秋日金；管理端有对应的五组主题。背景渐变、筛选指示器和选中日期通过 `--accent` / `--accent-soft` 跟随主题。晨曦红门户的底色由 `atmosphere.css` 覆盖，其他主题仍由 `themes.css` 定义。

中性色使用白色浮起表面，以及日历专用正文和辅助文字色。可报名、已报满、我的待审核、我的报名成功分别保留绿色、灰色、琥珀色、蓝色语义；已签到沿用个人报名蓝色。可报名班次的新背景及文字色在 `calendar.css` 中定义，其他状态由 `refinement.css` 的更具体状态选择器保留高对比状态色；图例的满额、待审核及个人报名色同样沿用该文件覆盖。

主题主色不替代业务状态色。状态必须保留文字、图标与可读名额，不能只靠颜色区分。

## Typography

沿用系统无衬线字体栈，无新增字体依赖。月份使用 frontmatter 中的基础与桌面角色；700px 及以下月份缩至 24px。页面标题基础为 `clamp(28px,3vw,40px)`，1101px 起为 42px、字重 650。日期数字基础为 27px，桌面使用 frontmatter 的桌面日期角色，手机为 22px。剩余名额基础为 18px，桌面舒展为 24px、紧凑为 18px，手机为 27px。时间及周范围沿用等宽数字设置。其他页面继续使用共享字号与既有主题字体规则。

## Layout

预约工作区基础最大宽度为 1320px，1101px 起扩大至 1480px。桌面保持七列周视图，头部将 230px 的月份/周导航列与弹性筛选列并排，列间距为 32px；筛选内部上下排列，每行标签列为 76px。701–1100px 时压缩日历列间留白，筛选上下排列。700px 及以下显示七日日期条，只展示选中日的班次；班次内位置和时间居左，名额居右。周结果摘要始终统计整周筛选结果，不是手机当前单日结果。

日历头部基础内边距为 28px 28px 24px，桌面为 30px 32px，手机为 18px 16px；结果栏允许手机换行。桌面日期最小高度为 84px，星期和班次数居左、日期数字居右；舒展班次最小高度为 164px，紧凑为 125px，紧凑班次间距为 8px。密度只在 1101px 起显示并影响布局。共享间距仍以 4px 为基础，局部排版值以日历样式为准。

## Elevation & Depth

背景由三处随主题变化的径向渐变和斜向白色光带组成，隐藏原噪点层。管理端网格光层透明度为 0.4，工作区容器背景透明以透出光感。环境层不接收指针事件。1101px 起环境光带范围扩大，日历头部叠加静态白色光带；班次详情沿用日历柔阴影，标题区以主题浅色渐变承接日历。

日历使用独立柔阴影；班次卡片静止时轻微浮起，精细指针悬停时上移 3px 并加深阴影。光场指针视差仅在支持悬停的精细指针设备初始化，深度参数为 38，居中坐标对应每轴最大约 19px 位移。光带入场为一次 1.2s 动画，不是持续循环。

系统减少动态效果偏好或应用内关闭动效时，视差、光带入场、班次悬停位移与筛选重绘动画停用，保留静态光场和信息层次。准确阴影、动效和断点记录于 `.impeccable/design.json`。

## Shapes

日历外壳、班次与日期使用 frontmatter 中的局部圆角，手机日期圆角为 10px。共享按钮、输入框和导航继续跟随既有主题圆角；这些局部日历值不构成全站圆角替换。

## Components

共享按钮、输入框、导航和筛选分段沿用现有组件。按钮保留 hover、focus、disabled 与 loading 行为；日历周导航最小高度 44px。输入框沿用边框、焦点环与错误状态。侧车中的组件片段仅供设计面板预览，不包含实际路由、筛选和提交逻辑。

日历班次以状态、地点、时间、剩余/总名额依次呈现。满额班次在“全部班次”下仍可查看；“仅看有名额”按剩余名额大于零筛选。已有报名状态由 `bloodSlotState` 判定；本次视觉修改不重定义报名资格。

点位与名额筛选可以组合，结果摘要通过 polite live region 宣告整周显示班次数和剩余名额总和。筛选后若当前日无匹配结果而其他日有，自动选择最早匹配日；无结果时分别解释无排班或符合条件班次已满，并提供重置入口。重置清除两项筛选，不重置周次。周次、日期、点位和名额筛选写回传入的状态对象。日期按钮使用 `aria-pressed`，班次选中态保留轮廓和 `aria-pressed`。日期支持左右方向键选择相邻日期、Home/End 选择当前周首日/末日；到周边界停止，不自动换周，重绘后保留日期焦点。

筛选和换周重绘可使用 220ms 淡入与 5px 位移；键盘分段筛选以及减少动态效果时跳过。日期键盘焦点在重绘后恢复。

桌面“舒展/紧凑”使用共享分段筛选组件，默认舒展，选择写入传入状态的 `density`，不声明跨会话持久化。选择班次后焦点移至详情容器并立即滚动到详情；“返回日历”优先聚焦当前选中且可见的班次；班次不存在或不可见时聚焦选中日期，并立即滚动至可见区域。详情面板与返回操作不改变报名资格、名额计算或提交接口。

1101px 起共享门户页头高 72px，导航项高 40px、水平内边距 14px、圆角 10px。当前页面使用主题浅底、主题色文字和下划线，页头吸顶时加深柔阴影。

## Do's and Don'ts

- Do 保留主题偏好、业务状态与筛选摘要语义。
- Do 使用共享组件与原生 JavaScript/CSS。
- Do 在桌面、手机及减少动态效果下检查布局和焦点。
- Don't 将手机单日显示误写为周汇总统计范围。
- Don't 用截图、合成测试或本地构建替代真实业务验收与部署验证。

源码依据：`public/styles/{tokens,themes,components,portal,portal-discovery,refinement,calendar,atmosphere}.css`、`public/app/portal/blood-calendar.js`、`public/app/portal/pages/workflow-events.js`、`public/app/core/{themes,motion}.js` 与 `public/app/main.js`。设计摘录不证明生产环境已部署；验证范围与发布检查见 [前端设计约定](docs/FRONTEND_DESIGN.md)及 [运维说明](docs/OPERATIONS.md)。
