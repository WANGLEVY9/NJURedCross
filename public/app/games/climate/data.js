/* ==========================================================================
   气候哨兵 · 韧性社区 —— 角色 / 天气 / 剧本 单一事实源
   来源：《气候哨兵·韧性社区 规则书》(27 页) 与《策划案》(v2.0)，二者一致。
   口径：以规则书正文与策划案为准；同目录「精简版 1.1」(16 角色) 为旧版，不采用。
   注：小标识素材里「结对员」= 规则书正文「流浪汉」，此处以流浪汉为正名、结对员为别名。
   ========================================================================== */

/* 素材 URL 带上发布指纹：服务端对带正确 v 的 /assets/ 请求回 immutable，
   图鉴页 48 张图才不会每次进页面都走一遍条件请求。 */
function assetSuffix() {
  if (typeof document === 'undefined') return '';
  const v = document.documentElement?.dataset?.assetVersion;
  return v ? `?v=${v}` : '';
}
export const ICON = (id) => `/assets/climate/roles/${id}.webp${assetSuffix()}`;
export const PORTRAIT = (id) => `/assets/climate/portraits/${id}.webp${assetSuffix()}`;
export const WEATHER_ART = (id) => `/assets/climate/weather/${id}.webp${assetSuffix()}`;
export const LOGO = `/assets/climate/logo.webp${assetSuffix()}`;

/** 类别 → 展示色（规则书：哨兵绿 / 协助者蓝 / 灾谣者紫 / 首领红）。 */
export const CATEGORY = {
  sentinel: { label: '气候哨兵', team: 'community', color: '#2f8f5b', short: '哨' },
  assistant: { label: '社区协助者', team: 'community', color: '#2f6fb0', short: '协' },
  minion: { label: '灾谣者', team: 'evil', color: '#7a4fa3', short: '谣' },
  leader: { label: '灾谣首领', team: 'evil', color: '#c0392b', short: '首' },
};

/**
 * 24 角色。
 * id 稳定英文键；name 正名；alias 别名（素材/旧文案）；category 决定阵营；
 * ability 为规则书完整能力；card 为 24 角色文案短版；slogan 为科普知识句；
 * night: 'first' | 'normal' | 'both' | 'setup' | null —— 参与哪个夜曲窗口；
 * uses 为整局次数上限（0 = 无限/被动）。
 */
