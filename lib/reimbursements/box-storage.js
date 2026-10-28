import { uploadBuffer, fileLink, boxStatus } from '../attachment/box.js';
import { runExternalRequest } from '../http/external-request.js';
import { checksum, storageFailure } from './material-codec.js';
import { REIMBURSEMENT_BOX_DIRECTORY, verifyReimbursementBoxRepository } from './box-directory.js';

/** Finance uses its own repository token, never another module's main token. */
export function createReimbursementBox(config = {}) {
  const root = config.directory || REIMBURSEMENT_BOX_DIRECTORY;
  if (typeof root !== 'string' || !root.startsWith('/') || root === '/' || root.endsWith('/') || /[\\\x00-\x1f\x7f]/.test(root)
    || root.slice(1).split('/').some(part => !part || ['.', '..'].includes(part))) {
    throw storageFailure('reimbursement_box_invalid_directory');
  }
  const server = new URL(config.server || 'https://box.nju.edu.cn');
  if (server.protocol !== 'https:' || server.username || server.password || server.pathname !== '/' || server.search || server.hash) {
    throw storageFailure('reimbursement_box_invalid_server');
  }
  // Upload links carry credentials too. Apply the same origin/redirect boundary
  // to every request, including the shared Box client's multipart upload.
  const transport = async (url, init = {}) => {
    const target = new URL(url);
    if (target.origin !== server.origin || target.protocol !== 'https:' || target.username || target.password) {
      throw storageFailure('reimbursement_box_invalid_link');
    }
    const response = await (config.fetch || fetch)(target.href, { ...init, redirect: 'error' });
    if (response.ok && (init.method || 'GET') === 'GET' && target.pathname.endsWith('/via-repo-token/dir/')) {
      let data; try { data = await response.clone().json(); } catch { throw storageFailure('reimbursement_box_invalid_directory'); }
      if (!Array.isArray(data?.dirent_list) || data.dirent_list.some(entry => !entry || typeof entry.name !== 'string'
        || !['dir', 'file'].includes(entry.type))) throw storageFailure('reimbursement_box_invalid_directory');
    }
    return response;
  };
  const boxConfig = { njuboxServerUrl: config.server || 'https://box.nju.edu.cn', njuboxToken: config.token || '',
    njuboxFetch: transport };
  const assertConfigured = () => { if (!boxStatus(boxConfig).configured) throw storageFailure('reimbursement_box_not_configured'); };
  let repositoryCheck;
  const verifyRepository = async () => {
    if (!config.repoId) return;
    repositoryCheck ||= verifyReimbursementBoxRepository(config).catch(error => { repositoryCheck = null; throw error; });
    await repositoryCheck;
  };
  const pathFor = sha => `${root}/对象/${sha.slice(0, 2)}/${sha}.bin`;
  return { configured: boxStatus(boxConfig).configured, assertConfigured,
    async put({ sha256, bytes }) {
      assertConfigured();
      if (!/^[a-f0-9]{64}$/.test(sha256) || checksum(bytes) !== sha256) throw storageFailure();
      await verifyRepository();
      const path = pathFor(sha256), dir = path.slice(0, path.lastIndexOf('/'));
      const result = await uploadBuffer(boxConfig, { dir, filename: `${sha256}.bin`, buffer: bytes });
      if (result.path !== path || !result.fileId) throw storageFailure('reimbursement_box_save_failed');
      return { sha256, size: bytes.length, path };
    },
    async read(ref) {
      assertConfigured();
      if (!ref || !/^[a-f0-9]{64}$/.test(ref.sha256) || ref.path !== pathFor(ref.sha256)
        || !Number.isSafeInteger(ref.size) || ref.size < 0 || ref.size > 100 * 1024 ** 2) throw storageFailure();
      await verifyRepository();
      const link = new URL(await fileLink(boxConfig, ref.path)), origin = new URL(boxConfig.njuboxServerUrl);
      if (link.origin !== origin.origin || link.protocol !== 'https:' || link.username || link.password) throw storageFailure();
      return runExternalRequest(async signal => {
        const response = await transport(link.href, { signal });
        if (!response.ok || Number(response.headers.get('content-length')) > ref.size) throw storageFailure();
        const parts = []; let size = 0;
        for await (const part of response.body) { size += part.length; if (size > ref.size) throw storageFailure(); parts.push(Buffer.from(part)); }
        return Buffer.concat(parts);
      }, { service: 'njubox', operation: 'read' });
    },
  };
}
