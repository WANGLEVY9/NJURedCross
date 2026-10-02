from pathlib import Path
from xml.sax.saxutils import escape
from reportlab.pdfgen import canvas
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.ttfonts import TTFont
from reportlab.lib.colors import HexColor
from reportlab.platypus import Paragraph
from reportlab.lib.styles import ParagraphStyle
from pypdf import PdfReader
import pypdfium2 as pdfium

OUT = Path(__file__).parent
PDF = OUT / '南京大学红十字会网站开发进展_2026-09-30.pdf'
pdfmetrics.registerFont(TTFont('Chinese', '/System/Library/Fonts/Supplemental/Arial Unicode.ttf'))
W, H = 595.28, 841.89
INK = '#243247'
MUTED = '#627086'
COLORS = {'已完成': ('#18764D', '#EAF5EE'), '开发中': ('#2362AE', '#EBF2FC'), '测试中': ('#986000', '#FFF4DB'), '待排期': ('#6B5A8E', '#F0ECF7')}
FRONT = {
 '已完成': [
 ('首页与导航', '品牌、服务入口及近期活动正常加载；统计准确性见后端整改项。'),
 ('平台与隐私说明页', '页面可访问，已提供数据使用、同意与退出说明。')],
 '开发中': [
 ('物资借用页', '申请表单与编号反馈已有；账号归属、个人查询及部分归还闭环仍需完善。'),
 ('内容投稿页', '投稿与审核接口已有；附件、授权留痕、审核反馈和发布归档待完整验收。'),
 ('温暖连接页', '介绍、登记及管理页面已有；实际配对、退出联动与消息转达仍需完善。'),
 ('注册与邮箱验证页', '页面及验证码逻辑已有；本地 SMTP 未配置，线上注册能力接口返回 401，入口与部署版本需对齐。'),
 ('管理端：工作台／物资／活动', '页面、待办和业务操作已有；库存对账、异常补偿及真实活动运营待验收。'),
 ('管理端：宣传／温暖连接', '审核、排期及匹配预览已有；当前仅生成候选统计，不生成实际配对。'),
 ('管理端：志愿服务', '已接入第二 Base 只读数据；时长核对、反馈工单及个人履历仍需完善。'),
 ('管理端：数据／系统设置', '本地已有敏感表写入保护与权限守卫；上线清单含旧描述，需同步部署状态。')],
 '测试中': [
 ('活动广场与详情页', '列表、筛选及报名入口已有；报名至签到全流程待验收，当前过期活动仍显示报名中。'),
 ('登录／个人中心／状态查询', '账号隔离及查询逻辑已有，需线上回归；个人中心尚不包含物资借用记录。'),
 ('手机适配与可访问性', '390px 活动页抽查无横向溢出；全站表单、键盘、焦点和对比度待系统验收。')],
 '待排期': []}
BACK = {
 '已完成': [
 ('NJUTable 主 Base 连接', '本轮 API Token 认证与元数据读取成功，识别 30 张表；凭据保留在服务端。'),
 ('NJUTable 志愿 Base 连接', '第二 Token 认证与元数据读取成功，识别 23 张表；当前按只读方式接入。'),
 ('域名与 HTTPS 访问', 'njuredcross.cn 可访问，公众冒烟通过；Nginx、systemd 与证书自动续期有部署记录，本轮未登录服务器复核。')],
 '开发中': [
 ('数据准确性与版本同步', 'NJUTable 原表有 140 类物资，线上首页仅显示 100 类；本地分页修复尚未反映到该线上统计。'),
 ('模块权限与 Token 生命周期', '本地权限契约 17/17 通过，但账号表缺少“权限范围”列；本地认证缓存缺少定期刷新，需与线上修复版本核对。')],
 '测试中': [],
 '待排期': [
 ('SMTP／NJUBox／学校认证', '本地邮件及 NJUBox Token 未配置；真实投递、文件上传、CAS 与旧志愿平台绑定依赖外部参数。'),
 ('生产运维与扩容', '监控告警、备份恢复演练、凭据轮换、续费责任和多实例库存锁，尚缺本轮可核验的完成证据。')]}

