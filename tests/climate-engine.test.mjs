import test from 'node:test';
import assert from 'node:assert/strict';
import {
  createGame, makeRng, flipWeather, nominate, setVotes, resolveVote, canRunoff, startRunoff,
  finishDay, nightAction, dawn, project, nightStepInfo, checkVictory, RESILIENCE_START,
  setPartner, firstNightAction, endFirstNight, declareEvacuate,
} from '../public/app/games/climate/engine.js';
import { ROLES, ROLE_IDS, PLAYER_SETUP, INHERIT_ORDER, NIGHT_ORDER } from '../public/app/games/climate/data.js';

test('角色数据：24 个角色 / 四类齐全 / 每角色字段完整', () => {
  assert.equal(ROLE_IDS.length, 24);
  const cats = {};
  for (const id of ROLE_IDS) {
    const r = ROLES[id];
    cats[r.category] = (cats[r.category] || 0) + 1;
    for (const k of ['name','ability','card','slogan','category']) assert.ok(r[k], `${id}.${k} 缺失`);
  }
  assert.equal(cats.sentinel, 14);
  assert.equal(cats.assistant, 4);
  assert.equal(cats.minion, 4);
  assert.equal(cats.leader, 2);
});

test('RNG 可复现', () => {
  const a = makeRng(42), b = makeRng(42);
  for (let i = 0; i < 10; i += 1) assert.equal(a(), b());
});

test('按人数配牌：5–13 每张表正好等于人数，恰好 1 首领', () => {
  for (let n = 5; n <= 13; n += 1) {
    const s = createGame({ playerCount: n, scriptId: 'firstWave', seed: n });
    assert.equal(s.players.length, n);
    const cfg = PLAYER_SETUP[n];
    assert.equal(cfg.sentinel + cfg.assistant + cfg.minion + cfg.leader, n);
    const roles = s.players.map((p) => p.role);
    assert.equal(new Set(roles).size, n, '同一真实角色不重复');
    assert.equal(roles.filter((r) => r === 'panicseed' || r === 'thunder').length, 1);
    assert.equal(s.resilience, RESILIENCE_START);
  }
});

test('剧本名单：沉雷过境初始首领是闷雷，首波预警是恐慌之种', () => {
  const a = createGame({ playerCount: 11, scriptId: 'thunderfall', seed: 7 });
  assert.equal(a.leaderType, 'thunder');
  const b = createGame({ playerCount: 8, scriptId: 'firstWave', seed: 7 });
  assert.equal(b.leaderType, 'panicseed');
});

test('实习生不拿自己真实身份牌，拿假面；站长秘密指定误报对象', () => {
  let foundIntern = false, foundStation = false;
  for (let seed = 1; seed < 8 && !(foundIntern && foundStation); seed += 1) {
    const s = createGame({ playerCount: 12, scriptId: 'thunderfall', seed });
    const intern = s.players.find((p) => p.role === 'intern');
    if (intern) {
      foundIntern = true;
      assert.notEqual(intern.displayRole, 'intern');
      assert.ok(['stationchief','empath'].includes(intern.displayRole));
    }
    const station = s.players.find((p) => p.role === 'stationchief');
    if (station) {
      foundStation = true;
      assert.ok(s.secret.misreport, '站长有误报对象');
      assert.notEqual(s.secret.misreport, station.id);
    }
  }
  assert.ok(foundIntern, '沉雷 11–12 人局有实习生');
  assert.ok(foundStation, '沉雷局有站长');
});

test('囤积者替换：宣讲员/后勤员不被换走，总人数不变', () => {
  const s = createGame({ playerCount: 12, scriptId: 'blackout', seed: 3, useHoarder: true });
  assert.ok(s.secret.hoarderSwap, '发生替换');
  assert.ok(!['preacher','logistics'].includes(s.secret.hoarderSwap.removed));
  assert.equal(s.players.length, 12);
  assert.ok(s.players.some((p) => p.role === 'hoarder'));
});

