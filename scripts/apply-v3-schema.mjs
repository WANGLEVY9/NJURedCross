import { Base } from 'seatable-api';
import {
  CHECKLIST_COLUMNS,
  CHECKLIST_SEED,
  CHECKLIST_TABLE,
  LIAISON_COLUMNS,
  LIAISON_ROLES,
  LIAISON_SEED,
  LIAISON_TABLE,
  MEDIA_COLUMNS,
  MEDIA_TABLE,
  SHOWCASE_COLUMNS,
  SHOWCASE_TABLE,
  SKILL_COLUMNS,
  SKILL_TABLE,
  SUBMISSION_ATTACHMENT_COLUMNS,
  SUBMISSION_ATTACHMENT_TABLE,
  TASK_CLAIM_COLUMNS,
  TASK_CLAIM_TABLE,
  TASK_COLUMNS,
  TASK_TABLE,
} from '../lib/attachment/store.js';
import { ACCOUNT_TABLE, ACCOUNT_COLUMNS } from '../lib/identity/store.js';

/**
 * v3 变更 schema（阶段二～四）：
 *   · 平台账号表 +2 列：笔名 / 技能星级
 *   · 宣传投稿表 +6 列：笔名 / 推文类别 / 审核层级 / 审核轨迹 / 审核意见文件 / 发布形式
 *   · 影像素材表 +10 列：精选 6 列 + 删除审核 4 列
 *   · 宣传发布任务表 +1 列：发布形式
 *   · 宣传展示表 +1 列：展示分类
 *   · 活动项目表 +1 列：中心（第 16 项，影像上传按中心筛选活动）
 *   · 新建 4 张表：任务表 / 任务申领表 / 成员技能表 / 审核清单模板表 / 宣传对接人表
 *   · 审核清单模板表对齐 21 项（对齐《南大红会 美编审核清单》：8 类，逐字）
 *
 * v3.1（2026-10-11）追加：
 *   · 投稿附件表 +2 列：中心 / 活动名（附件按 /<部门>/<活动名>/<附件ID>/ 归位）
 *   · 任务表 +2 列：技能要求 / 要求星级（发布任务时附带）
 *   · 任务申领表 +3 列：审核人 / 审核时间 / 审核意见（申领需管理员审核）
 *   · 成员技能表 +1 列：常用软件（多选，存 JSON 数组文本）
 *
 * 安全模型（与其他 apply-* 脚本一致）：
 *   · 不带 --apply 时只打印计划并退出，不写入
 *   · 写操作需要显式 --confirm=APPLY-NJU-RC-V3-SCHEMA
 *   · 加列只追加缺失列，已存在列跳过；建表拒绝覆盖既有表
 *
 * 运行方式：
 *   npm run v3:dry-run   # 预览
 *   npm run v3:apply     # 需要确认短语
 */

const server = (process.env.SEATABLE_SERVER_URL || 'https://table.nju.edu.cn').replace(/\/$/, '');
const token = process.env.SEATABLE_API_TOKEN;
const apply = process.argv.includes('--apply');
const confirmation = process.argv.find((arg) => arg.startsWith('--confirm='))?.slice('--confirm='.length);
const requiredConfirmation = 'APPLY-NJU-RC-V3-SCHEMA';

/** 与 server.js 保持同一表名。 */
const SUBMISSIONS_TABLE = '宣传投稿表';
const SUBMISSIONS_NEW_COLUMNS = [
  '笔名', '推文类别', '审核层级', '审核轨迹', '审核意见文件', '发布形式',
];

/** 影像素材表 v3：精选（N1）+ 删除审核（第 9 项）。 */
const MEDIA_V3_COLUMNS = [
  '精选状态', '精选申请时间', '精选确认人', '精选确认时间', '精选库路径', '精选库ID',
  '删除申请状态', '删除理由', '删除审核人', '删除审核时间',
];

/** 宣传发布任务表 v3：发布形式（N3）。 */
const PUBLICATION_TABLE = '宣传发布任务表';
const PUBLICATION_NEW_COLUMNS = ['发布形式'];

/** 宣传展示表 v3：展示分类（第 14 项）。 */
const SHOWCASE_NEW_COLUMNS = ['展示分类'];

/** 活动项目表 v3：中心（第 16 项，服务于影像上传的「中心-活动联动」）。 */
const EVENT_PROJECT_TABLE = '活动项目表';
const EVENT_PROJECT_NEW_COLUMNS = ['中心'];

/** 账号表 v3：笔名 + 技能星级。 */
const ACCOUNT_NEW_COLUMNS = ['笔名', '技能星级'];

/* ---- v3.1（2026-10-11 用户定案）---- */

/** 投稿附件表 v3.1：附件落 /<部门>/<活动名>/<附件ID>/，槽位申请时写入归位坐标。 */
const ATTACHMENT_V31_COLUMNS = ['中心', '活动名'];

