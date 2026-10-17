/**
 * 请求时延台账：让「每个页面、每个操作都在 1 秒内」变成可验收的数字。
 *
 * 为什么不复用 telemetry：`observer.http` 只在 telemetry 开启时工作，而
 * 「≤1 秒」是业务验收口径，不该因为关掉日志就失去度量。这里只依赖
 * `res` 的 finish/close 事件，不读请求体、不写日志、不落盘。
 *
 * 成本：每个请求一次 hrtime 与一次数组写入；每个路由保留最近 128 个样本，
 * 路由总数上限 200，常驻内存约 200 KB。
 */
import { telemetryRoute } from '../../public/app/shared/telemetry-route.js';

const OVER_BUDGET_MS = 1000;

export function createLatencyLedger({
  routeLimit = 200,
  sampleLimit = 128,
  budgetMs = OVER_BUDGET_MS,
  now = () => Number(process.hrtime.bigint() / 1000000n),
} = {}) {
  /** @type {Map<string, {samples:number[], cursor:number, count:number, over:number, max:number, errors:number}>} */
  const routes = new Map();
  let requests = 0;
  let overBudget = 0;

  const shouldCapture = (url) => {
    const path = String(url || '').split(/[?#]/, 1)[0];
    return path === '/api' || path.startsWith('/api/');
  };

  function record(route, durationMs, status) {
    let entry = routes.get(route);
    if (entry) {
      // 重新插入，让 Map 的迭代顺序等于最近使用顺序。
      routes.delete(route);
      routes.set(route, entry);
    } else {
      entry = { samples: [], cursor: 0, count: 0, over: 0, max: 0, errors: 0 };
      routes.set(route, entry);
      while (routes.size > routeLimit) {
        const oldest = routes.keys().next();
        if (oldest.done) break;
        routes.delete(oldest.value);
      }
    }

    entry.count += 1;
    entry.max = Math.max(entry.max, durationMs);
    if (durationMs > budgetMs) entry.over += 1;
    if (Number.isInteger(status) && status >= 500) entry.errors += 1;

    if (entry.samples.length < sampleLimit) entry.samples.push(durationMs);
    else {
      entry.samples[entry.cursor] = durationMs;
      entry.cursor = (entry.cursor + 1) % sampleLimit;
    }

    requests += 1;
    if (durationMs > budgetMs) overBudget += 1;
  }

  function quantile(sorted, ratio) {
    if (!sorted.length) return 0;
    const index = Math.min(sorted.length - 1, Math.max(0, Math.ceil(ratio * sorted.length) - 1));
    return sorted[index];
  }

  function snapshot({
    filter = () => true,
    limit = 40,
    includeAll = false,
  } = {}) {
    const rows = [];
    for (const [route, entry] of routes) {
      if (!filter(route)) continue;
      const sorted = [...entry.samples].sort((a, b) => a - b);
      rows.push({
        route,
        count: entry.count,
        p50: quantile(sorted, 0.5),
        p95: quantile(sorted, 0.95),
        max: entry.max,
        overBudget: entry.over,
        errors: entry.errors,
      });
    }

    rows.sort((a, b) => (b.p95 - a.p95) || (b.overBudget - a.overBudget));

    return {
      budgetMs,
      requests,
      overBudget,
      overBudgetRate: requests ? Math.round((overBudget / requests) * 10000) / 100 : 0,
      trackedRoutes: routes.size,
      slowest: includeAll ? rows : rows.slice(0, limit),
    };
  }

  /** 不返回任何东西；只负责在响应结束时记账。 */
  function start(req, res) {
    if (!shouldCapture(req.url)) return;
    const route = telemetryRoute(req.url);
    if (route === '/:asset' || route === '/:other') return;

    const started = now();
    let done = false;
    const finish = () => {
      if (done) return;
      done = true;
      res.removeListener('finish', finish);
      res.removeListener('close', finish);
      record(route, Math.max(0, Math.round(now() - started)), res.statusCode);
    };
    res.once('finish', finish);
    res.once('close', finish);
  }

  return { start, snapshot };
}