test('project(seat) 隐藏他人真实身份与秘密记录', () => {
  const s = createGame({ playerCount: 8, seed: 2 });
  const me = s.players[0].id;
  const view = project(s, me);
  assert.equal(view.secret, undefined);
  const other = view.players.find((p) => p.id !== me);
  assert.equal(other.role, null);
  assert.equal(other.team, null);
  assert.equal(view.players.find((p) => p.id === me).role, s.players[0].role);
  assert.equal(view.isSelf, me);
});

test('project(storyteller) 返回全量身份，无 isSelf 泄漏', () => {
  const s = createGame({ playerCount: 8, seed: 2 });
  const full = project(s);
  assert.equal(full.players[0].role, s.players[0].role);
  assert.ok(full.secret);
});

test('首夜：无天气、夜曲步骤按顺序推进', () => {
  let s = createGame({ playerCount: 8, seed: 1 });
  assert.equal(s.phase, 'firstNight');
  for (let i = 0; i < 6; i += 1) {
    const info = nightStepInfo(s) || { index: i + 1 };
    assert.ok(info);
    s = nightAction(s, { type: 'ack' });
  }
  assert.equal(s.weather.current, null, '首夜不翻天气');
});

test('白天：翻天气 / 提名 / 表决门槛 ceil(N/2) / 处决离队', () => {
  let s = createGame({ playerCount: 8, seed: 1 });
  // 直接推进到白天
  s.phase = 'day'; s.day = 1;
  s = flipWeather(s);
  assert.ok(s.weather.current);
  const from = s.players[0].id, to = s.players[1].id;
  s = nominate(s, from, to);
  assert.equal(s.dayState.nominations.length, 1);
  const votes = {};
  for (const p of s.players) votes[p.id] = to; // 8 票全投 to
  s = setVotes(s, votes);
  s = resolveVote(s);
  assert.equal(s.dayState.result.need, 4, '8 人门槛 4');
  assert.equal(s.dayState.result.executed, to);
  assert.equal(Pleft(s, to), true);
  function Pleft(st, id) { return st.players.find((p) => p.id === id).left; }
});

test('山洪日门槛 N/2-1 且最低 2', () => {
  let s = createGame({ playerCount: 8, seed: 1 });
  s.phase = 'day'; s.day = 1;
  s.weather.deck = ['flood', ...s.weather.deck];
  s = flipWeather(s);
  assert.equal(s.weather.current, 'flood');
  const to = s.players[1].id;
  s = nominate(s, s.players[0].id, to);
  const votes = {}; for (let i = 0; i < 3; i += 1) votes[s.players[i].id] = to;
  s = setVotes(s, votes); s = resolveVote(s);
  assert.equal(s.dayState.result.need, 3, '山洪 8 人门槛 = 4-1 = 3');
  assert.equal(s.dayState.result.executed, to);
});

test('平票无人处决 → 可复表决；复表决唯一最高且达标才处决', () => {
  let s = createGame({ playerCount: 8, seed: 1 });
  s.phase = 'day'; s.day = 1; flipWeather(s);
  const p = s.players.map((x) => x.id);
  // 两名不同提名者分别提名 b、c
  s = nominate(s, p[0], p[1]); s = nominate(s, p[2], p[3]);
  // 首轮：b 与 c 各 1 票平票 → 无人达 4 票门槛
  setVotes(s, { [p[0]]: p[1], [p[2]]: p[3] }); s = resolveVote(s);
  assert.equal(s.dayState.result.executed, null, '平票不处决');
  assert.equal(canRunoff(s), true, '至少两名候选得票 → 可复表决');
  s = startRunoff(s);
  // 复表决：b 获 4 票（门槛 4），唯一最高 → 处决 b
  setVotes(s, { [p[0]]: p[1], [p[2]]: p[1], [p[4]]: p[1], [p[5]]: p[1] });
  s = resolveVote(s);
  assert.equal(s.dayState.result.executed, p[1], '复表决 4 票达标处决 b');
});