export const ROLES = {
  // ── 气候哨兵（14）───────────────────────────────────────────────────────
  observer: {
    id: 'observer', name: '观测员', alias: [], category: 'sentinel', night: 'normal', uses: 2,
    title: '火眼甄别',
    ability: '每个普通夜，你可以查看接下来两张未翻开的天气卡，并可交换顺序。整局最多 2 次；首夜不能使用。只剩 1 张时可查看该张并消耗 1 次，也可放弃；不跨轮补足。',
    card: '首夜及普通夜看后 2 张未翻天气，可调换顺序；整局 2 次。',
    slogan: '关注官方气象预警，不信谣、不传谣——早期预警是减轻损失最有效的手段。',
    note: '高温照常；台风、寒潮取消，抢修可恢复。',
  },
  evaluator: {
    id: 'evaluator', name: '评估员', alias: [], category: 'sentinel', night: 'first', uses: 1,
    title: '天眼初启',
    ability: '首夜，你可以查验一名其他玩家，得知其是否为灾谣者，回复「是／否」。灾谣首领不属于灾谣者类别；有效新居民回复「是」。不能选择自己。',
    card: '首夜查验一名其他玩家，得知是否为普通灾谣者（不含首领）。',
    slogan: '评估社区脆弱性，优先关注老人、儿童与慢性病患者。',
    note: '中毒仍模拟查验并消耗机会，回复可真可假；普通夜不再唤醒。',
  },
  preacher: {
    id: 'preacher', name: '宣讲员', alias: [], category: 'sentinel', night: 'normal', uses: 3,
    title: '义声先闻',
    ability: '每个普通夜可秘密预告防灾宣讲；次日首轮表决前正式发动。决定处决那轮得票达到 2N/3 向上取整，社区韧性 +1（上限 4）。整局最多 3 次。',
    card: '普通夜预告防灾宣讲，次日投票前发动；处决票≥2/3 则韧性+1，整局 3 次。',
    slogan: '科学防灾准备，能显著降低气候风险。',
    note: '首夜不能预告；无人处决或票数不足也消耗；台风照常。',
  },
  empath: {
    id: 'empath', name: '共情者', alias: [], category: 'sentinel', night: 'normal', uses: 0,
    title: '感知邻心',
    ability: '每个普通夜，你得知自己左右两侧原邻座中，未离队灾谣阵营玩家的数量（0/1/2）。邻座以开局座位固定，离队不向外顺延；有效新居民计入。',
    card: '普通夜得知左右邻座中在场灾谣人数（高温停、降雨延、寒潮无回复）。',
    slogan: '气候冲击弱势群体，救援须优先关注最脆弱的人。',
    note: '高温、台风、寒潮取消；阵雨存下当夜结果、次日表决阶段结束交付。',
  },
  stationchief: {
    id: 'stationchief', name: '站长', alias: [], category: 'sentinel', night: 'normal', uses: 2,
    title: '双源探微',
    ability: '每个普通夜，你可以选择两名不同的其他未离队玩家，得知其中是否有现任灾谣首领，回复「是／否」。整局最多 2 次。另有一名固定社区玩家会被本能力始终视为首领。',
    card: '普通夜选两名玩家，得知其中是否有灾谣首领；整局 2 次。',
    slogan: '单一数据源易误导，防灾需多方核实。',
    note: '发牌后秘密指定固定误报对象，整局不变；高温、台风、寒潮取消，阵雨延迟。',
  },
  guardian: {
    id: 'guardian', name: '保障员', alias: [], category: 'sentinel', night: 'normal', uses: 0,
    title: '应急守护',
    ability: '每个普通夜，你可以守护一名其他未离队玩家，阻止其当夜受到新的蛊惑或标记。雷电、高温当夜最多守护两名不同玩家。不能守护自己，也不能选前一个普通夜提交名单中的任何人。',
    card: '普通夜为一名玩家发「应急包」，免遭蛊惑；雷电、高温日可护 2 人。',
    slogan: '家庭应急包应常备饮水、食品、药品、手电、收音机。',
    note: '守护不解除已有标记/中毒，不阻止处决；加固先于本窗口执行。',
  },
  psychologist: {
    id: 'psychologist', name: '心理师', alias: [], category: 'sentinel', night: 'normal', uses: 1,
    title: '暗夜倾听',
    ability: '当至少两名真实社区玩家已离队时，你在普通夜末按固定优先级（站长→宣讲员→共情者→保障员→加固员→观测员→抢修员→记录员→排查员→复核员→后勤员）获取一个已离队气候哨兵的可用能力。整局获取 1 次、实质发动 1 次，最早从下一普通夜使用。',
    card: '已离队社区玩家达 2 名时，继承其一个能力（按优先级顺延）。',
    slogan: '灾后心理急救（PFA）与物质救援同等重要——恐慌会传染，冷静也会。',
    note: '只取已离队哨兵能力，跳过原额度用尽者；获取当夜及紧接白天不能使用。',
  },
  recorder: {
    id: 'recorder', name: '记录员', alias: [], category: 'sentinel', night: 'normal', uses: 2,
    title: '存真实录',
    ability: '每个普通夜，你可以查验一种记录：上一个白天被处决者的真实角色（整局 1 次）；任意一名因非处决原因离队者的真实角色（另 1 次，可补查历史）。每夜最多使用一种。',
    card: '整局 1 次查验上一白天被处决者角色；另 1 次查验任意夜间离队者。',
    slogan: '灾情记录与复盘，是改进防灾体系的基础。',
    note: '高温、台风、寒潮取消；阵雨照常。',
  },
  logistics: {
    id: 'logistics', name: '后勤员', alias: [], category: 'sentinel', night: 'day', uses: 1,
    title: '随队而行',
    ability: '每日首轮正式表决前，你可以秘密申请物资支援，抵消当日天气造成的韧性 −1。非极端日申请不消耗；极端日正式申请即消耗，整局仅 1 次。不能抵消大使损失或恢复旧损失。',
    card: '首轮投票前申请「物资支援」，抵消本日天气造成的韧性−1；整局 1 次。',
    slogan: '灾害救援需要统一调度——有序的志愿服务才有力。',
    note: '寒潮禁止提名时也保留申请窗口；支援登记后不因本人失能/离队撤销。',
  },
  reinforce: {
    id: 'reinforce', name: '加固员', alias: [], category: 'sentinel', night: 'normal', uses: 0,
    title: '防风加固',
    ability: '每个普通夜，你可以加固一名其他未离队玩家，解除干扰者当夜施加的整次中毒（含延续到次日白天的部分）。不能选择前一个普通夜提交的同一目标。',
    card: '每晚加固一人：其今夜不受误导，已中的误导作废；不能连续两夜同一人。',
    slogan: '灾前一分投入，胜过灾后十分补救——房屋加固、堤坝除险是第一道工序。',
    note: '只解除干扰者的误导，不消除站长固定误报、新居民特殊呈现、实习生随机结果。',
  },
  inspector: {
    id: 'inspector', name: '排查员', alias: [], category: 'sentinel', night: 'normal', uses: 3,
    title: '隐患排查',
    ability: '每个普通夜，你可以查验一名其他未离队玩家在本窗口是否处于干扰者造成的中毒状态，回复「中毒／未中毒」。整局最多 3 次。已被有效加固解除当次误导时回复「未中毒」。',
    card: '每晚查一人今夜是否中毒，答「中毒/未中毒」，整局 3 次；若你被干扰，答案可能失真。',
    slogan: '逐户排查隐患——看不见的隐患，才是最贵的隐患。',
    note: '高温、阵雨照常，台风、寒潮取消，抢修可恢复。',
  },
  reviewer: {
    id: 'reviewer', name: '复核员', alias: [], category: 'sentinel', night: 'normal', uses: 2,
    title: '信息复核',
    ability: '每个普通夜其他主动行动结束后，你可以查验一名其他玩家当夜是否确认发动过需要夜间唤醒的主动能力，回复「有／无」。整局最多 2 次，可以选择当夜刚离队者。',
    card: '每晚压轴查一人今夜是否用过需唤醒的能力，答「有/无」，整局 2 次。',
    slogan: '同一个数字，两个人报，才敢往上报——灾情信息要复核。',
    note: '中毒模拟、阵雨已查验未交付、宣讲预告均记「有」；仅放弃/天气取消记「无」。',
  },
  repairer: {
    id: 'repairer', name: '抢修员', alias: [], category: 'sentinel', night: 'normal', uses: 1,
    title: '紧急抢修',
    ability: '每个普通夜最先，你可以发动紧急抢修，解除当夜天气对社区阵营动作的取消及阵雨延迟。整局 1 次，台风也保留此窗口。对灾谣的天气限制照旧。',
    card: '整局 1 次，夜间最先发动：今夜天气对社区阵营的封锁全部失效。',
    slogan: '抢通一条路、复电一个村，救援就能早到一小时——抢修是和灾害抢时间。',
    note: '不能恢复韧性、抵消天气扣减、改变山洪门槛或取消寒潮次日禁提名。',
  },
  evacuator: {
    id: 'evacuator', name: '疏散员', alias: [], category: 'sentinel', night: 'day', uses: 1,
    title: '提前疏散',
    ability: '整局一次，你可以在白天提名阶段开始前公开声称「我是疏散员」，指定一名玩家（可为自己）。能力有效时，该玩家当日不能被提名；其余流程照常。',
    card: '整局 1 次，提名开始前公开身份，指定一人今日不可被提名。',
    slogan: '转移要早、路线要清、老弱要先走——疏散不是逃跑。',
    note: '任何人均可作同样宣称，协调员不当场认证；不能阻止标记到期。',
  },

  // ── 社区协助者（4）──────────────────────────────────────────────────────
  intern: {
    id: 'intern', name: '实习生', alias: [], category: 'assistant', night: 'normal', uses: 0,
    title: '竹篮打水',
    ability: '你以为自己是站长或共情者，实际身份是社区协助者实习生。协调员按假面的时机、次数与天气模拟查验，给出随机合法结果。你不知道自己是实习生。',
    card: '你以为自己是站长或共情者，实际收到的调查回复为随机结果。',
    slogan: '气候信息鱼龙混杂——请认准 IPCC 与官方发布渠道。',
    note: '此牌仅协调员持有；玩家只拿站长/共情者假面。加固、抢修不使随机结果变真。',
  },
  ambassador: {
    id: 'ambassador', name: '大使', alias: [], category: 'assistant', night: null, uses: 1,
    title: '信任之柱',
    ability: '你首次因白天处决从未离队变为已离队，且离队前能力有效时，协调员公开身份，当日韧性额外 −2。只登记一次损失。',
    card: '白天被处决且能力有效时，公开身份并使社区韧性额外−2。',
    slogan: '社区韧性不仅靠硬件设施，更靠人与人之间的信任与联结。',
    note: '已离队后再次被处决不触发；首次处决时中毒或被标记也不触发。后勤支援不能抵消。',
  },
  newcomer: {
    id: 'newcomer', name: '新居民', alias: [], category: 'assistant', night: null, uses: 0,
    title: '来历不明',
    ability: '能力有效时，阵营查验将你按灾谣呈现：评估员回复「是灾谣者」，共情者把你计入灾谣人数。你的真实阵营始终是社区。',
    card: '评估、共情查一律按灾谣阵营回答；真实阵营仍是社区。',
    slogan: '灾害面前，不熟悉的人更需要被主动告知、被主动带上。',
    note: '记录员、推手查真实角色得到「新居民」；心理师不能继承本能力。',
  },
  vagrant: {
    id: 'vagrant', name: '流浪汉', alias: ['结对员'], category: 'assistant', night: 'day', uses: 0,
    title: '结对帮扶',
    ability: '每日讨论开始时，你可以公开指定一名其他未离队玩家为当日结对对象，也可不指定。每轮只有对象提交有效非弃权选票，你的票才计入；当日不得改选。',
    card: '每天讨论开始时公开指定一人结对；他投票时你的票才计入。',
    slogan: '结对帮扶是人道工作中最朴素的陪伴——一个人被陪着，才敢行动。',
    note: '本人中毒或被标记时结对限制暂停。任何人均可作同样宣称，协调员不认证。',
  },

  // ── 灾谣者（4）──────────────────────────────────────────────────────────
  puppeteer: {
    id: 'puppeteer', name: '推手', alias: [], category: 'minion', night: 'both', uses: 0,
    title: '窥影探秘',
    ability: '首夜可查看两名不同的其他玩家真实角色；此后每个普通夜可查看一名其他未离队玩家真实角色。第二夜结束前，可秘密提交一次本人以外全部未离队玩家的真实角色推断，全对则获得一次掮客接任资格。',
    card: '首夜看两名玩家具体角色；此后普通夜看一名。可提交全场推断换掮客资格 1 次。',
    slogan: '灾害虚假信息会延误防灾行动——遇「惊天大瓜」，先冷静，再求证。',
    note: '高温、寒潮、台风取消查验，抢修不恢复灾谣查验。',
  },
  disruptor: {
    id: 'disruptor', name: '干扰者', alias: [], category: 'minion', night: 'both', uses: 0,
    title: '迷障之客',
    ability: '每夜选择一名未离队玩家，使其中毒，角色能力立即失效，持续至次日白天结束的清理步骤。可以选择自己或灾谣同伴。',
    card: '每晚「误导」一名玩家，使其失去全部能力并持续至次日白天。',
    slogan: '灾害来临时信息最容易混乱——建立可靠的信息渠道至关重要。',
    note: '台风、暴雨取消当夜新误导；加固可解除；中毒不改阵营与通用提名表决权。',
  },
  broker: {
    id: 'broker', name: '掮客', alias: [], category: 'minion', night: null, uses: 1,
    title: '李代桃僵',
    ability: '首领离队时，若其离队前全场未离队人数至少 5 人，且你未离队、能力有效，你立即成为相同类型的灾谣首领，消耗本人接任资格。真实掮客优先于获资格的推手。',
    card: '灾谣首领离队且场上未离队玩家≥5人时，你立即成为新首领。',
    slogan: '一场灾害结束了，危机却远未终结——它只是换了个形式继续存在。',
    note: '接任后原身份结束；继任首领不能自爆，接任当夜不追加首领动作。',
  },
  hoarder: {
    id: 'hoarder', name: '囤积者', alias: [], category: 'minion', night: 'setup', uses: 1,
    title: '囤积居奇',
    ability: '发牌前，协调员将一张已选入的气候哨兵牌替换为本局尚未使用的随机协助者牌。宣讲员、后勤员不可被替换，实习生不在随机候选。替换者知道新身份，不知道原身份。',
    card: '开局把 1 名哨兵换成社区协助者，由协调员私下换发；不可换宣讲员与后勤员。',
    slogan: '灾时囤积居奇、哄抬物价——这是灾害中最冷的一种伤害。',
    note: '首夜干扰前必定秘密展示被取出的旧哨兵牌；设置不因失能回滚。',
  },

  // ── 灾谣首领（2）────────────────────────────────────────────────────────
  panicseed: {
    id: 'panicseed', name: '恐慌之种', alias: [], category: 'leader', night: 'normal', uses: 1,
    title: '恐慌传播',
    ability: '每个普通夜，你可以蛊惑一名其他未离队玩家，也可放弃。有效蛊惑使目标当夜立即离队，黎明宣布。守护可阻止；首夜不蛊惑。初始恐慌之种可用一次自爆替代当夜蛊惑，台风禁止。',
    card: '普通夜蛊惑一名玩家（离队休整、保留发言）；首夜不蛊惑，应急包可阻止；可自爆 1 次转移首领。',
    slogan: '转发之前想一想——让谣言止于我，让科学预警传出去。',
    note: '自爆先使本人离队，再检查接任；继任首领不能自爆，接任当夜不追加动作。',
  },
  thunder: {
    id: 'thunder', name: '闷雷', alias: ['沉雷'], category: 'leader', night: 'normal', uses: 0,
    title: '闷雷过境',
    ability: '每个普通夜，你可以标记一名其他未离队玩家，使其立即失去角色能力，并在次日白天结束的到期步骤离队。不能选择前一个普通夜提交的目标，守护可阻止新标记。首夜不标记，不能自爆。',
    card: '每晚标记一人：其即刻失去能力，次日白天结束离队；应急包可挡；同时最多 2 个；不能自爆。',
    slogan: '雷声滚过来的时候，你还有一整个白天可以跑——预警窗口就是逃生时间。',
    note: '已生效标记不因来源失能或离队撤销，也不能被加固、抢修或疏散解除。',
  },
};

