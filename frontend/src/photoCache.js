import { BASE_URL } from './api';

export const PHOTO_CACHE = 'entity-photo-thumbnails-v1';
export const PHOTO_CACHE_LIMIT = 600;
export const photoUrl = path => path ? `${BASE_URL}${path}` : '';

// Sequential low-priority downloads avoid competing with map rendering.
export async function cachePhotoThumbnails(items) {
  if (!('caches' in window) || !navigator.onLine) return;
  const cache = await caches.open(PHOTO_CACHE);
  const paths = [...new Set(items.map(item => item.photo_thumbnail_path).filter(Boolean))].slice(0, PHOTO_CACHE_LIMIT);
  for (const path of paths) {
    const url = photoUrl(path);
    if (await cache.match(url)) continue;
    try {
      const response = await fetch(url, { priority: 'low' });
      if (response.ok) await cache.put(url, response);
    } catch { /* Offline or storage exhausted: keep existing thumbnails. */ }
  }
  const keys = await cache.keys();
  await Promise.all(keys.slice(0, Math.max(0, keys.length - PHOTO_CACHE_LIMIT)).map(key => cache.delete(key)));
}
