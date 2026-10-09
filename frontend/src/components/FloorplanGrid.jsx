import { Map as MapIcon, MoreVertical, Pencil, Trash2, RefreshCw, Upload } from 'lucide-react';
import { floorplanLogger } from '../floorplanLogger';

export default function FloorplanGrid({
  activeSite,
  setActiveSite,
  sites,
  floorplans,
  isLoading = false,
  isBackgroundSyncing = false,
  draggedIndex,
  dragOverIndex,
  handleDragStart,
  handleDragOver,
  handleDragEnd,
  handleDrop,
  navigate,
  activeDropdownFpId,
  setActiveDropdownFpId,
  setFloorplanToRename,
  setIsRenameModalOpen,
  handleDeleteFloorplan,
  setIsUploadModalOpen,
  isEditor = false,
  isSiteDropdownOpen = false,
  setIsSiteDropdownOpen,
  setSiteToRename,
  setIsRenameSiteModalOpen,
  handleDeleteSite
}) {
  return (
    <div className="list-view-container">
      <div className="flex-between flex-wrap gap-lg mb-xl">
        <div className="items-center gap-md">
          {isLoading && !activeSite ? (
            <div className="skeleton skeleton-pill" style={{ width: '220px', height: '28px' }} />
          ) : (
            <h2 className="text-lg font-semibold m-0 items-center gap-sm">
              Floorplans for {activeSite?.name || 'No Site Selected'}
              {isBackgroundSyncing && (
                <span className="sync-badge" title="Refreshing in background">
                  <RefreshCw size={11} className="spinning" />
                  <span>Syncing</span>
                </span>
              )}
            </h2>
          )}
        </div>

        {isLoading && sites.length === 0 ? (
          <div className="skeleton" style={{ width: '180px', height: '38px', borderRadius: '8px' }} />
        ) : sites.length > 0 && (
          <div className="items-center gap-sm">
            <select
              className="input-field select-site-dropdown"
              value={activeSite?.id || ''}
              onChange={(e) => setActiveSite(sites.find(s => s.id === parseInt(e.target.value)))}
            >
              {sites.map(s => (
                <option key={s.id} value={s.id}>{s.name}</option>
              ))}
            </select>

            {isEditor && activeSite && (
              <div className="dropdown-container">
                <button
                  type="button"
                  className="btn btn-secondary btn-icon"
                  onClick={(e) => {
                    e.stopPropagation();
                    if (setIsSiteDropdownOpen) setIsSiteDropdownOpen(!isSiteDropdownOpen);
                  }}
                  title="Site Actions (Rename / Delete)"
                >
                  <MoreVertical size={16} />
                </button>
                {isSiteDropdownOpen && (
                  <>
                    <div
                      className="dropdown-backdrop"
                      onClick={() => setIsSiteDropdownOpen && setIsSiteDropdownOpen(false)}
                    />
                    <div className="dropdown-menu dropdown-menu-right">
                      <button
                        className="dropdown-item"
                        onClick={() => {
                          if (setIsSiteDropdownOpen) setIsSiteDropdownOpen(false);
                          if (setSiteToRename) setSiteToRename(activeSite);
                          if (setIsRenameSiteModalOpen) setIsRenameSiteModalOpen(true);
                        }}
                      >
                        <Pencil size={16} />
                        <span>Rename Site</span>
                      </button>
                      <button
                        className="dropdown-item text-danger"
                        onClick={() => {
                          if (setIsSiteDropdownOpen) setIsSiteDropdownOpen(false);
                          if (handleDeleteSite) handleDeleteSite(activeSite.id);
                        }}
                      >
                        <Trash2 size={16} className="text-danger" />
                        <span>Delete Site</span>
                      </button>
                    </div>
                  </>
                )}
              </div>
            )}
          </div>
        )}
      </div>

      {isLoading && floorplans.length === 0 ? (
        <div className="card-grid p-0">
          {[1, 2, 3, 4, 5, 6].map((key) => (
            <div key={key} className="skeleton-card glass-panel flex-row items-center gap-lg min-h-96">
              <div className="skeleton skeleton-icon" />
              <div className="flex-1 flex-column gap-sm">
                <div className="skeleton skeleton-text" style={{ width: `${60 + (key % 3) * 15}%`, height: '18px' }} />
                <div className="skeleton skeleton-text" style={{ width: '35%', height: '12px' }} />
              </div>
            </div>
          ))}
        </div>
      ) : floorplans.length === 0 ? (
        <div className="glass-panel empty-state-box">
          <MapIcon size={48} className="empty-state-icon" />
          <h3 className="text-lg font-semibold mb-sm">No Floorplans Yet</h3>
          <p className="text-muted max-w-400 m-auto mb-xl text-md">
            {activeSite ? `There are no floorplans uploaded for "${activeSite.name}". Upload your first floorplan to get started.` : 'Select or create a site to upload floorplans.'}
          </p>
          {setIsUploadModalOpen && (
            <button className="btn btn-primary" onClick={() => setIsUploadModalOpen(true)}>
              <Upload size={16} />
              <span>Upload Floorplan</span>
            </button>
          )}
        </div>
      ) : (
        <div className="card-grid p-0">
          {floorplans.map((fp, index) => (
            <div
              key={fp.id}
              className={`card glass-panel relative ${isEditor ? 'grab' : ''} ${draggedIndex === index ? 'dragging' : ''} ${dragOverIndex === index && draggedIndex !== index ? 'drag-over' : ''}`}
              draggable={isEditor}
              onDragStart={isEditor ? (e) => handleDragStart(e, index) : undefined}
              onDragOver={isEditor ? (e) => handleDragOver(e, index) : undefined}
              onDragEnd={isEditor ? handleDragEnd : undefined}
              onDrop={isEditor ? (e) => handleDrop(e, index) : undefined}
              onClick={() => {
                floorplanLogger.startSwitch(fp.id, fp.name, 'Dashboard Floorplan Card');
                navigate(`/map/${fp.id}`);
              }}
              style={{
                zIndex: floorplans.length - index
              }}
            >
              <div className="items-center gap-lg pointer-events-none">
                <MapIcon size={32} color="var(--primary-color)" />
                <div>
                  <div className="card-title">{fp.name}</div>
                  <div className="text-muted text-sm">{(fp.file_type || 'MAP').toUpperCase()} File</div>
                </div>
              </div>
              {isEditor && (
                <div
                  className="dropdown-container card-options-dropdown"
                  onClick={(e) => e.stopPropagation()}
                >
                  <button
                    type="button"
                    className="card-options-btn"
                    onClick={(e) => {
                      e.stopPropagation();
                      setActiveDropdownFpId(activeDropdownFpId === fp.id ? null : fp.id);
                    }}
                    title="Options"
                  >
                    <MoreVertical size={15} />
                  </button>
                  {activeDropdownFpId === fp.id && (
                    <>
                      <div
                        className="dropdown-backdrop"
                        onClick={() => setActiveDropdownFpId(null)}
                      />
                      <div className="dropdown-menu dropdown-menu-right">
                        <button
                          className="dropdown-item"
                          onClick={(e) => {
                            e.stopPropagation();
                            setActiveDropdownFpId(null);
                            setFloorplanToRename(fp);
                            setIsRenameModalOpen(true);
                          }}
                        >
                          <Pencil size={16} />
                          <span>Rename</span>
                        </button>
                        <button
                          className="dropdown-item text-danger"
                          onClick={(e) => {
                            e.stopPropagation();
                            setActiveDropdownFpId(null);
                            handleDeleteFloorplan(e, fp.id);
                          }}
                        >
                          <Trash2 size={16} className="text-danger" />
                          <span>Delete</span>
                        </button>
                      </div>
                    </>
                  )}
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
