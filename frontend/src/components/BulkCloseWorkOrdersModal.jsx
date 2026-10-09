import CloseWorkOrderModal from './CloseWorkOrderModal';

export default function BulkCloseWorkOrdersModal({
  isOpen = true,
  onClose,
  selectedWorkOrders = [],
  onSuccess
}) {
  if (!isOpen || !selectedWorkOrders || selectedWorkOrders.length === 0) return null;

  return (
    <CloseWorkOrderModal
      isOpen={isOpen}
      workOrders={selectedWorkOrders}
      onClose={onClose}
      onSuccess={onSuccess}
    />
  );
}
