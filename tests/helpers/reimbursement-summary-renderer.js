import process from 'node:process';
import { Buffer } from 'node:buffer';
import { existsSync } from 'node:fs';
import { PDFDocument } from 'pdf-lib';
import { generateSummaryPdf } from '../../lib/reimbursements/summary-pdf.js';
const fontPath = process.env.REIMBURSEMENT_FONT_PATH || (process.platform === 'win32' ? 'C:/Windows/Fonts/simfang.ttf' : '');
/** Exercise the real Chinese form when a CJK font exists; keep workflow tests portable. */
export async function renderTestSummary(summary, materials) {
  if (existsSync(fontPath)) return generateSummaryPdf(summary, materials, { fontPath });
  const doc = await PDFDocument.create(); doc.addPage([595, 842]); const formPdf = Buffer.from(await doc.save()), attachments = [];
  for (const material of materials) {
    if (!material.bytes.length) continue;
    const source = await PDFDocument.load(material.bytes), startPage = doc.getPageCount() + 1;
    for (const page of await doc.copyPages(source, source.getPageIndices())) doc.addPage(page);
    attachments.push({ requestId: material.requestId, groupIndex: material.groupIndex, startPage, endPage: doc.getPageCount(), sources: material.sources });
  }
  return { formPdf, packetPdf: Buffer.from(await doc.save()), formPages: 1, packetPages: doc.getPageCount(), attachments };
}
