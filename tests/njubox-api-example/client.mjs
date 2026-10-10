import { randomUUID, createHash } from 'node:crypto';
import { pathToFileURL } from 'node:url';

export async function runProbe(config, { write = false, fetchImpl = fetch, log = () => {} } = {}) {
  const origin = new URL(config.serverUrl);
  if (origin.protocol !== 'https:' || origin.username || origin.password ||
      origin.pathname !== '/' || origin.search || origin.hash) throw Error('Use an HTTPS server origin.');
  if (!config.token || config.token.startsWith('replace-')) throw Error('Missing library API token.');
  if (!/^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(config.repoId || '')) {
    throw Error('Set the expected test library UUID.');
  }
  const base = origin.origin;
  const directory = '/_api_crud_test_' + randomUUID();
  const filename = 'probe.txt';
  const file = directory + '/' + filename;
  const query = path => '?path=' + encodeURIComponent(path);
  let created = false;
  const result = { repoId: config.repoId, write, cleanupVerified: false };

  async function request(url, options = {}) {
    const response = await fetchImpl(url, {
      ...options, redirect: 'error', signal: AbortSignal.timeout(20000),
    });
    if (!response.ok) throw Error('Request failed: HTTP ' + response.status);
    return response;
  }
  async function api(endpoint, method = 'GET', body) {
    const response = await request(base + '/api/v2.1/via-repo-token/' + endpoint, {
      method, headers: { Authorization: 'Bearer ' + config.token },
      body: body ? new URLSearchParams(body) : undefined,
    });
    // Never log credentials, signed links, response bodies or personal file names.
    log({ operation: method + ' ' + endpoint.split('?')[0], status: response.status });
    return response.json();
  }
  function fileServiceUrl(value) {
    const url = new URL(value);
    if (url.origin !== base || url.username || url.password) {
      throw Error('Unexpected file-service origin; no credential or file was sent.');
    }
    return url;
  }
  async function upload(content, replace) {
    const link = await api('upload-link/' + query(directory) + '&replace=' + (replace ? '1' : '0'));
    const url = fileServiceUrl(link);
    url.searchParams.set('ret-json', '1');
    const form = new FormData();
    form.append('parent_dir', directory);
    form.append('replace', replace ? '1' : '0');
    form.append('file', new Blob([content], { type: 'text/plain' }), filename);
    const response = await request(url, { method: 'POST', body: form });
    await response.text();
    log({ operation: replace ? 'overwrite file' : 'upload file', status: response.status });
  }
  async function verify(content) {
    const link = await api('download-link/' + query(file));
    const response = await request(fileServiceUrl(link));
    const actual = await response.text();
    if (actual !== content) throw Error('Downloaded content does not match.');
    log({ operation: 'verify content', status: response.status,
      sha256: createHash('sha256').update(actual).digest('hex'), matches: true });
  }
  const entries = data => {
    if (!Array.isArray(data.dirent_list)) throw Error('Invalid directory response.');
    return data.dirent_list;
  };
  const canonical = data => JSON.stringify(entries(data).map(item => ({
    name: item.name, id: item.id, type: item.type,
  })).sort((a, b) => a.name.localeCompare(b.name)));
  const info = await api('repo-info/');
  if (info.repo_id !== config.repoId) throw Error('Library UUID mismatch; no writes performed.');
  const before = await api('dir/' + query('/'));
  result.rootEntryCount = entries(before).length;
  log({ operation: 'target verified', repoId: info.repo_id, rootEntryCount: result.rootEntryCount,
    permission: before.user_perm });
  if (!write) return result;
  if (before.user_perm !== 'rw') throw Error('Read-write library permission required.');
  if (entries(before).some(item => item.name === directory.slice(1))) throw Error('Test path exists.');

  let failure;
  try {
    // Set before sending: a timeout can occur after the server created the directory.
    created = true;
    await api('dir/' + query(directory), 'POST', { operation: 'mkdir' });
    log({ operation: 'test directory', path: directory });
    await upload('NJU Box isolated CRUD probe: version 1\n', false);
    const listing = entries(await api('dir/' + query(directory)));
    if (listing.length !== 1 || listing[0].name !== filename || listing[0].type !== 'file') {
      throw Error('Unexpected test directory contents.');
    }
    await verify('NJU Box isolated CRUD probe: version 1\n');
    await upload('NJU Box isolated CRUD probe: version 2 UPDATED\n', true);
    await verify('NJU Box isolated CRUD probe: version 2 UPDATED\n');
    await api('file/' + query(file), 'DELETE');
    if (entries(await api('dir/' + query(directory))).length) throw Error('File deletion not verified.');
    result.crudVerified = true;
  } catch (error) {
    failure = error;
  }
  if (created) {
      try {
        const remaining = entries(await api('dir/' + query(directory)));
        if (remaining.length === 1 && remaining[0].name === filename && remaining[0].type === 'file') {
          await api('file/' + query(file), 'DELETE');
        }
        if (entries(await api('dir/' + query(directory))).length) {
          throw Error('Refusing to delete a directory containing unexpected entries.');
        }
        await api('dir/' + query(directory), 'DELETE');
        const after = await api('dir/' + query('/'));
        result.cleanupVerified = !entries(after).some(item => item.name === directory.slice(1));
        result.originalRootEntriesUnchanged = canonical(before) === canonical(after);
        if (!result.cleanupVerified) throw Error('Test directory deletion not verified.');
        log({ operation: 'cleanup verified', ...result });
      } catch {
        log({ operation: 'cleanup incomplete', path: directory,
          message: 'Inspect only this temporary test directory; do not remove unrelated files.' });
        failure = Error('Cleanup could not be confirmed. Test directory: ' + directory);
      }
  }
  if (failure) throw failure;
  return result;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const flags = process.argv.slice(2);
  if (flags.some(flag => flag !== '--write')) {
    console.error('Usage: node --env-file=.env client.mjs [--write]');
    process.exitCode = 1;
  } else {
    try {
      const result = await runProbe({
        serverUrl: process.env.NJUBOX_SERVER_URL || 'https://box.nju.edu.cn',
        token: process.env.NJUBOX_API_TOKEN,
        repoId: process.env.NJUBOX_REPO_ID,
      }, { write: flags.includes('--write'), log: event => console.log(JSON.stringify(event)) });
      console.log(JSON.stringify({ operation: 'completed', ...result }));
    } catch {
      // Fetch/SDK error causes may contain authorization values or signed URLs.
      console.error('Probe failed. Check UUID, permissions, connectivity and any cleanup message above.');
      process.exitCode = 1;
    }
  }
}
