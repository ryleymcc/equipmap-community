export const WORK_ORDER_SOURCES = [
  { value: 'pm', label: 'Preventive maintenance' },
  { value: 'staff', label: 'Staff-created' },
  { value: 'public', label: 'Public request' },
  { value: 'imported', label: 'Imported / legacy' }
];

export function getWorkOrderSource(workOrder) {
  if (workOrder?.pm_schedule_id) return 'pm';
  if (workOrder?.created_by_id) return 'staff';
  if (workOrder?.ip_address || workOrder?.user_agent || workOrder?.device_details) return 'public';
  return 'imported';
}
