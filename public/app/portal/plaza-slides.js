/**
 * 各广场主视觉使用的影像。
 *
 * 现阶段复用活动影像库里的授权照片（同一批文件已在托管媒体里生成多尺寸变体），
 * 后续按广场主题逐张替换即可 —— 只要保持 `image/alt/position` 三个字段，
 * 轮播组件与样式都不需要改动。
 */
const ACTIVITY = (index, alt, position) => ({ image: `/assets/events-carousel/activity-0${index}.webp`, alt, position });

/** 活动广场（与 events-showcase 的 EVENT_SLIDES 保持一致）。 */
export const EVENTS_SLIDES = [
  ACTIVITY(1, '南京大学红十字会青春风采展志愿者合影', '50% 60%'),
  ACTIVITY(2, '红十字会成员手持会旗与项目奖牌合影', '50% 58%'),
  ACTIVITY(3, '红十字志愿者在教室内手持会旗合影', '50% 60%'),
  ACTIVITY(4, '生命的信任宣讲会南京大学篇现场合影', '50% 70%'),
  ACTIVITY(5, '南京大学博爱青春服务队活动合影', '50% 68%'),
  ACTIVITY(6, '红十字青年交流活动现场合影', '50% 65%'),
];

/** 宣传广场：优先讲“被看见”的现场与交流。 */
export const OUTREACH_SLIDES = [
  ACTIVITY(4, '生命的信任宣讲会南京大学篇现场合影', '50% 70%'),
  ACTIVITY(6, '红十字青年交流活动现场合影', '50% 65%'),
  ACTIVITY(1, '南京大学红十字会青春风采展志愿者合影', '50% 60%'),
];

/** 内建广场：优先同伴合影与教室里的日常。 */
export const COMMUNITY_SLIDES = [
  ACTIVITY(2, '红十字会成员手持会旗与项目奖牌合影', '50% 58%'),
  ACTIVITY(3, '红十字志愿者在教室内手持会旗合影', '50% 60%'),
  ACTIVITY(5, '南京大学博爱青春服务队活动合影', '50% 68%'),
];

/** 物资广场：优先服务现场与集体合影。 */
export const MATERIALS_SLIDES = [
  ACTIVITY(5, '南京大学博爱青春服务队活动合影', '50% 68%'),
  ACTIVITY(1, '南京大学红十字会青春风采展志愿者合影', '50% 60%'),
  ACTIVITY(3, '红十字志愿者在教室内手持会旗合影', '50% 60%'),
];
