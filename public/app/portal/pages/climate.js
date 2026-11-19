/* ==========================================================================
   气候哨兵 · 韧性社区 —— 协调员魔典（Storyteller Grimoire）
   借鉴 townsquare 的「魔典 / 镇民广场」双视图思想，但按平台原生 ESM 自建，
   不 fork 任何 GPL / 无许可上游。规则引擎在 games/climate/engine.js。
   本页面向协调员：开局配牌 → 座位魔典 → 昼夜流程 → 提名表决 → 韧性结算 → 终局复盘。
   ========================================================================== */
import { h } from '../../core/dom.js';
import {
  createGame, flipWeather, nominate, setVotes, resolveVote, canRunoff, startRunoff,
  finishDay, nightAction, dawn, project, nightStepInfo, declareEvacuate, claimPreach, claimSupport,
  setPartner, firstNightAction, endFirstNight, eliminate,
} from '../../games/climate/engine.js';
import {
  ROLES, ROLE_IDS, CATEGORY, WEATHER, WEATHER_IDS, SCRIPTS, PLAYER_SETUP,
  NIGHT_ORDER, ICON, PORTRAIT, WEATHER_ART, LOGO,
} from '../../games/climate/data.js';

/* 发布指纹由服务端注入 <html data-asset-version>：带上它，样式与素材才能命中
   `immutable` 强缓存；拿不到就退化为逐次校验，功能不受影响。 */
function assetVersion() {
  if (typeof document === 'undefined') return '';
  return document.documentElement.dataset.assetVersion || '';
}
function withVersion(url) {
  const v = assetVersion();
  return v ? `${url}${url.includes('?') ? '&' : '?'}v=${v}` : url;
}

function ensureStyles() {
  if (typeof document === 'undefined') return;
  if (document.querySelector('link[data-climate-style]')) return;
  const link = document.createElement('link');
  link.rel = 'stylesheet';
  link.href = withVersion('/styles/climate.css');
  link.dataset.climateStyle = '1';
  document.head.append(link);
}

/** 页面局部状态：全部存在闭包里，不污染全局。 */
let state = null;          // 引擎 state（协调员全知视角）
let view = 'setup';        // setup | grimoire | roles | weather | rules
let playerCount = 8;
let scriptId = 'firstWave';
let useHoarder = true;
let seed = 1;
let selectedSeat = null;
let toast = '';
let voteDraft = {};        // 表决草稿
let targetDraft = null;    // 夜曲目标草稿
let targetDraft2 = null;   // 站长/推手需要的第二个目标
let nomFrom = null;        // 提名者（白天提名区独立选择，不再复用座位选中）
let nomTo = null;          // 被提名者
let evacTarget = null;     // 疏散目标
let partnerTarget = null;  // 流浪汉结对对象
let fnPick = { disruptor: null, puppeteerA: null, puppeteerB: null, evaluator: null }; // 首夜各角色目标
let disposed = false;

const $ = () => state;

function setToast(msg) { toast = msg; render(); if (msg) setTimeout(() => { if (toast === msg) { toast = ''; render(); } }, 2600); }
function act(fn, msg) {
  if (!state || state.winner) return;
  const before = state.log.length;
  try {
    state = fn(state);
    // 引擎对非法操作是静默拒绝（角色离队/中毒、天气封锁窗口），据日志判断是否真的生效。
    if (state.log.length === before) { setToast('这一步没有生效：确认角色未离队、未中毒，且天气没有封锁本窗口。'); return; }
    if (msg) setToast(msg); else render();
  } catch (e) { setToast(`操作未完成：${e.message}`); }
}

/* -------------------------------------------------------------------------- */
/* 通用小组件                                                                  */
/* -------------------------------------------------------------------------- */
function chip(text, tone = '') { return h('span', { class: ['cl-chip', tone ? `cl-chip--${tone}` : null], text }); }
function categoryChip(roleId) {
  const r = ROLES[roleId]; if (!r) return null;
  const c = CATEGORY[r.category];
  return h('span', { class: 'cl-cat', vars: { 'cl-cat-color': c.color } }, h('i', { class: 'cl-cat__dot' }), h('span', { text: c.label }));
}
/** 统一的席位下拉：只在未离队玩家中选，选中项按草稿回填，避免重绘后选择丢失。 */
function playerSelect(value, onPick, { placeholder = '（选择席位）', exclude = null, players = null } = {}) {
  const list = (players || state.players).filter((p) => !p.left && p.id !== exclude);
  return h('select', { on: { change: (e) => onPick(e.target.value || null) } },
    h('option', { value: '', text: placeholder, selected: !value }),
    ...list.map((p) => h('option', { value: p.id, text: `${p.seat}·${p.name}`, selected: value === p.id })));
}
function btn(label, onClick, opts = {}) {
  return h('button', {
    class: ['cl-btn', opts.primary ? 'cl-btn--primary' : null, opts.danger ? 'cl-btn--danger' : null, opts.small ? 'cl-btn--sm' : null],
    type: 'button', disabled: opts.disabled || false,
    on: opts.disabled ? {} : { click: onClick },
  }, label);
}
function section(title, sub, ...rest) {
  // 可变参数：把所有 body 节点平铺渲染，避免多参数调用时丢节点。
  const nodes = rest.flat(Infinity).filter((n) => n !== null && n !== undefined && n !== false);
  return h('section', { class: 'cl-section' },
    h('header', { class: 'cl-section__head' },
      h('div', null, h('h3', { text: title }), sub ? h('p', { class: 'cl-section__sub', text: sub }) : null)),
    ...nodes);
}

