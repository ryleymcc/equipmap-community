import { useDashboard } from '../hooks/useDashboard';
import DashboardLeftDrawer from '../components/DashboardLeftDrawer';
import DashboardHeader from '../components/DashboardHeader';
import FloorplanGrid from '../components/FloorplanGrid';
import EquipmentTable from '../components/EquipmentTable';
import RoomTable from '../components/RoomTable';
import TicketTable from '../components/TicketTable';

import DashboardModals from '../components/DashboardModals';


export default function Dashboard() {
  const dashboard = useDashboard();



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
            setFloorplanToReplaceFile={dashboard.setFloorplanToReplaceFile}
            setIsReplaceFileModalOpen={dashboard.setIsReplaceFileModalOpen}
            setFloorplanToRescale={dashboard.setFloorplanToRescale}
            setIsRescaleModalOpen={dashboard.setIsRescaleModalOpen}
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
            isLoading={dashboard.isLoadingTickets}
            isBackgroundSyncing={dashboard.isBackgroundSyncingTickets}
          />
        )}


      </div>

      <DashboardModals
        isRenameModalOpen={dashboard.isRenameModalOpen}
        setIsRenameModalOpen={dashboard.setIsRenameModalOpen}
        floorplanToRename={dashboard.floorplanToRename}
        setFloorplanToRename={dashboard.setFloorplanToRename}
        handleRenameFloorplan={dashboard.handleRenameFloorplan}
        isReplaceFileModalOpen={dashboard.isReplaceFileModalOpen}
        setIsReplaceFileModalOpen={dashboard.setIsReplaceFileModalOpen}
        floorplanToReplaceFile={dashboard.floorplanToReplaceFile}
        setFloorplanToReplaceFile={dashboard.setFloorplanToReplaceFile}
        handleReplaceFloorplanFile={dashboard.handleReplaceFloorplanFile}
        isReplacingFile={dashboard.isReplacingFile}
        isRescaleModalOpen={dashboard.isRescaleModalOpen}
        setIsRescaleModalOpen={dashboard.setIsRescaleModalOpen}
        floorplanToRescale={dashboard.floorplanToRescale}
        setFloorplanToRescale={dashboard.setFloorplanToRescale}
        handleRescaleFloorplan={dashboard.handleRescaleFloorplan}
        isRescaling={dashboard.isRescaling}
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


    </div>
  );
}
