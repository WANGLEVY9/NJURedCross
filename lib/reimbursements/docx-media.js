import { readZip } from './docx-writer.js';

const PNG = Buffer.from('89504e470d0a1a0a', 'hex');
const JPEG = Buffer.from('ffd8ff', 'hex');
const GIF = Buffer.from('474946383', 'hex');

export function sniffImage(bytes) {
  if (!bytes?.length) return null;
  if (bytes.subarray(0, 8).equals(PNG)) return 'png';
  if (bytes.subarray(0, 3).equals(JPEG)) return 'jpeg';
  if (bytes.subarray(0, 4).toString('latin1') === 'GIF8') return 'gif';
  if (bytes.subarray(0, 2).toString('latin1') === 'BM') return 'bmp';
  return null;
}

function relationshipTargets(xml) {
  const targets = new Map();
  for (const match of xml.matchAll(/<Relationship\b[^>]*>/g)) {
    const tag = match[0];
    if (/TargetMode\s*=\s*"External"/i.test(tag)) continue;
    const id = tag.match(/\bId\s*=\s*"([^"]+)"/)?.[1];
    const target = tag.match(/\bTarget\s*=\s*"([^"]+)"/)?.[1];
    if (id && target) targets.set(id, target.replace(/^\/?word\//, '').replace(/^\.\//, ''));
  }
  return targets;
}

/**
 * Extract pictures from a Word document in reading order.
 *
 * Word stores pictures as OPC parts; the visible order is defined by `r:embed` references in
 * document.xml, never by part names. Only raster pictures are returned — SmartArt, charts and
 * embedded objects have no page image and are reported through `skipped`.
 */
export function extractDocxImages(bytes) {
  const parts = readZip(Buffer.from(bytes));
  const documentXml = parts.get('word/document.xml')?.toString('utf8') || '';
  const relsXml = parts.get('word/_rels/document.xml.rels')?.toString('utf8') || '';
  const targets = relationshipTargets(relsXml);
  const images = [], seen = new Set(), skipped = [];
  for (const match of documentXml.matchAll(/r:embed\s*=\s*"([^"]+)"/g)) {
    const target = targets.get(match[1]);
    if (!target || seen.has(target)) continue;
    seen.add(target);
    const data = parts.get(`word/${target}`);
    const kind = sniffImage(data);
    if (!kind) { if (target) skipped.push(target); continue; }
    images.push({ name: target.split('/').pop() || target, part: target, bytes: data, extension: kind });
  }
  if (!images.length) {
    for (const [name, data] of parts) {
      if (!/^word\/media\//i.test(name)) continue;
      const kind = sniffImage(data);
      if (!kind) { skipped.push(name); continue; }
      images.push({ name: name.split('/').pop() || name, part: name, bytes: data, extension: kind });
    }
  }
  return { images, skipped };
}