/* -------------------------------------------------------------------------- */
/* 顶部导航                                                                    */
/* -------------------------------------------------------------------------- */
function headerNode() {
  const tabs = [
    ['setup', '开局设置'], ['grimoire', '魔典主持'], ['roles', '角色图鉴'],
    ['weather', '天气图鉴'], ['rules', '玩法说明'],
  ];
  return h('div', { class: 'cl-header' },
    h('div', { class: 'cl-header__brand' },
      h('img', { class: 'cl-header__logo', attrs: { src: LOGO, alt: '气候哨兵' } }),
      h('div', null, h('h1', { text: '气候哨兵 · 韧性社区' }), h('p', { text: '协调员魔典 · 气候变化与人道行动主题桌游' }))),
    h('nav', { class: 'cl-tabs', attrs: { 'aria-label': '功能分区' } },
      ...tabs.map(([key, label]) => h('button', {
        class: ['cl-tab', view === key ? 'is-active' : null, key === 'grimoire' && !state ? 'is-disabled' : null],
        type: 'button', disabled: key === 'grimoire' && !state,
        on: (key === 'grimoire' && !state) ? {} : { click: () => { view = key; render(); } },
      }, label))));
}

/* -------------------------------------------------------------------------- */
/* 开局设置                                                                    */
/* -------------------------------------------------------------------------- */
function setupNode() {
  const counts = [5,6,7,8,9,10,11,12,13];
  const script = SCRIPTS[scriptId];
  const cfg = PLAYER_SETUP[playerCount];
  const roster = script.rosters?.[playerCount];
  return h('div', { class: 'cl-wrap' },
    h('div', { class: 'cl-hero' },
      h('h2', { text: '一局防灾与人道的社交推理' }),
      h('p', { text: '5–13 名玩家 + 1 名协调员，约 50–70 分钟。社区阵营核实线索、表决终结灾谣首领；灾谣阵营靠误导与韧性崩溃瓦解社区。本工具由协调员操作，玩家围桌线下。' })),
    section('① 选择人数', '按人数自动配牌；每个真实角色最多一张，恰好一名初始首领。',
      h('div', { class: 'cl-count-grid' }, ...counts.map((n) => h('button', {
        class: ['cl-count', playerCount === n ? 'is-active' : null], type: 'button',
        on: { click: () => { playerCount = n; render(); } },
      }, h('strong', { text: String(n) }), h('span', { text: '人' }))))),
    section('② 选择剧本', script.name, h('div', { class: 'cl-script-grid' },
      ...Object.values(SCRIPTS).map((sc) => h('button', {
        class: ['cl-script', scriptId === sc.id ? 'is-active' : null], type: 'button',
        on: { click: () => { scriptId = sc.id; render(); } },
      }, h('strong', { text: sc.name }), h('span', { class: 'cl-script__level', text: sc.level }),
         h('p', { text: sc.intro })))),
      h('div', { class: 'cl-note' }, h('strong', { text: '可用变体（发牌前秘密选择）' }),
        h('ul', null, ...(script.variants || []).map((v) => h('li', { text: v }))))),
    section('③ 开局参数', '种子可复现同一副牌；囤积者替换会秘密换走一名哨兵。',
      h('div', { class: 'cl-form' },
        h('label', { class: 'cl-field' }, h('span', { text: '随机种子' }),
          h('input', { type: 'number', min: '1', value: String(seed), on: { input: (e) => { seed = Math.max(1, Number(e.target.value) || 1); } } })),
        h('label', { class: 'cl-check' }, h('input', { type: 'checkbox', checked: useHoarder,
          on: { change: (e) => { useHoarder = e.target.checked; } } }), h('span', { text: '启用囤积者替换（若剧本含囤积者）' }))),
      h('div', { class: 'cl-note' },
        h('p', { text: `本局配牌：气候哨兵 ${cfg.sentinel} · 协助者 ${cfg.assistant} · 灾谣者 ${cfg.minion} · 首领 ${cfg.leader}（合计 ${playerCount}）。` }),
        roster ? h('p', { text: `固定名单：哨兵 ${roster.sentinel.map((r) => ROLES[r].name).join('、')}；灾谣 ${roster.minion.map((r) => ROLES[r].name).join('、')}／${roster.leader.map((r) => ROLES[r].name).join('、')}。` }) : null)),
    h('div', { class: 'cl-start-row' },
      btn('开始新局 →', () => {
        state = createGame({ playerCount, scriptId, seed, useHoarder });
        view = 'grimoire'; render();
      }, { primary: true })));
}

