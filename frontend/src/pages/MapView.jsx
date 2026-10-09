/* eslint-disable react-hooks/set-state-in-effect */
import React, { useState, useEffect, useRef, useMemo, useCallback } from 'react';
import { useParams, useNavigate, useLocation, useSearchParams } from 'react-router-dom';
import { useAuth } from '../AuthContext';
import { MapPin, Eye, EyeOff, Loader2, AlertTriangle, X } from 'lucide-react';
import { computeTransform, applyTransform } from '../alignmentUtils';
import {
  deleteRoom,
  deleteEquipment,
  deleteTicket,
  createRoom,
  createEquipment,
  createTicket,
  updateRoom,
  updateEquipment,
  updateTicket,
  getWorkOrders,
  getErrorMessage,
  BASE_URL
} from '../api';
import { updateCachedFloorplanItem } from '../cacheUtils';

import { COLORS, incrementRoomName } from '../mapConstants';
import { floorplanLogger } from '../floorplanLogger';

const dispersePins = (pins) => {
  const groups = {};
  pins.forEach(pin => {
    const key = `${Math.round(pin.x_coordinate)},${Math.round(pin.y_coordinate)}`;
    if (!groups[key]) groups[key] = [];
    groups[key].push(pin);
  });

  const dispersed = [];
  Object.values(groups).forEach(group => {
    if (group.length === 1) {
      dispersed.push({
        ...group[0],
        x_display: group[0].x_coordinate,
        y_display: group[0].y_coordinate
      });
    } else {
      const N = group.length;
      const radius = 35; // 35 pixels offset on raw map coordinate scale
      group.forEach((pin, index) => {
        const angle = (2 * Math.PI * index) / N;
        dispersed.push({
          ...pin,
          x_display: pin.x_coordinate + radius * Math.cos(angle),
          y_display: pin.y_coordinate + radius * Math.sin(angle),
          isDispersed: true
        });
      });
    }
  });
  return dispersed;
};

// Imports of custom hooks and sub-components
import { useMapData } from '../hooks/useMapData';
import { useMapSearch } from '../hooks/useMapSearch';
import { useCalibration } from '../hooks/useCalibration';
import { useMapMode } from '../hooks/useMapMode';

import { MapHeader } from '../components/MapHeader';
import { LeftDrawer } from '../components/LeftDrawer';
import { RightDrawer } from '../components/RightDrawer';
import { MapCanvas } from '../components/MapCanvas';
import WorkOrderDetailModal from '../components/WorkOrderDetailModal';
import WorkOrderCreateModal from '../components/WorkOrderCreateModal';

