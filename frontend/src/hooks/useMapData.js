/* eslint-disable react-hooks/set-state-in-effect */
import { useState, useEffect, useCallback, useRef } from 'react';
import { getFloorplan, getFloorplans, BASE_URL } from '../api';
import { getCachedDashboardData, setCachedDashboardData, getCachedFloorplanSync } from '../cacheUtils';
import { floorplanLogger } from '../floorplanLogger';

export function useMapData(floorplanId, activeActionType, setPdfLoaded, preloadedFloorplan = null) {
  const [floorplan, setFloorplan] = useState(() => preloadedFloorplan || getCachedFloorplanSync(floorplanId)?.floorplan || null);
  const [rooms, setRooms] = useState(() => preloadedFloorplan?.rooms || getCachedFloorplanSync(floorplanId)?.floorplan?.rooms || []);
  const [equipment, setEquipment] = useState(() => preloadedFloorplan?.equipment || getCachedFloorplanSync(floorplanId)?.floorplan?.equipment || []);
  const [tickets, setTickets] = useState(() => preloadedFloorplan?.tickets || getCachedFloorplanSync(floorplanId)?.floorplan?.tickets || []);
  const [siteFloorplans, setSiteFloorplans] = useState(() => getCachedFloorplanSync(floorplanId)?.siteFloorplans || []);
  const [lastPlacedRoomName, setLastPlacedRoomName] = useState(null);
  const [pendingRooms, setPendingRooms] = useState([]);
  const [dataLoaded, setDataLoaded] = useState(() => Boolean(preloadedFloorplan || getCachedFloorplanSync(floorplanId)?.floorplan));
  const [isRefreshing, setIsRefreshing] = useState(false);

  const activeActionTypeRef = useRef(activeActionType);
  const floorplanRef = useRef(null);
  const siteFloorplansRef = useRef(siteFloorplans);

  useEffect(() => {
    activeActionTypeRef.current = activeActionType;
  }, [activeActionType]);

  useEffect(() => {
    siteFloorplansRef.current = siteFloorplans;
  }, [siteFloorplans]);

  const loadMapData = useCallback(async (forceFullReload = true) => {
    floorplanLogger.recordDataStart(floorplanId);
    if (forceFullReload) {
      if (setPdfLoaded) setPdfLoaded(false);
      setDataLoaded(false);
    } else {
      setIsRefreshing(true);
    }

    try {
      // 1. Fetch the main floorplan first
      const fpRes = await getFloorplan(floorplanId);
      const fpData = fpRes.data;
      if (!fpData) throw new Error("Floorplan data not found");

      floorplanRef.current = fpData;
      setFloorplan(fpData);
      setRooms(fpData.rooms || []);
      setEquipment(fpData.equipment || []);
      setTickets(fpData.tickets || []);

      // Early signal that the primary map data is ready
      setDataLoaded(true);
      floorplanLogger.recordDataSuccess(floorplanId, {
        source: 'Network API (GET /api/floorplans/:id)',
        roomsCount: (fpData.rooms || []).length,
        equipmentCount: (fpData.equipment || []).length,
        ticketsCount: (fpData.tickets || []).length,
        floorplanName: fpData.name
      });

      // 2. Fetch the switcher list in parallel only if needed or force full reload
      if (fpData.site_id && (forceFullReload || siteFloorplansRef.current.length === 0)) {
        const config = !forceFullReload ? { priority: 'low', headers: { 'Priority': 'u=6, i' } } : undefined;
        getFloorplans(fpData.site_id, config).then(switcherRes => {
          const list = switcherRes.data || [];
          const merged = list.map(sFp => {
            if (sFp.id === fpData.id && (fpData.reference_points || []).length === 2) {
              return { ...sFp, reference_points: fpData.reference_points };
            }
            return sFp;
          });
          setSiteFloorplans(merged);
          setCachedDashboardData(`floorplans_${fpData.site_id}`, merged);
        }).catch(err => console.warn("Failed to load switcher floorplans:", err));
      }

      let dbLastName = null;
      if (fpData.rooms && fpData.rooms.length > 0) {
        const sorted = [...fpData.rooms].sort((a, b) => b.id - a.id);
        dbLastName = sorted[0].name;
      }

      setLastPlacedRoomName(current => {
        if (activeActionTypeRef.current === 'room' && current !== null) {
          return current;
        }
        return dbLastName;
      });
    } catch (error) {
      console.error("Failed to load map data:", error);
      setDataLoaded(true); // Ensure loader is hidden even on error
    } finally {
      setIsRefreshing(false);
    }
  }, [floorplanId, setPdfLoaded]);

  useEffect(() => {
    if (setPdfLoaded) setPdfLoaded(false);
    // Do not let the previous floorplan's pins remain visible while this
    // route resolves. Cache/preloaded data below will repopulate these state
    // values immediately when it is available.
    setFloorplan(null);
    setRooms([]);
    setEquipment([]);
    setTickets([]);
    setDataLoaded(false);
    setLastPlacedRoomName(null);
    setPendingRooms([]);

    let active = true;

    async function checkCacheAndLoad() {
      floorplanLogger.ensureSwitch(floorplanId, null, 'Route Change');
      floorplanLogger.recordDataStart(floorplanId);
      const fpIdNum = parseInt(floorplanId, 10);

      // Check preloadedFloorplan or in-memory siteFloorplans first
      let preloaded = null;
      if (preloadedFloorplan && preloadedFloorplan.id === fpIdNum) {
        preloaded = preloadedFloorplan;
      } else if (siteFloorplansRef.current.length > 0) {
        const found = siteFloorplansRef.current.find(fp => fp.id === fpIdNum);
        if (found) preloaded = found;
      }

      // Fallback to synchronous localStorage hit
      const syncHit = preloaded ? { floorplan: preloaded, siteFloorplans: siteFloorplansRef.current } : getCachedFloorplanSync(floorplanId);
      let loadedFromCache = Boolean(syncHit?.floorplan);
      let cachedEtag = null;

      if (syncHit?.floorplan && active) {
        floorplanRef.current = syncHit.floorplan;
        setFloorplan(syncHit.floorplan);
        setRooms(syncHit.floorplan.rooms || []);
        setEquipment(syncHit.floorplan.equipment || []);
        setTickets(syncHit.floorplan.tickets || []);
        if (syncHit.siteFloorplans && syncHit.siteFloorplans.length > 0) {
          setSiteFloorplans(syncHit.siteFloorplans);
        }
        setDataLoaded(true);
        floorplanLogger.recordDataSuccess(floorplanId, {
          source: preloaded ? 'Memory (Preloaded floorplan state)' : 'LocalStorage (Sync cache)',
          roomsCount: (syncHit.floorplan.rooms || []).length,
          equipmentCount: (syncHit.floorplan.equipment || []).length,
          ticketsCount: (syncHit.floorplan.tickets || []).length,
          floorplanName: syncHit.floorplan.name
        });
      }

      try {
        if ('caches' in window) {
          const cacheStorage = await caches.open('api-cache');
          const matchUrl = new URL(`/api/floorplans/${floorplanId}`, BASE_URL).toString();
          let cachedResponse = await cacheStorage.match(matchUrl);

          // If not directly cached under /api/floorplans/{id}, check site floorplans in api-cache
          if (!cachedResponse) {
            const keys = await cacheStorage.keys();
            for (const req of keys) {
              if (req.url.includes('/api/sites/') && req.url.includes('/floorplans')) {
                const siteRes = await cacheStorage.match(req);
                if (siteRes) {
                  try {
                    const list = await siteRes.clone().json();
                    if (Array.isArray(list)) {
                      const matchFp = list.find(f => f.id === fpIdNum);
                      if (matchFp) {
                        cachedResponse = new Response(JSON.stringify(matchFp), {
                          status: 200,
                          headers: {
                            'Content-Type': 'application/json',
                            'ETag': siteRes.headers.get('ETag') || `W/"site-fp-${matchFp.id}"`,
                            'Cache-Control': 'public, max-age=0, must-revalidate'
                          }
                        });
                        // Put directly into api-cache for future instant match
                        await cacheStorage.put(matchUrl, cachedResponse.clone());
                        break;
                      }
                    }
                  } catch (e) {
                    console.warn("Failed to parse cached site floorplan list:", e);
                  }
                }
              }
            }
          }

          if (cachedResponse && active) {
            const fpData = await cachedResponse.json();
            if (fpData && fpData.id === fpIdNum) {
              floorplanRef.current = fpData;
              setFloorplan(fpData);
              setRooms(fpData.rooms || []);
              setEquipment(fpData.equipment || []);
              setTickets(fpData.tickets || []);
              setDataLoaded(true);
              loadedFromCache = true;
              cachedEtag = cachedResponse.headers.get('ETag');
              floorplanLogger.recordDataSuccess(floorplanId, {
                source: 'CacheStorage (api-cache)',
                roomsCount: (fpData.rooms || []).length,
                equipmentCount: (fpData.equipment || []).length,
                ticketsCount: (fpData.tickets || []).length,
                floorplanName: fpData.name
              });

              // Load switcher options from cache if present
              if (fpData.site_id && siteFloorplansRef.current.length === 0) {
                const switcherUrl = new URL(`/api/sites/${fpData.site_id}/floorplans`, BASE_URL).toString();
                const cachedSwitcher = await cacheStorage.match(switcherUrl);
                let switcherData = null;
                if (cachedSwitcher) {
                  try {
                    switcherData = await cachedSwitcher.json();
                  } catch (e) {
                    console.warn("Failed to parse cached switcher data:", e);
                  }
                }
                if (!switcherData || !Array.isArray(switcherData)) {
                  switcherData = getCachedDashboardData(`floorplans_${fpData.site_id}`);
                }
                if (switcherData && Array.isArray(switcherData)) {
                  const merged = switcherData.map(sFp => {
                    if (sFp.id === fpData.id && (fpData.reference_points || []).length === 2) {
                      return { ...sFp, reference_points: fpData.reference_points };
                    }
                    return sFp;
                  });
                  setSiteFloorplans(merged);
                }
              }
            }
          }
        }
      } catch (e) {
        console.warn("Error reading from Cache Storage in useMapData:", e);
      }

      if (!active) return;

      if (!loadedFromCache) {
        // Cache miss: clear states and show full loader
        setFloorplan(null);
        setRooms([]);
        setEquipment([]);
        setTickets([]);
        loadMapData(true);
        return;
      }

      // Cache hit — validate quietly with If-None-Match in background when idle.
      // If the server returns 304, data is unchanged.
      // If 200, update state and cache with fresh data.
      const runBackgroundValidation = async () => {
        if (!active) return;
        const revalStart = performance.now();
        try {
          setIsRefreshing(true);
          const fpUrl = new URL(`/api/floorplans/${floorplanId}`, BASE_URL).toString();
          const token = localStorage.getItem('token');
          const reqHeaders = {
            'Priority': 'u=6, i'
          };
          if (cachedEtag) reqHeaders['If-None-Match'] = cachedEtag;
          if (token) reqHeaders['Authorization'] = `Bearer ${token}`;

          const res = await fetch(fpUrl, {
            headers: reqHeaders,
            priority: 'low'
          });
          if (!active) return;

          const revalDuration = performance.now() - revalStart;
          if (res.status === 304) {
            // Cache is fresh, nothing changed
            floorplanLogger.recordBackgroundRevalidation(floorplanId, {
              status: '304 Not Modified',
              duration: revalDuration,
              updated: false
            });
            return;
          }

          if (res.status === 200) {
            const newEtag = res.headers.get('ETag');
            const fpData = await res.json();
            if (!active) return;
            floorplanRef.current = fpData;
            setFloorplan(fpData);
            setRooms(fpData.rooms || []);
            setEquipment(fpData.equipment || []);
            setTickets(fpData.tickets || []);
            floorplanLogger.recordBackgroundRevalidation(floorplanId, {
              status: '200 OK',
              duration: revalDuration,
              updated: true
            });

            if ('caches' in window) {
              try {
                const cacheStorage = await caches.open('api-cache');
                const matchUrl = new URL(`/api/floorplans/${floorplanId}`, BASE_URL).toString();
                const updatedResponse = new Response(JSON.stringify(fpData), {
                  status: 200,
                  headers: {
                    'Content-Type': 'application/json',
                    'ETag': newEtag || `W/"fp-${Date.now()}"`,
                    'Cache-Control': 'public, max-age=0, must-revalidate'
                  }
                });
                await cacheStorage.put(matchUrl, updatedResponse);
              } catch (e) {
                console.warn("Failed to update cache on 200 in useMapData:", e);
              }
            }

            let dbLastName = null;
            if (fpData.rooms && fpData.rooms.length > 0) {
              const sorted = [...fpData.rooms].sort((a, b) => b.id - a.id);
              dbLastName = sorted[0].name;
            }
            setLastPlacedRoomName(current => {
              if (activeActionTypeRef.current === 'room' && current !== null) return current;
              return dbLastName;
            });
          }
        } catch (err) {
          console.warn("Background ETag validation failed:", err);
        } finally {
          if (active) setIsRefreshing(false);
        }
      };

      if ('requestIdleCallback' in window) {
        window.requestIdleCallback(runBackgroundValidation, { timeout: 3500 });
      } else {
        setTimeout(runBackgroundValidation, 1000);
      }
    }

    checkCacheAndLoad();

    return () => {
      active = false;
    };
  }, [floorplanId, loadMapData, setPdfLoaded]);

  return {
    floorplan,
    setFloorplan,
    rooms,
    setRooms,
    equipment,
    setEquipment,
    tickets,
    setTickets,
    siteFloorplans,
    setSiteFloorplans,
    lastPlacedRoomName,
    setLastPlacedRoomName,
    pendingRooms,
    setPendingRooms,
    dataLoaded,
    setDataLoaded,
    isRefreshing,
    setIsRefreshing,
    loadMapData
  };
}