/* -------------------------------------------------------------------------- */
/* 魔典主持                                                                    */
/* -------------------------------------------------------------------------- */
function statusStripFixed() {
  const s = state;
  const w = s.weather.current ? WEATHER[s.weather.current] : null;
  const leader = s.leader ? s.players.find((p) => p.id === s.leader) : null;
  return h('div', { class: 'cl-status' },
    h('div', { class: 'cl-status__cell' }, h('span', { class: 'cl-status__label', text: '阶段' }),
      h('strong', { text: s.winner ? '已终局' : (s.phase === 'firstNight' ? '首夜' : s.phase === 'night' ? `第 ${s.day} 夜` : `第 ${s.day} 天`) })),
    h('div', { class: 'cl-status__cell' }, h('span', { class: 'cl-status__label', text: '韧性' }),
      h('div', { class: 'cl-resilience' }, ...Array.from({ length: 4 }, (_, i) => h('i', { class: ['cl-res-pip', i < s.resilience ? 'is-on' : null] }))),
      h('strong', { text: `${s.resilience}/4` })),
    h('div', { class: 'cl-status__cell' }, h('span', { class: 'cl-status__label', text: '天气' }),
      h('strong', { text: w ? `${w.icon} ${w.name}` : '首夜无天气' }), w ? chip(w.type === 'extreme' ? '极端日' : '常规', w.type === 'extreme' ? 'danger' : '') : null),
    h('div', { class: 'cl-status__cell' }, h('span', { class: 'cl-status__label', text: '存活' }),
      h('strong', { text: `${s.players.filter((p) => !p.left).length}/${s.playerCount}` })),
    h('div', { class: 'cl-status__cell' }, h('span', { class: 'cl-status__label', text: '现任首领' }),
      h('strong', { text: leader && !leader.left ? `${leader.name}（${ROLES[s.leaderType].name}）` : '—' })));
}

function seatNode(p) {
  const r = ROLES[p.role];
  const sel = selectedSeat === p.id;
  const leader = state.leader === p.id && !p.left;
  return h('button', {
    class: ['cl-seat', p.left ? 'is-left' : null, sel ? 'is-selected' : null, leader ? 'is-leader' : null],
    type: 'button', on: { click: () => { selectedSeat = sel ? null : p.id; render(); } },
  },
    h('div', { class: 'cl-seat__no', text: String(p.seat) }),
    h('img', { class: 'cl-seat__icon', attrs: { src: ICON(p.role), alt: '' } }),
    h('div', { class: 'cl-seat__body' },
      h('strong', { class: 'cl-seat__name', text: p.name }),
      h('span', { class: 'cl-seat__role', text: r ? r.name : '?' }),
      h('span', { class: 'cl-seat__cat', text: r ? CATEGORY[r.category].label : '' })),
    h('div', { class: 'cl-seat__flags' },
      p.left ? chip('已离队', 'muted') : null,
      p.poisoned ? chip('中毒', 'warn') : null,
      p.marked ? chip('标记', 'danger') : null,
      leader ? chip('首领', 'danger') : null));
}

function seatRing() {
  const s = state;
  return h('div', { class: 'cl-seat-ring' }, ...s.players.map(seatNode));
}

function selectedPanel() {
  const s = state;
  if (!selectedSeat) return h('div', { class: 'cl-empty', text: '点选席位查看详情与执行角色动作。' });
  const p = s.players.find((x) => x.id === selectedSeat);
  const r = ROLES[p.role];
  const isLeader = s.leader === p.id && !p.left;
  return h('div', { class: 'cl-detail' },
    h('div', { class: 'cl-detail__top' },
      h('img', { class: 'cl-detail__portrait', attrs: { src: PORTRAIT(p.role), alt: p.name } }),
      h('div', null,
        h('h4', { text: `${p.name} · ${r?.name || '?'}` }),
        categoryChip(p.role),
        h('p', { class: 'cl-detail__ability', text: r?.ability || '' }),
        p.role === 'intern' ? h('p', { class: 'cl-detail__secret', text: `假面：${ROLES[s.secret.internMask]?.name || '?'}（仅协调员可见）` }) : null,
        isLeader ? h('p', { class: 'cl-detail__secret', text: '现任灾谣首领（仅协调员可见）' }) : null)),
    h('div', { class: 'cl-detail__actions' },
      !p.left ? btn('设为离队（夜间）', () => act((st) => eliminate(st, p.id, 'night'), `${p.name} 已离队`), { small: true, danger: true }) : null,
      btn('设为未离队', () => act((st) => {
        const q = st.players.find((x) => x.id === p.id);
        q.left = false; q.leftReason = null; q.leftDay = null;
        return st;
      }, `${p.name} 恢复未离队`), { small: true })));
}

function phaseControl() {
  const s = state;
  if (s.winner) return h('div', { class: 'cl-win' },
    h('h3', { text: s.winner === 'community' ? '社区阵营获胜' : '灾谣阵营获胜' }),
    h('p', { text: s.winReason }),
    btn('复盘本局', () => { view = 'rules'; setToast('终局已公开全部身份，可在日志中复盘。'); }, { primary: true }));
  if (s.phase === 'firstNight') return firstNightControl();
  if (s.phase === 'day') return dayControl();
  if (s.phase === 'night') return nightControl();
  return null;
}

