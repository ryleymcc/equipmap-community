import { useState, useEffect, useRef } from 'react';

/**
 * Hook to implement pull-to-refresh functionality on stationary elements.
 * @param {Function} onRefresh - Callback function to execute on refresh.
 * @param {Object} options - Configuration options.
 * @param {number} options.threshold - Distance in pixels to trigger refresh.
 * @param {string} options.stationarySelector - CSS selector for elements that should trigger pull-to-refresh.
 */
export function usePullToRefresh(onRefresh, { threshold = 80, stationarySelector = '.map-header, .placement-banner, .drawer' } = {}) {
  const [pullDistance, setPullDistance] = useState(0);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const startYRef = useRef(0);
  const isPullingRef = useRef(false);

  useEffect(() => {
    const handleTouchStart = (e) => {
      if (isRefreshing || e.touches.length > 1) return;

      // Check if we are touching a stationary element
      const target = e.target;
      const isStationary = target.closest(stationarySelector);

      if (isStationary) {
        startYRef.current = e.touches[0].pageY;
        isPullingRef.current = true;
      }
    };

    const handleTouchMove = (e) => {
      if (!isPullingRef.current || isRefreshing) return;

      const currentY = e.touches[0].pageY;
      const diff = currentY - startYRef.current;

      if (diff > 0) {
        // Apply some resistance
        const resistance = 0.5;
        const actualDiff = diff * resistance;
        setPullDistance(Math.min(actualDiff, threshold + 40));

        // Prevent default only if we are pulling down
        if (actualDiff > 10 && e.cancelable) {
          e.preventDefault();
        }
      } else {
        setPullDistance(0);
        isPullingRef.current = false;
      }
    };

    const handleTouchEnd = () => {
      if (!isPullingRef.current || isRefreshing) return;

      if (pullDistance >= threshold) {
        handleTriggerRefresh();
      } else {
        setPullDistance(0);
      }
      isPullingRef.current = false;
    };

    const handleTriggerRefresh = async () => {
      setIsRefreshing(true);
      setPullDistance(threshold); // Keep it at threshold during refresh
      try {
        await onRefresh();
      } catch (error) {
        console.error("Refresh failed:", error);
      } finally {
        setIsRefreshing(false);
        setPullDistance(0);
      }
    };

    window.addEventListener('touchstart', handleTouchStart, { passive: false });
    window.addEventListener('touchmove', handleTouchMove, { passive: false });
    window.addEventListener('touchend', handleTouchEnd);

    return () => {
      window.removeEventListener('touchstart', handleTouchStart);
      window.removeEventListener('touchmove', handleTouchMove);
      window.removeEventListener('touchend', handleTouchEnd);
    };
  }, [onRefresh, isRefreshing, pullDistance, threshold, stationarySelector]);

  return { pullDistance, isRefreshing };
}
