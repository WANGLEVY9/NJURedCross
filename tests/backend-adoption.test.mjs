import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { Readable } from 'node:stream';
import vm from 'node:vm';
import sharp from 'sharp';
import { collectRequestBody } from '../lib/http/request-body.js';
import { validateAttendancePhoto } from '../lib/events/photo-validation.js';

const source = (await readFile(new URL('../server.js', import.meta.url), 'utf8')).replace(/\r\n/g, '\n');
const section = source.slice(source.indexOf('async function readJson(req)'), source.indexOf('function tableFrom('));
function fixture() {
  let uploads = 0;
  const box = { Request, File, Buffer, collectRequestBody, validateAttendancePhoto,
    httpError: (statusCode, message) => Object.assign(new Error(message), { statusCode }),
    randomBytes: () => Buffer.alloc(5), serverUrl: 'https://synthetic.invalid', apiToken: 'synthetic',
    uploadSeaTableImageRequest: async () => { uploads++; return 'synthetic-upload'; },
  };
  vm.createContext(box);
  vm.runInContext(section + ';globalThis.parse=readMaterialAction;globalThis.upload=uploadSeaTableImage;', box);
  return { box, uploads: () => uploads };
}
async function request(form) {
  const encoded = new Request('http://synthetic.invalid', { method: 'POST', body: form });
  const req = Readable.from([Buffer.from(await encoded.arrayBuffer())]);
  req.headers = { 'content-type': encoded.headers.get('content-type') };
  return req;
}

test('material form rejects duplicate operation fields before any upload', async () => {
  const f = fixture(), form = new FormData();
  form.append('operation', '出库'); form.append('operation', '归还');
  await assert.rejects(f.box.parse(await request(form)), { statusCode: 400 });
  assert.equal(f.uploads(), 0);
});

test('material upload enforces actual bytes even without Content-Length', async () => {
  const f = fixture(), req = Readable.from([Buffer.alloc(8 * 1024 * 1024 + 1)]);
  req.headers = { 'content-type': 'multipart/form-data; boundary=synthetic' };
  await assert.rejects(f.box.parse(req), { statusCode: 413 });
  assert.equal(f.uploads(), 0);
});

test('material image must fully decode and match its MIME before remote upload', async () => {
  const f = fixture();
  const png = await sharp({ create: { width: 8, height: 8, channels: 3, background: 'white' } }).png().toBuffer();
  await assert.rejects(f.box.upload(new File([png], 'photo.jpg', { type: 'image/jpeg' })), { statusCode: 400 });
  await assert.rejects(f.box.upload(new File([png.subarray(0, 16)], 'photo.png', { type: 'image/png' })), { statusCode: 400 });
  assert.equal(f.uploads(), 0);
  assert.equal(await f.box.upload(new File([png], 'photo.png', { type: 'image/png' })), 'synthetic-upload');
  assert.equal(f.uploads(), 1);
});
