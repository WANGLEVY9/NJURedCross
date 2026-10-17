/**
 * 岗位编号：把岗位名映射成「岗位一、岗位二……」。
 *
 * 编号依据是岗位配置里的顺序（`positionPlan.positions` 数组），这是唯一被持久化、
 * 且与生成岗位子行一一对应的顺序（`projectPositions` 按下标生成 `PS-` 子行）。
 * 拿不到配置时（例如只读名单），退化为「按首次出现顺序编号」，并在调用方提示。
 */
const NUMERALS = ['一', '二', '三', '四', '五', '六', '七', '八', '九', '十'];

export function numeral(index) {
  const n = Number(index);
  if (!Number.isInteger(n) || n < 1) return '';
  if (n <= 10) return NUMERALS[n - 1];
  if (n < 20) return `十${NUMERALS[n - 11]}`;
  if (n < 100) {
    const tens = Math.floor(n / 10), ones = n % 10;
    return `${NUMERALS[tens - 1]}十${ones ? NUMERALS[ones - 1] : ''}`;
  }
  if (n < 1000) {
    const hundreds = Math.floor(n / 100), rest = n % 100;
    const head = `${NUMERALS[hundreds - 1]}百`;
    if (!rest) return head;
    if (rest < 10) return `${head}零${NUMERALS[rest - 1]}`;
    if (rest < 20) return `${head}一十${rest > 10 ? NUMERALS[rest - 11] : ''}`;
    const tens = Math.floor(rest / 10), ones = rest % 10;
    return `${head}${NUMERALS[tens - 1]}十${ones ? NUMERALS[ones - 1] : ''}`;
  }
  return String(n);
}

export function positionCode(index) {
  return `岗位${numeral(index)}`;
}

/**
 * 建立岗位名 → 编号的映射。
 * @param {Array<{name?:string}>|string[]} positions 岗位配置（按顺序）或岗位名数组
 */
export function buildPositionMap(positions = []) {
  const map = new Map();
  positions.forEach((item, index) => {
    const name = String(typeof item === 'string' ? item : item?.name || '').trim();
    if (!name || map.has(name)) return;
    map.set(name, { code: positionCode(map.size + 1), index: map.size + 1, name });
  });
  return map;
}

/** 按首次出现顺序建立映射，用于只有名单、没有岗位配置的视图。 */
export function buildPositionMapFromRows(rows = []) {
  const seen = [];
  for (const row of rows) {
    const name = String(row?.['岗位'] || '').trim();
    if (name && !seen.includes(name)) seen.push(name);
  }
  return buildPositionMap(seen);
}

export function labelPosition(map, name) {
  const label = String(name || '').trim();
  if (!label) return '不限岗位';
  const item = map?.get?.(label);
  return item ? `${item.code} · ${item.name}` : label;
}

/** 表格上方的对照说明；岗位少于 2 个时不显示。 */
export function positionLegend(map) {
  const items = [...(map?.values?.() || [])];
  if (items.length < 2) return '';
  return items.map(item => `${item.code} ${item.name}`).join(' · ');
}
