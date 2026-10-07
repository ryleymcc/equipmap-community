import { useState, useEffect, useRef, useCallback } from 'react';
import { searchClientEntities } from '../searchEngine';
import { floorplanLogger } from '../floorplanLogger';

export function useMapSearch({
  rooms,
  equipment,
  floorplanId,
  siteFloorplans = [],
  navigate,
  setSearchParams,
  setHighlightedPin,
  setIsLeftDrawerOpen,
  transformComponentRef,
  mapContentRef
}) {
  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState([]);
  const [showSearchResultsList, setShowSearchResultsList] = useState(false);
  const skipNextSearchRef = useRef(false);
  const searchInputRef = useRef(null);

  useEffect(() => {
    if (skipNextSearchRef.current) {
      skipNextSearchRef.current = false;
      return;
    }
    if (searchQuery && searchQuery.trim().length > 0) {
      const results = searchClientEntities(searchQuery, { rooms, equipment, siteFloorplans });
      setSearchResults(results);
      setShowSearchResultsList(true);
    } else {
      setSearchResults([]);
      setShowSearchResultsList(false);
    }
  }, [searchQuery, rooms, equipment, siteFloorplans]);

  const handleSearchResultClick = useCallback((result) => {
    skipNextSearchRef.current = true;
    setSearchQuery(result.name || result.title || '');
    setSearchResults([]);
    setShowSearchResultsList(false);
    setIsLeftDrawerOpen(false);
    if (searchInputRef.current) searchInputRef.current.blur();

    const numericFloorplanId = parseInt(floorplanId, 10);
    if (result.floorplan_id !== numericFloorplanId) {
      floorplanLogger.startSwitch(result.floorplan_id, result.floorplan_name || null, 'Map Search Cross-Floor Result');
      navigate(`/map/${result.floorplan_id}?highlightType=${result.type}&highlightId=${result.id}`, {
        state: { targetResult: result }
      });
      return;
    } else {
      setSearchParams({ highlightType: result.type, highlightId: result.id }, { replace: true });
    }

    setHighlightedPin({ type: result.type, id: result.id });

    if (transformComponentRef.current) {
      let targetX = result.x_coordinate;
      let targetY = result.y_coordinate;

      if (targetX === undefined || targetY === undefined) {
        if (result.type === 'room') {
          const r = rooms.find(room => room.id === result.id);
          if (r) {
            targetX = r.x_coordinate;
            targetY = r.y_coordinate;
          }
        } else if (result.type === 'equipment') {
          const e = equipment.find(equip => equip.id === result.id);
          if (e) {
            targetX = e.x_coordinate;
            targetY = e.y_coordinate;
          }
        }
      }

      if (targetX !== undefined && targetX !== null && targetY !== undefined && targetY !== null) {
        const { setTransform } = transformComponentRef.current;
        const scale = 4;

        const viewportWidth = window.innerWidth;
        const viewportHeight = window.innerHeight;
        const centerX = viewportWidth / 2;
        const centerY = viewportHeight / 2;

        let finalX = -targetX * scale + centerX;
        let finalY = -targetY * scale + centerY;

        const mapWidth = 2000;
        const mapHeight = mapContentRef.current?.clientHeight || 1500;

        const minX = viewportWidth - (mapWidth * scale);
        const minY = viewportHeight - (mapHeight * scale);

        finalX = Math.max(minX, Math.min(0, finalX));
        finalY = Math.max(minY, Math.min(0, finalY));

        setTransform(finalX, finalY, scale, 500);
      } else if (result.x_coordinate != null && result.y_coordinate != null) {
        const { zoomToElement } = transformComponentRef.current;
        const elementId = `pin-${result.type}-${result.id}`;
        if (zoomToElement) zoomToElement(elementId, 4, 500);
      }
    }
  }, [rooms, equipment, floorplanId, navigate, setSearchParams, setHighlightedPin, setIsLeftDrawerOpen, transformComponentRef, mapContentRef]);

  return {
    searchQuery,
    setSearchQuery,
    searchResults,
    setSearchResults,
    showSearchResultsList,
    setShowSearchResultsList,
    skipNextSearchRef,
    searchInputRef,
    handleSearchResultClick
  };
}
