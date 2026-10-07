import { useState, useMemo } from 'react';
import {
  AlertCircle, CheckCircle, Map as MapIcon, Building,
  ExternalLink, Trash2, ChevronUp, ChevronDown, User,
  ChevronsLeft, ChevronsRight, ChevronLeft, ChevronRight
} from 'lucide-react';
import TicketCard from './TicketCard';

export default function TicketTable({
  allTickets,
  filteredTickets,
  isEditor,
  handleDeleteTicket,
  goToMap,
  ticketSortField,
  ticketSortOrder,
  toggleTicketSort,
  user,
  isLoading,
  isBackgroundSyncing
}) {
  const [currentPage, setCurrentPage] = useState(1);
  const [pageSize, setPageSize] = useState(50);
  const [prevFilteredLength, setPrevFilteredLength] = useState(filteredTickets.length);

  // Reset to page 1 when filtered items change
  if (filteredTickets.length !== prevFilteredLength) {
    setPrevFilteredLength(filteredTickets.length);
    setCurrentPage(1);
  }

  const totalPages = pageSize === 'all' ? 1 : Math.ceil(filteredTickets.length / pageSize) || 1;
  const validCurrentPage = Math.min(Math.max(1, currentPage), totalPages);

  const paginatedTickets = useMemo(() => {
    if (pageSize === 'all') return filteredTickets;
    const start = (validCurrentPage - 1) * pageSize;
    return filteredTickets.slice(start, start + pageSize);
  }, [filteredTickets, validCurrentPage, pageSize]);
  return (
    <div className="list-view-container">
      <div className="flex-between mb-xl">
        <div className="items-center gap-md">
          <AlertCircle size={24} color="#f59e0b" />
          <h2 className="text-lg font-semibold m-0">
            Reported Issues ({filteredTickets.length !== allTickets.length ? `${filteredTickets.length} of ${allTickets.length}` : allTickets.length})
            {isBackgroundSyncing && (
              <span className="text-2xs text-muted font-normal ml-xs">
                • updating...
              </span>
            )}
          </h2>
        </div>
      </div>

      {/* Desktop Table View */}
      <div className="table-desktop-view">
        <div className="list-table-wrapper">
          <table className="list-table">
            <thead>
              <tr>
                <th
                  onClick={() => toggleTicketSort('title')}
                  className="sortable-header pointer select-none"
                >
                  <div className="items-center gap-sm">
                    Issue
                    {ticketSortField === 'title' && (
                      ticketSortOrder === 'asc' ? <ChevronUp size={14} /> : <ChevronDown size={14} />
                    )}
                  </div>
                </th>
                <th
                  onClick={() => toggleTicketSort('status')}
                  className="sortable-header pointer select-none"
                >
                  <div className="items-center gap-sm">
                    Status
                    {ticketSortField === 'status' && (
                      ticketSortOrder === 'asc' ? <ChevronUp size={14} /> : <ChevronDown size={14} />
                    )}
                  </div>
                </th>
                <th
                  onClick={() => toggleTicketSort('creator_username')}
                  className="sortable-header pointer select-none"
                >
                  <div className="items-center gap-sm">
                    Reported By
                    {ticketSortField === 'creator_username' && (
                      ticketSortOrder === 'asc' ? <ChevronUp size={14} /> : <ChevronDown size={14} />
                    )}
                  </div>
                </th>
                <th>Floorplan</th>
                <th>Site</th>
                <th
                  onClick={() => toggleTicketSort('created_at')}
                  className="sortable-header pointer select-none"
                >
                  <div className="items-center gap-sm">
                    Date
                    {ticketSortField === 'created_at' && (
                      ticketSortOrder === 'asc' ? <ChevronUp size={14} /> : <ChevronDown size={14} />
                    )}
                  </div>
                </th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {isLoading && allTickets.length === 0 ? (
                [1, 2, 3, 4, 5].map((rowKey) => (
                  <tr key={rowKey}>
                    <td>
                      <div className="skeleton skeleton-text" style={{ width: `${60 + (rowKey % 3) * 15}%`, height: '16px' }} />
                      <div className="skeleton skeleton-text mt-xs" style={{ width: `${40 + (rowKey % 4) * 10}%`, height: '12px' }} />
                    </td>
                    <td><div className="skeleton" style={{ width: '80px', height: '22px', borderRadius: '12px' }} /></td>
                    <td><div className="skeleton skeleton-text" style={{ width: '90px', height: '14px' }} /></td>
                    <td><div className="skeleton skeleton-text" style={{ width: '100px', height: '14px' }} /></td>
                    <td><div className="skeleton skeleton-text" style={{ width: '80px', height: '14px' }} /></td>
                    <td><div className="skeleton skeleton-text" style={{ width: '70px', height: '14px' }} /></td>
                    <td><div className="skeleton" style={{ width: '50px', height: '28px', borderRadius: '6px' }} /></td>
                  </tr>
                ))
              ) : filteredTickets.length === 0 ? (
                <tr>
                  <td colSpan={7}>
                    <div className="list-empty">
                      <AlertCircle size={48} className="list-empty-icon" />
                      <p>No reported issues found</p>
                    </div>
                  </td>
                </tr>
              ) : (
                paginatedTickets.map(ticket => {
                  const isCreator = user && ticket.created_by_id === user.id;
                  const canDelete = isEditor || isCreator;

                  return (
                    <tr key={ticket.id}>
                      <td>
                        <div className="font-semibold">{ticket.title}</div>
                        <div className="text-xs text-muted text-truncate max-w-250">
                          {ticket.description || 'No description'}
                        </div>
                      </td>
                      <td>
                        <div className={`status-badge ${ticket.status === 'resolved' ? 'badge-success' : 'badge-warning'}`}>
                          {ticket.status === 'resolved' ? <CheckCircle size={12} /> : <AlertCircle size={12} />}
                          {ticket.status.toUpperCase()}
                        </div>
                      </td>
                      <td>
                        <div className="items-center gap-sm">
                          <div className="avatar-circle-xs">
                            <User size={12} />
                          </div>
                          {ticket.creator_name || ticket.creator_username}
                        </div>
                      </td>
                      <td>
                        <span className="floorplan-tag">
                          <MapIcon size={12} /> {ticket.floorplan_name}
                        </span>
                      </td>
                      <td>
                        <span className="site-tag">
                          <Building size={12} /> {ticket.site_name}
                        </span>
                      </td>
                      <td>
                        {new Date(ticket.created_at).toLocaleDateString()}
                      </td>
                      <td>
                        <div className="row-actions">
                          <button className="row-action-btn map-btn" title="Go to Map" onClick={() => goToMap(ticket)}>
                            <ExternalLink size={16} />
                          </button>
                          {canDelete && (
                            <button className="row-action-btn delete-btn" title="Delete Issue" onClick={() => handleDeleteTicket(ticket.id)}>
                              <Trash2 size={16} />
                            </button>
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
        {isLoading && allTickets.length === 0 ? (
          <div className="list-empty">
            <div className="skeleton" style={{ width: '48px', height: '48px', borderRadius: '50%', margin: '0 auto 1rem' }} />
            <div className="skeleton skeleton-text" style={{ width: '140px', height: '16px', margin: '0 auto' }} />
          </div>
        ) : filteredTickets.length === 0 ? (
          <div className="list-empty">
            <AlertCircle size={48} className="list-empty-icon" />
            <p>No reported issues found</p>
          </div>
        ) : (
          paginatedTickets.map(ticket => (
            <TicketCard
              key={ticket.id}
              ticket={ticket}
              isEditor={isEditor}
              handleDeleteTicket={handleDeleteTicket}
              goToMap={goToMap}
              user={user}
            />
          ))
        )}
      </div>

      {/* Pagination Footer */}
      {filteredTickets.length > 0 && (
        <div className="list-pagination-panel glass-panel flex-between p-md mt-md flex-wrap gap-md">
          {/* Info & Page Size */}
          <div className="items-center gap-lg">
            <span className="text-sm text-muted">
              Showing <strong className="text-primary">{pageSize === 'all' ? 1 : ((validCurrentPage - 1) * pageSize + 1).toLocaleString()}</strong> - <strong className="text-primary">{pageSize === 'all' ? filteredTickets.length.toLocaleString() : Math.min(validCurrentPage * pageSize, filteredTickets.length).toLocaleString()}</strong> of <strong className="text-primary">{filteredTickets.length.toLocaleString()}</strong> issues
            </span>

            <div className="items-center gap-xs">
              <span className="text-xs text-muted">Per page:</span>
              <select
                className="input-field list-pagesize-control" aria-label="Items per page"
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
                className="btn btn-secondary list-page-btn"
                onClick={() => setCurrentPage(1)}
                disabled={validCurrentPage === 1}
                title="First Page"
              >
                <ChevronsLeft size={16} />
              </button>

              <button
                className="btn btn-secondary list-page-btn"
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
                className="btn btn-secondary list-page-btn"
                onClick={() => setCurrentPage(prev => Math.min(totalPages, prev + 1))}
                disabled={validCurrentPage === totalPages}
                title="Next Page"
              >
                <ChevronRight size={16} />
              </button>

              <button
                className="btn btn-secondary list-page-btn"
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