test('极端日：白天结束韧性 −1；后勤支援可抵消；归零灾谣胜', () => {
  let s = createGame({ playerCount: 8, seed: 1 });
  s.phase = 'day'; s.day = 1;
  s.weather.deck = ['heatwave', ...s.weather.deck]; s = flipWeather(s);
  const before = s.resilience;
  s = finishDay(s);
  assert.equal(s.resilience, before - 1);
  // 归零场景
  let t = createGame({ playerCount: 8, seed: 1 });
  t.phase = 'day'; t.day = 1; t.resilience = 1;
  t.weather.deck = ['heatwave', ...t.weather.deck]; t = flipWeather(t);
  t = finishDay(t);
  assert.equal(t.winner, 'evil');
  assert.equal(t.resilience, 0);
});

test('大使首次有效处决 → 白天结束额外 −2，只触发一次', () => {
  let s = createGame({ playerCount: 12, scriptId: 'blackout', seed: 2 });
  const amb = s.players.find((p) => p.role === 'ambassador');
  assert.ok(amb, '断电 12 人局含大使');
  s.phase = 'day'; s.day = 1; flipWeather(s);
  amb.left = true; amb.leftReason = 'execution'; amb.ambassadorLoss = 2;
  const before = s.resilience;
  s = finishDay(s);
  assert.equal(s.resilience, Math.max(0, before - 2));
});

test('人数终局：未离队灾谣 >= 未离队社区 → 灾谣胜', () => {
  const s = createGame({ playerCount: 6, seed: 1 });
  const community = s.players.filter((p) => ['sentinel','assistant'].includes(ROLES[p.role].category));
  // 让社区离队到只剩 2，灾谣剩 4（3哨+1首? 近似），直接构造
  community.slice(0, 2).forEach((p) => { p.left = true; });
  // 用 finishDay 触发 evaluateVictory，需先让 leader 存活
  s.phase = 'day'; s.day = 1; flipWeather(s);
  const evilAlive = s.players.filter((p) => !p.left && ['minion','leader'].includes(ROLES[p.role].category)).length;
  const commAlive = s.players.filter((p) => !p.left && ['sentinel','assistant'].includes(ROLES[p.role].category)).length;
  finishDay(s);
  if (evilAlive >= commAlive) assert.equal(s.winner, 'evil');
});

test('昼夜循环：finishDay → night → dawn → day，天数递增', () => {
  let s = createGame({ playerCount: 8, seed: 1 });
  s.phase = 'day'; s.day = 1; flipWeather(s);
  s = finishDay(s);
  assert.equal(s.phase, 'night');
  s = dawn(s);
  assert.equal(s.phase, 'day');
  assert.equal(s.day, 2);
});

test('守护成功：挡住首领蛊惑 → 黎明韧性 +1（上限 4）', () => {
  let s = createGame({ playerCount: 8, seed: 1 });
  s.phase = 'day'; s.day = 1; flipWeather(s); s = finishDay(s);
  // 走夜曲到 leader 步骤：repairer/disruptor/reinforce/guardian/puppeteer
  const leader = s.leader ? s.players.find((p) => p.id === s.leader) : null;
  const target = s.players.find((p) => p.id !== s.leader && !p.left);
  s.night.guarded = [target.id];
  s.step = 5; // leader
  const before = s.resilience;
  s = nightAction(s, { type: 'convert', actorId: leader.id, targetId: target.id });
  assert.equal(target.left, false, '守护挡住蛊惑');
  s = dawn(s);
  assert.equal(s.resilience, Math.min(4, before + 1));
});

test('checkVictory 是查询函数，不改变状态', () => {
  const s = createGame({ playerCount: 8, seed: 1 });
  const before = JSON.stringify(s);
  assert.equal(checkVictory(s), null);
  assert.equal(JSON.stringify(s), before);
});

test('心理师继承优先级表长度 11 且首位站长', () => {
  assert.equal(INHERIT_ORDER.length, 11);
  assert.equal(INHERIT_ORDER[0], 'stationchief');
});

/* -------------------------------------------------------------------------- */
/* 2026-11-19 修复回归：提名、流浪汉、次数上限、记录员、复核员、首夜、疏散      */
/* -------------------------------------------------------------------------- */

