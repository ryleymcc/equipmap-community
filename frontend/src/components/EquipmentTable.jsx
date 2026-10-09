import { useState, useMemo } from 'react';
import {
  Package, Map as MapIcon, Building,
  Check, X, Pencil, ExternalLink, Trash2,
  ChevronUp, ChevronDown, ClipboardList, Calendar, RefreshCw,
  ChevronsLeft, ChevronsRight, ChevronLeft, ChevronRight
} from 'lucide-react';
import { COLORS } from '../mapConstants';
import EquipmentCard from './EquipmentCard';

export default function EquipmentTable({
  allEquipment,
  filteredEquipment,
  isLoading = false,
  isBackgroundSyncing = false,
  editingEquipId,
  setEditingEquipId,
  editForm,
  setEditForm,
  isEditor,
  startEditEquip,
  saveEditEquip,
  handleDeleteEquip,
  goToMap,
  equipSortField,
  equipSortOrder,
  toggleEquipSort,
  selectedEquipIds,
  toggleEquipSelection,
  selectAllFilteredEquip,
  setIsBulkEditModalOpen,
  onViewWorkOrders,
  onOpenPMSchedules
}) {
  const [currentPage, setCurrentPage] = useState(1);
  const [pageSize, setPageSize] = useState(50);
  const [prevFilteredLength, setPrevFilteredLength] = useState(filteredEquipment.length);

  // Reset to page 1 when filtered items change
  if (prevFilteredLength !== filteredEquipment.length) {
    setPrevFilteredLength(filteredEquipment.length);
    setCurrentPage(1);
  }

  const totalPages = pageSize === 'all' ? 1 : Math.ceil(filteredEquipment.length / pageSize) || 1;
  const validCurrentPage = Math.min(Math.max(1, currentPage), totalPages);

  const paginatedEquipment = useMemo(() => {
    if (pageSize === 'all') return filteredEquipment;
    const start = (validCurrentPage - 1) * pageSize;
    return filteredEquipment.slice(start, start + pageSize);
  }, [filteredEquipment, validCurrentPage, pageSize]);

  const allFilteredSelected = filteredEquipment.length > 0 &&
    filteredEquipment.every(e => selectedEquipIds.includes(e.id));

  const handleSelectAll = () => {
    if (allFilteredSelected) {
      selectAllFilteredEquip([]);
    } else {
      selectAllFilteredEquip(filteredEquipment.map(e => e.id));
    }
  };

  return (
    <div className="list-view-container">
      <div className="flex-between flex-wrap gap-lg mb-xl">
        <div className="items-center gap-md">
          <Package size={24} color="#10b981" />
          <h2 className="text-lg font-semibold m-0 items-center gap-sm">
            {filteredEquipment.length !== allEquipment.length ? 'Equipment' : 'All Equipment'}
            {isLoading && allEquipment.length === 0 ? (
              <span className="skeleton" style={{ width: '48px', height: '22px', borderRadius: '6px' }} />
            ) : (
              <span>
                ({filteredEquipment.length !== allEquipment.length ? `${filteredEquipment.length} of ${allEquipment.length}` : allEquipment.length})
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

        {selectedEquipIds.length > 0 && isEditor && (
          <div className="bulk-edit-bar glass-panel animate-in">
            <span className="text-xs font-medium">{selectedEquipIds.length} selected</span>
            <button
              type="button"
              className="btn btn-primary btn-card-action"
              onClick={() => setIsBulkEditModalOpen(true)}
            >
              Bulk Edit
            </button>
            <button
              type="button"
              className="btn btn-secondary btn-card-action"
              onClick={() => selectAllFilteredEquip([])}
            >
              Cancel
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
                {isEditor && (
                  <th className="th-checkbox">
                    <input
                      type="checkbox"
                      checked={allFilteredSelected}
                      onChange={handleSelectAll}
                      disabled={isLoading && allEquipment.length === 0}
                    />
                  </th>
                )}
                <th
                  onClick={() => toggleEquipSort('name')}
                  className="sortable-header pointer select-none"
                >
                  <div className="items-center gap-sm">
                    Name
                    {equipSortField === 'name' && (
                      equipSortOrder === 'asc' ? <ChevronUp size={14} /> : <ChevronDown size={14} />
                    )}
                  </div>
                </th>
                <th>Description</th>
                <th>Tools Required</th>
                <th>Color</th>
                <th>Floorplan</th>
                <th>Site</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {isLoading && allEquipment.length === 0 ? (
                [1, 2, 3, 4, 5, 6, 7, 8].map((rowKey) => (
                  <tr key={rowKey}>
                    {isEditor && (
                      <td>
                        <div className="skeleton" style={{ width: '16px', height: '16px', borderRadius: '4px' }} />
                      </td>
                    )}
                    <td>
                      <div className="skeleton skeleton-text" style={{ width: `${55 + (rowKey % 4) * 12}%`, height: '16px' }} />
                    </td>
                    <td>
                      <div className="skeleton skeleton-text" style={{ width: `${40 + (rowKey % 3) * 18}%`, height: '14px' }} />
                    </td>
                    <td>
                      <div className="skeleton skeleton-text" style={{ width: `${30 + (rowKey % 4) * 15}%`, height: '14px' }} />
                    </td>
                    <td>
                      <div className="skeleton" style={{ width: '18px', height: '18px', borderRadius: '50%' }} />
                    </td>
                    <td>
                      <div className="skeleton skeleton-text" style={{ width: '85px', height: '14px' }} />
                    </td>
                    <td>
                      <div className="skeleton skeleton-text" style={{ width: '70px', height: '14px' }} />
                    </td>
                    <td>
                      <div className="flex-row gap-xs">
                        <div className="skeleton" style={{ width: '26px', height: '26px', borderRadius: '6px' }} />
                        <div className="skeleton" style={{ width: '26px', height: '26px', borderRadius: '6px' }} />
                      </div>
                    </td>
                  </tr>
                ))
              ) : filteredEquipment.length === 0 ? (
                <tr>
                  <td colSpan={isEditor ? 8 : 7}>
                    <div className="list-empty empty-state-box">
                      <Package size={48} className="list-empty-icon opacity-40 m-auto mb-md" />
                      <p className="text-muted m-0">No equipment found</p>
                    </div>
                  </td>
                </tr>
              ) : (
                paginatedEquipment.map(equip => {
                  const isEditing = editingEquipId === equip.id;
                  const isSelected = selectedEquipIds.includes(equip.id);
                  return (
                    <tr key={equip.id} className={`${isEditing ? 'editing-row' : ''} ${isSelected ? 'selected-row' : ''}`}>
                      {isEditor && (
                        <td>
                          <input
                            type="checkbox"
                            checked={isSelected}
                            onChange={() => toggleEquipSelection(equip.id)}
                            disabled={isEditing}
                          />
                        </td>
                      )}
                      <td>
                        {isEditing ? (
                          <input
                            className="inline-edit-input"
                            value={editForm.name}
                            onChange={e => setEditForm({ ...editForm, name: e.target.value })}
                            autoFocus
                          />
                        ) : equip.name}
                      </td>
                      <td>
                        {isEditing ? (
                          <input
                            className="inline-edit-input"
                            value={editForm.description}
                            onChange={e => setEditForm({ ...editForm, description: e.target.value })}
                          />
                        ) : (equip.description || '—')}
                      </td>
                      <td>
                        {isEditing ? (
                          <input
                            className="inline-edit-input"
                            value={editForm.tools_required}
                            onChange={e => setEditForm({ ...editForm, tools_required: e.target.value })}
                            placeholder="Tools Required"
                          />
                        ) : (equip.tools_required || '—')}
                      </td>
                      <td>
                        {isEditing ? (
                          <div className="color-picker-inline">
                            {COLORS.map(c => (
                              <div
                                key={c}
                                className={`swatch-option ${editForm.color === c ? 'selected' : ''}`}
                                style={{ backgroundColor: c }}
                                onClick={() => setEditForm({ ...editForm, color: c })}
                              />
                            ))}
                          </div>
                        ) : (
                          <span className="color-swatch" style={{ backgroundColor: equip.color || '#10b981' }} />
                        )}
                      </td>
                      <td>
                        <span className="floorplan-tag">
                          <MapIcon size={12} /> {equip.floorplan_name}
                        </span>
                      </td>
                      <td>
                        <span className="site-tag">
                          <Building size={12} /> {equip.site_name}
                        </span>
                      </td>
                      <td>
                        <div className="row-actions">
                          {isEditing ? (
                            <>
                              <button className="row-action-btn save-btn" title="Save" onClick={() => saveEditEquip(equip.id)}>
                                <Check size={16} />
                              </button>
                              <button className="row-action-btn cancel-btn" title="Cancel" onClick={() => setEditingEquipId(null)}>
                                <X size={16} />
                              </button>
                            </>
                          ) : (
                            <>
                              {isEditor && (
                                <button className="row-action-btn" title="Edit" onClick={() => startEditEquip(equip)}>
                                  <Pencil size={16} />
                                </button>
                              )}
                              <button
                                className="row-action-btn text-accent-light"
                                title="View Work Orders"
                                onClick={() => onViewWorkOrders && onViewWorkOrders(equip, 'equipment')}
                              >
                                <ClipboardList size={16} />
                              </button>
                              <button
                                className="row-action-btn text-accent-light"
                                title="View PM Schedules"
                                onClick={() => onOpenPMSchedules && onOpenPMSchedules(equip, 'equipment')}
                              >
                                <Calendar size={16} />
                              </button>
                              <button className="row-action-btn map-btn" title="Go to Map" onClick={() => goToMap(equip)}>
                                <ExternalLink size={16} />
                              </button>
                              {isEditor && (
                                <button className="row-action-btn delete-btn" title="Delete" onClick={() => handleDeleteEquip(equip.id)}>
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
        {isEditor && filteredEquipment.length > 0 && !isLoading && (
          <div className="table-mobile-selection-bar flex-between items-center gap-sm mb-xs">
            <button
              type="button"
              className="btn btn-secondary btn-card-action items-center gap-xs"
              onClick={handleSelectAll}
            >
              <input
                type="checkbox"
                checked={allFilteredSelected}
                onChange={() => {}}
                style={{ pointerEvents: 'none', cursor: 'pointer' }}
              />
              <span>
                {allFilteredSelected
                  ? 'Deselect All'
                  : (filteredEquipment.length === allEquipment.length ? `Select All (${allEquipment.length})` : `Select Results (${filteredEquipment.length})`)}
              </span>
            </button>
            {selectedEquipIds.length > 0 && (
              <span className="text-xs text-muted font-medium">
                {selectedEquipIds.length} of {allEquipment.length} selected
              </span>
            )}
          </div>
        )}
        {isLoading && allEquipment.length === 0 ? (
          [1, 2, 3, 4, 5].map((key) => (
            <div key={key} className="table-mobile-card glass-panel">
              <div className="flex-between">
                <div className="items-center gap-xs" style={{ width: '60%' }}>
                  <div className="skeleton" style={{ width: '18px', height: '18px', borderRadius: '50%' }} />
                  <div className="skeleton skeleton-text" style={{ width: '70%', height: '18px' }} />
                </div>
                <div className="skeleton" style={{ width: '50px', height: '24px', borderRadius: '6px' }} />
              </div>
              <div className="skeleton skeleton-text" style={{ width: '85%', height: '14px', margin: '0.4rem 0' }} />
              <div className="flex-row gap-xs">
                <div className="skeleton" style={{ width: '90px', height: '20px', borderRadius: '6px' }} />
                <div className="skeleton" style={{ width: '70px', height: '20px', borderRadius: '6px' }} />
              </div>
            </div>
          ))
        ) : filteredEquipment.length === 0 ? (
          <div className="list-empty empty-state-box">
            <Package size={48} className="list-empty-icon opacity-40 m-auto mb-md" />
            <p className="text-muted m-0">No equipment found</p>
          </div>
        ) : (
          paginatedEquipment.map(equip => (
            <EquipmentCard
              key={equip.id}
              equip={equip}
              isEditing={editingEquipId === equip.id}
              editForm={editForm}
              setEditForm={setEditForm}
              isEditor={isEditor}
              startEditEquip={startEditEquip}
              saveEditEquip={saveEditEquip}
              setEditingEquipId={setEditingEquipId}
              handleDeleteEquip={handleDeleteEquip}
              goToMap={goToMap}
              selectedEquipIds={selectedEquipIds}
              toggleEquipSelection={toggleEquipSelection}
              onViewWorkOrders={onViewWorkOrders}
              onOpenPMSchedules={onOpenPMSchedules}
            />
          ))
        )}
      </div>

      {/* Pagination Footer */}
      {filteredEquipment.length > 0 && (
        <div className="wo-pagination-panel glass-panel flex-between p-md mt-md flex-wrap gap-md">
          {/* Info & Page Size */}
          <div className="items-center gap-lg">
            <span className="text-sm text-muted">
              Showing <strong className="text-primary">{pageSize === 'all' ? 1 : ((validCurrentPage - 1) * pageSize + 1).toLocaleString()}</strong> - <strong className="text-primary">{pageSize === 'all' ? filteredEquipment.length.toLocaleString() : Math.min(validCurrentPage * pageSize, filteredEquipment.length).toLocaleString()}</strong> of <strong className="text-primary">{filteredEquipment.length.toLocaleString()}</strong> items
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
