// Shared by the generated Workbox routes and the upgrade cleanup below.
globalThis.isPublicMapApi = (pathname) =>
  /^\/api\/(?:sites|rooms|equipment|tickets|search|sites\/\d+\/floorplans|floorplans\/\d+(?:\/(?:rooms|equipment|reference-points))?)\/?$/.test(pathname);

const isUploadSvg = (pathname, response) =>
  /^\/(?:api\/)?uploads\//.test(pathname) && (
    /\.svgz?$/i.test(pathname) || response?.headers.get('Content-Type')?.split(';')[0].trim() === 'image/svg+xml'
  );

async function cleanApiCache() {
  const cache = await caches.open('api-cache');
  for (const request of await cache.keys()) {
    if (!globalThis.isPublicMapApi(new URL(request.url).pathname)) {
      await cache.delete(request);
    } else if (request.headers.has('Authorization')) {
      // Preserve public offline data, but remove credentials from old request keys.
      const response = await cache.match(request);
      if (response) {
        await cache.delete(request);
        await cache.put(request.url, response);
      }
    }
  }
}

async function cleanSvgCache() {
  const cache = await caches.open('assets-cache');
  for (const request of await cache.keys()) {
    const response = await cache.match(request);
    if (isUploadSvg(new URL(request.url).pathname, response) &&
        !/(?:^|;)\s*sandbox\s*(?:;|$)/i.test(response?.headers.get('Content-Security-Policy') || '')) {
      await cache.delete(request);
    }
  }
}

globalThis.addEventListener('activate', (event) => {
  event.waitUntil(Promise.all([cleanApiCache(), cleanSvgCache()]));
});
