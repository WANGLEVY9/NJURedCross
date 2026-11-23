import { deflateRawSync, inflateRawSync } from 'node:zlib';

/**
 * Minimal OOXML writer for reimbursement evidence packets.
 *
 * PDF cannot embed DOCX, and the platform ships no document library, so the packet is written
 * directly as an OPC package: a stored/deflated ZIP plus the four parts Word requires. Images keep
 * their original bytes; only the container and the visible layout are generated here.
 */

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let index = 0; index < 256; index++) {
    let value = index;
    for (let bit = 0; bit < 8; bit++) value = value & 1 ? 0xedb88320 ^ (value >>> 1) : value >>> 1;
    table[index] = value >>> 0;
  }
  return table;
})();

export function crc32(bytes) {
  let value = 0xffffffff;
  for (let index = 0; index < bytes.length; index++) value = CRC_TABLE[(value ^ bytes[index]) & 0xff] ^ (value >>> 8);
  return (value ^ 0xffffffff) >>> 0;
}

/** ZIP entries keep images stored (already compressed) and deflate small XML parts. */
export function zipEntries(entries) {
  const local = [], central = [];
  let offset = 0;
  for (const entry of entries) {
    const name = Buffer.from(entry.name, 'utf8');
    const raw = Buffer.isBuffer(entry.data) ? entry.data : Buffer.from(entry.data, 'utf8');
    const stored = entry.store === true;
    const body = stored ? raw : deflateRawSync(raw, { level: 6 });
    const checksum = crc32(raw);
    const header = Buffer.alloc(30);
    header.writeUInt32LE(0x04034b50, 0); header.writeUInt16LE(20, 4); header.writeUInt16LE(0x0800, 6);
    header.writeUInt16LE(stored ? 0 : 8, 8); header.writeUInt16LE(0, 10); header.writeUInt16LE(0, 12);
    header.writeUInt32LE(checksum, 14); header.writeUInt32LE(body.length, 18); header.writeUInt32LE(raw.length, 22);
    header.writeUInt16LE(name.length, 26); header.writeUInt16LE(0, 28);
    local.push(header, name, body);
    const directory = Buffer.alloc(46);
    directory.writeUInt32LE(0x02014b50, 0); directory.writeUInt16LE(20, 4); directory.writeUInt16LE(20, 6);
    directory.writeUInt16LE(0x0800, 8); directory.writeUInt16LE(stored ? 0 : 8, 10);
    directory.writeUInt16LE(0, 12); directory.writeUInt16LE(0, 14);
    directory.writeUInt32LE(checksum, 16); directory.writeUInt32LE(body.length, 20); directory.writeUInt32LE(raw.length, 24);
    directory.writeUInt16LE(name.length, 28); directory.writeUInt16LE(0, 30); directory.writeUInt16LE(0, 32);
    directory.writeUInt16LE(0, 34); directory.writeUInt16LE(0, 36); directory.writeUInt32LE(0, 38);
    directory.writeUInt32LE(offset, 42);
    central.push(directory, name);
    offset += header.length + name.length + body.length;
  }
  const directoryBytes = Buffer.concat(central), end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0); end.writeUInt16LE(0, 4); end.writeUInt16LE(0, 6);
  end.writeUInt16LE(entries.length, 8); end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(directoryBytes.length, 12); end.writeUInt32LE(offset, 16); end.writeUInt16LE(0, 20);
  return Buffer.concat([...local, directoryBytes, end]);
}

