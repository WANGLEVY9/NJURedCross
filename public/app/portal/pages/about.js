/* ==========================================================================
   portal/pages/about.js
   Task: tell people exactly what this platform does with their data and who
   is accountable. Written as a document, not as a grid of cards.
   ========================================================================== */

import { h, icon } from '../../core/dom.js';
import { button, notice, badge, definitionList } from '../../ui/primitives.js';

function article(title, paragraphs, { label = '' } = {}) {
  return h(
    'section',
    { class: 'doc__section' },
    label ? h('p', { class: 't-label', text: label }) : null,
    h('h2', { class: 't-h2', text: title }),
    ...paragraphs.map((paragraph) =>
      Array.isArray(paragraph)
        ? h('ul', { class: 'bullets' }, ...paragraph.map((item) => h('li', null, icon('check', 'ico ico--sm'), h('span', { text: item }))))
        : h('p', { class: 't-prose', text: paragraph }),
    ),
  );
}

export default async function aboutPage() {
  const node = h(
    'div',
    { class: 'view' },
    h(
      'div',
      { class: 'formpage' },
      h(
        'header',
        { class: 'stack-3' },
        h('a', { class: 't-caption t-muted row-2', href: '/' }, icon('chevronLeft', 'ico ico--sm'), h('span', { text: '返回首页' })),
        h('div', { class: 'row-3 row-wrap' }, h('p', { class: 't-label', text: '平台说明' }), badge('校内服务', { tone: 'accent' })),
        h('h1', { class: 't-h1', text: '这个平台怎么运作，你的信息如何被对待' }),
        h('p', { class: 't-prose', text: '南京大学红十字会平台由两部分组成：你正在使用的公开服务入口，以及仅供负责同学登录的运营管理端。两者共用一套数据，但权限、可见字段与操作记录完全分离。' }),
      ),
      h(
        'div',
        { class: 'doc' },
        article(
          '两种使用模式',
          [
            '公开服务入口面向全体同学，用来报名活动、申请物资借用、投递内容与加入温暖连接。它只能读取已公开的活动信息，并创建属于你自己的提交记录。',
            '运营管理端面向物资、活动、志愿服务与内容审核的负责同学，需要账号登录。审批、出入库、签到核验、内容审核与发布排期都在这里完成，并且每一次写入都会记录操作者、时间与变更摘要。',
          ],
          { label: '产品结构' },
        ),
        article(
          '你的信息会被怎样使用',
          [
            '我们遵循“只收集完成这件事所必需的信息”。不同通道收集的内容不同，并且不会跨通道复用：',
            [
              '活动报名：姓名、校内邮箱、校区与你主动填写的备注，用于名额确认、候补递补与现场签到。',
              '物资借用：姓名、学号、邮箱、借用物资与用途，用于审批、出入库核对与逾期提醒。',
              '内容投稿：标题、正文、署名方式与联系方式，用于人工审核与发布沟通。',
              '温暖连接：显示昵称、邮箱、频率，以及（仅生日祝福）生日的月和日。',
            ],
            '公开页面不会展示任何人的手机号、微信、QQ、学号或身份证信息。管理端展示联系方式时也会按字段做脱敏处理。',
          ],
          { label: '数据边界' },
        ),
        article(
          '关于温暖连接的额外承诺',
          [
            '温暖连接不是社交或交友产品。它必须由你主动加入，不会因为组织内已有你的生日或联系方式就默认让你参与。',
            [
              '平台不会自动发送任何内容，所有内容都要先通过人工审核。',
              '首版不交换微信、QQ 或手机号；问候统一由平台代为转达。',
              '祝福对接收方匿名，但对管理员可追溯，以便处理骚扰与举报。',
              '你可以随时退出、屏蔽或举报；退出后立即停止进入匹配与发送队列。',
            ],
          ],
          { label: '同意与撤回' },
        ),
        article(
          '技术与安全边界',
          [
            '业务数据保存在校内部署的 SeaTable。浏览器不会接触任何 SeaTable 凭据：所有数据访问都由本站服务端完成，并在返回前做字段白名单与脱敏处理。',
            '管理端使用 HttpOnly 会话 Cookie，写操作还需要与会话绑定的 CSRF 令牌。公开入口的提交接口按来源地址限流，并要求明确的同意确认。',
          ],
          { label: '工程实现' },
        ),
        article(
          '还在建设中的部分',
          [
            '我们不希望把尚未完成的能力说成已经完成。以下能力正在推进：',
            [
              '接入学校统一身份认证，替代当前的本地管理员账号。',
              '志愿服务时长的跨数据源核对，目前为只读展示与人工复核。',
              '微信公众号与 QQ 群的自动发布，目前由运营同学人工确认后发布。',
            ],
          ],
          { label: '进展透明' },
        ),
        h(
          'section',
          { class: 'doc__section' },
          h('p', { class: 't-label', text: '联系与反馈' }),
          h('h2', { class: 't-h2', text: '有疑问、需要撤回信息，或者想举报' }),
          definitionList([
            ['活动与报名', '请联系对应活动的负责同学，或在「我的状态」查询后按页面提示处理。'],
            ['物资借用', '联系物资管理员，说明申请编号与需要调整的内容。'],
            ['内容与版权', '联系宣传负责同学，提供投稿编号即可撤回或修改。'],
            ['隐私与举报', '联系红十字会负责人；涉及骚扰或不当内容时会暂停相关发送并进入人工处置。'],
          ]),
          notice('本页描述的是平台当前的实际行为。如果你发现页面表现与说明不一致，请告知我们——这属于需要修复的问题。', { tone: 'info' }),
        ),
        h('div', { class: 'row-3 row-wrap' }, button({ label: '返回首页', variant: 'secondary', href: '/' }), button({ label: '浏览活动', variant: 'ghost', iconAfter: 'arrowRight', iconMotion: 'nudge', href: '/events' })),
      ),
    ),
  );

  return { title: '平台与隐私说明', node };
}