function firstNightControl() {
  const s = state;
  const has = (role) => s.players.some((p) => p.role === role && !p.left);
  const swap = s.secret.hoarderSwap;
  const steps = [
    '灾谣互认：灾谣阵营睁眼，确认初始首领与同伴。',
    has('hoarder') ? '囤积者：秘密展示被换走的旧哨兵牌。' : '囤积者：本局无。',
    has('disruptor') ? '干扰者：选择一名未离队玩家施加中毒。' : '干扰者：本局无。',
    has('puppeteer') ? '推手：查看两名不同玩家的真实角色。' : '推手：本局无。',
    has('evaluator') ? '评估员：查验一名其他玩家是否为灾谣者。' : '评估员：本局无。',
    '结束首夜：宣布黎明，第一日开始翻天气。',
  ];

  const acts = [];
  if (has('hoarder')) {
    acts.push(h('div', { class: 'cl-fn-act' },
      h('span', { class: 'cl-fn-act__label', text: '囤积者' }),
      h('span', { class: 'cl-fn-act__hint', text: swap ? `被换走「${ROLES[swap.removed].name}」，换入「${ROLES[swap.added].name}」` : '本局未发生替换' }),
      btn('登记已展示', () => act((st) => firstNightAction(st, { type: 'hoarder' }), '已登记展示'), { small: true })));
  }
  if (has('disruptor')) {
    acts.push(h('div', { class: 'cl-fn-act' },
      h('span', { class: 'cl-fn-act__label', text: '干扰者' }),
      playerSelect(fnPick.disruptor, (v) => { fnPick.disruptor = v; render(); }),
      btn('施加中毒', () => {
        if (!fnPick.disruptor) return setToast('请先选择中毒目标。');
        act((st) => firstNightAction(st, { type: 'disruptor', targetId: fnPick.disruptor }), '中毒已施加');
      }, { small: true, primary: true })));
  }
  if (has('puppeteer')) {
    acts.push(h('div', { class: 'cl-fn-act' },
      h('span', { class: 'cl-fn-act__label', text: '推手（看两名）' }),
      playerSelect(fnPick.puppeteerA, (v) => { fnPick.puppeteerA = v; render(); }, { placeholder: '（第一人）' }),
      playerSelect(fnPick.puppeteerB, (v) => { fnPick.puppeteerB = v; render(); }, { placeholder: '（第二人）', exclude: fnPick.puppeteerA }),
      btn('告知真实角色', () => {
        if (!fnPick.puppeteerA || !fnPick.puppeteerB) return setToast('请选择两名不同的玩家。');
        act((st) => firstNightAction(st, { type: 'puppeteerFirst', targetId: fnPick.puppeteerA, targetId2: fnPick.puppeteerB }), '已告知');
      }, { small: true, primary: true })));
  }
  if (has('evaluator')) {
    acts.push(h('div', { class: 'cl-fn-act' },
      h('span', { class: 'cl-fn-act__label', text: '评估员' }),
      playerSelect(fnPick.evaluator, (v) => { fnPick.evaluator = v; render(); },
        { placeholder: '（选择查验对象）', exclude: s.players.find((p) => p.role === 'evaluator')?.id }),
      btn('查验是否灾谣者', () => {
        if (!fnPick.evaluator) return setToast('请先选择查验对象。');
        act((st) => firstNightAction(st, { type: 'evaluator', targetId: fnPick.evaluator }), '已查验');
      }, { small: true, primary: true })));
  }

  return section('首夜夜曲', '按固定顺序唤醒；没有对应角色也保留口令，不通过省略暴露名单。',
    h('ol', { class: 'cl-steps' }, ...steps.map((t, i) => h('li', { class: i === 0 ? 'is-now' : null, text: t }))),
    acts.length ? h('div', { class: 'cl-fn-acts' }, ...acts) : null,
    [btn('完成首夜 → 进入第一日', () => act(endFirstNight, '首夜结束，进入第一日'), { primary: true })]);
}

