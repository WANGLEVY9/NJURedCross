import { storePhoto } from './attendance-photo.js';

/**
 * Preserve evidence when the remote write acknowledgement is uncertain.
 * Unreferenced files require later reconciliation before removal.
 */
export async function submitAttendancePhoto(req, {
  submit,
  store = storePhoto,
}) {
  if (typeof submit !== 'function' || typeof store !== 'function') {
    throw new TypeError('Attendance submission requires store and submit functions');
  }

  const photoId = await store(req);
  return await submit(photoId);
}