export default function MapView() {
  const { floorplanId } = useParams();
  const navigate = useNavigate();
  const location = useLocation();
  const auth = useAuth();
  const user = auth.user;
  const logout = auth.logout;
  const isAdmin = auth.isAdmin;
  const isEditor = auth.isEditor;
  const [searchParams, setSearchParams] = useSearchParams();

  const highlightType = searchParams.get('highlightType');
  const highlightId = searchParams.get('highlightId') ? parseInt(searchParams.get('highlightId')) : null;

  // Work Orders on Map
  const [floorplanWorkOrders, setFloorplanWorkOrders] = useState([]);
  const [selectedWorkOrder, setSelectedWorkOrder] = useState(null);
  const [isCreateWorkOrderOpen, setIsCreateWorkOrderOpen] = useState(false);

  // Drawer open/close states
  const [isLeftDrawerOpen, setIsLeftDrawerOpen] = useState(false);
  const [isRightDrawerOpen, setIsRightDrawerOpen] = useState(false);
  const [showPointNames, setShowPointNames] = useState(localStorage.getItem('showPointNames') === 'true');

  // Multi-floor reference pin state (stored locally)
  const [multiFloorRefPin, setMultiFloorRefPin] = useState(() => {
    try {
      const saved = localStorage.getItem('multiFloorRefPin');
      return saved ? JSON.parse(saved) : null;
    } catch {
      return null;
    }
  });
  const [uncalibratedWarning, setUncalibratedWarning] = useState(null);


  useEffect(() => {
    localStorage.setItem('showPointNames', showPointNames);
  }, [showPointNames]);

  // Forms config/error states
  const [formError, setFormError] = useState('');
  const [equipColor, setEquipColor] = useState(localStorage.getItem('defaultEquipColor') || COLORS[0]);

  // Input states for placement mode
  const [nextRoomName, setNextRoomName] = useState('');
  const [nextEquipName, setNextEquipName] = useState('');
  const [nextDescription, setNextDescription] = useState('');
  const [nextToolsRequired, setNextToolsRequired] = useState('');
  const [isNameError, setIsNameError] = useState(false);

  const [pdfLoaded, setPdfLoaded] = useState(false);
  const [switchingToFloorplan, setSwitchingToFloorplan] = useState(null);
  const [highlightedPin, setHighlightedPin] = useState(null);
  const [isPendingSync, setIsPendingSync] = useState(false);
  const [isMobile, setIsMobile] = useState(window.innerWidth <= 768);
  const workOrderRequestRef = useRef(0);

  useEffect(() => {
    setPdfLoaded(false);
  }, [floorplanId]);

  useEffect(() => {
    const handleResize = () => setIsMobile(window.innerWidth <= 768);
    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, []);

  useEffect(() => {
    document.body.classList.add('map-page-active');
    document.documentElement.classList.add('map-page-active');
    return () => {
      document.body.classList.remove('map-page-active');
      document.documentElement.classList.remove('map-page-active');
    };
  }, []);

  // Refs for element hooks
  const transformComponentRef = useRef(null);
  const mapContentRef = useRef(null);

  const {
    mapMode,
    editMode,
    activeActionType,
    newPinCoord,
    editingRoom,
    editingEquipment,
    editingTicket,
    isRelocating,
    setModeView,
    setModeAddPlacement,
    setModeAddForm,
    setModeEdit,
    setModeRelocate
  } = useMapMode();

  // 2. Fetch data hook
  const {
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
    isRefreshing,
    loadMapData
  } = useMapData(floorplanId, activeActionType, setPdfLoaded, location.state?.preloadedFloorplan);

  // Load Work Orders for this floorplan (only open work orders)
  const loadFloorplanWorkOrders = useCallback(async () => {
    if (!floorplanId) return;
    const requestId = ++workOrderRequestRef.current;
    try {
      const res = await getWorkOrders({ floorplan_id: floorplanId, status: 'open' });
      if (requestId !== workOrderRequestRef.current) return;
      setFloorplanWorkOrders(res.data?.data || []);
    } catch (err) {
      console.error("Failed to load floorplan work orders:", err);
    }
  }, [floorplanId]);

  useEffect(() => {
    // Work orders are floorplan-scoped too; clear them at the same time as
    // the asset pins so a route transition cannot briefly show old badges.
    setFloorplanWorkOrders([]);
    loadFloorplanWorkOrders();
  }, [loadFloorplanWorkOrders]);

  const handlePinWorkOrderClick = useCallback((wo) => {
    setSelectedWorkOrder(wo);
  }, []);

  const handleWorkOrderUpdated = useCallback((updatedWo, deletedId) => {
    loadFloorplanWorkOrders();
    if (deletedId && selectedWorkOrder?.id === deletedId) {
      setSelectedWorkOrder(null);
    } else if (updatedWo && selectedWorkOrder?.id === updatedWo.id) {
      setSelectedWorkOrder(updatedWo);
    }
  }, [loadFloorplanWorkOrders, selectedWorkOrder]);

  const handleWorkOrderCreated = useCallback(() => {
    loadFloorplanWorkOrders();
  }, [loadFloorplanWorkOrders]);

  // 3. Search logic hook
  const {
    searchQuery,
    setSearchQuery,
    searchResults,
    setSearchResults,
    showSearchResultsList,
    setShowSearchResultsList,
    skipNextSearchRef,
    searchInputRef,
    handleSearchResultClick
  } = useMapSearch({
    rooms,
    equipment,
    floorplanId,
    siteFloorplans,
    navigate,
    setSearchParams,
    setHighlightedPin,
    setIsLeftDrawerOpen,
    transformComponentRef,
    mapContentRef
  });

  // 4. Calibration hook
  const {
    calibrationMode,
    baseFloorplanId,
    overlayTransform,
    setOverlayTransform,
    overlayOpacity,
    setOverlayOpacity,
    isDraggingOverlay,
    setIsDraggingOverlay,
    overlayDragRef,
    handleEnterCalibration,
    handleBaseFloorplanChange,
    handleSaveCalibration,
    handleExitCalibration
  } = useCalibration({
    floorplan,
    siteFloorplans,
    setFloorplan,
    setSiteFloorplans,
    floorplanId,
    loadMapData,
    onEnterCalibration: () => {
      setModeView();
      setIsRightDrawerOpen(false);
    }
  });

  // Resolve Multi-Floor Reference Pin coordinates on current floorplan
  const activeMultiFloorRefPin = useMemo(() => {
    if (!multiFloorRefPin || !floorplan) return null;
    const currentId = parseInt(floorplanId, 10);

    // If on the floorplan where it was placed:
    if (multiFloorRefPin.floorplanId === currentId) {
      return {
        ...multiFloorRefPin,
        x_coordinate: multiFloorRefPin.x,
        y_coordinate: multiFloorRefPin.y,
        isSourceFloor: true,
        isCalibrated: true
      };
    }

    // If on another floorplan, compute similarity transformation
    const srcFp = siteFloorplans.find(fp => fp.id === multiFloorRefPin.floorplanId);
    const targetFp = floorplan;
    const srcRefPoints = srcFp?.reference_points || [];
    const targetRefPoints = targetFp?.reference_points || [];

    if (srcRefPoints.length === 2 && targetRefPoints.length === 2) {
      const transform = computeTransform(srcRefPoints, targetRefPoints);
      if (transform) {
        const mapped = applyTransform(transform, multiFloorRefPin.x, multiFloorRefPin.y);
        return {
          ...multiFloorRefPin,
          x_coordinate: mapped.x,
          y_coordinate: mapped.y,
          isSourceFloor: false,
          isCalibrated: true
        };
      }
    }

    return {
      ...multiFloorRefPin,
      x_coordinate: null,
      y_coordinate: null,
      isSourceFloor: false,
      isCalibrated: false
    };
  }, [multiFloorRefPin, floorplan, floorplanId, siteFloorplans]);

  // Uncalibrated Floor Warning when multi-floor pin is active
  useEffect(() => {
    if (!multiFloorRefPin || !floorplan) {
      setUncalibratedWarning(null);
      return;
    }

    const currentId = parseInt(floorplanId, 10);
    if (multiFloorRefPin.floorplanId !== currentId) {
      const srcFp = siteFloorplans.find(fp => fp.id === multiFloorRefPin.floorplanId);
      const targetFp = floorplan;
      const srcRefPoints = srcFp?.reference_points || [];
      const targetRefPoints = targetFp?.reference_points || [];
      const isCalibrated = srcRefPoints.length === 2 && targetRefPoints.length === 2;

      if (!isCalibrated) {
        setUncalibratedWarning('This floor has not been calibrated. The multi-floor reference point will not be shown.');
      } else {
        setUncalibratedWarning(null);
      }
    } else {
      setUncalibratedWarning(null);
    }
  }, [floorplanId, floorplan, siteFloorplans, multiFloorRefPin]);

  const handleRemoveMultiFloorRefPin = useCallback(() => {
    setMultiFloorRefPin(null);
    localStorage.removeItem('multiFloorRefPin');
    setModeView();
  }, [setModeView]);

  const handlePinMultiFloorRefClick = useCallback((pinData) => {
    setModeEdit('multi-floor-ref', pinData);
    setIsRightDrawerOpen(true);
  }, [setModeEdit]);

  // Hotkey deletion trigger
  useEffect(() => {
    const handleKeyDown = async (e) => {
      if (e.key === 'Delete') {
        if (
          document.activeElement &&
          (document.activeElement.tagName === 'INPUT' ||
            document.activeElement.tagName === 'TEXTAREA' ||
            document.activeElement.contentEditable === 'true')
        ) {
          return;
        }

        if (editingRoom) {
          e.preventDefault();
          if (window.confirm(`Are you sure you want to delete room "${editingRoom.name}"?`)) {
            try {
              await deleteRoom(editingRoom.id);
              setRooms(prev => prev.filter(r => r.id !== editingRoom.id));
              setModeView();
              setIsRightDrawerOpen(false);
            } catch (err) {
              console.error(err);
            }
          }
        } else if (editingEquipment) {
          e.preventDefault();
          if (window.confirm(`Are you sure you want to delete equipment "${editingEquipment.name}"?`)) {
            try {
              await deleteEquipment(editingEquipment.id);
              setEquipment(prev => prev.filter(eq => eq.id !== editingEquipment.id));
              setModeView();
              setIsRightDrawerOpen(false);
            } catch (err) {
              console.error(err);
            }
          }
        } else if (editingTicket) {
          e.preventDefault();
          if (window.confirm(`Are you sure you want to delete ticket "${editingTicket.title}"?`)) {
            try {
              await deleteTicket(editingTicket.id);
              setTickets(prev => prev.filter(t => t.id !== editingTicket.id));
              setModeView();
              setIsRightDrawerOpen(false);
            } catch (err) {
              console.error(err);
            }
          }
        }
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [editingRoom, editingEquipment, editingTicket, setRooms, setEquipment, setTickets, setModeView]);

  // Sync back when tab becomes visible — ETag-first to avoid unnecessary refetches.
  // Using visibilitychange only (not window focus) to avoid spurious checks from
  // in-page interactions like opening/closing drawers which also trigger focus events.
  useEffect(() => {
    const handleVisibility = async () => {
      if (document.visibilityState !== 'visible') return;
      if (!dataLoaded || isRefreshing || editMode || isRelocating) return;

      // Try ETag check before doing a full reload
      try {
        if ('caches' in window && floorplan) {
          const cacheStorage = await caches.open('api-cache');
          const matchUrl = new URL(`/api/floorplans/${floorplanId}`, BASE_URL).toString();
          const cachedResponse = await cacheStorage.match(matchUrl);
          const cachedEtag = cachedResponse?.headers?.get('ETag');
          if (cachedEtag) {
            const token = localStorage.getItem('token');
            const headers = { 'If-None-Match': cachedEtag };
            if (token) headers['Authorization'] = `Bearer ${token}`;
            const res = await fetch(matchUrl, { headers });
            if (res.status === 304) return; // Nothing changed — skip reload
          }
        }
      } catch { /* ignore, fall through to reload */ }

      loadMapData(false);
    };

    document.addEventListener('visibilitychange', handleVisibility);
    return () => {
      document.removeEventListener('visibilitychange', handleVisibility);
    };
  }, [dataLoaded, isRefreshing, editMode, isRelocating, loadMapData, floorplan, floorplanId]);

  // Deep Link Zoom Trigger
  const hasZoomedToTarget = useRef(null);
  const targetResultFromUrl = React.useMemo(() => {
    if (!highlightType || !highlightId || !dataLoaded) return null;
    if (highlightType === 'room') {
      const r = rooms.find(room => room.id === highlightId);
      if (r) return { ...r, type: 'room', floorplan_id: parseInt(floorplanId, 10) };
    } else if (highlightType === 'equipment') {
      const e = equipment.find(eq => eq.id === highlightId);
      if (e) return { ...e, type: 'equipment', floorplan_id: parseInt(floorplanId, 10) };
    } else if (highlightType === 'ticket') {
      const t = tickets.find(ticket => ticket.id === highlightId);
      if (t) return { ...t, type: 'ticket', floorplan_id: parseInt(floorplanId, 10) };
    } else if (highlightType === 'workOrder') {
      const wo = floorplanWorkOrders.find(w => w.id === highlightId);
      if (wo) return { ...wo, type: 'workOrder', floorplan_id: parseInt(floorplanId, 10) };
    }
    return null;
  }, [highlightType, highlightId, dataLoaded, rooms, equipment, tickets, floorplanWorkOrders, floorplanId]);

  const effectiveTargetResult = location.state?.targetResult || targetResultFromUrl;

  useEffect(() => {
    const isMapReady = floorplan && pdfLoaded;
    const targetKey = effectiveTargetResult ? `${effectiveTargetResult.type}-${effectiveTargetResult.id}` : null;

    if (isMapReady && dataLoaded && effectiveTargetResult && hasZoomedToTarget.current !== targetKey) {
      hasZoomedToTarget.current = targetKey;

      const isUnlocated = effectiveTargetResult.x_coordinate == null || effectiveTargetResult.y_coordinate == null;
      if (location.state?.isLocating || isUnlocated) {
        // Automatically enter placement/relocate mode for this unlocated item
        const itemType = effectiveTargetResult.type || 'room';
        const itemObj = (itemType === 'equipment' ? equipment.find(e => e.id === effectiveTargetResult.id) : rooms.find(r => r.id === effectiveTargetResult.id)) || effectiveTargetResult;
        setModeRelocate(itemType, itemObj);
        setSearchQuery('');
        setSearchResults([]);
      } else {
        setSearchQuery(effectiveTargetResult.name || effectiveTargetResult.title || '');
        setHighlightedPin({ type: effectiveTargetResult.type, id: effectiveTargetResult.id });
        setTimeout(() => {
          handleSearchResultClick(effectiveTargetResult);
        }, 500);
      }
    }
  }, [effectiveTargetResult, floorplan, pdfLoaded, dataLoaded, handleSearchResultClick, setSearchQuery, rooms, equipment, setModeRelocate, location.state]);

  // Handle adding equipment or rooms initiated from dashboard modals or external navigation
  const hasHandledInitiateAdd = useRef(null);

  useEffect(() => {
    const initiateAddType = location.state?.initiateAddType;
    if (initiateAddType && dataLoaded && hasHandledInitiateAdd.current !== `${floorplanId}-${initiateAddType}`) {
      hasHandledInitiateAdd.current = `${floorplanId}-${initiateAddType}`;
      const initialData = location.state?.initialData || {};

      if (initiateAddType === 'room') {
        setModeAddPlacement('room');
        if (initialData.name) {
          setNextRoomName(initialData.name);
        } else {
          let baseName = lastPlacedRoomName;
          if (!baseName) {
            if (rooms && rooms.length > 0) {
              const sorted = [...rooms].sort((a, b) => b.id - a.id);
              baseName = sorted[0].name;
            } else {
              baseName = 'Room 0';
            }
          }
          setNextRoomName(incrementRoomName(baseName));
        }
        setNextDescription(initialData.description || '');
        setIsRightDrawerOpen(true);
      } else if (initiateAddType === 'equipment') {
        setModeAddPlacement('equipment');
        setNextEquipName(initialData.name || '');
        setNextDescription(initialData.description || '');
        setNextToolsRequired(initialData.tools_required || '');
        if (initialData.color) {
          setEquipColor(initialData.color);
        }
        setIsRightDrawerOpen(true);
      } else if (initiateAddType === 'ticket') {
        setModeAddPlacement('ticket');
        setNextDescription(initialData.description || '');
        setIsRightDrawerOpen(true);
      }

      // Clear the initiateAddType from router state so refresh/back doesn't re-trigger it
      const nextState = { ...(location.state || {}) };
      delete nextState.initiateAddType;
      delete nextState.initialData;
      navigate(location.pathname + location.search, {
        replace: true,
        state: Object.keys(nextState).length > 0 ? nextState : undefined
      });
    }
  }, [location.state, dataLoaded, floorplanId, rooms, lastPlacedRoomName, setModeAddPlacement, navigate, location.pathname, location.search]);

  // Mapped Switch View position handling
  const targetViewPosition = location.state?.targetViewPosition;
  const hasAppliedViewPosition = useRef(null);

  useEffect(() => {
    const isMapReady = floorplan && floorplan.id.toString() === floorplanId && pdfLoaded;
    if (isMapReady && targetViewPosition && hasAppliedViewPosition.current !== floorplanId) {
      hasAppliedViewPosition.current = floorplanId;
      setTimeout(() => {
        if (transformComponentRef.current) {
          const { setTransform } = transformComponentRef.current;
          const scale = Math.min(Math.max(targetViewPosition.scale || 1, 0.5), 100);

          const viewportWidth = window.innerWidth;
          const viewportHeight = window.innerHeight;
          const centerX = viewportWidth / 2;
          const centerY = viewportHeight / 2;

          let finalX = -targetViewPosition.x * scale + centerX;
          let finalY = -targetViewPosition.y * scale + centerY;

          const mapWidth = 2000;
          const mapHeight = mapContentRef.current?.clientHeight || 1500;
          const minX = viewportWidth - (mapWidth * scale);
          const minY = viewportHeight - (mapHeight * scale);
          finalX = Math.max(minX, Math.min(0, finalX));
          finalY = Math.max(minY, Math.min(0, finalY));

          setTransform(finalX, finalY, scale, 0);

          if (mapContentRef.current) {
            mapContentRef.current.style.setProperty('--current-zoom', scale);
          }
        }
      }, 50);

      const nextState = { ...(location.state || {}) };
      delete nextState.targetViewPosition;
      navigate(location.pathname, { replace: true, state: Object.keys(nextState).length > 0 ? nextState : undefined });
    }
  }, [floorplan, pdfLoaded, targetViewPosition, floorplanId, navigate, location.pathname, location.state]);

  // Back history state restoration
  useEffect(() => {
    if (location.state?.restoreState && location.state?.mapState && pdfLoaded && dataLoaded) {
      const { mapState } = location.state;

      if (mapState.searchQuery) setSearchQuery(mapState.searchQuery);
      if (mapState.highlightedPin) setHighlightedPin(mapState.highlightedPin);
      if (mapState.editingRoom) {
        setModeEdit('room', mapState.editingRoom);
        setIsRightDrawerOpen(true);
      }
      if (mapState.editingEquipment) {
        setModeEdit('equipment', mapState.editingEquipment);
        setIsRightDrawerOpen(true);
      }

      if (transformComponentRef.current && mapState.scale !== undefined) {
        const { setTransform } = transformComponentRef.current;
        setTimeout(() => {
          setTransform(mapState.x, mapState.y, mapState.scale, 0);
          if (mapContentRef.current) {
            mapContentRef.current.style.setProperty('--current-zoom', mapState.scale);
          }
        }, 100);
      }

      const nextState = { ...(location.state || {}) };
      delete nextState.restoreState;
      navigate(location.pathname + location.search, { replace: true, state: Object.keys(nextState).length > 0 ? nextState : undefined });
    }
  }, [location.state, pdfLoaded, dataLoaded, navigate, setSearchQuery, setModeEdit, location.pathname, location.search]);

  // Deep link routing or switcher floor navigation
  const handleFloorplanSwitch = (targetFp) => {
    floorplanLogger.startSwitch(targetFp.id, targetFp.name, 'Left Drawer Floorplan Switcher');
    setSwitchingToFloorplan(targetFp);
    setPdfLoaded(false);
    if (isRelocating) {
      const itemName = editingRoom ? `room "${editingRoom.name}"` : `equipment "${editingEquipment?.name}"`;
      if (!window.confirm(`You are currently relocating ${itemName}. Do you want to move it to ${targetFp.name}?`)) {
        return;
      }
    }

    const currentRefPoints = floorplan?.reference_points || [];
    const targetRefPoints = targetFp.reference_points || [];
    const canAlign = currentRefPoints.length === 2 && targetRefPoints.length === 2;

    if (canAlign && transformComponentRef.current) {
      const { state } = transformComponentRef.current;
      const currentScale = state.scale;
      const currentX = state.positionX;
      const currentY = state.positionY;

      const viewportWidth = window.innerWidth;
      const viewportHeight = window.innerHeight;
      const centerSrcX = (viewportWidth / 2 - currentX) / currentScale;
      const centerSrcY = (viewportHeight / 2 - currentY) / currentScale;

      const transform = computeTransform(currentRefPoints, targetRefPoints);
      if (transform) {
        const mapped = applyTransform(transform, centerSrcX, centerSrcY);

        navigate(`/map/${targetFp.id}`, {
          state: {
            ...location.state,
            preloadedFloorplan: targetFp,
            targetViewPosition: {
              x: mapped.x,
              y: mapped.y,
              scale: currentScale / transform.scale
            },
            isRelocating,
            editingRoom,
            editingEquipment
          }
        });
        setIsLeftDrawerOpen(false);
        setSearchQuery('');
        setSearchResults([]);
        setHighlightedPin(null);
        return;
      }
    }

    navigate(`/map/${targetFp.id}`, {
      state: {
        ...location.state,
        preloadedFloorplan: targetFp,
        isRelocating,
        editingRoom,
        editingEquipment
      }
    });
    setIsLeftDrawerOpen(false);
    setSearchQuery('');
    setSearchResults([]);
    setHighlightedPin(null);
  };

  // Click on canvas handler
  const handleMapClick = async (e) => {
    if (calibrationMode) return;

    if (isMobile && showSearchResultsList) {
      setShowSearchResultsList(false);
      if (searchInputRef.current) searchInputRef.current.blur();
    }

    if (isRelocating && (editingEquipment || editingRoom || editingTicket)) {
      const rect = e.currentTarget.getBoundingClientRect();
      const scale = transformComponentRef.current?.state?.scale || 1;
      const x = (e.clientX - rect.left) / scale;
      const y = (e.clientY - rect.top) / scale;

      const targetFpId = parseInt(floorplanId, 10);
      const activeItem = editingEquipment || editingRoom || editingTicket;
      const itemType = editingEquipment ? 'equipment' : editingRoom ? 'room' : 'ticket';

      // 1. Optimistic Local State & Cache Update (0ms instant visual pin move)
      if (itemType === 'equipment') {
        const optimistic = { ...activeItem, x_coordinate: x, y_coordinate: y, floorplan_id: targetFpId };
        setEquipment(prev => {
          const exists = prev.find(eq => eq.id === activeItem.id);
          if (exists) return prev.map(eq => eq.id === activeItem.id ? optimistic : eq);
          return [...prev, optimistic];
        });
        updateCachedFloorplanItem(floorplanId, 'equipment', 'update', optimistic, floorplan?.site_id);
      } else if (itemType === 'room') {
        const optimistic = { ...activeItem, x_coordinate: x, y_coordinate: y, floorplan_id: targetFpId };
        setRooms(prev => {
          const exists = prev.find(r => r.id === activeItem.id);
          if (exists) return prev.map(r => r.id === activeItem.id ? optimistic : r);
          return [...prev, optimistic];
        });
        updateCachedFloorplanItem(floorplanId, 'room', 'update', optimistic, floorplan?.site_id);
      } else if (itemType === 'ticket') {
        const optimistic = { ...activeItem, x_coordinate: x, y_coordinate: y };
        setTickets(prev => {
          const exists = prev.find(t => t.id === activeItem.id);
          if (exists) return prev.map(t => t.id === activeItem.id ? optimistic : t);
          return [...prev, optimistic];
        });
        updateCachedFloorplanItem(floorplanId, 'ticket', 'update', optimistic, floorplan?.site_id);
      }

      // 2. Dismiss relocation banner and drawer immediately
      setModeView();
      setIsRightDrawerOpen(false);
      setIsPendingSync(true);

      // 3. Perform background server sync
      (async () => {
        try {
          if (itemType === 'equipment') {
            const formData = new FormData();
            formData.append('x_coordinate', x);
            formData.append('y_coordinate', y);
            formData.append('floorplan_id', floorplanId);
            const res = await updateEquipment(activeItem.id, formData);
            setEquipment(prev => prev.map(eq => eq.id === res.data.id ? res.data : eq));
            updateCachedFloorplanItem(floorplanId, 'equipment', 'update', res.data, floorplan?.site_id);
          } else if (itemType === 'room') {
            const res = await updateRoom(activeItem.id, {
              name: activeItem.name,
              description: activeItem.description,
              x_coordinate: x,
              y_coordinate: y,
              floorplan_id: targetFpId
            });
            setRooms(prev => prev.map(r => r.id === res.data.id ? res.data : r));
            updateCachedFloorplanItem(floorplanId, 'room', 'update', res.data, floorplan?.site_id);
          } else if (itemType === 'ticket') {
            const res = await updateTicket(activeItem.id, {
              x_coordinate: x,
              y_coordinate: y
            });
            setTickets(prev => prev.map(t => t.id === res.data.id ? res.data : t));
            updateCachedFloorplanItem(floorplanId, 'ticket', 'update', res.data, floorplan?.site_id);
          }
        } catch (err) {
          console.error("Failed to sync relocated pin to server:", err);
          alert("Failed to save new location to server: " + getErrorMessage(err));
        } finally {
          setIsPendingSync(false);
        }
      })();

      return;
    }

    if (!editMode) return;

    const rect = e.currentTarget.getBoundingClientRect();
    const scale = transformComponentRef.current?.state?.scale || 1;
    const x = (e.clientX - rect.left) / scale;
    const y = (e.clientY - rect.top) / scale;

    if (activeActionType === 'multi-floor-ref') {
      const newPin = {
        floorplanId: parseInt(floorplanId, 10),
        floorplanName: floorplan?.name || `Floorplan #${floorplanId}`,
        x,
        y,
        createdAt: Date.now()
      };
      setMultiFloorRefPin(newPin);
      localStorage.setItem('multiFloorRefPin', JSON.stringify(newPin));
      setModeView();
      setIsRightDrawerOpen(false);
      return;
    }

    if (activeActionType === 'room' || activeActionType === 'equipment' || activeActionType === 'ticket') {
      const isRoom = activeActionType === 'room';
      const isEquip = activeActionType === 'equipment';
      const isTicket = activeActionType === 'ticket';

      if ((isRoom || isEquip) && !isEditor) return;
      if (isTicket && !user) return;

      if (isRoom) {
        const currentName = nextRoomName || 'Room 1';
        const incrementedName = incrementRoomName(currentName);
        setNextRoomName(incrementedName);
        setLastPlacedRoomName(incrementedName);

        const tempId = `temp-${Date.now()}`;
        setPendingRooms(prev => [...prev, { id: tempId, name: currentName, x_coordinate: x, y_coordinate: y }]);

        try {
          const res = await createRoom({
            floorplan_id: parseInt(floorplanId, 10),
            name: currentName,
            description: nextDescription,
            x_coordinate: x,
            y_coordinate: y
          });
          setNextDescription('');
          setPendingRooms(prev => prev.filter(r => r.id !== tempId));
          setRooms(prev => {
            const updated = [...prev, res.data];
            const sorted = [...updated].sort((a, b) => b.id - a.id);
            setLastPlacedRoomName(sorted[0].name);
            return updated;
          });
          updateCachedFloorplanItem(floorplanId, 'room', 'add', res.data, floorplan?.site_id);
        } catch (error) {
          setPendingRooms(prev => prev.filter(r => r.id !== tempId));
          setNextRoomName(currentName);
          setLastPlacedRoomName(currentName);
          setFormError(getErrorMessage(error, "Failed to create room."));
          setModeAddForm('room', { x, y });
          setIsRightDrawerOpen(true);
        }
      } else if (isEquip) {
        if (!nextEquipName) {
          setFormError("Please enter a name for the equipment.");
          setIsNameError(true);
          setIsRightDrawerOpen(true);
          setTimeout(() => setIsNameError(false), 500);
          return;
        }

        const currentName = nextEquipName;
        const currentDesc = nextDescription;
        const currentTools = nextToolsRequired;
        setNextEquipName('');
        setNextDescription('');
        setNextToolsRequired('');

        const formData = new FormData();
        formData.append('floorplan_id', floorplanId);
        formData.append('name', currentName);
        formData.append('description', currentDesc);
        formData.append('tools_required', currentTools);
        formData.append('x_coordinate', x);
        formData.append('y_coordinate', y);
        formData.append('color', equipColor);

        try {
          const res = await createEquipment(formData);
          setEquipment(prev => [...prev, res.data]);
          setIsRightDrawerOpen(false);
          setModeView();
          updateCachedFloorplanItem(floorplanId, 'equipment', 'add', res.data, floorplan?.site_id);
        } catch (error) {
          setFormError(getErrorMessage(error, "Failed to create equipment."));
          setModeAddForm('equipment', { x, y });
          setIsRightDrawerOpen(true);
        }
      } else if (isTicket) {
        setModeAddForm('ticket', { x, y });
        setIsRightDrawerOpen(true);
      }
    }
  };

  // Add Room Form Handler (Explicit Submit)
  const handleAddRoomSubmit = async (formData) => {
    if (!isEditor) return;
    try {
      const res = await createRoom({
        floorplan_id: parseInt(floorplanId, 10),
        name: formData.name,
        description: formData.description,
        x_coordinate: newPinCoord.x,
        y_coordinate: newPinCoord.y
      });
      setRooms(prev => {
        const updated = [...prev, res.data];
        const sorted = [...updated].sort((a, b) => b.id - a.id);
        setLastPlacedRoomName(sorted[0].name);
        return updated;
      });
      updateCachedFloorplanItem(floorplanId, 'room', 'add', res.data, floorplan?.site_id);
      setModeView();
      setFormError('');
      setIsRightDrawerOpen(false);
    } catch (error) {
      setFormError(getErrorMessage(error, "Failed to create room."));
    }
  };

  // Add Equipment Form Handler (Explicit Submit)
  const handleAddEquipmentSubmit = async (formData) => {
    if (!isEditor) return;
    const payload = new FormData();
    payload.append('floorplan_id', floorplanId);
    payload.append('name', formData.name);
    payload.append('description', formData.description);
    payload.append('tools_required', formData.tools_required);
    payload.append('x_coordinate', newPinCoord.x);
    payload.append('y_coordinate', newPinCoord.y);
    payload.append('color', formData.color);

    try {
      const res = await createEquipment(payload);
      setEquipment(prev => [...prev, res.data]);
      localStorage.setItem('defaultEquipColor', formData.color);
      updateCachedFloorplanItem(floorplanId, 'equipment', 'add', res.data, floorplan?.site_id);
      setModeView();
      setFormError('');
      setIsRightDrawerOpen(false);
    } catch (error) {
      setFormError(getErrorMessage(error, "Failed to create equipment."));
    }
  };

  // Update Room Form Handler (Explicit Submit)
  const handleUpdateRoomSubmit = async (formData) => {
    if (!isEditor) return;
    try {
      const res = await updateRoom(editingRoom.id, {
        name: formData.name,
        description: formData.description,
        x_coordinate: editingRoom.x_coordinate,
        y_coordinate: editingRoom.y_coordinate
      });
      setRooms(prev => prev.map(r => r.id === res.data.id ? res.data : r));
      updateCachedFloorplanItem(floorplanId, 'room', 'update', res.data, floorplan?.site_id);
      setModeView();
      setFormError('');
      setIsRightDrawerOpen(false);
    } catch (error) {
      setFormError(getErrorMessage(error, "Failed to update room."));
    }
  };

  // Update Equipment Form Handler (Explicit Submit)
  const handleUpdateEquipmentSubmit = async (formData) => {
    if (!isEditor) return;
    const payload = new FormData();
    payload.append('name', formData.name);
    payload.append('description', formData.description);
    payload.append('tools_required', formData.tools_required);
    payload.append('color', formData.color);

    try {
      const res = await updateEquipment(editingEquipment.id, payload);
      setEquipment(prev => prev.map(eq => eq.id === res.data.id ? res.data : eq));
      updateCachedFloorplanItem(floorplanId, 'equipment', 'update', res.data, floorplan?.site_id);
      setModeView();
      setFormError('');
      setIsRightDrawerOpen(false);
    } catch (error) {
      setFormError(getErrorMessage(error, "Failed to update equipment."));
    }
  };

  // Delete Room Action
  const handleDeleteRoomAction = async () => {
    if (!isEditor) return;
    if (window.confirm(`Are you sure you want to delete room "${editingRoom.name}"?`)) {
      try {
        await deleteRoom(editingRoom.id);
        setRooms(prev => prev.filter(r => r.id !== editingRoom.id));
        updateCachedFloorplanItem(floorplanId, 'room', 'delete', editingRoom.id, floorplan?.site_id);
        setModeView();
        setIsRightDrawerOpen(false);
      } catch (err) {
        console.error(err);
      }
    }
  };

  // Delete Equipment Action
  const handleDeleteEquipmentAction = async () => {
    if (!isEditor) return;
    if (window.confirm(`Are you sure you want to delete equipment "${editingEquipment.name}"?`)) {
      try {
        await deleteEquipment(editingEquipment.id);
        setEquipment(prev => prev.filter(eq => eq.id !== editingEquipment.id));
        updateCachedFloorplanItem(floorplanId, 'equipment', 'delete', editingEquipment.id, floorplan?.site_id);
        setModeView();
        setIsRightDrawerOpen(false);
      } catch (err) {
        console.error(err);
      }
    }
  };

  // Add Ticket Form Handler
  const handleAddTicketSubmit = async (formData) => {
    if (!user) return;
    try {
      const res = await createTicket({
        floorplan_id: parseInt(floorplanId, 10),
        ...formData
      });
      setTickets(prev => [...prev, res.data]);
      updateCachedFloorplanItem(floorplanId, 'ticket', 'add', res.data, floorplan?.site_id);
      setModeView();
      setFormError('');
      setIsRightDrawerOpen(false);
    } catch (error) {
      setFormError(getErrorMessage(error, "Failed to create ticket."));
    }
  };

  // Update Ticket Form Handler
  const handleUpdateTicketSubmit = async (id, formData) => {
    if (!user) return;
    try {
      const res = await updateTicket(id, formData);
      setTickets(prev => prev.map(t => t.id === res.data.id ? res.data : t));
      updateCachedFloorplanItem(floorplanId, 'ticket', 'update', res.data, floorplan?.site_id);
      setModeView();
      setFormError('');
      setIsRightDrawerOpen(false);
    } catch (error) {
      setFormError(getErrorMessage(error, "Failed to update ticket."));
    }
  };

  // Delete Ticket Action
  const handleDeleteTicketAction = async (id) => {
    if (!user) return;
    const ticket = tickets.find(t => t.id === id);
    if (window.confirm(`Are you sure you want to delete ticket "${ticket?.title || 'this issue'}"?`)) {
      try {
        await deleteTicket(id);
        setTickets(prev => prev.filter(t => t.id !== id));
        updateCachedFloorplanItem(floorplanId, 'ticket', 'delete', id, floorplan?.site_id);
        setModeView();
        setIsRightDrawerOpen(false);
      } catch (err) {
        console.error(err);
      }
    }
  };

  // Filter Pins for layout matching
  const isSearching = searchResults.length > 0;
  const isHighlighting = highlightType && highlightId;

  const filteredRooms = useMemo(() => {
    if (isHighlighting) {
      return rooms.filter(r => r.id === highlightId && highlightType === 'room');
    }
    if (isSearching) {
      return rooms.filter(r => searchResults.some(res => res.type === 'room' && res.id === r.id && res.floorplan_id === parseInt(floorplanId, 10)));
    }
    return rooms;
  }, [isHighlighting, highlightId, highlightType, isSearching, searchResults, rooms, floorplanId]);

  const filteredEquipment = useMemo(() => {
    if (isHighlighting) {
      return equipment.filter(e => e.id === highlightId && highlightType === 'equipment');
    }
    if (isSearching) {
      return equipment.filter(e => searchResults.some(res => res.type === 'equipment' && res.id === e.id && res.floorplan_id === parseInt(floorplanId, 10)));
    }
    return equipment;
  }, [isHighlighting, highlightId, highlightType, isSearching, searchResults, equipment, floorplanId]);

  const dispersedEquipment = useMemo(() => {
    return dispersePins(filteredEquipment);
  }, [filteredEquipment]);

  const handleOpenLeftMenu = useCallback(() => setIsLeftDrawerOpen(true), []);
  const handleOpenRightMenu = useCallback(() => setIsRightDrawerOpen(true), []);
  const handleCloseLeftDrawer = useCallback(() => setIsLeftDrawerOpen(false), []);
  const handleCloseRightDrawer = useCallback(() => setIsRightDrawerOpen(false), []);

  const handlePinRoomClick = useCallback((room) => {
    if (isMobile && showSearchResultsList) {
      setShowSearchResultsList(false);
      if (searchInputRef.current) searchInputRef.current.blur();
    }
    if (!isRelocating && !editMode) {
      setModeEdit('room', room);
      setFormError('');
      setIsRightDrawerOpen(true);
    }
  }, [isMobile, showSearchResultsList, isRelocating, editMode, setModeEdit]);

  const handlePinEquipClick = useCallback((eq) => {
    if (isMobile && showSearchResultsList) {
      setShowSearchResultsList(false);
      if (searchInputRef.current) searchInputRef.current.blur();
    }
    if (!isRelocating && !editMode) {
      setModeEdit('equipment', eq);
      setFormError('');
      setEquipColor(eq.color || localStorage.getItem('defaultEquipColor') || COLORS[0]);
      setIsRightDrawerOpen(true);
    }
  }, [isMobile, showSearchResultsList, isRelocating, editMode, setModeEdit]);

  const handlePinTicketClick = useCallback((ticket) => {
    if (isMobile && showSearchResultsList) {
      setShowSearchResultsList(false);
      if (searchInputRef.current) searchInputRef.current.blur();
    }
    if (!isRelocating && !editMode) {
      setModeEdit('ticket', ticket);
      setFormError('');
      setIsRightDrawerOpen(true);
    }
  }, [isMobile, showSearchResultsList, isRelocating, editMode, setModeEdit]);

  const isMapReady = Boolean(dataLoaded && pdfLoaded && floorplan && floorplan.id.toString() === floorplanId && (!switchingToFloorplan || switchingToFloorplan.id.toString() === floorplanId));

  useEffect(() => {
    if (isMapReady && switchingToFloorplan) {
      setSwitchingToFloorplan(null);
    }
  }, [isMapReady, switchingToFloorplan]);

  const isMapLoading = !isMapReady;
  const currentLoadingName = switchingToFloorplan?.name || floorplan?.name;
  const currentLoadingType = switchingToFloorplan?.file_type || floorplan?.file_type;

  return (
    <div className="map-container" style={{ '--pin-size': '12px' }}>
      {/* Top Floating Control Header */}
      <MapHeader
        onOpenLeftMenu={handleOpenLeftMenu}
        onOpenRightMenu={handleOpenRightMenu}
        searchQuery={searchQuery}
        setSearchQuery={setSearchQuery}
        searchResults={searchResults}
        setSearchResults={setSearchResults}
        showSearchResultsList={showSearchResultsList}
        setShowSearchResultsList={setShowSearchResultsList}
        skipNextSearchRef={skipNextSearchRef}
        searchInputRef={searchInputRef}
        handleSearchResultClick={handleSearchResultClick}
        floorplanId={floorplanId}
        siteFloorplans={siteFloorplans}
        rooms={rooms}
        equipment={equipment}
        user={user}
        isEditor={isEditor}
        activeActionType={activeActionType}
        onResetActions={setModeView}
        setSearchParams={setSearchParams}
        setHighlightedPin={setHighlightedPin}
      />

      {/* Syncing location toast indicator */}
      {isPendingSync && (
        <div className="sync-toast items-center gap-xs">
          <Loader2 className="spinning" size={15} color="#60a5fa" />
          <span>Syncing location...</span>
        </div>
      )}

      {/* Uncalibrated Floor Warning Banner (when multi-floor pin is active) */}
      {uncalibratedWarning && (
        <div className="floating-uncalibrated-toast items-center gap-sm">
          <AlertTriangle size={18} color="#f59e0b" />
          <span className="flex-1">{uncalibratedWarning}</span>
          <button
            className="btn-icon-xs uncalibrated-toast-close"
            onClick={() => setUncalibratedWarning(null)}
            title="Dismiss warning"
          >
            <X size={14} />
          </button>
        </div>
      )}

      {/* Point Names Toggle Button */}
      <button
        className={`trigger-btn point-names-btn ${showPointNames ? 'active' : ''}`}
        onClick={() => setShowPointNames(!showPointNames)}
        title={showPointNames ? "Hide Point Names" : "Show Point Names"}
      >
        {showPointNames ? <Eye size={20} /> : <EyeOff size={20} />}
      </button>

      {/* Main Map Content Loader overlay */}
      {isMapLoading && (
        <div className="map-loading-overlay flex-column items-center gap-md">
          <Loader2 className="spinning" size={42} color="var(--primary-color)" />
          <p className="font-semibold text-xl text-white">
            {currentLoadingName ? `Loading ${currentLoadingName}...` : 'Loading Floorplan...'}
          </p>
          <span className="text-sm text-slate-400">
            {currentLoadingType === 'pdf' ? 'Rendering blueprint canvas...' : 'Loading map data & pins...'}
          </span>
        </div>
      )}

      {/* Placement Notice Banner */}
      {editMode && !newPinCoord && !isRightDrawerOpen && (
        <div className="placement-banner">
          <MapPin size={18} className="pin-pulse" />
          <span>
            {activeActionType === 'multi-floor-ref'
              ? 'Click anywhere on map to place Multi-Floor Reference Pin'
              : `Click on map to place ${activeActionType}`}
          </span>
          <button
            className="btn btn-secondary btn-xs ml-md text-sm"
            onClick={setModeView}
          >
            {activeActionType === 'room' ? 'Done' : 'Cancel'}
          </button>
        </div>
      )}

      {/* Relocate / Place Notice Banner */}
      {isRelocating && (
        <div
          className="placement-banner"
          style={{
            background: editingRoom && editingRoom.x_coordinate == null ? 'rgba(245, 158, 11, 0.95)' : 'rgba(16, 185, 129, 0.95)',
            color: editingRoom && editingRoom.x_coordinate == null ? '#0f172a' : '#fff'
          }}
        >
          <MapPin size={18} className="pin-pulse" />
          <span className="font-semibold">
            {editingRoom && editingRoom.x_coordinate == null
              ? `Click on map to place room "${editingRoom.name}"${editingRoom.description ? ` (${editingRoom.description})` : ''}...`
              : `Click anywhere on the map to relocate ${editingRoom ? `room "${editingRoom.name}"` : 'equipment'}...`}
          </span>
          <button
            className="btn btn-secondary btn-xs ml-md text-sm"
            style={{
              background: editingRoom && editingRoom.x_coordinate == null ? 'rgba(0, 0, 0, 0.2)' : 'rgba(255, 255, 255, 0.15)',
              color: editingRoom && editingRoom.x_coordinate == null ? '#0f172a' : '#fff',
              border: 'none'
            }}
            onClick={setModeView}
          >
            Cancel
          </button>
        </div>
      )}

      {/* Visual Calibration Control Panel */}
      {calibrationMode && (
        <div className="placement-banner calibration-banner flex-column items-start gap-xs w-90 max-w-800" style={{ bottom: '1rem' }}>
          <div className="items-center w-full gap-md">
            <div className="items-center gap-sm font-bold">
              <MapPin size={18} />
              <span>Visual Alignment</span>
            </div>

            <div className="items-center gap-sm" style={{ marginLeft: 'auto' }}>
              <button className="btn" style={{ background: '#0f172a', color: '#f59e0b', padding: '0.2rem 0.75rem' }} onClick={handleSaveCalibration}>
                Save Alignment
              </button>
              <button className="btn btn-secondary btn-xs" style={{ padding: '0.2rem 0.75rem' }} onClick={handleExitCalibration}>
                Cancel
              </button>
            </div>
          </div>

          <div className="flex-row flex-wrap gap-md w-full items-center bg-subtle p-sm rounded-lg" style={{ background: 'rgba(0,0,0,0.2)' }}>
            <div className="items-center gap-sm">
              <label className="text-xs font-semibold">Base Floorplan:</label>
              <select className="input-field btn-xs" value={baseFloorplanId} onChange={handleBaseFloorplanChange} style={{ width: '150px' }}>
                {siteFloorplans.map(fp => (
                  <option key={fp.id} value={fp.id} disabled={fp.id === parseInt(floorplanId, 10)}>{fp.name} {fp.id === parseInt(floorplanId, 10) ? '(Current)' : ''}</option>
                ))}
              </select>
            </div>

            <div className="items-center gap-sm">
              <label className="text-xs font-semibold">Opacity:</label>
              <input type="range" min="0.1" max="1" step="0.1" value={overlayOpacity} onChange={e => setOverlayOpacity(parseFloat(e.target.value))} style={{ width: '80px' }} />
            </div>

            <div className="items-center gap-sm">
              <label className="text-xs font-semibold">Scale:</label>
              <input type="number" step="0.01" value={overlayTransform.scale} onChange={e => setOverlayTransform(prev => ({ ...prev, scale: parseFloat(e.target.value) || 1 }))} className="input-field btn-xs" style={{ width: '80px' }} />
            </div>

            <div className="items-center gap-sm">
              <label className="text-xs font-semibold">Rot (°):</label>
              <input type="number" step="0.5" value={overlayTransform.rotation} onChange={e => setOverlayTransform(prev => ({ ...prev, rotation: parseFloat(e.target.value) || 0 }))} className="input-field btn-xs" style={{ width: '70px' }} />
            </div>

            <div className="text-xs font-bold" style={{ color: 'rgba(15,23,42,0.6)', marginLeft: 'auto' }}>
              Drag the overlay to adjust offset
            </div>
          </div>
        </div>
      )}

      {/* Left Drawer (Navigation, switcher list) */}
      <LeftDrawer
        isOpen={isLeftDrawerOpen}
        onClose={handleCloseLeftDrawer}
        floorplan={floorplan}
        floorplanId={floorplanId}
        siteFloorplans={siteFloorplans}
        onFloorplanSwitch={handleFloorplanSwitch}
        switchingToFloorplanId={switchingToFloorplan?.id}
        isEditor={isEditor}
        onEnterCalibration={handleEnterCalibration}
        user={user}
        logout={logout}
        isAdmin={isAdmin}
        navigate={navigate}
        location={location}
      />

      {/* Right Drawer (Forms and action buttons) */}
      <RightDrawer
        isOpen={isRightDrawerOpen}
        onClose={handleCloseRightDrawer}
        mapMode={mapMode}
        isMobile={isMobile}
        isEditor={isEditor}
        user={user}
        multiFloorRefPin={multiFloorRefPin}
        onRemoveMultiFloorRefPin={handleRemoveMultiFloorRefPin}
        rooms={rooms}
        lastPlacedRoomName={lastPlacedRoomName}
        nextRoomName={nextRoomName}
        setNextRoomName={setNextRoomName}
        nextEquipName={nextEquipName}
        setNextEquipName={setNextEquipName}
        nextDescription={nextDescription}
        setNextDescription={setNextDescription}
        nextToolsRequired={nextToolsRequired}
        setNextToolsRequired={setNextToolsRequired}
        isNameError={isNameError}
        setIsNameError={setIsNameError}
        equipColor={equipColor}
        setEquipColor={setEquipColor}
        formError={formError}
        setFormError={setFormError}
        onStartPlacement={setModeAddPlacement}
        onReposition={() => setModeAddPlacement(activeActionType)}
        onCancel={setModeView}
        onRelocate={() => {
          const type = editingRoom ? 'room' : editingEquipment ? 'equipment' : 'ticket';
          setModeRelocate(type, editingRoom || editingEquipment || editingTicket);
        }}
        onAddRoom={handleAddRoomSubmit}
        onAddEquipment={handleAddEquipmentSubmit}
        onAddTicket={handleAddTicketSubmit}
        onOpenCreateWorkOrder={() => setIsCreateWorkOrderOpen(true)}
        onUpdateRoom={handleUpdateRoomSubmit}
        onUpdateEquipment={handleUpdateEquipmentSubmit}
        onUpdateTicket={handleUpdateTicketSubmit}
        onDeleteRoom={handleDeleteRoomAction}
        onDeleteEquipment={handleDeleteEquipmentAction}
        onDeleteTicket={handleDeleteTicketAction}
        navigate={navigate}
        location={location}
      />

      {/* Map Interactive Canvas */}
      <MapCanvas
        transformComponentRef={transformComponentRef}
        mapContentRef={mapContentRef}
        mapMode={mapMode}
        calibrationMode={calibrationMode}
        floorplan={floorplan}
        baseFloorplanId={baseFloorplanId}
        siteFloorplans={siteFloorplans}
        overlayOpacity={overlayOpacity}
        overlayTransform={overlayTransform}
        setOverlayTransform={setOverlayTransform}
        isDraggingOverlay={isDraggingOverlay}
        setIsDraggingOverlay={setIsDraggingOverlay}
        overlayDragRef={overlayDragRef}
        setPdfLoaded={setPdfLoaded}
        filteredRooms={filteredRooms}
        allRooms={rooms}
        pendingRooms={pendingRooms}
        dispersedEquipment={dispersedEquipment}
        allEquipment={equipment}
        tickets={tickets}
        workOrders={floorplanWorkOrders}
        multiFloorRefPin={activeMultiFloorRefPin}
        highlightedPin={highlightedPin}
        equipColor={equipColor}
        showPointNames={showPointNames}
        handleMapClick={handleMapClick}
        onPinRoomClick={handlePinRoomClick}
        onPinEquipClick={handlePinEquipClick}
        onPinTicketClick={handlePinTicketClick}
        onPinWorkOrderClick={handlePinWorkOrderClick}
        onPinMultiFloorRefClick={handlePinMultiFloorRefClick}
      />

      {/* Work Order Detail Modal */}
      {selectedWorkOrder && (
        <WorkOrderDetailModal
          isOpen={Boolean(selectedWorkOrder)}
          workOrder={selectedWorkOrder}
          onClose={() => setSelectedWorkOrder(null)}
          onUpdated={handleWorkOrderUpdated}
          currentUser={user}
        />
      )}

      {/* Work Order Create Modal */}
      {isCreateWorkOrderOpen && (
        <WorkOrderCreateModal
          isOpen={isCreateWorkOrderOpen}
          onClose={() => setIsCreateWorkOrderOpen(false)}
          onCreated={handleWorkOrderCreated}
          initialSiteId={floorplan?.site_id}
          initialFloorplanId={floorplan?.id}
          currentUser={user}
        />
      )}
    </div>
  );
}