function dayControl() {
  const s = state;
  const w = s.weather.current ? WEATHER[s.weather.current] : null;
  const ds = s.dayState;
  const nominees = [...new Set(ds.nominations.map((n) => n.to))];
  const alivePlayers = s.players.filter((p) => !p.left);
  const need = Math.ceil(alivePlayers.length / 2);
  const vagrant = s.players.find((p) => p.role === 'vagrant' && !p.left);

  // ── 白天流程 ──────────────────────────────────────────────────────────
  const dayActions = [
    !w ? btn('翻天气', () => act(flipWeather, '天气已翻开'), { primary: true }) : null,
    w ? btn('宣讲发动', () => act(claimPreach, '宣讲窗口已处理'), { small: true, disabled: ds.voteRound !== 1 }) : null,
    w ? btn('后勤支援', () => act(claimSupport, '支援窗口已处理'), { small: true, disabled: ds.voteRound !== 1 }) : null,
  ];

  const evacBlock = w && !ds.noNominate ? h('div', { class: 'cl-sub' },
    h('h4', { class: 'cl-sub__title', text: '疏散宣称' }),
    h('p', { class: 'cl-sub__hint', text: '整局一次，提名开始前公开身份并指定一人；被指定者当日不能被提名。协调员不当场认证。' }),
    h('div', { class: 'cl-inline' },
      playerSelect(evacTarget, (v) => { evacTarget = v; render(); }, { placeholder: '（选择被疏散者）' }),
      btn('登记疏散', () => {
        if (!evacTarget) return setToast('请先选择疏散目标。');
        act((st) => declareEvacuate(st, evacTarget), `已登记疏散：${s.players.find((p) => p.id === evacTarget)?.name || '?'}`);
      }, { small: true, disabled: Boolean(ds.evacuate) }),
      ds.evacuate ? chip(`已登记：${s.players.find((p) => p.id === ds.evacuate)?.name || '?'}`, 'muted') : null)) : null;

  const partnerBlock = w && vagrant ? h('div', { class: 'cl-sub' },
    h('h4', { class: 'cl-sub__title', text: '流浪汉结对' }),
    h('p', { class: 'cl-sub__hint', text: '每日讨论开始时指定一人；只有该对象投出有效非弃权票，流浪汉本人的票才计入。当日不得改选。' }),
    h('div', { class: 'cl-inline' },
      playerSelect(partnerTarget ?? vagrant.claims?.partner ?? null, (v) => { partnerTarget = v; render(); },
        { placeholder: '（选择结对对象）', exclude: vagrant.id }),
      btn('登记结对', () => {
        if (!partnerTarget) return setToast('请先选择结对对象。');
        act((st) => setPartner(st, vagrant.id, partnerTarget), `已与 ${s.players.find((p) => p.id === partnerTarget)?.name || '?'} 结对`);
      }, { small: true }),
      vagrant.claims?.partner ? chip(`今日结对：${s.players.find((p) => p.id === vagrant.claims.partner)?.name || '?'}`, 'muted') : null)) : null;

  const nomBlock = w && !ds.noNominate ? h('div', { class: 'cl-sub' },
    h('h4', { class: 'cl-sub__title', text: '提名' }),
    h('p', { class: 'cl-sub__hint', text: '每人每日最多提名一人；不能提名自己，也不能提名已被疏散保护的人。' }),
    h('div', { class: 'cl-nom__form' },
      playerSelect(nomFrom, (v) => { nomFrom = v; render(); }, { placeholder: '（提名者）' }),
      h('span', { class: 'cl-nom__arrow', text: '→' }),
      playerSelect(nomTo, (v) => { nomTo = v; render(); }, { placeholder: '（被提名者）', exclude: nomFrom }),
      btn('提交提名', () => {
        if (!nomFrom || !nomTo) return setToast('请先选择提名者与被提名者。');
        act((st) => nominate(st, nomFrom, nomTo), '提名已登记');
        nomTo = null;
      }, { small: true, primary: true })),
    ds.nominations.length ? h('div', { class: 'cl-nom__list' },
      ...ds.nominations.map((n) => h('span', { class: 'cl-chip', text: `${s.players.find((p) => p.id === n.from)?.name}→${s.players.find((p) => p.id === n.to)?.name}` }))) : null) : null;

  const s1 = section('白天流程', w ? `${w.icon} ${w.name}：${w.effect}` : '先翻天气再开始。',
    h('div', { class: 'cl-day-actions' }, ...dayActions),
    ds.noNominate ? h('p', { class: 'cl-warn', text: '寒潮次日：今日不得提名或表决。' }) : null,
    evacBlock, partnerBlock, nomBlock);

  // ── 表决计票 ──────────────────────────────────────────────────────────
  const voteRows = alivePlayers.map((p) => {
    const draft = voteDraft[p.id];
    const current = draft && nominees.includes(draft) ? draft : 'abstain';
    return h('label', { class: 'cl-vote-row' },
      h('span', { text: p.name }),
      h('select', { on: { change: (e) => { voteDraft[p.id] = e.target.value || 'abstain'; } } },
        h('option', { value: 'abstain', text: '弃权', selected: current === 'abstain' }),
        ...nominees.map((id) => h('option', { value: id, text: s.players.find((x) => x.id === id)?.name || '?', selected: current === id }))));
  });
  const s2 = section('表决计票', `门槛 ${need} 票（存活 ${alivePlayers.length} 人）。每位未离队玩家一票。`,
    nominees.length ? null : h('p', { class: 'cl-sub__hint', text: '尚无候选人：先在上方登记提名，选票才会出现候选项。' }),
    h('div', { class: 'cl-vote-grid' }, ...voteRows),
    h('div', { class: 'cl-vote-actions' },
      btn('提交表决并结算', () => {
        const payload = {};
        for (const p of alivePlayers) {
          const v = voteDraft[p.id];
          payload[p.id] = v && nominees.includes(v) ? v : 'abstain';
        }
        if (!Object.values(payload).some((v) => v !== 'abstain')) return setToast('请先在上方填写选票。');
        act((st) => resolveVote(setVotes(st, payload)), '表决已结算'); voteDraft = {};
      }, { primary: true }),
      canRunoff(s) ? btn('进入复表决', () => { voteDraft = {}; act(startRunoff, '进入复表决'); }, { small: true }) : null),
    ds.result ? h('div', { class: 'cl-vote-result' },
      h('strong', { text: `第 ${ds.result.round} 轮：门槛 ${ds.result.need}，最高 ${ds.result.top} 票` }),
      h('span', { text: ds.result.executed ? `处决 ${s.players.find((p) => p.id === ds.result.executed)?.name}` : '无人处决' })) : null);

  // ── 进入夜晚 ──────────────────────────────────────────────────────────
  const s3 = section('进入夜晚', '结算大使损失、宣讲、天气扣减与到期标记后进入普通夜。',
    h('div', { class: 'cl-day-actions' },
      btn(s.winner ? '游戏已结束' : '结束白天 → 入夜', () => act(finishDay, '白天结算完成，进入夜晚'), { primary: true, disabled: !!s.winner })));

  return h('div', { class: 'cl-flow' }, s1, s2, s3);
}

