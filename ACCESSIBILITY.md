# 可访问性声明 · Accessibility

NJURedCross 希望师生和贡献者能用不同设备与操作方式参与校园公益。我们在日常开发中维护清晰的文字与状态、语义控件、键盘操作、可见焦点和减少动态效果偏好，并欢迎报告访问障碍。

## 当前支持与验证

| 范围 | 维护方式 |
| --- | --- |
| 桌面与手机 | 响应式布局；Playwright 桌面/手机 Chromium 回归 |
| 跨浏览器关键流程 | Firefox / WebKit 的关键页面、筛选、焦点、权限与轮播回归 |
| 键盘交互 | 检查导航、分段筛选、菜单/弹窗退出、焦点恢复与日历日期选择 |
| 动效与状态 | 系统/应用减少动态效果；通过文字、图标和数值补充颜色含义 |
| 语义与反馈 | 页面标题、控件名称、状态提示、加载/错误及空结果说明 |

自动测试覆盖具体场景；完整辅助技术兼容性、全部页面的屏幕阅读器体验和 WCAG 条款符合性仍需系统人工审查。当前未声明经独立认证的 WCAG 符合等级。现行测试和浏览器配置见 [测试指南](docs/TESTING.md) 与 [CI](.github/workflows/ci.yml)。

## 报告访问障碍

通过 [体验与文档表单](https://github.com/WANGLEVY9/NJURedCross/issues/new?template=design_documentation.yml) 选择“可访问性”，说明：

- 页面或文档位置、希望完成的任务与遇到的阻碍。
- 系统、浏览器、设备/辅助技术及版本，以及使用键盘、触屏或其他方式。
- 可复现步骤、预期体验与必要的合成或脱敏证据。

若不便使用 Issue 表单，可先在 [Discussions](https://github.com/WANGLEVY9/NJURedCross/discussions) 描述需要协助的方式。个人业务资料通过平台运营渠道处理，反馈范围与联系入口见 [SUPPORT](SUPPORT.md)。

## 参与改进

可从一个控件、一个流程或一份文档开始：描述障碍、给出改进前后行为、加入有价值的回归，并以真实浏览器和适用辅助技术核验。较大变更先讨论，保持原生 JavaScript/CSS 与共享组件的语义及焦点约定。参见 [贡献指南](CONTRIBUTING.md)、[前端设计约定](docs/FRONTEND_DESIGN.md) 和 [建设方向](ROADMAP.md)。
