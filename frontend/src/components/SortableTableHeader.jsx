import { ArrowUpDown, ChevronUp, ChevronDown } from 'lucide-react';
import './TablePagination.css';

export default function SortableTableHeader({ field, sortBy, direction, onSort, disabled = false, children }) {
  const active = sortBy === field;
  const Icon = active ? direction === 'asc' ? ChevronUp : ChevronDown : ArrowUpDown;
  return <th scope="col" className="sortable-header" aria-sort={active ? direction === 'asc' ? 'ascending' : 'descending' : 'none'}>
    <button type="button" className="table-column-sort" disabled={disabled} onClick={() => onSort(field)}>
      {children}<Icon size={14} aria-hidden="true" />
    </button>
  </th>;
}
