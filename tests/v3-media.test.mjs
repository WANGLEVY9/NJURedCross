import test from 'node:test';
import assert from 'node:assert/strict';
import {
  MEDIA_PICK_STATUS,
  MEDIA_PICK_MIN,
  MEDIA_PICK_MAX,
  MEDIA_DELETE_STATUS,
  MEDIA_KEEP_STATUS,
  MEDIA_UNNAMED_ACTIVITY,
  MEDIA_COLUMNS,
  mediaRow,
  mediaFromRow,
  mediaPortalView,
  mediaStoragePath,
  picksStoragePath,
} from '../lib/attachment/store.js';
import {
  buildZip,
  MAX_ZIP_PER_BATCH,
  MAX_ZIP_BYTES,
  MAX_RENAME_PER_BATCH,
  MAX_PHOTOS_PER_BATCH,
  MEDIA_LIMIT_PER_HOUR,
  MEDIA_PICK_LIMIT_PER_HOUR,
  MEDIA_RENAME_LIMIT_PER_HOUR,
  MEDIA_DOWNLOAD_LIMIT_PER_HOUR,
  MEDIA_IP_LIMIT_PER_HOUR,
  MEDIA_RATE_BUCKETS,
  enforceMediaLimit,
} from '../lib/attachment/media.js';

/* -------------------------------------------------------------------------- *
 * v3 S4：双库精选（N1）+ 删除审核（第 9 项）+ 批量下载
 * -------------------------------------------------------------------------- */

test('S4 精选常量：强制 3-5 张，状态机四态', () => {
  assert.equal(MEDIA_PICK_MIN, 3, '下限 3 张');
  assert.equal(MEDIA_PICK_MAX, 5, '上限 5 张');
  assert.equal(MEDIA_PICK_STATUS.none, '未申请');
  assert.equal(MEDIA_PICK_STATUS.pending, '已申请待确认');
  assert.equal(MEDIA_PICK_STATUS.picked, '已精选');
  assert.equal(MEDIA_PICK_STATUS.rejected, '已驳回');
});

test('S4 删除审核常量：四态 + 需审核', () => {
  assert.equal(MEDIA_DELETE_STATUS.none, '未申请');
  assert.equal(MEDIA_DELETE_STATUS.pending, '待审核');
  assert.equal(MEDIA_DELETE_STATUS.approved, '已通过');
  assert.equal(MEDIA_DELETE_STATUS.rejected, '已驳回');
});

test('S4 影像素材表包含精选 6 列与删除审核 4 列', () => {
  for (const column of ['精选状态', '精选申请时间', '精选确认人', '精选确认时间', '精选库路径', '精选库ID']) {
    assert.ok(MEDIA_COLUMNS.includes(column), `缺精选列 ${column}`);
  }
  for (const column of ['删除申请状态', '删除理由', '删除审核人', '删除审核时间']) {
    assert.ok(MEDIA_COLUMNS.includes(column), `缺删除审核列 ${column}`);
  }
});

test('S4 素材行映射：精选/删除字段往返一致', () => {
  const media = {
    id: 'PHO-1',
    center: '生命中心',
    activity: '献血活动',
    photographer: '张三',
    filename: 'a.jpg',
    mimeType: 'image/jpeg',
    size: 1024,
    checksum: 'AB12',
    provider: 'njubox',
    libraryId: 'main',
    path: '/生命中心/献血活动/献血活动-照片/a.jpg',
    keepStatus: MEDIA_KEEP_STATUS.keep,
    uploader: 'ACC-1',
    uploadedAt: '2026-10-10T00:00:00.000Z',
    pickStatus: MEDIA_PICK_STATUS.picked,
    pickRequestedAt: '2026-10-10T01:00:00.000Z',
    pickConfirmedBy: 'ACC-9',
    pickConfirmedAt: '2026-10-10T02:00:00.000Z',
    pickPath: '/献血活动-生命中心/献血活动-照片/a.jpg',
    pickRepoId: 'picks',
    deleteStatus: MEDIA_DELETE_STATUS.pending,
    deleteReason: '重复上传',
    deleteReviewedBy: '',
    deleteReviewedAt: '',
  };
  const row = mediaRow(media);
  assert.equal(row['精选状态'], '已精选');
  assert.equal(row['精选库ID'], 'picks');
  assert.equal(row['删除申请状态'], '待审核');
  assert.equal(row['删除理由'], '重复上传');

  const back = mediaFromRow(row);
  assert.equal(back.pickStatus, MEDIA_PICK_STATUS.picked);
  assert.equal(back.pickPath, '/献血活动-生命中心/献血活动-照片/a.jpg');
  assert.equal(back.deleteStatus, MEDIA_DELETE_STATUS.pending);
  assert.equal(back.deleteReason, '重复上传');
});

