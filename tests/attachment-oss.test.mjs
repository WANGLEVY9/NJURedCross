import test from 'node:test';
import assert from 'node:assert/strict';
import {
  OSS_DEFAULT_REGION,
  OSS_LINK_TTL_MAX_SECONDS,
  OssNotConfigured,
  OssRequestError,
  ossStatus,
  buildObjectKey,
  sanitizeFilename,
  checksum,
  signedUrl,
  putObject,
  deleteObject,
  objectExists,
  probeBucket,
} from '../lib/attachment/oss.js';

// 合成凭证：仅用于签名/行为测试，不对应任何真实账号，全程不联网。
const configured = {
  aliyunOssAccessKeyId: 'LTAI-test-key-id',
  aliyunOssAccessKeySecret: 'test-secret-not-real',
  aliyunOssBucket: 'nju-rc-submissions',
  aliyunOssRegion: 'oss-cn-nanjing',
  aliyunOssUploadPrefix: 'submissions/',
};

const FIXED_DATE = new Date('2026-10-05T12:00:00.000Z');

test('ossStatus reports configuration without touching the network', () => {
  const ready = ossStatus(configured);
  assert.equal(ready.configured, true);
  assert.equal(ready.transport, 'aliyun-oss-v4');
  assert.equal(ready.bucket, 'nju-rc-submissions');
  assert.equal(ready.region, 'oss-cn-nanjing');
  assert.equal(ready.endpoint, 'https://nju-rc-submissions.oss-cn-nanjing.aliyuncs.com');
  assert.equal(ready.uploadPrefix, 'submissions');
  assert.equal(ready.linkTtlSeconds, 900);
  const empty = ossStatus({});
  assert.equal(empty.configured, false);
  assert.equal(empty.hasAccessKeyId, false);
  assert.equal(empty.bucket, '');
});

test('region accepts both cn-nanjing and oss-cn-nanjing plus explicit endpoints', () => {
  const short = ossStatus({ ...configured, aliyunOssRegion: 'cn-nanjing' });
  assert.equal(short.endpoint, 'https://nju-rc-submissions.oss-cn-nanjing.aliyuncs.com');
  assert.equal(short.region, 'oss-cn-nanjing');
  const internal = ossStatus({
    ...configured,
    aliyunOssEndpoint: 'https://oss-cn-nanjing-internal.aliyuncs.com/',
  });
  assert.equal(internal.endpoint, 'https://nju-rc-submissions.oss-cn-nanjing-internal.aliyuncs.com');
  assert.equal(ossStatus({}).region, OSS_DEFAULT_REGION);
});

test('write helpers throw OssNotConfigured (503) when credentials are missing', async () => {
  const configs = [{}, { aliyunOssAccessKeyId: 'only-ak' }, { aliyunOssBucket: 'only-bucket' }];
  for (const partial of configs) {
    await assert.rejects(
      () => putObject(partial, { key: 'a/b.txt', buffer: Buffer.from('x') }),
      (error) => {
        assert.ok(error instanceof OssNotConfigured);
        assert.equal(error.code, 'aliyun_oss_not_configured');
        assert.equal(error.statusCode, 503);
        return true;
      },
    );
    await assert.rejects(() => deleteObject(partial, 'a/b.txt'), OssNotConfigured);
    await assert.rejects(() => objectExists(partial, 'a/b.txt'), OssNotConfigured);
    assert.throws(() => signedUrl(partial, 'a/b.txt'), OssNotConfigured);
  }
});

test('putObject validates key and rejects empty bodies before signing', async () => {
  await assert.rejects(() => putObject(configured, { key: '', buffer: Buffer.from('x') }), /缺少对象 Key/);
  await assert.rejects(() => putObject(configured, { key: 'a/b' }), /缺少上传内容/);
});

test('buildObjectKey lays out prefix/id/filename and blocks traversal', () => {
  assert.equal(buildObjectKey(configured, 'ATT-X1', 'photo.jpg'), 'submissions/ATT-X1/photo.jpg');
  assert.equal(
    buildObjectKey({ ...configured, aliyunOssUploadPrefix: 'submissions' }, 'ATT-X1', 'photo.jpg'),
    'submissions/ATT-X1/photo.jpg',
  );
  assert.equal(buildObjectKey({ ...configured, aliyunOssUploadPrefix: '' }, 'ATT-X1', 'photo.jpg'), 'ATT-X1/photo.jpg');
  // 路径穿越：只取末段文件名。
  assert.equal(buildObjectKey(configured, 'ATT-X1', '../../etc/passwd'), 'submissions/ATT-X1/passwd');
  assert.equal(buildObjectKey(configured, 'ATT-X1', 'a\\b\\c.txt'), 'submissions/ATT-X1/c.txt');
  // 附件 ID 注入：不允许分隔符、反斜杠与空白。
  assert.throws(() => buildObjectKey(configured, 'ATT/X', 'a.txt'), /附件 ID/);
  assert.throws(() => buildObjectKey(configured, 'ATT X', 'a.txt'), /附件 ID/);
  assert.throws(() => buildObjectKey(configured, '', 'a.txt'), /附件 ID/);
  // 文件名清洗后为空。
  assert.throws(() => buildObjectKey(configured, 'ATT-X1', '...'), /文件名/);
});

