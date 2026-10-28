# 阴历生日

生日祝福计划的加入表单和会员中心生日修改抽屉均可选择「阳历（公历）」或「阴历（农历）」，只记录月日与历法，不收集出生年份。已有记录缺少历法时按阳历处理。管理员查看参与者时也可看到历法。

阴历生日使用香港天文台的[公历与农历对照表](https://www.hko.gov.hk/sc/gts/time/conversion.htm)，本地数据覆盖公历 2026-01-01 至 2030-12-31（含 2030 年）。数据文件为 `lib/community/data/lunar-calendar-2026-2030.js`，保留逐年来源 URL 和原始文件 SHA-256。`node scripts/download-lunar-calendar.mjs` 可重新下载与校验连续日期、每日日期和月长；运行网站和生日投递时无需访问外部历法服务，也没有新增 npm 依赖。

规则：闰月出生者按普通同月；遇到闰月不再次投递。生日三十遇到小月时，在二十九投递。自动任务仍按上海时间与原有投递开关运行，保留原有祝福匹配、审核、黑名单、退出和邮件幂等规则。此功能针对个人加入生日祝福计划的登记，不改变「写给挚友」的下次阳历生日单次投递。

## SeaTable 升级

在管理业务库的「温暖连接参加表」新增一个 **text 类型**字段「生日历法」，值为 `solar` 或 `lunar`。允许空值，空值按阳历处理；不需要回填旧记录。已更新生日表结构脚本，仅增加缺少的字段，不修改或删除行。

```powershell
node --env-file=.env.schema scripts/apply-birthday-schema.mjs
node --env-file=.env.schema scripts/apply-birthday-schema.mjs --apply --confirm=CREATE-NJU-RC-BIRTHDAY-SCHEMA
```

如之前「写给挚友」的三个字段仍缺失，同一脚本也会列出并添加，执行前检查 preview。未补「生日历法」时，原有阳历登记和投递继续正常；阴历保存返回配置提示，不会静默保存成阳历。日期超出数据范围后，阴历不会按阳历发送，需在 2030 年底前扩充数据与测试。