test('S4 缺列容错：旧行无精选/删除列时回落默认值', () => {
  const media = mediaFromRow({ 照片ID: 'PHO-OLD', 活动名: '旧活动', 中心: '博爱中心', 文件名: 'x.jpg' });
  assert.equal(media.pickStatus, MEDIA_PICK_STATUS.none, '旧行精选状态回落未申请');
  assert.equal(media.deleteStatus, MEDIA_DELETE_STATUS.none, '旧行删除状态回落未申请');
  assert.equal(media.pickPath, '');
});

test('S4 门户视图：不泄露库 ID 与文件路径', () => {
  const media = {
    id: 'PHO-2', center: '生命中心', activity: '献血活动', photographer: '张三',
    filename: 'a.jpg', mimeType: 'image/jpeg', size: 100,
    keepStatus: MEDIA_KEEP_STATUS.pending, pickStatus: MEDIA_PICK_STATUS.pending,
    path: '/生命中心/内部路径/a.jpg', repoId: 'main', pickRepoId: 'picks',
    pickPath: '/精选库/内部路径/a.jpg', uploader: 'ACC-1',
  };
  const view = mediaPortalView(media);
  assert.equal(view.path, undefined, '门户视图不含 path');
  assert.equal(view.repoId, undefined, '门户视图不含 repoId');
  assert.equal(view.pickRepoId, undefined, '门户视图不含精选库 ID');
  assert.equal(view.pickPath, undefined, '门户视图不含精选库路径');
  assert.equal(view.id, 'PHO-2');
  assert.equal(view.center, '生命中心');
});

test('S4 精选复制目标路径：沿用 <部门>/<活动名>/<活动名>-照片', () => {
  const target = mediaStoragePath('献血活动', '生命中心', { subdir: 'photo' });
  assert.equal(target.dir, '/生命中心/献血活动/献血活动-照片', '精选库沿用既有文件夹结构');
});

test('S4 打包上限常量合理', () => {
  assert.equal(MAX_ZIP_PER_BATCH, 30, '单次打包上限 30 张');
  assert.ok(MAX_ZIP_BYTES >= 100 * 1024 * 1024, '总字节上限不小于 100MB');
  assert.ok(MAX_RENAME_PER_BATCH >= MAX_ZIP_PER_BATCH, '更名上限不低于打包上限');
  assert.ok(MEDIA_LIMIT_PER_HOUR > 0 && MEDIA_PICK_LIMIT_PER_HOUR > 0);
  assert.ok(MAX_PHOTOS_PER_BATCH > 0);
});