test('sanitizeFilename strips controls, leading dots and keeps extensions', () => {
  assert.equal(sanitizeFilename('..'), '');
  assert.equal(sanitizeFilename('.hidden'), 'hidden');
  assert.equal(sanitizeFilename('a/b\\c.txt'), 'c.txt');
  assert.equal(sanitizeFilename('  name .jpg  '), 'name .jpg');
  assert.equal(sanitizeFilename('my-photo_v2 (final).png'), 'my-photo_v2 (final).png');
  const withBell = `bad${String.fromCharCode(7)}name.jpg`;
  assert.equal(sanitizeFilename(withBell), 'badname.jpg');
  const long = `${'a'.repeat(200)}.jpeg`;
  const clipped = sanitizeFilename(long);
  assert.equal(clipped.length, 120);
  assert.ok(clipped.endsWith('.jpeg'));
  assert.equal(sanitizeFilename(null), '');
  assert.equal(sanitizeFilename(42), '42');
});

test('checksum matches the shared SHA-256 convention', () => {
  assert.equal(
    checksum(Buffer.from('')),
    'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855',
  );
  assert.equal(checksum(Buffer.from('hello attachment')), checksum(Buffer.from('hello attachment')));
});

test('signedUrl is deterministic for a fixed date and encodes non-ASCII keys', () => {
  const key = 'submissions/ATT-X1/现场照片.jpg';
  const url = signedUrl(configured, key, { expiresIn: 900 }, FIXED_DATE);
  assert.equal(url, signedUrl(configured, key, { expiresIn: 900 }, FIXED_DATE));
  const parsed = new URL(url);
  assert.equal(parsed.origin, 'https://nju-rc-submissions.oss-cn-nanjing.aliyuncs.com');
  assert.equal(parsed.pathname, '/submissions/ATT-X1/%E7%8E%B0%E5%9C%BA%E7%85%A7%E7%89%87.jpg');
  assert.equal(parsed.searchParams.get('x-oss-signature-version'), 'OSS4-HMAC-SHA256');
  assert.equal(parsed.searchParams.get('x-oss-expires'), '900');
  assert.equal(parsed.searchParams.get('x-oss-date'), '20261005T120000Z');
  assert.equal(
    parsed.searchParams.get('x-oss-credential'),
    'LTAI-test-key-id/20261005/oss-cn-nanjing/oss/aliyun_v4_request',
  );
  assert.match(parsed.searchParams.get('x-oss-signature'), /^[0-9a-f]{64}$/);
});

test('signedUrl changes with date and clamps expires into the OSS window', () => {
  const key = 'submissions/ATT-X1/a.bin';
  const urlAtNoon = signedUrl(configured, key, { expiresIn: 900 }, FIXED_DATE);
  const urlAtOneSecondLater = signedUrl(configured, key, { expiresIn: 900 }, new Date('2026-10-05T12:00:01.000Z'));
  assert.notEqual(urlAtNoon, urlAtOneSecondLater);
  const clamped = new URL(signedUrl(configured, key, { expiresIn: 99999999 }, FIXED_DATE));
  assert.equal(clamped.searchParams.get('x-oss-expires'), String(OSS_LINK_TTL_MAX_SECONDS));
  const defaulted = new URL(signedUrl(configured, key, {}, FIXED_DATE));
  assert.equal(defaulted.searchParams.get('x-oss-expires'), '900');
});

