import { useState, useMemo, useRef, useEffect, useId, useCallback } from 'react';
import { Search, X, Check, Building, Wrench, User, MapPinOff, ChevronDown, ChevronUp } from 'lucide-react';
import { scoreEntity } from '../searchEngine';
import './EntitySearchSelector.css';

export default function EntitySearchSelector({
  items = [],
  selectedIds = [],
  onToggle,
  onClearAll,
  entityType = 'room', // 'room' | 'equipment' | 'technician'
  placeholder,
  label,
  disabled = false,
  disabledMessage = 'Select a floorplan to load items',
  maxSuggestions = 50
}) {
  const [searchQuery, setSearchQuery] = useState('');
  const [isOpen, setIsOpen] = useState(false);
  const [activeIndex, setActiveIndex] = useState(-1);
  const containerRef = useRef(null);
  const inputRef = useRef(null);
  const inputId = useId();
  const dropdownId = useId();

  const isRoom = entityType === 'room';
  const isTechnician = entityType === 'technician';
  const itemTypeLabel = isRoom ? 'rooms' : isTechnician ? 'technicians' : 'equipment';
  const accentType = isTechnician ? 'technician' : entityType;
  const defaultPlaceholder = isRoom
    ? `Search ${items.length > 0 ? items.length + ' ' : 'all '}rooms (e.g. 101, Exam, Lounge)...`
    : isTechnician
      ? `Search ${items.length > 0 ? items.length + ' ' : 'all '}technicians...`
      : `Search ${items.length > 0 ? items.length + ' ' : 'all '}equipment (e.g. AHU-1, Pump, Chiller)...`;

  const defaultLabel = isRoom ? 'Rooms' : isTechnician ? 'Assignees' : 'Equipment';
  const getItemName = item => item.full_name || item.name || item.username || '';
  const getItemDetails = useCallback(item => isTechnician
    ? [item.trade, item.role === 'editor' ? 'Technician' : item.role].filter(Boolean).join(' • ')
    : [item.description, item.site_name, item.floorplan_name].filter(Boolean).join(' • '), [isTechnician]);
  const ItemIcon = isRoom ? Building : isTechnician ? User : Wrench;

  // Close before focus moves so clicks and taps outside cannot leave a stale panel open.
  useEffect(() => {
    const handlePointerDownOutside = (event) => {
      const container = containerRef.current;
      const eventPath = event.composedPath?.() || [];
      if (container && !container.contains(event.target) && !eventPath.includes(container)) {
        setIsOpen(false);
        setActiveIndex(-1);
      }
    };
    document.addEventListener('pointerdown', handlePointerDownOutside, true);
    return () => document.removeEventListener('pointerdown', handlePointerDownOutside, true);
  }, []);

  // Filter items and keep them in strictly alphabetical order (A–Z) all the time
  const { filteredItems, totalMatches } = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();

    const sortAlphabetical = (list) => {
      return [...list].sort((a, b) => {
        const nameA = (getItemName(a) || '').toLowerCase();
        const nameB = (getItemName(b) || '').toLowerCase();
        return nameA.localeCompare(nameB, undefined, { sensitivity: 'base', numeric: true });
      });
    };

    if (!q) {
      const sorted = sortAlphabetical(items);
      const limit = maxSuggestions || 50;
      return {
        filteredItems: sorted.slice(0, limit),
        totalMatches: sorted.length
      };
    }

    const matched = items.filter(item => {
      const name = (getItemName(item) || '').toLowerCase();
      const details = (getItemDetails(item) || '').toLowerCase();
      return name.includes(q) || details.includes(q) || scoreEntity(q, item) !== null;
    });

    const sortedMatches = sortAlphabetical(matched);
    const limit = maxSuggestions || 50;
    return {
      filteredItems: sortedMatches.slice(0, limit),
      totalMatches: sortedMatches.length
    };
  }, [items, searchQuery, maxSuggestions, getItemDetails]);

  // Selected item objects
  const selectedItems = useMemo(() => {
    const idSet = new Set(selectedIds);
    return items.filter(item => idSet.has(item.id)).sort((a, b) => {
      const nameA = (getItemName(a) || '').toLowerCase();
      const nameB = (getItemName(b) || '').toLowerCase();
      return nameA.localeCompare(nameB, undefined, { sensitivity: 'base', numeric: true });
    });
  }, [items, selectedIds]);

  const hasQuery = searchQuery.trim().length > 0;
  const activeItemIndex = filteredItems.length === 0
    ? -1
    : Math.min(Math.max(activeIndex, 0), filteredItems.length - 1);

  const openSuggestions = () => {
    setIsOpen(true);
    setActiveIndex(currentIndex => currentIndex < 0 ? 0 : currentIndex);
  };

  const clearSearch = () => {
    setSearchQuery('');
    setActiveIndex(0);
    inputRef.current?.focus();
  };

  const handleInputKeyDown = (event) => {
    if (event.key === 'Escape') {
      event.preventDefault();
      setIsOpen(false);
      setActiveIndex(-1);
      return;
    }

    if (event.key === 'ArrowDown' && filteredItems.length > 0) {
      event.preventDefault();
      openSuggestions();
      setActiveIndex(currentIndex => Math.min(Math.max(currentIndex, -1) + 1, filteredItems.length - 1));
      return;
    }

    if (event.key === 'ArrowUp' && filteredItems.length > 0) {
      event.preventDefault();
      openSuggestions();
      setActiveIndex(currentIndex => Math.max(currentIndex - 1, 0));
      return;
    }

    if (event.key === 'Home' && filteredItems.length > 0) {
      event.preventDefault();
      openSuggestions();
      setActiveIndex(0);
      return;
    }

    if (event.key === 'End' && filteredItems.length > 0) {
      event.preventDefault();
      openSuggestions();
      setActiveIndex(filteredItems.length - 1);
      return;
    }

    if (event.key === 'Enter' && filteredItems.length > 0) {
      event.preventDefault();
      event.stopPropagation();
      onToggle(filteredItems[activeItemIndex >= 0 ? activeItemIndex : 0].id);
    }
  };

  if (disabled) {
    return (
      <div className="entity-selector-container entity-selector-disabled">
        <div className="entity-selector-label">
          <ItemIcon size={14} className={isRoom || isTechnician ? 'text-primary' : 'text-success'} />
          <span>{label || defaultLabel}</span>
        </div>
        <div className="entity-selector-disabled-message">
          {disabledMessage}
        </div>
      </div>
    );
  }

  return (
    <div className="entity-selector-container" ref={containerRef}>
      {/* Label Row */}
      <div className="entity-selector-label-row">
        <label htmlFor={inputId} className="entity-selector-label">
          <ItemIcon size={14} className={isRoom || isTechnician ? 'text-primary' : 'text-success'} />
          <span>{label || defaultLabel}</span>
          {selectedIds.length > 0 && (
            <span className={`entity-selector-count ${accentType}`}>
              {selectedIds.length} {isTechnician ? 'assigned' : 'linked'}
            </span>
          )}
        </label>

        {selectedIds.length > 1 && (
          <button
            type="button"
            onClick={() => onClearAll ? onClearAll() : selectedIds.forEach(id => onToggle(id))}
            className="entity-selector-clear-all"
          >
            Clear ({selectedIds.length})
          </button>
        )}
      </div>

      {/* Search Input Box with Focus & Dropdown Trigger */}
      <div className="entity-search-field">
        <div className="search-box">
          <Search size={16} className="search-icon" />
          <input
            ref={inputRef}
            id={inputId}
            type="text"
            className="search-input"
            placeholder={placeholder || defaultPlaceholder}
            value={searchQuery}
            role="combobox"
            aria-autocomplete="list"
            aria-expanded={isOpen}
            aria-controls={dropdownId}
            aria-activedescendant={isOpen && activeItemIndex >= 0 ? `${dropdownId}-option-${filteredItems[activeItemIndex].id}` : undefined}
            onChange={e => {
              setSearchQuery(e.target.value);
              setIsOpen(true);
              setActiveIndex(0);
            }}
            onFocus={openSuggestions}
            onClick={openSuggestions}
            onKeyDown={handleInputKeyDown}
          />
          <div className="entity-search-actions">
            {hasQuery && (
              <button
                type="button"
                onClick={clearSearch}
                className="entity-search-clear"
                aria-label="Clear search"
                title="Clear search"
              >
                <X size={12} />
              </button>
            )}
            <button
              type="button"
              onClick={() => {
                if (isOpen) {
                  setIsOpen(false);
                  setActiveIndex(-1);
                  return;
                }
                openSuggestions();
                inputRef.current?.focus();
              }}
              className="entity-search-toggle"
              aria-label={`${isOpen ? 'Close' : 'Open'} ${itemTypeLabel} suggestions`}
              aria-expanded={isOpen}
              aria-controls={dropdownId}
              title={`${isOpen ? 'Close' : 'Open'} suggestions`}
            >
              {isOpen ? <ChevronUp size={16} /> : <ChevronDown size={16} />}
            </button>
          </div>
        </div>

        {/* Floating Search Results Dropdown */}
        {isOpen && (
          <div id={dropdownId} className="entity-dropdown-panel" role="listbox" aria-label={`${itemTypeLabel} suggestions`}>
            {/* Header info / count */}
            <div className="entity-dropdown-header">
              <span>
                {hasQuery ? (
                  totalMatches > filteredItems.length
                    ? `Showing top ${filteredItems.length} of ${totalMatches} matches for "${searchQuery}"`
                    : `${totalMatches} match${totalMatches === 1 ? '' : 'es'} for "${searchQuery}"`
                ) : (
                  `All ${itemTypeLabel} (${items.length}) • Alphabetical`
                )}
              </span>
              <span className="entity-dropdown-status">{hasQuery ? 'Live filter' : 'Select'}</span>
            </div>

            {/* List */}
            <div className="entity-dropdown-list">
              {items.length === 0 ? (
                <div className="entity-dropdown-empty">
                  No {itemTypeLabel} are available here.
                </div>
              ) : filteredItems.length === 0 ? (
                <div className="entity-dropdown-empty">
                  <span>No {itemTypeLabel} match “{searchQuery}”.</span>
                  <button type="button" className="entity-dropdown-empty-action" onClick={clearSearch}>
                    Clear search
                  </button>
                </div>
              ) : (
                filteredItems.map((item, index) => {
                  const isSelected = selectedIds.includes(item.id);
                  const locationLabel = getItemDetails(item);
                  const isUnlocated = isRoom && (item.x_coordinate == null || item.y_coordinate == null);

                  return (
                    <button
                      key={item.id}
                      id={`${dropdownId}-option-${item.id}`}
                      type="button"
                      role="option"
                      aria-selected={isSelected}
                      aria-label={`${isSelected ? 'Remove' : 'Add'} ${isRoom ? `room ${getItemName(item)}` : getItemName(item)}`}
                      onClick={() => onToggle(item.id)}
                      onMouseEnter={() => setActiveIndex(index)}
                      className={`entity-item-row ${isSelected ? `selected ${accentType}` : ''} ${activeItemIndex === index ? 'is-active' : ''}`}
                    >
                      <span className="entity-item-main">
                        <span className={`entity-check-box ${isSelected ? `checked ${accentType}` : ''}`}>
                          {isSelected && <Check size={10} />}
                        </span>
                        <span className="entity-item-name">
                          {isRoom ? `Room ${getItemName(item)}` : getItemName(item)}
                        </span>
                        {isUnlocated && (
                          <span className="entity-item-unlocated">
                            <MapPinOff size={10} />
                            <span>Not Located</span>
                          </span>
                        )}
                        {locationLabel && (
                          <span className="entity-item-meta">
                            • {locationLabel}
                          </span>
                        )}
                      </span>

                      <span className={`entity-item-state ${isSelected ? `is-selected ${accentType}` : ''}`}>
                        {isSelected ? (isTechnician ? 'Assigned' : 'Linked') : 'Add'}
                      </span>
                    </button>
                  );
                })
              )}
            </div>
          </div>
        )}
      </div>

      {/* Keep selections below the active control so the search box never moves. */}
      {selectedItems.length > 0 && (
        <div className="entity-selected-items">
          {selectedItems.map(item => {
            const isUnlocated = isRoom && (item.x_coordinate == null || item.y_coordinate == null);
            return (
              <span key={item.id} className={`entity-chip ${accentType}`}>
                <span>{isRoom ? `Room ${getItemName(item)}` : getItemName(item)}</span>
                {isUnlocated && (
                  <span className="entity-chip-unlocated">
                    <MapPinOff size={9} />
                    <span>Not Located</span>
                  </span>
                )}
                {getItemDetails(item) && (
                  <span className="entity-chip-detail">
                    ({getItemDetails(item)})
                  </span>
                )}
                <button
                  type="button"
                  onClick={() => onToggle(item.id)}
                  className="entity-chip-remove"
                  aria-label={`Remove ${isRoom ? `room ${getItemName(item)}` : getItemName(item)}`}
                  title="Remove"
                >
                  <X size={12} />
                </button>
              </span>
            );
          })}
        </div>
      )}
    </div>
  );
}
