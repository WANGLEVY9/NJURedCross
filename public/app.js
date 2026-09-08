const state = { view: 'overview', table: '', tables: [], rows: new Map(), filter: '', write: false, syncedAt: '', session: null, csrfToken: '', materials: null };
const tableMap = {
  members: '全体成员表（26~27学年）',
  materials: '物资管理',
  activities: '工位值班表',
  services: '南大红会 志愿服务平台_个人主页（26年备份）',
  stock: '工位物资表',
};
const pages = {
  overview: ['工作台', 'NJU RED CROSS · OPERATIONS', '工作台', '从一个清晰的起点，掌握组织运营与数据服务状态。'],
  members: ['组织与成员', 'ORGANIZATION', '组织与成员', '成员信息集中管理；敏感字段默认脱敏展示。'],
  materials: ['物资中心', 'MATERIAL OPERATIONS', '物资中心', '管理借用申请、库存台账与归还流程。'],
  activities: ['活动与值班', 'PROGRAMS', '活动与值班', '统筹活动安排、工位排班与参与记录。'],
  services: ['志愿服务', 'VOLUNTEER SERVICE', '志愿服务', '以真实服务记录建立可追溯的志愿者档案。'],
  tables: ['表格中心', 'SEATABLE DATA HUB', '表格中心', '由 SeaTable metadata 驱动的管理员数据工作台。'],
  settings: ['系统设置', 'PLATFORM', '系统设置', '查看连接、安全边界与下一阶段建设事项。'],
};
const $ = (selector, root = document) => root.querySelector(selector);
const content = $('#content-area');
const breadcrumb = $('#breadcrumb');
const apiState = $('#api-state');

