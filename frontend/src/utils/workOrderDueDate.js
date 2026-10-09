const CLOSED_WORK_ORDER_STATUSES = new Set(['completed', 'cancelled', 'rejected']);

export function parseWorkOrderDueDate(dateValue, endOfDayForDateOnly = false) {
  if (!dateValue) return null;

  if (typeof dateValue === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(dateValue)) {
    const [year, month, day] = dateValue.split('-').map(Number);
    return new Date(
      year,
      month - 1,
      day,
      endOfDayForDateOnly ? 23 : 0,
      endOfDayForDateOnly ? 59 : 0,
      endOfDayForDateOnly ? 59 : 0,
      endOfDayForDateOnly ? 999 : 0
    );
  }

  const parsedDate = new Date(dateValue);
  return Number.isNaN(parsedDate.getTime()) ? null : parsedDate;
}

export function isWorkOrderOverdue(workOrder, now = new Date()) {
  if (!workOrder?.due_date || CLOSED_WORK_ORDER_STATUSES.has(workOrder.status)) return false;

  const dueDate = parseWorkOrderDueDate(workOrder.due_date, true);
  return Boolean(dueDate && dueDate < now);
}