export const ROLE_IDS = Object.keys(ROLES);

/** 8 张天气卡。type: normal / extreme；extreme 当日白天结束韧性 −1。 */
export const WEATHER = {
  cloudy: { id: 'cloudy', name: '多云转晴', icon: '①', type: 'normal',
    effect: '无额外效果，按普通夜顺序执行。', repair: '有效抢修后：无变化。',
    science: '天气晴朗也要关注预警信息，防灾准备贵在平时。' },
  shower: { id: 'shower', name: '阵雨', icon: '②', type: 'normal',
    effect: '共情者、站长照常查验，当夜无回复；存下结果，次日全部表决结束后交付。', repair: '有效抢修后：社区恢复当夜回复；随机结果仍随机。',
    science: '短时强降雨也可能造成城市内涝，遇积水路段请绕行。' },
  rainstorm: { id: 'rainstorm', name: '暴雨蓝色预警', icon: '③', type: 'normal',
    effect: '取消当夜干扰者的新误导，其他动作照常；不提前清除上一夜持续到当日的中毒。', repair: '有效抢修后：灾谣的新误导仍取消。',
    science: '暴雨蓝色预警：12 小时内降雨量将达 50 毫米以上，注意排水与出行安全。' },
  thunderstorm: { id: 'thunderstorm', name: '雷电黄色预警', icon: '④', type: 'normal',
    effect: '保障员当夜最多守护两名不同的其他未离队玩家，连续名单限制不变。', repair: '有效抢修后：仍最多 2 人；人数加成不是封锁。',
    science: '雷电天气避免在空旷地、大树下停留，室内关好门窗并远离金属管道。' },
  heatwave: { id: 'heatwave', name: '高温红色预警', icon: '⑤', type: 'extreme',
    effect: '取消共情者、站长、记录员、推手当夜查验；观测员、排查员、复核员照常。保障员最多守护 2 人。当日韧性 −1。', repair: '有效抢修后：社区查验恢复，推手仍取消；守护人数与天气扣减不变。',
    science: '高温红色预警：24 小时内最高气温将升至 40℃ 以上，注意防暑降温、错峰作业。' },
  typhoon: { id: 'typhoon', name: '台风红色预警', icon: '⑥', type: 'extreme',
    effect: '除宣讲预告、抢修外，取消双方当夜主动动作。当日韧性 −1。', repair: '有效抢修后：仅社区主动动作恢复，灾谣仍停手；天气扣减不变。',
    science: '台风红色预警：6 小时内可能受强热带风暴影响，请安居室内、远离玻璃与广告牌。' },
  coldwave: { id: 'coldwave', name: '寒潮红色预警', icon: '⑦', type: 'extreme',
    effect: '取消全部当夜查验。宣讲、抢修、加固、守护、干扰、首领动作照常。次日不得提名或表决。当日韧性 −1。', repair: '有效抢修后：社区查验恢复，推手仍取消；次日禁提名及天气扣减不变。',
    science: '寒潮来袭注意保暖与供水设施防冻，关心独居老人与户外工作者。' },
  flood: { id: 'flood', name: '山洪红色预警', icon: '⑧', type: 'extreme',
    effect: '当日两轮表决处决门槛均为 N/2 向上取整后减 1，最低 2 票。当日韧性 −1。', repair: '有效抢修后：门槛与天气扣减均不改变。',
    science: '山洪到来前往往有强降雨，请勿在河道、沟谷停留，按预警路线迅速转移。' },
};
export const WEATHER_IDS = Object.keys(WEATHER);

