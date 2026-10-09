import 'react';
import { X, Package, DoorOpen, MapPin, Building } from 'lucide-react';
import WorkOrderHistorySection from './WorkOrderHistorySection';

export default function WorkOrderHistoryModal({
  isOpen,
  onClose,
  item,
  itemType = 'equipment',
  currentUser,
  goToMap
}) {
  if (!isOpen || !item) return null;

  const isEquip = itemType === 'equipment';

  return (
    <div className="modal-overlay modal-backdrop-dark" onClick={onClose} style={{ zIndex: 1200 }}>
      <div
        className="modal-card modal-md glass-panel"
        onClick={e => e.stopPropagation()}
      >
        {/* Header */}
        <div className="modal-card-header">
          <div className="flex items-center gap-sm">
            <div className={`icon-box-${isEquip ? 'success' : 'primary'}`}>
              {isEquip ? <Package size={18} /> : <DoorOpen size={18} />}
            </div>
            <div>
              <div className="flex items-center gap-xs">
                <h3 className="m-0 text-base font-bold text-primary">
                  {item.name || (isEquip ? 'Equipment' : 'Room')}
                </h3>
                <span className="badge badge-secondary capitalize">
                  {itemType}
                </span>
              </div>
              {item.description && (
                <p className="text-xs text-muted mt-2xs m-0">
                  {item.description}
                </p>
              )}
            </div>
          </div>

          <button
            type="button"
            onClick={onClose}
            className="btn btn-ghost btn-icon-xs text-muted hover:text-primary"
            title="Close (Esc)"
          >
            <X size={18} />
          </button>
        </div>

        {/* Scrollable Work Order History Body */}
        <div className="modal-card-body">
          {/* Item Metadata summary tags */}
          {(item.floorplan_name || item.site_name) && (
            <div className="flex items-center gap-xs flex-wrap">
              {item.floorplan_name && (
                <span className="badge badge-secondary gap-xs">
                  <MapPin size={11} /> {item.floorplan_name}
                </span>
              )}
              {item.site_name && (
                <span className="badge badge-secondary gap-xs">
                  <Building size={11} /> {item.site_name}
                </span>
              )}
            </div>
          )}

          <WorkOrderHistorySection
            item={item}
            itemType={itemType}
            currentUser={currentUser}
            isModal={true}
            goToMap={(target, type) => {
              onClose();
              if (goToMap) goToMap(target, type);
            }}
          />
        </div>

        {/* Footer */}
        <div className="modal-card-footer">
          <button
            type="button"
            onClick={onClose}
            className="btn btn-secondary btn-sm"
          >
            Close
          </button>
        </div>
      </div>
    </div>
  );
}
