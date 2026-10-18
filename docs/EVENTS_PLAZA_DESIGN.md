# 活动广场参考图实现

正式页面为 `/events`；独立效果案例为 `/design/events-plaza.html`。
案例使用内存中的六条演示活动，筛选和轮播均可交互，不访问业务 API，不提交报名。
两者共享轮播、类别入口、流程组件及活动卡片。

字体：大标题使用站点 serif 栈（`--font-serif`，含 NJU Information /
Source Han Serif SC），正文与卡片使用 `--font-sans`。不随包发布全量中文
字体：早期两颗全量 WOFF2 共约 18MB，会让发布包超过部署体积上限而被拒绝。
`font-display: swap` 在加载期间使用系统中文字体。

六类图标沿用 `activityEmblem()`，不另行生成。
轮播支持上一张、下一张、圆点、方向键和暂停，鼠标停留、键盘焦点期间停止自动切换；
系统减少动态效果偏好会停用自动播放。切换路由时清理定时器。

轮播照片尚待 Owner 提供，当前明确显示占位。收到后只需修改
`public/app/portal/events-showcase.js` 的 `EVENT_SLIDES`，填写照片 URL 与替代文本。
生产照片放独立照片存储，不提交进源码仓库。

本地验证：分别以端口 3137 启动 `scripts/preview-site.mjs`，以端口 3138 启动
`scripts/preview-workflow.mjs`；运行 `node scripts/verify-events-plaza.mjs`。
脚本通过本机 Edge 检查桌面、手机案例交互和正式活动页的合成数据展示，截图保存在 reports。
