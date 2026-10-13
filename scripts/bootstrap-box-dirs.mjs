/**
 * 主库一级目录初始化（v3.1 三级存储结构的第一步）。
 *
 * 按用户定案：`平台文件存储` 库根下**先建五个部门目录**（= MEDIA_CENTERS），
 * 之后所有影像/投稿文件都先落到对应部门目录，再按活动名建二级、按 `<活动名>-照片` 建三级。
 * `宣传展示` 是展示封面的固定根，一并确保存在。
 *
 * 幂等：已存在的目录跳过（Box 的 mkdir 对已存在目录会静默建出「名字 (1)」，
 * 所以这里先列目录再决定是否建，绝不重复创建）。
 *
 * 用法：
 *   node --env-file=.env scripts/bootstrap-box-dirs.mjs                      # 预览（只读）
 *   node --env-file=.env scripts/bootstrap-box-dirs.mjs --apply --confirm=BOOTSTRAP-BOX-DIRS
 */
import * as box from '../lib/attachment/box.js';
import { MEDIA_CENTERS, STORAGE_ROOTS } from '../lib/attachment/store.js';

const apply = process.argv.includes('--apply');
const confirm = process.argv.find((arg) => arg.startsWith('--confirm='))?.slice('--confirm='.length);
const REQUIRED = 'BOOTSTRAP-BOX-DIRS';

const config = {
  njuboxServerUrl: process.env.NJUBOX_SERVER_URL,
  njuboxToken: process.env.NJUBOX_MAIN_TOKEN,
};

const status = box.boxStatus(config);
if (!status.configured) {
  console.error('NJU Box 未配置（缺 NJUBOX_MAIN_TOKEN），无法初始化目录。');
  process.exitCode = 1;
} else if (apply && confirm !== REQUIRED) {
  console.error(`拒绝写入：需要 --confirm=${REQUIRED}`);
  process.exitCode = 1;
} else {
  const targets = [...MEDIA_CENTERS.map((center) => `/${center}`), STORAGE_ROOTS.showcase];
  console.log(`库：${status.libraryName}（${status.library}）  服务器：${status.serverUrl}`);
  console.log(`计划确保以下 ${targets.length} 个一级目录存在：${targets.join('  ')}\n`);

  for (const dir of targets) {
    const exists = await box.dirExists(config, dir);
    if (exists) {
      console.log(`  = 已存在  ${dir}`);
      continue;
    }
    if (!apply) {
      console.log(`  + 待创建  ${dir}（预览模式，未写入）`);
      continue;
    }
    const result = await box.ensureDir(config, dir);
    console.log(`  + 已创建  ${dir}${result.created.length ? `（新建 ${result.created.join(' ')}）` : ''}`);
  }

  if (!apply) console.log('\n以上为预览。加 --apply 才真正建目录。');
}