test('putObject signs a PUT with V4 headers and returns etag/checksum/size', async (t) => {
  const fetchMock = t.mock.method(globalThis, 'fetch', async () => new Response(null, {
    status: 200,
    headers: { etag: '"D41D8CD98F00B204E9800998ECF8427E"' },
  }));
  const buffer = Buffer.from('hello attachment');
  const result = await putObject(configured, {
    key: 'submissions/ATT-1/现场照片.jpg',
    buffer,
    contentType: 'image/jpeg',
  });
  assert.equal(fetchMock.mock.callCount(), 1);
  const [requestUrl, init] = fetchMock.mock.calls[0].arguments;
  assert.equal(init.method, 'PUT');
  assert.equal(
    requestUrl,
    'https://nju-rc-submissions.oss-cn-nanjing.aliyuncs.com/submissions/ATT-1/%E7%8E%B0%E5%9C%BA%E7%85%A7%E7%89%87.jpg',
  );
  assert.equal(init.headers['content-type'], 'image/jpeg');
  assert.equal(init.headers.host, undefined);
  assert.match(init.headers['x-oss-date'], /^\d{8}T\d{6}Z$/);
  assert.equal(init.headers['x-oss-content-sha256'], checksum(buffer));
  assert.match(
    init.headers.authorization,
    /^OSS4-HMAC-SHA256 Credential=LTAI-test-key-id\/\d{8}\/oss-cn-nanjing\/oss\/aliyun_v4_request,AdditionalHeaders=,Signature=[0-9a-f]{64}$/,
  );
  assert.deepEqual(result, {
    key: 'submissions/ATT-1/现场照片.jpg',
    etag: 'D41D8CD98F00B204E9800998ECF8427E',
    checksum: checksum(buffer),
    size: buffer.length,
    bucket: 'nju-rc-submissions',
  });
});

test('putObject maps upstream failures to OssRequestError (502, upstream kept)', async (t) => {
  t.mock.method(globalThis, 'fetch', async () => new Response('{"Code":"AccessDenied"}', { status: 403 }));
  await assert.rejects(
    () => putObject(configured, { key: 'x/y.bin', buffer: Buffer.from('z') }),
    (error) => {
      assert.ok(error instanceof OssRequestError);
      assert.equal(error.code, 'aliyun_oss_request_failed');
      assert.equal(error.statusCode, 502);
      assert.equal(error.ossStatus, 403);
      assert.match(error.message, /HTTP 403/);
      return true;
    },
  );
});

test('deleteObject issues a signed DELETE without a body', async (t) => {
  const fetchMock = t.mock.method(globalThis, 'fetch', async () => new Response(null, { status: 204 }));
  const result = await deleteObject(configured, 'submissions/ATT-1/a.bin');
  assert.deepEqual(result, { key: 'submissions/ATT-1/a.bin', deleted: true });
  const [requestUrl, init] = fetchMock.mock.calls[0].arguments;
  assert.equal(init.method, 'DELETE');
  assert.equal(init.body, undefined);
  assert.equal(init.headers['x-oss-content-sha256'], checksum(Buffer.from('')));
  assert.equal(requestUrl, 'https://nju-rc-submissions.oss-cn-nanjing.aliyuncs.com/submissions/ATT-1/a.bin');
});

test('objectExists maps 200/404 to booleans and rethrows other statuses', async (t) => {
  const missing = t.mock.method(globalThis, 'fetch', async () => new Response(null, { status: 404 }));
  assert.equal(await objectExists(configured, 'gone.bin'), false);
  assert.equal(missing.mock.calls[0].arguments[1].method, 'HEAD');
});

test('objectExists rethrows unexpected upstream statuses as OssRequestError', async (t) => {
  t.mock.method(globalThis, 'fetch', async () => new Response('boom', { status: 500 }));
  await assert.rejects(() => objectExists(configured, 'a.bin'), OssRequestError);
});

test('probeBucket verifies credentials with a signed ListObjectsV2 call', async (t) => {
  const fetchMock = t.mock.method(globalThis, 'fetch', async () => new Response(
    '<?xml version="1.0" encoding="UTF-8"?><ListBucketResult></ListBucketResult>',
    { status: 200, headers: { 'content-type': 'application/xml' } },
  ));
  const result = await probeBucket(configured);
  assert.equal(result.ok, true);
  assert.equal(result.configured, true);
  assert.equal(result.error, null);
  const [requestUrl, init] = fetchMock.mock.calls[0].arguments;
  assert.equal(init.method, 'GET');
  assert.equal(requestUrl, 'https://nju-rc-submissions.oss-cn-nanjing.aliyuncs.com/?list-type=2&max-keys=1');
});

test('probeBucket maps 403 to a credential failure hint', async (t) => {
  t.mock.method(globalThis, 'fetch', async () => new Response('denied', { status: 403 }));
  const result = await probeBucket(configured);
  assert.equal(result.ok, false);
  assert.match(result.error, /凭证/);
});

test('probeBucket maps 404 to a bucket/region mismatch hint', async (t) => {
  t.mock.method(globalThis, 'fetch', async () => new Response('nope', { status: 404 }));
  const result = await probeBucket(configured);
  assert.equal(result.ok, false);
  assert.match(result.error, /Bucket 不存在/);
});

test('probeBucket reports unconfigured state without any network call', async (t) => {
  const fetchMock = t.mock.method(globalThis, 'fetch', async () => {
    throw new Error('network must not be touched');
  });
  const result = await probeBucket({});
  assert.equal(result.ok, false);
  assert.equal(result.configured, false);
  assert.match(result.error, /未配置/);
  assert.equal(fetchMock.mock.callCount(), 0);
});