function escapeHtml(value = '') {
  return String(value).replace(/[&<>"']/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#039;' }[char]));
}
function display(value) {
  if (value === null || value === undefined || value === '') return '—';
  if (Array.isArray(value)) return value.map(display).join('、');
  if (typeof value === 'object') return value.name || value.display_value || JSON.stringify(value);
  return String(value);
}
function sensitive(column = '') { return /身份证|银行卡|手机号|微信|QQ|邮箱|学号|审核人|反馈人|创建者|修改人/.test(column); }
function masked(value, column) {
  const text = display(value);
  if (!sensitive(column) || text === '—') return text;
  return text.length < 4 ? '•••' : text.slice(0, 2) + '••••' + text.slice(-1);
}
function getTable(name) { return state.tables.find((item) => item.name === name); }
function defaultTable() { return getTable(state.table) ? state.table : (getTable(tableMap.materials) ? tableMap.materials : state.tables[0]?.name || ''); }
function head() {
  const page = pages[state.view];
  return '<section class="page-head"><div><p class="overline">' + page[1] + '</p><h1>' + page[2] + '</h1><p>' + page[3] + '</p></div><div class="timestamp">DATA SYNC · ' + (state.syncedAt || '--') + '</div></section>';
}
async function request(path, options = {}) {
  const isFormData = options.body instanceof FormData;
  const headers = { ...(isFormData ? {} : { 'Content-Type': 'application/json' }), ...(options.headers || {}) };
  if (['POST', 'PUT', 'DELETE'].includes(options.method) && state.csrfToken) headers['X-CSRF-Token'] = state.csrfToken;
  const response = await fetch(path, { ...options, headers, credentials: 'same-origin' });
  const data = await response.json().catch(() => ({}));
  if (response.status === 401 && !path.startsWith('/api/auth/')) showLogin('登录状态已失效，请重新登录。');
  if (!response.ok || data.ok === false) throw new Error(data.message || '请求失败 (' + response.status + ')');
  return data;
}
async function rowsFor(table, force = false) {
  if (!force && state.rows.has(table)) return state.rows.get(table);
  const data = await request('/api/rows?table=' + encodeURIComponent(table));
  const rows = data.rows || [];
  state.rows.set(table, rows);
  return rows;
}
function setConnection(ok, message = '') {
  apiState.className = 'api-state ' + (ok ? 'success' : 'error');
  apiState.innerHTML = ok
    ? '<span></span><div><b>数据服务运行正常</b><small>已连接 ' + state.tables.length + ' 张数据表</small></div>'
    : '<span></span><div><b>数据服务连接异常</b><small>' + escapeHtml(message) + '</small></div>';
}
function updateChrome() {
  const page = pages[state.view];
  breadcrumb.innerHTML = '<span>红会管理平台</span><i>/</i><b>' + page[0] + '</b>';
  document.querySelectorAll('.nav-item').forEach((button) => button.classList.toggle('active', button.dataset.view === state.view));
}
function showLogin(message = '') {
  state.session = null;
  state.csrfToken = '';
  document.body.classList.add('auth-mode');
  content.innerHTML = '<section class="login-screen"><div class="login-card"><div class="login-mark" aria-hidden="true">✚</div><p class="overline">NJU RED CROSS · ADMIN</p><h1>南京大学红十字会<br>管理平台</h1><p>请使用平台管理员账号登录。SeaTable 数据和写入接口仅在受保护会话中可访问。</p><form id="login-form" class="login-form"><label>管理员账号<input name="username" autocomplete="username" required placeholder="请输入账号" /></label><label>密码<input name="password" type="password" autocomplete="current-password" required placeholder="请输入密码" /></label><p class="login-error" id="login-error" role="alert">' + escapeHtml(message) + '</p><button class="button primary" type="submit">安全登录 →</button></form><div class="login-note"><b>本地原型保护</b><span>会话采用 HttpOnly Cookie；写入另需 CSRF 校验。</span></div></div></section>';
}
function applySession(payload) {
  state.session = payload.user;
  state.csrfToken = payload.csrfToken;
  document.body.classList.remove('auth-mode');
  const name = $('#session-user');
  if (name) name.textContent = payload.user.username;
}
async function login(form) {
  const button = form.querySelector('button[type="submit"]');
  const error = $('#login-error', form);
  button.disabled = true;
  error.textContent = '';
  try {
    const payload = await request('/api/auth/login', { method: 'POST', body: JSON.stringify(Object.fromEntries(new FormData(form))) });
    applySession(payload);
    await loadPlatform();
  } catch (err) { error.textContent = err.message; }
  finally { button.disabled = false; }
}
async function logout() {
  try { await request('/api/auth/logout', { method: 'POST' }); }
  catch { /* Clearing a local view is safe even if the old session has expired. */ }
  showLogin('已安全退出。');
}
function metric(label, id, note) {
  return '<article class="metric-card"><div class="metric-label">' + label + '</div><div class="metric-number" data-metric="' + id + '">—</div><div class="metric-note">' + note + '</div></article>';
}
function renderOverview() {
  content.innerHTML = head()
    + '<section class="metric-grid">'
    + '<article class="metric-card"><div class="metric-label">接入的数据表</div><div class="metric-number">' + state.tables.length + '</div><div class="metric-note">来自当前 SeaTable Base</div></article>'
    + metric('物资台账', 'stock', '读取“工位物资表”')
    + metric('借用记录', 'materials', '读取“物资管理”')
    + metric('值班排期', 'duty', '读取“工位值班表”')
    + '</section>'
    + '<section class="dashboard-grid"><article class="panel"><header class="panel-header"><div><h2>常用工作入口</h2><p>从业务页面进入，避免直接编辑原始数据表。</p></div></header><div class="panel-body"><div class="quick-actions">'
    + '<button class="quick-action" data-view="materials"><span class="qa-icon">▦</span><b>物资借用与归还</b><small>申请、审批、出库、归还</small></button>'
    + '<button class="quick-action" data-view="members"><span class="qa-icon">♙</span><b>成员组织档案</b><small>成员、部门与换届数据</small></button>'
    + '<button class="quick-action" data-view="tables"><span class="qa-icon">▤</span><b>表格中心</b><small>管理员数据操作台</small></button>'
    + '</div><div class="module-strip">' + state.tables.slice(0, 6).map((item) => '<span class="module-tag">' + escapeHtml(item.name) + '</span>').join('') + '</div></div></article>'
    + '<article class="panel"><header class="panel-header"><div><h2>运营提示</h2><p>第一版平台的业务边界</p></div><span class="status-pill">BETA</span></header><div class="panel-body"><div class="task-list">'
    + '<div class="task-row"><span class="task-dot green"></span><div><b>SeaTable 服务连接</b><small>授权、metadata 与行数据接口可用</small></div><span>READY</span></div>'
    + '<div class="task-row"><span class="task-dot"></span><div><b>物资业务页面</b><small>已接入真实表结构，待补审批流</small></div><span>NEXT</span></div>'
    + '<div class="task-row"><span class="task-dot plum"></span><div><b>成员敏感信息</b><small>默认脱敏，正式版需角色权限</small></div><span>SAFE</span></div>'
    + '</div></div></article></section>';
  loadMetrics();
}
async function loadMetrics() {
  const sources = [['stock', tableMap.stock], ['materials', tableMap.materials], ['duty', tableMap.activities]];
  await Promise.all(sources.map(async ([id, table]) => {
    const node = document.querySelector('[data-metric="' + id + '"]');
    if (!node || !getTable(table)) return;
    try { node.textContent = (await rowsFor(table)).length; } catch { node.textContent = '—'; }
  }));
}
function moduleIntro(view) {
  const copy = {
    materials: '物资借用、库存台账与归还记录已经对接当前 SeaTable Base。先以表格中心作为可信数据底座，再逐步实现审批与库存预警。',
    members: '组织成员数据已接入。当前页面采用敏感字段脱敏展示，避免在日常浏览中暴露联系方式与身份信息。',
    activities: '活动与值班以排期数据为核心。后续可扩展为日历视图、报名入口和提醒机制。',
    services: '志愿服务模块将以活动记录和服务时长为主线，形成可追溯的志愿者档案。',
  };
  return copy[view];
}
function materialMetric(label, value, note, tone = '') {
  return '<article class="metric-card ' + tone + '"><div class="metric-label">' + label + '</div><div class="metric-number">' + value + '</div><div class="metric-note">' + note + '</div></article>';
}
function renderMaterials() {
  content.innerHTML = head()
    + '<section class="materials-hero"><div><p class="overline">MATERIAL OPERATIONS</p><h2>物资全流程工作台</h2><p>物资管理者从任务队列开始：先定位资产，再预览库存变化，最后确认写入流水。</p></div><div class="material-actions"><button class="button secondary" id="open-qr-scan" type="button">⌁ 扫码定位</button><button class="button secondary" id="open-stock-in" type="button">+ 入库登记</button><button class="button secondary" id="open-stock-out" type="button">− 出库 / 归还</button><button class="button primary" id="open-material-request" type="button">+ 新建借用申请</button></div></section>'
    + '<div id="materials-board"><section class="panel"><div class="empty-state"><strong>正在加载物资运营数据</strong>从 SeaTable 汇总库存、借用与预警…</div></section></div>';
  hydrateMaterials(true);
}
function materialStatus(status) {
  if (/待审批|待审核/.test(status)) return 'warning';
  if (/借出|出库/.test(status)) return 'plum';
  if (/归还/.test(status)) return 'success';
  return 'neutral';
}
function renderMaterialsBoard(data) {
  const target = $('#materials-board');
  if (!target) return;
  const lowStock = data.lowStock.slice(0, 6).map((item) => '<tr><td><b>' + escapeHtml(item.name) + '</b><small class="code-text">' + escapeHtml(item.code) + '</small></td><td>' + escapeHtml(item.cabinet + ' · ' + item.level) + '</td><td><b class="risk-number">' + item.quantity + '</b> / 阈值 ' + item.threshold + ' ' + escapeHtml(item.unit) + '</td><td><button class="text-action" data-qr="' + escapeHtml(item.id) + '">二维码</button></td></tr>').join('') || '<tr><td colspan="4" class="muted-cell">暂无低库存预警</td></tr>';
  const differences = data.inventory.filter((item) => item.difference !== 0).slice(0, 8).map((item) => {
    const route = item.destinations?.map((destination) => destination.applicant + ' · ' + destination.purpose).join('；') || item.sourceStatuses?.join('、') || '尚未关联逐笔流转记录';
    return '<tr><td><b>' + escapeHtml(item.name) + '</b><small class="code-text">' + escapeHtml(item.code) + '</small></td><td>' + item.initial + ' → ' + item.quantity + '</td><td><b class="risk-number">' + (item.difference > 0 ? '-' : '+') + Math.abs(item.difference) + '</b> ' + escapeHtml(item.unit) + '</td><td>' + escapeHtml(route) + '</td></tr>';
  }).join('') || '<tr><td colspan="4" class="muted-cell">理论数量与当前数量一致。</td></tr>';
  const requests = data.applications.slice(0, 8).map((item) => '<tr><td><b>' + escapeHtml(item.applicant) + '</b><small class="code-text">' + escapeHtml(item.code) + '</small></td><td>' + escapeHtml(item.items) + '</td><td>' + escapeHtml(item.plannedReturnDate || '未填写') + '</td><td>' + (item.returnStatus.includes('物品缺失') ? '<span class="status-pill danger">归还异常</span>' : item.overdueDays ? '<span class="status-pill danger">逾期 ' + item.overdueDays + ' 天</span>' : '<span class="status-pill ' + materialStatus(item.status) + '">' + escapeHtml(item.status) + '</span>') + '</td><td>' + (item.status.includes('待审批') ? '<button class="text-action" data-approve="' + escapeHtml(item.id) + '">通过</button><button class="text-action danger" data-reject="' + escapeHtml(item.id) + '">拒绝</button>' : item.approval === '审批通过' && !item.status.includes('借出') && !item.returned ? '<button class="text-action" data-checkout="' + escapeHtml(item.id) + '">登记出库</button>' : item.status.includes('借出') ? '<button class="text-action" data-return-request="' + escapeHtml(item.id) + '">登记归还</button>' : '—') + '</td></tr>').join('') || '<tr><td colspan="5" class="muted-cell">暂无借用记录</td></tr>';
  const overdue = data.overdue.slice(0, 4).map((item) => '<div class="attention-row"><span class="attention-icon">!</span><div><b>' + escapeHtml(item.items) + '</b><small>' + escapeHtml(item.applicant) + ' · 应于 ' + escapeHtml(item.plannedReturnDate || '未知日期') + ' 归还</small></div><strong>逾期 ' + item.overdueDays + ' 天</strong></div>').join('') || '<div class="attention-empty">当前没有逾期未归还的借用单。</div>';
  const recentFlows = (data.recentFlows || []).map((flow) => '<tr><td><span class="status-pill ' + (flow.operation === '入库' || flow.operation === '归还' ? 'success' : flow.operation === '出库' || flow.operation === '报损' ? 'danger' : 'neutral') + '">' + escapeHtml(flow.operation) + '</span></td><td><b>' + escapeHtml(flow.material) + '</b><small class="code-text">' + escapeHtml(flow.assetCode) + '</small></td><td>' + flow.quantity + '</td><td>' + flow.before + ' → ' + flow.after + '</td><td>' + escapeHtml(flow.destination || flow.operator) + '<small class="code-text">' + escapeHtml(flow.date || '未记录') + '</small></td></tr>').join('') || '<tr><td colspan="5" class="muted-cell">暂无出入库流水。首次真实操作后会显示在这里。</td></tr>';
  target.innerHTML = '<section class="metric-grid material-metrics">'
    + materialMetric('物资种类', data.stats.categoryCount, '按库存配置记录统计')
    + materialMetric('理论总量', data.stats.totalInitialQuantity, '初始库存合计')
    + materialMetric('当前可用', data.stats.totalCurrentQuantity, '现有数量 + 新流水')
    + materialMetric('库存差额', data.stats.totalDifference, data.stats.totalUntrackedDifference ? '仍有未关联去向' : '已纳入现有台账', data.stats.totalUntrackedDifference ? 'risk' : '')
    + materialMetric('待审批申请', data.stats.pendingCount, '需要管理员处理', data.stats.pendingCount ? 'warning' : '')
    + materialMetric('借出中', data.stats.borrowedCount, '尚未完成归还')
    + materialMetric('逾期提醒', data.stats.overdueCount, '按拟归还日期计算', data.stats.overdueCount ? 'risk' : '')
    + materialMetric('归还异常', data.stats.abnormalReturnCount, '缺失或损耗待核对', data.stats.abnormalReturnCount ? 'risk' : '')
    + materialMetric('库存预警', data.stats.lowStockCount, '建议阈值以下', data.stats.lowStockCount ? 'risk' : '') + '</section>'
    + '<section class="materials-grid"><article class="panel"><header class="panel-header"><div><h2>借用与归还队列</h2><p>状态来自“物资管理”表；申请人已脱敏展示。</p></div><button class="button ghost" id="refresh-materials" type="button">刷新</button></header><div class="table-scroll"><table class="data-table material-table"><thead><tr><th>申请人</th><th>物资</th><th>拟归还</th><th>当前状态</th><th>操作</th></tr></thead><tbody>' + requests + '</tbody></table></div></article>'
    + '<aside class="panel"><header class="panel-header"><div><h2>逾期关注</h2><p>先提醒，再由管理员确认归还情况。</p></div><span class="status-pill danger">' + data.stats.overdueCount + ' 项</span></header><div class="attention-list">' + overdue + '</div></aside></section>'
    + '<section class="materials-grid"><article class="panel"><header class="panel-header"><div><h2>库存阈值预警</h2><p>' + escapeHtml(data.policy.thresholdRule) + '，为平台建议值，不会改写 SeaTable。</p></div><span class="status-pill ' + (data.stats.lowStockCount ? 'danger' : 'success') + '">' + data.stats.lowStockCount + ' 项</span></header><div class="table-scroll"><table class="data-table material-table"><thead><tr><th>物资</th><th>位置</th><th>现有 / 阈值</th><th>标签</th></tr></thead><tbody>' + lowStock + '</tbody></table></div></article>'
    + '<aside class="panel qr-guide"><div class="setting-icon">⌁</div><h3>二维码资产管理</h3><p>每项库存可生成一个不含个人信息的资产码。扫码后仅在已登录会话内定位物资与库存位置。</p><ol><li>打印并贴在柜体或物资标签上</li><li>管理员扫码定位资产</li><li>在专用流程中登记出库或归还</li></ol><button class="button secondary" id="open-qr-scan" type="button">打开扫码器</button></aside></section>'
    + '<section class="materials-grid"><article class="panel"><header class="panel-header"><div><h2>理论数量与差额去向</h2><p>优先显示初始数量与当前数量不一致的物资；新流水会关联申请人和借用用途。</p></div></header><div class="table-scroll"><table class="data-table material-table"><thead><tr><th>物资</th><th>理论 → 当前</th><th>差额</th><th>已知去向</th></tr></thead><tbody>' + differences + '</tbody></table></div></article><aside class="panel qr-guide"><div class="setting-icon">↗</div><h3>差额追踪规则</h3><p>历史库存差额来自“工位物资表”；新的出库、归还、报损和盘点变化来自“物资流水表”。没有申请单绑定的历史差额会明确标记为待核对。</p></aside></section>'
    + '<section class="panel recent-flows"><header class="panel-header"><div><h2>最近物资流水</h2><p>用于确认刚刚发生的入库、出库、归还和盘点变化。</p></div><span class="status-pill neutral">累计 ' + (data.stats.flowCount || 0) + ' 条</span></header><div class="table-scroll"><table class="data-table material-table"><thead><tr><th>操作</th><th>物资</th><th>数量</th><th>库存变化</th><th>去向 / 操作人</th></tr></thead><tbody>' + recentFlows + '</tbody></table></div></section>';
}
async function hydrateMaterials(force = false) {
  const target = $('#materials-board');
  if (!target) return;
  try { state.materials = await request('/api/materials/overview' + (force ? '?refresh=1' : '')); renderMaterialsBoard(state.materials); }
  catch (error) { target.innerHTML = '<section class="panel"><div class="empty-state"><strong>无法读取物资运营数据</strong>' + escapeHtml(error.message) + '</div></section>'; }
}
function showMaterialModal(html) {
  const modal = document.createElement('section');
  modal.className = 'drawer-backdrop material-modal';
  modal.innerHTML = '<aside class="record-drawer" role="dialog" aria-modal="true"><button class="close-drawer" type="button" data-close-material-modal aria-label="关闭">×</button>' + html + '</aside>';
  document.body.append(modal);
  modal.addEventListener('click', (event) => { if (event.target === modal || event.target.closest('[data-close-material-modal]')) { stopQrCamera(); modal.remove(); } });
  return modal;
}
function openQrLabel(id) {
  const item = state.materials?.inventory.find((entry) => entry.id === id);
  if (!item) return;
  showMaterialModal('<p class="overline">INVENTORY QR LABEL</p><h2>' + escapeHtml(item.name) + '</h2><p class="drawer-copy">资产码不包含个人信息。请将标签贴在对应物资或柜体位置。</p><div class="qr-label"><img src="/api/materials/inventory/' + encodeURIComponent(id) + '/qr" alt="' + escapeHtml(item.code) + ' 二维码" /><b>' + escapeHtml(item.code) + '</b><small>' + escapeHtml(item.cabinet + ' · ' + item.level + ' · ' + item.center) + '</small></div><footer><button class="button secondary" data-close-material-modal type="button">关闭</button></footer>');
}
let qrStream;
function stopQrCamera() { if (qrStream) { qrStream.getTracks().forEach((track) => track.stop()); qrStream = null; } }
async function scanMaterialCode(code) {
  const result = $('#scan-result');
  try { const data = await request('/api/materials/scan?code=' + encodeURIComponent(code)); result.innerHTML = '<div class="scan-success"><b>已定位：' + escapeHtml(data.item.name) + '</b><span>' + escapeHtml(data.item.code) + ' · ' + escapeHtml(data.item.cabinet + ' / ' + data.item.level) + ' · 现有 ' + data.item.quantity + ' ' + data.item.unit + '</span></div>'; stopQrCamera(); }
  catch (error) { result.innerHTML = '<div class="login-error">' + escapeHtml(error.message) + '</div>'; }
}
async function startQrCamera() {
  const video = $('#qr-video'); const result = $('#scan-result');
  if (!window.BarcodeDetector) { result.textContent = '当前浏览器不支持原生二维码识别。可用 Chrome 打开，或使用扫码枪把资产码输入下方。'; return; }
  try {
    qrStream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' } });
    video.srcObject = qrStream; await video.play();
    const detector = new BarcodeDetector({ formats: ['qr_code'] });
    const detect = async () => { if (!qrStream) return; try { const codes = await detector.detect(video); if (codes[0]?.rawValue) return scanMaterialCode(codes[0].rawValue); } catch { /* Camera may still be warming up. */ } window.setTimeout(detect, 240); };
    detect();
  } catch (error) { result.textContent = '无法打开摄像头：' + error.message; }
}
function openQrScanner() {
  showMaterialModal('<p class="overline">SECURE QR SCAN</p><h2>扫码定位物资</h2><p class="drawer-copy">扫码结果仅在当前已登录管理员会话中查询，不会上传画面或将个人信息写入二维码。</p><video id="qr-video" class="qr-video" muted playsinline></video><div id="scan-result" class="scan-result">点击“启用摄像头”开始扫码；也可以使用扫码枪输入资产码。</div><div class="scan-manual"><input id="manual-asset-code" placeholder="例如 NJU-RC-库存行ID" /><button class="button secondary" id="manual-scan" type="button">查询</button></div><footer><button class="button secondary" data-close-material-modal type="button">关闭</button><button class="button primary" id="start-qr-camera" type="button">启用摄像头</button></footer>');
}
function openMaterialRequest() {
  showMaterialModal('<p class="overline">MATERIAL REQUEST</p><h2>新建借用申请</h2><p class="drawer-copy">提交后会在 SeaTable“物资管理”表中创建一条待审批申请。</p><form id="material-request-form" class="business-form"><label>姓名<input name="name" required /></label><label>学号<input name="studentId" required /></label><label>邮箱<input name="email" type="email" required /></label><label>借用用途<input name="purpose" required /></label><label>物资名称及数量<textarea name="items" required></textarea></label><label>借用件数<input name="quantity" type="number" min="1" value="1" required /></label><label>拟借用日期<input name="plannedBorrowDate" type="date" required /></label><label>拟归还日期<input name="plannedReturnDate" type="date" required /></label><p class="login-error" id="request-error"></p><footer><button class="button secondary" data-close-material-modal type="button">取消</button><button class="button primary" type="submit">提交待审批申请</button></footer></form>');
}
async function submitMaterialRequest(form) {
  if (!window.confirm('确认提交？该操作会在 SeaTable 中创建一条“待审批”借用申请。')) return;
  const button = form.querySelector('[type="submit"]'); const error = $('#request-error', form); button.disabled = true; error.textContent = '';
  try { await request('/api/materials/applications', { method: 'POST', body: JSON.stringify(Object.fromEntries(new FormData(form))) }); form.closest('.material-modal').remove(); state.materials = null; hydrateMaterials(true); }
  catch (err) { error.textContent = err.message; }
  finally { button.disabled = false; }
}
function openStockOperation(operation = '入库', applicationId = '') {
  const options = (state.materials?.inventory || []).map((item) => '<option value="' + escapeHtml(item.code) + '">' + escapeHtml(item.name + ' · ' + item.cabinet + ' · 现有 ' + item.quantity + ' ' + item.unit) + '</option>').join('');
  const title = operation === '入库' ? '登记入库' : operation === '出库' ? '登记出库' : '登记归还';
  const copy = operation === '入库' ? '采购、补充或盘点后新增的物资，登记后会增加可用库存。' : operation === '出库' ? '出库前请核对实物、数量和申请单；提交后会写入库存流水。' : '归还前请核对实物数量与状态；数量差异应在备注中说明。';
  const photoField = operation === '出库' ? '<label class="full-field">借出现场照片<input name="photo" type="file" accept="image/jpeg,image/png,image/webp" capture="environment" required /></label>' : operation === '归还' ? '<label class="full-field">归还照片（可选）<input name="photo" type="file" accept="image/jpeg,image/png,image/webp" capture="environment" /></label>' : '';
  showMaterialModal('<p class="overline">INVENTORY TRANSACTION</p><h2>' + title + '</h2><p class="drawer-copy">' + copy + '</p><form id="transaction-form" class="business-form"><input type="hidden" name="operation" value="' + operation + '" /><input type="hidden" name="applicationId" value="' + escapeHtml(applicationId) + '" /><label class="full-field">选择物资<select name="assetCode" required><option value="">请选择或先扫码定位</option>' + options + '</select></label><label>数量<input name="quantity" type="number" min="1" step="1" value="1" required /></label><label>备注<textarea name="note" placeholder="例如：采购批次、归还缺失、盘点说明"></textarea></label>' + photoField + '<div class="interaction-checklist"><b>提交前确认</b><span>✓ 物资和位置已核对</span><span>✓ 数量与实物一致</span>' + (operation === '出库' ? '<span>✓ 借出照片已选择</span>' : '') + '<span>✓ 操作将写入物资流水表</span></div><p class="login-error" id="transaction-error"></p><footer><button class="button secondary" data-close-material-modal type="button">取消</button><button class="button primary" type="submit">预览并确认</button></footer></form>');
}
async function submitTransaction(form) {
  const values = Object.fromEntries(new FormData(form));
  const item = state.materials?.inventory.find((entry) => entry.code === values.assetCode);
  const error = $('#transaction-error', form);
  if (!item) { error.textContent = '请先选择物资。'; return; }
  const quantity = Number(values.quantity);
  const delta = ['入库', '归还'].includes(values.operation) ? quantity : -quantity;
  const after = item.quantity + delta;
  if (after < 0) { error.textContent = '库存不足：当前可用数量为 ' + item.quantity + '。'; return; }
  const confirmText = values.operation + '确认\n\n物资：' + item.name + '\n位置：' + item.cabinet + ' · ' + item.level + '\n数量：' + quantity + ' ' + item.unit + '\n库存变化：' + item.quantity + ' → ' + after + '\n\n确认写入物资流水表吗？';
  if (!window.confirm(confirmText)) return;
  const button = form.querySelector('[type="submit"]'); button.disabled = true; error.textContent = '';
  try {
    const endpoint = values.applicationId ? '/api/materials/applications/' + encodeURIComponent(values.applicationId) + '/' + (values.operation === '归还' ? 'return' : 'checkout') : '/api/materials/transactions';
    const payload = new FormData(form);
    payload.set('quantity', String(quantity));
    payload.set('idempotencyKey', crypto.randomUUID());
    const hasPhoto = values.photo instanceof File && values.photo.size > 0;
    await request(endpoint, { method: 'POST', body: values.applicationId || hasPhoto ? payload : JSON.stringify({ ...values, quantity, idempotencyKey: payload.get('idempotencyKey') }) });
    form.closest('.material-modal').remove(); await hydrateMaterials(true);
  }
  catch (err) { error.textContent = err.message; }
  finally { button.disabled = false; }
}
async function reviewApplication(id, approved) {
  let reason = '';
  if (!approved) { reason = window.prompt('请输入不通过理由：') || ''; if (!reason.trim()) return; }
  if (!window.confirm(approved ? '确认通过这条借用申请吗？' : '确认拒绝这条借用申请吗？')) return;
  try { await request('/api/materials/applications/' + encodeURIComponent(id) + '/' + (approved ? 'approve' : 'reject'), { method: 'POST', body: JSON.stringify({ reason }) }); await hydrateMaterials(true); }
  catch (error) { window.alert('审批失败：' + error.message); }
}
function renderModule(view) {
  state.table = getTable(tableMap[view]) ? tableMap[view] : defaultTable();
  const page = pages[view];
  content.innerHTML = head()
    + '<section class="module-hero"><p class="overline">' + page[1] + '</p><h1>' + page[2] + '</h1><p>' + moduleIntro(view) + '</p><button class="button" type="button" data-view="tables">打开表格中心 →</button></section>'
    + '<section class="module-grid"><article class="panel" id="data-panel">' + dataPanel(true) + '</article><aside class="panel"><header class="panel-header"><div><h2>模块说明</h2><p>当前开发状态</p></div></header><div class="panel-body"><div class="schema-list">'
    + '<div class="schema-row"><div><b>数据来源</b><small>' + escapeHtml(state.table) + '</small></div><span class="type-chip">SEATABLE</span></div>'
    + '<div class="schema-row"><div><b>读取方式</b><small>实时 API 请求</small></div><span class="type-chip">LIVE</span></div>'
    + '<div class="schema-row"><div><b>写入保护</b><small>默认关闭编辑能力</small></div><span class="type-chip">SAFE</span></div>'
    + '</div><div class="info-callout"><span>!</span><div><b>下一步建议</b><br>将通用表格操作替换为字段校验、审批流与角色权限，避免直接修改业务数据。</div></div></div></aside></section>';
  hydrateTable();
}
function dataPanel(compact = false) {
  const table = getTable(state.table);
  const tableOptions = state.tables.map((item) => '<option value="' + escapeHtml(item.name) + '"' + (item.name === state.table ? ' selected' : '') + '>' + escapeHtml(item.name) + '</option>').join('');
  return '<header class="panel-header"><div><h2>' + escapeHtml(table?.name || '选择数据表') + '</h2><p>' + (compact ? '业务模块数据预览' : '当前 Base 中的原始表格数据与字段结构') + '</p></div><span class="status-pill neutral">' + (table?.columns.length || 0) + ' 个字段</span></header>'
    + '<div class="data-toolbar"><div class="table-tools"><select class="select-control" id="table-select">' + tableOptions + '</select><input class="search-field" id="table-filter" value="' + escapeHtml(state.filter) + '" placeholder="筛选当前已加载行" /></div>'
    + '<div class="table-tools"><label class="write-lock"><input id="write-unlock" type="checkbox"' + (state.write ? ' checked' : '') + '/> 启用管理员写入</label><button class="button secondary" id="refresh-table" type="button">刷新</button><button class="button primary" id="add-record" type="button"' + (state.write ? '' : ' disabled') + '>新增记录</button></div></div>'
    + '<div class="table-scroll" id="table-content"><div class="empty-state"><strong>正在读取表格数据</strong>从 SeaTable 加载最新记录…</div></div>';
}
function renderData(rows) {
  const target = $('#table-content');
  const table = getTable(state.table);
  if (!target || !table) return;
  const filter = state.filter.trim().toLowerCase();
  const displayed = filter ? rows.filter((row) => Object.values(row).some((value) => display(value).toLowerCase().includes(filter))) : rows;
  if (!displayed.length) {
    target.innerHTML = '<div class="empty-state"><strong>' + (rows.length ? '没有匹配记录' : '当前表暂无记录') + '</strong>' + (rows.length ? '调整筛选条件后重试。' : '可由具备权限的管理员新增数据。') + '</div>';
    return;
  }
  const columns = table.columns.slice(0, 8);
  const header = columns.map((column) => '<th>' + escapeHtml(column.name) + '</th>').join('');
  const body = displayed.slice(0, 100).map((row) => {
    const cells = columns.map((column) => {
      const value = masked(row[column.name] ?? row[column.key], column.name);
      const status = column.name === '状态' || /状态|审批|是否/.test(column.name);
      return '<td title="' + escapeHtml(value) + '">' + (status ? '<span class="status-pill ' + (value === '—' ? 'neutral' : '') + '">' + escapeHtml(value) + '</span>' : '<span class="' + (sensitive(column.name) ? 'sensitive' : '') + '">' + escapeHtml(value) + '</span>') + '</td>';
    }).join('');
    const actions = state.write ? '<td><div class="row-actions"><button class="text-action" data-edit="' + escapeHtml(row._id) + '">编辑</button><button class="text-action danger" data-delete="' + escapeHtml(row._id) + '">删除</button></div></td>' : '';
    return '<tr>' + cells + actions + '</tr>';
  }).join('');
  target.innerHTML = '<table class="data-table"><thead><tr>' + header + (state.write ? '<th>操作</th>' : '') + '</tr></thead><tbody>' + body + '</tbody></table>';
}
async function hydrateTable(force = false) {
  const target = $('#table-content');
  if (!target || !state.table) return;
  try { renderData(await rowsFor(state.table, force)); }
  catch (error) { target.innerHTML = '<div class="empty-state"><strong>无法读取数据</strong>' + escapeHtml(error.message) + '</div>'; }
}
function renderTables() {
  state.table = defaultTable();
  content.innerHTML = head() + '<section class="panel" id="data-panel">' + dataPanel() + '</section>'
    + '<section class="settings-grid" style="margin-top:18px"><article class="panel setting-card"><div class="setting-icon">⌁</div><h3>业务模式优先</h3><p>物资、成员和活动会逐步使用专用页面；这里保留管理员的通用数据能力。</p><button class="button ghost" type="button" data-view="materials">前往物资中心 →</button></article><article class="panel setting-card"><div class="setting-icon">◌</div><h3>安全写入边界</h3><p>写操作需要登录、管理员角色、本地显式解锁与 CSRF 校验；正式上线前还应补全校方 SSO 与操作审计。</p><button class="button ghost" type="button" data-view="settings">查看安全说明 →</button></article></section>';
  hydrateTable();
}
function renderSettings() {
  content.innerHTML = head()
    + '<section class="settings-grid"><article class="panel setting-card"><div class="setting-icon">◉</div><h3>SeaTable 连接</h3><p>当前实例通过服务端 API Token 授权。浏览器只访问平台自己的 API 路由，不会取得 Token。</p><span class="status-pill">已连接 ' + state.tables.length + ' 张表</span></article>'
    + '<article class="panel setting-card"><div class="setting-icon">♜</div><h3>角色与权限</h3><p>当前已启用本地管理员登录、受保护会话与 CSRF 写入校验。后续应接入南大统一身份认证、角色白名单、字段级脱敏和操作审计。</p><span class="status-pill neutral">LOCAL ADMIN</span></article>'
    + '<article class="panel setting-card"><div class="setting-icon">⌘</div><h3>数据操作边界</h3><p>通用表格写入需要手动解锁。物资审批、成员维护等正式业务应使用专用流程，而非直接 CRUD。</p><button class="button ghost" data-view="tables" type="button">前往表格中心 →</button></article>'
    + '<article class="panel setting-card"><div class="setting-icon">⌁</div><h3>开发路线</h3><p>下一阶段优先实现物资申请表单、审批状态流转、库存预警与统一身份认证接入。</p><span class="status-pill neutral">ROADMAP</span></article></section>';
}
function render() {
  updateChrome();
  if (state.view === 'overview') renderOverview();
  else if (state.view === 'materials') renderMaterials();
  else if (state.view === 'tables') renderTables();
  else if (state.view === 'settings') renderSettings();
  else renderModule(state.view);
}
function openDrawer(mode, rowId) {
  const row = rowId ? (state.rows.get(state.table) || []).find((item) => item._id === rowId) : {};
  const source = Object.fromEntries(Object.entries(row || {}).filter(([key]) => !key.startsWith('_')));
  const fragment = $('#record-drawer-template').content.cloneNode(true);
  const backdrop = fragment.querySelector('.drawer-backdrop');
  const title = fragment.querySelector('#drawer-title');
  const area = fragment.querySelector('#record-json');
  const submit = fragment.querySelector('#submit-record');
  title.textContent = mode === 'edit' ? '编辑记录' : '新增记录';
  area.value = JSON.stringify(source, null, 2);
  submit.textContent = mode === 'edit' ? '保存修改' : '确认新增';
  document.body.append(backdrop);
  const close = () => backdrop.remove();
  backdrop.querySelectorAll('.close-drawer').forEach((button) => button.addEventListener('click', close));
  backdrop.addEventListener('click', (event) => { if (event.target === backdrop) close(); });
  submit.addEventListener('click', async () => {
    let data;
    try { data = JSON.parse(area.value); } catch { window.alert('JSON 格式不正确，请检查字段和值。'); return; }
    if (!data || typeof data !== 'object' || Array.isArray(data)) { window.alert('记录必须是一个 JSON 对象。'); return; }
    submit.disabled = true;
    try {
      const endpoint = mode === 'edit' ? '/api/rows/' + encodeURIComponent(rowId) : '/api/rows';
      await request(endpoint, { method: mode === 'edit' ? 'PUT' : 'POST', body: JSON.stringify({ table: state.table, row: data }) });
      state.rows.delete(state.table);
      close();
      hydrateTable(true);
    } catch (error) { window.alert('写入失败：' + error.message); }
    finally { submit.disabled = false; }
  });
}
async function deleteRow(rowId) {
  if (!window.confirm('确认删除该行吗？此操作会直接写入 SeaTable，且无法从本平台恢复。')) return;
  try {
    await request('/api/rows/' + encodeURIComponent(rowId) + '?table=' + encodeURIComponent(state.table), { method: 'DELETE' });
    state.rows.delete(state.table);
    hydrateTable(true);
  } catch (error) { window.alert('删除失败：' + error.message); }
}
function changeView(view) {
  if (!pages[view]) return;
  state.view = view;
  state.filter = '';
  $('#sidebar').classList.remove('open');
  render();
}
function bind() {
  document.addEventListener('click', (event) => {
    if (event.target.closest('#logout-button')) { logout(); return; }
    if (event.target.closest('#refresh-materials')) { hydrateMaterials(true); return; }
    if (event.target.closest('#open-qr-scan')) { openQrScanner(); return; }
    if (event.target.closest('#open-material-request')) { openMaterialRequest(); return; }
    if (event.target.closest('#open-stock-in')) { openStockOperation('入库'); return; }
    if (event.target.closest('#open-stock-out')) { openStockOperation('出库'); return; }
    if (event.target.closest('#start-qr-camera')) { startQrCamera(); return; }
    if (event.target.closest('#manual-scan')) { scanMaterialCode($('#manual-asset-code')?.value || ''); return; }
    const qr = event.target.closest('[data-qr]');
    if (qr) { openQrLabel(qr.dataset.qr); return; }
    const approve = event.target.closest('[data-approve]');
    if (approve) { reviewApplication(approve.dataset.approve, true); return; }
    const reject = event.target.closest('[data-reject]');
    if (reject) { reviewApplication(reject.dataset.reject, false); return; }
    const checkout = event.target.closest('[data-checkout]');
    if (checkout) { openStockOperation('出库', checkout.dataset.checkout); return; }
    const returnRequest = event.target.closest('[data-return-request]');
    if (returnRequest) { openStockOperation('归还', returnRequest.dataset.returnRequest); return; }
    const view = event.target.closest('[data-view]');
    if (view) { changeView(view.dataset.view); return; }
    if (event.target.closest('#refresh-table')) { hydrateTable(true); return; }
    if (event.target.closest('#add-record')) { openDrawer('create'); return; }
    const edit = event.target.closest('[data-edit]');
    if (edit) { openDrawer('edit', edit.dataset.edit); return; }
    const remove = event.target.closest('[data-delete]');
    if (remove) deleteRow(remove.dataset.delete);
  });
  document.addEventListener('submit', (event) => {
    if (event.target.matches('#login-form')) { event.preventDefault(); login(event.target); }
    if (event.target.matches('#material-request-form')) { event.preventDefault(); submitMaterialRequest(event.target); }
    if (event.target.matches('#transaction-form')) { event.preventDefault(); submitTransaction(event.target); }
  });
  document.addEventListener('change', (event) => {
    if (event.target.matches('#table-select')) {
      state.table = event.target.value; state.filter = '';
      const panel = $('#data-panel'); panel.innerHTML = dataPanel(state.view !== 'tables'); hydrateTable();
    }
    if (event.target.matches('#write-unlock')) {
      state.write = event.target.checked;
      const panel = $('#data-panel'); panel.innerHTML = dataPanel(state.view !== 'tables'); hydrateTable();
    }
  });
  document.addEventListener('input', (event) => {
    if (event.target.matches('#table-filter')) { state.filter = event.target.value; renderData(state.rows.get(state.table) || []); }
  });
  $('#mobile-menu').addEventListener('click', () => $('#sidebar').classList.toggle('open'));
}
async function loadPlatform() {
  try {
    const health = await request('/api/health');
    state.tables = health.tables || [];
    state.table = getTable(tableMap.materials) ? tableMap.materials : (health.configuredTable || state.tables[0]?.name || '');
    state.syncedAt = new Intl.DateTimeFormat('zh-CN', { hour: '2-digit', minute: '2-digit', hour12: false }).format(new Date());
    setConnection(true);
    render();
  } catch (error) {
    setConnection(false, error.message);
    content.innerHTML = '<section class="page-head"><div><p class="overline">CONNECTION REQUIRED</p><h1>无法连接数据服务</h1><p>请检查本地服务、.env 中的 SeaTable 配置，以及网络连接。</p></div></section><section class="panel"><div class="empty-state"><strong>连接错误</strong>' + escapeHtml(error.message) + '</div></section>';
  }
}
async function boot() {
  bind();
  try {
    const session = await request('/api/auth/session');
    if (!session.authenticated) return showLogin();
    applySession(session);
    await loadPlatform();
  } catch (error) { showLogin('无法确认登录状态：' + error.message); }
}
boot();