/** Read entry payloads from an OPC package; names are trusted only after the caller validates structure. */
export function readZip(buffer) {
  const result = new Map();
  let end = -1;
  for (let index = buffer.length - 22; index >= Math.max(0, buffer.length - 65557); index--) {
    if (buffer.readUInt32LE(index) === 0x06054b50) { end = index; break; }
  }
  if (end < 0) return result;
  const count = buffer.readUInt16LE(end + 10);
  let cursor = buffer.readUInt32LE(end + 16);
  for (let index = 0; index < count; index++) {
    if (cursor + 46 > end || buffer.readUInt32LE(cursor) !== 0x02014b50) break;
    const method = buffer.readUInt16LE(cursor + 10), packed = buffer.readUInt32LE(cursor + 20);
    const nameLength = buffer.readUInt16LE(cursor + 28), extra = buffer.readUInt16LE(cursor + 30), comment = buffer.readUInt16LE(cursor + 32);
    const offset = buffer.readUInt32LE(cursor + 42);
    const name = buffer.subarray(cursor + 46, cursor + 46 + nameLength).toString('utf8');
    const start = offset + 30 + buffer.readUInt16LE(offset + 26) + buffer.readUInt16LE(offset + 28);
    const body = buffer.subarray(start, start + packed);
    try { result.set(name, method === 8 ? inflateRawSync(body, { maxOutputLength: 64 * 1024 * 1024 }) : body); } catch { /* unreadable parts stay absent */ }
    cursor += 46 + nameLength + extra + comment;
  }
  return result;
}

const EMU_PER_CM = 360000;
const CONTENT_WIDTH = 17 * EMU_PER_CM;
const CONTENT_HEIGHT = 22.5 * EMU_PER_CM;
const escapeXml = (value) => String(value ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;')
  .replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/[\x00-\x08\x0b\x0c\x0e-\x1f]/g, '');

const CONTENT_TYPES = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
<Default Extension="xml" ContentType="application/xml"/>
<Default Extension="png" ContentType="image/png"/>
<Default Extension="jpeg" ContentType="image/jpeg"/>
<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>
</Types>`;

const ROOT_RELS = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
<Relationship Id="rIdDocument" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>
</Relationships>`;

const BODY_FONT = '<w:rFonts w:ascii="Times New Roman" w:hAnsi="Times New Roman" w:eastAsia="宋体"/>';

function paragraph(text, { bold = false, size = 21, color = '', align = '', before = 0, after = 60 } = {}) {
  const run = `<w:r><w:rPr>${BODY_FONT}${bold ? '<w:b/>' : ''}${color ? `<w:color w:val="${color}"/>` : ''}<w:sz w:val="${size}"/><w:szCs w:val="${size}"/></w:rPr><w:t xml:space="preserve">${escapeXml(text)}</w:t></w:r>`;
  return `<w:p><w:pPr>${align ? `<w:jc w:val="${align}"/>` : ''}<w:spacing w:before="${before}" w:after="${after}" w:line="300" w:lineRule="auto"/></w:pPr>${run}</w:p>`;
}

function tableRow(label, value) {
  const cell = (text, bold) => `<w:tc><w:tcPr><w:tcW w:w="${bold ? 2200 : 7200}" w:type="dxa"/><w:tcMar><w:top w:w="60" w:type="dxa"/><w:bottom w:w="60" w:type="dxa"/><w:left w:w="120" w:type="dxa"/><w:right w:w="120" w:type="dxa"/></w:tcMar></w:tcPr>${paragraph(text, { bold, size: 20, after: 0 })}</w:tc>`;
  return `<w:tr>${cell(label, true)}${cell(value, false)}</w:tr>`;
}

function drawing(relationId, id, width, height, name) {
  const ratio = height / width;
  let cx = CONTENT_WIDTH, cy = Math.round(cx * ratio);
  if (cy > CONTENT_HEIGHT) { cy = CONTENT_HEIGHT; cx = Math.round(cy / ratio); }
  return `<w:p><w:pPr><w:jc w:val="center"/><w:spacing w:before="60" w:after="120"/></w:pPr><w:r><w:drawing>
<wp:inline distT="0" distB="0" distL="0" distR="0"><wp:extent cx="${cx}" cy="${cy}"/>
<wp:docPr id="${id}" name="${escapeXml(name)}" descr="${escapeXml(name)}"/>
<a:graphic><a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/picture"><pic:pic>
<pic:nvPicPr><pic:cNvPr id="${id}" name="${escapeXml(name)}"/><pic:cNvPicPr/></pic:nvPicPr>
<pic:blipFill><a:blip r:embed="${relationId}"/><a:stretch><a:fillRect/></a:stretch></pic:blipFill>
<pic:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="${cx}" cy="${cy}"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom></pic:spPr>
</pic:pic></a:graphicData></a:graphic></wp:inline></w:drawing></w:r></w:p>`;
}

