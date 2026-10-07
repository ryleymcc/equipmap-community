import {
  Menu, Search, X, MapPin, MapPinOff, Circle, Plus,
  Building, Upload, DoorOpen, Package, AlertCircle
} from 'lucide-react';

export default function DashboardHeader({
  activeView,
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


  handleSearchResultClick,
  isEditor,
  isPlusDropdownOpen,
  setIsPlusDropdownOpen,
  setIsLeftDrawerOpen,
  setIsSiteModalOpen,
  setIsUploadModalOpen,
  activeSite,
  openAddSelectionModal
}) {
  const currentFilterValue =
    activeView === 'floorplans' ? searchQuery :
    activeView === 'equipment' ? equipFilter :
    activeView === 'rooms' ? roomFilter :
    activeView === 'tickets' ? ticketFilter :
    '';

  const handleClearInput = () => {
    if (activeView === 'floorplans') {
      setSearchQuery('');
      setSearchResults([]);
    } else if (activeView === 'equipment') {
      setEquipFilter('');
    } else if (activeView === 'rooms') {
      setRoomFilter('');
    } else if (activeView === 'tickets') {
      setTicketFilter('');
    }
  };

  return (
    <header className="app-header dashboard-header">
      <button
        className="trigger-btn"
        onClick={() => setIsLeftDrawerOpen(true)}
        title="Open Menu"
      >
        <Menu size={20} />
      </button>

      {/* Center Search Input */}
      <div className="header-search-container">
        <div className="search-input-wrapper">
          <div className="search-fade-left" />
          <Search className="search-icon" size={20} />
          {activeView === 'floorplans' && (
            <input
              type="text"
              className="search-input"
              placeholder="Search"
              value={searchQuery || ''}
              onChange={e => setSearchQuery(e.target.value)}
              onFocus={() => setIsSearchFocused(true)}
              onBlur={() => setTimeout(() => setIsSearchFocused(false), 200)}
            />
          )}
          {activeView === 'equipment' && (
            <input
              type="text"
              className="search-input"
              placeholder="Filter equipment by name, desc, site, floorplan..."
              value={equipFilter || ''}
              onChange={e => setEquipFilter(e.target.value)}
            />
          )}
          {activeView === 'rooms' && (
            <input
              type="text"
              className="search-input"
              placeholder="Filter rooms by name, desc, site, floorplan..."
              value={roomFilter || ''}
              onChange={e => setRoomFilter(e.target.value)}
            />
          )}
          {activeView === 'tickets' && (
            <input
              type="text"
              className="search-input"
              placeholder="Filter issues by title, desc, site, floorplan, user..."
              value={ticketFilter || ''}
              onChange={e => setTicketFilter(e.target.value)}
            />
          )}


          {currentFilterValue && currentFilterValue.length > 0 && (
            <div className="search-clear-wrapper">
              <X
                size={18}
                className="search-clear-btn"
                onClick={handleClearInput}
              />
            </div>
          )}

          {activeView === 'floorplans' && isSearchFocused && searchResults.length > 0 && (
            <div className="search-results glass-panel search-dropdown">
              {searchResults.map(result => {
                const isUnlocated = (result.type === 'room' || result.type === 'equipment') && (result.x_coordinate == null || result.y_coordinate == null);
                return (
                  <div
                    key={`${result.type}-${result.id}`}
                    className="search-item"
                    onMouseDown={(e) => {
                      e.preventDefault();
                      handleSearchResultClick(result);
                    }}
                    onClick={() => handleSearchResultClick(result)}
                  >
                    {result.type === 'room' ? (
                      isUnlocated ? (
                        <MapPinOff size={18} color="#f59e0b" className="flex-shrink-0" />
                      ) : (
                        <MapPin size={18} color="var(--primary-color)" className="flex-shrink-0" />
                      )
                    ) : result.type === 'ticket' ? (
                      <AlertCircle size={18} color="#f59e0b" />
                    ) : (
                      <Circle size={18} color="#10b981" />
                    )}
                    <div className="flex-1 min-w-0">
                      <div className="search-item-title flex items-center gap-xs">
                        <span className="truncate">{result.name || result.title}</span>
                        {isUnlocated && (
                          <span className="status-badge badge-warning text-3xs shrink-0" style={{ fontSize: '0.65rem', padding: '0.1rem 0.4rem', lineHeight: 1 }}>
                            <MapPinOff size={10} />
                            <span>Not Located</span>
                          </span>
                        )}
                      </div>
                      <div className="search-item-desc">
                        Floorplan ID: {result.floorplan_id} • {result.type.toUpperCase()}
                        {isUnlocated ? ' • Not Located' : ''}
                        {result.description ? ` • ${result.description}` : ' • No description'}
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>

      {/* Right Actions Dropdown */}
      <div className="dashboard-actions">
        {isEditor && (
          <div className="dropdown-container">
            <button
              className="trigger-btn"
              onClick={() => setIsPlusDropdownOpen(!isPlusDropdownOpen)}
              title="Add Site or Floorplan"
            >
              <Plus size={20} />
            </button>
            {isPlusDropdownOpen && (
              <>
                <div
                  className="dropdown-backdrop"
                  onClick={() => setIsPlusDropdownOpen(false)}
                />
                <div className="dropdown-menu">
                  {activeView === 'floorplans' && (
                    <>
                      <button
                        className="dropdown-item"
                        onClick={() => { setIsPlusDropdownOpen(false); setIsSiteModalOpen(true); }}
                      >
                        <Building size={16} />
                        <span>Add Site</span>
                      </button>
                      <button
                        className="dropdown-item"
                        onClick={() => { setIsPlusDropdownOpen(false); setIsUploadModalOpen(true); }}
                        disabled={!activeSite}
                        title={!activeSite ? "Select a site first" : ""}
                      >
                        <Upload size={16} />
                        <span>Upload Floorplan</span>
                      </button>
                    </>
                  )}

                  {activeView === 'rooms' && (
                    <button
                      className="dropdown-item"
                      onClick={() => { setIsPlusDropdownOpen(false); openAddSelectionModal('room'); }}
                    >
                      <DoorOpen size={16} />
                      <span>Add Room</span>
                    </button>
                  )}

                  {activeView === 'equipment' && (
                    <button
                      className="dropdown-item"
                      onClick={() => { setIsPlusDropdownOpen(false); openAddSelectionModal('equipment'); }}
                    >
                      <Package size={16} />
                      <span>Add Equipment</span>
                    </button>
                  )}
                </div>
              </>
            )}
          </div>
        )}
      </div>
    </header>
  );
}
