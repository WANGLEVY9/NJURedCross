import test from 'node:test';
import assert from 'node:assert/strict';
import * as box from '../lib/attachment/box.js';
import {
  MEDIA_OTHER_DIR,
  MEDIA_OTHER_DIR_LEGACY,
  MEDIA_UNCLASSIFIED_DEPARTMENT,
  MEDIA_UNNAMED_ACTIVITY,
  MEDIA_PHOTO_DIR_TEMPLATE,
  STORAGE_ROOTS,
  STORAGE_ROOTS_LEGACY,
  SUBMISSION_SUBDIRS,
  mediaDepartmentDir,
  mediaActivityDir,
  mediaPhotoDir,
  mediaOtherDir,
  mediaStoragePath,
  submissionStoragePath,
  DESIGN_WORKGROUP_PATH,
  NAMING_DECISION,
} from '../lib/attachment/store.js';

/* -------------------------------------------------------------------------- *
 * S2 —— v3 存储架构（N4）+ v3.1 三级部门结构（2026-10-11 用户定案）
 * 覆盖：双库令牌接入、via-repo-token 前缀、目录构造、幂等建目录、跨库复制。
 * -------------------------------------------------------------------------- */

const CONFIG = {
  njuboxServerUrl: 'https://box.nju.edu.cn',
  njuboxToken: 'main-t',
  njuboxPicksToken: 'picks-t',
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

test('S2 目录常量：展示根保留 + 旧两个根降级为 legacy + 三级目录命名', () => {
  // 展示封面仍挂固定根；影像与投稿改为「部门 / 活动」动态两级，不再有固定根。
  assert.equal(STORAGE_ROOTS.showcase, '/宣传展示');
  assert.equal(STORAGE_ROOTS.media, undefined, '影像不再有固定根');
  assert.equal(STORAGE_ROOTS.submissions, undefined, '投稿不再有固定根');
  assert.equal(STORAGE_ROOTS_LEGACY.media, '/影像素材', '旧根仅用于识别历史路径');
  assert.equal(STORAGE_ROOTS_LEGACY.submissions, '/内容投稿');
  assert.equal(MEDIA_PHOTO_DIR_TEMPLATE, '{activity}-照片');
  // 用户定案：其他文件直接落二级（活动）目录，旧命名仅作兼容常量。
  assert.equal(mediaOtherDir(), '');
  assert.equal(MEDIA_OTHER_DIR, '其他资料');
  assert.equal(MEDIA_OTHER_DIR_LEGACY, '其他文件');
  assert.match(NAMING_DECISION.layout, /<部门>\/<活动名>/);
  // 旧投稿分类子目录仅作历史路径识别。
  assert.equal(SUBMISSION_SUBDIRS.article, '文字稿件');
  assert.equal(SUBMISSION_SUBDIRS.design, '文创设计');
});

test('S2 影像目录构造：/<部门>/<活动名>/<活动名>-照片', () => {
  assert.equal(mediaDepartmentDir('生命中心'), '生命中心');
  assert.equal(mediaActivityDir('献血活动'), '献血活动');
  assert.equal(mediaActivityDir(''), MEDIA_UNNAMED_ACTIVITY, '缺活动名时兜底');
  assert.equal(mediaDepartmentDir(''), MEDIA_UNCLASSIFIED_DEPARTMENT, '缺部门时兜底');
  assert.equal(mediaPhotoDir('献血活动'), '献血活动-照片');
  const photo = mediaStoragePath('无偿献血进校园', '博爱中心');
  assert.equal(photo.dir, '/博爱中心/无偿献血进校园/无偿献血进校园-照片');
  assert.equal(photo.department, '博爱中心');
  assert.equal(photo.activityDir, '无偿献血进校园');
  const other = mediaStoragePath('无偿献血进校园', '博爱中心', { subdir: 'other' });
  assert.equal(other.dir, '/博爱中心/无偿献血进校园', '其他文件落二级目录本体');
});

test('S2 投稿目录构造：/<部门>/<活动名>/<附件ID>', () => {
  assert.equal(
    submissionStoragePath({ center: '综事中心', activity: '急救培训', attachmentId: 'ATT-1' }).dir,
    '/综事中心/急救培训/ATT-1',
  );
  assert.equal(
    submissionStoragePath({ center: '主席团活动', activity: '志愿服务月', attachmentId: 'ATT-2' }).dir,
    '/主席团活动/志愿服务月/ATT-2',
  );
  // 2026-10-27：文创设计不填部门/活动，统一落 /内容投稿/文创设计工作组/<附件ID>
  // （与历史结构「内容投稿/文字稿件」并列，用户定案）。
  assert.equal(
    submissionStoragePath({ attachmentId: 'ATT-3' }).dir,
    `${DESIGN_WORKGROUP_PATH}/ATT-3`,
  );
  assert.equal(DESIGN_WORKGROUP_PATH, '/内容投稿/文创设计工作组');
  // 只填活动、不填部门，同样按文创处理（部门是文字稿件的必填项）。
  assert.equal(
    submissionStoragePath({ activity: '急救培训', attachmentId: 'ATT-4' }).dir,
    `${DESIGN_WORKGROUP_PATH}/ATT-4`,
  );
});

test('S2 目录名清洗：非法字符不进入路径', () => {
  const p = mediaStoragePath('活动/名称', '生命中心');
  assert.ok(!p.dir.includes('//'), 'no double slash');
  assert.match(p.dir, /^\/生命中心\/.+\/.+$/);
});

test('S2 三类文件同处一个部门/活动目录（照片、其他文件、投稿附件）', () => {
  const center = '博爱中心';
  const activity = '无偿献血进校园';
  const photo = mediaStoragePath(activity, center).dir;
  const other = mediaStoragePath(activity, center, { subdir: 'other' }).dir;
  const attachment = submissionStoragePath({ center, activity, attachmentId: 'ATT-9' }).dir;
  // 三级目录：一级部门、二级活动，照片进三级、其他文件与投稿附件在二级同层。
  assert.equal(photo, `/${center}/${activity}/${activity}-照片`);
  assert.equal(other, `/${center}/${activity}`);
  assert.equal(attachment, `/${center}/${activity}/ATT-9`);
  for (const path of [photo, other, attachment]) {
    assert.ok(path.startsWith(`/${center}/${activity}`), `${path} 应归入同一部门/活动目录`);
  }
});

/* -------------------------------- 双库接入 -------------------------------- */

test('S2 双库状态：主库与精选库各自独立', () => {
  const dual = box.boxLibrariesStatus(CONFIG);
  assert.equal(dual.main.library, 'main');
  assert.equal(dual.main.libraryName, '平台文件存储');
  assert.equal(dual.picks.library, 'picks');
  assert.equal(dual.picks.libraryName, '南大红会精选图片库');
  assert.equal(dual.configured, true);
  assert.equal(dual.picksConfigured, true);
  assert.equal(box.boxLibrariesStatus({ njuboxToken: 'only' }).picksConfigured, false);
});

test('S2 端点契约：Bearer 鉴权 + via-repo-token 前缀 + 无 repoId', async () => {
  const calls = [];
  const fetchImpl = mockBox(calls);
  const cfg = { ...CONFIG, njuboxFetch: fetchImpl };
  await box.fileLink(cfg, '/博爱中心/急救培训 AED/ATT-1/a.pdf');
  await box.uploadBuffer(cfg, { dir: '/生命中心/献血活动/献血活动-照片', filename: 'a.jpg', buffer: Buffer.from('1'), contentType: 'image/jpeg' });
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
  // 模拟真实 Seafile：根下已有部门「生命中心」，其下已有活动「献血活动」。
  const fetchImpl = mockBox(calls, {
    onDir: (path) => {
      if (path === '/') return [{ type: 'dir', name: '生命中心' }];
      if (path === '/生命中心') return [{ type: 'dir', name: '献血活动' }];
      return [];
    },
  });
  const result = await box.ensureDir({ ...CONFIG, njuboxFetch: fetchImpl }, '/生命中心/献血活动/献血活动-照片');
  assert.deepEqual(result.existing, ['/生命中心', '/生命中心/献血活动']);
  assert.deepEqual(result.created, ['/生命中心/献血活动/献血活动-照片']);
  const mkdirs = calls.filter((c) => c.method === 'POST');
  assert.equal(mkdirs.length, 1, 'only the missing segment is created');
});

test('S2 ensureDir 逐层创建不存在的路径', async () => {
  const calls = [];
  const fetchImpl = mockBox(calls, { onDir: () => [] });
  const result = await box.ensureDir({ ...CONFIG, njuboxFetch: fetchImpl }, '/博爱中心/急救培训/ATT-9');
  assert.deepEqual(result.created, ['/博爱中心', '/博爱中心/急救培训', '/博爱中心/急救培训/ATT-9']);
  assert.equal(result.existing.length, 0);
});

test('S2 路径必须绝对：相对路径直接拒绝', async () => {
  await assert.rejects(
    () => box.ensureDir({ ...CONFIG, njuboxFetch: mockBox() }, '生命中心/献血'),
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
    sourcePath: '/生命中心/献血活动/献血活动-照片/a.jpg',
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
  const ok = await box.deleteDir({ ...CONFIG, njuboxFetch: fetchImpl }, '/生命中心/献血活动/献血活动-照片');
  assert.equal(ok, true);
  const del = calls.find((c) => c.method === 'DELETE');
  assert.match(del.href, /\/dir\/\?path=/);
});

test('S2 上传返回 fileId 与完整落点', async () => {
  const stored = await box.uploadBuffer({ ...CONFIG, njuboxFetch: mockBox() }, {
    dir: '/生命中心/献血活动/献血活动-照片',
    filename: '照片.jpg',
    buffer: Buffer.from('bytes'),
    contentType: 'image/jpeg',
  });
  assert.equal(stored.fileId, 'commit-1');
  assert.equal(stored.path, '/生命中心/献血活动/献血活动-照片/照片.jpg');
  assert.equal(stored.dir, '/生命中心/献血活动/献血活动-照片');
});

test('S2 checksum 稳定（SHA-256 十六进制）', () => {
  const a = box.checksum(Buffer.from('njuredcross'));
  assert.match(a, /^[0-9a-f]{64}$/);
  assert.equal(a, box.checksum(Buffer.from('njuredcross')));
});
