/* eslint-disable react-refresh/only-export-components */
import { createContext, useState, useContext, useEffect, useCallback, useRef } from 'react';
import { getSites, getFloorplans, getAllEquipment, getAllRooms, checkSyncUpdates, API_URL, BASE_URL, LOW_PRIORITY_CONFIG } from './api';
import { useNetworkStatus } from './hooks/useNetworkStatus';
import { populateFloorplansIntoApiCache, getCachedDashboardData } from './cacheUtils';

const OfflineContext = createContext(null);

export const OfflineProvider = ({ children }) => {
  const isOnline = useNetworkStatus();
  const [isSyncing, setIsSyncing] = useState(false);
  const [lastSyncTime, setLastSyncTime] = useState(localStorage.getItem('lastSyncTime'));
  const syncInProgress = useRef(false);

  const syncData = useCallback(async () => {
    if (syncInProgress.current || !isOnline) {
      console.log('OfflineSync: Skip sync', { isSyncing: syncInProgress.current, isOnline });
      return;
    }

    console.log('OfflineSync: Starting background sync...');
    syncInProgress.current = true;
    setIsSyncing(true);

    try {
      // 1. Open the api-cache
      const cache = await caches.open('api-cache');
      const keys = await cache.keys();

      // 2. Collect local ETags
      const etags = {};
      const requestUrls = new Set();

      for (const req of keys) {
        if (req.method !== 'GET') continue;
        const response = await cache.match(req);
        if (response) {
          const etag = response.headers.get('ETag');
          if (etag && !etag.includes('local-') && !etag.includes('fp-') && !etag.includes('site-fps-')) {
            etags[req.url] = etag;
          }
          requestUrls.add(req.url);
        }
      }

      console.log(`OfflineSync: Found ${requestUrls.size} cached items. Checking for updates...`);

      // 3. Request update check from server (low priority)
      const updateRes = await checkSyncUpdates(etags, LOW_PRIORITY_CONFIG);
      const urlsToUpdate = updateRes.data.urls_to_update || [];
      const urlsToUpdateSet = new Set(urlsToUpdate);
      console.log(`OfflineSync: Server returned ${urlsToUpdate.length} out-of-date URLs:`, urlsToUpdate);

      // Helper to fetch from network if out-of-date or not cached, else load from cache/localStorage
      const getCachedOrFetch = async (apiUrl, fetchFunc, localStorageKey = null) => {
        const fullUrl = apiUrl.startsWith('http') ? apiUrl : `${BASE_URL}${apiUrl}`;
        const isStale = urlsToUpdateSet.has(fullUrl);

        if (!isStale) {
          // Check api-cache first
          const cachedResponse = await cache.match(fullUrl);
          if (cachedResponse) {
            try {
              return await cachedResponse.json();
            } catch (err) {
              console.warn(`OfflineSync: Failed to parse JSON from cache for ${apiUrl}`, err);
            }
          }

          // Check dashboard localStorage cache if available
          if (localStorageKey) {
            const localData = getCachedDashboardData(localStorageKey);
            if (localData) {
              // Populate api-cache so subsequent checks hit cache
              try {
                const syntheticRes = new Response(JSON.stringify(localData), {
                  status: 200,
                  headers: {
                    'Content-Type': 'application/json',
                    'ETag': `W/"local-${localStorageKey}"`,
                    'Cache-Control': 'public, max-age=0, must-revalidate'
                  }
                });
                await cache.put(fullUrl, syntheticRes);
              } catch {
                /* ignore cache put error */
              }
              return localData;
            }
          }
        }

        console.log(`OfflineSync: Fetching from network: ${apiUrl}`);
        const res = await fetchFunc();
        return res.data || [];
      };

      // 4. Fetch/Load Sites (low priority)
      console.log('OfflineSync: Processing sites...');
      const sites = await getCachedOrFetch('/api/sites', () => getSites(LOW_PRIORITY_CONFIG), 'sites');
      console.log(`OfflineSync: Processed ${sites.length} sites`);

      // 5. Fetch/Load global rooms and equipment (low priority)
      console.log('OfflineSync: Processing global equipment and rooms...');
      await Promise.allSettled([
        getCachedOrFetch('/api/equipment', () => getAllEquipment(LOW_PRIORITY_CONFIG), 'equipment').then(() => console.log('OfflineSync: Processed all equipment')),
        getCachedOrFetch('/api/rooms', () => getAllRooms(LOW_PRIORITY_CONFIG), 'rooms').then(() => console.log('OfflineSync: Processed all rooms'))
      ]);

      // 6. Prefetch each site's floorplans and populate caches
      const assetsCache = await caches.open('assets-cache');
      for (const site of sites) {
        console.log(`OfflineSync: Processing site ${site.name} (${site.id})...`);
        const floorplans = await getCachedOrFetch(`/api/sites/${site.id}/floorplans`, () => getFloorplans(site.id, LOW_PRIORITY_CONFIG), `floorplans_${site.id}`);
        console.log(`OfflineSync: Found ${floorplans.length} floorplans for site ${site.id}`);

        if (Array.isArray(floorplans)) {
          // Immediately populate all floorplans into api-cache (/api/floorplans/{id})
          await populateFloorplansIntoApiCache(floorplans, site.id);

          // Stagger file pre-fetching so we don't saturate network bandwidth
          for (const fp of floorplans) {
            try {
              if (fp && fp.file_path) {
                const fileUrl = fp.file_path.startsWith('http') ? fp.file_path : `${API_URL}${fp.file_path}`;
                const cachedFile = await assetsCache.match(fileUrl);
                if (!cachedFile) {
                  console.log(`OfflineSync: Pre-fetching floorplan asset ${fileUrl}`);
                  const res = await fetch(fileUrl, { priority: 'low' }).catch(err => console.warn(`OfflineSync: Asset fetch failed for ${fp.name}:`, err));
                  if (res && res.ok) {
                    await assetsCache.put(fileUrl, res.clone());
                  }
                }
              }
            } catch (fpErr) {
              console.warn(`OfflineSync: Error caching floorplan asset ${fp.id}:`, fpErr);
            }
          }
        }
      }

      const now = new Date().toLocaleString();
      localStorage.setItem('lastSyncTime', now);
      setLastSyncTime(now);
      console.log('OfflineSync: Background sync completed successfully at', now);
    } catch (error) {
      console.error('OfflineSync: Background sync failed:', error);
    } finally {
      syncInProgress.current = false;
      setIsSyncing(false);
    }
  }, [isOnline]);

  // Initial sync delayed and run during idle cycles so user interactions are never blocked
  useEffect(() => {
    if (isOnline) {
      const runSync = () => {
        if ('requestIdleCallback' in window) {
          window.requestIdleCallback(() => syncData(), { timeout: 10000 });
        } else {
          syncData();
        }
      };
      const timer = setTimeout(runSync, 5000);
      return () => clearTimeout(timer);
    }
  }, [isOnline, syncData]);

  return (
    <OfflineContext.Provider value={{ isSyncing, lastSyncTime, syncData }}>
      {children}
    </OfflineContext.Provider>
  );
};

export const useOffline = () => useContext(OfflineContext);
