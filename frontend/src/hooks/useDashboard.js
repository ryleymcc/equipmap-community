/* eslint-disable react-hooks/set-state-in-effect */
import { useState, useEffect, useMemo, useRef } from 'react';
import { useNavigate, useLocation, useSearchParams } from 'react-router-dom';
import { useAuth } from '../AuthContext';
import {
  getSites, createSite, updateSite, deleteSite, getFloorplans, uploadFloorplan, deleteFloorplan,
  getAllEquipment, getAllRooms, getAllTickets, updateEquipment, updateRoom, deleteEquipment, deleteRoom, deleteTicket,
  updateFloorplan, updateFloorplansSortOrder, bulkUpdateEquipment, getWorkOrders, getErrorMessage, LOW_PRIORITY_CONFIG
} from '../api';
import { searchClientEntities } from '../searchEngine';
import {
  getCachedDashboardData,
  setCachedDashboardData,
  updateCachedFloorplanItem,
  updateCachedSite,
  populateFloorplansIntoApiCache
} from '../cacheUtils';
import { floorplanLogger } from '../floorplanLogger';
import { isWorkOrderOverdue } from '../utils/workOrderDueDate';
import { getWorkOrderSource } from '../utils/workOrderSource';

const sharedCollator = new Intl.Collator(undefined, { numeric: true, sensitivity: 'base' });

