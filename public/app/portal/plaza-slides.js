/**
 * 各广场主视觉使用的影像。
 *
 * 源图与多尺寸变体由 scripts/import-plaza-photos.mjs 从授权照片生成，属于托管
 * 媒体（不在源码里，见 .gitignore）。这里只描述「哪个广场用哪几张、裁切焦点与
 * 替代文本」。后续替换图片：把新照片放进对应目录重跑脚本，再改这里的路径即可，
 * 轮播组件与样式都不用动。
 *
 * 注意：alt 需按照片实际内容校对（脚本无法看图，下面按广场与用途给了中性描述）。
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

/** 宣传广场：主题视觉、现场记录与文创。 */
export const OUTREACH_SLIDES = [
  PLAZA('outreach', 1, '南京大学红十字会宣传主题视觉', '50% 50%'),
  PLAZA('outreach', 2, '校红会宣传活动现场记录', '50% 45%'),
  PLAZA('outreach', 3, '校红会主题桌游文创设计', '50% 50%'),
];

/** 内建广场：同伴日常与集体合影。 */
export const COMMUNITY_SLIDES = [
  PLAZA('community', 1, '内建广场同伴活动影像', '50% 45%'),
  PLAZA('community', 2, '同伴相聚的活动现场', '50% 45%'),
  PLAZA('community', 3, '红十字会成员集体合影', '50% 45%'),
];

/** 物资广场：会员证、献血英雄挂件与活动物资。 */
export const MATERIALS_SLIDES = [
  PLAZA('materials', 1, '南京大学红十字会会员证', '50% 50%'),
  PLAZA('materials', 2, '献血英雄不织布挂件', '50% 50%'),
  PLAZA('materials', 3, '校红会活动物资与现场', '50% 45%'),
];

/**
 * 管理端备用影像。控制台目前是工作台，没有轮播位；这里先备好，等确定展示
 * 位置（登录页背景 / 总览页头）后直接引用即可。
 */
export const CONSOLE_SLIDES = [
  PLAZA('console', 1, '南京大学红十字会管理端影像一', '50% 50%'),
  PLAZA('console', 2, '南京大学红十字会管理端影像二', '50% 50%'),
  PLAZA('console', 3, '南京大学红十字会管理端影像三', '50% 50%'),
];
