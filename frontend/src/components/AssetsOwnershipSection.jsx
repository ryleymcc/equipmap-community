import { Building2 } from 'lucide-react';
import EntitySearchSelector from './EntitySearchSelector';
import './AssetsOwnershipSection.css';

export default function AssetsOwnershipSection({
  headingId,
  title = 'Assets and ownership',
  description,
  sites = null,
  floorplans = null,
  selectedSiteId = '',
  selectedFloorplanId = '',
  onSiteChange,
  onFloorplanChange,
  siteAllLabel = 'All sites',
  floorplanAllLabel = 'All floorplans',
  equipment = [],
  selectedEquipmentIds = [],
  onToggleEquipment,
  onClearEquipment,
  equipmentPlaceholder = 'Search equipment...',
  rooms = [],
  selectedRoomIds = [],
  onToggleRoom,
  onClearRooms,
  roomPlaceholder = 'Search rooms...',
  technicians = null,
  selectedTechnicianIds = [],
  onToggleTechnician,
  onClearTechnicians,
  technicianPlaceholder = 'Search staff and technicians...',
  technicianDisabled = false,
  technicianDisabledMessage,
  children,
}) {
  const showLocationFilters = Array.isArray(sites) && Array.isArray(floorplans);
  const showTechnicians = Array.isArray(technicians);

  return (
    <section className="assets-ownership-section" aria-labelledby={headingId}>
      <div className="assets-ownership-heading">
        <div className="assets-ownership-icon" aria-hidden="true">
          <Building2 size={16} />
        </div>
        <div>
          <h3 id={headingId}>{title}</h3>
          {description && <p>{description}</p>}
        </div>
      </div>

      {showLocationFilters && (
        <div className="assets-ownership-location-grid">
          <div className="assets-ownership-field">
            <label htmlFor={`${headingId}-site`}>Site</label>
            <select
              id={`${headingId}-site`}
              className="input-field"
              value={selectedSiteId}
              onChange={event => onSiteChange?.(event.target.value)}
            >
              <option value="">{siteAllLabel}</option>
              {sites.map(site => <option key={site.id} value={site.id}>{site.name}</option>)}
            </select>
          </div>

          <div className="assets-ownership-field">
            <label htmlFor={`${headingId}-floorplan`}>Floorplan</label>
            <select
              id={`${headingId}-floorplan`}
              className="input-field"
              disabled={!selectedSiteId}
              value={selectedFloorplanId}
              onChange={event => onFloorplanChange?.(event.target.value)}
            >
              <option value="">{floorplanAllLabel}</option>
              {floorplans.map(floorplan => <option key={floorplan.id} value={floorplan.id}>{floorplan.name}</option>)}
            </select>
          </div>
        </div>
      )}

      <EntitySearchSelector
        entityType="equipment"
        label="Equipment"
        items={equipment}
        selectedIds={selectedEquipmentIds}
        onToggle={onToggleEquipment}
        onClearAll={onClearEquipment}
        placeholder={equipmentPlaceholder}
      />

      <EntitySearchSelector
        entityType="room"
        label="Rooms"
        items={rooms}
        selectedIds={selectedRoomIds}
        onToggle={onToggleRoom}
        onClearAll={onClearRooms}
        placeholder={roomPlaceholder}
      />

      {showTechnicians && (
        <EntitySearchSelector
          entityType="technician"
          label="Assigned technicians"
          items={technicians}
          selectedIds={selectedTechnicianIds}
          onToggle={onToggleTechnician}
          onClearAll={onClearTechnicians}
          placeholder={technicianPlaceholder}
          disabled={technicianDisabled}
          disabledMessage={technicianDisabledMessage}
        />
      )}

      {children}
    </section>
  );
}
