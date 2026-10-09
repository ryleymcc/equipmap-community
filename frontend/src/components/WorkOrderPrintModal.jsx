import { useState, useEffect } from 'react';
import { createPortal } from 'react-dom';
import {
  Printer, X, ChevronLeft, ChevronRight, SlidersHorizontal
} from 'lucide-react';
import WorkOrderPrintSheet from './WorkOrderPrintSheet';

export default function WorkOrderPrintModal({
  isOpen,
  onClose,
  workOrders = []
}) {
  const [currentSheetIdx, setCurrentSheetIdx] = useState(0);
  const [viewMode, setViewMode] = useState('all'); // 'all' or 'single'
  const [options, setOptions] = useState({
    showMap: true,
    showChecklist: true,
  });

  const ordersList = Array.isArray(workOrders) ? workOrders.filter(Boolean) : (workOrders ? [workOrders] : []);
  const totalOrders = ordersList.length;
  const safeCurrentIdx = Math.min(currentSheetIdx, Math.max(0, totalOrders - 1));

  // Keyboard shortcut (Escape to close)
  useEffect(() => {
    if (!isOpen) return;
    const handleKeyDown = (e) => {
      if (e.key === 'Escape') {
        onClose();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, onClose]);

  if (!isOpen || totalOrders === 0) return null;

  const handlePrint = () => {
    document.body.classList.add('is-printing-work-orders');
    window.print();
    setTimeout(() => {
      document.body.classList.remove('is-printing-work-orders');
    }, 1000);
  };

  const toggleOption = (key) => {
    setOptions(prev => ({ ...prev, [key]: !prev[key] }));
  };

  return createPortal(
    <div className="modal-overlay modal-backdrop-dark wo-print-modal-backdrop" onClick={onClose} style={{ zIndex: 1300 }}>
      <div
        className="modal-card modal-2xl glass-panel modal-wo-print"
        onClick={e => e.stopPropagation()}
      >
        {/* ========================================================
            MODAL HEADER & PRINT CONTROLS TOOLBAR
            ======================================================== */}
        <div className="modal-card-header flex-wrap wo-print-modal-header">
          {/* Left Title & Order Count */}
          <div className="flex items-center gap-sm">
            <div className="icon-box-primary">
              <Printer size={18} />
            </div>

            <div>
              <h2 className="text-base font-bold text-primary m-0">
                {totalOrders === 1
                  ? `Print Work Order (${ordersList[0].order_number || ordersList[0].id})`
                  : `Bulk Print Work Orders (${totalOrders} Selected)`}
              </h2>
              <div className="text-xs text-muted">
                Includes live QR codes and high-resolution cropped map snippets
              </div>
            </div>
          </div>

          {/* Right Action Buttons */}
          <div className="flex items-center gap-xs">
            <button
              type="button"
              onClick={handlePrint}
              className="btn btn-primary btn-sm gap-xs"
            >
              <Printer size={14} />
              <span>{totalOrders === 1 ? 'Print Work Order' : `Print All (${totalOrders})`}</span>
            </button>

            <button
              type="button"
              onClick={onClose}
              className="btn btn-ghost btn-icon-xs text-muted hover:text-primary ml-xs"
              title="Close print preview (Esc)"
            >
              <X size={18} />
            </button>
          </div>
        </div>

        {/* ========================================================
            OPTIONS TOGGLE BAR (Map, Checklist)
            ======================================================== */}
        <div
          className="wo-print-options-bar"
          style={{
            padding: '0.65rem 1.5rem',
            background: 'rgba(15, 23, 42, 0.65)',
            borderBottom: '1px solid var(--surface-border)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            gap: '1rem',
            flexWrap: 'wrap',
            fontSize: '0.8rem'
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.6rem', flexWrap: 'wrap' }}>
            <span style={{ color: 'var(--text-secondary)', fontWeight: 600, display: 'inline-flex', alignItems: 'center', gap: '0.35rem' }}>
              <SlidersHorizontal size={13} />
              <span>Options:</span>
            </span>

            {/* Map Toggle */}
            <label
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: '0.35rem',
                cursor: 'pointer',
                color: options.showMap ? 'var(--text-primary)' : 'var(--text-secondary)',
                fontWeight: options.showMap ? 600 : 400
              }}
            >
              <input
                type="checkbox"
                checked={options.showMap}
                onChange={() => toggleOption('showMap')}
                style={{ accentColor: '#3b82f6' }}
              />
              <span>Map Snippet</span>
            </label>

            {/* Checklist Toggle */}
            <label
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: '0.35rem',
                cursor: 'pointer',
                color: options.showChecklist ? 'var(--text-primary)' : 'var(--text-secondary)',
                fontWeight: options.showChecklist ? 600 : 400
              }}
            >
              <input
                type="checkbox"
                checked={options.showChecklist}
                onChange={() => toggleOption('showChecklist')}
                style={{ accentColor: '#3b82f6' }}
              />
              <span>Task Checklist</span>
            </label>
          </div>

          {/* View Mode Switching if multiple orders */}
          {totalOrders > 1 && (
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.45rem' }}>
              <div className="btn-group" style={{ display: 'inline-flex', borderRadius: '6px', overflow: 'hidden' }}>
                <button
                  type="button"
                  onClick={() => setViewMode('all')}
                  className={`btn ${viewMode === 'all' ? 'btn-primary' : 'btn-secondary'}`}
                  style={{ padding: '0.25rem 0.65rem', fontSize: '0.75rem' }}
                >
                  Show All ({totalOrders})
                </button>
                <button
                  type="button"
                  onClick={() => setViewMode('single')}
                  className={`btn ${viewMode === 'single' ? 'btn-primary' : 'btn-secondary'}`}
                  style={{ padding: '0.25rem 0.65rem', fontSize: '0.75rem' }}
                >
                  Page by Page
                </button>
              </div>

              {viewMode === 'single' && (
                <div style={{ display: 'flex', alignItems: 'center', gap: '0.25rem', marginLeft: '0.5rem' }}>
                  <button
                    type="button"
                    disabled={safeCurrentIdx === 0}
                    onClick={() => setCurrentSheetIdx(prev => Math.max(0, prev - 1))}
                    className="btn btn-secondary btn-icon"
                    style={{ padding: '0.3rem', borderRadius: '6px' }}
                    title="Previous sheet"
                  >
                    <ChevronLeft size={14} />
                  </button>
                  <span style={{ fontSize: '0.78rem', color: 'var(--text-secondary)', minWidth: '60px', textAlign: 'center' }}>
                    {safeCurrentIdx + 1} / {totalOrders}
                  </span>
                  <button
                    type="button"
                    disabled={safeCurrentIdx === totalOrders - 1}
                    onClick={() => setCurrentSheetIdx(prev => Math.min(totalOrders - 1, prev + 1))}
                    className="btn btn-secondary btn-icon"
                    style={{ padding: '0.3rem', borderRadius: '6px' }}
                    title="Next sheet"
                  >
                    <ChevronRight size={14} />
                  </button>
                </div>
              )}
            </div>
          )}
        </div>

        {/* ========================================================
            MODAL PREVIEW BODY (Scrollable Printable Documents)
            ======================================================== */}
        <div
          className="wo-print-preview-scroll-area"
          style={{
            padding: '2rem 1.5rem',
            overflowY: 'auto',
            flex: 1,
            backgroundColor: '#0b1120',
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            gap: '2.5rem'
          }}
        >
          {/* Printable Area Identifier */}
          <div id="printable-work-orders-area" className="wo-printable-container">
            {viewMode === 'all' ? (
              ordersList.map((wo, idx) => (
                <div key={wo.id} className="wo-print-sheet-wrapper">
                  <WorkOrderPrintSheet
                    workOrder={wo}
                    options={options}
                    isBulk={totalOrders > 1}
                    pageIndex={idx + 1}
                    totalPages={totalOrders}
                  />
                </div>
              ))
            ) : (
              <div className="wo-print-sheet-wrapper">
                <WorkOrderPrintSheet
                  workOrder={ordersList[safeCurrentIdx]}
                  options={options}
                  isBulk={totalOrders > 1}
                  pageIndex={safeCurrentIdx + 1}
                  totalPages={totalOrders}
                />
              </div>
            )}
          </div>
        </div>

        {/* ========================================================
            MODAL FOOTER
            ======================================================== */}
        <div
          className="wo-print-modal-footer"
          style={{
            padding: '0.85rem 1.5rem',
            borderTop: '1px solid var(--surface-border)',
            background: 'rgba(15, 23, 42, 0.95)',
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            gap: '1rem',
            flexWrap: 'wrap'
          }}
        >
          <div style={{ fontSize: '0.82rem', color: 'var(--text-secondary)' }}>
            Tip: In the browser print dialog, select <strong>"Save as PDF"</strong> or your office laser/thermal printer.
          </div>

          <div style={{ display: 'flex', alignItems: 'center', gap: '0.65rem' }}>
            <button
              type="button"
              onClick={onClose}
              className="btn btn-secondary"
              style={{ padding: '0.55rem 1.15rem', fontSize: '0.85rem', borderRadius: '8px' }}
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={handlePrint}
              className="btn btn-primary"
              style={{
                padding: '0.55rem 1.35rem',
                fontSize: '0.85rem',
                fontWeight: 700,
                borderRadius: '8px',
                display: 'inline-flex',
                alignItems: 'center',
                gap: '0.45rem'
              }}
            >
              <Printer size={15} />
              <span>Print {totalOrders > 1 ? `(${totalOrders})` : ''}</span>
            </button>
          </div>
        </div>
      </div>
    </div>,
    document.body
  );
}