/** 按人数配牌（囤积者替换前）。每局恰好 1 名初始首领。 */
export const PLAYER_SETUP = {
  5:  { sentinel: 3, assistant: 0, minion: 1, leader: 1 },
  6:  { sentinel: 3, assistant: 1, minion: 1, leader: 1 },
  7:  { sentinel: 5, assistant: 0, minion: 1, leader: 1 },
  8:  { sentinel: 5, assistant: 1, minion: 1, leader: 1 },
  9:  { sentinel: 5, assistant: 2, minion: 1, leader: 1 },
  10: { sentinel: 7, assistant: 0, minion: 2, leader: 1 },
  11: { sentinel: 7, assistant: 1, minion: 2, leader: 1 },
  12: { sentinel: 7, assistant: 2, minion: 2, leader: 1 },
  13: { sentinel: 9, assistant: 0, minion: 3, leader: 1 },
};

/** 三个正式剧本。名单为囤积者替换前配置；发牌前可秘密采用注明的变体。 */
export const SCRIPTS = {
  firstWave: {
    id: 'firstWave', name: '第一波预警', level: '入门 8—10 人',
    weatherOrder: ['cloudy'], weatherPool: ['cloudy', 'shower', 'rainstorm', 'thunderstorm', 'heatwave', 'flood'],
    intro: '六张天气只用①②③④⑤⑧，第一张固定①；六张耗尽即重洗这六张。8、9 人基准不用干扰者。',
    rosters: {
      8:  { sentinel: ['observer','preacher','empath','guardian','reinforce'], assistant: ['newcomer'], minion: ['puppeteer'], leader: ['panicseed'] },
      9:  { sentinel: ['observer','preacher','empath','guardian','reinforce'], assistant: ['newcomer','vagrant'], minion: ['puppeteer'], leader: ['panicseed'] },
      10: { sentinel: ['observer','preacher','empath','stationchief','guardian','reinforce','logistics'], assistant: [], minion: ['puppeteer','disruptor'], leader: ['panicseed'] },
    },
    variants: ['8、9 人：观测员换后勤员', '10 人：站长换复核员'],
  },
  blackout: {
    id: 'blackout', name: '断电之夜', level: '进阶 10—12 人',
    weatherOrder: ['rainstorm','thunderstorm','coldwave'], weatherPool: null,
    intro: '全八张天气，前三张固定③暴雨、④雷电、⑦寒潮；第四日禁止提名。名单必须保留宣讲员、后勤员。',
    rosters: {
      10: { sentinel: ['observer','preacher','empath','stationchief','guardian','reinforce','logistics'], assistant: [], minion: ['disruptor','hoarder'], leader: ['panicseed'] },
      11: { sentinel: ['observer','preacher','empath','stationchief','guardian','reinforce','logistics'], assistant: ['newcomer'], minion: ['disruptor','hoarder'], leader: ['panicseed'] },
      12: { sentinel: ['observer','preacher','empath','stationchief','guardian','reinforce','logistics'], assistant: ['newcomer','ambassador'], minion: ['disruptor','hoarder'], leader: ['panicseed'] },
    },
    variants: ['观测员换记录员', '共情者换复核员'],
  },
  thunderfall: {
    id: 'thunderfall', name: '沉雷过境', level: '高难 11—13 人',
    weatherOrder: ['typhoon'], weatherPool: null,
    intro: '全八张天气，第一张固定⑥台风；实习生本人只收假面；闷雷标记次日白天结束离队。',
    rosters: {
      11: { sentinel: ['preacher','evaluator','stationchief','guardian','psychologist','repairer','logistics'], assistant: ['intern'], minion: ['broker','hoarder'], leader: ['thunder'] },
      12: { sentinel: ['preacher','evaluator','stationchief','guardian','psychologist','repairer','logistics'], assistant: ['intern','ambassador'], minion: ['broker','hoarder'], leader: ['thunder'] },
      13: { sentinel: ['preacher','evaluator','empath','stationchief','guardian','psychologist','inspector','reviewer','logistics'], assistant: [], minion: ['broker','hoarder','disruptor'], leader: ['thunder'] },
    },
    variants: ['11、12 人：掮客换干扰者，或评估员换疏散员', '13 人：共情者换抢修员，或复核员换记录员'],
  },
};

