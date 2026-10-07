import { memo, useState } from 'react';
import { ChevronRight, ChevronUp, Plus, AlertCircle, Layers, Trash2, LogIn, Crosshair } from 'lucide-react';
import { RoomForm } from './RoomForm';
import { EquipmentForm } from './EquipmentForm';
import { TicketForm } from './TicketForm';
import LoginModal from './LoginModal';
import { COLORS, incrementRoomName } from '../mapConstants';

export const RightDrawer = memo(function RightDrawer({
  isOpen,
  onClose,
  mapMode,
  isMobile,
  isEditor,
  user,
  multiFloorRefPin,
  onRemoveMultiFloorRefPin,
  rooms,
  lastPlacedRoomName,
  nextRoomName,
  setNextRoomName,
  nextEquipName,
  setNextEquipName,
  nextDescription,
  setNextDescription,
  nextToolsRequired,
  setNextToolsRequired,
  isNameError,
  setIsNameError,
  equipColor,
  setEquipColor,
  formError,
  setFormError,
  onStartPlacement,
  onReposition,
  onCancel,
  onRelocate,
  onAddRoom,
  onAddEquipment,
  onAddTicket,
  onUpdateRoom,
  onUpdateEquipment,
  onUpdateTicket,
  onDeleteRoom,
  onDeleteEquipment,
  onDeleteTicket
}) {
  // Derive mutually exclusive states from consolidated mapMode
  const editMode = mapMode.type === 'add-placement' || mapMode.type === 'add-form';
  const activeActionType = (mapMode.type === 'add-placement' || mapMode.type === 'add-form') ? mapMode.activeActionType : null;
  const newPinCoord = mapMode.type === 'add-form' ? mapMode.newPinCoord : null;
  const editingRoom = (mapMode.type === 'edit' || mapMode.type === 'relocate') && mapMode.itemType === 'room' ? mapMode.item : null;
  const editingEquipment = (mapMode.type === 'edit' || mapMode.type === 'relocate') && mapMode.itemType === 'equipment' ? mapMode.item : null;
  const editingTicket = (mapMode.type === 'edit' || mapMode.type === 'relocate') && mapMode.itemType === 'ticket' ? mapMode.item : null;
  const editingMultiFloorRef = (mapMode.type === 'edit' || mapMode.type === 'relocate') && mapMode.itemType === 'multi-floor-ref' ? mapMode.item : null;
  const isRelocating = mapMode.type === 'relocate';
  const [isLoginModalOpen, setIsLoginModalOpen] = useState(false);

  const handleCancelPlacement = () => {
    onCancel();
    onClose();
    setNextDescription('');
  };

  const handleStartAddType = (type) => {
    if (type === 'equipment' || type === 'room') {
      if (!isEditor) return;
    } else if (type === 'ticket') {
      if (!user) return;
    }
    onStartPlacement(type);
    setFormError('');

    if (type === 'equipment') {
      setNextEquipName('');
    } else if (type === 'ticket') {
      setNextDescription('');
    } else if (type === 'multi-floor-ref') {
      onClose();
    } else if (type === 'room') {
      let baseName = lastPlacedRoomName;
      if (!baseName) {
        if (rooms && rooms.length > 0) {
          const sorted = [...rooms].sort((a, b) => b.id - a.id);
          baseName = sorted[0].name;
        } else {
          baseName = 'Room 0';
        }
      }
      setNextRoomName(incrementRoomName(baseName));
    }
  };

  const getHeaderTitle = () => {
    if (editMode) {
      if (activeActionType === 'room') return 'Add Room';
      if (activeActionType === 'equipment') return 'Add Equipment';
      if (activeActionType === 'ticket') return 'Report Issue';
      if (activeActionType === 'multi-floor-ref') return 'Multi-Floor Reference Pin';
    }
    if (editingRoom) return isEditor ? 'Edit Room' : 'Room Details';
    if (editingEquipment) return isEditor ? 'Edit Equipment' : 'Equipment Details';
    if (editingTicket) return isEditor || (user && editingTicket.created_by_id === user.id) ? 'Edit Issue' : 'Issue Details';
    if (editingMultiFloorRef) return 'Multi-Floor Reference Pin';
    return 'Add Item';
  };

  return (
    <div className={`drawer drawer-right ${isOpen ? 'drawer-open' : ''}`}>
      <div className="drawer-header">
        <h3 className="flex-1">{getHeaderTitle()}</h3>

        {editMode && (
          <button
            className={`btn ${activeActionType === 'room' ? 'btn-primary' : 'btn-danger'} btn-sm mr-md`}
            onClick={handleCancelPlacement}
          >
            {activeActionType === 'room' ? 'Done' : 'Cancel'}
          </button>
        )}

        <button
          type="button"
          className="btn btn-ghost btn-icon-xs text-muted hover:text-primary"
          onClick={onClose}
          title="Hide Drawer"
        >
          {isMobile ? <ChevronUp size={18} /> : <ChevronRight size={18} />}
        </button>
      </div>

      {/* Selector: Choose Item Type to Add */}
      {!editMode && !editingEquipment && !editingRoom && !editingTicket && !editingMultiFloorRef && (
        <div className="flex-column gap-lg">
          <p className="text-sm text-muted">
            {user ? 'Choose an item type to add to this floorplan:' : 'Add a multi-floor reference pin to this floorplan:'}
          </p>

          {/* Multi-Floor Reference Pin (Available for everyone) */}
          <button
            className="btn btn-multi-floor-ref btn-full"
            onClick={() => handleStartAddType('multi-floor-ref')}
          >
            <Layers size={18} /> Multi-Floor Reference Pin
          </button>

          {user && (
            <>
              <button
                className="btn btn-danger btn-full"
                onClick={() => handleStartAddType('ticket')}
              >
                <AlertCircle size={18} /> Report Issue / Ticket
              </button>

              {isEditor && (
                <>
                  <button
                    className="btn btn-primary btn-full"
                    onClick={() => handleStartAddType('equipment')}
                  >
                    <Plus size={18} /> Add Equipment
                  </button>
                  <button
                    className="btn btn-secondary btn-full"
                    onClick={() => handleStartAddType('room')}
                  >
                    <Plus size={18} /> Add Room
                  </button>
                </>
              )}
            </>
          )}

          {/* Prompt for unauthenticated users */}
          {!user && (
            <div className="unauth-drawer-card flex-column gap-sm p-md rounded-lg">
              <p className="text-xs text-muted m-0">
                Sign in to add rooms, equipment, or report issues.
              </p>
              <button
                type="button"
                className="btn btn-secondary btn-sm btn-full gap-xs"
                onClick={() => setIsLoginModalOpen(true)}
              >
                <LogIn size={14} />
                <span>Sign In</span>
              </button>
            </div>
          )}

          {/* Active Reference Pin Summary if placed */}
          {multiFloorRefPin && (
            <div className="active-ref-pin-box p-md rounded-lg flex-column gap-xs">
              <div className="flex-between items-center">
                <span className="text-xs font-semibold flex items-center gap-xs text-purple-accent">
                  <Layers size={14} /> Active Reference Pin
                </span>
                <button
                  className="btn btn-danger btn-icon-xs"
                  onClick={onRemoveMultiFloorRefPin}
                  title="Remove Reference Pin"
                >
                  <Trash2 size={13} />
                </button>
              </div>
              <span className="text-xs text-muted">
                Placed on: <strong className="text-primary">{multiFloorRefPin.floorplanName || `Floorplan #${multiFloorRefPin.floorplanId}`}</strong>
              </span>
              <div className="flex-row gap-xs mt-xs">
                <button
                  className="btn btn-secondary btn-xs flex-1 gap-xs"
                  onClick={() => handleStartAddType('multi-floor-ref')}
                >
                  <Crosshair size={12} />
                  <span>Relocate Pin</span>
                </button>
                <button
                  className="btn btn-danger btn-xs"
                  onClick={onRemoveMultiFloorRefPin}
                >
                  Remove
                </button>
              </div>
            </div>
          )}
        </div>
      )}

      {/* Multi-Floor Reference Pin Details (when clicked on map) */}
      {editingMultiFloorRef && !isRelocating && (
        <div className="flex-column gap-lg">
          <div className="p-md rounded-lg bg-subtle flex-column gap-sm border-purple">
            <div className="flex items-center gap-sm font-semibold text-purple-accent">
              <Layers size={18} />
              <span>Multi-Floor Reference Pin</span>
            </div>
            <p className="text-xs text-muted m-0">
              This reference pin is saved locally in your browser and automatically maps across all calibrated floorplans.
            </p>
            <div className="text-xs text-secondary mt-xs">
              <div><strong>Original Floor:</strong> {editingMultiFloorRef.floorplanName || `Floorplan #${editingMultiFloorRef.floorplanId}`}</div>
              <div><strong>Alignment Status:</strong> {editingMultiFloorRef.isSourceFloor ? 'Placed on this floor' : editingMultiFloorRef.isCalibrated ? 'Aligned & calibrated' : 'Uncalibrated'}</div>
              {editingMultiFloorRef.x_coordinate != null && (
                <div><strong>Coordinates:</strong> X: {Math.round(editingMultiFloorRef.x_coordinate)}, Y: {Math.round(editingMultiFloorRef.y_coordinate)}</div>
              )}
            </div>
          </div>

          <div className="flex-column gap-sm">
            <button
              className="btn btn-primary btn-full gap-sm"
              onClick={() => handleStartAddType('multi-floor-ref')}
            >
              <Crosshair size={16} /> Relocate Reference Pin
            </button>
            <button
              className="btn btn-danger btn-full gap-sm"
              onClick={() => {
                onRemoveMultiFloorRefPin();
                onClose();
              }}
            >
              <Trash2 size={16} /> Remove Reference Pin
            </button>
          </div>
        </div>
      )}

      {/* Placement Details Config Input (before clicking on map) */}
      {editMode && !newPinCoord && (activeActionType === 'room' || activeActionType === 'equipment' || activeActionType === 'ticket' || activeActionType === 'multi-floor-ref') && (
        <div className="flex-column gap-lg">
          <p className="text-sm text-muted">
            {activeActionType === 'multi-floor-ref'
              ? 'Click anywhere on the map to place the Multi-Floor Reference Pin. It will appear at the corresponding relative location across all calibrated floorplans.'
              : `Click anywhere on the map to place ${activeActionType === 'room' ? 'a room.' : activeActionType === 'equipment' ? 'equipment.' : 'an issue.'}`}
          </p>

          {activeActionType === 'multi-floor-ref' && (
            <button
              className="btn btn-secondary btn-full"
              onClick={handleCancelPlacement}
            >
              Cancel Placement
            </button>
          )}

          {(activeActionType === 'room' || activeActionType === 'equipment') && (
            <>
              <div className="input-group">
                <label>Next {activeActionType === 'room' ? 'Room' : 'Equipment'} Name</label>
                <input
                  type="text"
                  className={`input-field ${isNameError ? 'error shake' : ''}`}
                  value={activeActionType === 'room' ? nextRoomName : nextEquipName}
                  onChange={(e) => {
                    setIsNameError(false);
                    if (activeActionType === 'room') {
                      setNextRoomName(e.target.value);
                    } else {
                      setNextEquipName(e.target.value);
                    }
                  }}
                  placeholder="e.g. 2EN01"
                />
              </div>

              <div className="input-group">
                <label>Description (Optional)</label>
                <input
                  type="text"
                  className="input-field"
                  value={nextDescription}
                  onChange={(e) => setNextDescription(e.target.value)}
                  placeholder="e.g. Storage, Printer, etc."
                />
              </div>
            </>
          )}

          {activeActionType === 'equipment' && (
            <>
              <div className="input-group">
                <label>Tools Required (Optional)</label>
                <input
                  type="text"
                  className="input-field"
                  value={nextToolsRequired}
                  onChange={(e) => setNextToolsRequired(e.target.value)}
                  placeholder="e.g. Screwdriver, Drill"
                />
              </div>
              <div className="input-group">
                <label>Color</label>
                <div className="flex-row flex-wrap gap-sm">
                  {COLORS.map(c => (
                    <div
                      key={c}
                      onClick={() => {
                        setEquipColor(c);
                        localStorage.setItem('defaultEquipColor', c);
                      }}
                      className="color-swatch-sm"
                      style={{
                        backgroundColor: c,
                        border: equipColor === c ? '3px solid white' : '2px solid transparent',
                        boxShadow: equipColor === c ? `0 0 0 2px ${c}` : 'none'
                      }}
                    />
                  ))}
                </div>
              </div>
            </>
          )}
        </div>
      )}

      {/* Room Form: Add Mode */}
      {editMode && newPinCoord && activeActionType === 'room' && (
        <RoomForm
          newPinCoord={newPinCoord}
          isEditor={isEditor}
          isMobile={isMobile}
          formError={formError}
          setFormError={setFormError}
          onSubmit={onAddRoom}
          onCancel={() => {
            onReposition();
            onClose();
          }}
        />
      )}

      {/* Equipment Form: Add Mode */}
      {editMode && newPinCoord && activeActionType === 'equipment' && (
        <EquipmentForm
          newPinCoord={newPinCoord}
          isEditor={isEditor}
          isMobile={isMobile}
          formError={formError}
          setFormError={setFormError}
          equipColor={equipColor}
          setEquipColor={setEquipColor}
          onSubmit={onAddEquipment}
          onCancel={() => {
            onReposition();
            onClose();
          }}
        />
      )}

      {/* Ticket Form: Add Mode */}
      {editMode && newPinCoord && activeActionType === 'ticket' && (
        <TicketForm
          newPinCoord={newPinCoord}
          formError={formError}
          setFormError={setFormError}
          onSubmit={onAddTicket}
          onCancel={() => {
            onReposition();
            onClose();
          }}
        />
      )}

      {/* Room Form: Edit Mode */}
      {editingRoom && !isRelocating && (
        <RoomForm
          key={`room-${editingRoom.id}`}
          editingRoom={editingRoom}
          isEditor={isEditor}
          user={user}
          isMobile={isMobile}
          formError={formError}
          setFormError={setFormError}
          onSubmit={onUpdateRoom}
          onCancel={() => onClose()}
          onRelocate={() => {
            onRelocate();
            onClose();
          }}
          onDelete={onDeleteRoom}



        />
      )}

      {/* Equipment Form: Edit Mode */}
      {editingEquipment && !isRelocating && (
        <EquipmentForm
          key={`equip-${editingEquipment.id}`}
          editingEquipment={editingEquipment}
          isEditor={isEditor}
          user={user}
          isMobile={isMobile}
          formError={formError}
          setFormError={setFormError}
          equipColor={equipColor}
          setEquipColor={setEquipColor}
          onSubmit={onUpdateEquipment}
          onCancel={() => onClose()}
          onRelocate={() => {
            onRelocate();
            onClose();
          }}
          onDelete={onDeleteEquipment}



        />
      )}

      {/* Ticket Form: Edit Mode */}
      {editingTicket && !isRelocating && (
        <TicketForm
          key={`ticket-${editingTicket.id}`}
          editingTicket={editingTicket}
          formError={formError}
          setFormError={setFormError}
          onSubmit={onUpdateTicket}
          onCancel={() => onClose()}
          onRelocate={() => {
            onRelocate();
            onClose();
          }}
          onDelete={onDeleteTicket}
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
});
