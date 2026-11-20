import { useId } from 'react';
import { ChevronsLeft, ChevronLeft, ChevronRight, ChevronsRight } from 'lucide-react';
import './TablePagination.css';

// Shared footer using the established equipment/room table pagination classes.
export default function TablePagination({ total, page, pageSize, onPageChange, onPageSizeChange, disabled = false }) {
  const selectId = useId();
  const pages = pageSize === 'all' ? 1 : Math.max(1, Math.ceil(total / pageSize));
  const current = Math.max(1, Math.min(page, pages));
  const start = total === 0 ? 0 : pageSize === 'all' ? 1 : (current - 1) * pageSize + 1;
  const end = pageSize === 'all' ? total : Math.min(current * pageSize, total);
  return <div className="table-pagination list-pagination-panel glass-panel">
    <div className="table-pagination-info">
      <span className="text-sm text-secondary">Showing <strong className="text-primary">{start.toLocaleString()}</strong> - <strong className="text-primary">{end.toLocaleString()}</strong> of <strong className="text-primary">{total.toLocaleString()}</strong> items</span>
      <div className="table-pagination-size">
        <label htmlFor={selectId}>Per page:</label>
        <select id={selectId} className="input-field list-pagesize-control" value={pageSize} disabled={disabled}
          onChange={event => onPageSizeChange(event.target.value === 'all' ? 'all' : Number(event.target.value))}>
          {[25, 50, 100, 250, 'all'].map(value => <option key={value} value={value}>{value === 'all' ? 'All' : value}</option>)}
        </select>
      </div>
    </div>
    {pageSize !== 'all' && pages > 1 && <nav className="table-pagination-controls" aria-label="Table pages">
      <button type="button" className="btn btn-secondary list-page-btn" aria-label="First page" title="First page" disabled={disabled || current === 1} onClick={() => onPageChange(1)}><ChevronsLeft size={16} /></button>
      <button type="button" className="btn btn-secondary list-page-btn" aria-label="Previous page" title="Previous page" disabled={disabled || current === 1} onClick={() => onPageChange(current - 1)}><ChevronLeft size={16} /></button>
      <span className="text-secondary">Page <strong>{current}</strong> of <strong>{pages}</strong></span>
      <button type="button" className="btn btn-secondary list-page-btn" aria-label="Next page" title="Next page" disabled={disabled || current === pages} onClick={() => onPageChange(current + 1)}><ChevronRight size={16} /></button>
      <button type="button" className="btn btn-secondary list-page-btn" aria-label="Last page" title="Last page" disabled={disabled || current === pages} onClick={() => onPageChange(pages)}><ChevronsRight size={16} /></button>
    </nav>}
  </div>;
}