c = canvas.Canvas(str(PDF), pagesize=(W,H))
c.setTitle('南京大学红十字会网站开发进展 · 2026-09-30')
c.setAuthor('南京大学红十字会网站项目')
style = ParagraphStyle('body', fontName='Chinese', fontSize=9.2, leading=14, textColor=HexColor(MUTED))

def para(text, x, y, width, size=9.2, color=MUTED):
    st = ParagraphStyle('p', parent=style, fontSize=size, leading=size*1.5, textColor=HexColor(color))
    p = Paragraph(escape(text),st)
    _,height=p.wrap(width,1000)
    p.drawOn(c,x,y-height)
    return height

def base(page, category, sub):
    c.setFillColor(HexColor('#B7233B')); c.rect(0,H-8,W,8,fill=1,stroke=0)
    c.setFont('Chinese',10); c.setFillColor(HexColor(MUTED)); c.drawString(38,H-38,'南京大学红十字会  /  网站建设')
    c.setFont('Chinese',23); c.setFillColor(HexColor(INK)); c.drawString(38,H-75,category+'开发进展')
    c.setFont('Chinese',9); c.setFillColor(HexColor(MUTED)); c.drawString(38,H-99,'检查日期：2026-09-30   ·   当前阶段：功能 Beta   ·   '+sub)
    x=38
    for status,(fg,bg) in COLORS.items():
        c.setFillColor(HexColor(bg));c.roundRect(x,H-134,78,22,5,fill=1,stroke=0)
        c.setFillColor(HexColor(fg)); c.setFont('Chinese',9);c.drawCentredString(x+39,H-127,status)
        x+=87
    c.setStrokeColor(HexColor('#E3E8EE'));c.line(38,39,W-38,39)
    c.setFont('Chinese',8);c.setFillColor(HexColor(MUTED));c.drawString(38,24,'已完成按具体能力认定；测试中表示已有实现、完整验收尚未完成。')
    c.drawRightString(W-38,24,f'{page} / 2')

def group(status, items, y, category):
    if not items: return y
    fg,bg=COLORS[status]
    c.setFillColor(HexColor(bg));c.roundRect(38,y-25,W-76,25,4,fill=1,stroke=0)
    c.setFillColor(HexColor(fg));c.setFont('Chinese',11);c.drawString(48,y-17,f'{status}  ·  {len(items)} 项')
    y-=35
    for title,desc in items:
        c.setFillColor(HexColor(fg));c.circle(43,y-6,2,fill=1,stroke=0)
        h=para(title,53,y,W-91,10,INK); y-=h+1
        h=para(desc,53,y,W-91); y-=h+9
    return y-3

base(1,'前端','公众页面与管理页面')
y=H-151
for status,items in FRONT.items(): y=group(status,items,y,'前端')
assert y>45, y
c.showPage()
base(2,'后端','数据连接、权限与部署运维')
y=H-151
for status,items in BACK.items(): y=group(status,items,y,'后端')
y-=8
c.setStrokeColor(HexColor('#DDE4EC'));c.line(38,y,W-38,y); y-=17
y-=para('本轮验证与检查边界',38,y,W-76,11,INK)+7
y-=para('已通过：代码语法检查、权限契约 17/17、线上公众冒烟、双 Base 认证及元数据读取。页面抽查覆盖桌面首页、注册页与 390px 手机活动页。',38,y,W-76)+8
y-=para('未执行：真实报名、借用、投稿、发信或配对测试；未登录服务器核查服务配置及证书续期任务。检查过程未修改代码、部署或业务数据。',38,y,W-76)+8
y-=para('优先处理：线上统计截断 → 本地与线上版本同步 → 注册入口状态 → 真实模块权限验收。',38,y,W-76,9.5,INK)
assert y>45,y
c.save()
reader=PdfReader(PDF)
assert len(reader.pages)==2
assert all(len(p.extract_text())>300 for p in reader.pages)
doc=pdfium.PdfDocument(str(PDF))
for i in range(len(doc)):
    doc[i].render(scale=1.5).to_pil().save(OUT/f'progress-preview-{i+1}.png')
print(f'Created {PDF}; verified 2 pages, text extraction, and rendered previews.')
