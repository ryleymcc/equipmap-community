import { BASE_URL } from './api.js';

// Keys for synchronous localStorage/sessionStorage caching
const DASHBOARD_CACHE_PREFIX = 'equipmap_cache_';

/**
 * Synchronous read from localStorage for fast initial render (0ms load)
 */
export function getCachedDashboardData(key) {
  if (typeof window === 'undefined') return null;
  try {
    const raw = localStorage.getItem(DASHBOARD_CACHE_PREFIX + key);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    return parsed.data !== undefined ? parsed.data : parsed;
  } catch (e) {
    console.warn(`Failed to read ${key} from dashboard cache:`, e);
    return null;
  }
}

/**
 * Synchronous write to localStorage for persistent fast dashboard loading
 */
export function setCachedDashboardData(key, data) {
  if (typeof window === 'undefined') return;
  try {
    const payload = {
      data,
      timestamp: Date.now()
    };
    localStorage.setItem(DASHBOARD_CACHE_PREFIX + key, JSON.stringify(payload));
  } catch (e) {
    console.warn(`Failed to save ${key} to dashboard cache:`, e);
  }
}

/**
 * Synchronous remove from localStorage
 */
export function removeCachedDashboardData(key) {
  if (typeof window === 'undefined') return;
  try {
    localStorage.removeItem(DASHBOARD_CACHE_PREFIX + key);
  } catch (e) {
    console.warn(`Failed to remove ${key} from dashboard cache:`, e);
  }
}

/**
 * Fully clears all client caches on logout / sign-out:
 * - LocalStorage (cached sites, floorplans, equipment, rooms, tickets, work orders, token, filters, settings)
 * - SessionStorage
 * - CacheStorage API ('api-cache', etc.)
 */
export async function clearAllClientCaches() {
  if (typeof window === 'undefined') return;

  // 1. Clear LocalStorage
  try {
    const keysToRemove = [];
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      if (key) keysToRemove.push(key);
    }
    keysToRemove.forEach(k => localStorage.removeItem(k));
  } catch (e) {
    console.warn("Failed to clear localStorage:", e);
  }

  // 2. Clear SessionStorage
  try {
    sessionStorage.clear();
  } catch (e) {
    console.warn("Failed to clear sessionStorage:", e);
  }

  // 3. Clear CacheStorage (api-cache)
  try {
    if ('caches' in window) {
      const cacheNames = await caches.keys();
      await Promise.all(cacheNames.map(name => caches.delete(name)));
    }
  } catch (e) {
    console.warn("Failed to clear CacheStorage:", e);
  }
}

/**
 * Helper to mutate an entry in the browser's Cache Storage ('api-cache')
 */
export async function updateApiCacheUrl(urlPath, updaterFn) {
  if (typeof window === 'undefined' || !('caches' in window)) return null;
  try {
    const cacheStorage = await caches.open('api-cache');
    const fullUrl = urlPath.startsWith('http') ? urlPath : new URL(urlPath, BASE_URL).toString();
    const cachedResponse = await cacheStorage.match(fullUrl);

    let originalData = null;
    if (cachedResponse) {
      try {
        originalData = await cachedResponse.json();
      } catch (err) {
        console.warn(`Failed to parse cached JSON for ${fullUrl}:`, err);
      }
    }

    const updatedData = updaterFn(originalData);
    if (updatedData !== undefined && updatedData !== null) {
      const newResponse = new Response(JSON.stringify(updatedData), {
        status: 200,
        statusText: 'OK',
        headers: {
          'Content-Type': 'application/json',
          'ETag': `W/"local-mutation-${Date.now()}"`,
          'Cache-Control': 'public, max-age=0, must-revalidate'
        }
      });
      await cacheStorage.put(fullUrl, newResponse);
      return updatedData;
    }
  } catch (e) {
    console.warn(`Failed to update api-cache for ${urlPath}:`, e);
  }
  return null;
}

