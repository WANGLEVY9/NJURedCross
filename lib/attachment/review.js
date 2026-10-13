/**
 * 宣传审核工作流（v3 第 6/7 项，§4.1）—— 多级审核状态机的服务端编排。
 *
 * 设计要点：
 *   · **一个抽象 + 一份代码**：文字稿件（2 级）、文创设计（3 级）、小绿书（2 级，N3）
 *     共用同一条推进逻辑，差异全部由 store.js 的 REVIEW_CHAINS 驱动。
 *   · **按栏目选人**：审核人不由代码写死，从「宣传对接人表」按 推文类别 + 角色 查。
 *   · **仅可提一轮意见**：同一层级退回超过 1 次即拒（409 review_opinion_round_exceeded）。
 *   · **清单必填**：通过（approve）时必须逐项确认全部启用检查项（勾 = 合格），
 *     缺项即拒（400 review_checklist_incomplete）；退回时不强制，但勾选结果同样落轨迹。
 *   · **意见回传模板**：21 项检查清单数字化（审核清单模板表）+ 修改意见表，
 *     可一键生成 Word（零依赖手写最小 OOXML）。
 *   · **双投递**：意见稿同时推「上一级对接人」与「美编工作者」；未指派美编只推对接人。
 *
 * ctx 注入契约（与 lib/attachment/api.js 同构）：
 *   json / readJson / getBase / recordAudit / enforceLimit /
 *   requireConsoleAccess / tables{ submission, liaison, checklist, task } /
 *   mail(可选) / config
 */

import {
  LIAISON_ROLES,
  REVIEW_STATUS,
  appendReviewTrail,
  canReturnAtLevel,
  checklistGaps,
  finalReviewLevel,
  parseReviewTrail,
  reviewChainFor,
  reviewProgressFor,
  submissionKindFor,
} from './store.js';

/** 意见稿 Word 的固定文案（与制度 8.8 表 3 一致）。 */
export const OPINION_DOC_TITLE = '南大红会 宣传稿件审核意见单';

/**
 * 依据投稿（含 category / publishForm）解析审核链与当前进度。
 * 返回 { kind, chain, passed, current, done, total, status }。
 */
export function chainStateFor(submission) {
  const kind = submissionKindFor({
    category: submission?.category || '',
    publishForm: submission?.publishForm || '',
  });
  const trail = parseReviewTrail(submission?.reviewTrail);
  const status = String(submission?.status || REVIEW_STATUS.pending);
  // 已通过条数决定进度；被退回时停在原级（不推进）。
  const passed = trail.filter((entry) => entry.decision === 'approve').length;
  const progress = reviewProgressFor(kind, passed);
  return {
    kind,
    chain: progress.chain,
    passed: progress.passed,
    total: progress.total,
    current: progress.current,
    done: progress.done,
    status,
    trail,
  };
}

/**
 * 按栏目 + 角色从「宣传对接人表」选人。
 * 匹配规则：负责栏目包含该栏目（支持「全部」通配）；未命中时返回空串。
 *
 * 入参容错：既可传 SeaTable 原始行（中文列名），也可传服务端映射后的对象
 * （id/name/category/role/enabled）——两者都读，避免调用方换形状后静默选不到人。
 */
export function pickAssignee(rows, category, role) {
  const wanted = String(category || '').trim();
  const roleName = LIAISON_ROLES[role] || role;
  const field = (row, zh, en) => String(row?.[zh] ?? row?.[en] ?? '');
  const candidates = (rows || []).filter((row) => {
    if (String(row?.['启用'] ?? (row?.enabled === false ? '否' : '是')) === '否') return false;
    if (field(row, '角色', 'role') !== roleName) return false;
    const scopes = field(row, '负责栏目', 'category').split(/[，,、/]/).map((item) => item.trim()).filter(Boolean);
    return scopes.includes('全部') || (wanted && scopes.includes(wanted));
  });
  const hit = candidates[0];
  if (!hit) return { name: '', email: '', id: '' };
  return {
    id: field(hit, '对接人ID', 'id'),
    name: field(hit, '姓名', 'name'),
    email: field(hit, '邮箱', 'email'),
  };
}

/** 选定某层级的审核人（含兜底：同栏目对接人 → 空）。 */
export function assigneesForCategory(rows, category) {
  return {
    liaison: pickAssignee(rows, category, 'liaison'),
    reviewer: pickAssignee(rows, category, 'reviewer'),
  };
}