test('影像库限流：四个动作各自分桶，按账号计数，下载不吃上传额度', () => {
  const calls = [];
  const ctx = { enforceLimit: (req, bucket, limit, identity) => calls.push({ bucket, limit, identity }) };
  const req = {};
  const first = enforceMediaLimit(req, ctx, { username: 'alice' }, 'upload', MEDIA_LIMIT_PER_HOUR);
  assert.deepEqual(first, { bucket: 'media-upload', identity: 'alice' });
  enforceMediaLimit(req, ctx, { username: 'alice' }, 'rename', MEDIA_RENAME_LIMIT_PER_HOUR);
  enforceMediaLimit(req, ctx, { username: 'alice' }, 'pick', MEDIA_PICK_LIMIT_PER_HOUR);
  enforceMediaLimit(req, ctx, { username: 'bob' }, 'download', MEDIA_DOWNLOAD_LIMIT_PER_HOUR);

  const perAccount = calls.filter((call) => call.identity);
  assert.deepEqual(perAccount.map((call) => call.bucket), ['media-upload', 'media-rename', 'media-pick', 'media-download'], '四个动作互不共用桶');
  assert.deepEqual(perAccount.map((call) => call.limit), [MEDIA_LIMIT_PER_HOUR, MEDIA_RENAME_LIMIT_PER_HOUR, MEDIA_PICK_LIMIT_PER_HOUR, MEDIA_DOWNLOAD_LIMIT_PER_HOUR]);
  assert.equal(new Set(perAccount.map((call) => call.bucket)).size, 4, '桶名唯一');
  assert.equal(perAccount[0].identity, 'alice', '按登录账号计数，不再按共用出口 IP');
  assert.equal(perAccount[3].identity, 'bob', '不同账号互相不占额度');

  const net = calls.filter((call) => call.bucket === 'media-net');
  assert.equal(net.length, 4, '每个请求都过一次出口 IP 兜底');
  assert.ok(MEDIA_IP_LIMIT_PER_HOUR >= MEDIA_LIMIT_PER_HOUR * 5, 'IP 兜底额度必须远高于单人额度');
  assert.equal(Object.keys(MEDIA_RATE_BUCKETS).length, 4);
});

test('影像库限流：拿不到账号时退回按 IP 计数', () => {
  const calls = [];
  const ctx = { enforceLimit: (req, bucket, limit, identity) => calls.push({ bucket, limit, identity }) };
  enforceMediaLimit({}, ctx, null, 'upload', MEDIA_LIMIT_PER_HOUR);
  assert.equal(calls[0].bucket, 'media-upload');
  assert.equal(calls[0].identity, undefined, '无账号时不传 identity，服务端按客户端地址计数');
  assert.ok(MEDIA_LIMIT_PER_HOUR >= 20, '单账号每小时至少 20 批（12 张/批）');
});

test('S4 buildZip：生成合法 ZIP 且文件名与内容可读回', () => {
  const zip = buildZip([
    { name: '献血活动_001.jpg', buffer: Buffer.from('fake-jpeg-bytes-1') },
    { name: '献血活动_002.jpg', buffer: Buffer.from('fake-jpeg-bytes-2') },
  ]);
  assert.ok(Buffer.isBuffer(zip));
  assert.equal(zip.subarray(0, 4).toString('latin1'), 'PK\u0003\u0004', '本地文件头签名');
  // 中央目录后为 EOCD，总条目数在偏移 10
  const eocdIndex = zip.lastIndexOf(Buffer.from('PK\u0005\u0006', 'latin1'));
  assert.ok(eocdIndex > 0, '存在 EOCD 记录');
  assert.equal(zip.readUInt16LE(eocdIndex + 10), 2, 'EOCD 记录条目数为 2');
  const text = zip.toString('latin1');
  assert.ok(text.includes('献血活动_001.jpg') || zip.toString('utf8').includes('献血活动_001.jpg') || zip.includes(Buffer.from('献血活动_001.jpg', 'utf8')), '含文件名');
});

test('S4 buildZip：空输入产出仅 EOCD 的合法 ZIP', () => {
  const zip = buildZip([]);
  assert.equal(zip.length, 22, '仅 22 字节 EOCD');
  assert.equal(zip.subarray(0, 4).toString('latin1'), 'PK\u0005\u0006');
  assert.equal(zip.readUInt16LE(10), 0, '条目数为 0');
});

