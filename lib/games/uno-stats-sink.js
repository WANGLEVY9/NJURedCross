/* ==========================================================================
   南小红UNO —— 战绩存储
   - 默认：进程内 Map + 本地 JSON（.write-state/uno-stats.json），与旧实现一致，
     读写为业务侧内存操作，持久化失败静默降级，不影响游戏。
   - 可选：配置环境变量后把战绩镜像到 SeaTable 业务表（upsert，异步、失败静默）。
     生产环境若已有 SeaTable 账号体系，可由此入表；未配置则完全不碰 SeaTable。
   环境变量：
     UNO_STATS_SEATABLE_BASE   如 https://xxx.seatable.io
     UNO_STATS_SEATABLE_TOKEN  SeaTable API Token
     UNO_STATS_SEATABLE_TABLE  表名（默认「南小红UNO战绩」）
     UNO_STATS_FILE            本地战绩 JSON 路径（默认 .write-state/uno-stats.json，测试可覆盖）
   建议表结构（列）：
     账号(文本) / 对局(数字) / 胜场(数字) / 峰值(数字) /
     最近名次(数字) / 最佳名次(数字) / 垫底(数字) / 规则(文本) / 更新时间(日期)
   ========================================================================== */
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath, URL } from 'node:url';

const STATS_PATH = process.env.UNO_STATS_FILE
  ? resolve(process.env.UNO_STATS_FILE)
  : resolve(process.env.PLATFORM_WRITE_STATE_DIR || fileURLToPath(new URL('../../.write-state', import.meta.url)), 'uno-stats.json');
const statsStore = new Map();
let loaded = false;

function load() {
  if (loaded) return;
  loaded = true;
  try {
    if (existsSync(STATS_PATH)) {
      const obj = JSON.parse(readFileSync(STATS_PATH, 'utf8'));
      for (const [k, v] of Object.entries(obj)) statsStore.set(k, normalize(v));
    }
  } catch { /* 损坏/缺失文件忽略 */ }
}

function save() {
  try {
    mkdirSync(dirname(STATS_PATH), { recursive: true });
    writeFileSync(STATS_PATH, JSON.stringify(Object.fromEntries(statsStore), null, 2));
  } catch { /* 持久化失败不影响游戏 */ }
}

/** 老版本战绩文件没有名次字段，读入时补齐，避免 undefined 混进统计。 */
function normalize(raw) {
  const rec = raw && typeof raw === 'object' ? raw : {};
  return {
    games: Number(rec.games) || 0,
    wins: Number(rec.wins) || 0,
    best: Number(rec.best) || 0,
    lastRank: Number(rec.lastRank) || null,
    bestRank: Number(rec.bestRank) || null,
    ranks: rec.ranks && typeof rec.ranks === 'object' ? { ...rec.ranks } : {},
    lastPlaces: Number(rec.lastPlaces) || 0,
    lastRule: rec.lastRule || null,
  };
}

// ---- SeaTable 可选镜像 ---------------------------------------------------
const SEATABLE_BASE = process.env.UNO_STATS_SEATABLE_BASE || '';
const SEATABLE_TOKEN = process.env.UNO_STATS_SEATABLE_TOKEN || '';
const SEATABLE_TABLE = process.env.UNO_STATS_SEATABLE_TABLE || '南小红UNO战绩';
const USE_SEATABLE = Boolean(SEATABLE_BASE && SEATABLE_TOKEN);
const TOKEN_TTL_MS = 50 * 60 * 1000;
let tokenCache = { token: null, uuid: null, at: 0 };

async function seatableAuth() {
  if (!USE_SEATABLE) return null;
  if (tokenCache.token && Date.now() - tokenCache.at < TOKEN_TTL_MS) return tokenCache;
  try {
    const url = `${SEATABLE_BASE.replace(/\/$/, '')}/api-gateway/api/v1/auth/with-api-token`;
    const res = await fetch(url, {
      headers: { Authorization: `Token ${SEATABLE_TOKEN}` },
      cache: 'no-store',
    });
    if (!res.ok) return null;
    const data = await res.json();
    tokenCache = { token: data.access_token || null, uuid: data.dtable_uuid || null, at: Date.now() };
    return tokenCache.token ? tokenCache : null;
  } catch { return null; }
}

