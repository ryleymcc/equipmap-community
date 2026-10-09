import { useState, useMemo } from 'react';
import {
  DoorOpen, Map as MapIcon, Building,
  Check, X, Pencil, ExternalLink, Trash2,
  MapPin, MapPinOff, ArrowUpDown, ArrowUp, ArrowDown,
  ClipboardList, Calendar, RefreshCw,
  ChevronsLeft, ChevronsRight, ChevronLeft, ChevronRight
} from 'lucide-react';
import RoomCard from './RoomCard';

export default function RoomTable({
  allRooms,
  filteredRooms,
  isLoading = false,
  isBackgroundSyncing = false,
  editingRoomId,
  setEditingRoomId,
  editForm,
  setEditForm,
  isEditor,
  startEditRoom,
  saveEditRoom,
  handleDeleteRoom,
  goToMap,
  goToPlaceRoom,
  roomLocFilter = 'all',
  setRoomLocFilter,
  roomSortField = 'name',
  roomSortOrder = 'asc',
  toggleRoomSort,
  onViewWorkOrders,
  onOpenPMSchedules
}) {
  const [currentPage, setCurrentPage] = useState(1);
  const [pageSize, setPageSize] = useState(50);
  const [prevFilteredLength, setPrevFilteredLength] = useState(filteredRooms.length);

  // Reset to page 1 when filtered items change
  if (prevFilteredLength !== filteredRooms.length) {
    setPrevFilteredLength(filteredRooms.length);
    setCurrentPage(1);
  }

  const totalPages = pageSize === 'all' ? 1 : Math.ceil(filteredRooms.length / pageSize) || 1;
  const validCurrentPage = Math.min(Math.max(1, currentPage), totalPages);

  const paginatedRooms = useMemo(() => {
    if (pageSize === 'all') return filteredRooms;
    const start = (validCurrentPage - 1) * pageSize;
    return filteredRooms.slice(start, start + pageSize);
  }, [filteredRooms, validCurrentPage, pageSize]);

  const locatedCount = allRooms.filter(r => r.x_coordinate != null && r.y_coordinate != null).length;
  const unlocatedCount = allRooms.filter(r => r.x_coordinate == null || r.y_coordinate == null).length;

  const renderSortIcon = (field) => {
    if (!toggleRoomSort) return null;
    if (roomSortField !== field) return <ArrowUpDown size={14} style={{ opacity: 0.4, marginLeft: '4px' }} />;
    return roomSortOrder === 'asc'
      ? <ArrowUp size={14} style={{ color: '#3b82f6', marginLeft: '4px' }} />
      : <ArrowDown size={14} style={{ color: '#3b82f6', marginLeft: '4px' }} />;
  };

  return (
    <div className="list-view-container">
      {/* Header and Filter Pills */}
      <div className="flex-between items-center flex-wrap gap-md mb-xl">
        <div className="items-center gap-md">
          <DoorOpen size={24} color="#3b82f6" />
          <h2 className="text-lg font-semibold m-0 items-center gap-sm">
            Rooms
            {isLoading && allRooms.length === 0 ? (
              <span className="skeleton" style={{ width: '48px', height: '22px', borderRadius: '6px' }} />
            ) : (
              <span className="text-sm font-normal text-muted">
                ({allRooms.length})
              </span>
            )}
            {isBackgroundSyncing && (
              <span className="sync-badge" title="Refreshing in background">
                <RefreshCw size={11} className="spinning" />
                <span>Syncing</span>
              </span>
            )}
          </h2>
        </div>

        {/* Location Filter Pills */}
        {isLoading && allRooms.length === 0 ? (
          <div className="flex-row gap-xs">
            <div className="skeleton skeleton-pill" style={{ width: '55px', height: '28px' }} />
            <div className="skeleton skeleton-pill" style={{ width: '75px', height: '28px' }} />
            <div className="skeleton skeleton-pill" style={{ width: '85px', height: '28px' }} />
          </div>
        ) : (
          <div className="filter-pills-bar">
            <button
              type="button"
              className={`btn-pill-filter btn-card-action ${roomLocFilter === 'all' ? 'active' : ''}`}
              onClick={() => setRoomLocFilter && setRoomLocFilter('all')}
            >
              All ({allRooms.length})
            </button>

            <button
              type="button"
              className={`btn-pill-filter btn-card-action ${roomLocFilter === 'located' ? 'active' : ''}`}
              onClick={() => setRoomLocFilter && setRoomLocFilter('located')}
            >
              <MapPin size={12} className="flex-shrink-0" />
              <span>Located ({locatedCount})</span>
            </button>

            <button
              type="button"
              className={`btn-pill-filter btn-card-action unlocated ${roomLocFilter === 'unlocated' ? 'active' : ''}`}
              onClick={() => setRoomLocFilter && setRoomLocFilter('unlocated')}
            >
              <MapPinOff size={12} className="flex-shrink-0" />
              <span>Unlocated ({unlocatedCount})</span>
            </button>
          </div>
        )}
      </div>

      {/* Desktop Table View */}
      <div className="table-desktop-view">
        <div className="list-table-wrapper">
          <table className="list-table">
            <thead>
              <tr>
                <th
                  className="sortable-header pointer"
                  onClick={() => toggleRoomSort && toggleRoomSort('name')}
                >
                  <div className="items-center">
                    Name {renderSortIcon('name')}
                  </div>
                </th>
                <th
                  className="sortable-header pointer"
                  onClick={() => toggleRoomSort && toggleRoomSort('description')}
                >
                  <div className="items-center">
                    Description {renderSortIcon('description')}
                  </div>
                </th>
                <th
                  className="sortable-header pointer"
                  onClick={() => toggleRoomSort && toggleRoomSort('floorplan_name')}
                >
                  <div className="items-center">
                    Floorplan {renderSortIcon('floorplan_name')}
                  </div>
                </th>
                <th
                  className="sortable-header pointer"
                  onClick={() => toggleRoomSort && toggleRoomSort('site_name')}
                >
                  <div className="items-center">
                    Site {renderSortIcon('site_name')}
                  </div>
                </th>
                <th>Status</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {isLoading && allRooms.length === 0 ? (
                [1, 2, 3, 4, 5, 6, 7, 8].map((rowKey) => (
                  <tr key={rowKey}>
                    <td>
                      <div className="skeleton skeleton-text" style={{ width: `${50 + (rowKey % 4) * 12}%`, height: '16px' }} />
                    </td>
                    <td>
                      <div className="skeleton skeleton-text" style={{ width: `${40 + (rowKey % 3) * 20}%`, height: '14px' }} />
                    </td>
                    <td>
                      <div className="skeleton skeleton-text" style={{ width: '85px', height: '14px' }} />
                    </td>
                    <td>
                      <div className="skeleton skeleton-text" style={{ width: '70px', height: '14px' }} />
                    </td>
                    <td>
                      <div className="skeleton skeleton-pill" style={{ width: '76px', height: '24px' }} />
                    </td>
                    <td>
                      <div className="flex-row gap-xs">
                        <div className="skeleton" style={{ width: '26px', height: '26px', borderRadius: '6px' }} />
                        <div className="skeleton" style={{ width: '26px', height: '26px', borderRadius: '6px' }} />
                      </div>
                    </td>
                  </tr>
                ))
              ) : filteredRooms.length === 0 ? (
                <tr>
                  <td colSpan={6}>
                    <div className="list-empty p-2xl text-center">
                      <DoorOpen size={48} className="list-empty-icon opacity-40 m-auto mb-sm" />
                      <p className="text-muted m-0">No rooms match the current filter</p>
                    </div>
                  </td>
                </tr>
              ) : (
                paginatedRooms.map(room => {
                  const isEditing = editingRoomId === room.id;
                  const isUnlocated = room.x_coordinate == null || room.y_coordinate == null;

                  return (
                    <tr key={room.id} className={`${isEditing ? 'editing-row' : ''} ${isUnlocated ? 'unlocated-row' : ''}`}>
                      <td className="font-medium">
                        {isEditing ? (
                          <input
                            className="inline-edit-input"
                            value={editForm.name}
                            onChange={e => setEditForm({ ...editForm, name: e.target.value })}
                            autoFocus
                          />
                        ) : room.name}
                      </td>
                      <td>
                        {isEditing ? (
                          <input
                            className="inline-edit-input"
                            value={editForm.description}
                            onChange={e => setEditForm({ ...editForm, description: e.target.value })}
                          />
                        ) : (room.description || '—')}
                      </td>
                      <td>
                        <span className="floorplan-tag">
                          <MapIcon size={12} /> {room.floorplan_name || `Floorplan #${room.floorplan_id}`}
                        </span>
                      </td>
                      <td>
                        <span className="site-tag">
                          <Building size={12} /> {room.site_name || '—'}
                        </span>
                      </td>
                      <td>
                        {isUnlocated ? (
                          <span className="status-badge badge-warning">
                            <MapPinOff size={12} /> <span>Unlocated</span>
                          </span>
                        ) : (
                          <span className="status-badge badge-success">
                            <MapPin size={12} /> <span>Located</span>
                          </span>
                        )}
                      </td>
                      <td>
                        <div className="row-actions">
                          {isEditing ? (
                            <>
                              <button className="row-action-btn save-btn" title="Save" onClick={() => saveEditRoom(room.id)}>
                                <Check size={16} />
                              </button>
                              <button className="row-action-btn cancel-btn" title="Cancel" onClick={() => setEditingRoomId(null)}>
                                <X size={16} />
                              </button>
                            </>
                          ) : (
                            <>
                              {isEditor && (
                                <button className="row-action-btn" title="Edit" onClick={() => startEditRoom(room)}>
                                  <Pencil size={16} />
                                </button>
                              )}

                              <button
                                className="row-action-btn text-accent-light"
                                title="View Work Orders"
                                onClick={() => onViewWorkOrders && onViewWorkOrders(room, 'room')}
                              >
                                <ClipboardList size={16} />
                              </button>

                              <button
                                className="row-action-btn text-accent-light"
                                title="View PM Schedules"
                                onClick={() => onOpenPMSchedules && onOpenPMSchedules(room, 'room')}
                              >
                                <Calendar size={16} />
                              </button>

                              {isUnlocated && isEditor ? (
                                <button
                                  className="btn btn-warning-solid btn-card-action"
                                  title="Click to place on floorplan"
                                  onClick={() => goToPlaceRoom ? goToPlaceRoom(room) : goToMap(room)}
                                >
                                  <MapPin size={12} className="flex-shrink-0" />
                                  <span>Place on Map</span>
                                </button>
                              ) : (
                                <button className="row-action-btn map-btn" title="Go to Map" onClick={() => goToMap(room)}>
                                  <ExternalLink size={16} />
                                </button>
                              )}

                              {isEditor && (
                                <button className="row-action-btn delete-btn" title="Delete" onClick={() => handleDeleteRoom(room.id)}>
                                  <Trash2 size={16} />
                                </button>
                              )}
                            </>
                          )}
                        </div>
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Mobile Card List View */}
      <div className="table-mobile-view">
        {isLoading && allRooms.length === 0 ? (
          [1, 2, 3, 4, 5].map((key) => (
            <div key={key} className="table-mobile-card glass-panel">
              <div className="flex-between">
                <div className="skeleton skeleton-text" style={{ width: '45%', height: '18px' }} />
                <div className="skeleton skeleton-pill" style={{ width: '75px', height: '22px' }} />
              </div>
              <div className="skeleton skeleton-text" style={{ width: '80%', height: '14px', margin: '0.4rem 0' }} />
              <div className="flex-row gap-xs">
                <div className="skeleton" style={{ width: '90px', height: '20px', borderRadius: '6px' }} />
                <div className="skeleton" style={{ width: '70px', height: '20px', borderRadius: '6px' }} />
              </div>
            </div>
          ))
        ) : filteredRooms.length === 0 ? (
          <div className="list-empty p-2xl text-center">
            <DoorOpen size={48} className="list-empty-icon opacity-40 m-auto mb-sm" />
            <p className="text-muted m-0">No rooms match the current filter</p>
          </div>
        ) : (
          paginatedRooms.map(room => (
            <RoomCard
              key={room.id}
              room={room}
              isEditing={editingRoomId === room.id}
              editForm={editForm}
              setEditForm={setEditForm}
              isEditor={isEditor}
              startEditRoom={startEditRoom}
              saveEditRoom={saveEditRoom}
              setEditingRoomId={setEditingRoomId}
              handleDeleteRoom={handleDeleteRoom}
              goToMap={goToMap}
              goToPlaceRoom={goToPlaceRoom}
              onViewWorkOrders={onViewWorkOrders}
              onOpenPMSchedules={onOpenPMSchedules}
            />
          ))
        )}
      </div>

      {/* Pagination Footer */}
      {filteredRooms.length > 0 && (
        <div className="wo-pagination-panel glass-panel flex-between p-md mt-md flex-wrap gap-md">
          {/* Info & Page Size */}
          <div className="items-center gap-lg">
            <span className="text-sm text-muted">
              Showing <strong className="text-primary">{pageSize === 'all' ? 1 : ((validCurrentPage - 1) * pageSize + 1).toLocaleString()}</strong> - <strong className="text-primary">{pageSize === 'all' ? filteredRooms.length.toLocaleString() : Math.min(validCurrentPage * pageSize, filteredRooms.length).toLocaleString()}</strong> of <strong className="text-primary">{filteredRooms.length.toLocaleString()}</strong> rooms
            </span>

            <div className="items-center gap-xs">
              <span className="text-xs text-muted">Per page:</span>
              <select
                className="wo-pagesize-select"
                value={pageSize}
                onChange={e => {
                  const val = e.target.value === 'all' ? 'all' : Number(e.target.value);
                  setPageSize(val);
                  setCurrentPage(1);
                }}
              >
                <option value={25}>25</option>
                <option value={50}>50</option>
                <option value={100}>100</option>
                <option value={250}>250</option>
                <option value="all">All</option>
              </select>
            </div>
          </div>

          {/* Navigation Buttons */}
          {pageSize !== 'all' && totalPages > 1 && (
            <div className="items-center gap-xs">
              <button
                className="wo-page-btn"
                onClick={() => setCurrentPage(1)}
                disabled={validCurrentPage === 1}
                title="First Page"
              >
                <ChevronsLeft size={16} />
              </button>

              <button
                className="wo-page-btn"
                onClick={() => setCurrentPage(prev => Math.max(1, prev - 1))}
                disabled={validCurrentPage === 1}
                title="Previous Page"
              >
                <ChevronLeft size={16} />
              </button>

              <span className="text-xs text-muted px-sm">
                Page <strong className="text-primary">{validCurrentPage}</strong> of <strong className="text-primary">{totalPages}</strong>
              </span>

              <button
                className="wo-page-btn"
                onClick={() => setCurrentPage(prev => Math.min(totalPages, prev + 1))}
                disabled={validCurrentPage === totalPages}
                title="Next Page"
              >
                <ChevronRight size={16} />
              </button>

              <button
                className="wo-page-btn"
                onClick={() => setCurrentPage(totalPages)}
                disabled={validCurrentPage === totalPages}
                title="Last Page"
              >
                <ChevronsRight size={16} />
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