test('S4 buildZip：CRC32 正确（内容不同则 CRC 不同）', () => {
  const a = buildZip([{ name: 'a.txt', buffer: Buffer.from('hello') }]);
  const b = buildZip([{ name: 'a.txt', buffer: Buffer.from('world') }]);
  // CRC 存放在本地头偏移 14
  assert.notEqual(a.readUInt32LE(14), b.readUInt32LE(14), '不同内容 CRC 不同');
  const again = buildZip([{ name: 'a.txt', buffer: Buffer.from('hello') }]);
  assert.equal(a.readUInt32LE(14), again.readUInt32LE(14), '相同内容 CRC 稳定');
});

test('S4 精选数量校验边界：2 张与 6 张都非法，3/4/5 合法', () => {
  const valid = (n) => n >= MEDIA_PICK_MIN && n <= MEDIA_PICK_MAX;
  assert.equal(valid(0), false);
  assert.equal(valid(2), false, '2 张少于下限');
  assert.equal(valid(3), true);
  assert.equal(valid(4), true);
  assert.equal(valid(5), true);
  assert.equal(valid(6), false, '6 张超过上限');
});

test('S4 删除申请状态机：未申请/待审核/已通过/已驳回四态齐全', () => {
  assert.equal(MEDIA_DELETE_STATUS.none, '未申请');
  assert.equal(MEDIA_DELETE_STATUS.pending, '待审核');
  assert.equal(MEDIA_DELETE_STATUS.approved, '已通过');
  assert.equal(MEDIA_DELETE_STATUS.rejected, '已驳回');
});

test('S4 删除申请理由落库并回读（队列可展示理由）', () => {
  const row = mediaRow({
    id: 'PHO-DEL', activity: 'a', center: '生命中心', filename: 'x.png',
    mimeType: 'image/png', size: 10, path: '/生命中心/a/a-照片/x.png',
    uploader: 'ACC-1', keepStatus: MEDIA_KEEP_STATUS.pending,
    deleteStatus: MEDIA_DELETE_STATUS.pending, deleteReason: '拍虚了',
  });
  const media = mediaFromRow(row);
  assert.equal(media.deleteStatus, MEDIA_DELETE_STATUS.pending);
  assert.equal(media.deleteReason, '拍虚了', '删除理由应能被回读');
});

test('S4 精选库副本按「活动名」建一级文件夹（2026-10-28 起与主库结构不同）', () => {
  // 主库仍是三级：/部门/活动名/活动名-照片/
  const main = mediaStoragePath('秋季急救', '博爱中心', { subdir: 'photo' });
  assert.equal(main.dir, '/博爱中心/秋季急救/秋季急救-照片');

  // 精选库（从空库起用）只要一层：/活动名/
  const picks = picksStoragePath('秋季急救');
  assert.equal(picks.dir, '/秋季急救');
  assert.equal(picks.activityDir, '秋季急救');
  // 缺活动名兜底，不至于落成根目录
  assert.equal(picksStoragePath('').dir, `/${MEDIA_UNNAMED_ACTIVITY}`);
  // 含路径分隔符的活动名被清洗，清洗后仍是单层（不会多出一级目录）
  const dirty = picksStoragePath('活动/一');
  assert.equal(dirty.activityDir.includes('/'), false, dirty.activityDir);
  assert.equal(dirty.dir.split('/').filter(Boolean).length, 1, dirty.dir);
});

test('S4 精选确认后门户视图不泄露 path/repoId（只回业务字段）', () => {
  const view = mediaPortalView({
    id: 'PHO-1', activity: 'a', center: '生命中心', filename: 'x.png',
    mimeType: 'image/png', size: 1, uploader: 'ACC-1',
    keepStatus: MEDIA_KEEP_STATUS.pending,
    pickStatus: MEDIA_PICK_STATUS.picked,
    deleteStatus: MEDIA_DELETE_STATUS.none,
    path: '/生命中心/秘密路径/x.png', repoId: 'secret-repo',
  });
  assert.equal(view.pickStatus, MEDIA_PICK_STATUS.picked);
  assert.equal('path' in view, false, '门户视图不得含 path');
  assert.equal('repoId' in view, false, '门户视图不得含 repoId');
});