/** 夜曲每一步该由哪个角色执行；按角色定位本人，不依赖协调员是否点选过座位。 */
const STEP_ACTOR_ROLE = {
  repairer: 'repairer', disruptor: 'disruptor', reinforce: 'reinforce', guardian: 'guardian',
  puppeteer: 'puppeteer', preacher: 'preacher', observer: 'observer', inspector: 'inspector',
  recorder: 'recorder', psychologist: 'psychologist', reviewer: 'reviewer', intel: 'puppeteer',
};
function actorIdFor(key) {
  const role = STEP_ACTOR_ROLE[key];
  if (!role) return undefined;
  return state.players.find((p) => p.role === role && !p.left)?.id;
}

function nightControl() {
  const s = state;
  const info = nightStepInfo(s);
  if (!info) return null;
  const leader = s.leader ? s.players.find((p) => p.id === s.leader) : null;
  const actorId = actorIdFor(info.key);
  const needTarget = ['disruptor', 'reinforce', 'guardian', 'puppeteer', 'inspector', 'reviewer', 'leader'].includes(info.key);

  const actionButtons = [];
  if (info.key === 'repairer') actionButtons.push(btn('发动抢修', () => act((st) => nightAction(st, { type: 'repair', actorId }), '抢修已发动'), { small: true }));
  if (info.key === 'preacher') actionButtons.push(btn('预告宣讲（整局 3 次）', () => act((st) => nightAction(st, { type: 'preach', actorId }), '宣讲已预告'), { small: true }));
  if (info.key === 'observer') actionButtons.push(btn('查看天气并交换（若有两张）', () => act((st) => nightAction(st, { type: 'observe', actorId, swap: true }), '观测员已查看天气'), { small: true }));
  if (info.key === 'empath') actionButtons.push(btn('告知共情者邻座灾谣数', () => act((st) => nightAction(st, { type: 'empath' }), '已处理共情者信息'), { small: true }));
  if (info.key === 'recorder') {
    actionButtons.push(btn('查处决者', () => act((st) => nightAction(st, { type: 'record', choice: 'execution', actorId }), '记录员已查'), { small: true }));
    actionButtons.push(btn('查非处决离队者', () => act((st) => nightAction(st, { type: 'record', choice: 'other', actorId }), '记录员已查'), { small: true }));
  }
  if (info.key === 'psychologist') actionButtons.push(btn('心理师获取能力', () => act((st) => nightAction(st, { type: 'psych', actorId }), '心理师已获取'), { small: true }));
  if (info.key === 'intel') actionButtons.push(btn('受理情报递交', () => act((st) => nightAction(st, { type: 'intel', actorId, guess: [] }), '情报递交已受理'), { small: true }));
  if (info.key === 'leader' && leader?.role === 'panicseed') {
    actionButtons.push(btn('自爆（替代蛊惑）', () => act((st) => nightAction(st, { type: 'bomb', actorId: leader.id, choice: 'bomb' }), '首领自爆'), { small: true, danger: true }));
    actionButtons.push(btn('标记目标', () => act((st) => nightAction(st, { type: 'mark', actorId: leader.id, choice: 'mark', targetId: targetDraft }), '首领已标记'), { small: true, disabled: !targetDraft }));
  }

  let targetBlock = null;
  if (info.key === 'stationchief') {
    targetBlock = h('div', { class: 'cl-target' },
      h('span', { text: '两名目标：' }),
      playerSelect(targetDraft, (v) => { targetDraft = v; render(); }),
      playerSelect(targetDraft2, (v) => { targetDraft2 = v; render(); }, { exclude: targetDraft }),
      btn('站长查验', () => {
        if (!targetDraft || !targetDraft2) return setToast('请选择两名不同的玩家。');
        act((st) => nightAction(st, { type: 'station', actorId, targetId: targetDraft, targetId2: targetDraft2 }), '站长已查验');
      }, { small: true, primary: true }));
  } else if (needTarget) {
    targetBlock = h('div', { class: 'cl-target' },
      h('span', { text: '目标：' }),
      playerSelect(targetDraft, (v) => { targetDraft = v; render(); }),
      btn('提交动作', () => {
        if (!targetDraft) return setToast('请先选择目标。');
        const choice = info.key === 'leader' ? (leader?.role === 'thunder' ? 'mark' : 'convert') : undefined;
        act((st) => nightAction(st, { type: info.key, actorId, targetId: targetDraft, choice }), `${info.label} 动作已提交`);
      }, { small: true, primary: true }));
  }

  return h('div', { class: 'cl-flow' },
    section(`第 ${s.day} 夜 · 夜曲 ${info.index}/${info.total}`, `${info.who} —— ${info.cancelled ? '（受天气影响，本窗口取消/受限）' : info.weather ? `天气：${WEATHER[s.weather.current]?.name}` : ''}`,
      h('div', { class: 'cl-night-grid' },
        h('div', null, targetBlock, ...actionButtons),
        h('ol', { class: 'cl-night-order' }, ...NIGHT_ORDER.map((n, i) => h('li', { class: i === s.step ? 'is-now' : i < s.step ? 'is-done' : null, text: `${i + 1}. ${n.label}` }))),
      h('div', { class: 'cl-night-actions' },
        btn('跳过本窗口 →', () => act((st) => nightAction(st, { type: 'ack' })), { small: true }),
        btn('黎明 → 进入白天', () => act(dawn, '天亮了'), { primary: true })))));
}

