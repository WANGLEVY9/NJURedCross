/**
 * 各广场主视觉使用的影像。
 *
 * 源图与多尺寸变体由 scripts/import-plaza-photos.mjs 从授权照片生成，属于托管
 * 媒体（不在源码里，见 .gitignore）。这里只描述「哪个广场用哪几张、裁切焦点与
 * 替代文本」。后续替换图片：把新照片放进对应目录重跑脚本，再改这里的路径即可，
 * 轮播组件与样式都不用动。
 *
 * alt 已按照片实际内容逐张校对；替换图片时请同步更新。
 */
const ACTIVITY = (index, alt, position) => ({ image: `/assets/events-carousel/activity-0${index}.webp`, alt, position });
const PLAZA = (slug, index, alt, position) => ({ image: `/assets/plaza/${slug}-${index}.webp`, alt, position });

/** 活动广场（与 events-showcase 的 EVENT_SLIDES 保持一致）。 */
export const EVENTS_SLIDES = [
  ACTIVITY(1, '南京大学红十字会青春风采展志愿者合影', '50% 60%'),
  ACTIVITY(2, '红十字会成员手持会旗与项目奖牌合影', '50% 58%'),
  ACTIVITY(3, '红十字志愿者在教室内手持会旗合影', '50% 60%'),
  ACTIVITY(4, '生命的信任宣讲会南京大学篇现场合影', '50% 70%'),
  ACTIVITY(5, '南京大学博爱青春服务队活动合影', '50% 68%'),
  ACTIVITY(6, '红十字青年交流活动现场合影', '50% 65%'),
];

/** 宣传广场：原创插画、宣传摊位与桌游文创。 */
export const OUTREACH_SLIDES = [
  PLAZA('outreach', 1, '南京大学红十字会原创插画：三位同学与小鸡、小鲸鱼吉祥物手牵手走过银杏校园', '50% 50%'),
  PLAZA('outreach', 2, '三位红十字会志愿者在宣传摊位捧着红十字小熊玩偶合影', '50% 40%'),
  PLAZA('outreach', 3, '校红会四款主题桌游卡牌与视觉设计合集', '50% 50%'),
];

/** 内建广场：纪念蛋糕、夏令营与会员大会合影。 */
export const COMMUNITY_SLIDES = [
  PLAZA('community', 1, '南京大学红十字会 1991–2026 纪念蛋糕，叶片上写着成员的名字', '50% 45%'),
  PLAZA('community', 2, '2026 年“博爱青春”暑期夏令营成员围着蛋糕摆姿势合影', '50% 45%'),
  PLAZA('community', 3, '学生分会会员大会暨特色体验活动现场，嘉宾与成员在“传承红十字精神，共启新学年华章”横幅后合影', '50% 55%'),
];

/** 物资广场：会员证、献血英雄挂件与文创周边。 */
export const MATERIALS_SLIDES = [
  PLAZA('materials', 1, '红十字会会员证：紫红色封面与展开的内页，旁边叠放着多本证件', '50% 60%'),
  PLAZA('materials', 2, '志愿者手持“NJU 献血英雄”不织布挂件，前景是成堆的红色挂件', '50% 35%'),
  PLAZA('materials', 3, '校红会文创周边：帆布袋、小熊玩偶、抱枕、贴纸与红花摆件', '50% 55%'),
];

/**
 * 管理端备用影像。控制台目前是工作台，没有轮播位；这里先备好，等确定展示
 * 位置（登录页背景 / 总览页头）后直接引用即可。
 */
export const CONSOLE_SLIDES = [
  PLAZA('console', 1, '十位身穿红十字马甲的成员在“青春风采展”展板前合影', '50% 45%'),
  PLAZA('console', 2, '成员在学生分会办公室手持会旗与纪念蛋糕合影', '50% 45%'),
  PLAZA('console', 3, '2026 年学生分会会员大会会场，成员整齐入座', '50% 60%'),
];
