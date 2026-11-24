import { h } from '../core/dom.js';

/**
 * 美编候选选择器（2026-11-24）。
 *
 * 文字稿件初审「含美编招募」要求对接人当场登记美编，登记靠名册精确检索。
 * 两种典型情况必须说清楚，否则对接人只会得到一句「没找到」：
 *   1. 名册查无此人 —— 新成员还没入册，属于**未注册**，要先补录名册再登记；
 *      但若输入的是残缺学号（< 6 位），那是「学号没填完」，不能误报成未注册。
 *   2. 同名多人 —— 名册里「邓清怡」「葛浩东」「唐子淇」各有两人，
 *      需要把候选人并排摆出来让人按学号挑，抽屉里放不下竖排按钮，
 *      所以做成**横向可滑动**的卡片轨道（触摸滑动 / 触控板 / Tab 键均可）。
 *
 * 纯模型函数（memberLookupHint / memberCards）不碰 DOM，便于单测；
 * memberPicker 只负责拼装节点。
 */

/** 学号最短长度，与名册校验口径（6–20 位）一致。 */
const STUDENT_ID_MIN = 6;

/**
 * 解释一次检索结果。命中时返回 null（由调用方直接选中或列卡片）。
 * @returns {{tone:string,title:string,text:string}|null}
 */
export function memberLookupHint(query, payload = {}) {
  const keyword = String(query ?? '').replace(/\s+/g, ' ').trim();
  if (!keyword) return null;
  const members = Array.isArray(payload?.members) ? payload.members : [];
  if (members.length) return null;
  if (/^\d+$/.test(keyword) && keyword.length < STUDENT_ID_MIN) {
    return {
      tone: 'warning',
      title: '学号还没填完整',
      text: `「${keyword}」只有 ${keyword.length} 位，学号是 ${STUDENT_ID_MIN}–20 位数字，请补全后再查。`,
    };
  }
  return {
    tone: 'warning',
    title: '该成员未注册',
    text: `名册（全体成员表·26~27学年）里没有「${keyword}」，无法登记为美编。请先核对姓名或学号是否写错；若确是新成员，需联系管理员补录名册，补录后再回来登记。`,
  };
}

/**
 * 名册行 → 卡片模型。按学号收敛重复行，并统计同名人数用于「同名 N 人」标记。
 * @returns {Array<{id:string,name:string,studentId:string,faculty:string,email:string,sameName:number,label:string}>}
 */
export function memberCards(members = []) {
  const seen = new Set();
  const rows = [];
  for (const raw of Array.isArray(members) ? members : []) {
    const name = String(raw?.name ?? '').trim();
    const studentId = String(raw?.studentId ?? '').trim();
    if (!name || !studentId || seen.has(studentId)) continue;
    seen.add(studentId);
    rows.push({
      id: String(raw?.id ?? ''),
      name,
      studentId,
      faculty: String(raw?.faculty ?? '').trim(),
      email: String(raw?.email ?? '').trim(),
    });
  }
  const nameCount = new Map();
  for (const row of rows) nameCount.set(row.name, (nameCount.get(row.name) || 0) + 1);
  return rows.map((row) => ({
    ...row,
    sameName: nameCount.get(row.name) || 1,
    label: `${row.name} · ${row.studentId}${row.faculty ? ` · ${row.faculty}` : ''}`,
  }));
}

/**
 * 候选人卡片轨道（横向滚动）。选中即回调 onPick(card)，并把选中态写进 aria-pressed。
 */
export function memberPicker(members, { onPick = () => {}, query = '' } = {}) {
  const cards = memberCards(members);
  const root = h('div', { class: 'member-pick' });
  if (!cards.length) return root;

  const lead = query
    ? `「${query}」匹配到 ${cards.length} 人，左右滑动卡片，按学号选中本人：`
    : `匹配到 ${cards.length} 人，左右滑动卡片，按学号选中本人：`;
  const track = h('div', {
    class: 'member-pick__track',
    attrs: { role: 'group' },
    aria: { label: '美编候选人' },
  });

  const buttons = cards.map((card) => {
    const button = h(
      'button',
      {
        type: 'button',
        class: 'member-pick__card',
        data: { studentId: card.studentId },
        aria: { pressed: 'false', label: `选择${card.label}` },
        on: { click: () => choose(card, button) },
      },
      h('span', { class: 'member-pick__name' },
        card.name,
        card.sameName > 1 ? h('span', { class: 'member-pick__badge', text: `同名 ${card.sameName} 人` }) : null),
      h('span', { class: 'member-pick__meta', text: `学号 ${card.studentId}` }),
      card.faculty ? h('span', { class: 'member-pick__meta', text: card.faculty }) : null,
    );
    return button;
  });

  function choose(card, button) {
    for (const item of buttons) item.setAttribute('aria-pressed', String(item === button));
    onPick(card);
  }

  track.append(...buttons);
  root.append(
    h('p', { class: 't-caption member-pick__lead', text: lead }),
    track,
    h('p', { class: 't-caption t-faint member-pick__swipe', text: '卡片可左右滑动；也能直接填学号检索唯一人选。' }),
  );
  return root;
}