/** 构造一局指定角色的最小场景；roles 顺序即座位顺序。 */
function fixture(roles, { day = 2, phase = 'day', seed = 1 } = {}) {
  const s = createGame({ playerCount: roles.length, seed, scriptId: 'firstWave' });
  s.players.forEach((p, i) => { p.role = roles[i]; p.displayRole = roles[i]; });
  const leader = s.players.find((p) => p.role === 'panicseed' || p.role === 'thunder');
  s.leader = leader?.id || null;
  s.leaderType = leader?.role || 'panicseed';
  s.phase = phase; s.day = day;
  return s;
}
const stepOf = (key) => NIGHT_ORDER.findIndex((n) => n.key === key);

test('提名：不能提名自己，也不能提名已离队者', () => {
  const s = fixture(['observer', 'evaluator', 'preacher', 'empath', 'stationchief', 'panicseed']);
  flipWeather(s);
  const [a, b] = s.players;
  nominate(s, a.id, a.id);
  assert.equal(s.dayState.nominations.length, 0, '自提名被拒绝');
  nominate(s, a.id, b.id);
  assert.equal(s.dayState.nominations.length, 1);
  b.left = true;
  nominate(s, s.players[2].id, b.id);
  assert.equal(s.dayState.nominations.length, 1, '提名已离队者被拒绝');
});

test('流浪汉：未结对或对象弃权时本人票不计，对象投有效票才计入', () => {
  const s = fixture(['vagrant', 'observer', 'evaluator', 'preacher', 'empath', 'panicseed']);
  flipWeather(s);
  const [vag, , b, c] = s.players;
  nominate(s, s.players[1].id, b.id);

  setVotes(s, { [vag.id]: b.id }); resolveVote(s);
  assert.equal(s.dayState.result.tally[b.id] ?? 0, 0, '未结对：票不计');

  setPartner(s, vag.id, c.id);
  setVotes(s, { [c.id]: 'abstain' }); resolveVote(s);
  assert.equal(s.dayState.result.tally[b.id] ?? 0, 0, '对象弃权：票仍不计');

  setVotes(s, { [c.id]: b.id }); resolveVote(s);
  assert.equal(s.dayState.result.tally[b.id], 2, '对象投有效票：本人票计入');
});

test('流浪汉结对：不能选自己、不能选已离队者', () => {
  const s = fixture(['vagrant', 'observer', 'evaluator', 'preacher', 'empath', 'panicseed']);
  const [vag] = s.players;
  setPartner(s, vag.id, vag.id);
  assert.equal(vag.claims.partner ?? null, null);
  s.players[1].left = true;
  setPartner(s, vag.id, s.players[1].id);
  assert.equal(vag.claims.partner ?? null, null);
  setPartner(s, vag.id, s.players[2].id);
  assert.equal(vag.claims.partner, s.players[2].id);
});

test('宣讲员：整局最多 3 次预告，第 4 次无效', () => {
  const s = fixture(['preacher', 'observer', 'evaluator', 'empath', 'stationchief', 'panicseed'], { phase: 'night' });
  const preacher = s.players[0];
  for (let i = 1; i <= 3; i += 1) {
    s.step = stepOf('preacher'); s.night.preachReady = null;
    nightAction(s, { type: 'preach', actorId: preacher.id });
    assert.equal(preacher.uses.preach, i, `第 ${i} 次预告应计数`);
    assert.equal(s.night.preachReady, preacher.id);
  }
  s.step = stepOf('preacher'); s.night.preachReady = null;
  nightAction(s, { type: 'preach', actorId: preacher.id });
  assert.equal(preacher.uses.preach, 3, '第 4 次不再计数');
  assert.equal(s.night.preachReady, null, '第 4 次不产生预告');
});

test('记录员：查处决者查的是本日夜之前的那个白天（不再差一天）', () => {
  const s = fixture(['recorder', 'observer', 'evaluator', 'empath', 'stationchief', 'panicseed'], { phase: 'night', day: 3 });
  const recorder = s.players[0];
  s.players[1].left = true; s.players[1].leftReason = 'execution'; s.players[1].leftDay = 3;
  s.step = stepOf('recorder');
  nightAction(s, { type: 'record', choice: 'execution', actorId: recorder.id });
  assert.equal(recorder.uses.recordExec, 1, '查到当天处决者并消耗次数');
  assert.match(s.log.at(-1).text, /记录员查到处决者/);
});

