/* ==========================================================================
   气候哨兵 · 韧性社区 —— 规则引擎（纯函数 / 可序列化 / 可复现）
   - 所有状态是普通对象；pending 只存可序列化描述，绝不存函数。
   - RNG 用 mulberry32 种子，便于复现与测试。
   - 权威信息（真实身份、秘密记录）只在 state 内；project(view=seat) 隐藏他人秘密。
   - 昼夜状态机严格按规则书 p.5–9：首夜 → 白天 → 普通夜 → … → 终局。
   ========================================================================== */
import {
  ROLES, ROLE_IDS, CATEGORY, WEATHER, WEATHER_IDS, PLAYER_SETUP, SCRIPTS,
  INHERIT_ORDER, NIGHT_ORDER,
} from './data.js';

export const RESILIENCE_START = 3;
export const RESILIENCE_MAX = 4;
const DEFAULT_NAMES = ['一号','二号','三号','四号','五号','六号','七号','八号','九号','十号','十一号','十二号','十三号'];

/* -------------------------------------------------------------------------- */
/* 基础工具                                                                    */
/* -------------------------------------------------------------------------- */
export function makeRng(seed = 1) {
  let a = (Number(seed) || 1) >>> 0;
  return function rng() {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const clone = (v) => JSON.parse(JSON.stringify(v));
const idx = (s, id) => s.players.findIndex((p) => p.id === id);
const P = (s, id) => s.players[idx(s, id)];
const alive = (s) => s.players.filter((p) => !p.left);
const aliveCount = (s) => alive(s).length;
const teamOf = (s, p) => CATEGORY[ROLES[p.role]?.category]?.team || 'community';
const isLeaderRole = (r) => r === 'panicseed' || r === 'thunder';
const ceil = (n, d) => Math.ceil(n / d);

function shuffle(arr, rng) {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i -= 1) {
    const j = Math.floor(rng() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}
function draw(arr, rng) { return arr[Math.floor(rng() * arr.length)]; }

function note(s, kind, text, extra = {}) {
  s.log.push({ day: s.day, phase: s.phase, kind, text, ...extra });
  if (s.log.length > 400) s.log.splice(0, s.log.length - 400);
}

/* -------------------------------------------------------------------------- */
/* 开局                                                                        */
/* -------------------------------------------------------------------------- */
/**
 * createGame(options)
 *  options: { playerCount, scriptId, variant, seed, names, useHoarder }
 *  - 按人数/剧本取角色名单，恰好 1 名初始首领。
 *  - 囤积者(useHoarder)：把 1 名哨兵换成未使用的随机协助者（不换宣讲/后勤）。
 *  - 实习生：真实牌留协调员，玩家收到未分发的站长/共情者假面。
 *  - 站长固定误报对象：秘密选中一名其他真实社区玩家。
 *  - 天气按剧本预置 + 洗匀。
 */
export function createGame(options = {}) {
  const count = Math.max(5, Math.min(13, Number(options.playerCount) || 8));
  const script = SCRIPTS[options.scriptId] || SCRIPTS.firstWave;
  const rng = makeRng(options.seed ?? 1);
  const base = PLAYER_SETUP[count];

  // 选名单：优先剧本固定名单，否则按人数从各类别随机取
  const roster = script.rosters?.[count];
  let pick = roster
    ? { sentinel: roster.sentinel.slice(), assistant: roster.assistant.slice(), minion: roster.minion.slice(), leader: roster.leader.slice() }
    : {
        sentinel: shuffle(ROLE_IDS.filter((r) => ROLES[r].category === 'sentinel'), rng).slice(0, base.sentinel),
        assistant: shuffle(ROLE_IDS.filter((r) => ROLES[r].category === 'assistant'), rng).slice(0, base.assistant),
        minion: shuffle(ROLE_IDS.filter((r) => ROLES[r].category === 'minion' && r !== 'hoarder'), rng).slice(0, base.minion),
        leader: [ROLES[script.id === 'thunderfall' ? 'thunder' : 'panicseed'] ? (script.id === 'thunderfall' ? 'thunder' : 'panicseed') : 'panicseed'],
      };

  const actualNames = options.names?.length === count ? options.names.slice() : DEFAULT_NAMES.slice(0, count);
  const secret = { misreport: null, internSeat: null, internMask: null, hoarderSwap: null, pusherGuess: null, pusherQualified: false };
  const rolePool = [...pick.sentinel, ...pick.assistant, ...pick.minion, ...pick.leader];

  // 囤积者替换：哨兵 → 未使用的协助者（非实习生/宣讲/后勤）
  if (options.useHoarder && rolePool.includes('hoarder') && pick.sentinel.length) {
    const swappable = pick.sentinel.filter((r) => r !== 'preacher' && r !== 'logistics');
    const candidates = ['newcomer','ambassador','vagrant'].filter((r) => !rolePool.includes(r));
    if (swappable.length && candidates.length) {
      const old = draw(swappable, rng);
      const neu = draw(candidates, rng);
      pick.sentinel[pick.sentinel.indexOf(old)] = neu;
      secret.hoarderSwap = { removed: old, added: neu };
      rolePool[rolePool.indexOf(old)] = neu;
    }
  }

  const dealtRoles = shuffle(rolePool, rng);
  const players = dealtRoles.map((role, i) => ({
    id: `s${i}`, seat: i + 1,
    name: actualNames[i] || `${i + 1}号`,
    role, displayRole: role,
    team: teamOf({ players: [{ role }] }, { role }),
    left: false, leftReason: null, leftDay: null,
    trusted: true, poisoned: false, marked: false, markedUntil: null, reinforced: false,
    uses: {}, acts: [], claims: {},
  }));

  // 实习生假面：不把实习生牌给本人
  const internSeat = players.find((p) => p.role === 'intern');
  const unusedMasks = ['stationchief','empath'].filter((r) => !rolePool.includes(r));
  if (internSeat) {
    const mask = unusedMasks.length ? draw(unusedMasks, rng) : 'empath';
    secret.internSeat = internSeat.id;
    secret.internMask = mask;
    internSeat.displayRole = mask;
  }

  // 站长固定误报对象：另一名真实社区玩家
  const station = players.find((p) => p.role === 'stationchief');
  if (station) {
    const community = players.filter((p) => p.id !== station.id && teamOf({ players }, p) === 'community');
    if (community.length) secret.misreport = draw(community, rng).id;
  }

  // 天气牌堆
  let weatherDeck = [];
  if (script.weatherOrder?.length) weatherDeck.push(...script.weatherOrder);
  const rest = script.weatherPool ? script.weatherPool.filter((w) => !weatherDeck.includes(w)) : WEATHER_IDS.filter((w) => !weatherDeck.includes(w));
  weatherDeck.push(...shuffle(rest, rng));

  const leaderSeat = players.find((p) => isLeaderRole(p.role));
  const s = {
    version: 3,
    phase: 'firstNight', step: 0,
    day: 0, nightCount: 0,
    playerCount: count, scriptId: script.id, seed: options.seed ?? 1,
    players, secret,
    leader: leaderSeat?.id || null,
    leaderType: leaderSeat?.role || 'panicseed',
    leaderSelfBombUsed: false,
    brokerQualified: false, pusherQualified: false,
    resilience: RESILIENCE_START,
    weather: { deck: weatherDeck, current: null, discard: [], nextDayNoNominate: false },
    night: {
      repairUsed: false, disrupted: null, reinforcedTarget: null, guarded: [], guardedPrev: [],
      pusherSeen: null, executions: null, executedToday: null, markedTarget: null, markedPrev: null,
      psychologistGot: null, reviewerChecked: null, intelSubmitted: false,
      leaderAction: null, preempts: {},
    },
    dayState: {
      nominations: [], nomineeAsked: {}, evacuate: null, supportAsked: null, supportGranted: false,
      preachReady: null, preachFired: false, votes: {}, voteRound: 1, result: null,
      postponed: [], // 阵雨延迟交付
      noNominate: false,
    },
    winner: null, winReason: '',
    log: [],
  };
  note(s, 'setup', `开局 ${count} 人，剧本「${script.name}」，韧性 ${RESILIENCE_START}。`);
  return s;
}

/* -------------------------------------------------------------------------- */
/* 查询工具                                                                    */
/* -------------------------------------------------------------------------- */
export function currentWeather(s) { return s.weather.current ? WEATHER[s.weather.current] : null; }
export function isExtreme(s) { return currentWeather(s)?.type === 'extreme'; }
export function leaderSeat(s) { return s.leader ? P(s, s.leader) : null; }
export function alertLevel(s) { return aliveCount(s); }

function effectiveRole(s, p) {
  // 实习生按假面时机模拟；心理师继承的能力在 acts 里体现，身份不变。
  if (p.role === 'intern') return s.secret.internMask || 'empath';
  return p.role;
}
function isPoisoned(s, p) {
  if (p.left) return false;
  return p.poisoned === true || p.marked === true;
}
function isCommunity(s, p) { return teamOf(s, p) === 'community'; }
function isEvil(s, p) { return teamOf(s, p) === 'evil'; }
/** 阵营查验呈现：新居民按灾谣呈现（能力有效时）。 */
function presentedAsEvil(s, p) {
  if (isEvil(s, p)) return true;
  if (p.role === 'newcomer' && !isPoisoned(s, p) && !p.left) return true;
  return false;
}
function weatherCancels(s, key) {
  const w = currentWeather(s);
  if (!w) return false;
  if (s.night.repairUsed && key !== 'puppeteer' && key !== 'leader') return false;
  const cancels = {
    heatwave: ['empath','stationchief','recorder','puppeteer'],
    typhoon: null, // 特殊：取消双方主动动作，下面单独处理
    coldwave: ['observer','empath','stationchief','recorder','inspector','reviewer','puppeteer'],
    rainstorm: ['disruptor'],
  };
  if (w.id === 'typhoon') return !['preacher','repairer'].includes(key);
  if (cancels[w.id]?.includes(key)) return true;
  return false;
}
function weatherDelays(s, key) {
  return currentWeather(s)?.id === 'shower' && ['empath','stationchief'].includes(key) && !s.night.repairUsed;
}

/* -------------------------------------------------------------------------- */
/* 胜负                                                                        */
/* -------------------------------------------------------------------------- */
export function checkVictory(s) { return s.winner; }
function evaluateVictory(s) {
  if (s.winner) return s;
  const leaderAlive = s.leader && P(s, s.leader) && !P(s, s.leader).left;
  const communityAlive = alive(s).filter((p) => isCommunity(s, p)).length;
  const evilAlive = alive(s).filter((p) => isEvil(s, p)).length;

  // 首领离队先检查接任（接任在 resolveLeaderExit 里处理）；此处只判结果
  if (!leaderAlive) {
    s.winner = 'community'; s.winReason = '现任首领已离队且无合法继任者。';
    note(s, 'win', s.winReason); return s;
  }
  if (evilAlive >= communityAlive) {
    s.winner = 'evil'; s.winReason = `未离队灾谣 ${evilAlive} 人不少于社区 ${communityAlive} 人。`;
    note(s, 'win', s.winReason); return s;
  }
  return s;
}

/* -------------------------------------------------------------------------- */
/* 首领接任                                                                    */
/* -------------------------------------------------------------------------- */
function resolveLeaderExit(s, reason) {
  const aliveBefore = s.leaderExitAliveBefore ?? aliveCount(s);
  if (aliveBefore < 5) {
    s.winner = 'community'; s.winReason = '首领离队时未离队人数不足 5，无人可接任。';
    note(s, 'win', s.winReason); return s;
  }
  const broker = s.players.find((p) => p.role === 'broker' && !p.left && !isPoisoned(s, p));
  if (broker && !s.brokerQualified) {
    s.brokerQualified = true;
    s.leader = broker.id; s.leaderType = s.leaderType || 'panicseed';
    broker.role = s.leaderType; broker.displayRole = s.leaderType;
    note(s, 'leader', `${broker.name} 接任为新首领（掮客）。`);
    evaluateVictory(s); return s;
  }
  const pusher = s.players.find((p) => p.role === 'puppeteer' && !p.left && s.pusherQualified && !isPoisoned(s, p));
  if (pusher) {
    s.leader = pusher.id;
    pusher.role = s.leaderType; pusher.displayRole = s.leaderType;
    note(s, 'leader', `${pusher.name} 凭情报递交接任为新首领。`);
    evaluateVictory(s); return s;
  }
  s.winner = 'community'; s.winReason = `首领${reason}，无合法继任者。`;
  note(s, 'win', s.winReason); return s;
}

/* -------------------------------------------------------------------------- */
/* 白天                                                                        */
/* -------------------------------------------------------------------------- */
export function flipWeather(s) {
  if (s.phase !== 'day') return s;
  if (!s.weather.deck.length) s.weather.deck = shuffle(WEATHER_IDS, makeRng(s.seed + s.day * 7));
  const w = s.weather.deck.shift();
  s.weather.current = w;
  s.weather.discard.push(w);
  s.dayState.noNominate = w === 'coldwave' && s.weather.nextDayNoNominate;
  s.weather.nextDayNoNominate = w === 'coldwave';
  note(s, 'weather', `第 ${s.day} 天天气：${WEATHER[w].name}${WEATHER[w].type === 'extreme' ? '（极端日）' : ''}。`);
  return s;
}

export function declareEvacuate(s, targetId) {
  if (s.phase !== 'day') return s;
  const t = targetId ? P(s, targetId) : null;
  if (targetId && (!t || t.left)) return s;
  s.dayState.evacuate = t ? t.id : null;
  note(s, 'evacuate', t ? `${t.name} 被登记为今日疏散保护对象（当日不得被提名）。` : '疏散宣称已撤销。');
  return s;
}
export function nominate(s, fromId, toId) {
  if (s.phase !== 'day' || s.dayState.noNominate) return s;
  const from = P(s, fromId);
  const to = P(s, toId);
  // 规则：不能提名自己，也不能提名已离队者。
  if (!from || !to || from.left || to.left || from.id === to.id) return s;
  if (s.dayState.evacuate === toId) return s;
  if (s.dayState.nominations.some((n) => n.from === fromId)) return s;
  s.dayState.nominations.push({ from: fromId, to: toId, round: s.dayState.voteRound });
  note(s, 'nominate', `${from.name} 提名 ${to.name}。`);
  return s;
}

/**
 * 流浪汉结对：每日讨论开始时公开指定一名其他未离队玩家，本人或对象中毒时限制暂停。
 * 存进 player.claims.partner，由 countVotes 在执行计票时校验。
 */
export function setPartner(s, actorId, targetId) {
  if (s.phase !== 'day') return s;
  const a = P(s, actorId);
  if (!a || a.left || a.role !== 'vagrant' || isPoisoned(s, a)) return s;
  const t = targetId ? P(s, targetId) : null;
  if (targetId && (!t || t.left || t.id === a.id)) return s;
  a.claims = a.claims || {};
  a.claims.partner = t ? t.id : null;
  note(s, 'partner', t ? `${a.name} 与 ${t.name} 结对（仅今日）。` : `${a.name} 今日不结对。`);
  return s;
}
export function claimPreach(s) {
  if (s.phase !== 'day' || s.dayState.voteRound !== 1) return s;
  const who = s.players.find((p) => p.role === 'preacher' && !p.left && !isPoisoned(s, p) && s.night.preachReady === p.id);
  if (!who || s.dayState.preachFired) return s;
  s.dayState.preachFired = true;
  s.dayState.preacherId = who.id;
  note(s, 'preach', `${who.name} 正式发动防灾宣讲。`);
  return s;
}
export function claimSupport(s) {
  if (s.phase !== 'day' || s.dayState.voteRound !== 1) return s;
  const who = s.players.find((p) => p.role === 'logistics' && !p.left && !isPoisoned(s, p));
  if (!who) return s;
  s.dayState.supportAsked = who.id;
  if (isExtreme(s) && !who.uses.support) {
    who.uses.support = 1; s.dayState.supportGranted = true;
    note(s, 'support', `${who.name} 申请物资支援成功。`);
  } else if (!isExtreme(s)) {
    note(s, 'support', `${who.name} 申请物资支援：今日非极端日，不消耗次数。`);
  }
  return s;
}
/** 提交表决。votes 形如 { [voterId]: candidateId|'abstain' }。 */
export function setVotes(s, votes) {
  if (s.phase !== 'day') return s;
  s.dayState.votes = { ...(s.dayState.votes || {}), ...votes };
  return s;
}
function countVotes(s) {
  const tally = {};
  const votedFor = (voterId) => {
    const choice = s.dayState.votes[voterId];
    if (!choice || choice === 'abstain') return null;
    return s.dayState.nominations.some((n) => n.to === choice) ? choice : null;
  };
  for (const [voterId, choice] of Object.entries(s.dayState.votes)) {
    const voter = P(s, voterId);
    if (!voter || voter.left || choice === 'abstain') continue;
    // 流浪汉：本人与结对对象都未中毒时，只有结对对象投出有效票，本人的票才计入。
    if (voter.role === 'vagrant' && !isPoisoned(s, voter)) {
      const partner = voter.claims?.partner;
      if (!partner || !votedFor(partner)) continue;
    }
    if (!s.dayState.nominations.some((n) => n.to === choice)) continue;
    tally[choice] = (tally[choice] || 0) + 1;
  }
  return tally;
}
function threshold(s, round = 1) {
  const n = aliveCount(s);
  if (currentWeather(s)?.id === 'flood') return Math.max(2, ceil(n, 2) - 1);
  return ceil(n, 2);
}
export function resolveVote(s) {
  if (s.phase !== 'day') return s;
  const tally = countVotes(s);
  const need = threshold(s, s.dayState.voteRound);
  const entries = Object.entries(tally).sort((a, b) => b[1] - a[1]);
  const top = entries[0]?.[1] || 0;
  const tied = entries.filter(([, v]) => v === top).map(([id]) => id);
  let executed = null;
  if (top >= need && tied.length === 1) executed = tied[0];

  const result = { round: s.dayState.voteRound, tally, need, top, tied, executed,
    topVotes: entries.slice(0, 2).map(([id, v]) => ({ id, votes: v })) };
  s.dayState.result = result;
  note(s, 'vote', `第 ${s.dayState.voteRound} 轮表决：门槛 ${need}，${executed ? `${P(s, executed).name} 达到门槛` : '无人达到门槛'}。`);

  if (executed) {
    s.night.executedToday = executed;
    execute(s, executed, 'day');
  }
  return s;
}
/** 复表决：首轮无人处决且至少两名候选人得票时开放。 */
export function canRunoff(s) {
  const r = s.dayState.result;
  return Boolean(r && !r.executed && r.round === 1 && r.topVotes.length >= 2 && s.dayState.voteRound === 1);
}
export function startRunoff(s) {
  if (!canRunoff(s)) return s;
  s.dayState.voteRound = 2;
  s.dayState.votes = {};
  note(s, 'vote', '进入复表决：取票数前两位（截止位并列者保留）。');
  return s;
}

function execute(s, targetId, when) {
  const p = P(s, targetId);
  if (!p || p.left) {
    if (when === 'day') s.dayState.executedSomeone = true;
    return s;
  }
  const wasLeader = s.leader === p.id;
  const aliveBefore = aliveCount(s);
  p.left = true; p.leftReason = 'execution'; p.leftDay = s.day;
  if (when === 'day') s.dayState.executedSomeone = true;
  note(s, 'death', `${p.name} 离队（${when === 'day' ? '白天处决' : '夜间离队'}）。`);
  if (p.role === 'ambassador' && !p.uses.ambassador && when === 'day' && !isPoisoned(s, p)) {
    p.uses.ambassador = 1; p.ambassadorLoss = 2;
    note(s, 'ambassador', '大使首次有效处决：韧性额外 −2（在白天结束结算）。');
  }
  if (wasLeader) {
    s.leaderExitAliveBefore = aliveBefore;
    resolveLeaderExit(s, '被处决');
  }
  evaluateVictory(s);
  return s;
}

/** 协调员手动让一名玩家离队（规则争议时纠错用），走与处决相同的接任与胜负判定。 */
export function eliminate(s, targetId, when = 'night') {
  return execute(s, targetId, when);
}

/* -------------------------------------------------------------------------- */
/* 白天结束结算（规则书 p.6 八步）                                              */
/* -------------------------------------------------------------------------- */
export function finishDay(s) {
  if (s.phase !== 'day' || s.winner) return s;
  // 1 处决已在 resolveVote 处理
  // 2 接任与人数胜负
  evaluateVictory(s); if (s.winner) return s;
  // 3 阵雨延迟交付
  for (const item of s.dayState.postponed) note(s, 'info', `阵雨延迟交付：${item.text}`);
  s.dayState.postponed = [];
  // 4 宣讲
  let temp = s.resilience;
  const preacher = P(s, s.dayState.preacherId);
  if (s.dayState.preachFired && preacher) {
    const r = s.dayState.result;
    const needPreach = ceil(2 * aliveCount(s) / 3);
    if (r?.top >= needPreach) {
      temp = Math.min(RESILIENCE_MAX, temp + 1);
      note(s, 'preach', `宣讲达成 ${r.top}/${needPreach}：韧性 +1。`);
    }
  }
  // 5 天气扣减
  const ambassadorLoss = s.players.reduce((sum, p) => sum + (p.ambassadorLoss || 0), 0);
  temp -= ambassadorLoss;
  const extremeLoss = isExtreme(s) && !s.dayState.supportGranted ? 1 : 0;
  temp -= extremeLoss;
  if (extremeLoss) note(s, 'weather', `极端天气扣减韧性 −1${s.dayState.supportGranted ? '（已被支援抵消）' : ''}。`);
  if (ambassadorLoss) note(s, 'ambassador', `大使损失韧性 −${ambassadorLoss}。`);
  // 6 中间值不截断，最终 ≤0 判负
  const final = Math.max(0, Math.min(RESILIENCE_MAX, temp));
  s.resilience = final;
  if (temp <= 0) {
    s.winner = 'evil'; s.winReason = '社区韧性归零。';
    note(s, 'win', s.winReason); return s;
  }
  if (final === 4 && !s.intel4Announced) {
    s.intel4Announced = true;
    const leader = leaderSeat(s);
    const odd = leader && leader.seat % 2 === 1;
    s.intel4 = `首次升至 4：现任首领位于${odd ? '奇数' : '偶数'}号座位。`;
    note(s, 'intel', s.intel4);
  }
  // 7 到期标记
  for (const p of s.players) {
    if (p.marked && p.markedUntil === s.day && !p.left) {
      p.left = true; p.leftReason = 'mark'; p.leftDay = s.day;
      note(s, 'death', `${p.name} 因标记到期离队。`);
      if (s.leader === p.id) { s.leaderExitAliveBefore = aliveCount(s) + 1; resolveLeaderExit(s, '标记到期'); }
    }
  }
  evaluateVictory(s); if (s.winner) return s;
  // 8 清除持续至本日结束的中毒
  for (const p of s.players) p.poisoned = false;
  // 进入夜晚
  s.phase = 'night'; s.step = 0; s.night = freshNight(s);
  note(s, 'phase', `第 ${s.day} 夜开始。`);
  return s;
}

function freshNight(s) {
  return {
    repairUsed: false, disrupted: null, reinforcedTarget: null, guarded: [], guardedPrev: s.night.guarded || [],
    pusherSeen: null, executedToday: s.night.executedToday, markedTarget: null, markedPrev: s.night.markedPrev || [],
    psychologistGot: null, reviewerChecked: null, intelSubmitted: s.night.intelSubmitted || false,
    leaderAction: null, preempts: {},
  };
}

/* -------------------------------------------------------------------------- */
/* 首夜                                                                        */
/* -------------------------------------------------------------------------- */
/** 记录「当夜确认发动过需要唤醒的主动能力」，供复核员查验。 */
function markAct(p, day) {
  if (!p) return;
  p.acts = p.acts || [];
  if (!p.acts.includes(day)) p.acts.push(day);
}

/**
 * 首夜动作。规则书首夜清单里的四类能力在此落地，页面据此给协调员操作入口；
 * 没有对应角色时页面保留口令但不显示按钮，避免通过省略暴露名单。
 */
export function firstNightAction(s, action) {
  if (s.phase !== 'firstNight' || s.winner) return s;
  const type = String(action.type || '');
  const t = action.targetId ? P(s, action.targetId) : null;

  if (type === 'hoarder') {
    const swap = s.secret.hoarderSwap;
    if (swap) note(s, 'info', `囤积者：秘密展示被换走的 ${ROLES[swap.removed].name}，换入 ${ROLES[swap.added].name}。`);
    else note(s, 'info', '囤积者：本局无囤积者替换。');
    return s;
  }
  if (type === 'disruptor') {
    const who = s.players.find((p) => p.role === 'disruptor' && !p.left && !isPoisoned(s, p));
    if (!who || !t || t.left) return s;
    t.poisoned = true; s.night.disrupted = t.id;
    markAct(who, 0);
    note(s, 'poison', `${who.name} 首夜误导了 ${t.name}（持续至次日白天结束）。`);
    return s;
  }
  if (type === 'puppeteerFirst') {
    const who = s.players.find((p) => p.role === 'puppeteer' && !p.left && !isPoisoned(s, p));
    const a = P(s, action.targetId);
    const b = P(s, action.targetId2);
    if (!who || !a || !b || a.left || b.left || a.id === b.id) return s;
    markAct(who, 0);
    note(s, 'info', `推手首夜查验：${a.name} 是 ${ROLES[a.role].name}，${b.name} 是 ${ROLES[b.role].name}。`);
    return s;
  }
  if (type === 'evaluator') {
    const who = s.players.find((p) => p.role === 'evaluator' && !p.left && !isPoisoned(s, p));
    if (!who || !t || t.left || t.id === who.id) return s;
    // 首领不属于「灾谣者」类别；有效新居民按灾谣阵营呈现。
    const category = ROLES[t.role]?.category;
    const yes = category === 'minion' || (t.role === 'newcomer' && !isPoisoned(s, t));
    markAct(who, 0);
    note(s, 'info', `评估员首夜查验 ${t.name}：${yes ? '是灾谣者' : '不是灾谣者'}。`);
    return s;
  }
  return s;
}

/** 结束首夜，进入第一日。保留独立入口，避免页面直接改 phase 漏掉日状态初始化。 */
export function endFirstNight(s) {
  if (s.phase !== 'firstNight' || s.winner) return s;
  s.phase = 'day'; s.day = 1; s.step = 0;
  s.dayState = {
    nominations: [], nomineeAsked: {}, evacuate: null, supportAsked: null, supportGranted: false,
    preachReady: null, preachFired: false, votes: {}, voteRound: 1, result: null,
    postponed: [], noNominate: false,
  };
  note(s, 'phase', '首夜结束，进入第一日：请翻天气。');
  return s;
}

/* -------------------------------------------------------------------------- */
/* 夜晚动作                                                                    */
/* -------------------------------------------------------------------------- */
/** 通用夜间动作入口。action: { type, actorId, targetId, targetId2, choice } */
export function nightAction(s, action) {
  if (s.winner) return s;
  if (s.phase === 'firstNight') return firstNightAction(s, action);
  if (s.phase !== 'night') return s;
  const type = String(action.type || '');
  const actor = action.actorId ? P(s, action.actorId) : null;
  const step = NIGHT_ORDER[s.step];
  const key = step?.key;
  const w = currentWeather(s);
  const typhoonFullStop = w?.id === 'typhoon' && !s.night.repairUsed;

  if (type === 'ack') {
    const skipped = NIGHT_ORDER[s.step];
    if (skipped) note(s, 'skip', `跳过「${skipped.label}」窗口。`);
    s.step = Math.min(NIGHT_ORDER.length - 1, s.step + 1);
    return s;
  }

  switch (key) {
    case 'repairer': {
      if (actor?.role === 'repairer' && !actor.uses.repair && !typhoonFullStop) {
        actor.uses.repair = 1; s.night.repairUsed = true;
        markAct(actor, s.day);
        note(s, 'repair', `${actor.name} 发动紧急抢修。`);
      }
      break;
    }
    case 'disruptor': {
      if (weatherCancels(s, 'disruptor')) break;
      if (actor && isEvil(s, actor) && ROLES[actor.role]?.category === 'minion') {
        const t = P(s, action.targetId);
        if (t && !t.left) {
          t.poisoned = true; s.night.disrupted = t.id;
          markAct(actor, s.day);
          note(s, 'poison', `${actor.name} 误导了 ${t.name}。`);
        }
      }
      break;
    }
    case 'reinforce': {
      if (typhoonFullStop || weatherCancels(s, 'reinforce')) break;
      if (actor?.role === 'reinforce') {
        const t = P(s, action.targetId);
        if (t && !t.left && s.night.reinforcedTarget !== t.id && s.night.guardedPrev.indexOf(t.id) < 0) {
          s.night.reinforcedTarget = t.id;
          if (s.night.disrupted === t.id) { t.poisoned = false; s.night.disrupted = null; }
          markAct(actor, s.day);
          note(s, 'reinforce', `${actor.name} 加固了 ${t.name}。`);
        }
      }
      break;
    }
    case 'guardian': {
      if (typhoonFullStop || weatherCancels(s, 'guardian')) break;
      if (actor?.role === 'guardian') {
        const max = (w?.id === 'thunderstorm' || w?.id === 'heatwave') ? 2 : 1;
        const ids = [action.targetId, action.targetId2].filter(Boolean).slice(0, max);
        const valid = ids.filter((id) => { const t = P(s, id); return t && !t.left && t.id !== actor.id && s.night.guardedPrev.indexOf(id) < 0; });
        s.night.guarded = valid;
        if (valid.length) markAct(actor, s.day);
        note(s, 'guard', `${actor.name} 守护 ${valid.map((id) => P(s, id).name).join('、') || '（无）'}。`);
      }
      break;
    }
    case 'puppeteer': {
      if (weatherCancels(s, 'puppeteer')) break;
      if (actor?.role === 'puppeteer') {
        const t = P(s, action.targetId);
        if (t && !t.left && t.id !== actor.id) {
          s.night.pusherSeen = { who: actor.id, target: t.id, role: t.role };
          markAct(actor, s.day);
          note(s, 'info', `推手查验 ${t.name}：真实角色 ${ROLES[t.role].name}。`);
        }
      }
      break;
    }
    case 'leader': {
      if (typhoonFullStop || weatherCancels(s, 'leader')) break;
      const leader = leaderSeat(s);
      if (!leader || leader.id !== actor?.id) break;
      if (isPoisoned(s, leader)) break;
      const choice = action.choice || 'convert';
      if (choice === 'bomb' && leader.role === 'panicseed' && !s.leaderSelfBombUsed) {
        s.leaderSelfBombUsed = true;
        s.night.leaderAction = { kind: 'bomb', by: leader.id };
        markAct(leader, s.day);
        note(s, 'leader', `${leader.name} 发动自爆。`);
        s.leaderExitAliveBefore = aliveCount(s);
        leader.left = true; leader.leftReason = 'bomb'; leader.leftDay = s.day;
        note(s, 'death', `${leader.name} 因自爆离队。`);
        resolveLeaderExit(s, '自爆');
      } else if (choice === 'mark' && leader.role === 'thunder') {
        const t = P(s, action.targetId);
        if (t && !t.left && t.id !== leader.id && s.night.markedPrev.indexOf(t.id) < 0 && !s.night.guarded.includes(t.id)) {
          t.marked = true; t.markedUntil = s.day + 1; s.night.markedTarget = t.id;
          markAct(leader, s.day);
          note(s, 'mark', `${leader.name} 标记了 ${t.name}（次日白天结束离队）。`);
        }
      } else {
        const t = P(s, action.targetId);
        if (t && !t.left && t.id !== leader.id) {
          // 无论是否被守护，都记录首领当夜尝试的目标：黎明据此判定守护奖励。
          const blocked = s.night.guarded.includes(t.id);
          s.night.leaderAction = { kind: 'convert', by: leader.id, target: t.id, blocked };
          markAct(leader, s.day);
          if (blocked) {
            note(s, 'guard', `首领蛊惑 ${t.name} 被应急包挡下。`);
          } else {
            t.left = true; t.leftReason = 'convert'; t.leftDay = s.day;
            note(s, 'death', `${t.name} 被蛊惑，当夜离队。`);
            if (t.role === 'psychologist') note(s, 'hook', '心理师当夜被蛊惑——按规则可触发一次查看。');
            if (s.leader === t.id) { s.leaderExitAliveBefore = aliveCount(s) + 1; resolveLeaderExit(s, '自蛊惑'); }
          }
        }
      }
      evaluateVictory(s);
      break;
    }
    case 'preacher': {
      // 整局最多 3 次预告；预告即消耗，即使次日无人处决或票数不足也不退还。
      if (actor?.role === 'preacher' && !actor.left && !isPoisoned(s, actor) && (actor.uses.preach || 0) < 3) {
        s.night.preachReady = actor.id;
        actor.uses.preach = (actor.uses.preach || 0) + 1;
        s.night.preempts[actor.id] = true;
        note(s, 'preach', `${actor.name} 预告了明日防灾宣讲（第 ${actor.uses.preach}/3 次）。`);
      }
      break;
    }
    case 'observer': {
      if (weatherCancels(s, 'observer')) break;
      if (actor?.role === 'observer' && (actor.uses.observer || 0) < 2) {
        actor.uses.observer = (actor.uses.observer || 0) + 1;
        const upcoming = s.weather.deck.slice(0, 2);
        if (action.swap && upcoming.length === 2) [s.weather.deck[0], s.weather.deck[1]] = [s.weather.deck[1], s.weather.deck[0]];
        markAct(actor, s.day);
        note(s, 'info', `观测员查看未来天气：${s.weather.deck.slice(0, 2).map((w) => WEATHER[w].name).join('、')}。`);
      }
      break;
    }
    case 'empath': {
      if (weatherCancels(s, 'empath')) break;
      const who = s.players.find((p) => p.role === 'empath' && !p.left && !isPoisoned(s, p));
      if (who) {
        const left = s.players[(who.seat - 2 + s.playerCount) % s.playerCount];
        const right = s.players[who.seat % s.playerCount];
        const n = [left, right].filter((p) => !p.left && presentedAsEvil(s, p)).length;
        const text = `共情者得知左右邻座灾谣人数：${n}。`;
        markAct(who, s.day);
        if (weatherDelays(s, 'empath')) s.dayState.postponed.push({ text });
        else note(s, 'info', text);
      }
      break;
    }
    case 'stationchief': {
      if (weatherCancels(s, 'stationchief')) break;
      const who = s.players.find((p) => p.role === 'stationchief' && !p.left && !isPoisoned(s, p) && (p.uses.stationchief || 0) < 2);
      if (who && action.targetId && action.targetId2) {
        who.uses.stationchief = (who.uses.stationchief || 0) + 1;
        const ids = [action.targetId, action.targetId2];
        const yes = ids.includes(s.leader) || ids.includes(s.secret.misreport);
        const text = `站长查验 ${ids.map((id) => P(s, id).name).join('、')}：${yes ? '是' : '否'}。`;
        markAct(who, s.day);
        if (weatherDelays(s, 'stationchief')) s.dayState.postponed.push({ text });
        else note(s, 'info', text);
      }
      break;
    }
    case 'inspector': {
      if (weatherCancels(s, 'inspector')) break;
      if (actor?.role === 'inspector' && (actor.uses.inspector || 0) < 3) {
        actor.uses.inspector = (actor.uses.inspector || 0) + 1;
        const t = P(s, action.targetId);
        markAct(actor, s.day);
        note(s, 'info', `排查员查验 ${t?.name || '?'}：${t?.poisoned ? '中毒' : '未中毒'}。`);
      }
      break;
    }
    case 'recorder': {
      if (weatherCancels(s, 'recorder')) break;
      if (actor?.role === 'recorder') {
        const which = action.choice || 'execution';
        if (which === 'execution' && !actor.uses.recordExec) {
          // 处决发生在「本日夜之间的那个白天」，leftDay 记的是同一个 s.day（dawn 才 +1）。
          const t = s.players.find((p) => p.leftReason === 'execution' && p.leftDay === s.day);
          if (t) { actor.uses.recordExec = 1; markAct(actor, s.day); note(s, 'info', `记录员查到处决者：${ROLES[t.role].name}。`); }
        } else if (which === 'other' && !actor.uses.recordOther) {
          const t = s.players.find((p) => p.left && p.leftReason !== 'execution');
          if (t) { actor.uses.recordOther = 1; markAct(actor, s.day); note(s, 'info', `记录员查到非处决离队者：${ROLES[t.role].name}。`); }
        }
      }
      break;
    }
    case 'psychologist': {
      if (actor?.role === 'psychologist' && !s.night.psychologistGot && !s.night.disrupted && !actor.marked) {
        const goneCommunity = s.players.filter((p) => p.left && isCommunity(s, p));
        if (goneCommunity.length >= 2) {
          for (const id of INHERIT_ORDER) {
            const src = goneCommunity.find((p) => p.role === id && !p.uses?.[id]);
            if (src) { s.night.psychologistGot = id; markAct(actor, s.day); note(s, 'info', `心理师获取能力：${ROLES[id].name}（下一夜起使用）。`); break; }
          }
        }
      }
      break;
    }
    case 'reviewer': {
      if (weatherCancels(s, 'reviewer')) break;
      if (actor?.role === 'reviewer' && (actor.uses.reviewer || 0) < 2) {
        actor.uses.reviewer = (actor.uses.reviewer || 0) + 1;
        const t = P(s, action.targetId);
        // 中毒模拟、阵雨延后交付、宣讲预告都算「确认发动」；只有放弃与天气取消记「无」。
        const did = Boolean(t?.acts?.includes(s.day) || s.night.preempts?.[t?.id]);
        markAct(actor, s.day);
        note(s, 'info', `复核员查验 ${t?.name || '?'}：${did ? '有' : '无'}。`);
      }
      break;
    }
    case 'intel': {
      if (actor?.role === 'puppeteer' && s.day === 1 && !s.night.intelSubmitted) {
        s.night.intelSubmitted = true;
        const ok = Array.isArray(action.guess) && action.guess.every((g) => P(s, g.id)?.role === g.role);
        markAct(actor, s.day);
        if (ok && !actor.poisoned) { s.pusherQualified = true; note(s, 'info', '推手情报递交全部正确，获得后备接任资格。'); }
        else note(s, 'info', '推手情报递交有误。');
      }
      break;
    }
    default: break;
  }
  if (action.type !== 'ack') s.step = Math.min(NIGHT_ORDER.length - 1, s.step + 1);
  return s;
}

/** 黎明：公开离队、处理守护奖励、进入白天。 */
export function dawn(s) {
  if (s.phase !== 'night') return s;
  s.day += 1; s.nightCount += 1;
  // 守护奖励：守护名单命中首领当夜蛊惑/标记目标 → 韧性 +1（每夜最多 1）
  // 注意：目标被守护时 leaderAction 仍会记录（blocked=true），此处必须据此判定。
  const la = s.night.leaderAction;
  const blocked = la?.target && s.night.guarded.includes(la.target);
  if (blocked) {
    s.resilience = Math.min(RESILIENCE_MAX, s.resilience + 1);
    note(s, 'guard', `预警成功，韧性 +1（当前 ${s.resilience}）。`);
  }
  const leftTonight = s.players.filter((p) => p.leftDay === s.day - 1 && ['convert','bomb'].includes(p.leftReason));
  note(s, 'dawn', leftTonight.length ? `昨夜 ${leftTonight.map((p) => p.name).join('、')} 离队。` : '昨夜无人离队。');
  s.phase = 'day'; s.step = 0;
  s.dayState = {
    nominations: [], nomineeAsked: {}, evacuate: null, supportAsked: null, supportGranted: false,
    preachReady: null, preachFired: s.night.preachReady ? false : true, votes: {}, voteRound: 1, result: null,
    postponed: [], noNominate: false,
  };
  // 寒潮次日禁提名
  s.dayState.noNominate = s.weather.nextDayNoNominate && s.weather.current === 'coldwave';
  note(s, 'phase', `第 ${s.day} 天开始，请翻天气。`);
  return s;
}

/* -------------------------------------------------------------------------- */
/* 投影                                                                        */
/* -------------------------------------------------------------------------- */
/** view='storyteller' 返回全量；view=seatId 隐藏他人真实身份与秘密记录。 */
export function project(s, view = 'storyteller') {
  if (view === 'storyteller' || !view) return clone(s);
  const self = P(s, view);
  const out = clone(s);
  delete out.secret;
  out.players = out.players.map((p) => {
    if (p.id === view) return p;
    return {
      ...p, role: null, team: null,
      displayRole: p.displayRole || '未知',
      left: p.left, leftReason: p.left ? 'left' : null,
    };
  });
  out.log = s.log.filter((l) => l.kind !== 'setup' && l.kind !== 'win' && l.kind !== 'info');
  out.leader = null; out.leaderType = null;
  out.winner = s.winner; out.winReason = s.winner ? s.winReason : '';
  out.isSelf = self?.id || null;
  return out;
}

/** 给前端的当前夜曲步骤说明（含谁该做什么）。 */
export function nightStepInfo(s) {
  const step = NIGHT_ORDER[s.step];
  if (!step) return null;
  const w = currentWeather(s);
  const cancelled = weatherCancels(s, step.key) && step.key !== 'repairer';
  return { index: s.step + 1, total: NIGHT_ORDER.length, key: step.key, label: step.label, who: step.who,
    weather: w?.name || null, cancelled, repairUsed: s.night.repairUsed };
}

export { NIGHT_ORDER, ROLES, WEATHER, CATEGORY, SCRIPTS, PLAYER_SETUP };
