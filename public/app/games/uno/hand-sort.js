/* ==========================================================================
   南小红UNO —— 手牌排序（第十二版）
   - 纯显示层排序：不碰 DOM、不依赖浏览器 API，可被 node --test 直接 import。
   - 口径由金大夫指定：
       按色：红 → 黄 → 绿 → 蓝 → 紫（「紫」＝无色的变色 / 加四万能牌）
       同色内：数字 0-9 → 反转 → 禁止 → +2
       按点：以牌型 / 点数为主序，颜色次序为次序
   - 引擎的 COLORS 仍是 ['r','g','b','y']（洗牌、AI、选色都依赖它），
     这里的颜色次序只用于显示，不要回去改 engine.js。
   - 出牌事件始终提交 card.id，排序不会造成点击错位。
   ========================================================================== */

export const HAND_SORTS = [
  { key: 'default', label: '原序' },
  { key: 'color', label: '按色' },
  { key: 'value', label: '按点' },
];

/** 红黄绿蓝；无色万能牌单列第五组「紫」。 */
export const COLOR_ORDER = { r: 0, y: 1, g: 2, b: 3 };
export const WILD_COLOR_ORDER = 4;

/** 同色内次序：数字按面值 0-9，其后依次 反转 → 禁止 → +2 → 变色 → 加四。 */
export const KIND_ORDER = {
  number: 0,
  reverse: 10,
  skip: 11,
  draw2: 12,
  wild: 13,
  wild4: 14,
};

function colorRank(card) {
  if (!card.color) return WILD_COLOR_ORDER;
  return COLOR_ORDER[card.color] ?? WILD_COLOR_ORDER;
}

function valueRank(card) {
  if (card.kind === 'number') {
    const value = Number(card.value);
    return Number.isFinite(value) ? Math.max(0, Math.min(9, value)) : 0;
  }
  return KIND_ORDER[card.kind] ?? 15;
}

export function sortHand(cards, mode) {
  const list = (cards || []).slice();
  if (mode === 'default' || list.length < 2) return list;
  list.sort((a, b) => {
    const primary = mode === 'color'
      ? colorRank(a) - colorRank(b) || valueRank(a) - valueRank(b)
      : valueRank(a) - valueRank(b) || colorRank(a) - colorRank(b);
    // id 兜底：同色同点（如两副 1-9）保持确定性顺序，避免浏览器间排序抖动。
    return primary || String(a.id).localeCompare(String(b.id));
  });
  return list;
}
