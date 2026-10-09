import 'react';
import {
  AlertCircle, CheckCircle, Map as MapIcon, Building,
  ExternalLink, Trash2, User, Calendar
} from 'lucide-react';

export default function TicketCard({
  ticket,
  isEditor = false,
  handleDeleteTicket,
  goToMap,
  user
}) {
  if (!ticket) return null;

  const isResolved = ticket.status === 'resolved';
  const isCreator = user && ticket.created_by_id === user.id;
  const canDelete = isEditor || isCreator;

  const formatDate = (dateStr) => {
    if (!dateStr) return '—';
    try {
      return new Date(dateStr).toLocaleDateString();
    } catch {
      return dateStr;
    }
  };

  return (
    <div className="table-mobile-card glass-panel">
      {/* 1. Header: Title & Status Badge */}
      <div className="table-mobile-card-top">
        <span className="table-mobile-card-title text-truncate flex-1 min-w-0 mr-xs">
          {ticket.title}
        </span>

        <div>
          <span className={`status-badge ${isResolved ? 'badge-success' : 'badge-warning'}`}>
            {isResolved ? <CheckCircle size={11} /> : <AlertCircle size={11} />}
            <span>{(ticket.status || 'open').toUpperCase()}</span>
          </span>
        </div>
      </div>

      {/* 2. Body: Description & Tags */}
      <div className="table-mobile-card-body">
        {ticket.description && (
          <div className="text-sm text-secondary line-clamp-2">
            {ticket.description}
          </div>
        )}

        <div className="table-mobile-card-tags">
          {ticket.floorplan_name && (
            <span className="floorplan-tag">
              <MapIcon size={12} /> {ticket.floorplan_name}
            </span>
          )}
          {ticket.site_name && (
            <span className="site-tag">
              <Building size={12} /> {ticket.site_name}
            </span>
          )}
        </div>
      </div>

      {/* 3. Footer: Creator, Date & Actions */}
      <div className="table-mobile-card-footer">
        <div className="items-center gap-md flex-nowrap text-xs text-muted min-w-0 flex-1 overflow-hidden">
          {ticket.creator_username && (
            <div className="items-center gap-xs text-truncate">
              <div className="avatar-circle-xs flex-shrink-0">
                <User size={10} />
              </div>
              <span className="text-primary text-truncate">{ticket.creator_name || ticket.creator_username}</span>
            </div>
          )}
          {ticket.created_at && (
            <div className="items-center gap-xs flex-shrink-0">
              <Calendar size={11} className="flex-shrink-0" />
              <span>{formatDate(ticket.created_at)}</span>
            </div>
          )}
        </div>

        <div className="items-center gap-xs ml-auto flex-nowrap flex-shrink-0">
          <button
            type="button"
            className="btn btn-ghost btn-card-action"
            onClick={() => goToMap(ticket)}
            title="Go to Map"
          >
            <ExternalLink size={13} className="flex-shrink-0" />
            <span>Map</span>
          </button>

          {canDelete && (
            <button
              type="button"
              className="btn btn-ghost btn-card-action text-danger btn-icon"
              onClick={() => handleDeleteTicket(ticket.id)}
              title="Delete Ticket"
            >
              <Trash2 size={13} className="flex-shrink-0" />
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
