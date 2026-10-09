import { useState } from 'react';
import { ShieldAlert } from 'lucide-react';
import { useDashboard } from '../hooks/useDashboard';
import DashboardLeftDrawer from '../components/DashboardLeftDrawer';
import DashboardHeader from '../components/DashboardHeader';
import FloorplanGrid from '../components/FloorplanGrid';
import EquipmentTable from '../components/EquipmentTable';
import RoomTable from '../components/RoomTable';
import TicketTable from '../components/TicketTable';
import WorkOrderTable from '../components/WorkOrderTable';
import WorkOrderCreateModal from '../components/WorkOrderCreateModal';
import TaskSelectModal from '../components/TaskSelectModal';
import TaskCreateModal from '../components/TaskCreateModal';
import DashboardModals from '../components/DashboardModals';
import WorkOrderHistoryModal from '../components/WorkOrderHistoryModal';
import PMSchedulerModal from '../components/PMSchedulerModal';

export default function Dashboard() {
  const dashboard = useDashboard();
  const [historyModalItem, setHistoryModalItem] = useState(null);
  const [historyModalType, setHistoryModalType] = useState('equipment');
  const [isTaskSelectOpen, setIsTaskSelectOpen] = useState(false);
  const [isCreateTaskModalOpen, setIsCreateTaskModalOpen] = useState(false);
  const [taskForWorkOrder, setTaskForWorkOrder] = useState(null);
  const [isPMSchedulerOpen, setIsPMSchedulerOpen] = useState(false);
  const [pmStudioSearch, setPmStudioSearch] = useState('');
  const [pmStudioItem, setPmStudioItem] = useState(null);
  const [pmStudioItemType, setPmStudioItemType] = useState('equipment');

  const handleOpenPMSchedules = (item, type = 'equipment') => {
    setPmStudioSearch(item?.name || '');
    setPmStudioItem(item || null);
    setPmStudioItemType(type || 'equipment');
    setIsPMSchedulerOpen(true);
  };

  return (
    <div className="app-layout">
      <DashboardLeftDrawer
        isOpen={dashboard.isLeftDrawerOpen}
        onClose={() => dashboard.setIsLeftDrawerOpen(false)}
        activeView={dashboard.activeView}
        handleNavClick={dashboard.handleNavClick}
        user={dashboard.user}
        logout={dashboard.logout}
        isAdmin={dashboard.isAdmin}
        navigate={dashboard.navigate}
        location={dashboard.location}
        activeSite={dashboard.activeSite}
      />

      <div className="main-content">
        <DashboardHeader
          activeView={dashboard.activeView}
          searchQuery={dashboard.searchQuery}
          setSearchQuery={dashboard.setSearchQuery}
          searchResults={dashboard.searchResults}
          setSearchResults={dashboard.setSearchResults}
          isSearchFocused={dashboard.isSearchFocused}
          setIsSearchFocused={dashboard.setIsSearchFocused}
          equipFilter={dashboard.equipFilter}
          setEquipFilter={dashboard.setEquipFilter}
          roomFilter={dashboard.roomFilter}
          setRoomFilter={dashboard.setRoomFilter}
          ticketFilter={dashboard.ticketFilter}
          setTicketFilter={dashboard.setTicketFilter}
          handleSearchResultClick={dashboard.handleSearchResultClick}
          isEditor={dashboard.isEditor}
          isPlusDropdownOpen={dashboard.isPlusDropdownOpen}
          setIsPlusDropdownOpen={dashboard.setIsPlusDropdownOpen}
          setIsLeftDrawerOpen={dashboard.setIsLeftDrawerOpen}
          setIsSiteModalOpen={dashboard.setIsSiteModalOpen}
          setIsUploadModalOpen={dashboard.setIsUploadModalOpen}
          activeSite={dashboard.activeSite}
          openAddSelectionModal={dashboard.openAddSelectionModal}
          openCreateWorkOrder={() => {
            setTaskForWorkOrder(null);
            dashboard.setIsCreateWorkOrderOpen(true);
          }}
          openCreateFromTask={() => setIsTaskSelectOpen(true)}
          openCreateTask={() => setIsCreateTaskModalOpen(true)}
          canCreateWorkOrders={dashboard.canCreateWorkOrders}
          user={dashboard.user}
        />

        {dashboard.activeView === 'floorplans' && (
          <FloorplanGrid
            activeSite={dashboard.activeSite}
            setActiveSite={dashboard.setActiveSite}
            sites={dashboard.sites}
            floorplans={dashboard.floorplans}
            isLoading={dashboard.isLoadingFloorplans || dashboard.isLoadingSites}
            isBackgroundSyncing={dashboard.isBackgroundSyncingFloorplans}
            draggedIndex={dashboard.draggedIndex}
            dragOverIndex={dashboard.dragOverIndex}
            handleDragStart={dashboard.handleDragStart}
            handleDragOver={dashboard.handleDragOver}
            handleDragEnd={dashboard.handleDragEnd}
            handleDrop={dashboard.handleDrop}
            navigate={dashboard.navigate}
            activeDropdownFpId={dashboard.activeDropdownFpId}
            setActiveDropdownFpId={dashboard.setActiveDropdownFpId}
            setFloorplanToRename={dashboard.setFloorplanToRename}
            setIsRenameModalOpen={dashboard.setIsRenameModalOpen}
            handleDeleteFloorplan={dashboard.handleDeleteFloorplan}
            setIsUploadModalOpen={dashboard.setIsUploadModalOpen}
            isEditor={dashboard.isEditor}
            isSiteDropdownOpen={dashboard.isSiteDropdownOpen}
            setIsSiteDropdownOpen={dashboard.setIsSiteDropdownOpen}
            setSiteToRename={dashboard.setSiteToRename}
            setIsRenameSiteModalOpen={dashboard.setIsRenameSiteModalOpen}
            handleDeleteSite={dashboard.handleDeleteSite}
          />
        )}

        {dashboard.activeView === 'equipment' && (
          <EquipmentTable
            allEquipment={dashboard.allEquipment}
            filteredEquipment={dashboard.filteredEquipment}
            isLoading={dashboard.isLoadingEquipment}
            isBackgroundSyncing={dashboard.isBackgroundSyncingEquipment}
            editingEquipId={dashboard.editingEquipId}
            setEditingEquipId={dashboard.setEditingEquipId}
            editForm={dashboard.editForm}
            setEditForm={dashboard.setEditForm}
            isEditor={dashboard.isEditor}
            startEditEquip={dashboard.startEditEquip}
            saveEditEquip={dashboard.saveEditEquip}
            handleDeleteEquip={dashboard.handleDeleteEquip}
            goToMap={dashboard.goToMap}
            equipSortField={dashboard.equipSortField}
            equipSortOrder={dashboard.equipSortOrder}
            toggleEquipSort={dashboard.toggleEquipSort}
            selectedEquipIds={dashboard.selectedEquipIds}
            toggleEquipSelection={dashboard.toggleEquipSelection}
            selectAllFilteredEquip={dashboard.selectAllFilteredEquip}
            setIsBulkEditModalOpen={dashboard.setIsBulkEditModalOpen}
            onViewWorkOrders={(item, type) => {
              setHistoryModalItem(item);
              setHistoryModalType(type || 'equipment');
            }}
            onOpenPMSchedules={(item, type) => handleOpenPMSchedules(item, type || 'equipment')}
          />
        )}

        {dashboard.activeView === 'rooms' && (
          <RoomTable
            allRooms={dashboard.allRooms}
            filteredRooms={dashboard.filteredRooms}
            isLoading={dashboard.isLoadingRooms}
            isBackgroundSyncing={dashboard.isBackgroundSyncingRooms}
            editingRoomId={dashboard.editingRoomId}
            setEditingRoomId={dashboard.setEditingRoomId}
            editForm={dashboard.editForm}
            setEditForm={dashboard.setEditForm}
            isEditor={dashboard.isEditor}
            startEditRoom={dashboard.startEditRoom}
            saveEditRoom={dashboard.saveEditRoom}
            handleDeleteRoom={dashboard.handleDeleteRoom}
            goToMap={dashboard.goToMap}
            goToPlaceRoom={dashboard.goToPlaceRoom}
            roomLocFilter={dashboard.roomLocFilter}
            setRoomLocFilter={dashboard.setRoomLocFilter}
            roomSortField={dashboard.roomSortField}
            roomSortOrder={dashboard.roomSortOrder}
            toggleRoomSort={dashboard.toggleRoomSort}
            onViewWorkOrders={(item, type) => {
              setHistoryModalItem(item);
              setHistoryModalType(type || 'room');
            }}
            onOpenPMSchedules={(item, type) => handleOpenPMSchedules(item, type || 'room')}
          />
        )}

        {dashboard.activeView === 'tickets' && (
          <TicketTable
            allTickets={dashboard.allTickets}
            filteredTickets={dashboard.filteredTickets}
            isEditor={dashboard.isEditor}
            handleDeleteTicket={dashboard.handleDeleteTicket}
            goToMap={dashboard.goToMap}
            ticketSortField={dashboard.ticketSortField}
            ticketSortOrder={dashboard.ticketSortOrder}
            toggleTicketSort={dashboard.toggleTicketSort}
            user={dashboard.user}
          />
        )}

        {dashboard.activeView === 'workorders' && (
          (dashboard.user || dashboard.isAuthLoading) ? (
            <WorkOrderTable
              allWorkOrders={dashboard.allWorkOrders}
              filteredWorkOrders={dashboard.filteredWorkOrders}
              isLoading={dashboard.isLoadingWorkOrders || dashboard.isAuthLoading}
              error={dashboard.workOrderError}
              workOrderSummary={dashboard.workOrderSummary}
              loadWorkOrders={dashboard.loadWorkOrders}
              currentUser={dashboard.user}
              searchQuery={dashboard.workOrderFilter}
              setSearchQuery={dashboard.setWorkOrderFilter}
              statusFilter={dashboard.workOrderStatusFilter}
              setStatusFilter={dashboard.setWorkOrderStatusFilter}
              priorityFilter={dashboard.workOrderPriorityFilter}
              setPriorityFilter={dashboard.setWorkOrderPriorityFilter}
              categoryFilter={dashboard.workOrderCategoryFilter}
              setCategoryFilter={dashboard.setWorkOrderCategoryFilter}
              sourceFilter={dashboard.workOrderSourceFilter}
              setSourceFilter={dashboard.setWorkOrderSourceFilter}
              tradeFilter={dashboard.workOrderTradeFilter}
              setTradeFilter={dashboard.setWorkOrderTradeFilter}
              techFilter={dashboard.workOrderTechFilter}
              setTechFilter={dashboard.setWorkOrderTechFilter}
              dateFilter={dashboard.workOrderDateFilter}
              setDateFilter={dashboard.setWorkOrderDateFilter}
              lastUpdatedTime={dashboard.workOrderLastUpdated}
              sortField={dashboard.workOrderSortField}
              sortOrder={dashboard.workOrderSortOrder}
              toggleSort={dashboard.toggleWorkOrderSort}
              resetFilters={dashboard.resetWorkOrderFilters}
              goToMap={dashboard.goToMap}
            />
          ) : (
            <div className="list-view-container">
              <div className="glass-panel p-2xl text-center" style={{ maxWidth: '440px', margin: '4rem auto', borderRadius: '12px' }}>
                <ShieldAlert size={44} color="#f59e0b" style={{ margin: '0 auto 1rem auto' }} />
                <h2 className="text-lg font-bold mb-xs text-foreground">Sign In Required</h2>
                <p className="text-muted text-xs mb-lg" style={{ lineHeight: 1.5 }}>
                  You must be signed in with an authorized technician or staff account to view maintenance work orders.
                </p>
                <button
                  type="button"
                  onClick={() => dashboard.navigate('/login', {
                    state: {
                      from: {
                        pathname: dashboard.location.pathname,
                        search: dashboard.location.search,
                        hash: dashboard.location.hash
                      }
                    }
                  })}
                  className="btn btn-primary btn-md inline-flex items-center gap-xs"
                >
                  Sign In to Continue
                </button>
              </div>
            </div>
          )
        )}
      </div>

      <DashboardModals
        isRenameModalOpen={dashboard.isRenameModalOpen}
        setIsRenameModalOpen={dashboard.setIsRenameModalOpen}
        floorplanToRename={dashboard.floorplanToRename}
        setFloorplanToRename={dashboard.setFloorplanToRename}
        handleRenameFloorplan={dashboard.handleRenameFloorplan}
        isSiteModalOpen={dashboard.isSiteModalOpen}
        setIsSiteModalOpen={dashboard.setIsSiteModalOpen}
        handleCreateSite={dashboard.handleCreateSite}
        isRenameSiteModalOpen={dashboard.isRenameSiteModalOpen}
        setIsRenameSiteModalOpen={dashboard.setIsRenameSiteModalOpen}
        siteToRename={dashboard.siteToRename}
        setSiteToRename={dashboard.setSiteToRename}
        handleRenameSite={dashboard.handleRenameSite}
        isUploadModalOpen={dashboard.isUploadModalOpen}
        setIsUploadModalOpen={dashboard.setIsUploadModalOpen}
        handleUploadFloorplan={dashboard.handleUploadFloorplan}
        isAddSelectionModalOpen={dashboard.isAddSelectionModalOpen}
        setIsAddSelectionModalOpen={dashboard.setIsAddSelectionModalOpen}
        addSelectionType={dashboard.addSelectionType}
        modalSiteId={dashboard.modalSiteId}
        modalFloorplans={dashboard.modalFloorplans}
        modalFloorplanId={dashboard.modalFloorplanId}
        handleModalSiteChange={dashboard.handleModalSiteChange}
        setModalFloorplanId={dashboard.setModalFloorplanId}
        sites={dashboard.sites}
        navigate={dashboard.navigate}
        isBulkEditModalOpen={dashboard.isBulkEditModalOpen}
        setIsBulkEditModalOpen={dashboard.setIsBulkEditModalOpen}
        bulkEditForm={dashboard.bulkEditForm}
        setBulkEditForm={dashboard.setBulkEditForm}
        handleBulkUpdateEquip={dashboard.handleBulkUpdateEquip}
        selectedCount={dashboard.selectedEquipIds.length}
      />

      <WorkOrderHistoryModal
        isOpen={!!historyModalItem}
        onClose={() => setHistoryModalItem(null)}
        item={historyModalItem}
        itemType={historyModalType}
        goToMap={dashboard.goToMap}
        onWorkOrderClosed={() => {
          if (dashboard.loadWorkOrders) dashboard.loadWorkOrders(true);
        }}
      />

      {isTaskSelectOpen && (
        <TaskSelectModal
          isOpen={isTaskSelectOpen}
          onClose={() => setIsTaskSelectOpen(false)}
          onSelectTask={(task) => {
            setTaskForWorkOrder(task);
            dashboard.setIsCreateWorkOrderOpen(true);
          }}
          title="Create Work Order from Task"
          subtitle="Select a standard task sheet to populate work order instructions, checklists, and estimates."
          actionButtonLabel="Create Work Order"
        />
      )}

      {dashboard.isCreateWorkOrderOpen && (
        <WorkOrderCreateModal
          isOpen={dashboard.isCreateWorkOrderOpen}
          onClose={() => {
            dashboard.setIsCreateWorkOrderOpen(false);
            setTaskForWorkOrder(null);
          }}
          initialTask={taskForWorkOrder}
          currentUser={dashboard.user}
          onCreated={() => {
            if (dashboard.loadWorkOrders) dashboard.loadWorkOrders(true);
            setTaskForWorkOrder(null);
          }}
        />
      )}

      {isCreateTaskModalOpen && (
        <TaskCreateModal
          isOpen={isCreateTaskModalOpen}
          onClose={() => setIsCreateTaskModalOpen(false)}
          onTaskCreated={(newTask) => {
            setTaskForWorkOrder(newTask);
            dashboard.setIsCreateWorkOrderOpen(true);
          }}
        />
      )}

      {isPMSchedulerOpen && (
        <PMSchedulerModal
          isOpen={isPMSchedulerOpen}
          onClose={() => {
            setIsPMSchedulerOpen(false);
            setPmStudioSearch('');
            setPmStudioItem(null);
          }}
          currentUser={dashboard.user}
          initialSearch={pmStudioSearch}
          initialItem={pmStudioItem}
          initialItemType={pmStudioItemType}
          onWorkOrderGenerated={() => {
            if (dashboard.loadWorkOrders) dashboard.loadWorkOrders(true);
          }}
        />
      )}
    </div>
  );
}
