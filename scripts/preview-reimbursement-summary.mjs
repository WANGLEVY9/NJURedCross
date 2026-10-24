/** Explicit, offline synthetic integration preview. Never reads .env or a remote database. */
import { PDFDocument, StandardFonts } from 'pdf-lib';
import { createLocalReimbursementService } from '../lib/reimbursements/local-service.js';
import { createPreviewServer } from './preview-materials.mjs';

export async function seedSummaryDemo({ workflowVersion = 3 } = {}) {
  const service = createLocalReimbursementService({ workflowVersion });
  const reviewer = { id: 'synthetic-materials-admin', canReview: true, financePermissions: ['final', 'view'] };
  const initial = { id: 'synthetic-finance-initial', financePermissions: ['initial'] };
  const { activity } = await service.summaries.saveActivity(reviewer, { id: 'demo-activity', name: '活动报销汇总演示（合成数据）',
    campus: '苏州', date: '2026-10-07', location: '南京大学（演示地点）', participantCount: 35, unitName: '南京大学红十字会', fundAccount: 'TEST-FUND-001',
    description: '本活动仅用于本地开发，演示多位申请人、多次提交的材料审核与活动费用汇总，不代表真实活动或实际支出。' });
  for (const [index, person, label, amount, note] of [[1, '演示申请人甲', '便利贴', '120.00', '互动环节'],
    [2, '演示申请人乙', '便利贴', '80.00', '互动环节'], [3, '演示申请人甲', '手电筒', '25.92', '活动道具'],
    [4, '演示申请人丙', '纸质材料打印', '54.70', '活动材料']]) {
    const actor = { id: person, canReview: false };
    const doc = await PDFDocument.create(), page = doc.addPage([400, 300]), font = await doc.embedFont(StandardFonts.Helvetica);
    page.drawText(`SYNTHETIC EVIDENCE ${index}\nLocal integration test only\nAmount: ${amount}`, { x: 35, y: 230, font, size: 14, lineHeight: 24 });
    const { bundle } = await service.preprocess(actor, [{ name: `demo-evidence-${index}.pdf`, bytes: Buffer.from(await doc.save()), kind: 'invoice', expenseItemId: '1' }]);
    const { request } = await service.submit(actor, { name: person, purpose: '本地活动汇总演示', amount, bundleId: bundle.id,
      idempotencyKey: `demo-${index}`, activityId: activity.id, expenseItems: [{ label, amount, note }] });
    await service.materialPackets.create(initial, request.id, { revision: request.revision, bundleId: bundle.id, materialsChecked: true });
    const sent = (await service.review(initial, request.id, { action: 'initial-approve', revision: request.revision,
      stateVersion: request.stateVersion, materialsChecked: true })).request;
    if (workflowVersion === 2) await service.review(reviewer, request.id, { action: 'final-approve', revision: sent.revision, stateVersion: sent.stateVersion,
      note: '合成样例，不是真实发票', materialsChecked: true });
  }
  return service;
}
if (process.argv[1]?.replace(/\\/g, '/').endsWith('/preview-reimbursement-summary.mjs')) {
  const port = Number(process.env.PORT || 3135);
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('PORT 必须为有效端口。');
  const server = await createPreviewServer({ seedSyncFailure: false, reimbursementService: await seedSummaryDemo() });
  server.listen(port, () => console.log(`活动报销汇总合成预览：http://127.0.0.1:${port}/console/reimbursements/summary\n全部为合成数据，仅保存在内存，不连接远端库。`));
}
