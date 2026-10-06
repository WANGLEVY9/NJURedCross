import ExcelJS from 'exceljs';
import { HOURS_EXPORT_COLUMNS } from './hours-export.js';

export async function hoursWorkbook(draft) {
  if (!draft.rows?.length) throw Object.assign(new Error('没有审核通过的时长可导出'), { statusCode: 409 });
  const workbook = new ExcelJS.Workbook();
  workbook.creator = '南京大学红十字会';
  const sheet = workbook.addWorksheet('志愿时长录入表', { views: [{ state: 'frozen', ySplit: 1 }] });
  const widths = [14, 22, 18, 28, 30, 12, 12, 12, 40, 34];
  sheet.columns = HOURS_EXPORT_COLUMNS.map((key, index) => ({ header: key, key, width: widths[index] }));
  draft.rows.forEach(row => sheet.addRow(Object.fromEntries(HOURS_EXPORT_COLUMNS.map(key => [key, row[key] ?? '']))));
  sheet.autoFilter = { from: 'A1', to: 'J1' };
  sheet.getRow(1).height = 32;
  sheet.getRow(1).font = { bold: true, color: { argb: 'FF20242B' }, size: 11 };
  sheet.getRow(1).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFFFFFF' } };
  sheet.eachRow((row, index) => {
    row.alignment = { vertical: 'middle', wrapText: true };
    if (index > 1) { row.height = 44; row.font = { size: 11 }; }
    row.eachCell({ includeEmpty: true }, cell => {
      cell.border = { bottom: { style: 'thin', color: { argb: 'FFE4E7EC' } } };
    });
  });
  for (let col = 6; col <= 8; col++) sheet.getColumn(col).numFmt = '0.##';
  sheet.pageSetup = { orientation: 'landscape', paperSize: 9, fitToPage: true, fitToWidth: 1, fitToHeight: 0, printTitlesRow: '1:1' };
  return Buffer.from(await workbook.xlsx.writeBuffer());
}

export async function sendHoursWorkbook(res, draft, filename) {
  const buffer = await hoursWorkbook(draft);
  res.writeHead(200, { 'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    'Content-Disposition': `attachment; filename="volunteer-hours.xlsx"; filename*=UTF-8''${encodeURIComponent(filename)}`,
    'Content-Length': buffer.length, 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' });
  res.end(buffer);
}
