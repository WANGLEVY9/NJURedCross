import { createCanvas } from '@napi-rs/canvas';
import { Buffer } from 'node:buffer';
import { deflateRawSync } from 'node:zlib';

const crc32 = bytes => {
  let crc = 0xffffffff;
  for (const byte of bytes) { crc ^= byte; for (let bit = 0; bit < 8; bit++) crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0); }
  return (crc ^ 0xffffffff) >>> 0;
};

export function wordFixture({ wrongType = false } = {}) {
  const files = [['[Content_Types].xml', `<?xml version="1.0"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Override PartName="/word/document.xml" ContentType="${wrongType ? 'text/plain' : 'application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml'}"/></Types>`],
    ['_rels/.rels', '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>'],
    ['word/document.xml', '<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body><w:p><w:r><w:t>合成材料验证</w:t></w:r></w:p><w:sectPr/></w:body></w:document>']];
  const local = [], central = []; let offset = 0;
  for (const [name, content] of files) {
    const path = Buffer.from(name), bytes = Buffer.from(content), checksum = crc32(bytes), packed = deflateRawSync(bytes);
    const header = Buffer.alloc(30); header.writeUInt32LE(0x04034b50); header.writeUInt16LE(20, 4);
    header.writeUInt16LE(8, 8); header.writeUInt32LE(checksum, 14); header.writeUInt32LE(packed.length, 18); header.writeUInt32LE(bytes.length, 22); header.writeUInt16LE(path.length, 26);
    local.push(header, path, packed);
    const directory = Buffer.alloc(46); directory.writeUInt32LE(0x02014b50); directory.writeUInt16LE(20, 4); directory.writeUInt16LE(20, 6);
    directory.writeUInt16LE(8, 10); directory.writeUInt32LE(checksum, 16); directory.writeUInt32LE(packed.length, 20); directory.writeUInt32LE(bytes.length, 24); directory.writeUInt16LE(path.length, 28); directory.writeUInt32LE(offset, 42);
    central.push(directory, path); offset += header.length + path.length + packed.length;
  }
  const entries = Buffer.concat(central), end = Buffer.alloc(22); end.writeUInt32LE(0x06054b50);
  end.writeUInt16LE(files.length, 8); end.writeUInt16LE(files.length, 10); end.writeUInt32LE(entries.length, 12); end.writeUInt32LE(offset, 16);
  return Buffer.concat([...local, entries, end]);
}

export function pictureFixture(extension = 'png') {
  const canvas = createCanvas(120, 80), context = canvas.getContext('2d');
  context.fillStyle = '#fff'; context.fillRect(0, 0, 120, 80);
  context.fillStyle = '#a32438'; context.fillRect(10, 10, 100, 60);
  return canvas.toBuffer(extension === 'png' ? 'image/png' : 'image/jpeg');
}
