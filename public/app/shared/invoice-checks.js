import { invoicePages } from './reimbursement-files.js';

/** One serial queue for invoice pages only. Supporting PDFs stay in the continuous preview. */
export function createInvoiceChecks(analyze) {
  const jobs = new Map(), listeners = new Set();
  let active = false, disposed = false;
  function snapshot(job) {
    return { analyses: [...job.results.values()].sort((a, b) => a.page - b.page),
      errors: [...job.errors].map(([page, message]) => ({ page, message })),
      pageCount: job.pageCount, runningPage: job.runningPage,
      complete: job.results.size + job.errors.size === job.pageCount };
  }
  function notify(job) { for (const listener of listeners) listener(job.id, snapshot(job)); }
  async function pump() {
    if (active || disposed) return;
    active = true;
    try {
      for (;;) {
        if (disposed) break;
        const job = [...jobs.values()].find(job => job.results.size + job.errors.size < job.pageCount);
        if (!job) break;
        const page = job.pages
          .find(page => !job.results.has(page) && !job.errors.has(page));
        job.runningPage = page; notify(job);
        try {
          const result = await analyze(job.id, page);
          job.results.set(page, result.analysis);
        } catch (error) {
          job.errors.set(page, error.message || '检查未完成，请人工核对');
          if (error.status === 401 || error.status === 403) {
            for (const pending of jobs.values()) for (const number of pending.pages) {
              if (!pending.results.has(number)) pending.errors.set(number, error.message);
            }
          }
        }
        job.runningPage = null; if (!disposed) notify(job);
      }
    } finally { active = false; }
  }
  return {
    ensure(bundle) {
      if (disposed) return;
      let job = jobs.get(bundle.id);
      if (!job) {
        const pages = invoicePages(bundle);
        job = { id: bundle.id, pages, pageCount: pages.length, results: new Map(), errors: new Map(), runningPage: null };
        jobs.set(bundle.id, job);
      }
      for (const result of bundle.analyses || []) if (job.pages.includes(result.page)) { job.results.set(result.page, result); job.errors.delete(result.page); }
      notify(job); queueMicrotask(pump);
      return snapshot(job);
    },
    get(id) { const job = jobs.get(id); return job ? snapshot(job) : null; },
    subscribe(listener) { listeners.add(listener); return () => listeners.delete(listener); },
    dispose() { disposed = true; listeners.clear(); },
  };
}

export function invoiceCheckSummary(state) {
  if (!state) return '发票辅助检查等待开始';
  if (!state.pageCount) return '未上传发票 · 补充材料请人工查看';
  const checked = state.analyses.length;
  const matched = state.analyses.filter(item => item.buyer.state === 'matched').length;
  const different = state.analyses.filter(item => item.buyer.state === 'different').length;
  const unknown = checked - matched - different;
  const seal = state.analyses.filter(item => item.seal.state === 'candidate').length;
  const progress = state.complete ? (state.errors.length ? '辅助检查部分未完成' : '辅助检查已完成')
    : state.runningPage ? `正在自动检查第 ${state.runningPage} 页` : '辅助检查排队中';
  return `${progress} · 已检查 ${checked}/${state.pageCount} 页 · 南京大学抬头 ${matched} 页 · 其他抬头 ${different} 页 · 抬头待核对 ${unknown} 页 · 疑似红章 ${seal} 页${state.errors.length ? ` · 失败 ${state.errors.length} 页` : ''}`;
}
