/* Pure helpers shared by the inventory forms and their offline checks. */
export function integerInput(value, { allowZero = false } = {}) {
  const text = String(value ?? '').trim();
  if (!/^\d+$/.test(text)) return null;
  const number = Number(text);
  return Number.isSafeInteger(number) && number >= (allowZero ? 0 : 1) ? number : null;
}

export function returnProgress(application) {
  const borrowed = Number(application.checkoutQuantity ?? application.quantity ?? 0);
  const returned = Number(application.returnedQuantity ?? 0);
  const loss = Number(application.lossQuantity ?? 0);
  return { borrowed, returned, loss, outstanding: Math.max(0, borrowed - returned - loss) };
}

export function returnPreview(application, quantity, loss) {
  const previous = returnProgress(application);
  return {
    ...previous,
    returned: previous.returned + quantity,
    loss: previous.loss + loss,
    outstanding: Math.max(0, previous.outstanding - quantity - loss),
    exceeds: quantity + loss > previous.outstanding,
  };
}

export function csvCell(value) {
  let text = String(value ?? '');
  // Quoting alone does not prevent spreadsheet formula evaluation.
  if (/^[\s\uFEFF]*[=+\-@]/.test(text) || /^[\t\r\n]/.test(text)) text = `'${text}`;
  return `"${text.replaceAll('"', '""')}"`;
}

export function flowsCsv(rows) {
  const columns = [
    ['流水ID', 'id'], ['申请ID', 'applicationId'], ['操作', 'operation'], ['物资', 'material'],
    ['资产编码', 'assetCode'], ['数量', 'quantity'], ['损耗', 'loss'], ['操作前库存', 'before'],
    ['操作后库存', 'after'], ['操作人', 'operator'], ['时间', 'date'], ['去向', 'destination'],
    ['操作备注', 'note'], ['待同步', 'syncPending'], ['核查记录', 'resolution'],
  ];
  const lines = [columns.map(([label]) => csvCell(label)).join(',')];
  for (const row of rows) {
    lines.push(columns.map(([, key]) => {
      const value = row[key];
      return csvCell(key === 'syncPending' ? (value ? '是' : '否') : typeof value === 'object' && value ? JSON.stringify(value) : value);
    }).join(','));
  }
  return `\uFEFF${lines.join('\r\n')}\r\n`;
}