/**
 * Build one evidence document.
 * sections: [{ title, meta:[{label,value}], groups:[{ heading, note, images:[{bytes, extension, width, height, caption}] }] }]
 */
export function buildEvidenceDocx({ title, subtitle = '', meta = [], groups = [], footer = '' }) {
  const media = [], relationships = [], body = [];
  let imageIndex = 0, drawingId = 0;
  body.push(paragraph(title, { bold: true, size: 32, align: 'center', before: 0, after: 80 }));
  if (subtitle) body.push(paragraph(subtitle, { size: 20, color: '595959', align: 'center', after: 160 }));
  if (meta.length) {
    body.push(`<w:tbl><w:tblPr><w:tblW w:w="9400" w:type="dxa"/><w:tblLayout w:type="fixed"/><w:tblBorders>
<w:top w:val="single" w:sz="4" w:space="0" w:color="BFBFBF"/><w:left w:val="single" w:sz="4" w:space="0" w:color="BFBFBF"/>
<w:bottom w:val="single" w:sz="4" w:space="0" w:color="BFBFBF"/><w:right w:val="single" w:sz="4" w:space="0" w:color="BFBFBF"/>
<w:insideH w:val="single" w:sz="4" w:space="0" w:color="BFBFBF"/><w:insideV w:val="single" w:sz="4" w:space="0" w:color="BFBFBF"/>
</w:tblBorders></w:tblPr><w:tblGrid><w:gridCol w:w="2200"/><w:gridCol w:w="7200"/></w:tblGrid>
${meta.map(item => tableRow(item.label, item.value)).join('')}</w:tbl>`);
    body.push(paragraph('', { after: 80 }));
  }
  for (const group of groups) {
    body.push(paragraph(group.heading, { bold: true, size: 24, before: 180, after: 60 }));
    if (group.note) body.push(paragraph(group.note, { size: 19, color: '595959', after: 80 }));
    for (const image of group.images) {
      imageIndex += 1; drawingId += 1;
      const extension = image.extension === 'jpg' ? 'jpeg' : image.extension;
      const fileName = `image${imageIndex}.${extension}`;
      media.push({ name: `word/media/${fileName}`, data: image.bytes, store: true });
      relationships.push(`<Relationship Id="rIdImage${imageIndex}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="media/${fileName}"/>`);
      if (image.caption) body.push(paragraph(image.caption, { size: 19, color: '404040', align: 'center', after: 40 }));
      body.push(drawing(`rIdImage${imageIndex}`, drawingId, image.width, image.height, fileName));
    }
  }
  if (footer) body.push(paragraph(footer, { size: 18, color: '7F7F7F', before: 240, after: 0 }));
  const documentXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"
 xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"
 xmlns:wp="http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing"
 xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"
 xmlns:pic="http://schemas.openxmlformats.org/drawingml/2006/picture"><w:body>
${body.join('\n')}
<w:sectPr><w:pgSz w:w="11906" w:h="16838"/><w:pgMar w:top="1134" w:right="1134" w:bottom="1134" w:left="1134" w:header="708" w:footer="708" w:gutter="0"/></w:sectPr>
</w:body></w:document>`;
  const documentRels = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
${relationships.join('\n')}
</Relationships>`;
  return zipEntries([
    { name: '[Content_Types].xml', data: CONTENT_TYPES },
    { name: '_rels/.rels', data: ROOT_RELS },
    { name: 'word/document.xml', data: documentXml },
    { name: 'word/_rels/document.xml.rels', data: documentRels },
    ...media,
  ]);
}
