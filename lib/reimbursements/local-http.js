import { json, securityHeaders } from '../http/response.js';
import { UPLOAD_LIMITS, MB } from '../../public/app/shared/reimbursement-limits.js';
import { MATERIAL_UPLOADS, materialExtension } from '../../public/app/shared/reimbursement-files.js';
import { BANK_ACCOUNT_POLICY } from '../../public/app/shared/reimbursement-bank-account.js';

function fail(statusCode, message) { throw Object.assign(new Error(message), { statusCode }); }
async function bodyBytes(req, limit) {
  const chunks = []; let size = 0;
  for await (const chunk of req) { size += chunk.length; if (size > limit) fail(413, '请求体超过大小限制。'); chunks.push(chunk); }
  return Buffer.concat(chunks);
}
async function readObject(req) {
  const bytes = await bodyBytes(req, 64 * 1024);
  let data;
  try { data = JSON.parse(bytes.toString('utf8')); } catch { fail(400, '请求格式不正确。'); }
  if (!data || typeof data !== 'object' || Array.isArray(data)) fail(400, '请求须为 JSON 对象。');
  return data;
}

/** Invoked only after the preview's loopback, session and CSRF guards. */
export function createReimbursementLocalHandler(service) {
  return async (req, res, url, actor) => {
    const root = '/api/preview/reimbursements';
    if (url.pathname !== root && !url.pathname.startsWith(`${root}/`)) return false;
    if (req.method === 'GET' && url.pathname === `${root}/config`) {
      json(res, 200, { ok: true, local: true, limits: UPLOAD_LIMITS, materialUploads: MATERIAL_UPLOADS,
        bankAccount: BANK_ACCOUNT_POLICY, workflow: service.workflowInfo(actor), notice: service.list(actor).notice }); return true;
    }
    if (url.pathname === `${root}/activities`) {
      if (req.method === 'GET') json(res, 200, service.summaries.listActivities(actor));
      else if (req.method === 'POST') json(res, 200, await service.summaries.saveActivity(actor, await readObject(req)));
      else fail(405, '活动资料不支持该操作。');
      return true;
    }
    if (url.pathname === `${root}/ledger` && req.method === 'GET') { json(res, 200, service.ledger.list(actor, Object.fromEntries(url.searchParams))); return true; }
    if (url.pathname === `${root}/ledger/export` && req.method === 'POST') {
      const file = service.ledger.exportFile(actor, await readObject(req));
      res.writeHead(200, { ...securityHeaders(), 'Content-Type': file.contentType, 'Cache-Control': 'no-store',
        'Content-Disposition': `attachment; filename="reimbursements.xlsx"; filename*=UTF-8''${encodeURIComponent(file.name)}`, 'Content-Length': file.bytes.length });
      res.end(file.bytes); return true;
    }
    const payment = url.pathname.match(/^\/api\/preview\/reimbursements\/requests\/([^/]+)\/payment$/);
    if (payment && req.method === 'POST') { const result = await service.registerPayment(actor, payment[1], await readObject(req)); json(res, result.duplicate ? 200 : 201, result); return true; }
    const detail = url.pathname.match(/^\/api\/preview\/reimbursements\/requests\/([^/]+)$/);
    if (detail && req.method === 'GET') { json(res, 200, service.get(actor, detail[1], true)); return true; }
    if (url.pathname === `${root}/summaries/preview` && req.method === 'POST') {
      json(res, 200, service.summaries.preview(actor, await readObject(req))); return true;
    }
    if (url.pathname === `${root}/summaries`) {
      if (req.method === 'GET') json(res, 200, service.summaries.list(actor));
      else if (req.method === 'POST') { const result = await service.summaries.create(actor, await readObject(req)); json(res, result.duplicate ? 200 : 201, result); }
      else fail(405, '活动汇总不支持该操作。');
      return true;
    }
    const summary = url.pathname.match(/^\/api\/preview\/reimbursements\/summaries\/([^/]+)(?:\/(form|packet))?$/);
    if (summary && req.method === 'GET') {
      if (!summary[2]) { json(res, 200, service.summaries.get(actor, summary[1])); return true; }
      const file = service.summaries.download(actor, summary[1], summary[2]);
      res.writeHead(200, { ...securityHeaders(), 'Content-Type': 'application/pdf', 'Cache-Control': 'no-store',
        'Content-Disposition': `attachment; filename="summary.pdf"; filename*=UTF-8''${encodeURIComponent(file.name).replace(/'/g, '%27')}`, 'Content-Length': file.bytes.length });
      res.end(file.bytes); return true;
    }
    const attachment = url.pathname.match(/^\/api\/preview\/reimbursements\/bundles\/([^/]+)\/(merged|original\/(\d+))$/);
    const packets = url.pathname.match(/^\/api\/preview\/reimbursements\/requests\/([^/]+)\/material-packets(?:\/(\d+)\/(\d+)\/(merged|orderPayment))?$/);
    if (packets) {
      if (!packets[2]) {
        if (req.method === 'GET') json(res, 200, service.materialPackets.list(actor, packets[1]));
        else if (req.method === 'POST') { const result = await service.materialPackets.create(actor, packets[1], await readObject(req)); json(res, result.duplicate ? 200 : 201, result); }
        else fail(405, '按项目材料不支持该操作。');
      } else {
        if (req.method !== 'GET') fail(405, '材料下载不支持该操作。');
        const file = service.materialPackets.download(actor, packets[1], Number(packets[2]), Number(packets[3]), packets[4]);
        res.writeHead(200, { ...securityHeaders(), 'Content-Type': 'application/pdf', 'Cache-Control': 'no-store',
          'Content-Disposition': `attachment; filename="material.pdf"; filename*=UTF-8''${encodeURIComponent(file.name).replace(/'/g, '%27')}`,
          'Content-Length': file.bytes.length }); res.end(file.bytes);
      }
      return true;
    }
    if (req.method === 'GET' && attachment) {
      const file = service.attachment(actor, attachment[1], attachment[2] === 'merged' ? null : Number(attachment[3]));
      res.writeHead(200, { ...securityHeaders(), 'Content-Type': file.contentType || 'application/pdf', 'Cache-Control': 'no-store',
        'Content-Disposition': `attachment; filename="material.${materialExtension(file.name) || 'pdf'}"; filename*=UTF-8''${encodeURIComponent(file.name).replace(/'/g, '%27')}`,
        'Content-Length': file.bytes.length }); res.end(file.bytes); return true;
    }
    let payload; let status = 200;
    const analysis = url.pathname.match(/^\/api\/preview\/reimbursements\/bundles\/([^/]+)\/analyze$/);
    if (req.method === 'POST' && analysis) {
      const input = await readObject(req);
      if (Object.keys(input).some(key => key !== 'page')) fail(400, '识别请求只允许包含页码。');
      payload = await service.analyze(actor, analysis[1], input.page);
    } else if (req.method === 'POST' && url.pathname === `${root}/bundles`) {
      const type = req.headers['content-type'] || '';
      if (!type.startsWith('multipart/form-data')) fail(400, '请用文件表单上传材料。');
      const bytes = await bodyBytes(req, UPLOAD_LIMITS.totalMB * MB + 64 * 1024);
      let form;
      try { form = await new Request('http://127.0.0.1/local-pdf', { method: 'POST', headers: { 'Content-Type': type }, body: bytes }).formData(); }
      catch { fail(400, '材料文件表单无法读取。'); }
      const entries = [...form.entries()], files = entries.filter(([key]) => key !== 'manifest');
      if (!files.length || files.length > UPLOAD_LIMITS.files || files.some(([key, file]) => !['files', 'invoices', 'supporting'].includes(key) || !(file instanceof File))
        || entries.filter(([key]) => key === 'manifest').length > 1) fail(400, '请上传 1 至 10 份文件，并按发票或补充材料分类。');
      const typed = files.some(([key]) => key !== 'files');
      if (typed && files.some(([key]) => key === 'files')) fail(400, '不能混用旧上传格式与分类上传格式。');
      let manifest = files.map(() => ({}));
      if (form.has('manifest')) {
        if (!typed || typeof form.get('manifest') !== 'string') fail(400, '材料关联信息不正确。');
        try { manifest = JSON.parse(form.get('manifest')); } catch { fail(400, '材料关联信息无法读取。'); }
        if (!Array.isArray(manifest) || manifest.length !== files.length || manifest.some(value => !value || typeof value !== 'object'
          || Array.isArray(value) || Object.keys(value).some(key => !['expenseItemId', 'materialType'].includes(key))
          || (value.expenseItemId !== undefined && (typeof value.expenseItemId !== 'string' || value.expenseItemId.length > 80))
          || (value.materialType !== undefined && (typeof value.materialType !== 'string' || value.materialType.length > 40)))) fail(400, '材料关联信息须与上传文件一一对应。');
      }
      payload = await service.preprocess(actor, await Promise.all(files.map(async ([key, file], index) => ({ name: file.name,
        bytes: Buffer.from(await file.arrayBuffer()), kind: key === 'invoices' ? 'invoice' : key === 'supporting' ? 'supporting' : 'legacy',
        expenseItemId: manifest[index].expenseItemId || '', materialType: manifest[index].materialType || '' }))));
      status = 201;
    } else if (req.method === 'GET' && [root, `${root}/mine`].includes(url.pathname)) payload = service.list(actor, url.pathname === root);
    else if (req.method === 'POST' && url.pathname === root) { payload = await service.submit(actor, await readObject(req)); status = payload.duplicate ? 200 : 201; }
    else {
      const request = url.pathname.match(/^\/api\/preview\/reimbursements\/requests\/([^/]+)\/(review|resubmit)$/);
      if (request && req.method === 'POST') payload = request[2] === 'review'
        ? await service.review(actor, request[1], await readObject(req))
        : await service.submit(actor, await readObject(req), request[1]);
      else fail(404, '本地报销接口不存在。');
    }
    json(res, status, payload); return true;
  };
}
