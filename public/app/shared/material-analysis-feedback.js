const supportingTypes = ['订单截图', '付款截图', '订单和付款截图'];

/** Describe evidence gaps separately from service errors; neither establishes what a photo contains. */
export function materialAnalysisFeedback(bundle, state) {
  const sourceFor = page => bundle.sources?.find(source => source.startPage > 0 && page >= source.startPage && page <= source.endPage);
  const labelFor = source => source?.kind === 'supporting' ? source.materialType || '补充材料' : '发票 PDF';
  const notices = (state?.errors || []).map(error => {
    const source = sourceFor(error.page), prefix = `第 ${error.page} 页（${labelFor(source)}）`;
    const unsupported = /补充材料不进行发票识别|此类补充材料请查看原件，暂不进行自动核验/.test(error.message);
    return { page: error.page, type: 'service', message: unsupported
      ? `${prefix}：当前识别服务尚未支持该材料的自动核验，请先查看原件。`
      : `${prefix}：识别未完成。${error.message || '请稍后重试或人工核对原件。'}` };
  });
  const failed = new Set(notices.map(notice => notice.page));
  for (const result of state?.analyses || []) {
    const source = sourceFor(result.page);
    if (failed.has(result.page) || source?.kind !== 'supporting' || !supportingTypes.includes(source.materialType)) continue;
    const prefix = `第 ${result.page} 页（${source.materialType}）`;
    if (!result.supporting) {
      notices.push({ page: result.page, type: 'unavailable', message: `${prefix}：尚无有效的材料提取结果，请查看原件并核对材料类型。` });
      continue;
    }
    const needed = source.materialType === '订单截图' ? [['productName', '物资名']]
      : source.materialType === '付款截图' ? [['paidAmount', '付款金额']] : [['productName', '物资名'], ['paidAmount', '付款金额']];
    const conflicting = needed.filter(([key]) => result.supporting[key]?.state === 'conflict');
    if (conflicting.length) {
      notices.push({ page: result.page, type: 'conflict', message: `${prefix}：${conflicting.map(([, name]) => name).join('和')}信息存在冲突，请展开识别详情并核对原件${conflicting.some(([key]) => key === 'paidAmount') ? '及交易、退款情况' : ''}。` });
      continue;
    }
    const missing = needed.filter(([key]) => result.supporting[key]?.state !== 'extracted');
    if (missing.length) notices.push({ page: result.page, type: 'unrecognized',
      message: `${prefix}：未提取到有效${missing.map(([, name]) => name).join('和')}，请确认该页是否为清晰、完整的${source.materialType}，并核对原件。` });
  }
  return notices.sort((a, b) => a.page - b.page);
}