/**
 * Instantly update client caches when a room, equipment, or ticket is added, modified, or removed.
 * This guarantees that if the user refreshes immediately, the newly added item remains in cache and is never lost.
 */
export async function updateCachedFloorplanItem(floorplanId, itemType, action, itemData, siteId = null) {
  const fpIdNum = parseInt(floorplanId, 10);
  if (!fpIdNum) return;

  // 1. Update the Floorplan Detail in api-cache (`/api/floorplans/{id}`)
  await updateApiCacheUrl(`/api/floorplans/${fpIdNum}`, (fp) => {
    if (!fp) return null;
    const targetArrayKey = itemType === 'room' ? 'rooms' : itemType === 'equipment' ? 'equipment' : 'tickets';
    const list = fp[targetArrayKey] ? [...fp[targetArrayKey]] : [];

    if (action === 'add') {
      // Avoid duplicate insertion
      const exists = list.some(i => i.id === itemData.id);
      if (!exists) list.push(itemData);
    } else if (action === 'update') {
      const idx = list.findIndex(i => i.id === itemData.id);
      if (idx !== -1) {
        list[idx] = { ...list[idx], ...itemData };
      } else {
        list.push(itemData);
      }
    } else if (action === 'delete') {
      const deleteId = typeof itemData === 'object' ? itemData.id : itemData;
      return {
        ...fp,
        [targetArrayKey]: list.filter(i => i.id !== deleteId)
      };
    }

    return {
      ...fp,
      [targetArrayKey]: list
    };
  });

  // 2. Update Floorplan child list endpoint (e.g. `/api/floorplans/{id}/rooms`)
  const childEndpoint = itemType === 'room' ? `/api/floorplans/${fpIdNum}/rooms` :
                        itemType === 'equipment' ? `/api/floorplans/${fpIdNum}/equipment` : null;
  if (childEndpoint) {
    await updateApiCacheUrl(childEndpoint, (list) => {
      if (!Array.isArray(list)) return null;
      const currentList = [...list];
      if (action === 'add') {
        if (!currentList.some(i => i.id === itemData.id)) currentList.push(itemData);
      } else if (action === 'update') {
        const idx = currentList.findIndex(i => i.id === itemData.id);
        if (idx !== -1) currentList[idx] = { ...currentList[idx], ...itemData };
        else currentList.push(itemData);
      } else if (action === 'delete') {
        const deleteId = typeof itemData === 'object' ? itemData.id : itemData;
        return currentList.filter(i => i.id !== deleteId);
      }
      return currentList;
    });
  }

  // 3. Update Site Floorplans List in api-cache (`/api/sites/{siteId}/floorplans`)
  if (siteId) {
    await updateApiCacheUrl(`/api/sites/${siteId}/floorplans`, (fps) => {
      if (!Array.isArray(fps)) return null;
      return fps.map(fp => {
        if (fp.id !== fpIdNum) return fp;
        const targetArrayKey = itemType === 'room' ? 'rooms' : itemType === 'equipment' ? 'equipment' : 'tickets';
        const list = fp[targetArrayKey] ? [...fp[targetArrayKey]] : [];
        if (action === 'add') {
          if (!list.some(i => i.id === itemData.id)) list.push(itemData);
        } else if (action === 'update') {
          const idx = list.findIndex(i => i.id === itemData.id);
          if (idx !== -1) list[idx] = { ...list[idx], ...itemData };
        } else if (action === 'delete') {
          const deleteId = typeof itemData === 'object' ? itemData.id : itemData;
          return { ...fp, [targetArrayKey]: list.filter(i => i.id !== deleteId) };
        }
        return { ...fp, [targetArrayKey]: list };
      });
    });
  }

  // 4. Update Global Lists in api-cache and Dashboard Cache (`/api/rooms`, `/api/equipment`)
  if (itemType === 'room' || itemType === 'equipment') {
    const globalKey = itemType === 'room' ? 'rooms' : 'equipment';
    const globalEndpoint = `/api/${globalKey}`;

    // Update api-cache
    await updateApiCacheUrl(globalEndpoint, (list) => {
      if (!Array.isArray(list)) return null;
      const currentList = [...list];
      if (action === 'add') {
        if (!currentList.some(i => i.id === itemData.id)) currentList.unshift(itemData);
      } else if (action === 'update') {
        const idx = currentList.findIndex(i => i.id === itemData.id);
        if (idx !== -1) currentList[idx] = { ...currentList[idx], ...itemData };
      } else if (action === 'delete') {
        const deleteId = typeof itemData === 'object' ? itemData.id : itemData;
        return currentList.filter(i => i.id !== deleteId);
      }
      return currentList;
    });

    // Update dashboard localStorage cache
    const cachedGlobal = getCachedDashboardData(globalKey);
    if (Array.isArray(cachedGlobal)) {
      let updatedList = [...cachedGlobal];
      if (action === 'add') {
        if (!updatedList.some(i => i.id === itemData.id)) updatedList.unshift(itemData);
      } else if (action === 'update') {
        const idx = updatedList.findIndex(i => i.id === itemData.id);
        if (idx !== -1) updatedList[idx] = { ...updatedList[idx], ...itemData };
      } else if (action === 'delete') {
        const deleteId = typeof itemData === 'object' ? itemData.id : itemData;
        updatedList = updatedList.filter(i => i.id !== deleteId);
      }
      setCachedDashboardData(globalKey, updatedList);
    }
  }
}