async function seatableUpsert(userId, rec) {
  const auth = await seatableAuth();
  if (!auth || !auth.uuid) return;
  const root = `${SEATABLE_BASE.replace(/\/$/, '')}/api-gateway/api/v1/dtable-server/dtable-server/api/v1/dtables/${auth.uuid}/rows`;
  const row = {
    账号: userId,
    对局: rec.games,
    胜场: rec.wins,
    峰值: rec.best,
    最近名次: rec.lastRank ?? '',
    最佳名次: rec.bestRank ?? '',
    垫底: rec.lastPlaces,
    规则: rec.lastRule || '',
    更新时间: new Date().toISOString(),
  };
  try {
    const listUrl = `${root}/?table_name=${encodeURIComponent(SEATABLE_TABLE)}`
      + `&filters=${encodeURIComponent(JSON.stringify([['账号', '=', userId]]))}`;
    const listRes = await fetch(listUrl, { headers: { Authorization: `Token ${auth.token}` }, cache: 'no-store' });
    const listData = listRes.ok ? await listRes.json() : { rows: [] };
    const existing = (listData.rows || [])[0];
    if (existing && existing._id) {
      await fetch(`${root}/`, {
        method: 'PUT',
        headers: { Authorization: `Token ${auth.token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ table_name: SEATABLE_TABLE, rows: [{ _id: existing._id, ...row }] }),
        cache: 'no-store',
      });
    } else {
      await fetch(`${root}/`, {
        method: 'POST',
        headers: { Authorization: `Token ${auth.token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ table_name: SEATABLE_TABLE, rows: [row] }),
        cache: 'no-store',
      });
    }
  } catch { /* 镜像失败静默，本地数据仍是权威 */ }
}

/**
 * 记录一局结果（含名次）。
 * @param {Array} seats   房间席位数组（需含 userId）
 * @param {number} winner 获胜席位下标
 * @param {Array<number>} scores 各席位累计分
 * @param {{ranking?: number[], winCondition?: string, loser?: number|null}} [extra]
 *   ranking 为按第 1 名 → 最后一名排列的席位下标数组（engine.rankingOf 产出）。
 *   不传时退化为旧口径：只把冠军算第 1 名，其余不计名次。
 */
export function recordResult(seats, winner, scores, extra = {}) {
  load();
  const { ranking = [], winCondition = 'first', loser = null } = extra;
  const total = seats.length;
  seats.forEach((seat, index) => {
    if (!seat.userId) return;
    const rec = normalize(statsStore.get(seat.userId));
    rec.games += 1;
    if (index === winner) rec.wins += 1;
    rec.best = Math.max(rec.best, scores?.[index] || 0);
    const place = ranking.indexOf(index);
    let rank = place >= 0 ? place + 1 : (index === winner ? 1 : null);
    if (rank === null && loser === index) rank = total;
    if (rank !== null) {
      rec.lastRank = rank;
      rec.bestRank = rec.bestRank ? Math.min(rec.bestRank, rank) : rank;
      rec.ranks[rank] = (Number(rec.ranks[rank]) || 0) + 1;
      if (rank === total) rec.lastPlaces += 1;
    }
    rec.lastRule = winCondition;
    statsStore.set(seat.userId, rec);
  });
  save();
  if (USE_SEATABLE) {
    for (const seat of seats) {
      if (seat.userId) void seatableUpsert(seat.userId, statsStore.get(seat.userId));
    }
  }
}

export function statsFor(userId) {
  if (!userId) return null;
  load();
  const rec = statsStore.get(userId);
  return rec ? { ...rec, ranks: { ...rec.ranks } } : null;
}
