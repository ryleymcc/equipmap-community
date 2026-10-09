import WorkOrderEditModal from './WorkOrderEditModal';

/**
 * Triage shares the complete work-order editor so request review cannot drift
 * from the fields and linked-asset selectors available after dispatch.
 */
export default function WorkOrderTriageModal({
  workOrder,
  isOpen,
  onClose,
  onSuccess,
  currentUser,
}) {
  return (
    <WorkOrderEditModal
      workOrder={workOrder}
      isOpen={isOpen}
      onClose={onClose}
      onUpdated={onSuccess}
      currentUser={currentUser}
      variant="triage"
    />
  );
}
