import { memo } from 'react';
import { Menu, Search, X, MapPin, MapPinOff, Circle, Plus, Edit2, AlertCircle } from 'lucide-react';
import { searchClientEntities } from '../searchEngine';

export const MapHeader = memo(function MapHeader({
  onOpenLeftMenu,
  onOpenRightMenu,
  searchQuery,
  setSearchQuery,
  searchResults,
  setSearchResults,
  skipNextSearchRef,
  searchInputRef,
  handleSearchResultClick,
  showSearchResultsList,
  setShowSearchResultsList,
  floorplanId,
  siteFloorplans = [],
  activeActionType,
  onResetActions,
  setSearchParams,
  setHighlightedPin,
  rooms = [],
  equipment = []
}) {
  const handleSearchChange = (e) => {
    if (skipNextSearchRef) skipNextSearchRef.current = false;
    setSearchQuery(e.target.value);
    if (e.target.value === '') {
      setSearchParams({}, { replace: true });
      setHighlightedPin(null);
      setShowSearchResultsList(false);
    }
  };

  const handleSearchFocus = () => {
    setShowSearchResultsList(true);
    if (searchQuery && searchQuery.trim().length > 0 && searchResults.length === 0) {
      if (skipNextSearchRef) skipNextSearchRef.current = false;
      const results = searchClientEntities(searchQuery, { rooms, equipment, siteFloorplans });
      setSearchResults(results);
    }
  };

  const handleSearchKeyDown = (e) => {
    if (e.key === 'Enter' && searchResults.length > 0) {
      handleSearchResultClick(searchResults[0]);
    } else if (e.key === 'Enter') {
      if (searchInputRef.current) searchInputRef.current.blur();
    }
  };

  const handleClearSearch = () => {
    setSearchQuery('');
    setSearchResults([]);
    setShowSearchResultsList(false);
    setHighlightedPin(null);
    setSearchParams({});
  };

  const handleRightTriggerClick = () => {
    onOpenRightMenu();
    if (!activeActionType) {
      if (onResetActions) onResetActions();
    }
  };

  const numericFloorplanId = parseInt(floorplanId, 10);

  return (
    <div className="app-header map-header">
      {/* Left Trigger Button */}
      <button
        className="trigger-btn"
        onClick={onOpenLeftMenu}
        title="Open Menu"
      >
        <Menu size={20} />
      </button>

      {/* Global Search Bar */}
      <div className="header-search-container">
        <div className="search-input-wrapper">
          <div className="search-fade-left" />
          <Search className="search-icon" size={20} />
          <input
            ref={searchInputRef}
            type="text"
            className="search-input"
            placeholder="Search"
            value={searchQuery || ''}
            onChange={handleSearchChange}
            onFocus={handleSearchFocus}
            onKeyDown={handleSearchKeyDown}
            onBlur={() => setTimeout(() => setShowSearchResultsList(false), 150)}
          />
          {searchQuery && searchQuery.length > 0 && (
            <div className="search-clear-wrapper">
              <X
                size={18}
                className="search-clear-btn"
                onClick={handleClearSearch}
              />
            </div>
          )}
        </div>
        {searchResults.length > 0 && showSearchResultsList && (
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
                >
                  {result.type === 'room' ? (
                    isUnlocated ? (
                      <MapPinOff size={18} color="#f59e0b" className="flex-shrink-0" />
                    ) : (
                      <MapPin size={18} color="var(--primary-color)" className="flex-shrink-0" />
                    )
                  ) : result.type === 'ticket' ? (
                    <AlertCircle size={18} color="#f59e0b" className="flex-shrink-0" />
                  ) : (
                    <Circle size={18} color="#10b981" className="flex-shrink-0" />
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
                    <div className="search-item-desc text-xs">
                      {result.floorplan_id !== numericFloorplanId ? (
                        `Floorplan: ${siteFloorplans.find(fp => fp.id === result.floorplan_id)?.name || 'Other'} • `
                      ) : ''}
                      {result.type.toUpperCase()}
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

      {/* Right Trigger Button */}
      <button
        className="trigger-btn"
        onClick={handleRightTriggerClick}
        title={activeActionType ? "Placement Settings" : "Add Item / Actions"}
      >
        {activeActionType ? <Edit2 size={20} /> : <Plus size={20} />}
      </button>
    </div>
  );
});