function logNode() {
  const s = state;
  const logs = s.log.slice(-40).reverse();
  return section('主持日志', '提交与实际生效分别登记；此处按时间倒序。',
    h('div', { class: 'cl-log' }, ...logs.map((l, i) => h('div', { class: ['cl-log__row', `cl-log__row--${l.kind}`] },
      h('span', { class: 'cl-log__day', text: `D${l.day}` }),
      h('span', { class: 'cl-log__text', text: l.text })))));
}

function grimoireNode() {
  if (!state) return h('div', { class: 'cl-wrap', text: '请先开局。' });
  return h('div', { class: 'cl-wrap' },
    statusStripFixed(),
    h('div', { class: 'cl-grimoire-grid' },
      h('div', { class: 'cl-grimoire-main' },
        section('魔典座位', '真实身份与秘密仅协调员可见；点选席位查看详情。', seatRing()),
        selectedPanel(),
        phaseControl(),
        logNode()),
      h('aside', { class: 'cl-grimoire-side' },
        h('div', { class: 'cl-side-card' },
          h('h4', { text: '本局秘密记录' }),
          h('p', { text: `站长误报对象：${state.secret.misreport ? state.players.find((p) => p.id === state.secret.misreport)?.name || '?' : '本局无站长'}` }),
          state.secret.internSeat ? h('p', { text: `实习生：${state.players.find((p) => p.id === state.secret.internSeat)?.name}，假面 ${ROLES[state.secret.internMask]?.name}` }) : null,
          state.secret.hoarderSwap ? h('p', { text: `囤积者换走 ${ROLES[state.secret.hoarderSwap.removed]?.name}，换成 ${ROLES[state.secret.hoarderSwap.added]?.name}` }) : null,
          state.intel4 ? h('p', { class: 'cl-side-card__intel', text: state.intel4 }) : null),
        h('div', { class: 'cl-side-card' },
          h('h4', { text: '接任与次数' }),
          h('p', { text: `掮客接任：${state.brokerQualified ? '已用' : '未用'} · 推手后备资格：${state.pusherQualified ? '已获' : '未获'}` }),
          h('p', { text: `首领自爆：${state.leaderSelfBombUsed ? '已用' : '未用'}` })))));
}