export function useDashboard() {
  const navigate = useNavigate();
  const location = useLocation();
  const auth = useAuth();
  const { user, logout, isAdmin, loading: isAuthLoading } = auth;
  const isEditor = auth.isEditor;
  const [searchParams, setSearchParams] = useSearchParams();

  const [sites, setSites] = useState(() => getCachedDashboardData('sites') || []);
  const [activeSite, setActiveSite] = useState(() => {
    const cachedSites = getCachedDashboardData('sites') || [];
    const siteIdParam = searchParams.get('siteId') || (typeof window !== 'undefined' ? localStorage.getItem('lastActiveSiteId') : null);
    if (siteIdParam && cachedSites.length > 0) {
      const found = cachedSites.find(s => s.id === parseInt(siteIdParam, 10));
      if (found) return found;
    }
    return cachedSites.length > 0 ? cachedSites[0] : null;
  });

  const [floorplans, setFloorplans] = useState(() => {
    const siteIdParam = searchParams.get('siteId') || (typeof window !== 'undefined' ? localStorage.getItem('lastActiveSiteId') : null);
    if (siteIdParam) {
      const cached = getCachedDashboardData(`floorplans_${siteIdParam}`);
      if (cached && cached.length > 0) return cached;
    }
    const cachedSites = getCachedDashboardData('sites') || [];
    if (cachedSites.length > 0) {
      const cached = getCachedDashboardData(`floorplans_${cachedSites[0].id}`);
      if (cached && cached.length > 0) return cached;
    }
    return [];
  });

  const [allEquipment, setAllEquipment] = useState(() => getCachedDashboardData('equipment') || []);
  const [allRooms, setAllRooms] = useState(() => getCachedDashboardData('rooms') || []);
  const [allTickets, setAllTickets] = useState(() => getCachedDashboardData('tickets') || []);
  const [allWorkOrders, setAllWorkOrders] = useState([]);
  const [workOrderSummary, setWorkOrderSummary] = useState(null);

  // Loading and background syncing states
  const [isLoadingSites, setIsLoadingSites] = useState(() => (getCachedDashboardData('sites') || []).length === 0);
  const [isLoadingFloorplans, setIsLoadingFloorplans] = useState(() => {
    const siteId = searchParams.get('siteId') || (typeof window !== 'undefined' ? localStorage.getItem('lastActiveSiteId') : null);
    const cached = siteId ? getCachedDashboardData(`floorplans_${siteId}`) : null;
    return !cached || cached.length === 0;
  });
  const [isLoadingEquipment, setIsLoadingEquipment] = useState(() => (getCachedDashboardData('equipment') || []).length === 0);
  const [isLoadingRooms, setIsLoadingRooms] = useState(() => (getCachedDashboardData('rooms') || []).length === 0);
  const [isLoadingWorkOrders, setIsLoadingWorkOrders] = useState(() => (
    location.pathname === '/work-orders' ||
    (location.pathname === '/' && typeof window !== 'undefined' && Boolean(localStorage.getItem('token')))
  ));

  const [isBackgroundSyncingFloorplans, setIsBackgroundSyncingFloorplans] = useState(false);
  const [isBackgroundSyncingEquipment, setIsBackgroundSyncingEquipment] = useState(false);
  const [isBackgroundSyncingRooms, setIsBackgroundSyncingRooms] = useState(false);
  const [isBackgroundSyncing, setIsBackgroundSyncing] = useState(false);
  const [workOrderError, setWorkOrderError] = useState(null);

  // Selection state
  const [selectedEquipIds, setSelectedEquipIds] = useState([]);
  const [isBulkEditModalOpen, setIsBulkEditModalOpen] = useState(false);
  const [bulkEditForm, setBulkEditForm] = useState({
    description: '',
    color: '',
    tools_required: '',
    // Track which fields are being overridden
    descriptionOverridden: false,
    colorOverridden: false,
    tools_requiredOverridden: false
  });

  // Modals state
  const [isSiteModalOpen, setIsSiteModalOpen] = useState(false);
  const [isRenameSiteModalOpen, setIsRenameSiteModalOpen] = useState(false);
  const [siteToRename, setSiteToRename] = useState(null);
  const [isSiteDropdownOpen, setIsSiteDropdownOpen] = useState(false);
  const [isUploadModalOpen, setIsUploadModalOpen] = useState(false);
  const [isAddSelectionModalOpen, setIsAddSelectionModalOpen] = useState(false);
  const [addSelectionType, setAddSelectionType] = useState(null);
  const [modalSiteId, setModalSiteId] = useState('');
  const [modalFloorplans, setModalFloorplans] = useState([]);
  const [modalFloorplanId, setModalFloorplanId] = useState('');

  const [isRenameModalOpen, setIsRenameModalOpen] = useState(false);
  const [floorplanToRename, setFloorplanToRename] = useState(null);
  const [activeDropdownFpId, setActiveDropdownFpId] = useState(null);

  // Drag & drop state
  const [draggedIndex, setDraggedIndex] = useState(null);
  const [dragOverIndex, setDragOverIndex] = useState(null);

  // Search & Filter state - initialize from location.state immediately to avoid set-state-in-effect
  const [searchQuery, setSearchQuery] = useState(() => {
    if (location.state?.restoreState && location.state?.dashboardState?.searchQuery) {
      return location.state.dashboardState.searchQuery;
    }
    return '';
  });
  const [searchResults, setSearchResults] = useState([]);
  const [isSearchFocused, setIsSearchFocused] = useState(false);

  const [equipFilter, setEquipFilter] = useState(() => {
    if (location.state?.restoreState && location.state?.dashboardState?.equipFilter) {
      return location.state.dashboardState.equipFilter;
    }
    return '';
  });

  const [roomFilter, setRoomFilter] = useState(() => {
    if (location.state?.restoreState && location.state?.dashboardState?.roomFilter) {
      return location.state.dashboardState.roomFilter;
    }
    return '';
  });

  const [ticketFilter, setTicketFilter] = useState(() => {
    if (location.state?.restoreState && location.state?.dashboardState?.ticketFilter) {
      return location.state.dashboardState.ticketFilter;
    }
    return '';
  });

  const getCachedWOFilter = (key, defaultVal) => {
    try {
      const val = localStorage.getItem(`wo_filter_${key}`);
      return val !== null && val !== undefined ? val : defaultVal;
    } catch {
      return defaultVal;
    }
  };

  const [workOrderFilter, setWorkOrderFilter] = useState(() => {
    if (location.state?.restoreState && location.state?.dashboardState?.workOrderFilter) {
      return location.state.dashboardState.workOrderFilter;
    }
    return getCachedWOFilter('search', '');
  });

  const [debouncedEquipFilter, setDebouncedEquipFilter] = useState(equipFilter);
  const [debouncedRoomFilter, setDebouncedRoomFilter] = useState(roomFilter);
  const [debouncedTicketFilter, setDebouncedTicketFilter] = useState(ticketFilter);
  const [debouncedWorkOrderFilter, setDebouncedWorkOrderFilter] = useState(workOrderFilter);

  const [workOrderStatusFilter, setWorkOrderStatusFilter] = useState(() => {
    const cached = getCachedWOFilter('status', null);
    if (cached !== null) return cached;
    if (user) {
      if (isAdmin || auth.canTriage) return 'all';
      return 'open';
    }
    return 'all';
  });
  const [workOrderPriorityFilter, setWorkOrderPriorityFilter] = useState(() => getCachedWOFilter('priority', 'all'));
  const [workOrderCategoryFilter, setWorkOrderCategoryFilter] = useState(() => getCachedWOFilter('category', 'all'));
  const [workOrderSourceFilter, setWorkOrderSourceFilter] = useState(() => getCachedWOFilter('source', 'all'));
  const [workOrderTradeFilter, setWorkOrderTradeFilter] = useState(() => {
    const tradeParam = searchParams.get('trade');
    if (tradeParam) return tradeParam;
    return getCachedWOFilter('trade', 'all');
  });
  const [workOrderTechFilter, setWorkOrderTechFilter] = useState(() => {
    const cached = getCachedWOFilter('tech', null);
    if (cached !== null) return cached;
    const isTech = user && !isAdmin && (user.role === 'technician' || user.role === 'editor');
    if (isTech) return user.username;
    if (user && (isAdmin || auth.canTriage)) return 'Unassigned';
    return 'all';
  });
  const [workOrderDateFilter, setWorkOrderDateFilter] = useState(() => getCachedWOFilter('date', 'all'));
  const [workOrderLastUpdated, setWorkOrderLastUpdated] = useState(null);

  const [equipSortField, setEquipSortField] = useState('name');
  const [equipSortOrder, setEquipSortOrder] = useState('asc'); // 'asc' or 'desc'

  const [ticketSortField, setTicketSortField] = useState('created_at');
  const [ticketSortOrder, setTicketSortOrder] = useState('desc');

  const [workOrderSortField, setWorkOrderSortField] = useState(() => getCachedWOFilter('sort_field', 'created_at'));
  const [workOrderSortOrder, setWorkOrderSortOrder] = useState(() => getCachedWOFilter('sort_order', 'desc'));

  const [roomLocFilter, setRoomLocFilter] = useState('all'); // 'all' | 'located' | 'unlocated'
  const [roomSortField, setRoomSortField] = useState('name');
  const [roomSortOrder, setRoomSortOrder] = useState('asc'); // 'asc' or 'desc'

  // Tab views
  const [isLeftDrawerOpen, setIsLeftDrawerOpen] = useState(false);
  const [isPlusDropdownOpen, setIsPlusDropdownOpen] = useState(false);
  const [isCreateWorkOrderOpen, setIsCreateWorkOrderOpen] = useState(false);

  const [activeView, setActiveView] = useState(() => {
    if (location.state?.restoreState && location.state?.dashboardState?.activeView) {
      return location.state.dashboardState.activeView;
    }
    if (location.pathname === '/rooms') return 'rooms';
    if (location.pathname === '/equipment') return 'equipment';
    if (location.pathname === '/tickets') return 'tickets';
    if (location.pathname === '/work-orders') return 'workorders';
    if (location.pathname === '/floorplans') return 'floorplans';
    if (location.pathname === '/' && (user || (typeof window !== 'undefined' && Boolean(localStorage.getItem('token'))))) return 'workorders';
    return 'floorplans';
  });

  const lastLoadedFloorplansSiteIdRef = useRef(null);

  // Inline editing state
  const [editingEquipId, setEditingEquipId] = useState(null);
  const [editingRoomId, setEditingRoomId] = useState(null);
  const [editForm, setEditForm] = useState({});

  // --- Handlers & API functions first (Lexical declaration ordering) ---

  const loadSites = async () => {
    try {
      if (sites.length === 0) setIsLoadingSites(true);
      const res = await getSites();
      setSites(res.data);
      setCachedDashboardData('sites', res.data);

      const siteIdParam = searchParams.get('siteId') || (typeof window !== 'undefined' ? localStorage.getItem('lastActiveSiteId') : null);
      let targetSite = null;
      if (siteIdParam) {
        targetSite = res.data.find(s => s.id === parseInt(siteIdParam, 10));
      }

      if (!targetSite && res.data.length > 0 && !activeSite && !location.state?.restoreState) {
        targetSite = res.data[0];
      }

      if (targetSite) {
        if (!activeSite || activeSite.id !== targetSite.id) {
          setActiveSite(targetSite);
        }
        localStorage.setItem('lastActiveSiteId', targetSite.id);
      }
    } catch (error) {
      console.error(error);
    } finally {
      setIsLoadingSites(false);
    }
  };

  const loadFloorplans = async (siteId, forceFull = false) => {
    if (!siteId) return;
    if (!forceFull && lastLoadedFloorplansSiteIdRef.current === siteId && floorplans.length > 0) {
      return;
    }
    lastLoadedFloorplansSiteIdRef.current = siteId;
    try {
      const cached = getCachedDashboardData(`floorplans_${siteId}`);
      const isBackground = cached && cached.length > 0 && !forceFull;
      if (!isBackground) {
        setIsLoadingFloorplans(true);
      } else {
        setIsBackgroundSyncingFloorplans(true);
      }
      const res = await getFloorplans(siteId, isBackground ? LOW_PRIORITY_CONFIG : undefined);
      setFloorplans(res.data);
      setCachedDashboardData(`floorplans_${siteId}`, res.data);
      populateFloorplansIntoApiCache(res.data, siteId);
    } catch (error) {
      console.error(error);
    } finally {
      setIsLoadingFloorplans(false);
      setIsBackgroundSyncingFloorplans(false);
    }
  };

  const loadAllEquipment = async (background = false) => {
    try {
      const cached = getCachedDashboardData('equipment');
      const isBackground = background || (cached && cached.length > 0);
      if (!isBackground) {
        setIsLoadingEquipment(true);
      } else {
        setIsBackgroundSyncingEquipment(true);
      }
      const res = await getAllEquipment(isBackground ? LOW_PRIORITY_CONFIG : undefined);
      setAllEquipment(res.data);
      setCachedDashboardData('equipment', res.data);
    } catch (error) {
      console.error(error);
    } finally {
      setIsLoadingEquipment(false);
      setIsBackgroundSyncingEquipment(false);
    }
  };

  const loadAllRooms = async (background = false) => {
    try {
      const cached = getCachedDashboardData('rooms');
      const isBackground = background || (cached && cached.length > 0);
      if (!isBackground) {
        setIsLoadingRooms(true);
      } else {
        setIsBackgroundSyncingRooms(true);
      }
      const res = await getAllRooms(isBackground ? LOW_PRIORITY_CONFIG : undefined);
      setAllRooms(res.data);
      setCachedDashboardData('rooms', res.data);
    } catch (error) {
      console.error(error);
    } finally {
      setIsLoadingRooms(false);
      setIsBackgroundSyncingRooms(false);
    }
  };

  const loadAllTickets = async () => {
    try {
      const res = await getAllTickets();
      setAllTickets(res.data);
      setCachedDashboardData('tickets', res.data);
    } catch (error) {
      console.error(error);
    }
  };

  const loadWorkOrders = async (forceRefresh = false, background = false) => {
    if (!background) {
      setIsLoadingWorkOrders(true);
    } else {
      setIsBackgroundSyncing(true);
    }
    setWorkOrderError(null);
    try {
      const res = await getWorkOrders({ force_refresh: forceRefresh });
      setAllWorkOrders(res.data.data || []);
      setWorkOrderSummary(res.data.summary || null);
      setWorkOrderLastUpdated(new Date());
    } catch (error) {
      console.error("Error loading work orders:", error);
      if (allWorkOrders.length === 0) {
        setWorkOrderError(getErrorMessage(error, "Failed to load work orders"));
      }
    } finally {
      setIsLoadingWorkOrders(false);
      setIsBackgroundSyncing(false);
    }
  };

  // --- Effects below function declarations ---

  // Sync active site to query parameter siteId
  useEffect(() => {
    if (activeSite) {
      const currentSiteId = searchParams.get('siteId');
      if (currentSiteId !== activeSite.id.toString()) {
        const newParams = new URLSearchParams(searchParams);
        newParams.set('siteId', activeSite.id);
        setSearchParams(newParams, { replace: true });
      }
    }
  }, [activeSite, searchParams, setSearchParams]);

  // Handle clearing the restoreState flag once data lists are loaded
  useEffect(() => {
    if (location.state?.restoreState && location.state?.dashboardState) {
      const { dashboardState } = location.state;
      const listDataRestored =
        (dashboardState.activeView !== 'equipment' || allEquipment.length > 0) &&
        (dashboardState.activeView !== 'rooms' || allRooms.length > 0);

      if (listDataRestored) {
        navigate(location.pathname + location.search, {
          replace: true,
          state: { ...location.state, restoreState: undefined }
        });
      }
    }
  }, [location.state, allEquipment, allRooms, navigate, location.pathname, location.search]);

  // Load floorplans when active site changes
  useEffect(() => {
    if (activeSite?.id) {
      loadFloorplans(activeSite.id);
    } else {
      setIsLoadingFloorplans(false);
    }
  }, [activeSite?.id]);

  // Synchronize role-based default filters for authenticated users
  const userInitFilterRef = useRef(false);
  useEffect(() => {
    if (user && !userInitFilterRef.current) {
      userInitFilterRef.current = true;
      const isTech = !isAdmin && (user.role === 'technician' || user.role === 'editor');
      const hasCachedTech = localStorage.getItem('wo_filter_tech');
      const hasCachedStatus = localStorage.getItem('wo_filter_status');

      if (isTech) {
        if (!hasCachedTech) {
          setWorkOrderTechFilter(user.username);
        }
        if (!hasCachedStatus) {
          setWorkOrderStatusFilter('open');
        }
      } else if (isAdmin || auth.canTriage) {
        if (!hasCachedTech) {
          setWorkOrderTechFilter('Unassigned');
        }
        if (!hasCachedStatus) {
          setWorkOrderStatusFilter('all');
        }
      }
    }
  }, [user, isAdmin, auth.canTriage]);

  // Load contextual list data when view changes
  useEffect(() => {
    if (activeView === 'equipment') loadAllEquipment();
    if (activeView === 'rooms') loadAllRooms();
    if (activeView === 'tickets') loadAllTickets();
    if (activeView === 'workorders') {
      loadWorkOrders();
    }
  }, [activeView]);

  // If user state is resolved and active view is workorders without work orders loaded, trigger loadWorkOrders
  useEffect(() => {
    if (user && activeView === 'workorders' && allWorkOrders.length === 0 && !isLoadingWorkOrders) {
      loadWorkOrders();
    }
  }, [user, activeView, allWorkOrders.length, isLoadingWorkOrders]);

  // Load initial sites
  useEffect(() => {
    loadSites();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Idle prefetch equipment and rooms in background after initial render (low priority)
  useEffect(() => {
    const prefetchData = () => {
      if ((getCachedDashboardData('equipment') || []).length === 0) {
        loadAllEquipment(true);
      }
      if ((getCachedDashboardData('rooms') || []).length === 0) {
        loadAllRooms(true);
      }
    };

    if ('requestIdleCallback' in window) {
      const handle = window.requestIdleCallback(prefetchData, { timeout: 3000 });
      return () => window.cancelIdleCallback(handle);
    } else {
      const timer = setTimeout(prefetchData, 2000);
      return () => clearTimeout(timer);
    }
  }, []);

  // Close dropdowns on outside clicks
  useEffect(() => {
    const handleClickOutside = (event) => {
      if (!event.target.closest('.dropdown-container') && !event.target.closest('.trigger-btn')) {
        setIsPlusDropdownOpen(false);
        setActiveDropdownFpId(null);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  // Global search
  useEffect(() => {
    if (searchQuery && searchQuery.trim().length > 0) {
      const results = searchClientEntities(searchQuery, {
        rooms: allRooms,
        equipment: allEquipment,
        siteFloorplans: floorplans,
        tickets: allTickets
      });
      setSearchResults(results);
    } else {
      setSearchResults([]);
    }
  }, [searchQuery, allRooms, allEquipment, floorplans, allTickets]);

  // List filter debouncing
  useEffect(() => {
    const timer = setTimeout(() => {
      setDebouncedEquipFilter(equipFilter);
    }, 250);
    return () => clearTimeout(timer);
  }, [equipFilter]);

  useEffect(() => {
    const timer = setTimeout(() => {
      setDebouncedRoomFilter(roomFilter);
    }, 250);
    return () => clearTimeout(timer);
  }, [roomFilter]);

  useEffect(() => {
    const timer = setTimeout(() => {
      setDebouncedTicketFilter(ticketFilter);
    }, 250);
    return () => clearTimeout(timer);
  }, [ticketFilter]);

  useEffect(() => {
    const timer = setTimeout(() => {
      setDebouncedWorkOrderFilter(workOrderFilter);
    }, 250);
    return () => clearTimeout(timer);
  }, [workOrderFilter]);

  const handleSearchResultClick = (result) => {
    floorplanLogger.startSwitch(result.floorplan_id, result.floorplan_name || null, 'Dashboard Global Search');
    navigate(`/map/${result.floorplan_id}`, { state: { targetResult: result } });
  };

  const handleCreateSite = async (name) => {
    if (validateWildcards(name)) {
      alert('Site name cannot contain * or ?');
      return;
    }
    try {
      const res = await createSite({ name });
      setIsSiteModalOpen(false);
      if (res?.data) {
        updateCachedSite(res.data.id, 'add', res.data);
        setActiveSite(res.data);
        localStorage.setItem('lastActiveSiteId', res.data.id);
      }
      loadSites();
    } catch (error) {
      console.error(error);
      alert('Error creating site: ' + (error.response?.data?.detail || error.message));
    }
  };

  const handleRenameSite = async (newName) => {
    if (!siteToRename || !newName) return;
    if (validateWildcards(newName)) {
      alert('Site name cannot contain * or ?');
      return;
    }
    try {
      const res = await updateSite(siteToRename.id, { name: newName });
      const updated = res?.data || { ...siteToRename, name: newName };
      setSites(prev => {
        const next = prev.map(s => s.id === siteToRename.id ? { ...s, name: newName } : s);
        return next;
      });
      if (activeSite?.id === siteToRename.id) {
        setActiveSite(prev => prev ? { ...prev, name: newName } : prev);
      }
      updateCachedSite(siteToRename.id, 'update', updated);
      setIsRenameSiteModalOpen(false);
      setSiteToRename(null);
    } catch (error) {
      console.error(error);
      alert('Error renaming site: ' + (error.response?.data?.detail || error.message));
    }
  };

  const handleDeleteSite = async (siteId) => {
    const target = sites.find(s => s.id === siteId) || (activeSite?.id === siteId ? activeSite : null);
    const targetName = target?.name || `Site #${siteId}`;
    if (!window.confirm(`Are you sure you want to delete the site "${targetName}"? This will permanently delete all floorplans, rooms, equipment, and tickets associated with this site.`)) {
      return;
    }
    try {
      await deleteSite(siteId);
      updateCachedSite(siteId, 'delete', null);
      const remaining = sites.filter(s => s.id !== siteId);
      setSites(remaining);
      if (activeSite?.id === siteId) {
        const newActive = remaining.length > 0 ? remaining[0] : null;
        setActiveSite(newActive);
        if (newActive) {
          localStorage.setItem('lastActiveSiteId', newActive.id);
          loadFloorplans(newActive.id, true);
        } else {
          localStorage.removeItem('lastActiveSiteId');
          setFloorplans([]);
        }
      }
      loadAllEquipment(true);
      loadAllRooms(true);
      loadAllTickets();
    } catch (error) {
      console.error(error);
      alert('Error deleting site: ' + (error.response?.data?.detail || error.message));
    }
  };

  const handleUploadFloorplan = async (name, file) => {
    if (!activeSite || !file) return;
    if (validateWildcards(name)) {
      alert('Floorplan name cannot contain * or ?');
      return;
    }
    const formData = new FormData();
    formData.append('site_id', activeSite.id);
    formData.append('name', name);
    formData.append('file', file);
    try {
      await uploadFloorplan(formData);
      setIsUploadModalOpen(false);
      loadFloorplans(activeSite.id, true);
    } catch (error) {
      console.error(error);
      alert('Error uploading plan: ' + (error.response?.data?.detail || error.message));
    }
  };

  const handleDeleteFloorplan = async (e, floorplanId) => {
    e.stopPropagation();
    if (!window.confirm("Are you sure you want to delete this floorplan?")) return;
    try {
      await deleteFloorplan(floorplanId);
      setFloorplans(prev => {
        const next = prev.filter(f => f.id !== floorplanId);
        if (activeSite?.id) setCachedDashboardData(`floorplans_${activeSite.id}`, next);
        return next;
      });
    } catch (error) {
      console.error(error);
      alert('Error deleting plan: ' + (error.response?.data?.detail || error.message));
    }
  };

  const handleRenameFloorplan = async (newName) => {
    if (!floorplanToRename || !newName) return;
    if (validateWildcards(newName)) {
      alert('Floorplan name cannot contain * or ?');
      return;
    }
    try {
      await updateFloorplan(floorplanToRename.id, { name: newName });
      setFloorplans(prev => {
        const next = prev.map(f => f.id === floorplanToRename.id ? { ...f, name: newName } : f);
        if (activeSite?.id) setCachedDashboardData(`floorplans_${activeSite.id}`, next);
        return next;
      });
      setIsRenameModalOpen(false);
      setFloorplanToRename(null);
    } catch (error) {
      console.error(error);
      alert('Error renaming plan: ' + (error.response?.data?.detail || error.message));
    }
  };

  const handleDragStart = (e, index) => {
    setDraggedIndex(index);
    e.dataTransfer.effectAllowed = 'move';
  };

  const handleDragOver = (e, index) => {
    e.preventDefault();
    if (dragOverIndex !== index) {
      setDragOverIndex(index);
    }
  };

  const handleDragEnd = () => {
    setDraggedIndex(null);
    setDragOverIndex(null);
  };

  const handleDrop = async (e, targetIndex) => {
    e.preventDefault();
    if (draggedIndex === null || draggedIndex === targetIndex) {
      setDraggedIndex(null);
      setDragOverIndex(null);
      return;
    }

    const reordered = [...floorplans];
    const [draggedItem] = reordered.splice(draggedIndex, 1);
    reordered.splice(targetIndex, 0, draggedItem);

    // Optimistically update
    setFloorplans(reordered);
    if (activeSite?.id) setCachedDashboardData(`floorplans_${activeSite.id}`, reordered);
    setDraggedIndex(null);
    setDragOverIndex(null);

    try {
      const orders = reordered.map((fp, idx) => ({
        id: fp.id,
        sort_order: idx,
      }));
      await updateFloorplansSortOrder(activeSite.id, { orders });
    } catch (error) {
      console.error('Failed to save sort order:', error);
      alert('Failed to save order: ' + (error.response?.data?.detail || error.message));
      loadFloorplans(activeSite.id);
    }
  };

  // Sync activeView with URL pathname
  useEffect(() => {
    if (location.pathname === '/rooms') setActiveView('rooms');
    else if (location.pathname === '/equipment') setActiveView('equipment');
    else if (location.pathname === '/tickets') setActiveView('tickets');
    else if (location.pathname === '/work-orders') setActiveView('workorders');
    else if (location.pathname === '/floorplans') setActiveView('floorplans');
    else if (location.pathname === '/') {
      if (!location.state?.restoreState) {
        if (user) {
          navigate('/work-orders', { replace: true });
        } else if (!auth.loading) {
          setActiveView('floorplans');
        }
      }
    }
  }, [location.pathname, location.state, user, auth.loading, navigate]);

  // Handle trade query parameter in URL
  useEffect(() => {
    const tradeParam = searchParams.get('trade');
    if (tradeParam) {
      setWorkOrderTradeFilter(tradeParam);
      setWorkOrderStatusFilter('all');
    }
  }, [searchParams]);

  const handleNavClick = (view) => {
    setIsLeftDrawerOpen(false);
    if (view === 'rooms') {
      setActiveView('rooms');
      navigate('/rooms');
    } else if (view === 'equipment') {
      setActiveView('equipment');
      navigate('/equipment');
    } else if (view === 'tickets') {
      setActiveView('tickets');
      navigate('/tickets');
    } else if (view === 'workorders') {
      setActiveView('workorders');
      navigate('/work-orders');
    } else if (view === 'audit-log' || view === 'audit-history') {
      navigate('/audit-log', { state: { from: { pathname: location.pathname, search: location.search, hash: location.hash } } });
    } else if (view === 'users') {
      navigate('/users', { state: { from: { pathname: location.pathname, search: location.search, hash: location.hash } } });
    } else if (view === 'remapper') {
      navigate('/remapper', { state: { from: { pathname: location.pathname, search: location.search, hash: location.hash } } });
    } else {
      setActiveView('floorplans');
      navigate('/floorplans');
    }
  };

  const handleModalSiteChange = async (siteId) => {
    setModalSiteId(siteId);
    const cached = getCachedDashboardData(`floorplans_${siteId}`);
    if (cached && cached.length > 0) {
      setModalFloorplans(cached);
      setModalFloorplanId(cached[0].id);
    }
    try {
      const res = await getFloorplans(siteId);
      setModalFloorplans(res.data);
      if (res.data.length > 0) {
        setModalFloorplanId(res.data[0].id);
      } else {
        setModalFloorplanId('');
      }
    } catch (e) {
      console.error(e);
    }
  };

  const openAddSelectionModal = (type) => {
    setAddSelectionType(type);
    setIsPlusDropdownOpen(false);
    setIsAddSelectionModalOpen(true);
    const targetSite = activeSite || (sites.length > 0 ? sites[0] : null);
    if (targetSite) {
      setModalSiteId(targetSite.id);
      if (activeSite && activeSite.id === targetSite.id && floorplans.length > 0) {
        setModalFloorplans(floorplans);
        setModalFloorplanId(floorplans[0].id);
      } else {
        const cached = getCachedDashboardData(`floorplans_${targetSite.id}`);
        if (cached && cached.length > 0) {
          setModalFloorplans(cached);
          setModalFloorplanId(cached[0].id);
        }
      }
      handleModalSiteChange(targetSite.id);
    }
  };

  // Utility to check for wildcards
  const validateWildcards = (str) => {
    return str.includes('*') || str.includes('?');
  };

  // Utility to convert wildcard search to Regex
  const wildcardToRegex = (pattern) => {
    // Escape standard regex characters except * and ?
    const escaped = pattern.replace(/[.+^${}()|[\]\\]/g, '\\$&');
    const regexStr = escaped
      .replace(/\*/g, '.*')
      .replace(/\?/g, '.');
    return new RegExp(`${regexStr}`, 'i');
  };

  // Inline Equipment Edit
  const startEditEquip = (equip) => {
    setEditingEquipId(equip.id);
    setEditForm({
      name: equip.name,
      description: equip.description || '',
      tools_required: equip.tools_required || '',
      color: equip.color || '#10b981',
    });
  };

  const saveEditEquip = async (id) => {
    if (validateWildcards(editForm.name) || validateWildcards(editForm.description)) {
      alert('Name and description cannot contain * or ?');
      return;
    }
    try {
      const formData = new FormData();
      formData.append('name', editForm.name);
      formData.append('description', editForm.description);
      formData.append('tools_required', editForm.tools_required);
      formData.append('color', editForm.color);
      const res = await updateEquipment(id, formData);
      const updated = res.data;
      setAllEquipment(prev => {
        const next = prev.map(e => e.id === id ? { ...e, ...updated } : e);
        setCachedDashboardData('equipment', next);
        return next;
      });
      setEditingEquipId(null);
      if (updated.floorplan_id) {
        updateCachedFloorplanItem(updated.floorplan_id, 'equipment', 'update', updated, updated.site_id);
      }
    } catch (error) {
      console.error(error);
      alert(error.response?.data?.detail || 'Failed to save');
    }
  };

  const handleDeleteEquip = async (id) => {
    if (!window.confirm("Delete this equipment?")) return;
    try {
      const target = allEquipment.find(e => e.id === id);
      await deleteEquipment(id);
      setAllEquipment(prev => {
        const next = prev.filter(e => e.id !== id);
        setCachedDashboardData('equipment', next);
        return next;
      });
      if (target?.floorplan_id) {
        updateCachedFloorplanItem(target.floorplan_id, 'equipment', 'delete', id, target.site_id);
      }
    } catch (error) {
      console.error(error);
    }
  };

  // Inline Room Edit
  const startEditRoom = (room) => {
    setEditingRoomId(room.id);
    setEditForm({
      name: room.name,
      description: room.description || '',
    });
  };

  const saveEditRoom = async (id) => {
    if (validateWildcards(editForm.name) || validateWildcards(editForm.description)) {
      alert('Name and description cannot contain * or ?');
      return;
    }
    try {
      const res = await updateRoom(id, {
        name: editForm.name,
        description: editForm.description,
      });
      const updated = res.data;
      setAllRooms(prev => {
        const next = prev.map(r => r.id === id ? { ...r, ...updated } : r);
        setCachedDashboardData('rooms', next);
        return next;
      });
      setEditingRoomId(null);
      if (updated.floorplan_id) {
        updateCachedFloorplanItem(updated.floorplan_id, 'room', 'update', updated, updated.site_id);
      }
    } catch (error) {
      console.error(error);
      alert(error.response?.data?.detail || 'Failed to save');
    }
  };

  const handleDeleteRoom = async (id) => {
    if (!window.confirm("Delete this room?")) return;
    try {
      const target = allRooms.find(r => r.id === id);
      await deleteRoom(id);
      setAllRooms(prev => {
        const next = prev.filter(r => r.id !== id);
        setCachedDashboardData('rooms', next);
        return next;
      });
      if (target?.floorplan_id) {
        updateCachedFloorplanItem(target.floorplan_id, 'room', 'delete', id, target.site_id);
      }
    } catch (error) {
      console.error(error);
    }
  };

  const handleDeleteTicket = async (id) => {
    if (!window.confirm("Are you sure you want to delete this ticket?")) return;
    try {
      await deleteTicket(id);
      setAllTickets(prev => prev.filter(t => t.id !== id));
    } catch (error) {
      console.error(error);
      alert('Error deleting ticket');
    }
  };

  const goToMap = (item, explicitType = null) => {
    if (!item) return;

    const scrollY = typeof window === 'undefined' ? 0 : Math.max(0, window.scrollY || 0);
    const scrollStorageKey = location.pathname === '/work-orders'
      ? `equipmap:work-order-scroll:${location.key}`
      : null;
    if (scrollStorageKey) {
      try {
        window.sessionStorage.setItem(scrollStorageKey, String(scrollY));
      } catch {
        // The explicit map return state below remains available if storage is unavailable.
      }
    }

    const returnTo = {
      pathname: location.pathname,
      search: location.search,
      scrollY,
      scrollStorageKey
    };

    // Handle wrapped { type: 'room', data: r } format or direct entity
    let target = item;
    let itemType = explicitType || item.type;
    if (item.data && (item.type || explicitType)) {
      target = { ...item.data };
      itemType = explicitType || item.type;
    }

    if (target.map_url) {
      navigate(target.map_url, {
        state: { targetResult: target, returnTo }
      });
      return;
    }

    // Determine type if not specified
    if (!itemType) {
      if (target.order_number || target.category) itemType = 'workOrder';
      else if (target.color !== undefined || target.tools_required !== undefined) itemType = 'equipment';
      else if (target.status !== undefined && target.order_number === undefined) itemType = 'ticket';
      else itemType = 'room';
    }

    // Determine floorplan_id
    let floorplanId = target.floorplan_id;
    if (!floorplanId && target.rooms?.length > 0) {
      floorplanId = target.rooms[0].floorplan_id;
    }
    if (!floorplanId && target.equipment?.length > 0) {
      floorplanId = target.equipment[0].floorplan_id;
    }

    if (!floorplanId) {
      console.warn("Cannot navigate to map: Item has no associated floorplan_id", target);
      return;
    }

    const url = target.id && itemType && itemType !== 'floorplan'
      ? `/map/${floorplanId}?highlightType=${itemType}&highlightId=${target.id}`
      : `/map/${floorplanId}`;

    floorplanLogger.startSwitch(floorplanId, target.floorplan_name || null, `Dashboard ${itemType || 'Item'} View on Map`);

    navigate(url, {
      state: {
        targetResult: { ...target, type: itemType, floorplan_id: floorplanId },
        returnTo
      }
    });
  };

  const toggleEquipSelection = (id) => {
    setSelectedEquipIds(prev =>
      prev.includes(id) ? prev.filter(item => item !== id) : [...prev, id]
    );
  };

  const selectAllFilteredEquip = (ids) => {
    setSelectedEquipIds(ids);
  };

  const handleBulkUpdateEquip = async () => {
    if (selectedEquipIds.length === 0) return;

    if (bulkEditForm.descriptionOverridden && validateWildcards(bulkEditForm.description)) {
      alert('Description cannot contain * or ?');
      return;
    }

    const updateData = {
      ids: selectedEquipIds,
      description: bulkEditForm.descriptionOverridden ? bulkEditForm.description : undefined,
      color: bulkEditForm.colorOverridden ? bulkEditForm.color : undefined,
      tools_required: bulkEditForm.tools_requiredOverridden ? bulkEditForm.tools_required : undefined,
    };

    try {
      await bulkUpdateEquipment(updateData);

      // Refresh list
      const res = await getAllEquipment();
      setAllEquipment(res.data);

      setIsBulkEditModalOpen(false);
      setSelectedEquipIds([]);
      setBulkEditForm({
        description: '', color: '', tools_required: '',
        descriptionOverridden: false, colorOverridden: false,
      });
    } catch (error) {
      console.error(error);
      alert('Failed to update equipment');
    }
  };

  const toggleEquipSort = (field) => {
    if (equipSortField === field) {
      setEquipSortOrder(equipSortOrder === 'asc' ? 'desc' : 'asc');
    } else {
      setEquipSortField(field);
      setEquipSortOrder('asc');
    }
  };

  const toggleTicketSort = (field) => {
    if (ticketSortField === field) {
      setTicketSortOrder(ticketSortOrder === 'asc' ? 'desc' : 'asc');
    } else {
      setTicketSortField(field);
      setTicketSortOrder('asc');
    }
  };

  const toggleRoomSort = (field) => {
    if (roomSortField === field) {
      setRoomSortOrder(roomSortOrder === 'asc' ? 'desc' : 'asc');
    } else {
      setRoomSortField(field);
      setRoomSortOrder('asc');
    }
  };

  const goToPlaceRoom = (room) => {
    navigate(`/map/${room.floorplan_id}`, {
      state: { targetResult: { ...room, type: 'room' }, isLocating: true }
    });
  };

  // Memoized and debounced filtered lists
  const filteredEquipment = useMemo(() => {
    const filter = debouncedEquipFilter.toLowerCase();
    const hasWildcards = validateWildcards(filter);
    const regex = hasWildcards ? wildcardToRegex(filter) : null;

    return allEquipment
      .filter(e => {
        if (hasWildcards) {
          return regex.test(e.name) ||
                 regex.test(e.description || '') ||
                 regex.test(e.floorplan_name || '') ||
                 regex.test(e.site_name || '');
        }
        return e.name.toLowerCase().includes(filter) ||
               (e.description || '').toLowerCase().includes(filter) ||
               (e.floorplan_name || '').toLowerCase().includes(filter) ||
               (e.site_name || '').toLowerCase().includes(filter);
      })
      .sort((a, b) => {
        const valA = (a[equipSortField] || '').toString();
        const valB = (b[equipSortField] || '').toString();
        const result = sharedCollator.compare(valA, valB);
        return equipSortOrder === 'asc' ? result : -result;
      });
  }, [allEquipment, debouncedEquipFilter, equipSortField, equipSortOrder]);

  const filteredRooms = useMemo(() => {
    const filter = debouncedRoomFilter.toLowerCase();
    const hasWildcards = validateWildcards(filter);
    const regex = hasWildcards ? wildcardToRegex(filter) : null;

    return allRooms
      .filter(r => {
        // Location status filter
        const isLocated = r.x_coordinate != null && r.y_coordinate != null;
        if (roomLocFilter === 'located' && !isLocated) return false;
        if (roomLocFilter === 'unlocated' && isLocated) return false;

        if (hasWildcards) {
          return regex.test(r.name) ||
                 regex.test(r.description || '') ||
                 regex.test(r.floorplan_name || '') ||
                 regex.test(r.site_name || '');
        }
        return r.name.toLowerCase().includes(filter) ||
               (r.description || '').toLowerCase().includes(filter) ||
               (r.floorplan_name || '').toLowerCase().includes(filter) ||
               (r.site_name || '').toLowerCase().includes(filter);
      })
      .sort((a, b) => {
        const valA = (a[roomSortField] || '').toString();
        const valB = (b[roomSortField] || '').toString();
        const result = sharedCollator.compare(valA, valB);
        return roomSortOrder === 'asc' ? result : -result;
      });
  }, [allRooms, debouncedRoomFilter, roomLocFilter, roomSortField, roomSortOrder]);

  const filteredTickets = useMemo(() => {
    const filter = debouncedTicketFilter.toLowerCase();
    const hasWildcards = validateWildcards(filter);
    const regex = hasWildcards ? wildcardToRegex(filter) : null;

    return allTickets
      .filter(t => {
        if (hasWildcards) {
          return regex.test(t.title) ||
                 regex.test(t.description || '') ||
                 regex.test(t.floorplan_name || '') ||
                 regex.test(t.site_name || '') ||
                 regex.test(t.creator_username || '') ||
                 regex.test(t.status);
        }
        return t.title.toLowerCase().includes(filter) ||
               (t.description || '').toLowerCase().includes(filter) ||
               (t.floorplan_name || '').toLowerCase().includes(filter) ||
               (t.site_name || '').toLowerCase().includes(filter) ||
               (t.creator_username || '').toLowerCase().includes(filter) ||
               t.status.toLowerCase().includes(filter);
      })
      .sort((a, b) => {
        const valA = (a[ticketSortField] || '').toString();
        const valB = (b[ticketSortField] || '').toString();
        const result = sharedCollator.compare(valA, valB);
        return ticketSortOrder === 'asc' ? result : -result;
      });
  }, [allTickets, debouncedTicketFilter, ticketSortField, ticketSortOrder]);

  // Persist work order filters to browser localStorage
  useEffect(() => {
    try {
      localStorage.setItem('wo_filter_search', workOrderFilter || '');
      localStorage.setItem('wo_filter_status', workOrderStatusFilter || 'all');
      localStorage.setItem('wo_filter_priority', workOrderPriorityFilter || 'all');
      localStorage.setItem('wo_filter_category', workOrderCategoryFilter || 'all');
      localStorage.setItem('wo_filter_source', workOrderSourceFilter || 'all');
      localStorage.setItem('wo_filter_trade', workOrderTradeFilter || 'all');
      localStorage.setItem('wo_filter_tech', workOrderTechFilter || 'all');
      localStorage.setItem('wo_filter_date', workOrderDateFilter || 'all');
      localStorage.setItem('wo_filter_sort_field', workOrderSortField || 'created_at');
      localStorage.setItem('wo_filter_sort_order', workOrderSortOrder || 'desc');
    } catch (e) {
      console.warn('Failed to save work order filters to localStorage:', e);
    }
  }, [
    workOrderFilter,
    workOrderStatusFilter,
    workOrderPriorityFilter,
    workOrderCategoryFilter,
    workOrderSourceFilter,
    workOrderTradeFilter,
    workOrderTechFilter,
    workOrderDateFilter,
    workOrderSortField,
    workOrderSortOrder
  ]);

  const toggleWorkOrderSort = (field) => {
    if (workOrderSortField === field) {
      setWorkOrderSortOrder(workOrderSortOrder === 'asc' ? 'desc' : 'asc');
    } else {
      setWorkOrderSortField(field);
      setWorkOrderSortOrder(field.includes('date') || field.includes('_at') ? 'desc' : 'asc');
    }
  };

  const resetWorkOrderFilters = () => {
    setWorkOrderFilter('');
    setWorkOrderStatusFilter('all');
    setWorkOrderPriorityFilter('all');
    setWorkOrderCategoryFilter('all');
    setWorkOrderSourceFilter('all');
    setWorkOrderTradeFilter('all');
    setWorkOrderTechFilter('all');
    setWorkOrderDateFilter('all');
  };

  const filteredWorkOrders = useMemo(() => {
    const filter = (debouncedWorkOrderFilter || '').toLowerCase().trim();
    const hasWildcards = validateWildcards(filter);
    const regex = hasWildcards ? wildcardToRegex(filter) : null;
    const collator = new Intl.Collator(undefined, { numeric: true, sensitivity: 'base' });
    const now = new Date();

    return allWorkOrders
      .filter(wo => {
        // Status Filter
        if (workOrderStatusFilter !== 'all') {
          if (workOrderStatusFilter === 'open') {
            if (wo.status === 'completed' || wo.status === 'cancelled' || wo.status === 'rejected') return false;
          } else if (workOrderStatusFilter === 'triage_unassigned') {
            const isUnassigned = !wo.assignees || wo.assignees.length === 0;
            const isOpen = wo.status !== 'completed' && wo.status !== 'cancelled' && wo.status !== 'rejected';
            if (wo.status !== 'pending_triage' && !(isOpen && isUnassigned)) return false;
          } else if (wo.status !== workOrderStatusFilter) {
            return false;
          }
        }

        // Priority Filter
        if (workOrderPriorityFilter !== 'all' && wo.priority !== workOrderPriorityFilter) {
          return false;
        }

        // Category Filter
        if (workOrderCategoryFilter !== 'all' && wo.category !== workOrderCategoryFilter) {
          return false;
        }

        // Maintenance Source Filter
        if (workOrderSourceFilter !== 'all' && getWorkOrderSource(wo) !== workOrderSourceFilter) return false;

        // Trade Filter
        if (workOrderTradeFilter !== 'all' && wo.trade !== workOrderTradeFilter) {
          return false;
        }

        // Tech Filter
        if (workOrderTechFilter !== 'all') {
          if (workOrderTechFilter === 'Unassigned') {
            if (wo.assignees && wo.assignees.length > 0) return false;
          } else {
            const hasTech = (wo.assignees || []).some(u => u.username === workOrderTechFilter);
            if (!hasTech) return false;
          }
        }

        // Date Filter
        if (workOrderDateFilter === 'overdue') {
          if (!isWorkOrderOverdue(wo, now)) return false;
        } else if (workOrderDateFilter !== 'all') {
          const dateStr = wo.start_date || wo.created_at;
          if (dateStr) {
            const woDate = new Date(dateStr);
            if (workOrderDateFilter === 'today') {
              if (woDate.toDateString() !== now.toDateString()) return false;
            } else if (workOrderDateFilter === 'this_week') {
              const weekAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
              if (woDate < weekAgo) return false;
            } else if (workOrderDateFilter === 'this_month') {
              if (woDate.getMonth() !== now.getMonth() || woDate.getFullYear() !== now.getFullYear()) return false;
            } else if (workOrderDateFilter === 'past_30') {
              const thirtyDaysAgo = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
              if (woDate < thirtyDaysAgo) return false;
            }
          }
        }

        // Search Filter
        if (!filter) return true;

        // Construct complete searchable text matching all displayed fields and fallbacks
        const locTitle = wo.floorplan_name
          ? `${wo.site_name || 'Site'} - ${wo.floorplan_name} ${wo.site_name || 'Site'} ${wo.floorplan_name}`
          : (wo.site_name || 'Campus');

        const roomNames = (wo.rooms || []).map(r => r.name ? `Room ${r.name} ${r.name} ${r.description || ''} ${r.floorplan_name || ''} ${r.site_name || ''}` : '').join(' ');
        const equipNames = (wo.equipment || []).map(e => e.name ? `${e.name} ${e.description || ''} ${e.floorplan_name || ''} ${e.site_name || ''}` : '').join(' ');

        const subLocation = (wo.rooms && wo.rooms.length > 0)
          ? roomNames
          : ((wo.equipment && wo.equipment.length > 0)
              ? equipNames
              : (wo.location_details || 'General Building Area'));

        const assigneeNames = (wo.assignees && wo.assignees.length > 0)
          ? wo.assignees.map(u => `${u.full_name || ''} ${u.username || ''} ${u.role || ''}`).join(' ')
          : 'Unassigned Awaiting Dispatch';

        const statusText = `${wo.status || ''} ${wo.status === 'pending_triage' ? 'triage pending' : ''} ${wo.status === 'in_progress' ? 'in progress' : ''}`;

        const searchableText = [
          wo.order_number,
          wo.title,
          wo.description,
          wo.category,
          wo.trade,
          wo.priority,
          wo.requester_name,
          wo.requester_email,
          wo.requester_phone,
          wo.site_name,
          wo.floorplan_name,
          wo.location_details,
          locTitle,
          subLocation,
          roomNames,
          equipNames,
          assigneeNames,
          statusText,
          wo.completion_notes
        ].filter(Boolean).join(' ').toLowerCase();

        if (hasWildcards && regex) {
          return regex.test(searchableText);
        }

        // 1. Direct contiguous substring match (e.g. "level 5", "room 1en03", "wo-1005")
        if (searchableText.includes(filter)) {
          return true;
        }

        // 2. Normalized phrase match (stripping punctuation/dashes so "Building Level 5" matches "Building - Level 5")
        const normalizedSearchable = searchableText.replace(/[-_/:,]/g, ' ').replace(/\s+/g, ' ');
        const normalizedFilter = filter.replace(/[-_/:,]/g, ' ').replace(/\s+/g, ' ');
        if (normalizedSearchable.includes(normalizedFilter)) {
          return true;
        }

        // 3. Token-based matching for cross-field searches (e.g. "Campus General" or "Campus of General")
        const STOP_WORDS = new Set(['of', 'in', 'on', 'at', 'to', 'for', 'the', 'a', 'an', 'or', 'and', 'with', 'by']);
        const rawTokens = filter.replace(/[,;:]/g, ' ').split(/\s+/).filter(Boolean);
        const meaningfulTokens = rawTokens.filter(t => !STOP_WORDS.has(t));
        const tokensToUse = meaningfulTokens.length > 0 ? meaningfulTokens : rawTokens;

        if (tokensToUse.length === 0) return true;

        return tokensToUse.every(token => {
          // If token is purely digits (e.g. "5", "1", "101"), ensure it matches as a distinct number boundary
          // so that "5" does NOT match inside "1005" or "2026"
          if (/^\d+$/.test(token)) {
            const numRegex = new RegExp(`(^|[^a-z0-9])${token}([^a-z0-9]|$)`, 'i');
            return numRegex.test(searchableText);
          }
          // Word boundary or prefix match for alphanumeric tokens
          const escaped = token.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
          const wordRegex = new RegExp(`(^|[^a-z0-9])${escaped}`, 'i');
          return wordRegex.test(searchableText);
        });
      })
      .sort((a, b) => {
        let valA = a[workOrderSortField] ?? '';
        let valB = b[workOrderSortField] ?? '';

        if (workOrderSortField === 'created_at' || workOrderSortField === 'date' || workOrderSortField.includes('date') || workOrderSortField.includes('_at')) {
          const dateA = a[workOrderSortField] || a.created_at || a.start_date || '';
          const dateB = b[workOrderSortField] || b.created_at || b.start_date || '';
          const timeA = dateA ? new Date(dateA).getTime() : 0;
          const timeB = dateB ? new Date(dateB).getTime() : 0;
          return workOrderSortOrder === 'asc' ? timeA - timeB : timeB - timeA;
        }

        if (workOrderSortField === 'tech' || workOrderSortField === 'assignees') {
          const techA = (a.assignees && a.assignees.length > 0) ? (a.assignees[0].full_name || a.assignees[0].username || '') : '';
          const techB = (b.assignees && b.assignees.length > 0) ? (b.assignees[0].full_name || b.assignees[0].username || '') : '';
          const result = collator.compare(techA, techB);
          return workOrderSortOrder === 'asc' ? result : -result;
        }

        if (workOrderSortField === 'priority') {
          const priorityWeights = { urgent: 4, critical: 4, high: 3, medium: 2, low: 1 };
          const weightA = priorityWeights[String(valA).toLowerCase()] || 0;
          const weightB = priorityWeights[String(valB).toLowerCase()] || 0;
          return workOrderSortOrder === 'asc' ? weightA - weightB : weightB - weightA;
        }

        const result = collator.compare(valA.toString(), valB.toString());
        return workOrderSortOrder === 'asc' ? result : -result;
      });
  }, [
    allWorkOrders,
    debouncedWorkOrderFilter,
    workOrderStatusFilter,
    workOrderPriorityFilter,
    workOrderCategoryFilter,
    workOrderSourceFilter,
    workOrderTradeFilter,
    workOrderTechFilter,
    workOrderDateFilter,
    workOrderSortField,
    workOrderSortOrder
  ]);

  return {
    user,
    isAuthLoading,
    logout,
    isEditor,
    isAdmin,
    sites,
    activeSite,
    setActiveSite,
    floorplans,
    allEquipment,
    allRooms,
    allTickets,
    allWorkOrders,
    workOrderSummary,
    isLoadingSites,
    isLoadingFloorplans,
    isLoadingEquipment,
    isLoadingRooms,
    isLoadingWorkOrders,
    isBackgroundSyncingFloorplans,
    isBackgroundSyncingEquipment,
    isBackgroundSyncingRooms,
    isBackgroundSyncing,
    workOrderError,
    loadWorkOrders,
    loadAllEquipment,
    loadAllRooms,
    loadFloorplans,
    loadSites,
    isSiteModalOpen,
    setIsSiteModalOpen,
    isRenameSiteModalOpen,
    setIsRenameSiteModalOpen,
    siteToRename,
    setSiteToRename,
    isSiteDropdownOpen,
    setIsSiteDropdownOpen,
    isUploadModalOpen,
    setIsUploadModalOpen,
    isAddSelectionModalOpen,
    setIsAddSelectionModalOpen,
    addSelectionType,
    modalSiteId,
    modalFloorplans,
    modalFloorplanId,
    setModalFloorplanId,
    isRenameModalOpen,
    setIsRenameModalOpen,
    floorplanToRename,
    setFloorplanToRename,
    activeDropdownFpId,
    setActiveDropdownFpId,
    draggedIndex,
    dragOverIndex,
    searchQuery,
    setSearchQuery,
    searchResults,
    setSearchResults,
    isSearchFocused,
    setIsSearchFocused,
    equipFilter,
    setEquipFilter,
    roomFilter,
    setRoomFilter,
    ticketFilter,
    setTicketFilter,
    workOrderFilter,
    setWorkOrderFilter,
    workOrderStatusFilter,
    setWorkOrderStatusFilter,
    workOrderTechFilter,
    setWorkOrderTechFilter,
    isLeftDrawerOpen,
    setIsLeftDrawerOpen,
    isPlusDropdownOpen,
    setIsPlusDropdownOpen,
    isCreateWorkOrderOpen,
    setIsCreateWorkOrderOpen,
    canCreateWorkOrders: auth.canCreateWorkOrders,
    activeView,
    editingEquipId,
    setEditingEquipId,
    editingRoomId,
    setEditingRoomId,
    editForm,
    setEditForm,
    selectedEquipIds,
    setSelectedEquipIds,
    isBulkEditModalOpen,
    setIsBulkEditModalOpen,
    bulkEditForm,
    setBulkEditForm,
    equipSortField,
    equipSortOrder,
    toggleEquipSort,
    ticketSortField,
    ticketSortOrder,
    toggleTicketSort,
    workOrderSortField,
    workOrderSortOrder,
    toggleWorkOrderSort,
    resetWorkOrderFilters,
    workOrderPriorityFilter,
    setWorkOrderPriorityFilter,
    workOrderCategoryFilter,
    setWorkOrderCategoryFilter,
    workOrderSourceFilter,
    setWorkOrderSourceFilter,
    workOrderTradeFilter,
    setWorkOrderTradeFilter,
    workOrderDateFilter,
    setWorkOrderDateFilter,
    workOrderLastUpdated,

    // Handlers
    handleSearchResultClick,
    handleCreateSite,
    handleRenameSite,
    handleDeleteSite,
    handleUploadFloorplan,
    handleDeleteFloorplan,
    handleRenameFloorplan,
    handleDragStart,
    handleDragOver,
    handleDragEnd,
    handleDrop,
    handleNavClick,
    handleModalSiteChange,
    openAddSelectionModal,
    startEditEquip,
    saveEditEquip,
    handleDeleteEquip,
    startEditRoom,
    saveEditRoom,
    handleDeleteRoom,
    handleDeleteTicket,
    goToMap,
    roomLocFilter,
    setRoomLocFilter,
    roomSortField,
    roomSortOrder,
    toggleRoomSort,
    goToPlaceRoom,
    toggleEquipSelection,
    selectAllFilteredEquip,
    handleBulkUpdateEquip,

    // Filtered lists
    filteredEquipment,
    filteredRooms,
    filteredTickets,
    filteredWorkOrders,
    navigate,
    location
  };
}
