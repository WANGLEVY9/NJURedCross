import test from 'node:test';
import assert from 'node:assert/strict';
import * as box from '../lib/attachment/box.js';
import {
  MEDIA_OTHER_DIR,
  MEDIA_OTHER_DIR_LEGACY,
  MEDIA_ACTIVITY_DIR_TEMPLATE,
  MEDIA_PHOTO_DIR_TEMPLATE,
  STORAGE_ROOTS,
  SUBMISSION_SUBDIRS,
  mediaActivityDir,
  mediaPhotoDir,
  mediaOtherDir,
  mediaStoragePath,
  submissionStoragePath,
  NAMING_DECISION,
} from '../lib/attachment/store.js';

/* -------------------------------------------------------------------------- *
 * S2 —— v3 存储架构（N4）
 * 覆盖：双库令牌接入、via-repo-token 前缀、目录构造、幂等建目录、跨库复制。
 * -------------------------------------------------------------------------- */

const CONFIG = {
  njuboxServerUrl: 'https://box.nju.edu.cn',
  njuboxToken: 'main-t',
  njuboxPicksToken: 'picks-t',
  njuboxSubmissionsDir: '/内容投稿',
  njuboxMediaDir: '/影像素材',
  njuboxShowcaseDir: '/宣传展示',
};

/** 通用 mock：记录请求 + 按端点返回合理响应。 */
function mockBox(calls = [], { onDir = null } = {}) {
  return async (url, init = {}) => {
    const href = String(url);
    const method = init.method || 'GET';
    calls.push({ href, method, auth: init.headers?.Authorization, form: init.body ?? null });
    if (href.includes('/dir/?') && method === 'GET') {
      const path = decodeURIComponent(new URL(href).searchParams.get('path') || '/');
      const entries = onDir ? onDir(path) : [];
      return new Response(JSON.stringify({ dirent_list: entries }), { status: 200 });
    }
    if (href.includes('/upload-link/')) return new Response(JSON.stringify('https://box.nju.edu.cn/seafhttp/upload/x'), { status: 200 });
    if (href.includes('/download-link/')) return new Response(JSON.stringify('https://box.nju.edu.cn/seafhttp/files/y'), { status: 200 });
    if (href.includes('/seafhttp/upload/')) return new Response('commit-1', { status: 200 });
    if (href.includes('/seafhttp/files/')) return new Response('payload-bytes', { status: 200 });
    return new Response('ok', { status: 200 });
  };
}

/* -------------------------------- 常量与命名 -------------------------------- */

test('S2 目录常量：三个根 + 影像子结构 + 其他资料命名', () => {
  assert.equal(STORAGE_ROOTS.submissions, '/内容投稿');
  assert.equal(STORAGE_ROOTS.media, '/影像素材');
  assert.equal(STORAGE_ROOTS.showcase, '/宣传展示');
  assert.equal(MEDIA_ACTIVITY_DIR_TEMPLATE, '{activity}-{center}');
  assert.equal(MEDIA_PHOTO_DIR_TEMPLATE, '{activity}-照片');
  // Q4 用户确认：其他文件 → 其他资料；旧名保留为 legacy 常量。
  assert.equal(MEDIA_OTHER_DIR, '其他资料');
  assert.equal(MEDIA_OTHER_DIR_LEGACY, '其他文件');
  assert.equal(NAMING_DECISION.otherFilesDir, MEDIA_OTHER_DIR);
  // Q2：投稿单独开根，内分文字稿件 / 文创设计。
  assert.equal(SUBMISSION_SUBDIRS.article, '文字稿件');
  assert.equal(SUBMISSION_SUBDIRS.design, '文创设计');
});

test('S2 影像目录构造：<活动名>-<中心> / <活动名>-照片 / 其他资料', () => {
  assert.equal(mediaActivityDir('献血活动', '生命中心'), '献血活动-生命中心');
  assert.equal(mediaActivityDir('献血活动', ''), '献血活动', '缺中心时退化为活动名');
  assert.equal(mediaPhotoDir('献血活动'), '献血活动-照片');
  assert.equal(mediaOtherDir(), '其他资料');
  const photo = mediaStoragePath('无偿献血进校园', '博爱中心');
  assert.equal(photo.dir, '/影像素材/无偿献血进校园-博爱中心/无偿献血进校园-照片');
  const other = mediaStoragePath('无偿献血进校园', '博爱中心', { subdir: 'other' });
  assert.equal(other.dir, '/影像素材/无偿献血进校园-博爱中心/其他资料');
});

