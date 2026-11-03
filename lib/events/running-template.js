import ExcelJS from 'exceljs';

/**
 * 初审名单模板。
 *
 * 列名必须与 `running-import-worker.js` 的 `allowed` 完全一致：多出来的列会被忽略，
 * 少一列就会让匹配退化成「只认姓名学号」，同一人报过两场即无法唯一匹配。
 * 「岗位／日期／时段」三列的值取自与 `matchRunningImport` 同一来源（报名行优先于
 * 活动行的岗位回退），保证「下载模板→填数字→原样上传」这条闭环不再自己撞自己。
 */
export const RUNNING_TEMPLATE_COLUMNS = Object.freeze(['姓名', '学号', '岗位', '日期', '时段', '报名ID', '服务时长', '培训时长', '交通时长']);
const WIDTHS = [12, 16, 20, 14, 14, 26, 12, 12, 12];

export async function runningTemplateWorkbook(rows) {
  if (!rows?.length) throw Object.assign(new Error('本活动暂无可填写的参与记录'), { statusCode: 409 });
  const book = new ExcelJS.Workbook();
  book.creator = '南京大学红十字会';
  const sheet = book.addWorksheet('时长初审名单', { views: [{ state: 'frozen', ySplit: 1 }] });
  sheet.columns = RUNNING_TEMPLATE_COLUMNS.map((key, index) => ({ header: key, key, width: WIDTHS[index] }));
  for (const row of rows) sheet.addRow(Object.fromEntries(RUNNING_TEMPLATE_COLUMNS.map(key => [key, row[key] ?? ''])));
  sheet.autoFilter = { from: 'A1', to: 'I1' };
  sheet.getRow(1).height = 28;
  sheet.getRow(1).font = { bold: true, color: { argb: 'FF20242B' }, size: 11 };
  sheet.getRow(1).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFFF1F2' } };
  sheet.eachRow((row, index) => {
    row.alignment = { vertical: 'middle', wrapText: index > 1 };
    row.eachCell({ includeEmpty: true }, cell => {
      cell.border = { bottom: { style: 'thin', color: { argb: 'FFE4E7EC' } } };
    });
    if (index > 1) row.font = { size: 11 };
  });
  // 学号与报名ID 按文本读取，避免 Excel 把长串认成科学计数或丢掉前导零。
  sheet.getColumn(2).numFmt = '@';
  sheet.getColumn(6).numFmt = '@';
  for (let column = 7; column <= 9; column++) sheet.getColumn(column).numFmt = '0.##';
  sheet.pageSetup = { orientation: 'landscape', paperSize: 9, fitToPage: true, fitToWidth: 1, fitToHeight: 0, printTitlesRow: '1:1' };
  return Buffer.from(await book.xlsx.writeBuffer());
}
