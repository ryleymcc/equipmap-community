import { useRef, useState, useEffect } from 'react';
import { X, MapPin, Edit3, Building, UploadCloud, Layers, Plus, Check, Upload, RefreshCw } from 'lucide-react';
import { COLORS } from '../mapConstants';
import FloorplanRescaleModal from './FloorplanRescaleModal';

export default function DashboardModals({
  // Rename Floorplan
  isRenameModalOpen,
  setIsRenameModalOpen,
  floorplanToRename,
  setFloorplanToRename,
  handleRenameFloorplan,

  // Replace Floorplan File
  isReplaceFileModalOpen,
  setIsReplaceFileModalOpen,
  floorplanToReplaceFile,
  setFloorplanToReplaceFile,
  handleReplaceFloorplanFile,
  isReplacingFile,

  // Rescale Floorplan
  isRescaleModalOpen,
  setIsRescaleModalOpen,
  floorplanToRescale,
  setFloorplanToRescale,
  handleRescaleFloorplan,
  isRescaling,

  // Site Modals
  isSiteModalOpen,
  setIsSiteModalOpen,
  handleCreateSite,
  isRenameSiteModalOpen,
  setIsRenameSiteModalOpen,
  siteToRename,
  setSiteToRename,
  handleRenameSite,

  // Upload Floorplan
  isUploadModalOpen,
  setIsUploadModalOpen,
  handleUploadFloorplan,

  // Add Selection (Room or Equipment placement selector)
  isAddSelectionModalOpen,
  setIsAddSelectionModalOpen,
  addSelectionType,
  modalSiteId,
  modalFloorplans,
  modalFloorplanId,
  handleModalSiteChange,
  setModalFloorplanId,
  sites,
  navigate,

  // Bulk Edit
  isBulkEditModalOpen,
  setIsBulkEditModalOpen,
  bulkEditForm,
  setBulkEditForm,
  handleBulkUpdateEquip,
  selectedCount
}) {
  const renameNameRef = useRef();
  const siteNameRef = useRef();
  const renameSiteNameRef = useRef();
  const planNameRef = useRef();
  const fileRef = useRef();
  const replaceFileRef = useRef();

  const [selectedReplaceFile, setSelectedReplaceFile] = useState(null);
  const [openRescaleAfter, setOpenRescaleAfter] = useState(true);

  const [addName, setAddName] = useState('');
  const [addDescription, setAddDescription] = useState('');
  const [addToolsRequired, setAddToolsRequired] = useState('');
  const [addColor, setAddColor] = useState(COLORS[0]);

  useEffect(() => {
    if (!isReplaceFileModalOpen) {
      setSelectedReplaceFile(null);
    }
  }, [isReplaceFileModalOpen]);

  useEffect(() => {
    if (isAddSelectionModalOpen) {
      setAddName('');
      setAddDescription('');
      setAddToolsRequired('');
      setAddColor(COLORS[0]);
    }
  }, [isAddSelectionModalOpen, addSelectionType]);

  return (
    <>
      {/* Bulk Edit Modal */}
      {isBulkEditModalOpen && (
        <div className="modal-overlay modal-backdrop-dark" onClick={() => setIsBulkEditModalOpen(false)}>
          <div className="modal-card modal-md glass-panel" onClick={e => e.stopPropagation()}>
            <div className="modal-card-header">
              <div className="flex items-center gap-sm">
                <div className="icon-box-primary">
                  <Edit3 size={18} />
                </div>
                <div>
                  <h2 className="text-base font-bold text-primary m-0">
                    Bulk Edit ({selectedCount} items)
                  </h2>
                  <div className="text-xs text-muted">
                    Update fields for all selected equipment items
                  </div>
                </div>
              </div>
              <button
                type="button"
                className="btn btn-ghost btn-icon-xs text-muted hover:text-primary"
                onClick={() => setIsBulkEditModalOpen(false)}
                title="Close"
              >
                <X size={18} />
              </button>
            </div>

            <form
              onSubmit={(e) => {
                e.preventDefault();
                handleBulkUpdateEquip();
              }}
              className="modal-card-body"
            >
              <div className="input-group">
                <label className="flex items-center gap-xs cursor-pointer">
                  <input
                    type="checkbox"
                    id="override-description"
                    checked={bulkEditForm.descriptionOverridden}
                    onChange={e => setBulkEditForm(prev => ({ ...prev, descriptionOverridden: e.target.checked }))}
                  />
                  <span>Update Description</span>
                </label>
                <textarea
                  className="input-field mt-2xs"
                  value={bulkEditForm.description}
                  onChange={e => setBulkEditForm(prev => ({ ...prev, description: e.target.value, descriptionOverridden: true }))}
                  disabled={!bulkEditForm.descriptionOverridden}
                  placeholder="Enter new description for all selected items..."
                  rows={2}
                />
              </div>

              <div className="input-group">
                <label className="flex items-center gap-xs cursor-pointer">
                  <input
                    type="checkbox"
                    id="override-tools"
                    checked={bulkEditForm.tools_requiredOverridden}
                    onChange={e => setBulkEditForm(prev => ({ ...prev, tools_requiredOverridden: e.target.checked }))}
                  />
                  <span>Update Tools Required</span>
                </label>
                <input
                  type="text"
                  className="input-field mt-2xs"
                  value={bulkEditForm.tools_required}
                  onChange={e => setBulkEditForm(prev => ({ ...prev, tools_required: e.target.value, tools_requiredOverridden: true }))}
                  disabled={!bulkEditForm.tools_requiredOverridden}
                  placeholder="e.g. Wrench, Screwdriver"
                />
              </div>

              <div className="input-group">
                <label className="flex items-center gap-xs cursor-pointer">
                  <input
                    type="checkbox"
                    id="override-color"
                    checked={bulkEditForm.colorOverridden}
                    onChange={e => setBulkEditForm(prev => ({ ...prev, colorOverridden: e.target.checked }))}
                  />
                  <span>Update Pin Color</span>
                </label>
                <div className="flex flex-wrap gap-xs pt-xs">
                  {COLORS.map(code => (
                    <button
                      key={code}
                      type="button"
                      onClick={() => setBulkEditForm(prev => ({ ...prev, color: code, colorOverridden: true }))}
                      disabled={!bulkEditForm.colorOverridden}
                      className="color-swatch-item"
                      style={{
                        backgroundColor: code,
                        border: bulkEditForm.color === code ? '3px solid white' : '2px solid transparent',
                        cursor: bulkEditForm.colorOverridden ? 'pointer' : 'default',
                        boxShadow: bulkEditForm.color === code ? `0 0 0 2px ${code}` : 'none',
                        opacity: bulkEditForm.colorOverridden ? 1 : 0.4
                      }}
                    />
                  ))}
                </div>
              </div>

              <div className="modal-card-footer mt-md">
                <button
                  type="button"
                  className="btn btn-secondary btn-sm"
                  onClick={() => setIsBulkEditModalOpen(false)}
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="btn btn-primary btn-sm gap-xs"
                  disabled={!bulkEditForm.descriptionOverridden && !bulkEditForm.colorOverridden && !bulkEditForm.tools_requiredOverridden}
                >
                  <Check size={14} />
                  <span>Apply Changes</span>
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Rename Floorplan Modal */}
      {isRenameModalOpen && floorplanToRename && (
        <div className="modal-overlay modal-backdrop-dark" onClick={() => { setIsRenameModalOpen(false); setFloorplanToRename(null); }}>
          <div className="modal-card modal-sm glass-panel" onClick={e => e.stopPropagation()}>
            <div className="modal-card-header">
              <div className="flex items-center gap-sm">
                <div className="icon-box-primary">
                  <Layers size={18} />
                </div>
                <div>
                  <h2 className="text-base font-bold text-primary m-0">Rename Floorplan</h2>
                  <div className="text-xs text-muted">Update floorplan label</div>
                </div>
              </div>
              <button
                type="button"
                className="btn btn-ghost btn-icon-xs text-muted hover:text-primary"
                onClick={() => { setIsRenameModalOpen(false); setFloorplanToRename(null); }}
                title="Close"
              >
                <X size={18} />
              </button>
            </div>
            <form
              onSubmit={(e) => {
                e.preventDefault();
                handleRenameFloorplan(renameNameRef.current?.value);
              }}
              className="modal-card-body"
            >
              <div className="input-group">
                <label>New Floorplan Name</label>
                <input
                  ref={renameNameRef}
                  className="input-field"
                  defaultValue={floorplanToRename.name}
                  required
                  autoFocus
                />
              </div>
              <div className="modal-card-footer mt-md">
                <button
                  type="button"
                  className="btn btn-secondary btn-sm"
                  onClick={() => { setIsRenameModalOpen(false); setFloorplanToRename(null); }}
                >
                  Cancel
                </button>
                <button type="submit" className="btn btn-primary btn-sm gap-xs">
                  <Check size={14} />
                  <span>Save Name</span>
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Replace Floorplan File Modal */}
      {isReplaceFileModalOpen && floorplanToReplaceFile && (
        <div
          className="modal-overlay modal-backdrop-dark"
          onClick={() => {
            if (!isReplacingFile) {
              setIsReplaceFileModalOpen(false);
              setFloorplanToReplaceFile(null);
              setSelectedReplaceFile(null);
            }
          }}
        >
          <div className="modal-card modal-md glass-panel" onClick={e => e.stopPropagation()}>
            <div className="modal-card-header">
              <div className="flex items-center gap-sm">
                <div className="icon-box-primary">
                  <UploadCloud size={18} />
                </div>
                <div>
                  <h2 className="text-base font-bold text-primary m-0">Replace Floorplan File</h2>
                  <div className="text-xs text-muted">
                    Updating background for <strong className="text-primary">{floorplanToReplaceFile.name}</strong>
                  </div>
                </div>
              </div>
              <button
                type="button"
                className="btn btn-ghost btn-icon-xs text-muted hover:text-primary"
                disabled={isReplacingFile}
                onClick={() => {
                  setIsReplaceFileModalOpen(false);
                  setFloorplanToReplaceFile(null);
                  setSelectedReplaceFile(null);
                }}
                title="Close"
              >
                <X size={18} />
              </button>
            </div>

            <form
              onSubmit={(e) => {
                e.preventDefault();
                const file = selectedReplaceFile || replaceFileRef.current?.files?.[0];
                if (file && handleReplaceFloorplanFile) {
                  handleReplaceFloorplanFile(floorplanToReplaceFile.id, file, openRescaleAfter);
                }
              }}
              className="modal-card-body"
            >
              <div className="input-group">
                <label>Select New File (PDF, Image, SVG, or GLB)</label>
                <input
                  ref={replaceFileRef}
                  type="file"
                  accept=".svg,.pdf,.png,.jpg,.jpeg,.webp,.gif,.glb,image/*,model/gltf-binary"
                  className="input-field"
                  required
                  disabled={isReplacingFile}
                  onChange={(e) => {
                    if (e.target.files?.[0]) {
                      setSelectedReplaceFile(e.target.files[0]);
                    }
                  }}
                />
              </div>

              {selectedReplaceFile && (
                <div className="p-sm rounded text-xs flex items-center gap-xs" style={{ backgroundColor: 'var(--surface-sunken)', border: '1px solid var(--panel-border)' }}>
                  <Upload size={14} className="text-primary" />
                  <span className="font-semibold">{selectedReplaceFile.name}</span>
                  <span className="text-muted">({(selectedReplaceFile.size / 1024).toFixed(1)} KB)</span>
                </div>
              )}

              <div className="p-sm rounded text-xs text-muted" style={{ backgroundColor: 'var(--surface-sunken)', border: '1px solid var(--panel-border)' }}>
                ℹ️ <strong>Note:</strong> All existing equipment pins, rooms, tickets, and calibrated reference points on this floorplan will be preserved.
              </div>

              <div className="flex items-center gap-xs">
                <input
                  type="checkbox"
                  id="open-rescale-after"
                  checked={openRescaleAfter}
                  onChange={e => setOpenRescaleAfter(e.target.checked)}
                  disabled={isReplacingFile}
                />
                <label htmlFor="open-rescale-after" className="m-0 text-xs font-medium cursor-pointer">
                  Open Rescale tool after upload to adjust scale & alignment
                </label>
              </div>

              <div className="modal-card-footer mt-md">
                <button
                  type="button"
                  className="btn btn-secondary btn-sm"
                  disabled={isReplacingFile}
                  onClick={() => {
                    setIsReplaceFileModalOpen(false);
                    setFloorplanToReplaceFile(null);
                    setSelectedReplaceFile(null);
                  }}
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="btn btn-primary btn-sm gap-xs"
                  disabled={isReplacingFile || (!selectedReplaceFile && !replaceFileRef.current?.files?.[0])}
                >
                  {isReplacingFile && <RefreshCw size={14} className="spinning" />}
                  <span>{isReplacingFile ? 'Replacing...' : 'Replace File'}</span>
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Rescale Floorplan Modal */}
      <FloorplanRescaleModal
        isOpen={isRescaleModalOpen}
        onClose={() => {
          if (setIsRescaleModalOpen) setIsRescaleModalOpen(false);
          if (setFloorplanToRescale) setFloorplanToRescale(null);
        }}
        floorplan={floorplanToRescale}
        onApplyRescale={handleRescaleFloorplan}
        isRescaling={isRescaling}
      />

      {/* Create Site Modal */}
      {isSiteModalOpen && (
        <div className="modal-overlay modal-backdrop-dark" onClick={() => setIsSiteModalOpen(false)}>
          <div className="modal-card modal-sm glass-panel" onClick={e => e.stopPropagation()}>
            <div className="modal-card-header">
              <div className="flex items-center gap-sm">
                <div className="icon-box-primary">
                  <Building size={18} />
                </div>
                <div>
                  <h2 className="text-base font-bold text-primary m-0">Create New Site</h2>
                  <div className="text-xs text-muted">Add a new building or facility location</div>
                </div>
              </div>
              <button
                type="button"
                className="btn btn-ghost btn-icon-xs text-muted hover:text-primary"
                onClick={() => setIsSiteModalOpen(false)}
                title="Close"
              >
                <X size={18} />
              </button>
            </div>
            <form
              onSubmit={(e) => {
                e.preventDefault();
                handleCreateSite(siteNameRef.current?.value);
              }}
              className="modal-card-body"
            >
              <div className="input-group">
                <label>Site Name</label>
                <input
                  ref={siteNameRef}
                  className="input-field"
                  placeholder="e.g. Main Hospital, North Campus"
                  required
                  autoFocus
                />
              </div>
              <div className="modal-card-footer mt-md">
                <button
                  type="button"
                  className="btn btn-secondary btn-sm"
                  onClick={() => setIsSiteModalOpen(false)}
                >
                  Cancel
                </button>
                <button type="submit" className="btn btn-primary btn-sm gap-xs">
                  <Plus size={14} />
                  <span>Create Site</span>
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Rename Site Modal */}
      {isRenameSiteModalOpen && siteToRename && (
        <div className="modal-overlay modal-backdrop-dark" onClick={() => { setIsRenameSiteModalOpen(false); setSiteToRename(null); }}>
          <div className="modal-card modal-sm glass-panel" onClick={e => e.stopPropagation()}>
            <div className="modal-card-header">
              <div className="flex items-center gap-sm">
                <div className="icon-box-primary">
                  <Building size={18} />
                </div>
                <div>
                  <h2 className="text-base font-bold text-primary m-0">Rename Site</h2>
                  <div className="text-xs text-muted">Update site name</div>
                </div>
              </div>
              <button
                type="button"
                className="btn btn-ghost btn-icon-xs text-muted hover:text-primary"
                onClick={() => { setIsRenameSiteModalOpen(false); setSiteToRename(null); }}
                title="Close"
              >
                <X size={18} />
              </button>
            </div>
            <form
              onSubmit={(e) => {
                e.preventDefault();
                handleRenameSite(renameSiteNameRef.current?.value);
              }}
              className="modal-card-body"
            >
              <div className="input-group">
                <label>New Site Name</label>
                <input
                  ref={renameSiteNameRef}
                  className="input-field"
                  defaultValue={siteToRename.name}
                  required
                  autoFocus
                />
              </div>
              <div className="modal-card-footer mt-md">
                <button
                  type="button"
                  className="btn btn-secondary btn-sm"
                  onClick={() => { setIsRenameSiteModalOpen(false); setSiteToRename(null); }}
                >
                  Cancel
                </button>
                <button type="submit" className="btn btn-primary btn-sm gap-xs">
                  <Check size={14} />
                  <span>Save Name</span>
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Upload Floorplan Modal */}
      {isUploadModalOpen && (
        <div className="modal-overlay modal-backdrop-dark" onClick={() => setIsUploadModalOpen(false)}>
          <div className="modal-card modal-md glass-panel" onClick={e => e.stopPropagation()}>
            <div className="modal-card-header">
              <div className="flex items-center gap-sm">
                <div className="icon-box-primary">
                  <UploadCloud size={18} />
                </div>
                <div>
                  <h2 className="text-base font-bold text-primary m-0">Upload Floorplan</h2>
                  <div className="text-xs text-muted">Upload SVG, PDF, or image architectural map</div>
                </div>
              </div>
              <button
                type="button"
                className="btn btn-ghost btn-icon-xs text-muted hover:text-primary"
                onClick={() => setIsUploadModalOpen(false)}
                title="Close"
              >
                <X size={18} />
              </button>
            </div>
            <form
              onSubmit={(e) => {
                e.preventDefault();
                handleUploadFloorplan(planNameRef.current?.value, fileRef.current?.files[0]);
              }}
              className="modal-card-body"
            >
              <div className="input-group">
                <label>Floorplan Name</label>
                <input
                  ref={planNameRef}
                  className="input-field"
                  placeholder="e.g. Ground Floor, Level 2 East"
                  required
                  autoFocus
                />
              </div>
              <div className="input-group">
                <label>File (SVG, PDF, Image, or 3D GLB)</label>
                <input
                  ref={fileRef}
                  type="file"
                  accept=".svg,.pdf,.png,.jpg,.jpeg,.webp,.gif,.glb,image/*,model/gltf-binary"
                  className="input-field"
                  required
                />
              </div>
              <div className="modal-card-footer mt-md">
                <button
                  type="button"
                  className="btn btn-secondary btn-sm"
                  onClick={() => setIsUploadModalOpen(false)}
                >
                  Cancel
                </button>
                <button type="submit" className="btn btn-primary btn-sm gap-xs">
                  <UploadCloud size={14} />
                  <span>Upload Floorplan</span>
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Add Selection Modal */}
      {isAddSelectionModalOpen && (
        <div className="modal-overlay modal-backdrop-dark" onClick={() => setIsAddSelectionModalOpen(false)}>
          <div className="modal-card modal-md glass-panel" onClick={e => e.stopPropagation()}>
            <div className="modal-card-header">
              <div className="flex items-center gap-sm">
                <div className="icon-box-primary">
                  <MapPin size={18} />
                </div>
                <div>
                  <h2 className="text-base font-bold text-primary m-0">
                    Add {addSelectionType === 'room' ? 'Room' : 'Equipment'}
                  </h2>
                  <div className="text-xs text-muted">
                    Choose location and details to place on map
                  </div>
                </div>
              </div>
              <button
                type="button"
                className="btn btn-ghost btn-icon-xs text-muted hover:text-primary"
                onClick={() => setIsAddSelectionModalOpen(false)}
                title="Close"
              >
                <X size={18} />
              </button>
            </div>
            <form
              onSubmit={(e) => {
                e.preventDefault();
                if (!modalFloorplanId) return;
                setIsAddSelectionModalOpen(false);
                navigate(`/map/${modalFloorplanId}`, {
                  state: {
                    initiateAddType: addSelectionType,
                    initialData: {
                      name: addName.trim(),
                      description: addDescription.trim(),
                      tools_required: addToolsRequired.trim(),
                      color: addColor
                    }
                  }
                });
              }}
              className="modal-card-body"
            >
              <div className="input-group">
                <label>Select Site</label>
                <select
                  className="input-field"
                  value={modalSiteId}
                  onChange={e => handleModalSiteChange(parseInt(e.target.value))}
                  required
                >
                  {sites.map(s => (
                    <option key={s.id} value={s.id}>{s.name}</option>
                  ))}
                </select>
              </div>

              <div className="input-group">
                <label>Select Floorplan</label>
                <select
                  className="input-field"
                  value={modalFloorplanId}
                  onChange={e => setModalFloorplanId(parseInt(e.target.value))}
                  required
                  disabled={modalFloorplans.length === 0}
                >
                  {modalFloorplans.map(fp => (
                    <option key={fp.id} value={fp.id}>{fp.name}</option>
                  ))}
                  {modalFloorplans.length === 0 && <option value="">No floorplans available</option>}
                </select>
              </div>

              <div className="input-group">
                <label>
                  {addSelectionType === 'room' ? 'Room Name (optional)' : (
                    <>
                      Equipment Name <span className="text-danger">*</span>
                    </>
                  )}
                </label>
                <input
                  type="text"
                  className="input-field"
                  placeholder={addSelectionType === 'room' ? 'e.g. 2EN01 (auto-increments if empty)' : 'e.g. AHU-1, Pump #4'}
                  value={addName}
                  onChange={e => setAddName(e.target.value)}
                  required={addSelectionType === 'equipment'}
                />
              </div>

              <div className="input-group">
                <label>Description (optional)</label>
                <input
                  type="text"
                  className="input-field"
                  placeholder="e.g. Storage room, Main cooling pump"
                  value={addDescription}
                  onChange={e => setAddDescription(e.target.value)}
                />
              </div>

              {addSelectionType === 'equipment' && (
                <>
                  <div className="input-group">
                    <label>Tools Required (optional)</label>
                    <input
                      type="text"
                      className="input-field"
                      placeholder="e.g. Screwdriver, Multimeter"
                      value={addToolsRequired}
                      onChange={e => setAddToolsRequired(e.target.value)}
                    />
                  </div>

                  <div className="input-group">
                    <label>Pin Color</label>
                    <div className="flex flex-wrap gap-xs pt-2xs">
                      {COLORS.map(c => (
                        <button
                          key={c}
                          type="button"
                          onClick={() => setAddColor(c)}
                          className="color-swatch-item"
                          style={{
                            backgroundColor: c,
                            border: addColor === c ? '3px solid white' : '2px solid transparent',
                            boxShadow: addColor === c ? `0 0 0 2px ${c}` : 'none',
                            cursor: 'pointer'
                          }}
                        />
                      ))}
                    </div>
                  </div>
                </>
              )}

              <div className="modal-card-footer mt-md">
                <button
                  type="button"
                  className="btn btn-secondary btn-sm"
                  onClick={() => setIsAddSelectionModalOpen(false)}
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="btn btn-primary btn-sm gap-xs"
                  disabled={!modalFloorplanId}
                >
                  <MapPin size={14} />
                  <span>Place on Map</span>
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </>
  );
}
