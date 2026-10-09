import  { useState, useEffect, useCallback } from 'react';
import {
  ClipboardList, AlertCircle, ChevronDown, ChevronUp, RefreshCw, Plus, LogIn, ShieldAlert
} from 'lucide-react';
import { getWorkOrderHistory, getErrorMessage } from '../api';
import { useAuth } from '../AuthContext';
import WorkOrderCard from './WorkOrderCard';
import WorkOrderDetailModal from './WorkOrderDetailModal';
import WorkOrderCreateModal from './WorkOrderCreateModal';
import LoginModal from './LoginModal';

export default function WorkOrderHistorySection({
  item,
  itemType = 'equipment', // 'equipment' | 'room'
  currentUser,
  isModal = false,
  goToMap
}) {
  const { user: authUser } = useAuth();
  const user = currentUser || authUser;

  const [historyData, setHistoryData] = useState(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState(null);
  const [statusFilter, setStatusFilter] = useState('all');
  const [isCollapsed, setIsCollapsed] = useState(false);

  const [selectedWO, setSelectedWO] = useState(null);
  const [isCreateOpen, setIsCreateOpen] = useState(false);
  const [isLoginModalOpen, setIsLoginModalOpen] = useState(false);

  const loadHistory = useCallback(async () => {
    if (!item) return;
    if (!user) {
      setHistoryData(null);
      setIsLoading(false);
      return;
    }

    setIsLoading(true);
    setError(null);

    try {
      const res = await getWorkOrderHistory(itemType, item.id, item.name);
      setHistoryData(res.data);
    } catch (err) {
      console.error('Error fetching work order history:', err);
      setError(getErrorMessage(err, 'Failed to load work orders'));
    } finally {
      setIsLoading(false);
    }
  }, [item, itemType, user]);

  useEffect(() => {
    void Promise.resolve().then(loadHistory);
  }, [loadHistory]);

  const isOpenWorkOrder = (wo) => wo.status !== 'completed' && wo.status !== 'cancelled';

  const filteredOrders = (historyData?.data || [])
    .filter(wo => {
      if (statusFilter === 'open') return isOpenWorkOrder(wo);
      if (statusFilter === 'completed') return wo.status === 'completed';
      return true;
    })
    .sort((a, b) => {
      const openOrder = Number(isOpenWorkOrder(b)) - Number(isOpenWorkOrder(a));
      if (openOrder !== 0) return openOrder;

      const aDate = a.created_at ? new Date(a.created_at).getTime() : 0;
      const bDate = b.created_at ? new Date(b.created_at).getTime() : 0;
      return bDate - aDate;
    });

  const innerContent = (
    <div>
      {/* Unauthenticated Prompt */}
      {!user && (
        <div
          className="unauth-drawer-card flex-column items-center text-center gap-xs p-md rounded-lg"
          style={{
            background: 'rgba(255, 255, 255, 0.03)',
            border: '1px solid rgba(255, 255, 255, 0.08)',
            borderRadius: '10px',
            padding: '1.25rem 1rem'
          }}
        >
          <ShieldAlert size={26} style={{ color: '#f59e0b', marginBottom: '0.25rem' }} />
          <h5 className="text-xs font-bold text-foreground m-0">Sign In Required</h5>
          <p className="text-xs text-muted m-0" style={{ lineHeight: 1.4, maxWidth: '240px' }}>
            Sign in with an authorized technician account to view work order history.
          </p>
          <button
            type="button"
            className="btn btn-primary btn-sm gap-xs"
            onClick={() => setIsLoginModalOpen(true)}
            style={{ marginTop: '0.5rem', width: '100%', maxWidth: '200px', justifyContent: 'center' }}
          >
            <LogIn size={14} />
            <span>Sign In</span>
          </button>
        </div>
      )}

      {/* Error Banner */}
      {user && error && (
        <div className="alert-box-danger flex-between p-sm text-xs mb-md">
          <div className="items-center gap-xs">
            <AlertCircle size={15} />
            <span>{error}</span>
          </div>
          <button
            type="button"
            onClick={loadHistory}
            className="btn btn-ghost btn-xs text-danger"
          >
            Retry
          </button>
        </div>
      )}

      {/* Loading Indicator */}
      {user && isLoading && !historyData && (
        <div className="p-lg text-center text-muted text-xs">
          <RefreshCw size={18} className="spinning m-auto mb-xs text-accent-light" style={{ display: 'block' }} />
          <span>Loading work order history...</span>
        </div>
      )}

      {/* Data List & Filter Tabs */}
      {user && historyData && (
        <div>
          {/* Filter Sub-Tabs & Action */}
          <div className="flex-between items-center gap-xs mb-md pb-xs border-bottom-subtle flex-wrap">
            <div className="items-center gap-xs">
              <button
                type="button"
                onClick={() => setStatusFilter('all')}
                className={`btn-tab-filter ${statusFilter === 'all' ? 'active' : ''}`}
              >
                All ({historyData.total})
              </button>
              <button
                type="button"
                onClick={() => setStatusFilter('open')}
                className={`btn-tab-filter warning ${statusFilter === 'open' ? 'active' : ''}`}
              >
                Open ({historyData.open_count})
              </button>
              <button
                type="button"
                onClick={() => setStatusFilter('completed')}
                className={`btn-tab-filter success ${statusFilter === 'completed' ? 'active' : ''}`}
              >
                Done ({historyData.completed_count})
              </button>
            </div>

            <div className="items-center gap-xs">
              <button
                type="button"
                onClick={() => setIsCreateOpen(true)}
                className="btn btn-primary btn-xs gap-2xs"
                title="Create Work Order for this item"
              >
                <Plus size={12} />
                <span>New WO</span>
              </button>

              <button
                type="button"
                onClick={loadHistory}
                disabled={isLoading}
                className="btn btn-ghost btn-icon-xs text-muted"
                title="Refresh work orders"
              >
                <RefreshCw size={13} className={isLoading ? 'spinning' : ''} />
              </button>
            </div>
          </div>

          {/* Work Order Cards */}
          {historyData.total > 0 ? (
            <div className={`flex-column gap-sm ${isModal ? '' : 'max-h-480 overflow-y-auto'}`}>
              {filteredOrders.map(wo => (
                <WorkOrderCard
                  key={wo.id}
                  workOrder={wo}
                  onSelect={(order) => setSelectedWO(order)}
                  goToMap={goToMap}
                />
              ))}
            </div>
          ) : (
            <div className="p-md text-center text-muted text-xs empty-state-box">
              No work orders recorded for this {itemType}.
            </div>
          )}
        </div>
      )}

      {selectedWO && (
        <WorkOrderDetailModal
          workOrder={selectedWO}
          isOpen={Boolean(selectedWO)}
          onClose={() => setSelectedWO(null)}
          currentUser={user}
          onUpdated={loadHistory}
        />
      )}

      {isCreateOpen && (
        <WorkOrderCreateModal
          isOpen={isCreateOpen}
          onClose={() => setIsCreateOpen(false)}
          currentUser={user}
          initialEquipmentId={itemType === 'equipment' ? item.id : null}
          initialRoomId={itemType === 'room' ? item.id : null}
          initialFloorplanId={item.floorplan_id}
          onCreated={loadHistory}
        />
      )}

      {isLoginModalOpen && (
        <LoginModal
          isOpen={isLoginModalOpen}
          onClose={() => setIsLoginModalOpen(false)}
          onSuccess={() => {
            setIsLoginModalOpen(false);
          }}
        />
      )}
    </div>
  );

  if (isModal) {
    return (
      <div className="w-full flex-column">
        {innerContent}
      </div>
    );
  }

  return (
    <div className="glass-section-box mt-md p-xs">
      {/* Section Header */}
      <div className={`flex-between ${isCollapsed ? 'mb-0' : 'mb-md'}`}>
        <div className="items-center gap-md">
          <div className="avatar-box-sm badge-info">
            <ClipboardList size={17} />
          </div>
          <div>
            <div className="items-center gap-sm">
              <h4 className="text-sm font-semibold m-0 text-primary">
                Work Orders
              </h4>
              {historyData && historyData.open_count > 0 && (
                <span className="status-badge badge-warning">
                  {historyData.open_count} Open
                </span>
              )}
            </div>
          </div>
        </div>

        <div className="items-center gap-xs">
          <button
            type="button"
            onClick={loadHistory}
            disabled={isLoading}
            className="btn btn-ghost btn-icon-xs text-muted"
            title="Refresh work orders"
          >
            <RefreshCw size={14} className={isLoading ? 'spinning' : ''} />
          </button>

          <button
            type="button"
            onClick={() => setIsCollapsed(!isCollapsed)}
            className="btn btn-ghost btn-icon-xs text-muted"
            title={isCollapsed ? 'Expand' : 'Collapse'}
          >
            {isCollapsed ? <ChevronDown size={16} /> : <ChevronUp size={16} />}
          </button>
        </div>
      </div>

      {/* Body Content */}
      {!isCollapsed && innerContent}
    </div>
  );
}