test('S2 投稿目录构造：/内容投稿/<分类>/<附件ID>', () => {
  assert.equal(submissionStoragePath('article', 'ATT-1').dir, '/内容投稿/文字稿件/ATT-1');
  assert.equal(submissionStoragePath('design', 'ATT-2').dir, '/内容投稿/文创设计/ATT-2');
  // 未知 kind 归入文字稿件（保守兜底）。
  assert.equal(submissionStoragePath('', 'ATT-3').dir, '/内容投稿/文字稿件/ATT-3');
});

test('S2 目录名清洗：非法字符不进入路径', () => {
  const p = mediaStoragePath('活动/名称', '生命中心');
  assert.ok(!p.dir.includes('//'), 'no double slash');
  assert.match(p.dir, /^\/影像素材\/.+-生命中心\/.+$/);
});

/* -------------------------------- 双库接入 -------------------------------- */

test('S2 双库状态：主库与精选库各自独立', () => {
  const dual = box.boxLibrariesStatus(CONFIG);
  assert.equal(dual.main.library, 'main');
  assert.equal(dual.main.libraryName, '平台文件存储');
  assert.equal(dual.picks.library, 'picks');
  assert.equal(dual.picks.libraryName, '南大红会图片素材库');
  assert.equal(dual.configured, true);
  assert.equal(dual.picksConfigured, true);
  assert.equal(box.boxLibrariesStatus({ njuboxToken: 'only' }).picksConfigured, false);
});

