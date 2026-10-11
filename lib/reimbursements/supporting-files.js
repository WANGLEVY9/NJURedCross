import { inflateRawSync } from 'node:zlib';

function invalid() { throw Object.assign(new Error('Word 文件无法读取，请上传有效的 .doc 或 .docx 原件。'), { statusCode: 400 }); }

/** Inspect a bounded OOXML directory and its small content-type part; never execute or open Office. */
export function validateWord(bytes, extension) {
  const data = Buffer.from(bytes);
  if (extension === 'doc') {
    if (data.length < 1024 || !data.subarray(0, 8).equals(Buffer.from('d0cf11e0a1b11ae1', 'hex'))
      || data.readUInt16LE(28) !== 0xfffe || !((data.readUInt16LE(26) === 3 && data.readUInt16LE(30) === 9)
        || (data.readUInt16LE(26) === 4 && data.readUInt16LE(30) === 12))) invalid();
    const position = data.indexOf(Buffer.from('WordDocument\0', 'utf16le'));
    if (position < 512 || position % 128 || position + 128 > data.length || data.readUInt16LE(position + 64) !== 26
      || data[position + 66] !== 2 || !data.readUInt32LE(position + 120)) invalid();
    return;
  }
  let end = -1;
  for (let index = data.length - 22; index >= Math.max(0, data.length - 65557); index--) {
    if (data.readUInt32LE(index) === 0x06054b50 && index + 22 + data.readUInt16LE(index + 20) === data.length) { end = index; break; }
  }
  if (end < 0 || data.readUInt16LE(end + 4) || data.readUInt16LE(end + 6)) invalid();
  const count = data.readUInt16LE(end + 10), size = data.readUInt32LE(end + 12), start = data.readUInt32LE(end + 16);
  if (!count || count > 10000 || count !== data.readUInt16LE(end + 8) || start + size !== end) invalid();
  let cursor = start, contentType = '', hasDocument = false;
  const names = new Set();
  for (let index = 0; index < count; index++) {
    if (cursor + 46 > end || data.readUInt32LE(cursor) !== 0x02014b50) invalid();
    const flags = data.readUInt16LE(cursor + 8), method = data.readUInt16LE(cursor + 10);
    const packed = data.readUInt32LE(cursor + 20), unpacked = data.readUInt32LE(cursor + 24), offset = data.readUInt32LE(cursor + 42);
    const length = data.readUInt16LE(cursor + 28), extra = data.readUInt16LE(cursor + 30), comment = data.readUInt16LE(cursor + 32);
    if (cursor + 46 + length + extra + comment > end || flags & 1 || ![0, 8].includes(method) || offset + 30 > start
      || data.readUInt32LE(offset) !== 0x04034b50) invalid();
    const name = data.subarray(cursor + 46, cursor + 46 + length).toString('utf8');
    if (names.has(name) || /(?:^|\/)\.\.(?:\/|$)|vbaProject\.bin$/i.test(name)) invalid();
    names.add(name);
    const localLength = data.readUInt16LE(offset + 26), localExtra = data.readUInt16LE(offset + 28);
    const payloadStart = offset + 30 + localLength + localExtra;
    if (payloadStart + packed > start || data.readUInt16LE(offset + 6) !== flags || data.readUInt16LE(offset + 8) !== method
      || data.subarray(offset + 30, offset + 30 + localLength).toString('utf8') !== name) invalid();
    if (name === 'word/document.xml') hasDocument = unpacked > 0;
    if (name === '[Content_Types].xml') {
      if (!unpacked || unpacked > 256 * 1024 || packed > 256 * 1024) invalid();
      try {
        const payload = data.subarray(payloadStart, payloadStart + packed);
        const xml = method === 8 ? inflateRawSync(payload, { maxOutputLength: 256 * 1024 }) : payload;
        if (xml.length !== unpacked) invalid();
        contentType = xml.toString('utf8');
      } catch { invalid(); }
    }
    cursor += 46 + length + extra + comment;
  }
  if (cursor !== end || !hasDocument || !contentType.includes('application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml')) invalid();
}
