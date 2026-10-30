/* ==========================================================================
   image-thumb.js — 在浏览器里把照片压成列表预览图。

   上传和审核两处都要用：门户端上传时生成一次，审核端给老照片补一次。
   放在 core/ 里，避免两份 canvas 代码各自漂移。

   为什么不在服务器上压：Node 没有内置图像处理，装 sharp/ffmpeg 都要给
   1 GiB 的机器加几十 MB 依赖；而压缩本来就在用户自己的机器上，不占带宽、
   不占服务端 CPU。
   ========================================================================== */

/** 预览图长边与 JPEG 质量：480px / 0.72 时典型 25~40KB，卡片显示足够清晰。 */
export const THUMB_MAX_EDGE = 480;
export const THUMB_QUALITY = 0.72;

/**
 * 生成缩略图。失败一律返回 null（调用方回退占位图），绝不抛错。
 * @param {Blob|File} source 图片文件或已下载的 blob
 * @returns {Promise<Blob|null>} image/jpeg
 */
export async function makeThumbnail(source, { maxEdge = THUMB_MAX_EDGE, quality = THUMB_QUALITY } = {}) {
  if (typeof createImageBitmap !== 'function' || !source) return null;
  let bitmap;
  try {
    // 手机照片带 EXIF 旋转，先摆正再缩，否则竖拍会躺着。
    bitmap = await createImageBitmap(source, { imageOrientation: 'from-image' });
  } catch {
    try {
      bitmap = await createImageBitmap(source);
    } catch {
      return null;
    }
  }
  try {
    const sourceW = bitmap.width || maxEdge;
    const sourceH = bitmap.height || maxEdge;
    const scale = Math.min(1, maxEdge / Math.max(sourceW, sourceH));
    const width = Math.max(1, Math.round(sourceW * scale));
    const height = Math.max(1, Math.round(sourceH * scale));
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const context = canvas.getContext('2d');
    if (!context) return null;
    context.drawImage(bitmap, 0, 0, width, height);
    return await new Promise((resolve) => { canvas.toBlob(resolve, 'image/jpeg', quality); });
  } catch {
    return null;
  } finally {
    bitmap.close?.();
  }
}