/**
 * Instantly update client caches when reference points (calibration) are saved.
 * Ensures floorplan detail, reference-points endpoint, and site floorplan switcher caches
 * are immediately up to date in CacheStorage and localStorage across page reloads.
 */
export async function updateCachedFloorplanReferencePoints(floorplanId, points, siteId = null) {
  const fpIdNum = parseInt(floorplanId, 10);
  if (!fpIdNum) return;

  // 1. Update Floorplan Detail in api-cache (`/api/floorplans/{id}`)
  await updateApiCacheUrl(`/api/floorplans/${fpIdNum}`, (fp) => {
    if (!fp) return null;
    return {
      ...fp,
      reference_points: points || []
    };
  });

  // 2. Update Reference Points direct endpoint in api-cache (`/api/floorplans/{id}/reference-points`)
  await updateApiCacheUrl(`/api/floorplans/${fpIdNum}/reference-points`, () => points || []);

  // 3. Update Site Floorplans List in api-cache (`/api/sites/{siteId}/floorplans`)
  if (siteId) {
    await updateApiCacheUrl(`/api/sites/${siteId}/floorplans`, (fps) => {
      if (!Array.isArray(fps)) return null;
      return fps.map(fp => {
        if (fp.id === fpIdNum) {
          return { ...fp, reference_points: points || [] };
        }
        return fp;
      });
    });

    // 4. Update Dashboard localStorage cache (`equipmap_cache_floorplans_{siteId}`)
    const cachedSiteFps = getCachedDashboardData(`floorplans_${siteId}`);
    if (Array.isArray(cachedSiteFps)) {
      const updated = cachedSiteFps.map(fp => {
        if (fp.id === fpIdNum) {
          return { ...fp, reference_points: points || [] };
        }
        return fp;
      });
      setCachedDashboardData(`floorplans_${siteId}`, updated);
    }
  }
}

/**
 * Synchronously retrieves a floorplan and its site floorplans from localStorage cache in 0ms.
 * Allows MapView to mount and display immediately without waiting on network or CacheStorage.
 */
export function getCachedFloorplanSync(floorplanId) {
  if (typeof window === 'undefined') return null;
  const fpIdNum = parseInt(floorplanId, 10);
  if (!fpIdNum) return null;

  try {
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      if (key && key.startsWith(DASHBOARD_CACHE_PREFIX + 'floorplans_')) {
        const raw = localStorage.getItem(key);
        if (!raw) continue;
        const parsed = JSON.parse(raw);
        const list = parsed.data !== undefined ? parsed.data : parsed;
        if (Array.isArray(list)) {
          const match = list.find(fp => fp.id === fpIdNum);
          if (match) {
            return {
              floorplan: match,
              siteFloorplans: list
            };
          }
        }
      }
    }
  } catch (e) {
    console.warn("Failed to get cached floorplan sync:", e);
  }
  return null;
}