/** 任务表 v3.1：任务发布附带技能要求（技能名称 + 所需星级）。 */
const TASK_V31_COLUMNS = ['技能要求', '要求星级'];

/** 任务申领表 v3.1：申领需管理员审核，审核结论留痕。 */
const TASK_CLAIM_V31_COLUMNS = ['审核人', '审核时间', '审核意见'];

/** 成员技能表 v3.1：技能名称改下拉 + 新增常用软件多选。 */
const SKILL_V31_COLUMNS = ['常用软件'];

if (!token || token === 'replace-with-your-api-token') throw new Error('Missing SEATABLE_API_TOKEN');

const base = new Base({ server, APIToken: token, dtableName: process.env.SEATABLE_BUSINESS_BASE_UUID || undefined });

async function tableExists(name) {
  const tables = await base.getTables();
  return tables.some((item) => item.name === name);
}

async function existingColumns(name) {
  const tables = await base.getTables();
  const target = tables.find((item) => item.name === name);
  if (!target) return null;
  const columns = await base.listColumns(name);
  return columns.map((c) => c.name);
}

async function main() {
  await base.auth();
  const report = { addColumns: [], createTables: [], seed: [], skipped: [], failed: [] };

  // ---- 加列计划 ----
  const plans = [
    { table: ACCOUNT_TABLE, columns: ACCOUNT_NEW_COLUMNS, label: '平台账号表' },
    { table: SUBMISSIONS_TABLE, columns: SUBMISSIONS_NEW_COLUMNS, label: '宣传投稿表' },
    { table: MEDIA_TABLE, columns: MEDIA_V3_COLUMNS, label: '影像素材表' },
    { table: PUBLICATION_TABLE, columns: PUBLICATION_NEW_COLUMNS, label: '宣传发布任务表' },
    { table: SHOWCASE_TABLE, columns: SHOWCASE_NEW_COLUMNS, label: '宣传展示表' },
    { table: EVENT_PROJECT_TABLE, columns: EVENT_PROJECT_NEW_COLUMNS, label: '活动项目表' },
    // v3.1：存储归位 + 技能软件 + 任务技能要求 + 申领审核
    { table: SUBMISSION_ATTACHMENT_TABLE, columns: ATTACHMENT_V31_COLUMNS, label: '投稿附件表' },
    { table: TASK_TABLE, columns: TASK_V31_COLUMNS, label: '任务表' },
    { table: TASK_CLAIM_TABLE, columns: TASK_CLAIM_V31_COLUMNS, label: '任务申领表' },
    { table: SKILL_TABLE, columns: SKILL_V31_COLUMNS, label: '成员技能表' },
  ];

  for (const plan of plans) {
    const cols = await existingColumns(plan.table);
    if (cols === null) { report.skipped.push(`${plan.table}（表不存在，跳过加列）`); continue; }
    for (const name of plan.columns) {
      if (cols.includes(name)) { report.skipped.push(`${plan.table}.${name}（已存在）`); continue; }
      report.addColumns.push(`${plan.table}.${name}`);
    }
  }

  // ---- 建表计划 ----
  const newTables = [
    { name: TASK_TABLE, columns: TASK_COLUMNS, purpose: '宣传任务发布与心愿清单（第 8 项）' },
    { name: TASK_CLAIM_TABLE, columns: TASK_CLAIM_COLUMNS, purpose: '任务申领记录（第 8/13 项）' },
    { name: SKILL_TABLE, columns: SKILL_COLUMNS, purpose: '成员技能与星级（第 8 项 / D3）' },
    { name: CHECKLIST_TABLE, columns: CHECKLIST_COLUMNS, purpose: '审核清单模板（§6，21 项）' },
    { name: LIAISON_TABLE, columns: LIAISON_COLUMNS, purpose: '宣传对接人/审核人分工（§4.0，按栏目选人）' },
  ];

  for (const definition of newTables) {
    if (await tableExists(definition.name)) { report.skipped.push(`${definition.name}（已存在，跳过建表）`); continue; }
    report.createTables.push(definition.name);
  }

  // ---- 打印计划 ----
  console.log('=== v3 schema 变更计划 ===');
  console.log(`目标 Base：${process.env.SEATABLE_BUSINESS_BASE_UUID || '(未指定，使用 Token 默认库)'}`);
  console.log('\n[加列]');
  for (const item of report.addColumns) console.log(`  + ${item}`);
  if (!report.addColumns.length) console.log('  （无需加列）');
  console.log('\n[建表]');
  for (const item of report.createTables) console.log(`  + ${item}`);
  if (!report.createTables.length) console.log('  （无需建表）');
  console.log('\n[跳过]');
  for (const item of report.skipped) console.log(`  - ${item}`);
  console.log(`\n[审核清单对齐] ${CHECKLIST_SEED.length} 项（按 模板ID 对账：缺失补建、措辞变化就地更新）`);
  console.log(`[对接人 seed] ${LIAISON_SEED.length} 条分工（建表后写入）`);

  if (!apply) {
    console.log('\nℹ️  预览模式：未写入任何变更。加 --apply --confirm=' + requiredConfirmation + ' 执行。');
    return;
  }
  if (confirmation !== requiredConfirmation) {
    throw new Error(`确认短语不匹配。请使用 --confirm=${requiredConfirmation}`);
  }

  console.log('\n=== 执行变更 ===');

  // 1. 建表（addTable 支持一次性带列定义）
  for (const definition of newTables) {
    if (await tableExists(definition.name)) continue;
    try {
      const columns = definition.columns.map((name) => ({ column_name: name, column_type: 'text' }));
      await base.addTable(definition.name, 'zh-cn', columns);
      console.log(`  ✅ 建表 ${definition.name}（${definition.columns.length} 列）`);
    } catch (error) {
      const detail = error?.response?.data?.error_msg || error.message;
      report.failed.push(`${definition.name}: ${detail}`);
      console.error(`  ❌ 建表 ${definition.name} 失败：${detail}`);
    }
  }

  // 2. 加列（运行时重新读列：刚建好的表已含全列，避免重复 insert 报错）
  for (const plan of plans) {
    const current = await existingColumns(plan.table);
    if (current === null) { continue; }
    for (const name of plan.columns) {
      const marker = `${plan.table}.${name}`;
      if (current.includes(name)) continue;
      try {
        await base.insertColumn(plan.table, name, 'text', '');
        console.log(`  ✅ 加列 ${marker}`);
      } catch (error) {
        const detail = error?.response?.data?.error_msg || error.message;
        report.failed.push(`${marker}: ${detail}`);
        console.error(`  ❌ 加列 ${marker} 失败：${detail}`);
      }
    }
  }

  // 3. 审核清单对齐（按 模板ID 对账：缺失补建、措辞变化就地更新）
  try {
    const rows = await base.listRows(CHECKLIST_TABLE, '', '', false, '', 1000).catch(() => []);
    const byId = new Map(rows.map((row) => [String(row['模板ID'] || ''), row]));
    let created = 0;
    let updated = 0;
    for (const [index, entry] of CHECKLIST_SEED.entries()) {
      const order = index + 1;
      const id = `CHK-${String(order).padStart(2, '0')}`;
      const desired = {
        模板ID: id,
        适用类型: '通用',
        类别: entry.category,
        检查项: entry.item,
        标准: entry.standard,
        排序: String(order),
        启用: '是',
      };
      const existing = byId.get(id);
      if (!existing) {
        await base.appendRow(CHECKLIST_TABLE, desired);
        created += 1;
        continue;
      }
      // 只更新真正变化的列，避免无谓写库与审计噪音
      const changed = ['类别', '检查项', '标准', '排序'].filter((key) => String(existing[key] ?? '') !== desired[key]);
      if (changed.length) {
        await base.updateRow(CHECKLIST_TABLE, existing._id, Object.fromEntries(changed.map((key) => [key, desired[key]])));
        updated += 1;
      }
    }
    console.log(`  ✅ 审核清单对齐 ${CHECKLIST_SEED.length} 项：新建 ${created} / 更新 ${updated} / 已一致 ${CHECKLIST_SEED.length - created - updated}`);
  } catch (error) {
    const detail = error?.response?.data?.error_msg || error.message;
    report.failed.push(`CHECKLIST 对齐: ${detail}`);
    console.error(`  ❌ 审核清单对齐失败：${detail}`);
  }

  // 4. 对接人 seed（仅当表为空时写入）
  try {
    const rows = await base.listRows(LIAISON_TABLE, '', '', false, '', 1000).catch(() => []);
    if (rows.length === 0) {
      let order = 0;
      for (const entry of LIAISON_SEED) {
        for (const category of entry.categories) {
          order += 1;
          await base.appendRow(LIAISON_TABLE, {
            对接人ID: `LSN-${String(order).padStart(2, '0')}`,
            姓名: entry.name,
            负责栏目: category,
            角色: LIAISON_ROLES[entry.role] || entry.role,
            邮箱: '',
            启用: '是',
          });
        }
      }
      console.log(`  ✅ 对接人 seed 写入 ${order} 条分工`);
    } else {
      console.log(`  - 对接人表已有 ${rows.length} 行，跳过 seed`);
    }
  } catch (error) {
    const detail = error?.response?.data?.error_msg || error.message;
    report.failed.push(`LIAISON seed: ${detail}`);
    console.error(`  ❌ 对接人 seed 失败：${detail}`);
  }

  console.log('\n=== 完成 ===');
  if (report.failed.length) {
    console.error('失败项：');
    for (const item of report.failed) console.error(`  - ${item}`);
    process.exitCode = 1;
  } else {
    console.log('全部变更执行成功。');
  }
}

main().catch((error) => {
  console.error(`脚本失败：${error.message}`);
  process.exitCode = 1;
});
