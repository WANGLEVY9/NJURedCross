/** Original bytes stay behind authenticated Box-backed routes until a new version is submitted. */
export function retainedMaterialEntries(request) {
  return (request.bundle?.originalUrls || []).map((original, index) => ({
    file: { name: original.originalName || original.name, size: original.size || 0 },
    kind: original.kind || 'legacy', expenseItemId: original.expenseItemId || '', materialType: original.materialType || '',
    retained: true, originalIndex: index, url: original.url,
  }));
}

export async function materialUploadForm(files, { typedUploads, revisionSource = null, retainOnServer = false }) {
  const data = new FormData(), uploads = files.filter(entry => !entry.retained);
  if (revisionSource && retainOnServer) {
    data.append('revisionSource', JSON.stringify({ ...revisionSource, entries: files.map(entry => ({
      ...(entry.retained ? { originalIndex: entry.originalIndex } : { uploadIndex: uploads.indexOf(entry) }),
      expenseItemId: entry.expenseItemId || '', materialType: entry.materialType || '',
    })) }));
  }
  const toUpload = revisionSource && retainOnServer ? uploads : files;
  for (const entry of toUpload) {
    let file = entry.file;
    if (entry.retained) {
      // Compatibility with the preserved 3127 preview; never follow arbitrary caller URLs.
      const url = new URL(entry.url, location.origin);
      const prefix = /^\/api\/(?:preview\/)?reimbursements\/bundles\//;
      if (!revisionSource || url.origin !== location.origin || !prefix.test(url.pathname)
        || !url.pathname.endsWith(`/${encodeURIComponent(revisionSource.bundleId)}/original/${entry.originalIndex}`)) throw Error('原附件地址不正确，请重新打开申请。');
      const response = await fetch(url, { credentials: 'same-origin', cache: 'no-store', redirect: 'error' });
      if (!response.ok) throw Error('原附件读取失败，现有材料已保留，请稍后重试。');
      file = new File([await response.blob()], entry.file.name, { type: response.headers.get('content-type') || 'application/octet-stream' });
    }
    data.append(typedUploads ? entry.kind === 'invoice' ? 'invoices' : 'supporting' : 'files', file);
  }
  if (typedUploads) data.append('manifest', JSON.stringify(toUpload.map(entry => ({ expenseItemId: entry.expenseItemId, materialType: entry.materialType || '' }))));
  return data;
}
