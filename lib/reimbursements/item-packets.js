import { PDFDocument } from 'pdf-lib';

/** Copies only previously validated pages, preserving their geometry and original evidence. */
export async function generateItemPackets({ merged, sources, groups }) {
  const sourcePdf = merged.length ? await PDFDocument.load(merged, { updateMetadata: false }) : null;
  async function packet(indices) {
    const doc = await PDFDocument.create(), manifest = [];
    for (const index of indices) {
      const source = sources[index];
      if (!source || !Number.isInteger(source.pages) || source.pages < 0) throw new Error('Invalid source');
      if (!source.pages) continue; // Word originals remain separate downloads.
      if (!sourcePdf || !Number.isInteger(source.startPage) || !Number.isInteger(source.endPage)
        || source.startPage < 1 || source.endPage > sourcePdf.getPageCount()
        || source.endPage - source.startPage + 1 !== source.pages) throw new Error('Invalid source pages');
      const startPage = doc.getPageCount() + 1;
      const pages = Array.from({ length: source.pages }, (_, page) => source.startPage + page - 1);
      for (const page of await doc.copyPages(sourcePdf, pages)) doc.addPage(page);
      manifest.push({ index, sha256: source.sha256, startPage, endPage: doc.getPageCount() });
    }
    return { bytes: doc.getPageCount() ? Buffer.from(await doc.save()) : Buffer.alloc(0),
      pageCount: doc.getPageCount(), sources: manifest };
  }
  const results = [];
  for (const group of groups) results.push({ merged: await packet(group.indices),
    orderPayment: await packet(group.orderPaymentIndices) });
  return results;
}
