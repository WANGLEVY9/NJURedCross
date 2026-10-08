import { readFile } from 'node:fs/promises';
import { PDFDocument, rgb } from 'pdf-lib';
import fontkit from '@pdf-lib/fontkit';
import { SUMMARY_LIMITS, summaryFailure } from './summary-contract.js';

/** Embedded font, measured wrapping and vector tables. Original evidence is only copied. */
export async function generateSummaryPdf(summary, materials, { fontPath = process.env.REIMBURSEMENT_FONT_PATH || (process.platform === 'win32' ? 'C:/Windows/Fonts/simfang.ttf' : '') } = {}) {
  let fontBytes;
  try { fontBytes = await readFile(fontPath); } catch { throw summaryFailure('缺少中文字体，请为本地服务配置 REIMBURSEMENT_FONT_PATH（TTF/OTF）。'); }
  const doc = await PDFDocument.create(); doc.registerFontkit(fontkit);
  const font = await doc.embedFont(fontBytes, { subset: true });
  const characters = new Set(font.getCharacterSet());
  const clean = value => String(value ?? '').replace(/\r\n?/g, '\n').replace(/\t/g, ' ');
  function wrap(value, width, size = 11) {
    const lines = [];
    for (const paragraph of clean(value).split('\n')) {
      let line = '';
      for (const char of paragraph) {
        if (!characters.has(char.codePointAt(0))) throw summaryFailure('中文字体无法显示部分字符，请调整文字或配置覆盖这些字符的字体。');
        if (line && font.widthOfTextAtSize(line + char, size) > width) { lines.push(line); line = ''; }
        line += char;
      }
      lines.push(line);
    }
    return lines;
  }
  let page, y;
  function text(value, x, top, size = 11) { page.drawText(clean(value), { x, y: top - size, font, size, color: rgb(0, 0, 0) }); }
  function centered(value, x, top, width, height, size = 11) {
    const lines = wrap(value, width - 14, size), lineHeight = size + 4;
    const offset = Math.max(6, (height - lines.length * lineHeight) / 2);
    lines.forEach((line, index) => text(line, x + (width - font.widthOfTextAtSize(line, size)) / 2, top - offset - index * lineHeight, size));
  }
  function rowHeight(values, widths, minHeight = 30, size = 11) {
    return Math.max(minHeight, ...values.map((value, index) => wrap(value, widths[index] - 14, size).length * (size + 4) + 14));
  }
  function row(values, widths, minHeight = 30, size = 11) {
    const height = rowHeight(values, widths, minHeight, size);
    let x = 58;
    values.forEach((value, index) => {
      page.drawRectangle({ x, y: y - height, width: widths[index], height, borderWidth: .6, borderColor: rgb(.25, .25, .25) });
      centered(value, x, y, widths[index], height, size); x += widths[index];
    });
    y -= height; return height;
  }
  const activity = summary.activity;
  function startPage(continuation = false) {
    page = doc.addPage([595.28, 841.89]);
    centered(continuation ? '南京大学活动费报销表（续页）' : '南京大学活动费报销表', 58, 774, 480, 30, 17);
    const metadata = `经办人：${summary.form.handlerName}   联系电话：${summary.form.handlerPhone}   填报日期：${summary.form.fillDate}`;
    const lines = wrap(metadata, 480, 10);
    lines.forEach((line, i) => text(line, 58, 735 - i * 14, 10));
    y = 710 - (lines.length - 1) * 14;
    row(['活动名称', activity.name, '活动日期', activity.date], [90, 170, 80, 140]);
  }
  function newExpensePage() {
    startPage(true);
    row(['支出项目', '金额（元）', '备注'], [90, 170, 220]);
  }
  startPage();
  // Metadata can itself need continuation pages when every permitted field is long.
  for (const [values, widths, minimum] of [
    [['单位名称', activity.unitName, '经费卡号', activity.fundAccount], [90, 170, 80, 140], 30],
    [['活动人数', String(activity.participantCount), '活动地点', activity.location], [90, 170, 80, 140], 30],
    [['开展活动目的及内容', activity.description], [90, 390], 80],
  ]) {
    if (y - rowHeight(values, widths, minimum) < 90) startPage(true);
    row(values, widths, minimum);
  }
  if (y - 30 < 155) startPage(true);
  row(['支出项目', '金额（元）', '备注'], [90, 170, 220]);
  let subtotal = 0;
  for (const item of summary.rows) {
    const values = [item.label, (item.amountCents / 100).toFixed(2), item.note];
    const needed = rowHeight(values, [90, 170, 220]);
    if (y - needed < 155) {
      if (subtotal) text(`本页支出小计：${(subtotal / 100).toFixed(2)} 元；其余明细见续页。`, 58, y - 12, 10);
      newExpensePage(); subtotal = 0;
    }
    row(values, [90, 170, 220]); subtotal += item.amountCents;
  }
  const totalValues = ['合计金额', (summary.totalCents / 100).toFixed(2), `大写：${summary.amountUpper}`];
  const totalHeight = Math.max(36, wrap(totalValues[2], 206).length * 15 + 14);
  if (y - totalHeight - 50 < 75) newExpensePage();
  row(totalValues, [90, 170, 220], 36);
  row(['单位负责人审批', '', '单位公章', ''], [90, 170, 80, 140], 50);
  const formPages = doc.getPageCount();
  doc.getPages().forEach((p, index) => { page = p;
    text(`汇总编号：${summary.code}   ${summary.selections.length} 笔审核通过申请`, 58, 47, 9);
    text(`第 ${index + 1} / ${formPages} 页`, 465, 47, 9);
  });
  doc.setTitle(`${activity.name} - 活动费报销表`); doc.setCreator('NJU Red Cross local reimbursement summary');
  const formPdf = Buffer.from(await doc.save());
  const packet = await PDFDocument.load(formPdf);
  const attachments = [];
  for (const material of materials) {
    const source = await PDFDocument.load(material.bytes, { updateMetadata: false });
    const startPage = packet.getPageCount() + 1;
    if (source.getForm().getFields().length || packet.getPageCount() + source.getPageCount() > SUMMARY_LIMITS.pages)
      throw summaryFailure('活动材料包超出页数限制或包含未确认表单。');
    for (const copied of await packet.copyPages(source, source.getPageIndices())) packet.addPage(copied);
    attachments.push({ requestId: material.requestId, startPage, endPage: packet.getPageCount(),
      sources: material.sources.map(s => ({ name: s.name, sha256: s.sha256, startPage: startPage + s.startPage - 1, endPage: startPage + s.endPage - 1 })) });
  }
  const packetPdf = Buffer.from(await packet.save());
  if (packetPdf.length > SUMMARY_LIMITS.bytes) throw summaryFailure('生成的活动材料包不能超过 30 MB。', 413);
  return { formPdf, packetPdf, formPages, packetPages: packet.getPageCount(), attachments };
}
