import { useEffect, useState } from 'react';
import QRCode from '../utils/qrcode';
import {
  Building, MapPin, User, Calendar,
  CheckSquare, Wrench, Layers
} from 'lucide-react';
import WorkOrderMapCrop from './WorkOrderMapCrop';

export default function WorkOrderPrintSheet({
  workOrder,
  options = {
    showMap: true,
    showChecklist: true,
  },
  floorplan = null,
  isBulk = false,
  pageIndex = 1,
  totalPages = 1
}) {
  const [qrDataUrl, setQrDataUrl] = useState('');
  const wo = workOrder;

  // Generate QR code linking directly to the work order in EquipMap
  useEffect(() => {
    if (!wo?.id) return;
    let isMounted = true;
    const origin = typeof window !== 'undefined' ? window.location.origin : '';
    const workOrderUrl = `${origin}/work-orders?woId=${wo.id}`;

    QRCode.toDataURL(workOrderUrl, {
      width: 160,
      margin: 1,
      color: {
        dark: '#0f172a',
        light: '#ffffff'
      },
      errorCorrectionLevel: 'M'
    })
      .then(url => {
        if (isMounted) setQrDataUrl(url);
      })
      .catch(err => {
        console.error('Error generating QR code for work order:', err);
      });

    return () => {
      isMounted = false;
    };
  }, [wo?.id]);

  if (!wo) return null;

  const formatDate = (dateStr, includeTime = false) => {
    if (!dateStr) return '—';
    try {
      const d = new Date(dateStr);
      if (includeTime) {
        return d.toLocaleDateString('en-US', {
          month: 'short',
          day: 'numeric',
          year: 'numeric',
          hour: '2-digit',
          minute: '2-digit'
        });
      }
      return d.toLocaleDateString('en-US', {
        month: 'short',
        day: 'numeric',
        year: 'numeric'
      });
    } catch {
      return dateStr;
    }
  };

  const priority = (wo.priority || 'medium').toLowerCase();
  let priorityLabel = 'Medium Priority';
  let priorityBg = '#f1f5f9';
  let priorityColor = '#0f172a';
  let priorityBorder = '#94a3b8';

  if (priority === 'urgent' || priority === 'emergency') {
    priorityLabel = 'URGENT / EMERGENCY';
    priorityBg = '#fee2e2';
    priorityColor = '#991b1b';
    priorityBorder = '#dc2626';
  } else if (priority === 'high') {
    priorityLabel = 'HIGH PRIORITY';
    priorityBg = '#ffedd5';
    priorityColor = '#9a3412';
    priorityBorder = '#ea580c';
  } else if (priority === 'low') {
    priorityLabel = 'LOW PRIORITY';
    priorityBg = '#ecfdf5';
    priorityColor = '#065f46';
    priorityBorder = '#059669';
  }

  const checklist = Array.isArray(wo.checklist_items) ? wo.checklist_items : [];
  const rooms = Array.isArray(wo.rooms) ? wo.rooms : [];
  const equipment = Array.isArray(wo.equipment) ? wo.equipment : [];

  return (
    <div className="wo-print-sheet">
      {/* ========================================================
          1. PRINT HEADER BAR
          ======================================================== */}
      <div className="wo-print-header">
        <div className="wo-print-header-left">
          <div className="wo-print-org-title">
            EQUIPMAP FACILITIES & MAINTENANCE OPERATIONS
          </div>
          <div className="wo-print-sheet-title">
            WORK ORDER TICKET
          </div>
          <div className="wo-print-order-number">
            {wo.order_number || `WO-${wo.id}`}
          </div>
        </div>

        {/* Center: Badges (Priority & Category - Status omitted for print) */}
        <div className="wo-print-header-badges">
          <div
            className="wo-print-badge"
            style={{ backgroundColor: priorityBg, color: priorityColor, borderColor: priorityBorder }}
          >
            {priorityLabel}
          </div>
          <div className="wo-print-badge wo-print-badge-category">
            {wo.category || 'General Maintenance'}
          </div>
        </div>

        {/* Right: Scannable QR Code */}
        <div className="wo-print-qr-section">
          {qrDataUrl ? (
            <img
              src={qrDataUrl}
              alt={`QR code for ${wo.order_number}`}
              className="wo-print-qr-img"
            />
          ) : (
            <div className="wo-print-qr-placeholder" />
          )}
          <div className="wo-print-qr-caption">
            Scan to Open in EquipMap
          </div>
        </div>
      </div>

      {/* ========================================================
          2. WORK REQUEST TITLE & DESCRIPTION
          ======================================================== */}
      <div className="wo-print-section wo-print-title-box">
        <h1 className="wo-print-main-title">{wo.title}</h1>
        {wo.description ? (
          <p className="wo-print-description">{wo.description}</p>
        ) : (
          <p className="wo-print-description text-italic">No additional description notes provided.</p>
        )}
      </div>

      {/* ========================================================
          3. TWO-COLUMN CORE METADATA & LOCATION / MAP
          ======================================================== */}
      <div className="wo-print-two-col">
        {/* Left Column: Location Details & Cropped Map */}
        <div className="wo-print-col wo-print-col-location">
          <div className="wo-print-subheading">
            <Building size={14} />
            <span>FACILITY & LOCATION DETAILS</span>
          </div>

          <div className="wo-print-location-info">
            <div className="wo-print-info-row">
              <span className="wo-print-label">Site / Campus:</span>
              <span className="wo-print-val font-bold">{wo.site_name || 'Main Campus / Facility'}</span>
            </div>
            <div className="wo-print-info-row">
              <span className="wo-print-label">Floorplan:</span>
              <span className="wo-print-val">{wo.floorplan_name || 'Main Floor / Building Area'}</span>
            </div>

            {/* Linked Rooms Summary */}
            {rooms.length === 1 && (
              <div className="wo-print-info-row">
                <span className="wo-print-label">Room:</span>
                <span className="wo-print-val font-semibold">Room {rooms[0].name}</span>
              </div>
            )}
            {rooms.length > 1 && (
              <div className="wo-print-info-row">
                <span className="wo-print-label">Rooms Scope:</span>
                <span className="wo-print-val font-semibold">
                  {rooms.length} Rooms Included (See Scope Breakdown below)
                </span>
              </div>
            )}

            {/* Linked Equipment Summary */}
            {equipment.length === 1 && (
              <div className="wo-print-info-row">
                <span className="wo-print-label">Equipment:</span>
                <span className="wo-print-val font-semibold">
                  {equipment[0].name}
                  {equipment[0].tools_required && (
                    <span className="wo-print-subval"> (Tools: {equipment[0].tools_required})</span>
                  )}
                </span>
              </div>
            )}
            {equipment.length > 1 && (
              <div className="wo-print-info-row">
                <span className="wo-print-label">Equipment Scope:</span>
                <span className="wo-print-val font-semibold">
                  {equipment.length} Assets Included (See Asset Table below)
                </span>
              </div>
            )}

            {wo.location_details && (
              <div className="wo-print-info-row">
                <span className="wo-print-label">Location Notes:</span>
                <span className="wo-print-val">{wo.location_details}</span>
              </div>
            )}
          </div>

          {/* CROPPED MAP SNIPPET */}
          {options.showMap && (
            <div className="wo-print-map-wrapper">
              <div className="wo-print-map-caption">
                <MapPin size={12} />
                <span>FLOORPLAN LOCATION PINPOINT</span>
              </div>
              <WorkOrderMapCrop
                workOrder={wo}
                floorplan={floorplan}
                width={480}
                height={240}
                cropZoom={1.1}
                className="wo-print-map-crop"
              />
            </div>
          )}
        </div>

        {/* Right Column: Request Info, Assignments, Timestamps & Checklists */}
        <div className="wo-print-col wo-print-col-meta">
          {/* Assignment & Requester */}
          <div className="wo-print-subheading">
            <User size={14} />
            <span>ASSIGNMENT & CONTACT</span>
          </div>

          <div className="wo-print-info-grid">
            <div className="wo-print-info-row">
              <span className="wo-print-label">Requester:</span>
              <span className="wo-print-val font-semibold">{wo.requester_name || 'Anonymous User'}</span>
            </div>
            {wo.requester_phone && (
              <div className="wo-print-info-row">
                <span className="wo-print-label">Phone:</span>
                <span className="wo-print-val">{wo.requester_phone}</span>
              </div>
            )}
            {wo.requester_email && (
              <div className="wo-print-info-row">
                <span className="wo-print-label">Email:</span>
                <span className="wo-print-val">{wo.requester_email}</span>
              </div>
            )}
            <div className="wo-print-info-row">
              <span className="wo-print-label">Assigned Tech:</span>
              <span className="wo-print-val font-bold">
                {wo.assignees?.length > 0
                  ? wo.assignees.map(u => u.full_name || u.username).join(', ')
                  : 'Unassigned (Awaiting Dispatch)'}
              </span>
            </div>
            {(wo.triaged_by_name || wo.triaged_by_username) && (
              <div className="wo-print-info-row">
                <span className="wo-print-label">Triaged By:</span>
                <span className="wo-print-val">{wo.triaged_by_name || wo.triaged_by_username}</span>
              </div>
            )}
          </div>

          {/* Timestamps & Hours */}
          <div className="wo-print-subheading mt-md">
            <Calendar size={14} />
            <span>SCHEDULE & LABOR TARGETS</span>
          </div>

          <div className="wo-print-info-grid">
            <div className="wo-print-info-row">
              <span className="wo-print-label">Created:</span>
              <span className="wo-print-val">{formatDate(wo.created_at, true)}</span>
            </div>
            {wo.start_date && (
              <div className="wo-print-info-row">
                <span className="wo-print-label">Scheduled Start:</span>
                <span className="wo-print-val">{formatDate(wo.start_date, true)}</span>
              </div>
            )}
            {wo.due_date && (
              <div className="wo-print-info-row">
                <span className="wo-print-label">Due Date:</span>
                <span className="wo-print-val font-semibold">{formatDate(wo.due_date, true)}</span>
              </div>
            )}
            <div className="wo-print-info-row">
              <span className="wo-print-label">Est. Hours:</span>
              <span className="wo-print-val">{wo.estimated_hours || 0} hrs</span>
            </div>
            {wo.trade && (
              <div className="wo-print-info-row">
                <span className="wo-print-label">Trade / Craft:</span>
                <span className="wo-print-val font-semibold">{wo.trade}</span>
              </div>
            )}
          </div>

          {/* Checklist Items */}
          {options.showChecklist && checklist.length > 0 && (
            <div className="wo-print-checklist-section">
              <div className="wo-print-subheading mt-md">
                <CheckSquare size={14} />
                <span>TASK CHECKLIST ({checklist.length})</span>
              </div>
              <div className="wo-print-checklist-items">
                {checklist.map((item, idx) => {
                  const label = typeof item === 'string'
                    ? item
                    : (item.task || item.description || item.text || item.label || `Step ${idx + 1}`);
                  const isChecked = typeof item === 'object' && Boolean(item.completed);
                  const isReading = typeof item === 'object' && (item.type === 'reading' || Boolean(item.unit));
                  const readingUnit = typeof item === 'object' ? item.unit : null;
                  const readingValue = typeof item === 'object' ? item.value : null;

                  return (
                    <div key={item.id || idx} className="wo-print-checklist-row">
                      <div className="wo-print-checkbox-box">
                        {isChecked ? '✓' : ''}
                      </div>
                      <div className="wo-print-checklist-content">
                        <span className={`wo-print-checklist-label ${isChecked ? 'line-through' : ''}`}>
                          {label}
                        </span>
                        {isReading && (
                          <span className="wo-print-reading-box">
                            {readingValue ? (
                              <strong>{readingValue} {readingUnit || ''}</strong>
                            ) : (
                              <span>[ &nbsp; &nbsp; &nbsp; &nbsp; &nbsp; &nbsp; ] {readingUnit ? `(${readingUnit})` : ''}</span>
                            )}
                          </span>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          )}
        </div>
      </div>

      {/* ========================================================
          4. APPLICABLE EQUIPMENT & ASSET SCOPE (TABLE FORMAT)
          ======================================================== */}
      {equipment.length > 0 && (
        <div className="wo-print-scope-section">
          <div className="wo-print-scope-header">
            <Wrench size={13} />
            <span>APPLICABLE EQUIPMENT & ASSET SCOPE ({equipment.length})</span>
          </div>

          <div className="wo-print-table-wrapper">
            <table className="wo-print-scope-table">
              <thead>
                <tr>
                  <th style={{ width: '45px', textAlign: 'center' }}>Check</th>
                  <th style={{ width: '30%' }}>Asset / Equipment Name</th>
                  <th style={{ width: '22%' }}>Floorplan / Location</th>
                  <th style={{ width: '22%' }}>Tools & Requirements</th>
                  <th>Asset Notes / Specs</th>
                </tr>
              </thead>
              <tbody>
                {equipment.map((eq, idx) => (
                  <tr key={eq.id || idx}>
                    <td style={{ textAlign: 'center' }}>
                      <div className="wo-print-checkbox-box mx-auto" />
                    </td>
                    <td className="font-bold text-slate-900">{eq.name}</td>
                    <td>{eq.floorplan_name || wo.floorplan_name || 'Main Campus'}</td>
                    <td>{eq.tools_required || 'Standard tech kit'}</td>
                    <td className="text-slate-600">{eq.description || '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* ========================================================
          5. TARGET ROOMS & SERVICE AREAS (STRUCTURED GRID)
          ======================================================== */}
      {rooms.length > 0 && (
        <div className="wo-print-scope-section">
          <div className="wo-print-scope-header">
            <Layers size={13} />
            <span>TARGET ROOMS & SERVICE AREAS ({rooms.length})</span>
          </div>

          {rooms.length > 6 ? (
            <div className="wo-print-rooms-compact-grid">
              {rooms.map((rm, idx) => (
                <div key={rm.id || idx} className="wo-print-room-compact-item">
                  <div className="wo-print-checkbox-box" />
                  <div className="wo-print-room-compact-text">
                    <span className="font-bold">Room {rm.name}</span>
                    {rm.floorplan_name && <span className="text-muted text-2xs"> ({rm.floorplan_name})</span>}
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <div className="wo-print-table-wrapper">
              <table className="wo-print-scope-table">
                <thead>
                  <tr>
                    <th style={{ width: '45px', textAlign: 'center' }}>Check</th>
                    <th style={{ width: '25%' }}>Room Name / Number</th>
                    <th style={{ width: '30%' }}>Floor / Building Area</th>
                    <th>Room Details & Description</th>
                  </tr>
                </thead>
                <tbody>
                  {rooms.map((rm, idx) => (
                    <tr key={rm.id || idx}>
                      <td style={{ textAlign: 'center' }}>
                        <div className="wo-print-checkbox-box mx-auto" />
                      </td>
                      <td className="font-bold text-slate-900">Room {rm.name}</td>
                      <td>{rm.floorplan_name || wo.floorplan_name || 'Main Facility'}</td>
                      <td className="text-slate-600">{rm.description || '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {/* ========================================================
          6. FOOTER
          ======================================================== */}
      <div className="wo-print-footer">
        <div>EquipMap Facility Operations • Order #{wo.order_number || wo.id}</div>
        <div>Printed on {new Date().toLocaleString()}</div>
        {isBulk && (
          <div>Page {pageIndex} of {totalPages}</div>
        )}
      </div>
    </div>
  );
}
