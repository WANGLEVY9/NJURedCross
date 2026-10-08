/* ==========================================================================
   portal/pages/morning.js
   Standalone fallback page for the “早安晚安” signup form.
   The plaza entry opens the same form in a centred drawer.
   ========================================================================== */

import { h } from '../../core/dom.js';
import { morningApi, getSessionState } from '../../core/api.js';
import { navigate } from '../../core/router.js';
import { badge, button, notice, pageHead, receipt } from '../../ui/primitives.js';
import { loginRequiredPanel, redirectIfAuthError } from '../auth-gate.js';
import { buildMorningSignupForm, morningCardSummary, morningStatusBadge } from '../morning-form.js';

export default async function morningPage() {
  const node = h('div', { class: 'view morning-view' });
  node.append(pageHead({
    label: '早安晚安',
    title: '报名一张同行名片',
    description: '让同学通过兴趣认识彼此。报名信息经管理员审核后进入广场。',
    meta: [badge('独立模块', { tone: 'accent' }), badge('仅注册用户', { tone: 'neutral' }), badge('评论互动', { tone: 'info' })],
  }));

  if (!getSessionState().authenticated) {
    node.append(loginRequiredPanel({ what: '报名早安晚安', hint: '报名后才能创建名片。' }));
    return { title: '早安晚安报名', node };
  }

  const content = h('div', { class: 'morning-content stack-6' });
  node.append(content);
  let payload;
  try {
    payload = await morningApi.card();
  } catch (error) {
    if (redirectIfAuthError(error)) return { title: '早安晚安报名', node };
    content.append(notice(error.message || '暂时无法读取报名信息。', { tone: 'error', title: '加载失败' }));
    return { title: '早安晚安报名', node };
  }

  const { profile, card } = payload;
  if (profile.missing.length) {
    content.append(
      notice(`报名需要强绑定账号中的${profile.missing.join('、')}。请先在会员中心补全资料后再回来。`, {
        tone: 'warning',
        title: '账号资料未完整',
      }),
      h('div', { class: 'row-3 row-wrap' }, button({ label: '去会员中心完善资料', variant: 'primary', iconName: 'user', onClick: () => navigate('/me') })),
    );
    return { title: '早安晚安报名', node };
  }

  if (card && !['需修改', '已拒绝'].includes(card.status)) {
    content.append(
      h('section', { class: 'panel morning-card-status' },
        h('div', { class: 'panel__body stack-4' },
          h('div', { class: 'row-3 row-wrap' }, morningStatusBadge(card.status), badge(card.campus, { tone: 'accent' })),
          morningCardSummary(card),
          notice(card.status === '已发布'
            ? '你的名片已经发布到广场。第一版暂不支持直接修改已发布名片。'
            : '你的报名正在等待管理员审核。审核通过后会进入广场。', {
            tone: card.status === '已发布' ? 'success' : 'info',
          }),
        ),
      ),
    );
    return { title: '早安晚安报名', node };
  }

  const result = h('section', { class: 'panel morning-form-panel' });
  result.append(h('div', { class: 'panel__body' },
    buildMorningSignupForm({
      profile,
      card: card?.status === '需修改' || card?.status === '已拒绝' ? card : null,
      onSubmitted: (submitted) => {
        result.replaceChildren(h('div', { class: 'panel__body stack-4' },
          receipt({ title: '报名已提交', rows: [['名片编号', submitted.id], ['昵称', submitted.nickname], ['状态', submitted.status]] }),
          notice('管理员审核通过后，这张名片才会进入广场。', { tone: 'info' }),
          h('div', { class: 'row-3 row-wrap' }, button({ label: '返回会员中心', variant: 'secondary', iconName: 'user', onClick: () => navigate('/me') })),
        ));
      },
    }),
  ));
  content.append(...[
    card ? notice('这张名片之前被退回或拒绝。修改后会重新进入待审核。', { tone: 'warning', title: '重新提交' }) : null,
    result,
  ].filter(Boolean));
  return { title: '早安晚安报名', node };
}
