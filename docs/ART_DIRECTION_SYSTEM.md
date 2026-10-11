# 背景、主题与字体系统

本轮对应桌面美术手册 P01 / P04 / P05。既有导航、API、报名状态与正式徽标保持原样；轮播与新 Hero 构图属于下一轮。

## 样式所有权

| 层 | 所有者 | 职责 |
| --- | --- | --- |
| Canvas | themes.css → atmosphere.css | 主题提供色值，路由选择纸张或工作台底色 |
| Diffuse Lighting | atmosphere.css、discovery-art.css | 页首局部椭圆光场；首页向正文底色自然收束 |
| Decorative Geometry | warmth.css、既有插画 | 内建页低对比纸纹；保留原创 SVG 与正式徽标 |
| Elevated Surface | 页面组件 CSS | 主题化卡片、筛选条、按钮和边线；避免透明玻璃面板 |
| Typography | tokens.css → base.css | 字体文件与角色变量；页面只决定对应角色的尺寸 |

移除 experience.css 对 Hero 色值的再次定义，移除 portal-discovery.css 的旧首页 Hero 布局/背景覆盖，discovery-art.css 与 calendar.css 不再自行声明固定底色调色板。装饰伪元素 pointer-events:none；背景使用原生静态渐变，没有新增滤镜、视差、固定画布或常驻动画。forced-colors 使用系统 Canvas；减少动态偏好继续由现有动效机制处理。

## 五套美术档案

| 主题 | Canvas | 光场 1 / 2 | Raised | 文字 / 艺术强调 |
| --- | --- | --- | --- | --- |
| 晨曦红 | #f7f1eb | #ead1c5 / #e6d7ad | #fffaf5 | #462d35 / #6e233b |
| 海风蓝 | #f0f5f8 | #c4dfe9 / #d8e0d8 | #fcfeff | #253d51 / #204d6a |
| 青竹绿 | #f2f5ec | #ccdbc3 / #e5d9ac | #fcfdf8 | #2d4638 / #315f45 |
| 鸢尾紫 | #f5f1f7 | #dbcee8 / #e7d8cf | #fffbff | #443350 / #624175 |
| 秋日金 | #faf4e6 | #ead6a5 / #e1cdbd | #fffdf6 | #513e27 / #76542b |

Hero、插画容器、卡片、筛选、页脚共享档案；按钮/选中项沿用主题 accent，焦点使用 focus-ring，边线为主题文字 16% 的混色。阴影仅使用 5% 及 32% 的主题文字色。五主题切换保留原有 ID、筛选与门户/管理端独立偏好，不重新请求业务数据。外观选择器展示微缩 Hero、标题、卡片与按钮。

可报名、已满、待审核、成功和错误仍使用原有语义色，附有文字/图标。主题 accent 不替代业务状态。徽标以及原创插画内容保持原色，插画周围的纸面和边线随主题变化。

## 四类页面

- 首页：左上暖光与右上主题光场，向正文渐隐；深色文字与宋体标题；不再使用整块固定蓝色。
- 活动广场：顶部右侧单向光场，筛选表面清晰，列表背景留白，避免将整页复制成 Hero。
- 献血车：弱斜向光线和接近中性的工作台；不改变班次语义色，优先日期、点位和名额可读性。
- 内建广场：纸色、局部暖光、低对比斜向纤维纹理；标题与祝福卡片形成编辑式阅读节奏。

## 自托管字体

[排版样张](../public/design/typography.html) 在站点 `/design/typography.html` 可查看。正文、表单、导航使用 NJU Sans（Noto Sans SC 子集）；品牌与内建展示标题使用 NJU Serif（Noto Serif SC 600 子集）。数字使用等宽数字特性。正文 16px、辅助正文 15px、标题 22–40px、首页展示标题 48–68px；小标签保持紧凑，避免一刀切放大。

来源为 Google Fonts 的 [Noto Sans SC](https://github.com/google/fonts/tree/main/ofl/notosanssc) 与 [Noto Serif SC](https://github.com/google/fonts/tree/main/ofl/notoserifsc)，采用 SIL OFL 1.1。版权和许可随文件分发在 public/assets/fonts。源文件 SHA256、子集字符数与字节数见该目录 manifest.json。Sans 可变字重仅一份 297088 字节；Serif 固定 600 为 55948 字节，总计约 345 KiB，没有加载全量 CJK 字体。

通过 fontTools subset / varLib.instancer 将来源 TTF 裁剪为 WOFF2。Sans 覆盖当前 public/app 中文文案、ASCII 和标点；Serif 覆盖展示文案及 ASCII。新增固定展示文案时应扩充子集；用户生成或未覆盖字符由系统 CJK 字体回退。font-display:swap，Sans 首屏 preload；无需第三方字体域名或 CSP 放宽。图片、数据与业务模块没有新增依赖。