test('S2 端点契约：Bearer 鉴权 + via-repo-token 前缀 + 无 repoId', async () => {
  const calls = [];
  const fetchImpl = mockBox(calls);
  const cfg = { ...CONFIG, njuboxFetch: fetchImpl };
  await box.fileLink(cfg, '/内容投稿/文字稿件/A/a.pdf');
  await box.uploadBuffer(cfg, { dir: '/影像素材/X-生命中心/X-照片', filename: 'a.jpg', buffer: Buffer.from('1'), contentType: 'image/jpeg' });
  for (const call of calls) {
    if (call.href.includes('/seafhttp/')) continue; // 上传直链是独立主机路径
    assert.match(call.href, /\/api\/v2\.1\/via-repo-token\//, `expected via-repo-token: ${call.href}`);
    assert.ok(!call.href.includes('/api2/repos/'), 'legacy prefix must not appear');
    assert.equal(call.auth, 'Bearer main-t');
  }
  assert.ok(calls.every((c) => !/[?&](repo|repo_id)=/.test(c.href)), 'repoId must not be a query param');
});

test('S2 精选库请求携带精选令牌', async () => {
  const calls = [];
  const fetchImpl = mockBox(calls);
  await box.listDir({ ...CONFIG, njuboxFetch: fetchImpl }, '/', { libraryId: 'picks' });
  assert.equal(calls[0].auth, 'Bearer picks-t');
});

/* -------------------------------- 幂等建目录 -------------------------------- */

test('S2 ensureDir 幂等：已存在目录不会被建成「名字 (1)」', async () => {
  const calls = [];
  // 模拟真实 Seafile：根下已有 影像素材。
  const fetchImpl = mockBox(calls, {
    onDir: (path) => (path === '/' ? [{ type: 'dir', name: '影像素材' }] : []),
  });
  const result = await box.ensureDir({ ...CONFIG, njuboxFetch: fetchImpl }, '/影像素材/献血活动-生命中心');
  assert.deepEqual(result.existing, ['/影像素材']);
  assert.deepEqual(result.created, ['/影像素材/献血活动-生命中心']);
  const mkdirs = calls.filter((c) => c.method === 'POST');
  assert.equal(mkdirs.length, 1, 'only the missing segment is created');
});

test('S2 ensureDir 逐层创建不存在的路径', async () => {
  const calls = [];
  const fetchImpl = mockBox(calls, { onDir: () => [] });
  const result = await box.ensureDir({ ...CONFIG, njuboxFetch: fetchImpl }, '/内容投稿/文字稿件/ATT-9');
  assert.deepEqual(result.created, ['/内容投稿', '/内容投稿/文字稿件', '/内容投稿/文字稿件/ATT-9']);
  assert.equal(result.existing.length, 0);
});

test('S2 路径必须绝对：相对路径直接拒绝', async () => {
  await assert.rejects(
    () => box.ensureDir({ ...CONFIG, njuboxFetch: mockBox() }, '影像素材/献血'),
    /必须以 \/ 开头/,
  );
});

test('S2 未配置令牌时抛 NjuboxStorageNotConfigured（503 语义）', async () => {
  await assert.rejects(
    () => box.uploadBuffer({ njuboxServerUrl: 'https://box.nju.edu.cn' }, { dir: '/x', filename: 'a.jpg', buffer: Buffer.from('1') }),
    (error) => error.code === 'njubox_not_configured' && error.statusCode === 503,
  );
  assert.equal(box.boxStatus({}).configured, false);
});

/* -------------------------------- 跨库复制 -------------------------------- */

test('S2 跨库复制：读主库直链 → 写精选库，原库不删', async () => {
  const calls = [];
  const fetchImpl = mockBox(calls);
  const copied = await box.copyBetweenLibraries({ ...CONFIG, njuboxFetch: fetchImpl }, {
    sourcePath: '/影像素材/X-生命中心/X-照片/a.jpg',
    targetDir: '/主席团-南大红会简介',
    filename: 'a.jpg',
  });
  assert.equal(copied.path, '/主席团-南大红会简介/a.jpg');
  assert.equal(copied.size, Buffer.byteLength('payload-bytes'));
  // 读取用主库令牌，写入用精选库令牌。
  const readCall = calls.find((c) => c.href.includes('/download-link/'));
  assert.equal(readCall.auth, 'Bearer main-t');
  const uploadCall = calls.find((c) => c.href.includes('/seafhttp/upload/'));
  assert.equal(uploadCall.auth, 'Bearer picks-t');
});

test('S2 跨库复制：缺精选令牌时拒绝（不静默落主库）', async () => {
  await assert.rejects(
    () => box.copyBetweenLibraries({ ...CONFIG, njuboxPicksToken: '', njuboxFetch: mockBox() }, {
      sourcePath: '/a/b.jpg', targetDir: '/x', filename: 'b.jpg',
    }),
    (error) => error.code === 'njubox_not_configured',
  );
});

/* -------------------------------- 删除语义 -------------------------------- */

test('S2 deleteDir 允许删非空目录（Seafile 递归语义）', async () => {
  const calls = [];
  const fetchImpl = mockBox(calls);
  const ok = await box.deleteDir({ ...CONFIG, njuboxFetch: fetchImpl }, '/影像素材/活动-中心/活动-照片');
  assert.equal(ok, true);
  const del = calls.find((c) => c.method === 'DELETE');
  assert.match(del.href, /\/dir\/\?path=/);
});

test('S2 上传返回 fileId 与完整落点', async () => {
  const stored = await box.uploadBuffer({ ...CONFIG, njuboxFetch: mockBox() }, {
    dir: '/影像素材/活动-中心/活动-照片',
    filename: '照片.jpg',
    buffer: Buffer.from('bytes'),
    contentType: 'image/jpeg',
  });
  assert.equal(stored.fileId, 'commit-1');
  assert.equal(stored.path, '/影像素材/活动-中心/活动-照片/照片.jpg');
  assert.equal(stored.dir, '/影像素材/活动-中心/活动-照片');
});

test('S2 checksum 稳定（SHA-256 十六进制）', () => {
  const a = box.checksum(Buffer.from('njuredcross'));
  assert.match(a, /^[0-9a-f]{64}$/);
  assert.equal(a, box.checksum(Buffer.from('njuredcross')));
});