/* -------------------------------------------------------------------------- */
/* 图鉴                                                                        */
/* -------------------------------------------------------------------------- */
function roleCard(id) {
  const r = ROLES[id]; const c = CATEGORY[r.category];
  return h('article', { class: 'cl-role', vars: { 'cl-cat-color': c.color } },
    h('img', { class: 'cl-role__icon', attrs: { src: ICON(id), alt: r.name, loading: 'lazy', decoding: 'async' } }),
    h('div', { class: 'cl-role__body' },
      h('div', { class: 'cl-role__head' }, h('h4', { text: r.name }), h('span', { text: r.title })),
      h('div', { class: 'cl-role__cat', text: c.label }),
      h('p', { class: 'cl-role__ability', text: r.ability }),
      r.alias?.length ? h('p', { class: 'cl-role__alias', text: `别名：${r.alias.join('、')}` }) : null,
      h('p', { class: 'cl-role__slogan', text: `科普：${r.slogan}` })));
}
function rolesNode() {
  const groups = [
    ['sentinel', '气候哨兵 · 社区'], ['assistant', '社区协助者'],
    ['minion', '灾谣者'], ['leader', '灾谣首领'],
  ];
  return h('div', { class: 'cl-wrap' },
    h('div', { class: 'cl-hero' }, h('h2', { text: '24 角色图鉴' }), h('p', { text: '能力以规则书与策划案为准；小标识素材中「结对员」= 正文「流浪汉」。科普知识句用于终局复盘。' })),
    ...groups.map(([cat, label]) => section(label, `${ROLE_IDS.filter((id) => ROLES[id].category === cat).length} 名角色`,
      h('div', { class: 'cl-role-grid' }, ...ROLE_IDS.filter((id) => ROLES[id].category === cat).map(roleCard)))));
}
function weatherNode() {
  return h('div', { class: 'cl-wrap' },
    h('div', { class: 'cl-hero' }, h('h2', { text: '8 张天气卡' }), h('p', { text: '每天白天翻开一张；⑤⑥⑦⑧为极端日，当日白天结束韧性 −1。天气从当日持续到次日翻牌。' })),
    h('div', { class: 'cl-weather-grid' }, ...WEATHER_IDS.map((id) => {
      const w = WEATHER[id];
      return h('article', { class: ['cl-weather', w.type === 'extreme' ? 'is-extreme' : null] },
        h('img', { attrs: { src: WEATHER_ART(id), alt: w.name, loading: 'lazy', decoding: 'async' } }),
        h('div', null,
          h('h4', { text: `${w.icon} ${w.name}` }), chip(w.type === 'extreme' ? '极端日' : '常规', w.type === 'extreme' ? 'danger' : ''),
          h('p', { text: w.effect }), h('p', { class: 'cl-weather__repair', text: w.repair }),
          h('p', { class: 'cl-weather__science', text: `科普：${w.science}` })));
    })));
}
function rulesNode() {
  return h('div', { class: 'cl-wrap' },
    h('div', { class: 'cl-hero' }, h('h2', { text: '玩法说明' }), h('p', { text: '本工具是协调员魔典：由协调员掌握真实身份、执行规则、秘密交付信息，不参与阵营胜负。玩家围桌线下，可口头声称身份但不得展示身份牌。' })),
    section('胜利条件', null, h('ul', { class: 'cl-bullets' },
      h('li', { text: '社区：现任首领离队后无合法继任者（掮客或获资格的推手）。' }),
      h('li', { text: '灾谣：韧性归零；或首领仍在时未离队灾谣人数 ≥ 未离队社区人数；或大使首次有效处决。' })),
      h('p', { class: 'cl-note', text: '韧性初始 3、上限 4；中间值为负不提前判负，最终结算 ≤0 才判负。' })),
    section('一日流程', null, h('ol', { class: 'cl-bullets' },
      ...['翻天气与讨论（私聊 3 分钟 + 逐人发言）','疏散宣称与提名（每人每日最多提名一人）','首轮表决前窗口：宣讲发动、后勤支援',
        '秘密表决（门槛 = 存活人数一半向上取整）','首轮无人处决且 ≥2 候选得票 → 复表决','白天结束八步结算：处决 → 接任 → 阵雨交付 → 宣讲 → 天气扣减 → 韧性判定 → 到期标记 → 清中毒',
        '普通夜：抢修 → 干扰 → 加固 → 守护 → 推手 → 首领 → 宣讲 → 查验 → 心理师 → 复核 → 情报递交 → 黎明'].map((t) => h('li', { text: t })))),
    section('值班提示', '若切换浏览器会话或刷新页面，当前对局状态不会保留；本工具为线下围桌辅助，不存档。',
      h('p', { class: 'cl-note', text: '本游戏由南京大学红十字会学生分会改编，非官方、非商业的内部娱乐活动；角色与科普内容正式宣传前须经相关气象、应急或红十字工作者审核。' })));
}

/* -------------------------------------------------------------------------- */
/* 渲染 / 生命周期                                                             */
/* -------------------------------------------------------------------------- */
let root = null;
function render() {
  if (disposed || !root) return;
  const body = view === 'setup' ? setupNode()
    : view === 'grimoire' ? grimoireNode()
      : view === 'roles' ? rolesNode()
        : view === 'weather' ? weatherNode() : rulesNode();
  root.replaceChildren(...[headerNode(), toast ? h('div', { class: 'cl-toast', text: toast }) : null, body].filter(Boolean));
}

export default function page() {
  ensureStyles();
  // 模块级状态跨导航保留（协调员可中途离开再回来继续主持），但 dispose 会把
  // 它置为 true；重入必须复位，否则 render() 直接返回，页面一片空白。
  disposed = false;
  // 草稿指向的是上一次操作的临时选择，重入时清掉；对局本身（state）保留。
  voteDraft = {}; targetDraft = null; targetDraft2 = null;
  nomFrom = null; nomTo = null; evacTarget = null; partnerTarget = null;
  fnPick = { disruptor: null, puppeteerA: null, puppeteerB: null, evaluator: null };
  root = h('div', { class: 'cl-app' });
  render();
  return {
    title: '气候哨兵 · 韧性社区',
    node: root,
    dispose() { disposed = true; root = null; },
  };
}