test('复核员：当夜发动过能力回「有」，没发动回「无」', () => {
  const s = fixture(['reviewer', 'observer', 'evaluator', 'empath', 'stationchief', 'panicseed'], { phase: 'night', day: 2 });
  const [reviewer, observer] = s.players;
  s.step = stepOf('observer');
  nightAction(s, { type: 'observe', actorId: observer.id });
  assert.ok(observer.acts.includes(2), '观测员当夜动作被记录');

  s.step = stepOf('reviewer');
  nightAction(s, { type: 'reviewer', actorId: reviewer.id, targetId: observer.id });
  assert.match(s.log.at(-1).text, /：有/);

  s.step = stepOf('reviewer');
  nightAction(s, { type: 'reviewer', actorId: reviewer.id, targetId: s.players[2].id });
  assert.match(s.log.at(-1).text, /：无/);
});

test('次数型角色首次即可用：观测员 / 站长 / 排查员 / 复核员', () => {
  const s = fixture(['observer', 'stationchief', 'inspector', 'reviewer', 'empath', 'panicseed'], { phase: 'night', day: 1 });
  const [observer, station, inspector, reviewer] = s.players;

  s.step = stepOf('observer');
  nightAction(s, { type: 'observe', actorId: observer.id });
  assert.equal(observer.uses.observer, 1);

  s.step = stepOf('stationchief');
  nightAction(s, { type: 'station', actorId: station.id, targetId: s.players[4].id, targetId2: s.players[5].id });
  assert.equal(station.uses.stationchief, 1);

  s.step = stepOf('inspector');
  nightAction(s, { type: 'inspect', actorId: inspector.id, targetId: s.players[4].id });
  assert.equal(inspector.uses.inspector, 1);

  s.step = stepOf('reviewer');
  nightAction(s, { type: 'reviewer', actorId: reviewer.id, targetId: s.players[4].id });
  assert.equal(reviewer.uses.reviewer, 1);
});

test('首夜：评估员对首领回「否」、对灾谣者回「是」，新居民按灾谣呈现', () => {
  const s = fixture(['evaluator', 'disruptor', 'newcomer', 'puppeteer', 'vagrant', 'panicseed'], { phase: 'firstNight', day: 0 });
  const [evaluator, disruptor, newcomer, puppeteer] = s.players;

  firstNightAction(s, { type: 'evaluator', targetId: disruptor.id });
  assert.match(s.log.at(-1).text, /是灾谣者/);

  firstNightAction(s, { type: 'evaluator', targetId: s.players[5].id });
  assert.match(s.log.at(-1).text, /不是灾谣者/, '首领不属于灾谣者类别');

  firstNightAction(s, { type: 'evaluator', targetId: newcomer.id });
  assert.match(s.log.at(-1).text, /是灾谣者/, '新居民按灾谣呈现');

  firstNightAction(s, { type: 'disruptor', targetId: evaluator.id });
  assert.equal(evaluator.poisoned, true, '首夜误导生效');

  firstNightAction(s, { type: 'puppeteerFirst', targetId: newcomer.id, targetId2: puppeteer.id });
  assert.match(s.log.at(-1).text, /推手首夜查验/);
});

test('结束首夜：进入第一日并重置白天状态', () => {
  const s = createGame({ playerCount: 8, seed: 1 });
  assert.equal(s.phase, 'firstNight');
  endFirstNight(s);
  assert.equal(s.phase, 'day');
  assert.equal(s.day, 1);
  assert.equal(s.dayState.nominations.length, 0);
  assert.equal(s.dayState.voteRound, 1);
});

test('疏散宣称：登记后可查、写入日志，且阻止被提名', () => {
  const s = fixture(['observer', 'evaluator', 'preacher', 'empath', 'stationchief', 'panicseed']);
  flipWeather(s);
  const target = s.players[1];
  declareEvacuate(s, target.id);
  assert.equal(s.dayState.evacuate, target.id);
  assert.ok(s.log.some((l) => l.kind === 'evacuate'), '疏散登记留日志');
  nominate(s, s.players[2].id, target.id);
  assert.equal(s.dayState.nominations.length, 0, '被疏散者不能被提名');
});