/**
 * 推进一级审核。
 * @param {object} submission 审核状态机形状（见 server.js reviewShapeOf）
 * @param {{decision:'approve'|'return', note?:string, reviewer?:string, role?:string,
 *          at?:string, checklist?:Array, requiredChecklist?:Array}} input
 *   checklist        本次勾选的检查项模板ID（勾 = 该项已确认合格）
 *   requiredChecklist 全部启用检查项的模板ID；通过时要求 checklist 全覆盖
 * @returns {{ok:false, code:string, message:string, status:number}} 或
 *          {{ok:true, patch:object, entry:object, next:object|null, done:boolean}}
 */
export function advanceReview(submission, { decision, note = '', reviewer = '', at = new Date().toISOString(), checklist = [], requiredChecklist = [] }) {
  const state = chainStateFor(submission);
  if (state.done && state.status === REVIEW_STATUS.approved) {
    return { ok: false, status: 409, code: 'review_already_final', message: '该稿件已完成全部审核，无需再次审核。' };
  }
  const level = state.current;
  if (!level) {
    return { ok: false, status: 409, code: 'review_already_final', message: '审核链已走完。' };
  }
  const checkedIds = (Array.isArray(checklist) ? checklist : [])
    .map((item) => (item && typeof item === 'object' ? (item.id ?? item['模板ID']) : item))
    .map((id) => String(id ?? ''))
    .filter(Boolean);
  if (decision === 'approve') {
    const gaps = checklistGaps(checkedIds, (requiredChecklist || []).map((id) => String(id)));
    if (!gaps.ok) {
      return {
        ok: false,
        status: 400,
        code: 'review_checklist_incomplete',
        missing: gaps.missing,
        message: `还有 ${gaps.missing.length} 项检查项未确认合格，请逐项打勾确认后再通过；如确有问题请改选「退回修改」。`,
      };
    }
  }
  if (decision === 'return') {
    const round = canReturnAtLevel(submission.reviewTrail, level.level);
    if (!round.allowed) {
      return {
        ok: false,
        status: 409,
        code: 'review_opinion_round_exceeded',
        message: `第 ${level.level} 级已提过一轮修改意见，按制度仅可提一轮，如需再次退回请联系管理员特批。`,
      };
    }
    if (!String(note || '').trim()) {
      return { ok: false, status: 400, code: 'review_note_required', message: '退回修改必须填写审核意见。' };
    }
  }

  const entry = {
    level: level.level,
    name: level.name,
    role: level.role,
    decision,
    note: String(note || '').trim(),
    reviewer: String(reviewer || ''),
    at,
    // 清单勾选结果随轨迹留存（JSON 列，无需加表字段）
    checklist: checkedIds,
  };
  const trail = appendReviewTrail(submission.reviewTrail, entry);
  const passedAfter = reviewProgressFor(state.kind, decision === 'approve' ? state.passed + 1 : state.passed);
  const status = decision === 'return'
    ? REVIEW_STATUS.returned
    : (passedAfter.done ? REVIEW_STATUS.approved : REVIEW_STATUS.pending);

  const patch = {
    审核状态: status,
    审核意见: entry.note,
    审核人: entry.reviewer,
    审核时间: at,
    审核层级: String(passedAfter.passed),
    审核轨迹: trail,
  };
  return { ok: true, patch, entry, next: passedAfter.current, done: passedAfter.done, kind: state.kind, status };
}

/* -------------------------------------------------------------------------- *
 * 意见回传模板 → Word（零依赖手写最小 OOXML）
 * -------------------------------------------------------------------------- */

/** XML 文本转义（含属性与文本两类安全字符）。 */
export function escapeXml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

/** 单个段落（可指定加粗/字号，单位半磅）。 */
function para(text, { bold = false, size = 22, spacing = 120 } = {}) {
  return `<w:p><w:pPr><w:spacing w:after="${spacing}"/></w:pPr><w:r><w:rPr>${bold ? '<w:b/>' : ''}<w:sz w:val="${size}"/><w:szCs w:val="${size}"/></w:rPr><w:t xml:space="preserve">${escapeXml(text)}</w:t></w:r></w:p>`;
}

/** 表格单元格（简单左对齐，宽度由 w:tcW 给出）。 */
function cell(text, { width = 2000, bold = false } = {}) {
  return `<w:tc><w:tcPr><w:tcW w:w="${width}" w:type="dxa"/></w:tcPr>${para(text, { bold, size: 20, spacing: 40 })}</w:tc>`;
}

function row(cells, widths) {
  return `<w:tr>${cells.map((text, index) => (typeof text === 'string' ? cell(text, { width: widths[index] }) : text)).join('')}</w:tr>`;
}

