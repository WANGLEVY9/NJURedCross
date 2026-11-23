import { PDFDocument } from 'pdf-lib';

/** Copies only previously validated pages, preserving their geometry and original evidence. */
export async function generateItemPackets({ merged, sources, groups }) {
  const sourcePdf = merged.length ? await PDFDocument.load(merged, { updateMetadata: false }) : null;
  async function packet(indices) {
    const doc = await PDFDocument.create(), manifest = [], placed = new Map();
    for (const index of indices) {
      const source = sources[index];
      if (!source || !Number.isInteger(source.pages) || source.pages < 0) throw new Error('Invalid source');
      if (!source.pages) continue; // Word originals remain separate downloads.
      if (!sourcePdf || !Number.isInteger(source.startPage) || !Number.isInteger(source.endPage)
        || source.startPage < 1 || source.endPage > sourcePdf.getPageCount()
        || source.endPage - source.startPage + 1 !== source.pages) throw new Error('Invalid source pages');
      // Order and payment screenshots share one page in the merged evidence PDF, so a source page
      // is copied at most once per packet and both manifests point at the same page.
      const pages = [];
      for (let page = source.startPage - 1; page <= source.endPage - 1; page++) if (!placed.has(page)) pages.push(page);
      if (pages.length) {
        const startPage = doc.getPageCount() + 1;
        for (const page of await doc.copyPages(sourcePdf, pages)) doc.addPage(page);
        pages.forEach((page, offset) => placed.set(page, startPage + offset));
      }
      manifest.push({ index, sha256: source.sha256, startPage: placed.get(source.startPage - 1), endPage: placed.get(source.endPage - 1) });
    }
    return { bytes: doc.getPageCount() ? Buffer.from(await doc.save()) : Buffer.alloc(0),
      pageCount: doc.getPageCount(), sources: manifest };
  }
  const results = [];
  for (const group of groups) results.push({ merged: await packet(group.indices),
    orderPayment: await packet(group.orderPaymentIndices) });
  return results;
}
