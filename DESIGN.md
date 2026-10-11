# NJURedCross 设计系统

更新：2026-10-11，页面艺术系统第 0 轮（C + P00）。

## 方向与内容

校园公益的编辑性表达与可核对的业务界面并存。首页介绍参与入口，广场帮助发现内容，周历与报名页帮助比较、核对和完成操作。正式徽标保持原图；首页五专题使用原创 SVG 插画，不充当真实活动照片。活动、名额、记录与时长来自接口，空态不使用虚构内容补位。

## 五主题与表面

晨曦红、海风蓝、青竹绿、鸢尾紫、秋日金共享组件结构，各自定义 accent、canvas、art-paper、文字和局部光场。`themes.css` 是主题调色所有者，`tokens.css` 定义基础尺度。

页面艺术系统由 `atmosphere.css` 管理底材、布局轴、局部光场、安静装饰和栏目转场；承载业务的表面仍归各组件所有。`page-art.js` 只向六类页面的标题容器添加无交互装饰。五主题复用语义色，但分别采用折页、路线、植物线稿、裁切薄片、书页边轮廓。设计比较、级联清理与后续轮次见 [P00 设计记录](docs/PAGE_ART_DIRECTION_P00.md)。首页主视觉与轮播、活动发现、预约工作台、社区纸张场景保持各自密度。装饰不接收鼠标，不遮挡正文或浮层，强制颜色与减少动态偏好优先。

业务状态独立于主题：可报名柔绿、满额中性灰、待审核暖黄、已确认/签到蓝色。每个状态同时保留文字和图标，不能只靠颜色辨认。满额班次仍可查看。

## 字体与尺度

自托管 `NJU Sans` / `NJU Serif` 子集字体由 `tokens.css` 声明，前者为正文和控件，后者用于编辑性标题；保留完整系统 fallback 与 `font-display:swap`。字体失败不能阻止内容呈现。日期、名额与统计使用等宽数字。

圆角基础梯度为 4 / 6 / 9 / 13 / 20 / 28px，主题可调整中大尺寸；日历、表单、内容表面按任务沿用对应尺度。阴影仅用于浮层和必要的层级，不给所有卡片加重阴影。文字必须在实际底材上验算对比度，不能只比较 token 的默认白色背景。

## 页面与组件所有权

| 文件 | 所有权 |
| --- | --- |
| `tokens.css` / `themes.css` | 字体、基础尺度、语义色、五主题 |
| `atmosphere.css` | 页面底材、装饰和光场 |
| `portal.css` | 门户顶栏、页脚、基础页面结构 |
| `components.css` | 按钮、输入、共享状态、tooltip、抽屉和弹层 |
| `portal-discovery.css` | 共享筛选、各广场与会员中心组件 |
| `discovery-art.css` | 首页编辑布局、活动内容密度与筛选布局 |
| `hero-showcase.css` | 五专题插画轮播与过渡 |
| `calendar.css` | 献血车日期、点位、密度与状态 |
| `booking.css` | 献血车与普通活动详情、身份确认和反馈 |

不在 refinement 继续覆盖日历；修改实际所有者。活动筛选以容器宽度决定换列，保证文字缩放后按钮仍可辨认。

## 交互约定

- 按压 90ms，hover/focus 使用既有 140–200ms，筛选指示 220ms，抽屉入场 280ms，轮播独立过渡约 420ms。动效遵守站内设置与系统减少动态偏好；周历不整体飞入。
- 分段控件使用 radio 语义和方向键；搜索和筛选保留焦点及 URL；结果有 live 播报。共享 tooltip 具有关联说明、悬停容错与 Escape 关闭。
- 模态隔离背景、保持焦点循环，关闭后回到触发点；正文与表单不依赖动画或悬停才可见。
- 血车详情返回日历恢复已选班次焦点。报名须知明确说明禁用原因；提交防重复、错误保留输入，反馈使用服务器状态。
- 普通活动使用原生场次 radio，直接确认与候补分别说明；凭证来自响应，结果展示后聚焦顶部。

## 五套美术档案

| 主题 | Canvas | 光场 1 / 2 | Raised | 文字 / 艺术强调 |
| --- | --- | --- | --- | --- |
| 晨曦红 | `#f7f1eb` | `#ead1c5` / `#e6d7ad` | `#fffaf5` | `#462d35` / `#6e233b` |
| 海风蓝 | `#f0f5f8` | `#c4dfe9` / `#d8e0d8` | `#fcfeff` | `#253d51` / `#204d6a` |
| 青竹绿 | `#f2f5ec` | `#ccdbc3` / `#e5d9ac` | `#fcfdf8` | `#2d4638` / `#315f45` |
| 鸢尾紫 | `#f5f1f7` | `#dbcee8` / `#e7d8cf` | `#fffbff` | `#443350` / `#624175` |
| 秋日金 | `#faf4e6` | `#ead6a5` / `#e1cdbd` | `#fffdf6` | `#513e27` / `#76542b` |

按钮与选中项沿用主题 accent，焦点使用 focus-ring，边线为主题文字 16% 的混色；阴影只使用 5% 与 32% 的主题文字色。五主题切换保留原有 ID 与门户/控制台独立偏好，不重新请求业务数据。

## 自托管字体

排版样张在站点 `/design/typography.html` 可查看。正文、表单、导航使用 NJU Sans（Noto Sans SC 子集）；品牌与内建展示标题使用 NJU Serif（Noto Serif SC 600 子集）。Sans 可变字重 297088 字节，Serif 固定 600 字重 55948 字节，合计约 345 KiB，不加载全量 CJK。

来源为 Google Fonts 的 [Noto Sans SC](https://github.com/google/fonts/tree/main/ofl/notosanssc) 与 [Noto Serif SC](https://github.com/google/fonts/tree/main/ofl/notoserifsc)，采用 SIL OFL 1.1，版权与许可随文件分发在 `public/assets/fonts`，源文件 SHA256 与子集字符数见该目录 manifest.json。

## 验证与边界

场景规范见 [活动报名设计](docs/ACTIVITY_BOOKING_DESIGN.md)，桌面矩阵、发现与修复见 [P11 验收记录](reports/DESKTOP_QA_P11.md)。运行 `npm run verify` 与 `npm run test:browser`。合成数据用于布局、权限状态和交互测试；自动无障碍扫描之外仍需屏幕阅读器人工验收。发布状态按 [OPERATIONS](docs/OPERATIONS.md) 核对 Actions、服务器发布清单及线上页面。
