import { runExternalRequest } from './external-request.js';

export async function uploadSeaTableImageRequest(file, {
  serverUrl,
  apiToken,
  filename,
  timeoutMs,
  signal,
}) {
  if (!file) return null;
  if (!/^image\/(jpeg|png|webp)$/.test(file.type)) {
    const error = new Error('Only JPG, PNG or WebP photos are supported');
    error.statusCode = 400;
    throw error;
  }

  return runExternalRequest(async requestSignal => {
    const headers = { Authorization: `Bearer ${apiToken}` };
    const linkResponse = await fetch(
      `${serverUrl}/api/v2.1/dtable/app-upload-link/`,
      { headers, signal: requestSignal },
    );
    const link = await linkResponse.json();
    requestSignal.throwIfAborted();

    if (!linkResponse.ok || !link.upload_link) {
      throw new Error('Unable to obtain SeaTable photo upload link');
    }

    const upload = new FormData();
    upload.append(
      'file',
      new Blob([await file.arrayBuffer()], { type: file.type }),
      filename,
    );
    upload.append('parent_dir', link.parent_path);
    upload.append('relative_path', link.img_relative_path);
    upload.append('replace', '0');

    requestSignal.throwIfAborted();
    const uploadUrl = String(link.upload_link).startsWith('http')
      ? link.upload_link
      : `${serverUrl}${link.upload_link}`;

    const uploadResponse = await fetch(`${uploadUrl}?ret-json=1`, {
      method: 'POST',
      headers,
      body: upload,
      signal: requestSignal,
    });
    const result = await uploadResponse.json();
    requestSignal.throwIfAborted();

    if (!uploadResponse.ok || !result.name) {
      throw new Error('SeaTable photo upload failed');
    }

    return `/workspace/${link.workspace_id}`
      + `${String(link.parent_path).replace(/\/$/, '')}/`
      + `${String(link.img_relative_path).replace(/^\//, '')}/`
      + result.name;
  }, { timeoutMs, signal });
}