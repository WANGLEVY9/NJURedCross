/** Read-only schema and aggregate inspection; never emit student rows or credentials. */
import { Base } from 'seatable-api';
import { writeFile } from 'node:fs/promises';
import { summarizeVolunteerWorkflow } from '../lib/events/volunteer-workflow.js';

const names = ['登记审批', '报名通知', '活动报名总表', '活动签到', '活动及时长汇总表', '志愿时长录入excel生成', '个人主页（编辑版）'];
const safeOptionColumns = new Set(['是否报名成功', '录入状态', '审批通过', '进程', '隐藏', '已核对并录入', '报名时段', '岗位', '活动类别']);
const token = process.env.SEATABLE_VOLUNTEER_API_TOKEN?.trim();
if (!token) throw new Error('Missing volunteer Base token');
const safeEnum = value => typeof value === 'string' && !/[0-9]{5,}|@/.test(value) && (value !== '进程');
const base = new Base({ server: (process.env.SEATABLE_SERVER_URL || 'https://table.nju.edu.cn').replace(/\/$/, ''), APIToken: token });
try {
  await base.auth();
  const metadata = await base.getMetadata();
  const tableNames = new Map(metadata.tables.map(table => [table._id, table.name]));
  const tables = [];
  const workflowRows = {};
  for (const name of names) {
    const table = metadata.tables.find(item => item.name === name);
    if (!table) { tables.push({ name, missing: true }); continue; }
    const columns = table.columns.map(column => ({
      name: column.name, type: column.type,
      ...(safeOptionColumns.has(column.name) ? { options: (column.data?.options || []).map(option => option.name).filter(value => safeEnum(value) && (column.name !== '进程' || ['开始', '已结束', '待审核', '审批通过', '已取消', '审批不通过'].includes(value))) } : {}),
      ...(['link', 'link-formula', 'formula'].includes(column.type) ? {
        configurationKeys: Object.keys(column.data || {}),
        targetTable: tableNames.get(column.data?.table_id === table._id ? column.data?.other_table_id : column.data?.table_id) || null,
        internalLink: column.data?.is_internal_link ?? null,
        sourceIsTarget: column.type === 'link' && Boolean(column.data?.table_id) ? column.data.table_id === column.data.other_table_id : null,
        formulaOperation: column.data?.formula === 'lookup' ? 'lookup' : null,
        formula: column.data?.formula || column.data?.formula_string || null,
      } : {}),
    }));
    let total = 0;
    const counts = {};
    const distinctEvents = new Set();
    const fields = table.columns.filter(column => safeOptionColumns.has(column.name)).map(column => column.name);
    let hoursPresent = 0, positiveHours = 0, linksPresent = 0;
    let start = 0;
    const maxRows = 30000;
    while (start < maxRows) {
      const rows = await base.listRows(name, '', '', false, start, 500);
      if (!Array.isArray(rows)) throw new Error('Invalid page response');
      if (['活动报名总表', '活动签到'].includes(name)) { workflowRows[name] ||= []; workflowRows[name].push(...rows); }
      for (const row of rows) {
        total++;
        if (row['活动名称']) distinctEvents.add(String(row['活动名称']));
        if (row['志愿时长'] !== '' && row['志愿时长'] != null) hoursPresent++;
        if (Number(row['志愿时长']) > 0) positiveHours++;
        if (Array.isArray(row['签到表']) && row['签到表'].length) linksPresent++;
        for (const field of fields) {
          // Only enum values defined by metadata, booleans and empty cells are emitted.
          const column = columns.find(item => item.name === field);
          const value = row[field];
          const label = value == null || value === '' ? '(empty)' : typeof value === 'boolean' ? String(value) : column.options?.includes(value) ? value : '(other)';
          counts[field] ||= {};
          counts[field][label] = (counts[field][label] || 0) + 1;
        }
      }
      start += rows.length;
      if (rows.length < 500) break;
    }
    const overflow = start >= maxRows ? await base.listRows(name, '', '', false, start, 1) : [];
    tables.push({ name, columns, aggregate: { rows: total, truncated: overflow.length > 0, distinctEvents: table.columns.find(column => column.name === '活动名称')?.type === 'text' ? distinctEvents.size : null, hoursPresent, positiveHours, signInLinksPresent: linksPresent, counts } });
  }
  const workflow = summarizeVolunteerWorkflow(workflowRows['活动报名总表'] || [], workflowRows['活动签到'] || []);
  const report = { workflow: { states: workflow.states, orphanCheckins: workflow.orphanCheckins, registrationsWithVerifiedCheckin: workflow.registrationsWithVerifiedCheckin, groupCount: workflow.groups.length }, inspectedAt: new Date().toISOString(), mode: 'read-only', writes: 0, personalRowsEmitted: 0, scripts: (metadata.scripts || []).filter(script => /活动报名总表-|活动及时长汇总表-|志愿时长导出excel/.test(script.name)).map(script => ({ name: script.name, type: script.type, executionVerified: false })), tables };
  const output = process.argv[2];
  if (output) await writeFile(output, `${JSON.stringify(report, null, 2)}\n`, { mode: 0o600 });
  console.log(JSON.stringify(output ? { ok: true, output, writes: 0, tables: tables.map(table => ({ name: table.name, rows: table.aggregate?.rows, truncated: table.aggregate?.truncated })) } : report, null, 2));
} catch {
  console.error('Workflow inspection failed; raw SDK errors and student data suppressed.');
  process.exitCode = 1;
}
