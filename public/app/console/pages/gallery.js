import { h, icon } from '../../core/dom.js';
import { pageHead, statusIndicator } from '../../ui/primitives.js';
import { openLightbox } from '../../ui/overlay.js';
import { managedImage, photoSizes } from '../../portal/image-source.js';
import { CONSOLE_SLIDES, EVENTS_SLIDES, OUTREACH_SLIDES, MATERIALS_SLIDES } from '../../portal/plaza-slides.js';

/* ==========================================================================
   console/pages/gallery.js — 红会照片墙。
   管理端独立的影像陈列页：一张张相纸挂在墙面上，照片保持 3:2 原比例，
   只靠相纸边、投影与轻微倾斜做出错落感，不裁切也不放大。
   ========================================================================== */

const SECTIONS = [
  {
    key: 'leadership',
    title: '管理层风采',
    description: '学生分会与主席团的会议、合影与日常工作影像。',
    slides: CONSOLE_SLIDES,
  },
  {
    key: 'service',
    title: '活动与服务现场',
    description: '志愿服务、宣讲与培训现场的记录。',
    // 首张与「管理层风采」的青春风采展合影同场，避免同一场景连排出现。
    slides: EVENTS_SLIDES.filter(slide => !slide.image.includes('activity-01')),
  },
  {
    key: 'creative',
    title: '宣传与文创',
    description: '原创插画、宣传摊位与周边物资。',
    slides: [...OUTREACH_SLIDES, ...MATERIALS_SLIDES],
  },
];

/** 大图取 srcset 里最宽的一档，避免放大预览时用到缩略图那一张。 */
function largestVariant(image) {
  const srcset = image.getAttribute('srcset');
  if (!srcset) return image.src;
  const candidates = srcset.split(',').map(part => part.trim().split(/\s+/))
    .map(([url, width]) => ({ url, width: Number.parseInt(width, 10) || 0 }))
    .sort((a, b) => b.width - a.width);
  return candidates[0]?.url || image.src;
}

/** 相纸：白边照片 + 图钉 + 手写标签，整块可点，点开走公共 lightbox。 */
function photoCard(slide) {
  const image = managedImage(slide.image, { alt: slide.alt, sizes: photoSizes });
  // 声明一个缩略尺寸：万一样式表没就位，照片也只会按缩略图大小排，不会铺满页面。
  image.setAttribute('width', '480');
  image.setAttribute('height', '320');
  const open = () => openLightbox({ src: largestVariant(image), caption: slide.alt });
  return h('button', {
    type: 'button', class: 'gallery-photo', aria: { label: `查看大图：${slide.alt}` },
    on: { click: open },
  },
  h('span', { class: 'gallery-photo__print' },
    image,
    h('span', { class: 'gallery-photo__zoom', aria: { hidden: 'true' } }, icon('search', 'ico'))),
  h('span', { class: 'gallery-photo__label', text: slide.alt }));
}

function photoSection({ key, title, description, slides }) {
  const id = `gallery-${key}`;
  return h('section', { class: 'gallery-section', aria: { labelledby: id } },
    h('header', { class: 'gallery-section__head' },
      h('div', null,
        h('h2', { class: 'gallery-section__title', id, text: title }),
        h('p', { class: 'gallery-section__note', text: description })),
      h('span', { class: 'gallery-section__count', text: `${slides.length} 张` })),
    h('div', { class: 'gallery-wall' }, ...slides.map(photoCard)));
}

export default async function galleryPage() {
  const total = SECTIONS.reduce((sum, section) => sum + section.slides.length, 0);
  const node = h('div', { class: 'view wspad console-gallery' },
    pageHead({
      title: '红会照片墙',
      description: '红会管理层与各板块的授权影像，挂在墙上一张张看，点击任意一张放大。',
      meta: [statusIndicator(`${total} 张授权影像`, { tone: 'info' })],
    }),
    ...SECTIONS.map(photoSection));
  return { title: '红会照片墙', crumb: '红会照片墙', node };
}
