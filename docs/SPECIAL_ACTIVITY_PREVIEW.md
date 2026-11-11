# 排班专项本地验收

在仓库目录运行：

```powershell
npm.cmd run preview:special
```

打开 http://127.0.0.1:3137/events 和 http://127.0.0.1:3137/console/admin 。启动时也会打印两个登记项目的直达地址。预览使用合成账号、内存业务表和本地私有示例图片，固定业务时间为 2026-11-11 16:00；重启后业务记录重置，不读取生产配置。

验收流程：

1. 两种登记项目在管理端和活动广场统一显示“报名中”；旧的“进行中”项目仍兼容登记、核验和结束，已结束项目保持已结束。用户端：省献血车填写已完成的日期、起止时间、四选一岗位并上传凭证；成分献血填写实际日期、实际时长、献血量并上传献血证。
2. 管理端：登记人数/记录数独立显示；搜索、批量核验、退回和导出保持可用。省献血车的表格和导出包含时间、岗位。
3. 默认交通/培训/服务时长分别为成分献血 1/1/4、省献血车 2/2/4；超管在“修改活动信息”中修改后供后续初审使用。既有时长明细保留。
4. 核验通过生成待终审时长，经过原有终审和入账流程后处理；旧的仅日期登记仍可在“历史签到与初审”处理。
5. 省红会组宣部值班仅从管理员中心开启，不需要新建草稿；未开启时不生成活动入口。管理员中心可启停；周一至周五 09:00–12:00、14:00–17:00，每班 1 人，默认 1/1/3。活动广场只有一个长期入口；报名使用献血车式周历，完整显示周一到周五、支持切换周次。自动延续未来周次，暂停保留参与记录，已归档周次不重开。
6. 通用排班、体检、疫苗接种（含历史类型）均使用用户端周历；管理端报名处理、签到初审、终审默认日历看板。单岗位隐藏岗位筛选，多岗位保留筛选。进行中、已结束的排班详情仍可查看日历，不能继续报名。
7. 排班专项按班次开始时间提前至少 24 小时关闭报名，凭证上传与事后登记不受报名截止影响。

针对业务、历史记录和底表原生类型的检查：

```powershell
node --test tests/special-activity.test.mjs tests/special-registry-workflow.test.mjs tests/special-schedule-workflow.test.mjs tests/special-schedule-api.test.mjs tests/recurring-duty.test.mjs tests/registration-schema.test.mjs
```

浏览器场景使用显式合成预览开关，避免影响其他固定日期的回归用例：

```powershell
$env:PREVIEW_SPECIAL_ACTIVITIES='1'
npx.cmd playwright test tests/browser/special-activities.spec.mjs tests/browser/admin-center-layout.spec.mjs
Remove-Item Env:PREVIEW_SPECIAL_ACTIVITIES
```
