import { PDFDocument } from 'pdf-lib';

/** Copies only previously validated pages, preserving their geometry and original evidence. */
export async function generateItemPackets({ merged, sources, groups }) {
  const sourcePdf = merged.length ? await PDFDocument.load(merged, { updateMetadata: false }) : null;
  async function packet(indices) {
    const doc = await PDFDocument.create(), sourcesWithPages = [], pages = new Set();
    for (const index of indices) {
      const source = sources[index];
      if (!source || !Number.isInteger(source.pages) || source.pages < 0) throw new Error('Invalid source');
      if (!source.pages) continue;
      if (!sourcePdf || !Number.isInteger(source.startPage) || !Number.isInteger(source.endPage)
        || source.startPage < 1 || source.endPage > sourcePdf.getPageCount()
        || source.endPage - source.startPage + 1 !== source.pages) throw new Error('Invalid source pages');
      sourcesWithPages.push({ index, source });
      for (let page = source.startPage; page <= source.endPage; page++) pages.add(page);
    }
    // Keep the composer’s page order for trip sheets and layouts with shared evidence.
    const ordered = [...pages].sort((a, b) => a - b);
    if (ordered.length) for (const page of await doc.copyPages(sourcePdf, ordered.map(pg => pg - 1))) doc.addPage(page);
    const placed = new Map(ordered.map((page, index) => [page, index + 1]));
    const manifest = sourcesWithPages.map(({ index, source }) => ({ index, sha256: source.sha256,
      startPage: placed.get(source.startPage), endPage: placed.get(source.endPage) }));
    return { bytes: doc.getPageCount() ? Buffer.from(await doc.save()) : Buffer.alloc(0),
      pageCount: doc.getPageCount(), sources: manifest };
  }
  const results = [];
  for (const group of groups) results.push({ merged: await packet(group.indices),
    orderPayment: await packet(group.orderPaymentIndices) });
  return results;
}
