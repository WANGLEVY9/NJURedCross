import { request } from '../core/api.js';
const root = '/api/preview/reimbursements';
export const reimbursementsApi = {
  config: () => request(`${root}/config`),
  mine: () => request(`${root}/mine`), list: () => request(root),
  upload: form => request(`${root}/bundles`, { method: 'POST', form }),
  analyze: (bundleId, page) => request(`${root}/bundles/${encodeURIComponent(bundleId)}/analyze`, { method: 'POST', body: { page } }),
  submit: (body, id = null) => request(id ? `${root}/requests/${encodeURIComponent(id)}/resubmit` : root, { method: 'POST', body }),
  review: (id, body) => request(`${root}/requests/${encodeURIComponent(id)}/review`, { method: 'POST', body }),
  requestDetails: id => request(`${root}/requests/${encodeURIComponent(id)}`),
  registerPayment: (id, body) => request(`${root}/requests/${encodeURIComponent(id)}/payment`, { method: 'POST', body }),
  ledger: filters => request(`${root}/ledger?${new URLSearchParams(filters)}`),
  materialPackets: id => request(`${root}/requests/${encodeURIComponent(id)}/material-packets`),
  generateMaterialPackets: (id, body) => request(`${root}/requests/${encodeURIComponent(id)}/material-packets`, { method: 'POST', body }),
  activities: () => request(`${root}/activities`),
  saveActivity: body => request(`${root}/activities`, { method: 'POST', body }),
  summaries: () => request(`${root}/summaries`),
  previewSummary: body => request(`${root}/summaries/preview`, { method: 'POST', body }),
  createSummary: body => request(`${root}/summaries`, { method: 'POST', body }),
};
export const reimbursementAmount = cents => `¥${(cents / 100).toFixed(2)}`;
export const operationKey = () => crypto.randomUUID();