function table(rows, widths) {
  const grid = widths.map((width) => `<w:gridCol w:w="${width}"/>`).join('');
  const borders = ['top', 'left', 'bottom', 'right', 'insideH', 'insideV']
    .map((side) => `<w:${side} w:val="single" w:sz="4" w:space="0" w:color="A0A0A0"/>`)
    .join('');
  return `<w:tbl><w:tblPr><w:tblW w:w="${widths.reduce((a, b) => a + b, 0)}" w:type="dxa"/><w:tblBorders>${borders}</w:tblBorders></w:tblPr><w:tblGrid>${grid}</w:tblGrid>${rows.join('')}</w:tbl>`;
}

/**
 * 生成意见单 Word（.docx 字节）。
 * @param {{title?:string, submission?:object, checklist?:Array, opinions?:Array, meta?:object}} input
 * @returns {Buffer}
 */
export function buildOpinionDocx({ submission = {}, checklist = [], opinions = [], meta = {} } = {}) {
  const body = [];
  body.push(para(OPINION_DOC_TITLE, { bold: true, size: 32, spacing: 200 }));
  body.push(para(`生成时间：${meta.generatedAt || new Date().toISOString()}`, { size: 18, spacing: 200 }));

  // 表 1：稿件信息
  body.push(para('一、稿件信息', { bold: true, size: 24, spacing: 120 }));
  body.push(table([
    row(['稿件标题', submission.title || ''], [1800, 7800]),
    row(['推文类别', submission.articleCategory || submission.category || ''], [1800, 7800]),
    row(['文编人', submission.editor || submission.signature || submission.penName || ''], [1800, 7800]),
    row(['当前审核层级', String(submission.reviewLevelText || '')], [1800, 7800]),
  ], [1800, 7800]));
  body.push(para('', { size: 12, spacing: 100 }));

  // 表 2：21 项检查清单
  if (checklist.length) {
    body.push(para('二、审核检查清单', { bold: true, size: 24, spacing: 120 }));
    const header = row(['类别', '检查项', '标准', '初审', '复审', '备注'], [1200, 2200, 3400, 800, 800, 1200]);
    const rows = [header];
    for (const entry of checklist) {
      rows.push(row([
        entry.category || entry['类别'] || '',
        entry.item || entry['检查项'] || '',
        entry.standard || entry['标准'] || '',
        entry.firstPass === false ? '×' : (entry.firstPass ? '√' : ''),
        entry.secondPass === false ? '×' : (entry.secondPass ? '√' : ''),
        entry.note || entry['备注'] || '',
      ], [1200, 2200, 3400, 800, 800, 1200]));
    }
    body.push(table(rows, [1200, 2200, 3400, 800, 800, 1200]));
    body.push(para('', { size: 12, spacing: 100 }));
  }

  // 表 3：修改意见
  body.push(para('三、修改意见', { bold: true, size: 24, spacing: 120 }));
  const opinionHeader = row(['序号', '位置（截图）', '问题描述', '修改要求', '是否修改'], [700, 1800, 3400, 2900, 1000]);
  const opinionRows = [opinionHeader];
  const list = opinions.length ? opinions : [{}];
  list.forEach((item, index) => {
    opinionRows.push(row([
      String(index + 1),
      item.position || '',
      item.problem || '',
      item.requirement || '',
      item.fixed || '',
    ], [700, 1800, 3400, 2900, 1000]));
  });
  body.push(table(opinionRows, [700, 1800, 3400, 2900, 1000]));

  const document = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>${body.join('')}<w:sectPr><w:pgSz w:w="11906" w:h="16838"/><w:pgMar w:top="1134" w:right="1134" w:bottom="1134" w:left="1134"/></w:sectPr></w:body></w:document>`;

  return zipDocx(document);
}

/* -------------------------------------------------------------------------- *
 * 最小 ZIP 写入器（store 模式，不压缩）—— 零依赖生成 .docx
 * -------------------------------------------------------------------------- */

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n += 1) {
    let c = n;
    for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c >>> 0;
  }
  return table;
})();

function crc32(buffer) {
  let crc = 0xffffffff;
  for (const byte of buffer) crc = CRC_TABLE[(crc ^ byte) & 0xff] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

function zipDocx(documentXml) {
  const files = [
    { name: '[Content_Types].xml', data: Buffer.from('<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>', 'utf8') },
    { name: '_rels/.rels', data: Buffer.from('<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>', 'utf8') },
    { name: 'word/document.xml', data: Buffer.from(documentXml, 'utf8') },
  ];
  const locals = [];
  const centrals = [];
  let offset = 0;
  for (const file of files) {
    const nameBuf = Buffer.from(file.name, 'utf8');
    const crc = crc32(file.data);
    const local = Buffer.alloc(30 + nameBuf.length);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(0x0800, 6);
    local.writeUInt16LE(0, 8);
    local.writeUInt16LE(0, 10);
    local.writeUInt16LE(0, 12);
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(file.data.length, 18);
    local.writeUInt32LE(file.data.length, 22);
    local.writeUInt16LE(nameBuf.length, 26);
    local.writeUInt16LE(0, 28);
    nameBuf.copy(local, 30);
    locals.push(local, file.data);
    const central = Buffer.alloc(46 + nameBuf.length);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(20, 4);
    central.writeUInt16LE(20, 6);
    central.writeUInt16LE(0x0800, 8);
    central.writeUInt16LE(0, 10);
    central.writeUInt16LE(0, 12);
    central.writeUInt16LE(0, 14);
    central.writeUInt32LE(crc, 16);
    central.writeUInt32LE(file.data.length, 20);
    central.writeUInt32LE(file.data.length, 24);
    central.writeUInt16LE(nameBuf.length, 28);
    central.writeUInt16LE(0, 30);
    central.writeUInt16LE(0, 32);
    central.writeUInt16LE(0, 34);
    central.writeUInt16LE(0, 36);
    central.writeUInt32LE(0, 38);
    central.writeUInt32LE(offset, 42);
    nameBuf.copy(central, 46);
    centrals.push(central);
    offset += local.length + file.data.length;
  }
  const centralBuf = Buffer.concat(centrals);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(0, 4);
  end.writeUInt16LE(0, 6);
  end.writeUInt16LE(files.length, 8);
  end.writeUInt16LE(files.length, 10);
  end.writeUInt32LE(centralBuf.length, 12);
  end.writeUInt32LE(offset, 16);
  end.writeUInt16LE(0, 20);
  return Buffer.concat([...locals, centralBuf, end]);
}

/* -------------------------------------------------------------------------- *
 * 邮件投递（双投递）
 * -------------------------------------------------------------------------- */

/** 意见稿正文文案（纯文本）。 */
export function opinionMailText({ submission = {}, entry = {}, next = null, opinions = [] }) {
  const lines = [
    `《${submission.title || '未命名稿件'}》审核意见（第 ${entry.level} 级 · ${entry.name}）`,
    '',
    `结论：${entry.decision === 'approve' ? '通过' : '退回修改'}`,
    `审核人：${entry.reviewer || '-'}`,
    `时间：${entry.at || '-'}`,
    '',
    `审核意见：${entry.note || '（无）'}`,
  ];
  if (opinions.length) {
    lines.push('', '修改意见明细：');
    opinions.forEach((item, index) => {
      lines.push(`${index + 1}. [${item.position || '未标注位置'}] ${item.problem || ''} → ${item.requirement || ''}${item.fixed ? `（${item.fixed}）` : ''}`);
    });
  }
  if (next) lines.push('', `下一环节：${next.name}`);
  lines.push('', '——本邮件由南大红会志愿服务平台自动发送，请勿直接回复。');
  return lines.join('\n');
}

/**
 * 双投递：上一级对接人（主责）+ 美编工作者（只读）。
 * mail 由 ctx.mail 注入（lib/mailer.js 的 sendMail）；缺失时静默跳过。
 * 返回投递结果数组（便于测试与审计）。
 */
export async function deliverOpinion({ mail, submission = {}, entry = {}, next = null, opinions = [], assignees = {}, attachmentName = '' }) {
  const results = [];
  const text = opinionMailText({ submission, entry, next, opinions });
  const subject = `【审核意见】《${submission.title || '未命名稿件'}》第 ${entry.level} 级${entry.decision === 'approve' ? '通过' : '退回'}`;
  const liaison = assignees.liaison?.email || '';
  const editor = submission.editorEmail || '';
  const targets = [];
  if (liaison) targets.push({ to: liaison, tag: 'liaison', note: '对接人（主责）' });
  if (editor) targets.push({ to: editor, tag: 'editor', note: '美编工作者（只读，直接改稿用）' });
  if (!editor) results.push({ tag: 'editor', to: '', skipped: true, reason: '未指派美编，仅推送对接人' });

  if (!mail) return results.map((item) => ({ ...item, skipped: true, reason: item.reason || 'mail 未注入' }));

  for (const target of targets) {
    try {
      const result = await mail({
        to: target.to,
        subject,
        text,
        kind: `outreach.review.opinion.${target.tag}`,
        idempotencyKey: `outreach-opinion-${submission.id || 'x'}-${entry.level}-${entry.at}-${target.tag}`,
      });
      results.push({ ...target, ...result, attachmentName });
    } catch (error) {
      results.push({ ...target, ok: false, reason: error?.message || String(error) });
    }
  }
  return results;
}
