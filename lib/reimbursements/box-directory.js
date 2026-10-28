import { NJUBOX_VIA_REPO_TOKEN_PREFIX } from '../attachment/box.js';
import { runExternalRequest } from '../http/external-request.js';
import { storageFailure } from './material-codec.js';

export const REIMBURSEMENT_BOX_DIRECTORY = '/报销材料';

async function request(config, endpoint, method = 'GET') {
  if (!config.token) throw storageFailure('reimbursement_box_not_configured');
  const server = new URL(config.server || 'https://box.nju.edu.cn');
  if (server.protocol !== 'https:' || server.username || server.password) throw storageFailure('reimbursement_box_invalid_server');
  const result = await runExternalRequest(async signal => {
    const response = await (config.fetch || fetch)(`${server.origin}${NJUBOX_VIA_REPO_TOKEN_PREFIX}${endpoint}`, {
      method, signal, redirect: 'error', headers: { Authorization: `Bearer ${config.token}`,
        ...(method === 'POST' ? { 'Content-Type': 'application/x-www-form-urlencoded' } : {}) },
      ...(method === 'POST' ? { body: new URLSearchParams({ operation: 'mkdir' }).toString() } : {}),
    });
    const body = await response.text();
    let data; try { data = JSON.parse(body); } catch { /* Reject malformed responses below. */ }
    return { ok: response.ok, data };
  }, { service: 'njubox', operation: method === 'GET' ? 'reimbursement-inspect' : 'reimbursement-mkdir' });
  if (!result.ok || !result.data) throw storageFailure('reimbursement_box_invalid_response');
  return result.data;
}

export async function verifyReimbursementBoxRepository(config) {
  if (!config.repoId) throw storageFailure('reimbursement_box_repository_required');
  const info = await request(config, '/repo-info/');
  if (info.repo_id !== config.repoId) throw storageFailure('reimbursement_box_repository_mismatch');
  return { id: info.repo_id, name: String(info.repo_name || '') };
}

async function rootEntries(config) {
  const data = await request(config, '/dir/?path=%2F');
  if (!Array.isArray(data.dirent_list) || data.dirent_list.some(entry =>
    !entry || typeof entry.name !== 'string' || !['file', 'dir'].includes(entry.type))) {
    throw storageFailure('reimbursement_box_invalid_directory');
  }
  return data.dirent_list.map(({ name, type }) => ({ name, type }));
}

/** Explicit setup only; no uploads, renames, deletes or automatic mkdir retries. */
export async function prepareReimbursementBoxDirectory(config, { apply = false } = {}) {
  const directory = config.directory || REIMBURSEMENT_BOX_DIRECTORY;
  if (directory !== REIMBURSEMENT_BOX_DIRECTORY) throw storageFailure('reimbursement_box_setup_directory_mismatch');
  const repository = await verifyReimbursementBoxRepository(config), before = await rootEntries(config);
  const name = directory.slice(1), matching = before.filter(entry => entry.name === name);
  if (matching.some(entry => entry.type !== 'dir') || matching.length > 1) throw storageFailure('reimbursement_box_directory_conflict');
  let outcome = matching.length ? 'existing' : 'missing';
  if (!matching.length && apply) {
    // Seafile creates "name (1)" on duplicate mkdir. After any uncertain result,
    // reconcile with a read rather than issuing a second POST.
    try { await request(config, `/dir/?path=${encodeURIComponent(directory)}`, 'POST'); } catch { /* Reconcile below. */ }
    outcome = 'created-or-confirmed';
  }
  const after = outcome === 'created-or-confirmed' ? await rootEntries(config) : before;
  if (apply && after.filter(entry => entry.name === name && entry.type === 'dir').length !== 1) {
    throw storageFailure('reimbursement_box_directory_not_confirmed');
  }
  const otherEntries = entries => JSON.stringify(entries.filter(entry => entry.name !== name)
    .map(entry => `${entry.type}:${entry.name}`).sort());
  return { repository, directory, outcome, mkdirAttempted: outcome === 'created-or-confirmed',
    otherRootEntriesUnchanged: otherEntries(before) === otherEntries(after) };
}