/** 心理师继承优先级（规则书 p.20）。 */
export const INHERIT_ORDER = [
  'stationchief','preacher','empath','guardian','reinforce','observer',
  'repairer','recorder','inspector','reviewer','logistics',
];

/** 夜曲窗口顺序（规则书 p.9）。 */
export const NIGHT_ORDER = [
  { key: 'repairer', label: '抢修员', who: '抢修员' },
  { key: 'disruptor', label: '干扰者', who: '干扰者' },
  { key: 'reinforce', label: '加固员', who: '加固员' },
  { key: 'guardian', label: '保障员', who: '保障员' },
  { key: 'puppeteer', label: '推手', who: '推手' },
  { key: 'leader', label: '首领', who: '灾谣首领（恐慌之种／闷雷）' },
  { key: 'preacher', label: '宣讲员', who: '宣讲员' },
  { key: 'observer', label: '观测员', who: '观测员' },
  { key: 'empath', label: '共情者', who: '共情者' },
  { key: 'stationchief', label: '站长', who: '站长' },
  { key: 'inspector', label: '排查员', who: '排查员' },
  { key: 'recorder', label: '记录员', who: '记录员' },
  { key: 'psychologist', label: '心理师获取', who: '心理师' },
  { key: 'reviewer', label: '复核员', who: '复核员' },
  { key: 'intel', label: '情报递交', who: '推手（第二夜截止）' },
  { key: 'dawn', label: '黎明', who: '全体' },
];

export function rolesByCategory(category) {
  return ROLE_IDS.filter((id) => ROLES[id].category === category);
}