/**
 * Populate each floorplan into api-cache (/api/floorplans/{id}) and (/api/sites/{siteId}/floorplans)
 * so direct lookups hit immediately without network requests, preserving server ETags.
 */
export async function populateFloorplansIntoApiCache(floorplans, siteId = null) {
  if (!Array.isArray(floorplans) || typeof window === 'undefined' || !('caches' in window)) return;
  try {
    const cacheStorage = await caches.open('api-cache');
    for (const fp of floorplans) {
      if (!fp || !fp.id) continue;
      const matchUrl = new URL(`/api/floorplans/${fp.id}`, BASE_URL).toString();
      const existing = await cacheStorage.match(matchUrl);
      const existingEtag = existing?.headers?.get('ETag');

      // Preserve existing server ETag if valid
      const etag = (existingEtag && !existingEtag.includes('fp-') && !existingEtag.includes('local-'))
        ? existingEtag
        : `W/"fp-${fp.id}"`;

      const response = new Response(JSON.stringify(fp), {
        status: 200,
        headers: {
          'Content-Type': 'application/json',
          'ETag': etag,
          'Cache-Control': 'public, max-age=0, must-revalidate'
        }
      });
      await cacheStorage.put(matchUrl, response);
    }
    if (siteId) {
      const siteUrl = new URL(`/api/sites/${siteId}/floorplans`, BASE_URL).toString();
      const existing = await cacheStorage.match(siteUrl);
      const existingEtag = existing?.headers?.get('ETag');

      // If site floorplans already has a server ETag, do not overwrite it with a synthetic timestamp
      if (!existing || !existingEtag || existingEtag.includes('site-fps-') || existingEtag.includes('local-')) {
        const siteResponse = new Response(JSON.stringify(floorplans), {
          status: 200,
          headers: {
            'Content-Type': 'application/json',
            'ETag': existingEtag || `W/"site-fps-${siteId}"`,
            'Cache-Control': 'public, max-age=0, must-revalidate'
          }
        });
        await cacheStorage.put(siteUrl, siteResponse);
      }
    }
  } catch (e) {
    console.warn("Failed to populate floorplans into api-cache:", e);
  }
}

/**
 * Instantly update client caches when a site is added, updated, or deleted.
 */
export async function updateCachedSite(siteId, action, siteData) {
  const sIdNum = parseInt(siteId, 10);
  if (!sIdNum && action !== 'add') return;

  // 1. Update /api/sites in api-cache
  await updateApiCacheUrl('/api/sites', (sites) => {
    if (!Array.isArray(sites)) return null;
    const current = [...sites];
    if (action === 'add') {
      if (!current.some(s => s.id === siteData.id)) current.push(siteData);
    } else if (action === 'update') {
      const idx = current.findIndex(s => s.id === sIdNum);
      if (idx !== -1) current[idx] = { ...current[idx], ...siteData };
    } else if (action === 'delete') {
      return current.filter(s => s.id !== sIdNum);
    }
    return current;
  });

  // 2. Update dashboard localStorage cache
  const cachedSites = getCachedDashboardData('sites');
  if (Array.isArray(cachedSites)) {
    let updated = [...cachedSites];
    if (action === 'add') {
      if (!updated.some(s => s.id === siteData.id)) updated.push(siteData);
    } else if (action === 'update') {
      const idx = updated.findIndex(s => s.id === sIdNum);
      if (idx !== -1) updated[idx] = { ...updated[idx], ...siteData };
    } else if (action === 'delete') {
      updated = updated.filter(s => s.id !== sIdNum);
      removeCachedDashboardData(`floorplans_${sIdNum}`);
    }
    setCachedDashboardData('sites', updated);
  }
}
